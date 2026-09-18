#!/usr/bin/env python3
"""Jokerx颜色代码 —— 本地数据服务（SQLite 版）

让页面可以把分组与颜色实时保存到本地数据库，
不再依赖浏览器本地存储（无痕模式 / 换系统数据也不会丢失）。

用法（任选其一）：
  Windows：双击 start.bat
  Mac/Linux：在终端运行 ./start.sh 或 python3 server.py
然后浏览器打开 http://127.0.0.1:1314 即可。
按 Ctrl+C 停止服务。
"""
import json
import os
import sqlite3
import sys
import webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_FILE = os.path.join(DATA_DIR, "colors.db")
LEGACY_JSON_FILE = os.path.join(DATA_DIR, "colors.json")

# 首次运行时若数据库不存在，会用这份默认数据初始化。
# 之后所有分组和颜色都保存在 SQLite 数据库里。
DEFAULT_DATA = {
    "app": "jokerx-color-codes",
    "version": 2,
    "groups": [
        {
            "name": "默认组",
            "colors": [
                {"name": "蓝", "hex": "#00A9E0"},
                {"name": "粉", "hex": "#FF003E"},
            ],
        }
    ],
    "active": 0,
}


def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = get_db()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS colors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                hex TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        """)

        # 检查是否已有数据
        row = conn.execute("SELECT COUNT(*) as cnt FROM groups").fetchone()
        if row["cnt"] == 0:
            # 首次初始化：先尝试从旧版 colors.json 迁移
            migrated = migrate_from_json(conn)
            if not migrated:
                # 没有旧数据，写入默认数据
                save_all(conn, DEFAULT_DATA)

        conn.commit()
    finally:
        conn.close()


def migrate_from_json(conn):
    """从旧版 colors.json 迁移数据到 SQLite，成功返回 True"""
    if not os.path.exists(LEGACY_JSON_FILE):
        return False
    try:
        with open(LEGACY_JSON_FILE, encoding="utf-8") as f:
            data = json.load(f)
        if not data or "groups" not in data or not isinstance(data["groups"], list):
            return False
        save_all(conn, data)
        print("[迁移] 已从 colors.json 导入数据到 SQLite")
        return True
    except Exception as e:
        print("[迁移] 读取 colors.json 失败:", e)
        return False


def load_all():
    """从 SQLite 读取所有分组和颜色，返回 API 格式"""
    conn = get_db()
    try:
        groups = []
        rows = conn.execute(
            "SELECT id, name FROM groups ORDER BY sort_order, id"
        ).fetchall()
        for g in rows:
            color_rows = conn.execute(
                "SELECT name, hex FROM colors WHERE group_id = ? ORDER BY sort_order, id",
                (g["id"],),
            ).fetchall()
            groups.append({
                "name": g["name"],
                "colors": [{"name": c["name"], "hex": c["hex"]} for c in color_rows],
            })

        meta_row = conn.execute(
            "SELECT value FROM meta WHERE key = 'active'"
        ).fetchone()
        active = int(meta_row["value"]) if meta_row else 0
        if active < 0 or active >= len(groups):
            active = 0

        return {
            "app": "jokerx-color-codes",
            "version": 2,
            "groups": groups,
            "active": active,
        }
    finally:
        conn.close()


def save_all(conn, data):
    """全量保存：清空现有数据后写入新数据"""
    groups = data.get("groups", [])
    active = data.get("active", 0)

    # 清空旧数据
    conn.execute("DELETE FROM colors")
    conn.execute("DELETE FROM groups")
    conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('groups','colors')")

    # 写入新数据
    for gi, g in enumerate(groups):
        cur = conn.execute(
            "INSERT INTO groups (name, sort_order) VALUES (?, ?)",
            (g.get("name", "未命名"), gi),
        )
        group_id = cur.lastrowid
        for ci, c in enumerate(g.get("colors", [])):
            conn.execute(
                "INSERT INTO colors (group_id, name, hex, sort_order) VALUES (?, ?, ?, ?)",
                (group_id, c.get("name", "颜色"), c.get("hex", "#000000"), ci),
            )

    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('active', ?)",
        (str(active),),
    )


def write_data(raw):
    """POST /api/data 调用：全量覆盖写入"""
    payload = json.loads(raw.decode("utf-8"))
    conn = get_db()
    try:
        save_all(conn, payload)
        conn.commit()
    finally:
        conn.close()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        # 静态文件加 1 小时浏览器缓存，刷新时不重复下载
        if urlparse(self.path).path != "/api/data":
            self.send_header("Cache-Control", "public, max-age=3600")
        super().end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/api/data":
            try:
                data = json.dumps(load_all(), ensure_ascii=False).encode("utf-8")
            except Exception as exc:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(("data error: %s" % exc).encode("utf-8"))
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path == "/api/data":
            try:
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length)
                write_data(raw)
            except Exception as exc:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(("bad data: %s" % exc).encode("utf-8"))
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[server] %s\n" % (fmt % args))


def main():
    # 统一用 UTF-8 输出（start.bat 中已 chcp 65001 切换控制台为 UTF-8）
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    try:
        init_db()
    except Exception as exc:
        print("[错误] 无法初始化数据库:", exc)
        print("  数据库路径:", DB_FILE)
        print("  可能原因：当前文件夹没有写入权限，或在压缩包内直接运行（请先解压）。")
        print()
        try:
            input("按回车键退出...")
        except Exception:
            pass
        sys.exit(1)

    print("Python 路径:", sys.executable)
    print("Python 版本:", sys.version.split()[0])
    print("工作目录:", os.getcwd())
    print("数据库文件:", DB_FILE)
    print()

    port = 1314
    httpd = None
    for p in range(port, port + 10):
        try:
            httpd = ThreadingHTTPServer(("0.0.0.0", p), Handler)
            port = p
            break
        except OSError:
            continue
    if httpd is None:
        print("[错误] 端口 1314-1323 均被占用，请关闭占用程序后重试。")
        try:
            input("按回车键退出...")
        except Exception:
            pass
        sys.exit(1)

    url = "http://127.0.0.1:%d/" % port
    print("=" * 56)
    print("  Jokerx颜色代码 数据服务已启动")
    print("  请在浏览器打开: %s" % url)
    print("  数据库: data/colors.db (SQLite)")
    print("  关闭此窗口或按 Ctrl+C 停止服务")
    print("=" * 56)
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
        httpd.server_close()


if __name__ == "__main__":
    main()
