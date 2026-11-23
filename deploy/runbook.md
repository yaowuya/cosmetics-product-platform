# 单企业部署与恢复运行说明

本文件是交付配置，不是远端操作日志。只在获准的 Ubuntu、Docker Compose 和企业隔离目录中使用。秘密、口令和证书不写入本文件。

## 端口、证书和秘密

- 对外只监听同源 HTTPS。H5 用 `SHOWCASE_HTTPS_PORT`，默认 `5000`；管理端用 `SHOWCASE_ADMIN_HTTPS_PORT`，默认 `5001`。两个端口都反代同源 `/api`，不把任一端口当作数据库或裸 API。
- 配置对应 TLS 证书与私钥文件，文件经 Compose secrets 只读挂载。反代来源写在 `.env` 的 `SHOWCASE_FORWARDED_ALLOW_IPS`，只信任编排网络里的网关和反代，不填 `*`。
- 反代先分流 `/api/**` 和 `/health/ready`，再按端口服务 H5 或 `/admin/`。API 容器名是 `cosmetics-product-platform`，不发布端口。数据库使用已获准的主机 MySQL，编排不另起数据库容器，也不发布 `3306`。
- 用独立的 `SHOWCASE_DB_DIR`、`SHOWCASE_ASSET_DIR`、数据库账号、密钥和容器项目。素材目录由 UID 10001 写入。`SHOWCASE_DATABASE_URL_FILE` 通过秘密挂载提供 `mysql+pymysql` DSN，不能写进 Compose、Git 或操作日志。用已构建的 `frontend/h5/dist/build/h5`、`frontend/admin/dist` 路径提供两端静态产物。

## 显式迁移和首次管理员

先验证 Compose 展开结果、卷、端口和镜像 ID。主机库就绪后显式运行 Alembic，然后以一次性管理员命令打开后台；应用启动不会自动建表。登录名和初始口令放在仓库根目录的 `.env`，启动时加载；没有这两项时，口令才从隐藏提示输入。路径和秘密文件用环境变量传入，不写进 Compose。

日常启动和更新见 [开发部署手册](../docs/开发部署手册.md)。在仓库根目录执行：

```sh
docker compose config --quiet
docker compose run --rm api alembic -c alembic.ini upgrade head
docker compose run --rm api python -m app.cli.bootstrap "$ADMIN_LOGIN"
docker compose up -d
```

`/health/ready` 只返回就绪与否，不显示数据库地址或错误详情。核对后端和静态入口的兼容窗口，先部署兼容 API，再更新前端。版本回退在 schema 仍兼容时才只退镜像；否则先隔离写入并恢复匹配的库、图片和镜像。

## 同一恢复点的异机备份

应用是线上唯一写入方。备份前停入口并排空 API 写入；库和已登记的素材放在同一停写窗口，记录 Alembic 版本、镜像 ID 和 UTC 时间。脚本签名与加密前逐文件做 SHA-256 后恢复原先运行的服务。GPG 公私钥预先获批，使用明确的签名者和恢复者指纹。目的文件是加密包，不在项目内。只有获准后才把它传到异机存储。

```sh
bash deploy/backup.sh --project "$SOURCE_PROJECT" --destination "$ENCRYPTED_BUNDLE"
```

常态看磁盘容量、上传/事务失败、服务可用性、最近成功备份和最近恢复演练。按后端 D-026 记录实际可复现的瓶颈，不自设发布指标。

## 干净目标的恢复与放流门槛

使用专用 `*-restore` 项目和不同的空库/素材目录，在另一台获准主机执行。把该项目名写入 `SHOWCASE_APPROVED_RESTORE_PROJECT`；指明签名者、目标可用的 `SHOWCASE_EXPECT_SCHEMA`、`SHOWCASE_EXPECT_API_IMAGE_ID`。目标主机库必须是空的 `cosmetics-product-platform`，并保持 API/反代停止。

可先用只读预检检查签名、完整清单及预期版本，不需要 Docker 或目标素材目录，也不会连接数据库。若本机 Python 3.11+ 不在 `python3` 命令上，可用 `SHOWCASE_PYTHON_BIN` 指向已安装的解释器。

```sh
bash deploy/restore.sh --project "$RESTORE_PROJECT" --bundle "$ENCRYPTED_BUNDLE" --verify-only
```

实际导入只能在获准的空目标执行：

```sh
bash deploy/restore.sh --project "$RESTORE_PROJECT" --bundle "$ENCRYPTED_BUNDLE"
```

脚本先核签名、完整清单和兼容版本，再确认目标镜像、容器停机和空库。容器状态查不到就停止，不作导入。预检通过不是实际恢复成功。恢复非空半成品不再重试覆盖；改用新的空目标或由运维按批准清理。恢复后用不同身份核对真实线上内容、未发布草稿以及历史图片，匿名仍取不到私有图。再在第二套独立空企业配置并发布本企业资料，第一套不得发生变化；手机与浏览器终验仍独立。容器重启、同机复制和原型都不能作为本节证据。
