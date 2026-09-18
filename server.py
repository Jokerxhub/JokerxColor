#!/usr/bin/env python3
"""Jokerx颜色代码 —— 本地数据服务

让页面可以把分组与颜色实时保存到 data/colors.json 文件，
不再依赖浏览器本地存储（无痕模式 / 换系统数据也不会丢失）。

用法（任选其一）：
  Windows：双击 start.bat
  Mac/Linux：在终端运行 ./start.sh 或 python3 server.py
然后浏览器打开 http://127.0.0.1:1314 即可。
按 Ctrl+C 停止服务。
"""
import json
import os
import sys
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_FILE = os.path.join(DATA_DIR, "colors.json")

# 首次运行时若 data/colors.json 不存在，会用这份默认数据创建。
# 之后请直接编辑 data/colors.json 管理默认内容（js/data.js 仅作前端兜底）。
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


def ensure_data_file():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_DATA, f, ensure_ascii=False, indent=2)


def read_data():
    ensure_data_file()
    with open(DATA_FILE, encoding="utf-8") as f:
        return f.read()


def write_data(raw):
    payload = json.loads(raw.decode("utf-8"))
    ensure_data_file()
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_GET(self):
        if urlparse(self.path).path == "/api/data":
            try:
                body = read_data()
            except Exception as exc:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(("data error: %s" % exc).encode("utf-8"))
                return
            data = body.encode("utf-8")
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
        ensure_data_file()
    except Exception as exc:
        print("[错误] 无法初始化数据文件:", exc)
        print("  数据文件路径:", DATA_FILE)
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
    print("数据文件:", DATA_FILE)
    print()

    port = 1314
    httpd = None
    for p in range(port, port + 10):
        try:
            httpd = HTTPServer(("0.0.0.0", p), Handler)
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
    print("  数据文件: data/colors.json")
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
