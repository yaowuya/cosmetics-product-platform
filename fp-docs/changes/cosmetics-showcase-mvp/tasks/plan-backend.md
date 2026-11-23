# 化妆品企业产品展示平台 V1 Backend Implementation Plan

> **For agentic workers:** REQUIRED FLOW: Use `fp-execute` to implement this plan task-by-task. Only task markers use checkbox (`- [ ] **Task backend-NNN: ...**`) syntax for tracking; substeps are plain ordered instructions.

**Goal:** 让一家企业在自己的部署中维护四页 H5。编辑可保留不完整草稿；只有发布人确认合格条目，访客才看到新版。部署交付还须证明数据库和图片能从同一恢复点还原。

**Architecture:** 一个 FastAPI 服务分 public、admin 两个入口。条目 ID 稳定；草稿可写；完整快照不可变；一个 `live_id` 决定所有分类位置的线上版本。素材先写持久目录，再登记数据库。

**Tech Stack:** Python、FastAPI、SQLAlchemy 2、Alembic、MySQL 8.0+ / InnoDB、Ubuntu、Docker Compose、同源 HTTPS 反代。8.4 LTS 保留为交付推荐；用户明确接受本机已有 8.0.42 做隔离验收，禁止本机下载新的 MySQL 服务器。用 pytest、HTTPX、真实 MySQL 与实际文件验证。

## Global Constraints

