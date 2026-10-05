"""
JokerxColor - 颜色管理网站
Flask + SQLite 单文件后端
"""
import os
import json
import sqlite3
import hashlib
import secrets
import base64
import time
import logging
from datetime import datetime, timezone
from functools import wraps

from flask import (
    Flask, request, jsonify, render_template, session,
    redirect, url_for, make_response, g
)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix
import pyotp
import qrcode
import io
import requests

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("jokerxcolor")

# ============================================================
# 配置
# ============================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB_PATH = os.path.join(BASE_DIR, "data", "colors.db")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-key-change-me")
app.config["DATABASE_PATH"] = os.environ.get("DATABASE_PATH", DEFAULT_DB_PATH)
app.config["PERMANENT_SESSION_LIFETIME"] = 60 * 60 * 24 * 7  # 7 天
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_HTTPONLY"] = True

# 反向代理支持：正确识别 X-Forwarded-Proto / X-Forwarded-Host
# 这样通过域名 + Nginx 反代访问时，request.scheme / request.host 能正确反映外部地址
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# Casdoor 配置
CASDOOR = {
    "enabled": os.environ.get("CASDOOR_ENABLED", "false").lower() == "true",
    "endpoint": os.environ.get("CASDOOR_ENDPOINT", ""),
    "client_id": os.environ.get("CASDOOR_CLIENT_ID", ""),
    "client_secret": os.environ.get("CASDOOR_CLIENT_SECRET", ""),
    "org_name": os.environ.get("CASDOOR_ORG_NAME", ""),
    "app_name": os.environ.get("CASDOOR_APP_NAME", ""),
    "redirect_uri": os.environ.get("CASDOOR_REDIRECT_URI", ""),
}

