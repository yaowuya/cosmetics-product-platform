# Execution Progress

Plan files:
- `tasks/plan-backend.md` (small; all backend owners)
- `tasks/frontend/00-index.md` (split; `01-context.md`, `05-interfaces.md`, `10-foundation-tasks.md`, `20-content-tasks.md`, `30-operations-tasks.md`, `40-delivery-tasks.md`, `90-coverage.md` in that order)
- `tasks/00-overview.md` (derived progress only)

Base SHA: `15e5d772fc5e3a057e9661862914f8698692652b`

## Completed

- `backend-001` (owner: `tasks/plan-backend.md`): installed the editable backend in a disposable Python 3.12 venv, applied Alembic to a new isolated MySQL 8.0.42 database, and ran `python -m pytest backend/tests/test_schema.py -q -p no:cacheprovider` (2 passed). Red reproduced absent entrypoint/migration. Verified repeat migration, all InnoDB tables, fixed-slot/own-release/placement/version constraints and empty public pointers; `alembic check` found no drift. Inline self-review retained explicit DDL and adjusted the MySQL CHECK error assertion to server error 3819. No commit.
- `frontend-001` (owner: `tasks/frontend/10-foundation-tasks.md`): `npm --prefix frontend run typecheck`, `npm --prefix frontend run build` and `node --test frontend/tests/contracts.test.mjs` passed (4/4). Red reproduced absent public client. Isolated the Windows esbuild large-input temp-file error and avoided importing unused Element Plus widgets; local provider preserves the selected library. Verified separate asset bases and credential/CSRF boundaries. No business UI claimed and no commit.

- `backend-002` (owner: `tasks/plan-backend.md`): red `test_auth.py` failed on missing `app.bootstrap`; green full backend suite (3 passed on MySQL 8.0.42). Checked first-admin bootstrap, required password change, same-origin CSRF, Secure/HttpOnly/SameSite, logout, expiry, disablement and no implicit publish grant. SQLAlchemy model check unchanged. External Starlette TestClient/HTTPX deprecation warning recorded; no code failures. Inline auth-boundary and credential-redaction review completed. No commit.

- `backend-003` (owner: `tasks/plan-backend.md`): red `test_accounts.py` returned 404 for absent account creation. Green backend suite checked role filters, rejection with unchanged audit, grant/revoke observed by the existing session, disabling invalidating previous sessions and redacted responses. Authorization/audit atomicity reviewed; catch narrowed to HTTP authorization failures and retested in the full suite. No commit.
- `backend-004` (owner: `tasks/plan-backend.md`): red `test_items.py` returned 404 for absent draft creation. Green `python -m pytest backend/tests -q -p no:cacheprovider` (5 passed on isolated MySQL 8.0.42). Verified separate cases, stable product IDs with two placements, exactly one list row, partial/invalid values and stale save rejection. Reviewed scoped editor lock and revision, no release/audit write on save. No commit.

- `backend-005` (owner: `tasks/plan-backend.md`): red `test_config.py` returned 404 for absent fixed-slot route. Green full isolated MySQL suite (6 passed) and Alembic metadata check; initial upgrade and 0002 seeded only six empty identities. Verified fixed-slot identity, stable node IDs after rename, unknown slot, orphan/cyclic tree rejection and no live pointer after save. Inline review kept GET read-only and hierarchy tier constraint documented. No commit.

- `backend-006` (owner: `tasks/plan-backend.md`): red preview test found missing upload; green verified actual PNG decoding, MIME mismatch/storage failure, uploader-only staging, shared draft and historical references, manager denial and stale preview rejection. Fresh full suite run after following tasks included this verification. No commit.
- `backend-007` (owner: `tasks/plan-backend.md`): red append test returned 404; green used the current directory and selected product versions to append positions, preserve existing live, ignore duplicate additions and report inactive locations. No commit.
- `backend-008` (owner: `tasks/plan-backend.md`): red check returned 404; green verified missing-field results, per-item outcomes, authorization and zero release/audit writes. No commit.
- `backend-009` (owner: `tasks/plan-backend.md`): red publish returned 404; green backend suite (10 passed) verified original receipt replay, audit lookup constrained to the caller, new-key/old-revision refusal, authorization and injected pre-commit rollback. Inline review checked READ COMMITTED under the documented account/slot/item lock order. No commit.

- `backend-010` through `backend-013` (owner: `tasks/plan-backend.md`): pre-implementation tests failed on missing endpoints. Real MySQL green tests verify stale lifecycle confirmation, case independence, editor-only restoration and history, public release-only lists/counts, private-field projection, and revoking image exposure after the last public reference. No commits.
- `backend-014` (owner: `tasks/plan-backend.md`): standalone integration passed using two distinct real connections, complete configured positions and actual PNG bytes. Different keys gave 200/409, two same-key confirmations returned identical receipts, both catalogue paths agreed on the new version, restore did not advance live, and directory/authority changes blocked later operations. The prior publish test's injected pre-commit failure also verified rollback. No commit.

## Blocked

- `backend-015`: implementation/preflight exists in `backend/Dockerfile`, `deploy/`, and the readiness route. Shell syntax, local readiness and corrupted-bundle checks pass. `test_docker_runtime_prerequisite` explicitly fails because Docker is not on PATH; `docker compose config`, container lifecycle, signed backup on the real host and restore have not run. Do not mark complete.
- `backend-016`: acceptance harness in `backend/tests/test_recovery.py`; the source/second-enterprise/clean-host manifest is absent, so `test_clean_host` explicitly fails prerequisite. Local file-verifier rejection of a damaged artifact is not evidence of remote recovery. No Tencent Cloud connection or deployment authorized or attempted.

