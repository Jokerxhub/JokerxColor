import logging
import os
import re
import secrets
import sqlite3
from functools import wraps
from urllib.parse import quote as _urlquote
from datetime import datetime, timezone
from pathlib import Path

from authlib.integrations.base_client.errors import MismatchingStateError
from flask import Flask, jsonify, request, send_from_directory, session, redirect, url_for
from werkzeug.middleware.proxy_fix import ProxyFix

try:
    from authlib.integrations.flask_client import OAuth
except ImportError:
    OAuth = None

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "colors.db"

app = Flask(__name__, static_folder="static", static_url_path="")
app.secret_key = os.getenv("SECRET_KEY", "change-this-secret-in-production")
app.config["SESSION_COOKIE_HTTPONLY"] = True
# 启用 SameSite=Strict，防止跨站请求携带会话 Cookie（配合下方的 Double Submit Cookie CSRF 校验）
app.config["SESSION_COOKIE_SAMESITE"] = os.getenv("SESSION_COOKIE_SAMESITE", "Strict")
app.config["SESSION_COOKIE_SECURE"] = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

OIDC_ENABLED = os.getenv("OIDC_ENABLED", "false").lower() == "true"
OIDC_ISSUER = os.getenv("OIDC_ISSUER", "").rstrip("/")
OIDC_CLIENT_ID = os.getenv("OIDC_CLIENT_ID", "")
OIDC_CLIENT_SECRET = os.getenv("OIDC_CLIENT_SECRET", "")
OIDC_REDIRECT_URI = os.getenv("OIDC_REDIRECT_URI", "")
OIDC_SCOPE = os.getenv("OIDC_SCOPE", "openid profile email")