# ============================================================
# 数据库
# ============================================================
def get_db():
    if "db" not in g:
        os.makedirs(os.path.dirname(app.config["DATABASE_PATH"]), exist_ok=True)
        g.db = sqlite3.connect(app.config["DATABASE_PATH"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """初始化数据库表和默认数据"""
    db = get_db()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS colors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            hex TEXT NOT NULL,
            name TEXT DEFAULT '',
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_admin INTEGER DEFAULT 1,
            totp_secret TEXT DEFAULT '',
            totp_enabled INTEGER DEFAULT 0,
            casdoor_sub TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    """)
    db.commit()

    # 迁移：为旧数据库添加 casdoor_sub 字段
    try:
        db.execute("ALTER TABLE users ADD COLUMN casdoor_sub TEXT DEFAULT ''")
        db.commit()
    except sqlite3.OperationalError:
        pass  # 字段已存在

    # 默认设置
    default_settings = {
        "card_width": "200",
        "card_height": "160",
        "theme": "system",
        "auth_required": os.environ.get("AUTH_REQUIRED", "false"),
    }
    for key, value in default_settings.items():
        db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, value))
    db.commit()

    # 默认管理员
    admin = db.execute("SELECT id FROM users WHERE username = ?", ("admin",)).fetchone()
    if not admin:
        db.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)",
            ("admin", generate_password_hash("admin"))
        )
        db.commit()

    # 默认分组和颜色
    group_count = db.execute("SELECT COUNT(*) as c FROM groups").fetchone()["c"]
    if group_count == 0:
        cur = db.execute("INSERT INTO groups (name, sort_order) VALUES (?, 0)", ("默认分组",))
        group_id = cur.lastrowid
        db.execute(
            "INSERT INTO colors (group_id, hex, name, sort_order) VALUES (?, ?, ?, 0)",
            (group_id, "#00A9E0", "蓝")
        )
        db.execute(
            "INSERT INTO colors (group_id, hex, name, sort_order) VALUES (?, ?, ?, 1)",
            (group_id, "#FF003E", "粉")
        )
        db.commit()


# ============================================================
# 工具函数
# ============================================================
def get_setting(key, default=None):
    db = get_db()
    row = db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key, value):
    db = get_db()
    db.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value))
    )
    db.commit()


def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    if len(hex_color) == 3:
        hex_color = "".join(c * 2 for c in hex_color)
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return r, g, b


def rgb_to_hex(r, g, b):
    return "#{:02X}{:02X}{:02X}".format(
        max(0, min(255, int(r))),
        max(0, min(255, int(g))),
        max(0, min(255, int(b)))
    )


def complementary_color(hex_color):
    r, g, b = hex_to_rgb(hex_color)
    return rgb_to_hex(255 - r, 255 - g, 255 - b)


def triadic_colors(hex_color):
    """三角配色：旋转 120 度和 240 度"""
    r, g, b = hex_to_rgb(hex_color)
    # RGB 旋转 120 度
    c1 = rgb_to_hex(b, r, g)
    c2 = rgb_to_hex(g, b, r)
    return [c1, c2]


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_required = get_setting("auth_required", "false") == "true"
        if auth_required and "user_id" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "未登录"}), 401
            return redirect(url_for("login", next=request.path))
        return f(*args, **kwargs)
    return decorated_function


def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "未登录"}), 401
        db = get_db()
        user = db.execute("SELECT is_admin FROM users WHERE id = ?", (session["user_id"],)).fetchone()
        if not user or not user["is_admin"]:
            return jsonify({"error": "需要管理员权限"}), 403
        return f(*args, **kwargs)
    return decorated_function


# ============================================================
# 页面路由
# ============================================================
@app.route("/")
@login_required
def index():
    return render_template("index.html")


@app.route("/settings")
@login_required
def settings_page():
    return render_template("settings.html")


@app.route("/login")
def login():
    if "user_id" in session:
        return redirect(url_for("index"))
    return render_template("login.html", casdoor_enabled=CASDOOR["enabled"])


@app.route("/healthz")
def healthz():
    return jsonify({"status": "ok"})


# ============================================================
# 认证 API
# ============================================================
@app.route("/api/auth/login", methods=["POST"])
def api_login():
    data = request.get_json(force=True)
    username = data.get("username", "").strip()
    password = data.get("password", "")
    totp_code = data.get("totp_code", "")

    if not username or not password:
        return jsonify({"error": "用户名和密码不能为空"}), 400

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "用户名或密码错误"}), 401

    # 2FA 验证
    if user["totp_enabled"] and user["totp_secret"]:
        if not totp_code:
            return jsonify({"error": "需要双因素认证码", "need_totp": True}), 401
        totp = pyotp.TOTP(user["totp_secret"])
        if not totp.verify(totp_code, valid_window=1):
            return jsonify({"error": "双因素认证码错误"}), 401

    session.permanent = True
    session["user_id"] = user["id"]
    session["username"] = user["username"]
    session["is_admin"] = bool(user["is_admin"])

    return jsonify({
        "message": "登录成功",
        "user": {"id": user["id"], "username": user["username"], "is_admin": bool(user["is_admin"])}
    })


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"message": "已退出登录"})


@app.route("/api/auth/me")
def api_me():
    if "user_id" not in session:
        return jsonify({"authenticated": False, "auth_required": get_setting("auth_required", "false") == "true"})
    db = get_db()
    user = db.execute("SELECT id, username, is_admin, totp_enabled FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    if not user:
        session.clear()
        return jsonify({"authenticated": False})
    return jsonify({
        "authenticated": True,
        "auth_required": get_setting("auth_required", "false") == "true",
        "user": {"id": user["id"], "username": user["username"], "is_admin": bool(user["is_admin"]), "totp_enabled": bool(user["totp_enabled"])}
    })


# ============================================================
# Casdoor SSO
# ============================================================
def get_casdoor_redirect_uri():
    """
    获取 Casdoor 回调地址。
    优先使用环境变量 CASDOOR_REDIRECT_URI；
    未设置时根据当前请求动态生成（自动适配 IP / 域名 / HTTP / HTTPS）。
    """
    if CASDOOR["redirect_uri"]:
        return CASDOOR["redirect_uri"]
    # _external=True 会使用 request.host + request.scheme
    # 配合 ProxyFix 可以正确拿到反代后的 https + 域名
    return url_for("casdoor_callback", _external=True)


def _build_casdoor_auth_url(state, mode="login"):
    """构建 Casdoor 授权 URL，mode: login / bind"""
    redirect_uri = get_casdoor_redirect_uri()
    return (
        f"{CASDOOR['endpoint'].rstrip('/')}/login/oauth/authorize"
        f"?client_id={CASDOOR['client_id']}"
        f"&response_type=code"
        f"&redirect_uri={requests.utils.quote(redirect_uri, safe='')}"
        f"&scope=read"
        f"&state={state}"
    )


def _redirect_page(auth_url, title="正在跳转到 Casdoor...", msg="正在跳转到 Casdoor 登录..."):
    """生成前端 JS 跳转页面，绕过反向代理 Location 改写"""
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0;url={auth_url}">
<title>{title}</title>
<style>
  body {{ margin:0; display:flex; align-items:center; justify-content:center;
    height:100vh; background:#0f1117; color:#e8eaf0; font-family:sans-serif; }}
  .box {{ text-align:center; }}
  .spinner {{ width:32px; height:32px; border:3px solid #2d3142; border-top-color:#00A9E0;
    border-radius:50%; animation:spin 0.8s linear infinite; margin:0 auto 16px; }}
  @keyframes spin {{ to {{ transform:rotate(360deg); }} }}
  a {{ color:#00A9E0; }}
</style>
</head>
<body>
  <div class="box">
    <div class="spinner"></div>
    <p>{msg}</p>
    <p style="font-size:12px;opacity:0.6;margin-top:8px;">
      如未自动跳转，请<a href="{auth_url}">点击这里</a>
    </p>
  </div>
  <script>window.location.href = {json.dumps(auth_url)};</script>
</body>
</html>"""


def _casdoor_exchange_code(code):
    """用 code 换取 access_token 并获取用户信息，返回 user_info dict"""
    redirect_uri = get_casdoor_redirect_uri()

    # 1. 换取 access_token
    token_url = f"{CASDOOR['endpoint'].rstrip('/')}/api/login/oauth/access_token"
    logger.info("请求 token: %s", token_url)
    token_resp = requests.post(
        token_url,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": CASDOOR["client_id"],
            "client_secret": CASDOOR["client_secret"],
            "redirect_uri": redirect_uri,
        },
        timeout=15
    )
    logger.info("Token 响应状态: %s, body: %s", token_resp.status_code, token_resp.text[:500])
    if token_resp.status_code != 200:
        raise Exception(f"Token 请求失败 (HTTP {token_resp.status_code}): {token_resp.text[:200]}")

    token_data = token_resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        raise Exception(f"响应中无 access_token: {json.dumps(token_data)[:200]}")

    # 2. 获取用户信息
    userinfo_url = f"{CASDOOR['endpoint'].rstrip('/')}/api/userinfo"
    logger.info("请求 userinfo: %s", userinfo_url)
    user_resp = requests.get(
        userinfo_url,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=15
    )
    logger.info("Userinfo 响应状态: %s, body: %s", user_resp.status_code, user_resp.text[:500])
    if user_resp.status_code != 200:
        raise Exception(f"用户信息请求失败 (HTTP {user_resp.status_code}): {user_resp.text[:200]}")

    return user_resp.json()


def _get_casdoor_identifier(user_info):
    """从 Casdoor userinfo 中提取唯一标识（优先 sub，其次 preferred_username）"""
    return (
        user_info.get("sub")
        or user_info.get("preferred_username")
        or user_info.get("name")
        or user_info.get("username")
        or user_info.get("email")
    )


@app.route("/auth/casdoor")
def casdoor_login():
    if not CASDOOR["enabled"]:
        return jsonify({"error": "Casdoor 未启用"}), 400

    state = secrets.token_urlsafe(16)
    session["casdoor_state"] = state
    session["casdoor_mode"] = "login"
    session.permanent = True

    auth_url = _build_casdoor_auth_url(state, "login")
    logger.info("Casdoor 登录发起: %s", auth_url)
    return _redirect_page(auth_url)


@app.route("/auth/casdoor/callback")
def casdoor_callback():
    if not CASDOOR["enabled"]:
        return jsonify({"error": "Casdoor 未启用"}), 400

    code = request.args.get("code")
    state = request.args.get("state")
    saved_state = session.pop("casdoor_state", None)
    mode = session.pop("casdoor_mode", "login")

    logger.info("Casdoor 回调: mode=%s, code=%s, state_match=%s",
                mode, "有" if code else "无",
                state == saved_state if state and saved_state else False)

    if not code:
        logger.error("Casdoor 回调缺少 code，args=%s", dict(request.args))
        return render_template("login.html", error="Casdoor 回调缺少授权码，请检查 Casdoor 应用配置中的回调地址", casdoor_enabled=True)

    if state != saved_state:
        logger.error("Casdoor state 不匹配: received=%s, saved=%s", state, saved_state)
        return render_template("login.html", error="Casdoor 状态校验失败（state 不匹配），请重试", casdoor_enabled=True)

    try:
        user_info = _casdoor_exchange_code(code)
        casdoor_id = _get_casdoor_identifier(user_info)
        if not casdoor_id:
            raise Exception(f"无法从 userinfo 获取用户标识，字段: {list(user_info.keys())}")

        logger.info("Casdoor 用户标识: %s", casdoor_id)
        db = get_db()

        # ===== 绑定模式：将 Casdoor 账号绑定到当前登录用户 =====
        if mode == "bind":
            bind_user_id = session.pop("casdoor_bind_user_id", None)
            if not bind_user_id:
                return render_template("login.html", error="绑定失败：会话已过期，请重新登录后重试", casdoor_enabled=True)

            # 检查该 Casdoor 账号是否已绑定其他用户
            existing = db.execute("SELECT id, username FROM users WHERE casdoor_sub = ? AND id != ?",
                                  (casdoor_id, bind_user_id)).fetchone()
            if existing:
                return render_template("login.html",
                    error=f"该 Casdoor 账号已绑定到用户「{existing['username']}」，请先解绑",
                    casdoor_enabled=True)

            db.execute("UPDATE users SET casdoor_sub = ? WHERE id = ?", (casdoor_id, bind_user_id))
            db.commit()
            logger.info("Casdoor 绑定成功: user_id=%s, casdoor_id=%s", bind_user_id, casdoor_id)

            settings_url = url_for("settings_page")
            return _redirect_page(settings_url, "绑定成功", "Casdoor 账号绑定成功，正在跳转...")

        # ===== 登录模式：只匹配已绑定的本地用户，不自动创建 =====
        # 优先按 casdoor_sub 精确匹配
        user = db.execute("SELECT * FROM users WHERE casdoor_sub = ?", (casdoor_id,)).fetchone()

        # 兼容旧数据：如果 casdoor_sub 为空，按用户名匹配并自动回填绑定
        if not user:
            username = (
                user_info.get("preferred_username")
                or user_info.get("name")
                or user_info.get("username")
                or user_info.get("email")
            )
            if username:
                user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
                if user and not user["casdoor_sub"]:
                    db.execute("UPDATE users SET casdoor_sub = ? WHERE id = ?", (casdoor_id, user["id"]))
                    db.commit()
                    logger.info("自动回填绑定: user=%s, casdoor_id=%s", username, casdoor_id)

        if not user:
            logger.warning("Casdoor 账号未绑定本地用户: casdoor_id=%s", casdoor_id)
            return render_template("login.html",
                error="该 Casdoor 账号未绑定本地用户。请先用本地账号登录后在「设置 → 安全设置」中绑定 Casdoor，或联系管理员。",
                casdoor_enabled=True)

        # 建立会话
        session.clear()
        session.permanent = True
        session["user_id"] = user["id"]
        session["username"] = user["username"]
        session["is_admin"] = bool(user["is_admin"])
        session.modified = True

        logger.info("Casdoor 登录成功: user_id=%s, username=%s", user["id"], user["username"])
        index_url = url_for("index")
        return _redirect_page(index_url, "登录成功", "登录成功，正在跳转...")

    except requests.exceptions.RequestException as e:
        logger.error("Casdoor 网络请求异常: %s", str(e), exc_info=True)
        return render_template("login.html", error=f"无法连接 Casdoor 服务器: {str(e)}", casdoor_enabled=True)
    except Exception as e:
        logger.error("Casdoor 回调异常: %s", str(e), exc_info=True)
        return render_template("login.html", error=f"Casdoor 登录失败: {str(e)}", casdoor_enabled=True)


# ============================================================
# Casdoor 绑定 / 解绑 API
# ============================================================
@app.route("/api/auth/casdoor/bind-status")
@login_required
def casdoor_bind_status():
    """查询当前用户的 Casdoor 绑定状态"""
    db = get_db()
    user = db.execute("SELECT casdoor_sub FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    return jsonify({
        "enabled": CASDOOR["enabled"],
        "bound": bool(user and user["casdoor_sub"]),
        "casdoor_sub": user["casdoor_sub"] if user else "",
        "endpoint": CASDOOR["endpoint"],
    })


