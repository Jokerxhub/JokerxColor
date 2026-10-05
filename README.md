# JokerxColor

一个美观的颜色管理网站，支持分组管理、配色方案、拖拽排序、多主题、用户认证、双因素认证和 Casdoor SSO。

## 功能特性

### 颜色管理
- **默认分组**：内置蓝 `#00A9E0` 和粉 `#FF003E` 两个颜色卡片
- **颜色卡片**：显示 HEX、RGB 代码，一键复制
- **配色方案**：点击色块切换显示互补色和三角配色，点击颜色即可复制 HEX
- **分组管理**：添加、删除（需确认）、重命名、拖拽排序
- **颜色管理**：每个分组独立管理，添加、删除（需确认）、拖拽排序
- **数据持久化**：SQLite 数据库 `data/colors.db`

### 主题
- 亮色主题
- 暗色主题
- 跟随系统

### 设置页面
- **个性化**：自定义卡片宽度/高度滑块，实时预览
- **数据管理**：导出 JSON、导入 JSON、恢复默认数据
- **用户管理**：添加/删除用户、修改用户名密码、默认 admin/admin
- **安全设置**：修改密码、TOTP 双因素认证
- **登录保护**：开启后所有页面需登录才能访问，基于浏览器 Cookie Session

### SSO 单点登录
- 支持 Casdoor 平台对接
- 通过环境变量配置

## 快速开始

### Docker Compose（推荐）

```bash
# 克隆项目
git clone <your-repo-url>
cd JokerxColor

# 复制环境变量配置
cp .env.example .env
# 编辑 .env 修改 SECRET_KEY 等配置

# 启动
docker-compose up -d
```

访问 `http://localhost:1314`

### 使用主机网络模式

编辑 `docker-compose.yaml`，取消注释 `network_mode: "host"` 并注释掉 `ports` 部分：

```yaml
services:
  jokerxcolor:
    # 主机网络模式
    network_mode: "host"
    # ports:
    #   - "1314:1314"
```

### 手动构建 Docker 镜像

```bash
docker build -t jokerxcolor .
docker run -d \
  --name jokerxcolor \
  -p 1314:1314 \
  -v $(pwd)/data:/app/data \
  -e SECRET_KEY=your-secret-key \
  jokerxcolor
```

### 本地开发

```bash
pip install -r requirements.txt
python app.py
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `1314` | 服务端口 |
| `SECRET_KEY` | `dev-secret-key` | Flask 会话密钥，生产环境务必修改 |
| `DATABASE_PATH` | `/app/data/colors.db` | SQLite 数据库路径 |
| `AUTH_REQUIRED` | `false` | 是否要求登录才能访问 |
| `CASDOOR_ENABLED` | `false` | 是否启用 Casdoor SSO |
| `CASDOOR_ENDPOINT` | - | Casdoor 服务地址 |
| `CASDOOR_CLIENT_ID` | - | Casdoor 应用 Client ID |
| `CASDOOR_CLIENT_SECRET` | - | Casdoor 应用 Client Secret |
| `CASDOOR_ORG_NAME` | - | Casdoor 组织名称 |
| `CASDOOR_APP_NAME` | - | Casdoor 应用名称 |
| `CASDOOR_REDIRECT_URI` | - | OAuth 回调地址 |

## 默认账号

- 用户名：`admin`
- 密码：`admin`

> 首次登录后请立即修改密码。

## 数据持久化

数据库文件保存在 `data/colors.db`，通过 Docker volume 挂载：

```yaml
volumes:
  - ./data:/app/data
```

## GitHub Actions

项目内置 `.github/workflows/docker-publish.yml`，推送代码到 `main` 分支或打 tag 时自动构建多架构（amd64/arm64）Docker 镜像并推送到 GitHub Container Registry (ghcr.io)。

镜像地址格式：`ghcr.io/<username>/<repo>:latest`

## 技术栈

- **后端**：Python 3.12 + Flask + Gunicorn
- **数据库**：SQLite
- **前端**：原生 HTML/CSS/JavaScript（无构建依赖）
- **认证**：Session Cookie + Werkzeug 密码哈希
- **2FA**：TOTP (pyotp) + QR Code
- **SSO**：Casdoor OAuth2
- **部署**：Docker + Docker Compose + GitHub Actions

## License

MIT
