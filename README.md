# 企业产品图册

同一企业部署的公开 H5 和 PC 内容管理后台。首页、产品目录、品牌案例和联系我们均只展示已发布内容；后台编辑草稿、检查后发布、按版本恢复，和线上访问分开。新部署没有演示产品、示例二维码或默认密码。

| 入口 | 用途 |
| --- | --- |
| `/`、`/catalog`、`/cases`、`/contact` | 公开 H5；产品、案例支持独立详情链接 |
| `/admin/` | 企业账号登录；产品、案例、固定页面配置、发布、历史与账号治理 |
| `/preview?id=…&revision=…` | 仅当前有编辑权的用户可读取已保存的指定修订 |
| `/health/ready` | 检查 API 能否访问当前迁移版本的数据库 |

## 在 PyCharm 中启动

直接打开**仓库根目录**（同一层有 `main.py`、`pyproject.toml` 和 `frontend/`），无需设置额外的 Sources Root 或 `PYTHONPATH`，也不需要 PowerShell 启动脚本。

1. 在 PyCharm 选择 Python **3.12+** 的项目解释器。Windows 上已有项目环境时，选择**已有解释器** `.venv\Scripts\python.exe`；如果依赖已装好，直接进行第 2 步。仅新建环境时，从使用该解释器的终端在仓库根安装依赖：

   ```sh
   python -m pip install -e ".[test]"
   ```

2. 配置本机的 MySQL 和 TLS。已有 `.local/showcase/` 私有配置时直接复用；新机器可在 PyCharm 的 **Run/Debug Configuration → Environment variables** 中指定下表的值。不要把真实值写入代码、共享运行配置或 Git。

   | 配置 | 本地运行时的取值 |
   | --- | --- |
   | 数据库 | 优先使用 `DATABASE_URL`（`mysql+pymysql`）；否则从 `SHOWCASE_DATABASE_URL_FILE` 指定的文件读取，默认 `.local/showcase/database.url` |
   | 素材目录 | `ASSET_ROOT`，默认 `.local/showcase/media` |
   | HTTPS 证书与私钥 | `SHOWCASE_TLS_CERT_FILE`、`SHOWCASE_TLS_KEY_FILE`，默认 `.local/showcase/tls.crt`、`.local/showcase/tls.key`；使用覆盖 `localhost` 的有效证书 |

3. 右键根目录的 [main.py](main.py)，选 **Run** 或 **Debug**。本机入口仅监听 `127.0.0.1:5144`：访问 [H5](https://localhost:5144/)、[管理后台](https://localhost:5144/admin/) 或[就绪检查](https://localhost:5144/health/ready)。只在你运行文件时读取本机配置并开始监听；导入 `main:app` 不读取本机秘密、不连库、不启动服务。点击运行不会启动 MySQL、执行迁移或创建账号。

H5 和管理后台沿用同源 HTTPS，保留安全 Cookie、Origin 与 CSRF 校验。首次需要页面时先按下方说明构建前端；产物不存在时页面会提示构建，但不吞掉 `/api` 或 `/health` 的响应。部署时 ASGI 入口也是 `main:app`，由 Caddy 提供 HTTPS 与静态页面，不使用本地证书和调试启动器。

## 后端结构

| 位置 | 职责 |
| --- | --- |
| `main.py`、`app/application.py` | PyCharm/ASGI 入口与应用装配；集中注册路由、错误处理和私有缓存策略 |
| `app/controllers/` | HTTP 参数、依赖和响应；`admin/` 与 `public/` 分别提供后台和匿名入口 |
| `app/services/` | 草稿、发布、恢复、权限、素材等业务规则和事务；每款发布在一个事务里完成 |
| `app/repositories/` | SQLAlchemy 查询、持久化和行锁；不自行提交或回滚 |
| `app/models/`、`app/schemas/` | 同一 SQLAlchemy Base 下的实体/约束；Pydantic 接口数据结构 |
| `app/core/`、`app/cli/` | 配置、数据库会话、通用错误；显式的离线管理命令 |
| `migrations/`、`tests/` | Alembic 版本历史、后端回归测试；Vue 视图仍在 `frontend/` |

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

对于**新部署**，为迁移命令显式设置 `DATABASE_URL` 指向本实例专属数据库，然后从项目根执行以下步骤。已有数据库不要重复初始化首管；开发机已有最新迁移时无需重建任何表。

```sh
python -m alembic -c alembic.ini upgrade head
python -m app.cli.bootstrap <管理员登录名>
```

首管理员通过隐藏输入设置临时密码，首次登录需要改密。管理员身份本身不授予编辑或发布权限。

后端测试均从仓库根目录运行，按环境选择：

- **不连接数据库**：验证入口、分层、接口契约和交付预检。

  ```sh
  python -m pytest tests/test_project_entry.py tests/test_layer_contract.py tests/test_api_contract.py tests/test_http_boundaries.py tests/test_delivery_preflight.py
  ```

- **本机回归**：需要 Bash、GnuPG，以及已迁移的可丢弃回环 MySQL。将 `FP_TEST_DATABASE_URL` 指向满足 [tests/conftest.py](tests/conftest.py) 隔离条件的专用测试库，绝不能指向企业库。下面的命令只排除 Docker 环境检查和真实异机恢复验收，仍会运行本机恢复预检。

  ```sh
  python -m pytest tests -k "not test_docker_runtime_prerequisite and (not test_clean_host or rejects_aliases_before_any_network)"
  ```

- **完整验收**：除本机回归条件外，还需要 Docker CLI，以及由 `FP_RECOVERY_ACCEPTANCE_MANIFEST` 指定的已获准验收清单。测试会核对恢复证据，并访问清单中的源站、恢复站和第二企业 HTTPS 站点。

  ```sh
  python -m pytest tests
  ```

HTTPS 分流、显式迁移、备份和安全恢复见 [部署运行说明](deploy/runbook.md)。