@app.route("/api/auth/casdoor/bind", methods=["POST"])
@login_required
def casdoor_bind():
    """发起 Casdoor 绑定流程：返回授权 URL，前端跳转"""
    if not CASDOOR["enabled"]:
        return jsonify({"error": "Casdoor 未启用"}), 400

    state = secrets.token_urlsafe(16)
    session["casdoor_state"] = state
    session["casdoor_mode"] = "bind"
    session["casdoor_bind_user_id"] = session["user_id"]
    session.permanent = True

    auth_url = _build_casdoor_auth_url(state, "bind")
    logger.info("Casdoor 绑定发起: user_id=%s, url=%s", session["user_id"], auth_url)
    return jsonify({"auth_url": auth_url})


@app.route("/api/auth/casdoor/unbind", methods=["POST"])
@login_required
def casdoor_unbind():
    """解绑当前用户的 Casdoor"""
    db = get_db()
    db.execute("UPDATE users SET casdoor_sub = '' WHERE id = ?", (session["user_id"],))
    db.commit()
    logger.info("Casdoor 解绑: user_id=%s", session["user_id"])
    return jsonify({"message": "已解绑 Casdoor 账号"})


@app.route("/api/auth/casdoor/status")
def casdoor_status():
    """Casdoor 配置诊断端点，用于排查 SSO 问题"""
    redirect_uri = None
    try:
        redirect_uri = get_casdoor_redirect_uri()
    except Exception:
        pass

    return jsonify({
        "enabled": CASDOOR["enabled"],
        "endpoint": CASDOOR["endpoint"],
        "client_id": CASDOOR["client_id"],
        "org_name": CASDOOR["org_name"],
        "app_name": CASDOOR["app_name"],
        "redirect_uri_configured": bool(CASDOOR["redirect_uri"]),
        "redirect_uri": redirect_uri,
        "request_scheme": request.scheme,
        "request_host": request.host,
        "request_url_root": request.url_root,
    })