- `frontend-002` / `AUTH`: the approved source does not show login and forced password change. Visual gate `CANNOT_VERIFY`; no real E2E evidence or attempts. Visual source and case owner: `tasks/frontend/05-interfaces.md`; required E2E location: `.fp-execute/e2e/frontend-002/AUTH/coverage-matrix.md`. Remaining core visual gaps are recorded per case in the same canonical contract. No completion checkbox set on this basis.

## Notes

- Direct `fp-execute`, automationMode=full. The user authorized implementation after the exact plan and directory tree were shown. No Git commit or push authorization.
- The user explicitly allowed MySQL >=8.0 and prohibited downloading a new MySQL server locally. The partial 8.4 archive was stopped and removed. Use installed MySQL 8.0.42, isolated loopback port and new data directory; no existing or remote database touched. 8.4 LTS remains the original delivery recommendation, not the local test prerequisite.
- User supplied Tencent Cloud ports 5000 and 5001 for deployment planning. No cloud connection, firewall change, migration or deployment performed here.
- `frontend-001` red: `node --test frontend/tests/contracts.test.mjs` exited 1 because the planned public client module did not yet exist. Build-only task, no business UI lifecycle gate.
- No `.codegraph/` in the initial checkout; no graph initialization or sync. `crapper`, `dryer`, `mutator` were not on PATH; no installation or quality-tool claim.
- Final local verification: backend `pytest` 17 passed with the two explicit deployment acceptance prerequisites deselected; the full run reported precisely those two prerequisite failures. `alembic check` found no drift. Frontend typecheck and H5/PC builds passed; four transport/artifact tests passed. `bash -n` passed for both scripts. Remaining at 15/27 by owner checkboxes, not eligible for final review.
- Isolated MySQL 8.0.42 on 127.0.0.1:1604 initially supervised by Monitor `b53zudeys`, with a 300-second health cadence, confirmed-failure restart only for its own child, at most three restarts. The temporary directory and credentials are not part of the repo; no association with the existing local MySQL service or Tencent Cloud. Monitor windows were limited to 30 minutes.
- Follow-up on backend-015/016: locally reproduced fail-open restore after an unsuccessful Compose status probe and duplicate origin aliases counted as separate deployments. Both gaps now fail closed. Added a verification-only command, tested with a real disposable GPG keyring plus separate wrong-signer, corrupted-file, failed status and duplicate origin checks. `pytest backend/tests/test_recovery.py -k 'not test_clean_host or rejects_aliases'` returned 4 passed, 1 deselected. Full host deployment/recovery is still blocked; no data imported, no cloud connection, no UI evidence, no plan checkbox changed.
- The replacement background watchdog `bfg1m5h11` ended with a killed/stopped event. Scheduled fallback was cancelled to avoid undoing an intentional stop; the watchdog was not relaunched.

## 本地实机验收补记 · 2026-11-22

- 先前的「没有 UI/没有浏览器证据/未授权 Git」是当时情况。本轮按用户明确指定的两份 HTML 对照真实 H5 与 PC，并收到仅本地提交的授权。不推送、不建 PR、不连接云服务器。
- [本机 MySQL 与 Chrome 验收报告](e2e/local-mysql-20261122.md)区分 3306 项目库、非默认端口专用回归库和有内容的隔离视觉实例。无公开业务数据被内置或遗留在指定库中；只保留归档历史和审计。
- 红绿验证：原生 H5 按钮样式被 uni-app 改写，只剩 `uni-button` 选择器；浏览器读出 `2px` 默认边框及 23px 分类行。修正为稳定属性选择器后浏览器核对 0px 边框、48px 分类行和键盘切换。后台无草稿的下架列表因没有 live 指针而丢失标识；实库测得按名 `total=0`，修后用最近历史仅作为私有列表摘要，未回填 draft/live。受影响 schema/items/lifecycle 套件 4 passed，真实归档按钮和历史读图复验通过。
- 单条与批量未知发布结果共用只读核单入口；测试核对已有回执无写入、空单取消无写入、明确同意才使用原键及修订。传输层单测不是一次真实断网验收。
- 规范来源按当前 `fp-docs/manifest.md` 解析：FastAPI 使用 README 项目规则，不套 Django；PC 与 H5 使用 Vue 规范。提交范围只选源码、测试、部署说明、锁文件与根 Git 控制文件；本机口令、配置、测试数据与原稿不在其中。
- 此次是本机功能验收，不是所有 case 的新视觉结论。保留 canonical checkbox 15/27；缺批准状态/真机/真实回执中断/跨机恢复的 case 不推进正式终审。没有现成 `.codegraph/`，未创建或同步索引。
- 本地交付提交：`15e5d772fc5e3a057e9661862914f8698692652b..fdaa747da82fdd92b236f65742a97aa081ea500f`，分支 `feat/cosmetics-showcase-mvp`，提交树 `6c896e7a15eb6a80c103ca889f9d3fad1e4d85ca` 与受审暂存树相同。106 个文件，包含根 `.gitignore`，开发机私有运行目录与原稿/流程材料未纳入。最后一次两端 typecheck、build、22 项 Node 测试、真实浏览器控件几何/键盘回归及公开主流程均通过。后端 20 项本机用例通过，完整执行另报 2 项环境前提失败，未推送、未建 PR。
