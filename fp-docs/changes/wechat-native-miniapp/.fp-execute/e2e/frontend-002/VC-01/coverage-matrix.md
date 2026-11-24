# frontend-002 / VC-01 — 首页海报

- Source: [设计：状态与流程](../../../../design/frontend.md#状态并发与执行流程)、[计划：VC-01](../../../../tasks/plan-frontend.md#uie2e-delivery-contract)。
- Route: `pages/home/index`；角色：匿名访客（待在真实运行时验证）；UI Delivery Level: `interactive`。
- E2E Applicability: `REQUIRED`；E2E Result: `BLOCKED`。未找到可用的微信开发者工具，未对真实目的地执行命令（0 次），无截图、网络日志或设备记录。
- Mocked Core API: 尚无真实执行记录；正式验收必须为 `false`。本地脚本使用受控回调，仅用于本地测试。未创建真实 E2E 数据，无 E2E 清理操作。
- Visual: [同一 Case 的视觉证据](../../../visual/frontend-002/VC-01/manifest.md)。

| Source-derived condition | Status | 真实验收依据（待采集） |
| --- | --- | --- |
| 匿名首页读取两张真实发布长海报并展示完整宽度 | BLOCKED | QA 后台按常规 UI 发布；微信运行时确认读取公开页和对应媒体，能看完两张图 |
| 手势翻页；首页隐藏、向下读或触控不误跳；回到顶部空闲后轮播 | BLOCKED | 模拟器/真机观察原生 `swiper` 和滚动，覆盖 4 秒自动轮换 |
| 未发布、媒体故障、加载错误与重试 | BLOCKED | 使用 QA 缺图或实际连接失败场景；不注入请求或内容 |
| 登录、写入和持久化 | N/A | 公开只读首页，没有这些功能 |