# ============================================================
# 分组 API
# ============================================================
@app.route("/api/groups", methods=["GET"])
@login_required
def list_groups():
    db = get_db()
    groups = db.execute("SELECT * FROM groups ORDER BY sort_order ASC, id ASC").fetchall()
    result = []
    for group in groups:
        colors = db.execute(
            "SELECT * FROM colors WHERE group_id = ? ORDER BY sort_order ASC, id ASC",
            (group["id"],)
        ).fetchall()
        result.append({
            "id": group["id"],
            "name": group["name"],
            "sort_order": group["sort_order"],
            "colors": [
                {"id": c["id"], "hex": c["hex"], "name": c["name"], "sort_order": c["sort_order"]}
                for c in colors
            ]
        })
    return jsonify(result)


@app.route("/api/groups", methods=["POST"])
@login_required
def create_group():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "分组名称不能为空"}), 400
    db = get_db()
    max_order = db.execute("SELECT COALESCE(MAX(sort_order), -1) as m FROM groups").fetchone()["m"]
    cur = db.execute("INSERT INTO groups (name, sort_order) VALUES (?, ?)", (name, max_order + 1))
    db.commit()
    return jsonify({"id": cur.lastrowid, "name": name, "sort_order": max_order + 1, "colors": []})


@app.route("/api/groups/<int:group_id>", methods=["PUT"])
@login_required
def update_group(group_id):
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "分组名称不能为空"}), 400
    db = get_db()
    db.execute("UPDATE groups SET name = ? WHERE id = ?", (name, group_id))
    db.commit()
    return jsonify({"message": "已更新"})


