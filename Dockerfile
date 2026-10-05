FROM python:3.12-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 创建数据目录
RUN mkdir -p /app/data

# 环境变量默认值
ENV FLASK_APP=app.py
ENV FLASK_ENV=production
ENV PORT=1314

EXPOSE 1314

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:1314/healthz')" || exit 1

# 使用 gunicorn 运行
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-1314} --workers 2 --threads 4 --timeout 120 app:app"]
