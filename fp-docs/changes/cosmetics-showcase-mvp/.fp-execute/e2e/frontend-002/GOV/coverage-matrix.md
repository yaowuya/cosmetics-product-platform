# Frontend 002 / GOV — Coverage matrix

- Delivery level: `business-flow`; E2E applicability: `REQUIRED`.
- Source: `../../../../tasks/frontend/05-interfaces.md`, Visual Case `002 GOV`; PRD §3.7.
- Lifecycle: `SOURCE_READY` blocked for uncovered required variants. The approved static workbench/account views do not establish all empty states and account-opening forms. No `VISUAL_REVIEW_PASS` or `FRONTEND_E2E_PASS` is claimed.
- Attempts: 0. No browser steps or real UI writes; no case data to clean.

| Source-derived condition | Status | Evidence or reason |
| --- | --- | --- |
| Admin opens and disables an account | BLOCKED | Approved opening form/empty variants and real route are required. |
| Role grants remain split and auditable | BLOCKED | Uses independent approved browser sessions after visual gate, not API fixtures. |

### 后续本地实测（先前的 0 次是当时状态）

2026-11-22，首管在管理页面开通 E、P，撤销并恢复 P 发布权限；P 的旧确认页被服务端以 403 拒绝。最后经 UI 停用两个验收账号，实库只有一个启用的治理账号。详见[本机验收记录](../../local-mysql-20261122.md)。已测试分支不能代替空工作台、所有表单变体及逐 case 的独立视觉门禁，本项不勾选。