@app.route("/api/groups/<int:group_id>", methods=["DELETE"])
@login_required
def delete_group(group_id):
    db = get_db()
    db.execute("DELETE FROM groups WHERE id = ?", (group_id,))
    db.commit()
    return jsonify({"message": "已删除"})


@app.route("/api/groups/reorder", methods=["POST"])
@login_required
def reorder_groups():
    data = request.get_json(force=True)
    ids = data.get("ids", [])
    db = get_db()
    for idx, gid in enumerate(ids):
        db.execute("UPDATE groups SET sort_order = ? WHERE id = ?", (idx, gid))
    db.commit()
    return jsonify({"message": "已排序"})


# ============================================================
# 颜色 API
# ============================================================
@app.route("/api/groups/<int:group_id>/colors", methods=["POST"])
@login_required
def create_color(group_id):
    data = request.get_json(force=True)
    hex_color = data.get("hex", "").strip().upper()
    name = data.get("name", "").strip()
    if not hex_color or not hex_color.startswith("#") or len(hex_color) not in (4, 7):
        return jsonify({"error": "颜色格式不正确，例如 #00A9E0"}), 400
    db = get_db()
    group = db.execute("SELECT id FROM groups WHERE id = ?", (group_id,)).fetchone()
    if not group:
        return jsonify({"error": "分组不存在"}), 404
    max_order = db.execute(
        "SELECT COALESCE(MAX(sort_order), -1) as m FROM colors WHERE group_id = ?",
        (group_id,)
    ).fetchone()["m"]
    cur = db.execute(
        "INSERT INTO colors (group_id, hex, name, sort_order) VALUES (?, ?, ?, ?)",
        (group_id, hex_color, name, max_order + 1)
    )
    db.commit()
    return jsonify({"id": cur.lastrowid, "hex": hex_color, "name": name, "sort_order": max_order + 1})


