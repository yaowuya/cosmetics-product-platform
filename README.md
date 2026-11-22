# 企业产品图册

同一企业部署的公开 H5 和 PC 内容管理后台。首页、产品目录、品牌案例和联系我们均只展示已发布内容；后台编辑草稿、检查后发布、按版本恢复，和线上访问分开。新部署没有演示产品、示例二维码或默认密码。

| 入口 | 用途 |
| --- | --- |
| `/`、`/catalog`、`/cases`、`/contact` | 公开 H5；产品、案例支持独立详情链接 |
| `/admin/` | 企业账号登录；产品、案例、固定页面配置、发布、历史与账号治理 |
| `/preview?id=…&revision=…` | 仅当前有编辑权的用户可读取已保存的指定修订 |
| `/health/ready` | 检查 API 能否访问当前迁移版本的数据库 |

## 构建和验证

前端在 Node 24 和 npm 工作区验证。若使用 Node 22，请使用 22.18+，以便直接运行导入 TypeScript 的 Node 测试。后端使用 Python 3.12+、FastAPI、SQLAlchemy 2、Alembic 和 MySQL 8 / InnoDB（数据库需实际执行 CHECK 约束）。

```sh
npm ci --prefix frontend
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix frontend test
```

构建得到 `frontend/h5/dist/build/h5/` 和 `frontend/admin/dist/`。前端的构建产物测试需要先完成构建。H5 和后台都从部署的同一 HTTPS 来源访问 `/api`；生产配置不能用静态原型或本地模拟接口顶替。

H5 另有只读的 Chrome 控件回归：在已发布多张海报、目录分类和至少两个案例筛选项的**本机验收实例**上运行 `node frontend/tests/h5-controls.e2e.mjs <本机 HTTPS 来源>`。复用已安装的 Chrome 和 Playwright；若 Playwright 不在项目解析路径，使用 `PLAYWRIGHT_MODULE` 指向已有模块。该检查验证真实按钮的点击区域、选中态及键盘操作，不创建测试内容，也不代替真机验收。

在隔离的虚拟环境安装后端；`DATABASE_URL` 指向本实例专属的 `mysql+pymysql` 数据库，`ASSET_ROOT` 指向独立的可写持久目录。连接串、口令和证书放在环境或部署 secrets，不写入仓库。

```sh
python -m pip install -e "./backend[test]"
python -m alembic -c backend/alembic.ini upgrade head
python -m app.bootstrap <管理员登录名>
```

首管理员通过隐藏输入设置临时密码，首次登录需要改密。管理员身份本身不授予编辑或发布权限。后端测试只允许专用的回环 MySQL 测试库；不要指向企业库。`backend/tests/conftest.py` 列出 `FP_TEST_DATABASE_URL` 的限制。Docker 部署和第二企业／干净主机恢复属于独立的环境验收，不可用本机冒烟结果代替。

HTTPS 分流、显式迁移、备份和安全恢复见 [部署运行说明](deploy/runbook.md)。
