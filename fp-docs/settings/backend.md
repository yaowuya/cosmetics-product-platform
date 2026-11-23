# FeaturePilot Backend Settings

`backend/` 是单企业实例使用的 FastAPI 服务。开发和验证使用本项目实际的 Python、SQLAlchemy、Alembic 和 MySQL 约定，不套用 Django 规范。

## Backend Framework and Source Locations

依赖见 `backend/pyproject.toml`：Python 3.12+、FastAPI `>=0.115,<1`、SQLAlchemy 2.0 和 Alembic。应用入口是 `backend/app/main.py`；业务代码、迁移和测试分别在 `backend/app/`、`backend/migrations/` 和 `backend/tests/`。

## Code Standards

- Built-in preset: `none`
- Rule resources: N/A
- Applies to: `backend`；FastAPI `>=0.115,<1`。直接依赖见 `backend/pyproject.toml`，实际启动入口见 `backend/app/main.py`。
- Project rule sources: `README.md` 的“构建和验证”，适用于运行时与数据库版本、显式迁移、持久目录、凭据处理和回环测试库隔离。
- Confirmed overrides: none

## API / Service / Data Patterns

以 `backend/app/main.py` 的路由和异常处理为准。SQLAlchemy 模型在 `backend/app/models.py`；数据库结构通过 `backend/migrations/versions/` 的 Alembic 迁移演进。不要用应用启动建表代替显式迁移。

## Auth / Permissions / Isolation

公开内容只展示已发布版本。预览要求当前账号对指定修订有编辑权限。管理员身份本身不授予编辑或发布权限。每个企业实例使用独立的数据库、素材目录和密钥；连接串、口令、私钥不写入 Git 或日志。

## Jobs / Operations / Observability

`/health/ready` 用于核对数据库及迁移状态。部署、停写备份和空目标恢复的条件见 `deploy/runbook.md`。未登记后台任务框架。

## Backend Validation Expectations

在隔离环境安装 `backend[test]` 后，将 `DATABASE_URL` 和 `FP_TEST_DATABASE_URL` 指向同一个新建的可丢弃测试库。先核对它满足 `backend/tests/conftest.py` 的限制：回环 MySQL 8.0+、非默认端口、`fp_test` 用户以及 `fp_*_test` 命名。确认后从仓库根运行 `python -m alembic -c backend/alembic.ini upgrade head`，再运行 `python -m pytest backend/tests`。不得使用企业数据库，SQLite 或 MariaDB 不能代替该项验证。

`test_docker_runtime_prerequisite` 和 `test_clean_host` 分别检查 Docker 部署前提与获准的跨主机恢复证据。没有对应环境时，报告这两项的实际结果，不把本机测试当作交付验收。

## Unknowns

本地测试不能证明部署主机的 TLS、第二企业隔离或异机恢复已验收。