@app.route("/api/colors/<int:color_id>", methods=["PUT"])
@login_required
def update_color(color_id):
    data = request.get_json(force=True)
    db = get_db()
    color = db.execute("SELECT * FROM colors WHERE id = ?", (color_id,)).fetchone()
    if not color:
        return jsonify({"error": "颜色不存在"}), 404
    hex_color = data.get("hex", color["hex"]).strip().upper()
    name = data.get("name", color["name"])
    if not hex_color.startswith("#") or len(hex_color) not in (4, 7):
        return jsonify({"error": "颜色格式不正确"}), 400
    db.execute("UPDATE colors SET hex = ?, name = ? WHERE id = ?", (hex_color, name, color_id))
    db.commit()
    return jsonify({"message": "已更新"})


@app.route("/api/colors/<int:color_id>", methods=["DELETE"])
@login_required
def delete_color(color_id):
    db = get_db()
    db.execute("DELETE FROM colors WHERE id = ?", (color_id,))
    db.commit()
    return jsonify({"message": "已删除"})


@app.route("/api/groups/<int:group_id>/colors/reorder", methods=["POST"])
@login_required
def reorder_colors(group_id):
    data = request.get_json(force=True)
    ids = data.get("ids", [])
    db = get_db()
    for idx, cid in enumerate(ids):
        db.execute("UPDATE colors SET sort_order = ? WHERE id = ? AND group_id = ?", (idx, cid, group_id))
    db.commit()
    return jsonify({"message": "已排序"})


# ============================================================
# 颜色计算 API
# ============================================================
@app.route("/api/colors/<int:color_id>/schemes")
@login_required
def color_schemes(color_id):
    db = get_db()
    color = db.execute("SELECT * FROM colors WHERE id = ?", (color_id,)).fetchone()
    if not color:
        return jsonify({"error": "颜色不存在"}), 404
    hex_color = color["hex"]
    comp = complementary_color(hex_color)
    triadic = triadic_colors(hex_color)
    return jsonify({
        "hex": hex_color,
        "complementary": comp,
        "triadic": triadic
    })


