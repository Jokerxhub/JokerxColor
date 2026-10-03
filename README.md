# JokerxColor

一个轻量、可自部署的颜色管理网站。

## 功能

- 默认分组：蓝 `#00A9E0`、粉 `#FF003E`
- HEX / RGB 一键复制
- 点击卡片显示互补色 / 三角配色
- 配色结果可以直接点击复制 HEX
- 分组：新增、删除确认、重命名、拖动排序
- 颜色：新增、删除确认、编辑、拖动排序
- SQLite 持久化：`data/colors.db`
- 亮色 / 暗色 / 跟随系统
- 卡片尺寸滑块
- JSON 导入 / 导出
- 恢复默认数据
- OIDC / OAuth2，可对接 Casdoor
- Docker / docker-compose
- GitHub Actions 自动发布 GHCR 镜像

## 本地运行

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

访问：

```text
http://localhost:1314
```

## Docker

复制环境变量：

```bash
copy .env.example .env
```

启动：

```bash
docker compose up -d --build
```

访问：

```text
http://localhost:1314
```

SQLite 位于容器：

```text
/app/data/colors.db
```

通过 compose volume `jokerxcolor_data` 持久化。

## Casdoor / OIDC

在 Casdoor 创建 OIDC 应用后，将：

```env
OIDC_ENABLED=true
OIDC_ISSUER=http://你的-Casdoor地址
OIDC_CLIENT_ID=你的-client-id
OIDC_CLIENT_SECRET=你的-client-secret
OIDC_REDIRECT_URI=http://你的-JokerxColor地址/auth/callback
```

填入 `.env`。

如果 JokerxColor 和 Casdoor 都在同一个 Docker network，也可以使用：

```env
OIDC_ISSUER=http://casdoor:8000
```

注意：浏览器不能直接访问 `casdoor:8000`，这里是 JokerxColor 容器访问 Casdoor 的内部地址；OIDC 的最终 redirect URI 应使用浏览器实际访问 JokerxColor 的地址。

生产环境请务必修改：

```env
SECRET_KEY=一个足够长的随机字符串
```

## GitHub Container Registry

推送到 GitHub 后，Actions 会构建并发布：

```text
ghcr.io/<你的GitHub用户名>/jokerxcolor
```

默认分支会发布 `latest`，Git tag `v1.0.0` 等会发布对应 tag。
