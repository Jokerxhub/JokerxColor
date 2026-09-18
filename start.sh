#!/usr/bin/env bash
# Jokerx颜色代码 启动脚本（macOS / Linux）
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
  exec python3 server.py
elif command -v python >/dev/null 2>&1; then
  exec python server.py
else
  echo "未检测到 Python，请先安装 Python 3：https://www.python.org/downloads/"
  exit 1
fi