# ============================================================
# 设置 API
# ============================================================
@app.route("/api/settings", methods=["GET"])
@login_required
def get_settings():
    db = get_db()
    rows = db.execute("SELECT key, value FROM settings").fetchall()
    return jsonify({row["key"]: row["value"] for row in rows})


@app.route("/api/settings", methods=["PUT"])
@admin_required
def update_settings():
    data = request.get_json(force=True)
    for key, value in data.items():
        if key in ("card_width", "card_height", "theme", "auth_required"):
            set_setting(key, value)
    return jsonify({"message": "设置已保存"})


# ============================================================
# 用户管理 API
# ============================================================
@app.route("/api/users", methods=["GET"])
@admin_required
def list_users():
    db = get_db()
    users = db.execute("SELECT id, username, is_admin, totp_enabled, casdoor_sub, created_at FROM users ORDER BY id ASC").fetchall()
    return jsonify([
        {"id": u["id"], "username": u["username"], "is_admin": bool(u["is_admin"]),
         "totp_enabled": bool(u["totp_enabled"]), "casdoor_bound": bool(u["casdoor_sub"]),
         "casdoor_sub": u["casdoor_sub"], "created_at": u["created_at"]}
        for u in users
    ])


@app.route("/api/users", methods=["POST"])
@admin_required
def create_user():
    data = request.get_json(force=True)
    username = data.get("username", "").strip()
    password = data.get("password", "")
    is_admin = 1 if data.get("is_admin") else 0
    if not username or not password:
        return jsonify({"error": "用户名和密码不能为空"}), 400
    if len(password) < 4:
        return jsonify({"error": "密码至少 4 位"}), 400
    db = get_db()
    exists = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if exists:
        return jsonify({"error": "用户名已存在"}), 400
    cur = db.execute(
        "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
        (username, generate_password_hash(password), is_admin)
    )
    db.commit()
    return jsonify({"id": cur.lastrowid, "username": username, "is_admin": bool(is_admin)})


@app.route("/api/users/<int:user_id>", methods=["PUT"])
@admin_required
def update_user(user_id):
    data = request.get_json(force=True)
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        return jsonify({"error": "用户不存在"}), 404

    updates = []
    params = []
    if "username" in data and data["username"].strip():
        new_username = data["username"].strip()
        exists = db.execute("SELECT id FROM users WHERE username = ? AND id != ?", (new_username, user_id)).fetchone()
        if exists:
            return jsonify({"error": "用户名已存在"}), 400
        updates.append("username = ?")
        params.append(new_username)
    if "password" in data and data["password"]:
        if len(data["password"]) < 4:
            return jsonify({"error": "密码至少 4 位"}), 400
        updates.append("password_hash = ?")
        params.append(generate_password_hash(data["password"]))
    if "is_admin" in data:
        updates.append("is_admin = ?")
        params.append(1 if data["is_admin"] else 0)

    if updates:
        params.append(user_id)
        db.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
        db.commit()

        # 如果修改了当前登录用户，更新 session
        if user_id == session.get("user_id") and "username" in data:
            session["username"] = data["username"].strip()

    return jsonify({"message": "已更新"})


@app.route("/api/users/<int:user_id>", methods=["DELETE"])
@admin_required
def delete_user(user_id):
    if user_id == session.get("user_id"):
        return jsonify({"error": "不能删除当前登录用户"}), 400
    db = get_db()
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()
    return jsonify({"message": "已删除"})


