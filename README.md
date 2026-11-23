# 企业产品图册

`cosmetics-product-platform` 是给同一家企业用的产品图册。外面是公开 H5，里面是 PC 管理后台。首页、产品目录、品牌案例和联系我们只展示已发布内容。后台编辑草稿、检查后发布、按版本恢复，和线上访问分开。

新部署没有演示产品、示例二维码或默认密码。项目名、线上 API 容器名和数据库名都是 `cosmetics-product-platform`。

| 入口 | 用途 |
| --- | --- |
| `/`、`/catalog`、`/cases`、`/contact` | 公开 H5；产品和案例可以有独立详情链接 |
| `/admin/` | 企业账号登录；编辑、检查、发布、历史和账号治理 |
| `/preview?id=…&revision=…` | 只有当前有编辑权的人能看已保存的指定修订 |
| `/health/ready` | 检查 API 能否访问当前迁移版本的数据库 |

后端是 Python 3.12、FastAPI、SQLAlchemy 2、Alembic 和 MySQL 8。前端是 Vue：H5 用 uni-app，管理端用 Vite。线上在仓库根目录用 Compose 启动。API 不对外发布端口；5000 提供 H5，5001 提供管理后台，两边都走同源 HTTPS。

本地怎么跑、线上怎么拉代码和手动启动，见 [开发部署手册](docs/开发部署手册.md)。
