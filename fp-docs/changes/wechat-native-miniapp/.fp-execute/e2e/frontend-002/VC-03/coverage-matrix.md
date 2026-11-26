# frontend-002 / VC-03 — 品牌案例

- Source: [设计：页面视图](../../../../design/frontend.md#页面视图)、[计划：VC-03](../../../../tasks/plan-frontend.md#uie2e-delivery-contract)。
- Route: `pages/cases/index` → `pages/case/index` → 返回；角色：匿名访客（待验证）；UI Delivery Level: `interactive`。
- E2E Applicability: `REQUIRED`；E2E Result: `BLOCKED`。未找到可用的微信开发者工具；未对真实目的地执行（0 次），无截图或网络记录。Mocked Core API: 尚无真实执行；真实验收须为 `false`。未创建 E2E 数据，无 E2E 清理操作。
- Visual: [同一 Case 的视觉证据](../../../visual/frontend-002/VC-03/manifest.md)。

| Source-derived condition | Status | 真实验收依据（待采集） |
| --- | --- | --- |
| 真实标签、关键词、清空、精选首条，超 20 条分页不重复 | BLOCKED | 正常发布合成样本；观察真实列表顺序和查询请求 |
| 搜索/追加竞争、空、断网、重试；详情返回保留列表位置 | BLOCKED | 实际用户操作和安全网络故障，保留当前列表或重试 |
| 独立详情、字段/图片、正常后台撤下后旧入口不可用 | BLOCKED | 同一合成案例 ID 发布→浏览→撤下→重入；实际响应和 UI 结果 |
| 小程序内写入业务结果 | N/A | 公开只读；QA 数据通过现有后台正常流程准备 |
