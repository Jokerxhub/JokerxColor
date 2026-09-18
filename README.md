# Jokerx颜色代码

按分组管理颜色的本地小工具：长方形色块 + HEX/RGB 双格式一键复制。

## 本地启动（Python 版）

双击 `start.bat`（Windows）或 `start.sh`（Mac/Linux），
会自动打开浏览器访问 `http://127.0.0.1:1314`。

> 需要电脑已安装 Python 3（Windows 安装时勾选 "Add Python to PATH"）。

## Docker 部署（推荐）

### 方式一：docker compose 一键启动

```bash
docker compose up -d
```

访问 `http://你的服务器IP:1314`。

数据通过 `./data` 目录挂载持久化，容器重建不丢数据。

### 方式二：直接拉取 GitHub Actions 自动构建的镜像

每次 push 到 `main` 分支，GitHub Actions 会自动构建镜像并推送到 GHCR。

```bash
docker run -d \
  --name jokerx-color-codes \
  -p 1314:1314 \
  -v ./data:/app/data \
  --restart unless-stopped \
  ghcr.io/<你的GitHub用户名>/<仓库名>:latest
```

> 镜像名中的 `<你的GitHub用户名>/<仓库名>` 以你仓库实际路径为准，
> 可在 GitHub 仓库首页右侧 "Packages" 里找到完整地址。

### 更新镜像

```bash
docker compose pull && docker compose up -d
```

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面结构 |
| `css/style.css` | 全部样式 |
| `js/app.js` | 交互逻辑（读写数据库） |
| `js/data.js` | 兜底默认数据（页面打不开服务时使用） |
| `fonts/` | 本地字体文件（Noto Sans SC） |
| `data/colors.db` | **SQLite 数据库**，分组与颜色数据存储在这里 |
| `server.py` | 本地数据服务（Python 标准库 + SQLite，无需安装依赖） |
| `start.bat` / `start.sh` | Python 版一键启动 |
| `Dockerfile` | Docker 镜像构建文件 |
| `docker-compose.yml` | docker compose 编排 |
| `.github/workflows/docker-publish.yml` | GitHub Actions 自动构建推送 |

## 数据说明

- 所有分组与颜色保存在 `data/colors.db`（SQLite 数据库），不依赖浏览器本地存储，
  无痕模式、换系统/换浏览器都不会丢。
- 换电脑时，把整个文件夹复制过去即可（关键是 `data/colors.db`）。
- 首次从旧版升级时，会自动从 `colors.json` 迁移数据到 SQLite，然后使用数据库存储。
- 页脚「导出数据 / 导入数据」可用于手动备份与恢复。

## 直接双击 index.html 会怎样？

页面顶部会提示「数据服务未启动」：纯静态页面无法写入本地文件，
请按上面方式启动服务后通过 `http://127.0.0.1:1314` 使用。