oauth = OAuth(app) if (OIDC_ENABLED and OAuth) else None
if oauth:
    oauth.register(
        name="oidc",
        client_id=OIDC_CLIENT_ID,
        client_secret=OIDC_CLIENT_SECRET,
        server_metadata_url=f"{OIDC_ISSUER}/.well-known/openid-configuration",
        client_kwargs={"scope": OIDC_SCOPE},
    )


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS colors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        hex TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_colors_group_order
      ON colors(group_id, sort_order);
    """)
    count = conn.execute("SELECT COUNT(*) FROM groups").fetchone()[0]
    if count == 0:
        now = utcnow()
        cur = conn.execute(
            "INSERT INTO groups(name, sort_order, created_at) VALUES(?,?,?)",
            ("默认分组", 0, now)
        )
        gid = cur.lastrowid
        conn.executemany(
            "INSERT INTO colors(group_id,name,hex,sort_order,created_at) VALUES(?,?,?,?,?)",
            [
                (gid, "蓝", "#00A9E0", 0, now),
                (gid, "粉", "#FF003E", 1, now),
            ],
        )
    conn.commit()
    conn.close()


HEX_RE = re.compile(r"^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$")


def valid_int(value):
    """接受整数或纯数字字符串（如前端传来的 "2"）。"""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    if isinstance(value, str) and value.strip().isdigit():
        return True
    return False


def valid_hex(value):
    if not isinstance(value, str):
        return False
    return bool(HEX_RE.match(value.strip()))


def normalize_hex(value):
    v = value.strip().upper()
    if len(v) == 4:  # 展开缩写形式，如 #ABC -> #AABBCC
        return "#" + "".join(ch * 2 for ch in v[1:])
    return v


def serialize_groups(conn):
    groups = conn.execute(
        "SELECT id,name,sort_order,created_at FROM groups ORDER BY sort_order,id"
    ).fetchall()
    result = []
    for g in groups:
        colors = conn.execute(
            """SELECT id,group_id,name,hex,sort_order,created_at
               FROM colors WHERE group_id=? ORDER BY sort_order,id""",
            (g["id"],),
        ).fetchall()
        result.append({
            "id": g["id"],
            "name": g["name"],
            "sort_order": g["sort_order"],
            "created_at": g["created_at"],
            "colors": [dict(c) for c in colors],
        })
    return result


def auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if OIDC_ENABLED and not session.get("user"):
            return jsonify({"error": "需要登录", "login_required": True}), 401
        return fn(*args, **kwargs)
    return wrapper


CSRF_COOKIE = "csrf_token"
CSRF_HEADER = "X-CSRF-Token"


@app.after_request
def set_csrf_cookie(response):
    """下发 CSRF cookie（非 HttpOnly，供前端 JS 读取后放入请求头）。"""
    token = request.cookies.get(CSRF_COOKIE)
    if not token:
        token = secrets.token_hex(32)
        response.set_cookie(
            CSRF_COOKIE, token,
            samesite=app.config["SESSION_COOKIE_SAMESITE"],
            secure=app.config["SESSION_COOKIE_SECURE"],
            httponly=False,
        )
    return response


@app.before_request
def csrf_protect():
    """Double Submit Cookie：写操作必须携带与 cookie 一致的 CSRF 头。"""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    if not request.path.startswith("/api/"):
        return
    cookie = request.cookies.get(CSRF_COOKIE, "")
    header = request.headers.get(CSRF_HEADER, "")
    if not cookie or cookie != header:
        return jsonify({"error": "CSRF 校验失败", "csrf_failed": True}), 403


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/config")
def config():
    return jsonify({
        "oidc_enabled": OIDC_ENABLED,
        "authenticated": bool(session.get("user")),
        "user": session.get("user"),
        "app_name": "JokerxColor",
    })


@app.get("/api/data")
@auth_required
def get_data():
    conn = db()
    data = serialize_groups(conn)
    conn.close()
    return jsonify({"groups": data})


@app.post("/api/groups")
@auth_required
def add_group():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip() or "新分组"
    conn = db()
    max_order = conn.execute("SELECT COALESCE(MAX(sort_order),-1) FROM groups").fetchone()[0]
    cur = conn.execute(
        "INSERT INTO groups(name,sort_order,created_at) VALUES(?,?,?)",
        (name, max_order + 1, utcnow()),
    )
    conn.commit()
    gid = cur.lastrowid
    conn.close()
    return jsonify({"ok": True, "id": gid})


@app.patch("/api/groups/<int:gid>")
@auth_required
def rename_group(gid):
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip()
    if not name:
        return jsonify({"error": "分组名称不能为空"}), 400
    conn = db()
    cur = conn.execute("UPDATE groups SET name=? WHERE id=?", (name, gid))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        return jsonify({"error": "分组不存在"}), 404
    return jsonify({"ok": True})


@app.delete("/api/groups/<int:gid>")
@auth_required
def delete_group(gid):
    conn = db()
    cur = conn.execute("DELETE FROM groups WHERE id=?", (gid,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        return jsonify({"error": "分组不存在"}), 404
    return jsonify({"ok": True})


@app.post("/api/groups/reorder")
@auth_required
def reorder_groups():
    payload = request.get_json(silent=True) or {}
    ids = payload.get("ids", [])
    if not isinstance(ids, list):
        return jsonify({"error": "ids 必须是数组"}), 400
    conn = db()
    for order, gid in enumerate(ids):
        if valid_int(gid):
            conn.execute("UPDATE groups SET sort_order=? WHERE id=?", (order, int(gid)))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.post("/api/colors")
@auth_required
def add_color(gid=None):
    payload = request.get_json(silent=True) or {}
    if gid is None:
        gid = payload.get("group_id")
    color = normalize_hex(str(payload.get("hex", "")))
    name = str(payload.get("name", "")).strip()
    if not valid_int(gid) or not valid_hex(color):
        return jsonify({"error": "group_id 或 HEX 无效"}), 400

    conn = db()
    gid = int(gid)
    if not conn.execute("SELECT 1 FROM groups WHERE id=?", (gid,)).fetchone():
        conn.close()
        return jsonify({"error": "分组不存在"}), 404
    max_order = conn.execute(
        "SELECT COALESCE(MAX(sort_order),-1) FROM colors WHERE group_id=?", (gid,)
    ).fetchone()[0]
    cur = conn.execute(
        """INSERT INTO colors(group_id,name,hex,sort_order,created_at)
           VALUES(?,?,?,?,?)""",
        (gid, name or color, color, max_order + 1, utcnow()),
    )
    conn.commit()
    cid = cur.lastrowid
    conn.close()
    return jsonify({"ok": True, "id": cid})


@app.patch("/api/colors/<int:cid>")
@auth_required
def edit_color(cid):
    payload = request.get_json(silent=True) or {}
    fields = []
    values = []
    if "name" in payload:
        fields.append("name=?")
        values.append(str(payload["name"]).strip())
    if "hex" in payload:
        color = normalize_hex(str(payload["hex"]))
        if not valid_hex(color):
            return jsonify({"error": "HEX 无效"}), 400
        fields.append("hex=?")
        values.append(color)
    if not fields:
        return jsonify({"error": "没有需要修改的内容"}), 400
    values.append(cid)

    conn = db()
    cur = conn.execute(f"UPDATE colors SET {','.join(fields)} WHERE id=?", values)
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        return jsonify({"error": "颜色不存在"}), 404
    return jsonify({"ok": True})


@app.delete("/api/colors/<int:cid>")
@auth_required
def delete_color(cid):
    conn = db()
    cur = conn.execute("DELETE FROM colors WHERE id=?", (cid,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        return jsonify({"error": "颜色不存在"}), 404
    return jsonify({"ok": True})


@app.post("/api/colors/reorder")
@auth_required
def reorder_colors():
    payload = request.get_json(silent=True) or {}
    gid = payload.get("group_id")
    ids = payload.get("ids", [])
    if not valid_int(gid) or not isinstance(ids, list):
        return jsonify({"error": "参数无效"}), 400
    conn = db()
    for order, cid in enumerate(ids):
        if not valid_int(cid):
            continue
        conn.execute(
            "UPDATE colors SET sort_order=? WHERE id=? AND group_id=?",
            (order, int(cid), int(gid)),
        )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.get("/api/export")
@auth_required
def export_data():
    conn = db()
    data = {"version": 1, "app": "JokerxColor", "exported_at": utcnow(),
            "groups": serialize_groups(conn)}
    conn.close()
    response = jsonify(data)
    response.headers["Content-Disposition"] = 'attachment; filename="jokerxcolor-backup.json"'
    return response


@app.post("/api/import")
@auth_required
def import_data():
    payload = request.get_json(silent=True) or {}
    groups = payload.get("groups")
    if not isinstance(groups, list):
        return jsonify({"error": "导入文件格式错误"}), 400

    conn = db()
    try:
        # 先全部解析校验，任何一条不合法就整体拒绝，避免"删了旧数据却只导入一半"
        parsed = []
        for gi, g in enumerate(groups):
            if not isinstance(g, dict):
                raise ValueError(f"第 {gi+1} 个分组格式错误")
            name = str(g.get("name", "")).strip() or f"分组 {gi+1}"
            colors_in = g.get("colors", [])
            if not isinstance(colors_in, list):
                raise ValueError(f"分组“{name}”的 colors 必须是数组")
            parsed_colors = []
            for ci, c in enumerate(colors_in):
                if not isinstance(c, dict):
                    raise ValueError(f"分组“{name}”第 {ci+1} 个颜色格式错误")
                hx = normalize_hex(str(c.get("hex", "")))
                if not valid_hex(hx):
                    raise ValueError(f"分组“{name}”第 {ci+1} 个颜色 HEX 无效：{c.get('hex')!r}")
                cname = str(c.get("name", "")).strip() or hx
                parsed_colors.append((cname, hx))
            parsed.append((name, parsed_colors))

        conn.execute("BEGIN")
        conn.execute("DELETE FROM colors")
        conn.execute("DELETE FROM groups")
        for gi, (name, parsed_colors) in enumerate(parsed):
            cur = conn.execute(
                "INSERT INTO groups(name,sort_order,created_at) VALUES(?,?,?)",
                (name, gi, utcnow()),
            )
            gid = cur.lastrowid
            for ci, (cname, hx) in enumerate(parsed_colors):
                conn.execute(
                    """INSERT INTO colors(group_id,name,hex,sort_order,created_at)
                       VALUES(?,?,?,?,?)""",
                    (gid, cname, hx, ci, utcnow()),
                )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        return jsonify({"error": f"导入失败：{exc}"}), 400
    finally:
        conn.close()
    return jsonify({"ok": True})


@app.post("/api/reset")
@auth_required
def reset_data():
    conn = db()
    conn.execute("DELETE FROM colors")
    conn.execute("DELETE FROM groups")
    now = utcnow()
    cur = conn.execute(
        "INSERT INTO groups(name,sort_order,created_at) VALUES(?,?,?)",
        ("默认分组", 0, now),
    )
    gid = cur.lastrowid
    conn.executemany(
        """INSERT INTO colors(group_id,name,hex,sort_order,created_at)
           VALUES(?,?,?,?,?)""",
        [(gid, "蓝", "#00A9E0", 0, now), (gid, "粉", "#FF003E", 1, now)],
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.get("/auth/login")
def login():
    if not OIDC_ENABLED or not oauth:
        return jsonify({"error": "OIDC 未启用"}), 400
    # 保存登录前的页面，回调成功后跳回（仅允许站内相对路径，防开放重定向）
    next_url = request.args.get("next", "/")
    if not next_url.startswith("/") or next_url.startswith("//"):
        next_url = "/"
    session["oidc_next"] = next_url
    redirect_uri = OIDC_REDIRECT_URI or url_for("auth_callback", _external=True)
    try:
        # authorize_redirect 会拉取 OIDC Discovery 元数据并生成 state 存入 session；
        # 授权服务器不可达时抛连接异常，需兜底避免 500
        return oauth.oidc.authorize_redirect(redirect_uri)
    except Exception:
        app.logger.exception("OIDC 发起授权失败（issuer=%s）", OIDC_ISSUER)
        return "<meta charset='utf-8'><h3>无法发起登录</h3><p>认证服务暂时不可用，请稍后重试。</p>", 502


def _auth_failed(msg, status=400):
    """回调失败：清理会话中残留的 state/nonce，记录日志并返回明确错误页。"""
    session.pop("oidc_state", None)
    session.pop("oidc_nonce", None)
    session.pop("oidc_next", None)
    app.logger.warning("OIDC 认证失败: %s (remote_addr=%s)", msg, request.remote_addr)
    safe_msg = _urlquote(msg, safe="")
    return (
        "<meta charset='utf-8'><h3>登录失败</h3>"
        f"<p><a href='/auth/login?next={safe_msg}'>点击此处重新登录</a></p>"
        "<p>若问题持续，请联系管理员。</p>",
        status,
    )


@app.get("/auth/callback")
def auth_callback():
    if not OIDC_ENABLED or not oauth:
        return redirect("/")
    # 授权服务器显式返回错误（如用户拒绝授权 access_denied）
    if "error" in request.args:
        return _auth_failed(f"授权被拒绝或出错：{request.args.get('error_description') or request.args['error']}")
    try:
        # authorize_access_token 内部会校验 state（session 中的 oidc_state 与回调参数比对），
        # 不匹配时抛出 MismatchingStateError —— 典型 CSRF / 重放攻击场景
        token = oauth.oidc.authorize_access_token()
    except MismatchingStateError:
        # state 缺失或不匹配：可能是伪造回调、会话过期或 Cookie 丢失，绝不允许登录
        return _auth_failed("state 校验未通过（可能存在安全风险或会话已过期），请重新登录")
    except Exception as e:
        # 其余异常（id_token nonce 校验失败、签名/issuer 校验失败、网络错误等）统一兜底，
        # 避免 500 裸奔；对外不回显异常细节，仅记入服务端日志
        app.logger.exception("OIDC 回调处理异常")
        return _auth_failed(f"令牌校验失败：{type(e).__name__}", 502)

    userinfo = token.get("userinfo")
    if not userinfo:
        try:
            userinfo = oauth.oidc.userinfo()
        except Exception:
            app.logger.exception("OIDC userinfo 端点调用失败")
            userinfo = {}
    sub = userinfo.get("sub")
    if not sub:
        # 拿不到用户唯一标识时拒绝建立会话，防止以空身份登录
        return _auth_failed("身份信息缺少 sub 字段，无法登录", 502)
    session.permanent = False
    session["user"] = {
        "sub": sub,
        "name": userinfo.get("name") or userinfo.get("preferred_username") or userinfo.get("email") or "User",
        "email": userinfo.get("email", ""),
    }
    next_url = session.pop("oidc_next", "/")
    return redirect(next_url)


@app.get("/auth/logout")
def logout():
    session.clear()
    return redirect("/")


@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Not Found"}), 404
    return send_from_directory(app.static_folder, "index.html")


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "1314")), debug=False)
