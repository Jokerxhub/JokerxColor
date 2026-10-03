import os
import json
import sqlite3
from functools import wraps
from datetime import datetime, timezone
from pathlib import Path

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
app.config["SESSION_COOKIE_SAMESITE"] = os.getenv("SESSION_COOKIE_SAMESITE", "Lax")
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
    conn = sqlite3.connect(DB_PATH)
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


def valid_hex(value):
    if not isinstance(value, str):
        return False
    v = value.strip().upper()
    if len(v) != 7 or not v.startswith("#"):
        return False
    try:
        int(v[1:], 16)
        return True
    except ValueError:
        return False


def normalize_hex(value):
    return value.strip().upper()


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
        conn.execute("UPDATE groups SET sort_order=? WHERE id=?", (order, gid))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.post("/api/colors")
@auth_required
def add_color():
    payload = request.get_json(silent=True) or {}
    gid = payload.get("group_id")
    color = normalize_hex(str(payload.get("hex", "")))
    name = str(payload.get("name", "")).strip()
    if not isinstance(gid, int) or not valid_hex(color):
        return jsonify({"error": "group_id 或 HEX 无效"}), 400

    conn = db()
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
    if not isinstance(gid, int) or not isinstance(ids, list):
        return jsonify({"error": "参数无效"}), 400
    conn = db()
    for order, cid in enumerate(ids):
        conn.execute(
            "UPDATE colors SET sort_order=? WHERE id=? AND group_id=?",
            (order, cid, gid),
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
        conn.execute("BEGIN")
        conn.execute("DELETE FROM colors")
        conn.execute("DELETE FROM groups")
        for gi, g in enumerate(groups):
            name = str(g.get("name", "")).strip() or f"分组 {gi+1}"
            cur = conn.execute(
                "INSERT INTO groups(name,sort_order,created_at) VALUES(?,?,?)",
                (name, gi, utcnow()),
            )
            gid = cur.lastrowid
            colors = g.get("colors", [])
            if isinstance(colors, list):
                for ci, c in enumerate(colors):
                    hx = normalize_hex(str(c.get("hex", "")))
                    if valid_hex(hx):
                        cname = str(c.get("name", "")).strip() or hx
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
    redirect_uri = OIDC_REDIRECT_URI or url_for("auth_callback", _external=True)
    return oauth.oidc.authorize_redirect(redirect_uri)


@app.get("/auth/callback")
def auth_callback():
    if not OIDC_ENABLED or not oauth:
        return redirect("/")
    token = oauth.oidc.authorize_access_token()
    userinfo = token.get("userinfo")
    if not userinfo:
        try:
            userinfo = oauth.oidc.userinfo()
        except Exception:
            userinfo = {}
    session["user"] = {
        "sub": userinfo.get("sub"),
        "name": userinfo.get("name") or userinfo.get("preferred_username") or userinfo.get("email") or "User",
        "email": userinfo.get("email", ""),
    }
    return redirect("/")


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
