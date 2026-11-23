# Frontend 002 / AUTH — Coverage matrix

- Delivery level: `business-flow`; E2E applicability: `REQUIRED`.
- Source: `../../../../tasks/frontend/05-interfaces.md`, Visual Case `002 AUTH`; PRD §3.7.
- Lifecycle: `SOURCE_READY` blocked. No approved reference for the login/change-password/error states. No production UI route was created for this case; the API-only auth test does not substitute for browser evidence.
- Attempts: 0. No E2E command was executed. No case data was created or requires cleanup.

| Source-derived condition | Status | Evidence or reason |
| --- | --- | --- |
| First sign-in is confined to password change | BLOCKED | Approved login and password-change state references are absent. |
| Reject bad input without exposing credentials | BLOCKED | Approved failure state and real UI are absent. |
| Logout and expiry cannot continue a private action | BLOCKED | Requires the real route and independent browser session after visual review. |

### 后续本地实测（先前的 0 次是当时状态）

2026-11-22，`/admin/login` 真实路由已存在。在 3306 项目库上，从首管及新开账号登录、先改密再进工作台，停用后原会话写入返回 401。见[本机验收记录](../../local-mysql-20261122.md)。以上分支有浏览器和持久化证据；完整错误态视觉、全部登出/自然过期分支未达到本 case 的独立验收条件。整体仍为 `BLOCKED`，不把旧结论或 API 单测当作新的 UI 通过。
