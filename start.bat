@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Jokerx颜色代码 数据服务

echo ========================================
echo   Jokerx颜色代码 数据服务
echo ========================================
echo.
echo 工作目录: %CD%
echo.

rem 检测 python 命令（微软商店版 Python 只有 python，没有 py 启动器）
where python >nul 2>&1
if %errorlevel% neq 0 (
  echo [错误] 未找到 python 命令。
  echo.
  echo 如果你安装的是微软商店 Python，请检查：
  echo   1. Windows 设置 - 应用 - 高级应用设置 - 应用执行别名
  echo   2. 确认 python.exe 已开启
  echo   3. 在命令提示符中运行 python --version 确认可用
  echo.
  pause
  exit /b
)

echo Python 路径:
where python
echo.
echo Python 版本:
python --version
echo.
echo 正在启动服务...
echo [提示] 关闭此窗口即停止服务
echo.

python -u server.py

echo.
echo ========================================
echo 服务已退出，退出码: %errorlevel%
echo ========================================
echo.
echo 如果服务意外停止，请把上面的错误信息截图反馈。
echo.
pause