- 本文是计划，不是运行记录。只覆盖 [提案](../proposal.md) 和[后端设计](../design/backend.md)。未登记 manifest、后端 settings 或技术栈规范（N/A）。下面均为拟新建的生产或测试路径。当前不安装、不实施、不迁移、不部署、不提交。
- 后续仅在获准执行后使用本文命令；生产凭据、正式资料、服务器访问和上线授权分别核对。所有 Step 5 **仅是候选提交点**：绿测、自审、确认范围后，还须另获 Git 提交授权并加载 `fp-commit`，否则保留未提交变更。绝不提交密钥、企业数据或备份。
- 每企业独立实例、库、卷、素材和密钥；固定首页、目录、案例、联系四页。不做多租户、自由搭页、小程序、交易、线索、角色引擎、异步队列、Redis、对象存储或案例批量发布。微肽数据、七条未归类示例、假二维码及客户/生产示意不得默认上线。
- UTC 记录时间。数据库用稳定 BIGINT 标识、唯一约束和显式 InnoDB 事务。线上指针只连本条目的快照；草稿被消费后修订也不复用。CLI 显式迁移，启动 API 不执行 DDL；不承诺 MySQL DDL 能批量回滚。腾讯云的 5000、5001 是用户提供的部署输入；不据此连接、开放新端口或对远端执行迁移。
- 公开只读当前发布投影，不接收草稿/版本选择；不可公开统一 404。缺会话 401，无当前能力 403，有权但私有资源不可读为 404，冲突 409，拒绝发布为 422。后台写入校验来源、CSRF 和当前账号；账号管理不隐含编辑/发布，发布需要编辑权和发布权。
- Engineering quality：`${CLAUDE_PLUGIN_ROOT}/skills/_shared/engineering-quality.md`。公开对象写职责 docstring，非显然边界说明原因，逐任务自审。运行边界及重访条件以 [D-026](../design/backend.md#风险迁移发布回滚与监控) 为准，不设新性能指标。

## File Structure

路径相对仓库根；同格列出的各文件共享该行职责。测试命令从根运行，用隔离测试库与临时素材目录，不能指向线上。以下模块通过 FastAPI `include_router` 注册；各任务在新增路由时更新同一个入口，不用插件注册表。

| Path | Action | Responsibility |
| --- | --- | --- |
| `backend/pyproject.toml`、`backend/app/main.py`、`backend/app/db.py`、`backend/app/models.py` | create | 安装包及测试依赖、应用入口、事务会话、表映射 |
| `backend/alembic.ini`、`backend/migrations/env.py`、`backend/migrations/versions/0001_initial.py`、`backend/migrations/versions/0002_config_items.py` | create | 空库升级、版本识别、约束、索引和表 |
| `backend/app/auth.py`、`backend/app/bootstrap.py`、`backend/app/admin_accounts.py` | create | 当前会话、防伪、首次管理员 CLI、治理与审计 |
| `backend/app/items.py`、`backend/app/config.py`、`backend/app/append.py` | create | 草稿和列表、页面/分类、逐款追加 |
| `backend/app/media.py`、`backend/app/preview.py` | create | 不可变文件、授权图片及修订预览 |
| `backend/app/checks.py`、`backend/app/publish.py`、`backend/app/lifecycle.py`、`backend/app/history.py` | create | 检查、事务发布、下架/清理、恢复 |
| `backend/app/public.py`、`backend/app/public_media.py` | create | 发布投影、当前公开图读取 |
| `backend/tests/conftest.py`、`backend/tests/test_schema.py`、`backend/tests/test_auth.py`、`backend/tests/test_accounts.py` | test | 实库迁移、临时素材、请求角色和授权断言 |
| `backend/tests/test_items.py`、`backend/tests/test_config.py`、`backend/tests/test_preview.py`、`backend/tests/test_append.py` | test | 图文配置、修订写入与只读预览 |
| `backend/tests/test_checks.py`、`backend/tests/test_publish.py`、`backend/tests/test_lifecycle.py`、`backend/tests/test_history.py` | test | 完整性、原子性与治理 |
| `backend/tests/test_public.py`、`backend/tests/test_public_media.py`、`backend/tests/test_invariants.py` | test | 投影、失去最后引用、真实并发和失败副作用 |
| `backend/Dockerfile`、`deploy/compose.yaml`、`deploy/Caddyfile`、`deploy/backup.sh`、`deploy/restore.sh`、`deploy/runbook.md` | create | 同机容器、静态与 API 分流、一致性备份、兼容回退和异机恢复 |
| `backend/tests/test_delivery.py`、`backend/tests/test_recovery.py` | test | 隔离部署、两家企业、真实恢复后的 API 探针 |

## Backend Interface Ledger

**公共 wire 规则。** JSON 使用 `snake_case`，不套 `data`。所有 ID 和 `revision` 用十进制字符串，`seq/page/page_size/total` 为整数；`null` 表示无当前版本等可空值。分页对象 `Page={items,total,page,page_size}`，从页 1 起，同序以稳定 ID 决胜。错误 `Error={code,message,issues:[{field,reason}]}`；原因指出哪一项需修正，不带口令、令牌或磁盘路径。表中 A=`/api/admin`，P=`/api/public`，I=`A/items/{id}`；省略状态的读取/操作成功返回 200。`204` 不带 JSON。

**共享载荷。** `Item={id,kind,config_slot,revision,live_id,draft,live,place_ids,archived_at,has_history}`。`kind=product|case|config`（枚举记法）；仅 config 有非空 `config_slot`。`draft/live` 为正文或 `null`，`place_ids` 为当前编辑基准的位置，历史位置由版本记录持有。列表行附 `summary`。`Choice={id,expected_revision}`；`Check={id,revision,eligible,issues,place_ids}`；`Receipt={id,revision,release_id,seq,request_key}`，其 revision 是成功后的新修订。取消确认不发写请求。

| Interface | Owner Task | Contract | Consumers | Verification |
| --- | --- | --- | --- | --- |
| DB / app | backend-001 | `app.main:app`；`db.session()` 产出 SQLAlchemy Session；Alembic `0001_initial`。`content_item,draft,release,directory_node,draft_place,release_place,asset,release_asset,account,session,audit` 逐表遵守设计字段、外键和索引；明确草稿/快照/账号/审计的不同生存期 | 全部后端 | `test_schema.py::test_upgrade_constraints` |
| 会话与能力 | backend-002 | `GET A/login` 发登录防伪 Cookie 与 `{csrf_token}`；`POST A/login {login,password}`、`POST A/change-password {old_password,new_password}`、`GET A/me` → `{id,login,can_edit,can_publish,can_manage,must_change_password,csrf_token}`；`POST A/logout` → 204。`auth.require(action)` 的 action 为 edit/publish/manage；Cookie 不可读、仅 HTTPS、SameSite，写请求头 `X-CSRF-Token` | 后台全路由 | `test_auth.py::test_session_boundaries` |
| 账号/审计 | backend-003 | `GET/POST A/accounts`，创建 `{login,password,can_edit,can_publish,can_manage}` → 201；`PATCH A/accounts/{id}` 仅更新 enabled 和能力；返回不含密码/hash 的账号。`GET A/audit?actor_id=&target_kind=&target_id=&page=&page_size=` → Page，行含 actor_id/action/target_kind/target_id/occurred_at/details/request_key。治理与内容按能力裁剪 | 账号管理、追溯 | `test_accounts.py::test_grants_and_scope` |
| 草稿 | backend-004 | `GET A/products`、`A/cases` → Page；按 `q,node_id,state,has_draft,page,page_size` 过滤。`POST` 同集合 `{body,place_ids}` → 201 Item；`GET I` → Item；`PUT I/draft {expected_revision,body,place_ids}` → Item。案例不得提交非空位置。`items.save_draft(db,id,expected_revision,body,place_ids,actor)` → Item 或 409/422 | 后台编辑/配置/追加/恢复 | `test_items.py::test_draft_and_lists` |
| 内容结构 | backend-004、005 | 正文键、类型、必填项以[后端完整字段定义](../design/backend.md#完整字段定义)为唯一来源；admin 草稿与发布正文不另设别名。`items.normalize_body(kind,config_slot,body)` 去除首尾空白，清空或未填省略，错键/类型/枚举/ID 格式为 422；不要求草稿达到发布完整性。001 的字符串 ID 规则作用于所有正文引用。 | 检查、公开白名单 | `test_items.py::test_draft_and_lists`、`test_config.py::test_fixed_tree` |
| 配置定位 | backend-005 | `GET A/config/{slot}` → Item；`slot` 为 `home_posters`、`catalog_cover`、`directory`、`case_header`、`services`、`business_contact`。按 `config_slot` 唯一索引查；固定位置和 `kind` 不由草稿改写。`POST A/directory/nodes {}` → 201 `{id}`；目录仍经 I/draft 保存。 | 编辑与公开配置 | `test_config.py::test_fixed_tree` |
| 私有素材/预览 | backend-006 | `POST A/media` multipart `file` → 201 `{id,url}`。`GET A/media/{id}`：未关联上传仅本人；关联图须给 `item_id` 和 `revision`（当前草稿）或 `seq`（指定版本），由服务端校验实际引用。`GET I/preview?revision=` → `{id,kind,config_slot,revision,body,place_ids,media_urls}`，URL 按本条目和修订生成。均需当前 edit；401/403/404 按全局约束，旧修订 409；私有响应 `Cache-Control: private, no-store`。 | 编辑与历史 | `test_preview.py::test_private_upload_preview` |
| 追加分类 | backend-007 | `POST A/products/batch-append {items:[Choice],node_ids}` → `{items:[{id,status,revision,issues}]}`，status=changed/unchanged/conflict/invalid。无新增不写；批内一条失败不覆盖其他款 | 产品运营 | `test_append.py::test_union_per_item` |
| 检查 | backend-008 | `checks.inspect(db,item)` → Check（无副作用）；`POST I/check {expected_revision}` → Check；`POST A/products/batch-check {items:[Choice]}` → `{items:[Check]}`，逐行定位缺项、冲突及不合格原因。单条修订不符 409；无权不返回批结果 | 发布确认/运营 | `test_checks.py::test_no_side_effects` |
| 确认及核单 | backend-009 | `POST I/publish {expected_revision,request_key}` → Receipt；每次用户确认、每款独立键。同操作者/动作/对象/源修订原键重放同回执；异绑定 409；当前失权先拒绝。超时先按 request_key 只读核单，不自动重发；见下方联调细则 | 单条及逐款发布 | `test_publish.py::test_publish_receipt` |
| 生命周期 | backend-010 | `GET I/impact` → `{case_ids,cases:[{id,brand_name,product_name}]}`；`POST I/unlist`、`I/archive` 携 `{expected_revision,confirmed:true,case_ids}` → Item；非产品传空集合。变更后重新提示。`DELETE I/draft` 携 `{expected_revision,confirmed:true}` → 204，仅从未发布产品/案例 | 运营治理 | `test_lifecycle.py::test_cleanup_guard` |
| 版本/恢复 | backend-011 | `GET I/versions?page=&page_size=` → Page，行 `{seq,release_id,source_revision,actor_id,created_at,body,place_ids}`；`POST I/versions/{seq}/restore {expected_revision,confirm_overwrite}` → Item。两者都需当前 edit；历史图按条目与 seq 走私有读取。恢复无草稿可 false，有草稿须 true；只复制正文、位置为新修订并审计。 | 历史面板、纠错 | `test_history.py::test_editor_restore_only` |
| 公开读模型 | backend-012 | `GET P/pages/{page}`，page=home/catalog/cases/contact → `{page,body}`；`GET P/catalog?board_id=` → `{nodes,counts}`（counts 为节点 ID→去重产品数）；`GET P/products?board_id=&node_id=&q=&page=&page_size=`、`GET P/cases?tag=&q=&page=&page_size=` → Page。`GET P/products/{id}`、`P/cases/{id}` → `{id,body}`；详情保留所属类型公开字段，图片引用公开地址，不带草稿、内部关联或编辑数据 | H5、API 验收 | `test_public.py::test_live_projection` |
| 公开图 | backend-013 | `GET P/media/{id}` → 当前公开投影仍引用时返回真实图片字节及 MIME，其他一律 404。禁止共享缓存；不会因留存历史文件放行 | H5 | `test_public_media.py::test_last_reference` |
| 真实事务验证 | backend-014 | 真实 MySQL 双连接、HTTPS 测试客户端和临时文件；回执丢失、同时发布、撤权、目录停用与回滚都核对快照/位置/引用/日志数量 | 发布门槛 | `test_invariants.py::test_two_connections` |
| 部署/备份 | backend-015 | Compose 服务 `api,db,proxy`；`GET /health/ready` 只报就绪，无内部详情；`backup.sh` 在停写窗口导出一组 DB、文件、版本、清单及校验和，加密传至异机。`bash deploy/backup.sh --project <源项目名> --destination <异机加密备份目标>`；`bash deploy/restore.sh --project <隔离项目名> --bundle <已校验备份包>` 只接受空的隔离目标，必须拒绝原实例；密钥从部署人员控制的秘密挂载读取，不入参数/日志 | 恢复门槛 | `test_delivery.py::test_bundle` |
| 恢复验证 | backend-016 | 真实双部署和干净主机探针；在隔离恢复点按原权限读线上/草稿/历史及各自图片；分别留主机、镜像/迁移版本、备份点、校验和与脱敏结果 | 交付审查；不等待浏览器页面 | `test_recovery.py::test_clean_host` |

**前后端联调细则（上述路由的字段约束）。**

- 后台列表独立过滤 `state=online|offline|archived` 和 `has_draft=true|false`。offline 为无线上指针且未归档，不以历史判断；未指定状态默认不含归档。`node_id` 只过滤产品，`q` 搜名称/配方编号或品牌名/案例产品名；`total` 为全部过滤后去重数。
- 公开节点保留 `{id,parent_id,level,name,icon_url,sort_order}`，`counts` 为板块/位置子树内去重数。产品、案例均投影 `{id,body}`，列表仅卡片，正文素材 `*_asset_id(s)` 转 `*_asset_url(s)`。`tag` 匹配案例 `category_key`。四页按 `home_posters`、`catalog_cover`、`case_header` 和 `{services,business_contact}` 当前发布正文返回，独立配置缺失不从别处补齐。私有预览只用其 `media_urls` 解引用。
- 未知回执先只读 `GET A/audit?target_kind=product&target_id={id}&request_key={key}&page=1&page_size=1`。其他种类用相应 kind。当前发布人按自身请求绑定查找，成功行 `details.receipt` 是原 Receipt，空结果仍为未知，不自动重发。用户再次核对确认后方可使用原绑定、原键，绝不因超时换键。
- `frontend/h5/dist/build/h5/` 对应 `/`，包括 `/products?id=…`、`/cases/detail?id=…`、`/preview?id=…&revision=…`。预览深链由 H5 读取同源私有 API，绝不生成公开预览参数；`frontend/admin/dist/` 对应 `/admin/`。两个静态入口均不得接管 `/api/**`；代理显式分流且绝不挂载上传目录。API 级验证可在静态构建未交付时独立运行。

## Tasks

每项 Files 均给出将创建/更新的确切文件。`backend/tests/conftest.py` 承载该项新增的隔离数据、测试客户端、真实 ID 和原始行数；下文代码是各命名测试的关键断言，不是生产默认资料。在发布接口可用前，用测试事务建立历史、线上位置和素材，不能调用尚未交付的 API 作为测试前置。命令行已装本计划测试依赖后从根执行；下文 `pytest` 均指该虚拟环境。所有数据库测试只接受专用 MySQL 8.0+ 测试库。本机使用已安装版本及独立回环实例，不下载新 MySQL，不使用 SQLite 或现有业务库替代。

- [x] **Task backend-001: 在空 MySQL 上建立条目、快照与审计约束**

**Files:** Create: `backend/pyproject.toml`, `backend/app/main.py`, `backend/app/db.py`, `backend/app/models.py`, `backend/alembic.ini`, `backend/migrations/env.py`, `backend/migrations/versions/0001_initial.py`；Test: `backend/tests/conftest.py`, `backend/tests/test_schema.py`。
**Reasoning:** 首个独立增量是可安装服务及可重复显式升级的空库，不是把样例插成发布记录。
**Depends on:** None
**Interfaces:** Consumes: 专用 MySQL URL；Produces: DB / app；Contract checks: 实查 InnoDB、主外键、唯一键、索引、迁移版本及空公开集。
1. **失败测试：** `test_upgrade_constraints` 空库升级、二次升级；重复版本、位置、跨条目指针、重复 `config_slot` 及非配置条目占槽报 `IntegrityError`。多个产品的 NULL 不冲突；`assert live_count == release_count == 0`。
2. **红：** `python -m pytest backend/tests/test_schema.py -q`，预期缺映射或迁移，重复数据可入库。
3. **最小实现：** 声明式元数据，仅一个基类。建条目、版本后补本条目指针复合外键；首迁移加入 `config_slot` 的 CHECK 和 UNIQUE；版本和位置/媒体唯一约束与反查索引按设计。审计存目标摘要而非级联依赖。UTC；`python -m pip install -e "./backend[test]"` 安装声明的测试/运行依赖。`script_location` 相对 ini；启动不 `create_all`。
4. **绿：** `python -m alembic -c backend/alembic.ini upgrade head`、`python -m pytest backend/tests/test_schema.py -q`，预期当前修订等于脚本 head（本项为 0001_initial，不在测试中永久硬编码），全绿、无默认产品/图片，入口可导入。
5. **Commit（另行授权后）：** `git commit -m "feat: 建立内容版本与审计约束"`，仅暂存本项 Files。

- [x] **Task backend-002: 用当前会话约束登录、改密与后台写入**

**Files:** Create: `backend/app/auth.py`, `backend/app/bootstrap.py`；Modify: `backend/app/main.py`；Test: `backend/tests/conftest.py`, `backend/tests/test_auth.py`。
**Reasoning:** 即使旧页面仍打开，停用、失效或撤权后也不能继续对应操作。
**Depends on:** backend-001
**Interfaces:** Consumes: DB / app；Produces: 会话与能力、`python -m app.bootstrap`；Contract checks: 强制改密、Cookie、来源、防伪、限速、失效。
1. **失败测试：** `test_session_boundaries` 用部署 CLI 从隐藏输入建首管理账号，重复执行拒绝；登录后 `assert c.get('/api/admin/me').status_code == 403`（尚未改密），改密后为 200；错误 CSRF、伪造来源拒绝，退出后 401。
2. **红：** `pytest backend/tests/test_auth.py -q`，预期缺少会话路由或未拦截强制改密。
3. **最小实现：** 无注册和内置密码；口令带盐慢哈希，随机会话令牌只持久化摘要与过期时间，登录轮换、限速且不记凭据。`require('publish')` 取当前启用账号并要求 edit+publish；登录使用匿名防伪票据。强制改密期间仅改密/退出。
4. **绿：** `pytest backend/tests/test_auth.py -q`，校验 `HttpOnly; Secure; SameSite`、过期和停用旧会话、无发布权管理员 403，失败不留内容变更。
5. **Commit（另行授权后）：** `git commit -m "feat: 建立可撤销会话与改密门禁"`。

- [x] **Task backend-003: 分开账号管理、发布授权和审计可见范围**

**Files:** Create: `backend/app/admin_accounts.py`；Modify: `backend/app/main.py`；Test: `backend/tests/test_accounts.py`。
**Reasoning:** 能管理账号不等于能编辑内容；追查人员或对象不能泄漏另一类日志。
**Depends on:** backend-002
**Interfaces:** Consumes: `auth.require`、audit/account；Produces: 账号/审计；Contract checks: 授权与日志原子写入，按职责裁剪。
1. **失败测试：** `test_grants_and_scope` 中 `assert editor.get('/api/admin/accounts').status_code == 403`；管理者对无 edit 的账号只授 publish 应拒绝；停用、撤权后旧会话不能再操作。
2. **红：** `pytest backend/tests/test_accounts.py -q`，预期缺授权接口或日志未按权限过滤。
3. **最小实现：** `with db.begin():` 锁相关账号（稳定顺序）、验证授予组合、更新并写一次差异日志；新账号须改密。管理者查治理日志，编辑查内容日志；兼有能力方可看两类。响应明确排除口令和令牌。
4. **绿：** `pytest backend/tests/test_accounts.py -q`；滤 actor_id/target、启停和授回发布权，拒绝写后权限/审计不变。
5. **Commit（另行授权后）：** `git commit -m "feat: 管理账号与关键操作审计"`。

- [x] **Task backend-004: 每款一行地维护独立产品和案例草稿**

**Files:** Create: `backend/app/items.py`；Modify: `backend/app/main.py`；Test: `backend/tests/test_items.py`。
**Reasoning:** 保存允许缺业务字段，但不能覆盖同事的新修订，也不能使另一对象自动随动。
**Depends on:** backend-002
**Interfaces:** Consumes: edit/current session、数据库关联；Produces: 草稿、内容结构、`items.save_draft`；Contract checks: 保存不发布，搜索不因多分类重复。
1. **失败测试：** `test_draft_and_lists` 建双分类产品和独立案例，`assert rows['total'] == 1`；两会话同修订后写为 409。清空 `detail_asset_id` 可存为缺项，数组作单一图片 ID 返回 422；两者不改变 live。
2. **红：** `pytest backend/tests/test_items.py -q`，预期集合不存在、错误格式被接受或二次保存覆盖前值。
3. **最小实现：** 新建修订从 0 起，实际写稿后递增并返回；事务内核修订并执行 `normalize_body`。列表以条目为主，分类用 EXISTS；保持两类检索和归档筛选。案例关联仅为可空内部 ID；保存不写 release 或改字审计。
4. **绿：** `pytest backend/tests/test_items.py -q`；核对新建/详情/保存、仅编辑能访问、合法部分草稿、非法结构、归档筛选与分页稳定性。
5. **Commit（另行授权后）：** `git commit -m "feat: 保存独立产品与案例草稿"`。

- [x] **Task backend-005: 以稳定节点配置四页与企业目录**

**Files:** Create: `backend/app/config.py`, `backend/migrations/versions/0002_config_items.py`；Modify: `backend/app/items.py`, `backend/app/main.py`；Test: `backend/tests/test_config.py`。
**Reasoning:** 运营可改名、排序、停用位置，不能重排四页或让无效路径露出。此处只交付配置和草稿，不要求先写 H5。
**Depends on:** backend-004
**Interfaces:** Consumes: Item、`items.save_draft`；Produces: 配置定位、稳定节点；Contract checks: 单例无示例正文、结构合法、二维码与服务图独立。
1. **失败测试：** `test_fixed_tree` 重读同槽断言条目 ID 稳定；改节点名不换节点 ID；成环或失联树返回 422，未知槽返回 404，保存不换 live。
2. **红：** `pytest backend/tests/test_config.py -q`，预期无法读取固定入口、成环配置获接受。
3. **最小实现：** 0002 为六个固定槽预备空身份，无公开版、无企业数据。按 `config_slot` 唯一索引查；编辑不改槽或节点 ID。配置保存按槽使用 `normalize_body`，校验树父子、层级、唯一性与无环；保持已提交顺序，GET 不写入。
4. **绿：** `pytest backend/tests/test_config.py -q`；验证节点启停/排序、配置身份幂等、空联系方式不伪造内容、仅编辑可改。
5. **Commit（另行授权后）：** `git commit -m "feat: 添加企业页面和目录配置"`。

- [x] **Task backend-006: 按修订预览草稿并私有读取不可变素材**

**Files:** Create: `backend/app/media.py`, `backend/app/preview.py`；Modify: `backend/app/main.py`；Test: `backend/tests/test_preview.py`。
**Reasoning:** 上传成功不是公开许可；数据库回滚也不会替人删除已写入的文件。
**Depends on:** backend-004
**Interfaces:** Consumes: edit、asset、Item；Produces: 私有素材/预览；Contract checks: 类型/字节数/像素/解码上限、原路径不可控、私有 no-store。
1. **失败测试：** `test_private_upload_preview` 拒绝伪 MIME、坏图或超限文件，忽略客户端路径；旧修订 409，仅管理权 403。编辑可读指定内容引用的图，但另一编辑的未关联上传、错条目或错版本返回 404。
2. **红：** `pytest backend/tests/test_preview.py -q`，预期合法预览失败或错误上下文能读图。
3. **最小实现：** 流式限长并解码核像素/MIME，随机相对键、目录内独占落盘后登记上传者；异常清暂存，未登记不可读。依私有账本复核 edit、引用或上传者；预览校验条目和当前修订，返回绑定的正文及 URL，不回退。禁共享缓存。
4. **绿：** `pytest backend/tests/test_preview.py -q`；模拟磁盘满/登记失败无可读图，核对历史图私有访问、正文及图片响应头。
5. **Commit（另行授权后）：** `git commit -m "feat: 保护素材上传与修订预览"`。

- [x] **Task backend-007: 仅为选中且改变位置的产品生成草稿**

**Files:** Create: `backend/app/append.py`；Modify: `backend/app/main.py`；Test: `backend/tests/test_append.py`。
**Reasoning:** 类别追加是逐款合并，不是替换全部位置或触发发布。
**Depends on:** backend-005
**Interfaces:** Consumes: Choice、目录、`items.save_draft`；Produces: 追加分类；Contract checks: 并集去重、不变不写、冲突不覆盖。
1. **失败测试：** `test_union_per_item` 选一款已有草稿和一款仅线上；`assert set(after['place_ids']) == old_ids | added_ids`；重复追加返回 unchanged，修订和日志数不动。
2. **红：** `pytest backend/tests/test_append.py -q`，预期缺批量路由或原草稿正文被覆盖。
3. **最小实现：** 按选中 ID 去重、逐项校验类型/当前修订/位置资格，从草稿优先否则复制当前版；`merged = previous | requested`，只写差集非空的产品。每款独立反馈；不动案例、未选产品或线上指针。
4. **绿：** `pytest backend/tests/test_append.py -q`；混入案例、失效位置、旧修订、无权分别验证，失败款不生成草稿。
5. **Commit（另行授权后）：** `git commit -m "feat: 按产品合并草稿分类"`。

- [x] **Task backend-008: 用同一规则检查单条和所选产品**

**Files:** Create: `backend/app/checks.py`；Modify: `backend/app/main.py`；Test: `backend/tests/test_checks.py`。
**Reasoning:** 检查报告应能定位缺长图等问题；合格结论不是永久通行证，更不是发布。
**Depends on:** backend-005, backend-006
**Interfaces:** Consumes: Item、真实素材和当前已发布有效目录；Produces: 检查、`checks.inspect`；Contract checks: Check 与批检查无副作用。
1. **失败测试：** `test_no_side_effects` 清空 `detail_asset_id` 后 `assert 'detail_asset_id' in {e['field'] for e in row['issues']} and not row['eligible']`；线上旧图不兜底。混合批逐款检查；仅编辑者 403。
2. **红：** `pytest backend/tests/test_checks.py -q`，预期缺检查入口或仅凭非空图片标识判合格。
3. **最小实现：** `checks.inspect` 按唯一字段定义检查必填项和有效引用，不从 live 补齐；单条/批量及确认复用同一规则。批量只接受产品，返回每款修订、影响位置及字段原因；不写库。
4. **绿：** `pytest backend/tests/test_checks.py -q`；验证缺稿、无有效位置、素材丢失、失权、案例不能批发及计数不变。
5. **Commit（另行授权后）：** `git commit -m "feat: 返回逐条发布检查结果"`。

- [x] **Task backend-009: 每款确认只提交一次完整快照和回执**

**Files:** Create: `backend/app/publish.py`；Modify: `backend/app/main.py`, `backend/app/admin_accounts.py`；Test: `backend/tests/test_publish.py`。
**Reasoning:** 成功但丢回执与从未提交不同；不能靠前端按钮禁用防止重复上线。
**Depends on:** backend-003, backend-008
**Interfaces:** Consumes: publish、Check、不可变文件、实际版本约束；Produces: 确认及核单；Contract checks: 原键回执可重取，异绑定和双消费拒绝。
1. **失败测试：** `test_publish_receipt` 发布后模拟不交付首个响应，重发相同 body；`assert replay.json() == first.json()`；`assert (version_count, audit_count) == (1,1)`（目标发布动作）。
2. **红：** `pytest backend/tests/test_publish.py -q`，预期无有效回执或重试新建第二版。
3. **最小实现：** 一款一事务：按一致顺序锁账号、目录配置、目标（去重），在锁内当前读原键；绑定一致且当前授权才回放。新键再次核权、修订、状态、位置、媒体；写 release、release_place、递归抽取 release_asset，更新 live_id、消费草稿并递增 revision，写唯一键审计和回执。唯一键冲突重新核对绑定，失败回滚全部写入。
4. **绿：** `pytest backend/tests/test_publish.py -q`；同键异对象/修订 409，失权 403、缺图 422；中途抛错后草稿、线上指针、快照、引用和日志与事务前一致。
5. **Commit（另行授权后）：** `git commit -m "feat: 原子发布并复用每款回执"`。

- [x] **Task backend-010: 提示受影响案例并安全下架、删除或归档**

**Files:** Create: `backend/app/lifecycle.py`；Modify: `backend/app/items.py`, `backend/app/main.py`；Test: `backend/tests/test_lifecycle.py`。
**Reasoning:** 当前无线上指针不等于从未发布；提示产品影响不能联动修改案例。
**Depends on:** backend-009
**Interfaces:** Consumes: Item、历史、edit/publish、案例草稿及线上内部关联；Produces: 生命周期；Contract checks: 重核确认清单、状态和权限。
1. **失败测试：** `test_cleanup_guard`：`assert editor.request('DELETE',url,json=payload).status_code == 409`，对象已下架但有历史；受影响清单变更后旧确认 409。
2. **红：** `pytest backend/tests/test_lifecycle.py -q`，预期下架后可误删或关联案例跟随下架。
3. **最小实现：** 影响查询只扫案例，合并草稿和 live 关联、按案例 ID 去重；确认时稳定顺序协调相关产品及案例关联写入，锁内重算清单/修订。下架仅清指针并递增修订；从未发布的产品/案例草稿仅编辑二次确认可删，留目标摘要；有历史、已下架才可由发布人归档；均记关键动作，保留历史文件。
4. **绿：** `pytest backend/tests/test_lifecycle.py -q`；测试不确认、无权、仍线上、列表改变均无新日志；案例不级联、归档退出日常列表、历史可查。
5. **Commit（另行授权后）：** `git commit -m "feat: 在下架与清理前复核影响"`。

- [x] **Task backend-011: 编辑将指定历史版本恢复为草稿而不发布**

**Files:** Create: `backend/app/history.py`；Modify: `backend/app/main.py`；Test: `backend/tests/test_history.py`。
**Reasoning:** D-021 把“纠正草稿”和“改变线上”分成两次不同授权的操作。
**Depends on:** backend-009
**Interfaces:** Consumes: edit、release/release_place、Item；Produces: 版本/恢复；Contract checks: 私有历史与来源日志、覆盖确认、线上不变。
1. **失败测试：** `test_editor_restore_only` 用无发布权编辑还原旧 seq；`assert restored['live_id'] == before['live_id'] and restored['revision'] != before['revision']`；另发 publish 为 403。
2. **红：** `pytest backend/tests/test_history.py -q`，预期普通编辑被误拒或线上指针回退。
3. **最小实现：** 条目内按 seq 倒序取只读版本；来源必须属于该 ID。事务中重验当前 edit、当前修订及覆盖确认，复制版本正文和位置到草稿，递增修订；记 actor、源 seq/版本和新修订日志，不写 release、live_id 或公开引用。
4. **绿：** `pytest backend/tests/test_history.py -q`；仅管理权对历史列表及恢复均为 403；修订漂移/拒绝覆盖 409，跨条目版本不可读；成功仅一条恢复日志，公有结果和历史版本均不变。
5. **Commit（另行授权后）：** `git commit -m "feat: 允许编辑恢复历史草稿"`。

- [x] **Task backend-012: 仅投影公开四页、有效目录、产品与独立案例**

**Files:** Create: `backend/app/public.py`；Modify: `backend/app/main.py`；Test: `backend/tests/test_public.py`。
**Reasoning:** 草稿再完整也不补线上空字段；跨分类共享产品，不共享案例的正文。
**Depends on:** backend-009
**Interfaces:** Consumes: 当前配置快照、live_id、release_place；Produces: 公开读模型；Contract checks: 当前有效范围内去重、字段白名单、稳定分页。
1. **失败测试：** `test_live_projection` 中 `assert board_count == 1 and page['total'] == 1`（一款在同板块两个分类）；草稿和历史只能 404 或被过滤，公众案例不含 related_product_id。
2. **红：** `pytest backend/tests/test_public.py -q`，预期公开路由缺失或目录重复行。
3. **最小实现：** 从 live 指针出发，产品与当前目录有效路径相交；板块搜索先限范围、总数按产品 ID 去重且不受细筛。列表和详情按不同白名单；案例不生成内部关联跳转。四页配置按 backend-005 的唯一槽查当前发布版，服务与商务联系分别取数，不借其他条目或草稿补缺；未公开详情统一 404。
4. **绿：** `pytest backend/tests/test_public.py -q`；涵盖四页、可选联系渠道、取消最后有效位置、改名停用、范围外搜索、案例独立、拒绝公开 preview/revision 参数与稳定同序分页。
5. **Commit（另行授权后）：** `git commit -m "feat: 投影当前公开目录及四页"`。

- [x] **Task backend-013: 最后公开引用解除后旧图片链接立即失效**

**Files:** Create: `backend/app/public_media.py`；Modify: `backend/app/main.py`；Test: `backend/tests/test_public_media.py`。
**Reasoning:** 知道图片地址不代表还能访问；保留历史字节与公开取图是两件事。
**Depends on:** backend-010, backend-012
**Interfaces:** Consumes: 当前公开投影、`release_asset(asset_id,release_id)`、asset 存储键；Produces: 公开图；Contract checks: 嵌套图片和共享引用逐次判定。
1. **失败测试：** `test_last_reference`：两项共图，撤一项 `assert public.get(url).status_code == 200`，撤最后一项再取同 URL 为 404；编辑仍可借私有入口读原图。
2. **红：** `pytest backend/tests/test_public_media.py -q`，预期仅历史引用也能取得公开字节，或撤第一项就误拒。
3. **最小实现：** 每次请求经反向索引相交于当前实际公开内容，含有效目录路径、嵌套海报/卡片/图标；从服务器相对键开文件，不接收客户端路径；动态鉴权响应 no-store，不对外映射素材目录。无法收回访客已保存的副本。
4. **绿：** `pytest backend/tests/test_public_media.py -q`；草稿、只存在于历史、失效分类、替换二维码、猜 ID、共享引用和正文嵌套图逐项通过。
5. **Commit（另行授权后）：** `git commit -m "feat: 按实时公开引用读取媒体"`。

- [x] **Task backend-014: 在真实 InnoDB 上复现冲突、丢回执和跨分类纠错**

**Files:** Test: `backend/tests/conftest.py`, `backend/tests/test_invariants.py`；涉及不变量的修复限 `backend/app/publish.py`, `backend/app/checks.py`, `backend/app/history.py`, `backend/app/lifecycle.py`, `backend/app/public.py`, `backend/app/public_media.py`。
**Reasoning:** 单会话模拟不能检验实际行锁；要观察用户回执，也要数清失败后未留下什么。
**Depends on:** backend-003, backend-007, backend-010, backend-011, backend-013
**Interfaces:** Consumes: 全套后台/公开 API；Produces: 真实事务验证；Contract checks: 独立连接、可复核锁顺序和前后计数。
1. **失败测试：** `test_two_connections` 用不同连接、同步屏障同时确认同一源修订；`assert sorted(statuses) == [200,409]`（不同键）。相同绑定同键则两次同回执。使用可控故障让提交后首次 HTTP 回执丢失。
2. **红：** `pytest backend/tests/test_invariants.py -q`，在测试副本以取消锁内重检或发布事务中断的故障输入证明断言能捕获双发布/半提交；若实现已绿，留故障注入的对照证据，不制造生产回归。
3. **最小实现：** 建双分类发布基线，缺长图→检查失败→两处见旧版→补齐并确认→两处同新版→仅编辑恢复→线上不退。覆盖发布与目录停用/撤权的相反到达次序；已提交款按原键核对，未发起款无版本或日志。比较两连接所读的指针、位置、媒体、审计和请求号；仅修责任模块，不加队列。
4. **绿：** `pytest backend/tests/test_invariants.py -q`；锁竞争按可串行先后解释，失权已生效则无额外写入；保留脱敏响应、两连接和数据库行数证据。
5. **Commit（另行授权后）：** `git commit -m "test: 验证真实事务与发布竞争"`。

- [ ] **Task backend-015: 封装单企业容器与可核验的一致性备份**

**Files:** Create: `backend/Dockerfile`, `deploy/compose.yaml`, `deploy/Caddyfile`, `deploy/backup.sh`, `deploy/restore.sh`, `deploy/runbook.md`；Modify: `backend/app/main.py`；Test: `backend/tests/test_delivery.py`。
**Reasoning:** 容器重启不能证明内容可恢复；迁移和应用启动也不能绑成一个不受控动作。
**Depends on:** backend-014
**Interfaces:** Consumes: app、显式 Alembic、持久素材；Produces: 部署/备份；Contract checks: 无公开数据库或上传目录，备份同一停写点、可校验、异机加密。
1. **失败测试：** `test_bundle` 在专用 Ubuntu Docker 测试机断言 `assert not db_public_ports and snapshot_hashes_ok`；破坏清单一个文件，恢复预检必须拒绝；无前端包时用空静态挂载验证 API，不等待前端。
2. **红：** `pytest backend/tests/test_delivery.py -q`，预期容器描述、就绪路由或完整恢复点缺失。
3. **最小实现：** 反代 HTTPS，API 路由优先；db 只入内部网络，不对外发布 3306；DB 卷、素材目录在容器外。明确迁移与首管理员命令；监测容量、上传/事务失败、服务健康与备份年龄。备份先拒绝新写并排空在途写（可短暂停 API），导出 InnoDB、复制同点全部留存素材（含草稿/历史）、核清单后恢复写；记录应用镜像摘要/schema 版本、加密异机保存。恢复先验签/校验文件与版本，隔离写入再操作；兼容才回退应用，不兼容恢复对应镜像和数据、核对恢复点后业务。
4. **绿：** `docker compose -f deploy/compose.yaml config --quiet`、`pytest backend/tests/test_delivery.py -q`；在隔离环境运行 `docker compose -f deploy/compose.yaml run --rm api alembic -c alembic.ini upgrade head`，重建容器后库/图仍在、API 启动不改表、不泄露内部路径。
5. **Commit（另行授权后）：** `git commit -m "ops: 约束部署边界并生成一致备份"`。

- [ ] **Task backend-016: 从第二企业空实例和异机恢复证明交付可重复**

**Files:** Test: `backend/tests/test_recovery.py`；Modify: `deploy/runbook.md`, `deploy/restore.sh`。
**Reasoning:** 既要证明配置可替换，也要证明原主机全失时能按原权限恢复线上、草稿、历史和图片；API 级验收不反向依赖 UI。
**Depends on:** backend-015
**Interfaces:** Consumes: 部署/备份、公开与授权接口；Produces: 恢复验证；Contract checks: 不同库/卷/密钥、干净异机、同点证据与拒绝路径。
1. **失败测试：** `test_clean_host` 以客户正式资料的授权测试副本或明确标记测试资料建 A/B；`assert private_bytes == expected_bytes and anonymous_status == 404`；故意缺历史文件、错校验或不同 schema 的副本必须拒绝放流。
2. **红：** `pytest backend/tests/test_recovery.py -q`，若源/第二企业/异机主机没有显式配置则报告缺前提，不允许跳过后标绿；用损坏副本验拒绝分支。
3. **最小实现：** 在互不共享资源的第二实例用后台 **API** 从空企业配置四页、独立分类和图码；比较两实例，账号/素材/发布数据不串。干净异机导入同次异机备份，校验兼容镜像和迁移版本，隔离登录→比对线上产品、未发草稿、旧版及每种图的内容校验值；撤权账号拒绝，私有图不公开。核完才允许申请切流；此处不切生产流量。
4. **绿：** `pytest backend/tests/test_recovery.py -q`；记录主机、实例隔离、恢复点/耗时、版本、校验、响应和核对人。按 D-026 留代表性查询、素材容量及稳定网络批次的证据，不自定指标。无异机只记未验证；真实 UI 终验交前端，后端不等待页面构建。
5. **Commit（另行授权后）：** `git commit -m "test: 验证第二企业隔离与异机还原"`，仅脱敏测试与运行说明，不含现场凭证。

## Coverage Matrix

| Source | Requirement / Boundary | Tasks | Verification |
| --- | --- | --- | --- |
| proposal P-001、P-002；design D-003、D-004、D-012、D-018 | 单企业同源服务、初始 schema、显式迁移、固定四页与可替换素材；不带原型种子 | backend-001, backend-005, backend-012, backend-015, backend-016 | `pytest backend/tests/test_schema.py backend/tests/test_config.py backend/tests/test_recovery.py -q` |
| proposal P-003；design D-014 | 产品多位置一份正文，独立案例与后台关联，只追加草稿、一款一行、目录范围/计数/筛选 | backend-004, backend-005, backend-007, backend-010, backend-012 | `pytest backend/tests/test_items.py backend/tests/test_append.py backend/tests/test_public.py -q` |
| proposal P-004；design D-008、D-009、D-010、D-015 | 单条及页面驱动的合格款逐次确认；修订、原键、失败回滚、跨分类一致 | backend-008, backend-009, backend-014 | `pytest backend/tests/test_checks.py backend/tests/test_publish.py backend/tests/test_invariants.py -q` |
| proposal P-004、P-005；design D-021 | 历史恢复只写草稿；提交时复核下架/删除/归档门槛与案例影响 | backend-010, backend-011, backend-014 | `pytest backend/tests/test_lifecycle.py backend/tests/test_history.py -q` |
| proposal P-005；design D-007、D-011 | 首管交接、强制改密、当前会话和 edit/publish/manage、审计负向 | backend-002, backend-003, backend-014 | `pytest backend/tests/test_auth.py backend/tests/test_accounts.py backend/tests/test_invariants.py -q` |
| design D-006、D-013、D-016；Backend boundary | 文件先落盘，草稿预览、公开字段白名单、实时图片引用、撤码与缓存 | backend-006, backend-012, backend-013 | `pytest backend/tests/test_preview.py backend/tests/test_public.py backend/tests/test_public_media.py -q` |
| design D-005、D-018、D-019 | 五项上线门槛：跨分类、断网冲突、权限/媒体、真实第二企业、干净异机恢复；重启不能代替恢复 | backend-014, backend-015, backend-016 | `pytest backend/tests/test_invariants.py backend/tests/test_delivery.py backend/tests/test_recovery.py -q`，另核验真实 UI 的独立验收记录 |
| design D-022、D-023 | 固定槽唯一；保存与发布校验分离 | backend-001, backend-004, backend-005, backend-008, backend-012 | `pytest backend/tests/test_schema.py backend/tests/test_items.py backend/tests/test_config.py backend/tests/test_checks.py backend/tests/test_public.py -q` |
| design D-024、D-026 | 编辑权与资源引用、未关联图归属、批次中断和运行边界 | backend-006, backend-011, backend-014, backend-016 | `pytest backend/tests/test_preview.py backend/tests/test_history.py backend/tests/test_invariants.py backend/tests/test_recovery.py -q` |
| design D-020、D-027 | 后端 small，唯一任务 owner；无布局迁移 | backend-001 至 backend-016 | 静态检查任务标记、依赖和文件上限；非实施任务 |

设计缺口：未发现阻碍后端规划的缺口。风险保留：示例分类和正式图片必须由企业核实；真实 MySQL、部署窗口、互相隔离的实例和可读取加密备份的干净异机都是未来验收前提。没有这些条件不能用 mock、重启、同机复制或本文本身代替交付证据。
