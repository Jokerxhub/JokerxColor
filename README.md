# Jokerx颜色代码

按分组管理颜色的本地小工具：长方形色块 + HEX/RGB 双格式一键复制。

## 启动方式

双击 `start.bat`（Windows）或 `start.sh`（Mac/Linux），
会自动打开浏览器访问 `http://localhost:8000`。

> 需要电脑已安装 Python 3（Windows 安装时勾选 "Add Python to PATH"）。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面结构 |
| `css/style.css` | 全部样式 |
| `js/app.js` | 交互逻辑（读写数据文件） |
| `js/data.js` | 兜底默认数据（页面打不开服务时使用） |
| `data/colors.json` | **分组与颜色数据**，新增/修改实时写到这里 |
| `server.py` | 本地数据服务（Python 标准库，无需安装依赖） |
| `start.bat` / `start.sh` | 一键启动 |

## 数据说明

- 所有分组与颜色保存在 `data/colors.json`，不依赖浏览器本地存储，
  无痕模式、换系统/换浏览器都不会丢。
- 换电脑时，把整个文件夹复制过去即可（关键是 `data/colors.json`）。
- 首次从旧版升级时，若浏览器里存有旧数据，会自动迁移写入文件并清除浏览器存储。
- 页脚「导出数据 / 导入数据」可用于手动备份与恢复。

## 直接双击 index.html 会怎样？

页面顶部会提示「数据服务未启动」：纯静态页面无法写入本地文件，
请按上面方式启动服务后通过 `http://localhost:8000` 使用。
