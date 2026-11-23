# 本机开发命令。在仓库根目录执行 make。
# 数据库连接和证书留在 .local/showcase/，不要写进本文件或 Git。
# 启动后端不会自动迁移，也不会打包前端。

ifeq ($(OS),Windows_NT)
PY := .venv/Scripts/python.exe
else
PY := .venv/bin/python
endif

# 优先使用已设置的 DATABASE_URL，否则读取本机连接文件，再执行后续参数。不打印连接串。
WITH_DB = $(PY) -c "import os,sys,subprocess,pathlib; root=pathlib.Path('.').resolve(); url=os.environ.get('DATABASE_URL','').strip(); raw=os.environ.get('SHOWCASE_DATABASE_URL_FILE'); path=pathlib.Path(raw) if raw else root/'.local'/'showcase'/'database.url'; path=path if path.is_absolute() else root/path; url=url or (path.read_text(encoding='utf-8-sig').strip() if path.is_file() else ''); os.environ['DATABASE_URL']=url or sys.exit('DATABASE_URL is unset and .local/showcase/database.url cannot be read'); raise SystemExit(subprocess.call([sys.executable]+sys.argv[1:]))"

.DEFAULT_GOAL := help
.PHONY: help serve db-upgrade db-current db-history db-revision bootstrap seed-weitai web-install web-admin web-h5 web-build

help:
	@echo 后端
	@echo   make serve                          启动本机入口 https://127.0.0.1:5144/
	@echo 数据库
	@echo   make db-upgrade                     迁移到最新版本
	@echo   make db-current                     查看当前版本
	@echo   make db-history                     查看迁移历史
	@echo   make db-revision MSG=说明           新建迁移脚本，不执行
	@echo   make bootstrap LOGIN=登录名         仅空库创建首个管理员，口令交互输入
	@echo   make seed-weitai                    初始化微肽目录、案例分类和联系文案
	@echo 前端
	@echo   make web-install                    安装依赖
	@echo   make web-admin                      启动管理端 http://127.0.0.1:5173/admin/
	@echo   make web-h5                         启动公开 H5 http://127.0.0.1:5174/
	@echo   make web-build                      打包管理端和 H5

serve:
	@echo 启动后端 https://127.0.0.1:5144/
	@$(PY) main.py

db-upgrade:
	@echo 迁移到最新版本
	@$(WITH_DB) -m alembic -c alembic.ini upgrade head

db-current:
	@$(WITH_DB) -m alembic -c alembic.ini current

db-history:
	@$(WITH_DB) -m alembic -c alembic.ini history

db-revision:
	$(if $(MSG),,$(error 用法: make db-revision MSG=变更说明))
	@echo 新建迁移脚本，不会执行
	@$(WITH_DB) -m alembic -c alembic.ini revision -m "$(MSG)"

bootstrap:
	$(if $(LOGIN),,$(error 用法: make bootstrap LOGIN=管理员登录名))
	@$(WITH_DB) -m app.cli.bootstrap "$(LOGIN)"

seed-weitai:
	@echo 初始化微肽内容。已发布的配置会跳过，不会改账号权限
	@$(WITH_DB) -m app.cli.seed_weitai

web-install:
	npm ci --prefix frontend

web-admin:
	@echo 管理端 http://127.0.0.1:5173/admin/
	npm --prefix frontend/admin run dev -- --host 127.0.0.1 --port 5173

web-h5:
	@echo 公开 H5 http://127.0.0.1:5174/
	npm --prefix frontend/h5 run dev -- --host 127.0.0.1 --port 5174

web-build:
	npm --prefix frontend run build