# ============================================================
# 2FA API
# ============================================================
@app.route("/api/2fa/setup", methods=["POST"])
@login_required
def twofa_setup():
    user_id = session["user_id"]
    db = get_db()
    secret = pyotp.random_base32()
    db.execute("UPDATE users SET totp_secret = ? WHERE id = ?", (secret, user_id))
    db.commit()

    totp = pyotp.TOTP(secret)
    username = session.get("username", "user")
    provisioning_uri = totp.provisioning_uri(name=username, issuer_name="JokerxColor")

    # 生成二维码
    qr = qrcode.QRCode(version=1, box_size=6, border=2)
    qr.add_data(provisioning_uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_base64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    return jsonify({
        "secret": secret,
        "qr_code": f"data:image/png;base64,{qr_base64}",
        "provisioning_uri": provisioning_uri
    })


@app.route("/api/2fa/verify", methods=["POST"])
@login_required
def twofa_verify():
    data = request.get_json(force=True)
    code = data.get("code", "")
    user_id = session["user_id"]
    db = get_db()
    user = db.execute("SELECT totp_secret FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user or not user["totp_secret"]:
        return jsonify({"error": "请先设置 2FA"}), 400
    totp = pyotp.TOTP(user["totp_secret"])
    if totp.verify(code, valid_window=1):
        db.execute("UPDATE users SET totp_enabled = 1 WHERE id = ?", (user_id,))
        db.commit()
        return jsonify({"message": "双因素认证已启用"})
    return jsonify({"error": "验证码错误"}), 400


@app.route("/api/2fa/disable", methods=["POST"])
@login_required
def twofa_disable():
    data = request.get_json(force=True)
    password = data.get("password", "")
    user_id = session["user_id"]
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "密码错误"}), 400
    db.execute("UPDATE users SET totp_enabled = 0, totp_secret = '' WHERE id = ?", (user_id,))
    db.commit()
    return jsonify({"message": "双因素认证已关闭"})


# ============================================================
# 数据管理 API
# ============================================================
@app.route("/api/data/export")
@admin_required
def export_data():
    db = get_db()
    groups = db.execute("SELECT * FROM groups ORDER BY sort_order ASC").fetchall()
    data = {"groups": [], "settings": {}}
    for group in groups:
        colors = db.execute(
            "SELECT hex, name, sort_order FROM colors WHERE group_id = ? ORDER BY sort_order ASC",
            (group["id"],)
        ).fetchall()
        data["groups"].append({
            "name": group["name"],
            "sort_order": group["sort_order"],
            "colors": [{"hex": c["hex"], "name": c["name"], "sort_order": c["sort_order"]} for c in colors]
        })
    settings = db.execute("SELECT key, value FROM settings").fetchall()
    data["settings"] = {s["key"]: s["value"] for s in settings}
    return jsonify(data)


@app.route("/api/data/import", methods=["POST"])
@admin_required
def import_data():
    data = request.get_json(force=True)
    if "groups" not in data:
        return jsonify({"error": "数据格式不正确"}), 400
    db = get_db()
    # 清空现有数据
    db.execute("DELETE FROM colors")
    db.execute("DELETE FROM groups")
    for group_data in data.get("groups", []):
        cur = db.execute(
            "INSERT INTO groups (name, sort_order) VALUES (?, ?)",
            (group_data.get("name", "未命名"), group_data.get("sort_order", 0))
        )
        group_id = cur.lastrowid
        for color_data in group_data.get("colors", []):
            db.execute(
                "INSERT INTO colors (group_id, hex, name, sort_order) VALUES (?, ?, ?, ?)",
                (group_id, color_data.get("hex", "#000000"), color_data.get("name", ""), color_data.get("sort_order", 0))
            )
    # 导入设置
    if "settings" in data:
        for key, value in data["settings"].items():
            if key in ("card_width", "card_height", "theme"):
                set_setting(key, value)
    db.commit()
    return jsonify({"message": "数据已导入"})


@app.route("/api/data/reset", methods=["POST"])
@admin_required
def reset_data():
    db = get_db()
    db.execute("DELETE FROM colors")
    db.execute("DELETE FROM groups")
    # 恢复默认分组和颜色
    cur = db.execute("INSERT INTO groups (name, sort_order) VALUES (?, 0)", ("默认分组",))
    group_id = cur.lastrowid
    db.execute("INSERT INTO colors (group_id, hex, name, sort_order) VALUES (?, ?, ?, 0)", (group_id, "#00A9E0", "蓝"))
    db.execute("INSERT INTO colors (group_id, hex, name, sort_order) VALUES (?, ?, ?, 1)", (group_id, "#FF003E", "粉"))
    db.commit()
    return jsonify({"message": "已恢复默认数据"})


# ============================================================
# 初始化
# ============================================================
with app.app_context():
    init_db()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 1314))
    app.run(host="0.0.0.0", port=port, debug=False)
