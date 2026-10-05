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
| `CASDOOR_REDIRECT_URI` | 自动检测 | OAuth 回调地址，留空自动根据访问地址生成 |

## Casdoor SSO 配置与排查

### 配置步骤

1. 在 Casdoor 中创建应用，获取 `Client ID` 和 `Client Secret`
2. 在 Casdoor 应用的 **Redirect URLs** 中添加：`https://你的域名/auth/casdoor/callback`
3. 在 `.env` 中配置 Casdoor 相关环境变量，`CASDOOR_REDIRECT_URI` 留空即可自动适配
4. 重启容器

### 反向代理（Nginx）配置

通过域名 + HTTPS 访问时，Nginx 必须转发以下头，否则 Flask 无法正确识别外部地址：

```nginx
location / {
    proxy_pass http://127.0.0.1:1314;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 常见问题

**1. SSO 登录后跳回登录页**
- 查看容器日志：`docker-compose logs -f jokerxcolor`，日志中会打印 Casdoor 回调的每一步
- 访问 `/api/auth/casdoor/status` 检查 `redirect_uri` 是否正确（应为 `https://你的域名/auth/casdoor/callback`）
- 确认 Nginx 转发了 `X-Forwarded-Proto` 和 `Host` 头

**2. 域名访问时 Casdoor 页面转圈 / "Casdoor failed to load"**
- 这是 Casdoor 前端资源加载失败，通常因为 Casdoor 服务端的 `origin` 配置与访问域名不一致
- 检查 Casdoor 的 `conf/app.conf` 中 `origin` 字段是否设置为你的 Casdoor 访问地址（如 `https://casdoor.example.com`）
- 确认 Casdoor 前面的反代也正确转发了 `Host` 和 `X-Forwarded-Proto`
- 确保 Casdoor 端点和本应用都使用相同协议（同为 HTTP 或同为 HTTPS），避免混合内容被浏览器拦截

**3. state 不匹配**
- 清除浏览器 Cookie 后重试
- 确认会话 Cookie 未被代理丢弃

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
