# frontend-002 / VC-02 — 产品目录

- Source: [设计：状态与流程](../../../../design/frontend.md#状态并发与执行流程)、[计划：VC-02](../../../../tasks/plan-frontend.md#uie2e-delivery-contract)。
- Route: `pages/catalog/index` → `pages/product/index` → 返回；角色：匿名访客（待验证）；UI Delivery Level: `interactive`。
- E2E Applicability: `REQUIRED`；E2E Result: `BLOCKED`。未找到可用的微信开发者工具；未对真实目的地执行（0 次），无真实截图或请求记录。Mocked Core API: 尚无真实执行；真实验收须为 `false`。未创建 E2E 数据，无 E2E 清理操作。
- Visual: [同一 Case 的视觉证据](../../../visual/frontend-002/VC-02/manifest.md)。

| Source-derived condition | Status | 真实验收依据（待采集） |
| --- | --- | --- |
| 两个板块、三级分类、默认项及计数 | BLOCKED | 从 QA 常规发布的条目确认匿名查询范围与标签/计数对应 |
| 分类、板块、关键词切换；快速输入或分页时不混入旧查询数据 | BLOCKED | 真实请求参数和列表结果，与用户实际选择一致 |
| 有序追加、追加失败保留/重试、无结果和首屏失败状态 | BLOCKED | 至少 21 条合成发布商品；安全触发真实网络故障再恢复 |
| 详情返回及跨板块恢复分页、筛选、位置；主动刷新重读 | BLOCKED | 在真实微信页面栈回退、切板块，再用正常发布更改验证刷新 |
| 登录和业务写入 | N/A | 目录为公开只读 |
