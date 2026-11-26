# frontend-002 / VC-04 — 产品详情与联系

- Source: [设计：页面视图](../../../../design/frontend.md#页面视图)、[计划：VC-04](../../../../tasks/plan-frontend.md#uie2e-delivery-contract)。
- Route: `pages/product/index`、`pages/contact/index`；角色：匿名访客（待验证）；UI Delivery Level: `interactive`。
- E2E Applicability: `REQUIRED`；E2E Result: `BLOCKED`。未找到可用的微信开发者工具；未对真实目的地执行（0 次），无模拟器或设备证据。Mocked Core API: 尚无真实执行；真实验收须为 `false`。未创建 E2E 数据，无 E2E 清理操作。
- Visual: [同一 Case 的视觉证据](../../../visual/frontend-002/VC-04/manifest.md)。

| Source-derived condition | Status | 真实验收依据（待采集） |
| --- | --- | --- |
| 详情长图、已发布字段、复制配方编号、栈/直接入口安全返回 | BLOCKED | 正常发布合成商品，两种进入方式、实际系统复制与返回 |
| 详情独立请求，撤下后同 ID 不可用，私有图不可加载 | BLOCKED | QA 正常发布/撤下，同 ID 前后请求和图片读取，不访问生产数据 |
| 联系方式按发布内容展示，电话/微信号/邮件/二维码原生动作 | BLOCKED | 真机拨号后取消、核对复制值并清除测试剪贴板、预览二维码 |
| 缺字段不伪造按钮；媒体错误、调用拒绝与重试 | BLOCKED | QA 合成缺字段，触发实际平台拒绝或连接失败 |
| 小程序内登录和业务写入 | N/A | 无该入口；系统动作不写业务数据库 |
