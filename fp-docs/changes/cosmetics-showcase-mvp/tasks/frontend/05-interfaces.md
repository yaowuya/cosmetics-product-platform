# 前端接口与交付证据契约

## 1. 来源和浏览器能力

没有 Figma node、FIGCAP 或 PRES 台账；绿地项目也没有生产回放可保留。用户本轮明确批准两份本地 HTML 作为设计稿。它们只证明画出的视觉状态；原型中的模拟账号、示例业务数据和模拟交互不能充当运行或 E2E 证据。

| 来源代号 | 已批准源及修订（Git blob） | 原稿范围／不能证明什么 |
| --- | --- | --- |
| H | `docs/cosmetics-platform-design-spec/prototype/index.html`，`0d6cd00345a02ba8c2f60e67a4d3a2e4b883e87f`；配套 `docs/设计稿细则与需求汇总.md` 以交接包为根 | 首页、目录、产品详情、案例、服务及弹层。只取设计内容区，不比较电脑模拟手机外框；示意码、客户名、生产状态不证明真实资料。 |
| P | `fp-docs/changes/cosmetics-showcase-mvp/prototype.html`，`872dc567b11737762c99ca7f3c9c160d7ba0cf42` | PC 工作台、全部产品/案例、版本记录、配置和发布确认等页面，以此稿的 L 型浅灰框、218 px 侧栏、白色工作区和深墨主按钮为准。未绘制的登录/改密按同稿控件实现，真实校验以接口和 E2E 为准；不声称有这些状态的原稿截图。 |
| G | 对应行写明缺口，不存在对应的已批准状态图 | 登录/改密、完整产品及案例筛选列表、删除/归档确认、批量勾选/追加/检查/断线回执、并发冲突、详细错误等未画全。逐变体向设计方取得获批静态图/设计节点及修订，可沿用已批准的局部；拿不到则该变体 `CANNOT_VERIFY`、任务 `BLOCKED`。不拿当前实现截图反向生成标准。 |

## 2. Frontend Interface and Visual Contract

### 2.1 路由、组件与样式

| Contract | Owner Task | Exact shape / behavior | Consumers | Verification |
| --- | --- | --- | --- | --- |
| 入口与壳 | frontend-001、002 | HTTPS 同源；`/admin/` 子路径仅 PC；`/api/**` 不回退到 HTML。其余 H5 深链保留查询，页面别名写入 uni 页注册；公开四页是 `/`、`/catalog`、`/cases`、`/contact`，产品 `/products?id=…`、案例 `/cases/detail?id=…` 共享案例视图。`/preview?id=…&revision=…` 是私有 H5 宿主，不是第五页。 | 两端代理、路由守卫 | 未先入首页的深链、刷新、403、API 404 不被吞。 |
| H5 展示 | frontend-006 | `ShowcaseNav` 固定四页、白底黑字浅蓝点缀，约 58 px 加安全区。`PageContent` 按固定位置消费投影；`ProductView(mode=card/detail)` 与 `CaseView` 接收视图数据并上报打开/返回/复制；不根据账号自行取数。 | public 宿主；frontend-007 预览 | 四页标签名称顺序、最后一项可读；详情遮住背景导航，无企业栏。 |
| 浏览状态 | frontend-006 | 板块→分类→细类/关键词及左右滚动；点新分类清细筛及右列位置。请求响应只提交到相同查询代次；搜时隐藏细筛，退出恢复。仅本次浏览记忆。案例手动删空保留类、显式清空回精选。 | 目录/案例/详情 | 来源 PRD §§3.2–3.4：总数不随细筛；过时响应不覆盖新字；深链返回有合理入口。 |
| 桌面工作区 | frontend-002–005 | `App` 侧栏/标题/工作区；Element Plus 原生表格选择、过滤、分页，表单/对话框/上传回显组合。宽屏表单与预览并排，窄屏纵向；`--frame:#f1f5f6`、`--sheet:#fff`、`--r:8px`、`--gap:20px`。操作、缺项、未完成不能仅用颜色表示。 | 账号/配置/两列表 | 对照九个画板相应局部；窄窗操作区不被遮盖。 |
| 客户端与会话 | frontend-001、002 | public 只读不携带管理凭据、不从查询切换取数；管理写入使用同源会话、来源校验、`X-CSRF-Token`，不在 URL、前端持久层或日志放口令/令牌。`401` 回登录，`403` 重取能力闭合敏感视图；登出清私有缓存。 | 所有读写 | 已登录仍走 public 投影；旧页向真实服务发起的失败操作不报成功。 |

### 2.2 API、状态与核对

以下是两端协作约定，不假装已有服务。路径族、访问控制、响应字段以[后端设计](../../design/backend.md#接口权限与兼容边界)及后端任务的 wire 细目为准。`A=/api/admin`，`U=/api/public`，`I=A/items/{id}`；ID、修订以十进制字符串流转，不转 JS Number；`seq`、页码与计数为数值。分页为 `{items,total,page,page_size}`；错误 `{code,message,issues:[{field,reason}]}`；不假定 `data` 包装。

| Owner / 服务提供者 | Consumes → Produces | 不变量与验收点 |
| --- | --- | --- |
| 002 / backend-002、003 | `GET A/login` 取匿名 CSRF → `POST A/login` → 强制改密时仅可 `POST A/change-password` 或 `POST A/logout`，改密后 `GET A/me`；`GET/POST A/accounts`、`PATCH A/accounts/{id}`、`GET A/audit` | `can_edit/can_publish/can_manage/must_change_password` 分开；首登先改密；匿名、失效、停用、撤权及审计裁剪。 |
| 003 / backend-005、006 | `GET A/config/{slot}`，slot 与[后端账本](../plan-backend.md#backend-interface-ledger)六个固定槽一致；`PUT I/draft {expected_revision,body,place_ids}`；`POST A/media` → `{id,url}` | 固定槽同一条目，草稿不换 live、无效字段不进入持久状态。未关联上传 URL 仅本人；关联后按条目与修订或版本读图。 |
| 004 / backend-004、010 | `GET/POST A/products` 或 `A/cases`、`GET I`、`PUT I/draft`、`DELETE I/draft {expected_revision,confirmed:true}` | 两种列表，线上状态与草稿分开筛；每个 ID 一行，分页稳定；取消不发写。409 保留本地输入；只有从未发布草稿可删。 |
| 005 / backend-008、009 | `POST I/check {expected_revision}` → `id,revision,eligible,issues,place_ids`；`POST I/publish {expected_revision,request_key}` → `id,revision,release_id,seq,request_key` | 同一差异/确认面板用于列表、配置、目录；字段错误回到原控件；`422` 不动线上、无草稿禁用。缺字段不从 live 补。断线先只读核单；手动重试仅原键原修订。 |
| 006 / backend-012、013 | `GET U/pages/{home,catalog,cases,contact}`、`U/catalog`、`U/products[/{id}]`、`U/cases[/{id}]`、`U/media/{id}` | 目录查询按当前有效板块/分类/细筛/关键词；分类总量与搜索命中分开。两组联系内容读独立快照。不把私有或下架内容投影给访客。 |
| 007 / backend-006 | 私有 `GET I/preview?revision=…` → `id,kind,config_slot,revision,body,place_ids,media_urls`，直接按回应的类型和槽选共享视图。 | 无有效 ID/修订不请求；切换清空，匹配当前 ID、修订和请求轮次才渲染；迟到成功或失败均丢弃。409 不补读最新草稿、I 或 public；失权清空。 |
| 008 / backend-011 | `GET I/versions`；`POST I/versions/{seq}/restore {expected_revision,confirm_overwrite}` → 新草稿 Item；历史图使用 `item_id`/`seq` 私有入口 | 两者都需当前编辑权；既有稿需确认覆盖；409 不覆写；只新增恢复审计，无线上写入。 |
| 009 / backend-007–009 | `POST A/products/batch-append {items:[{id,expected_revision}],node_ids}`；`POST A/products/batch-check {items:[{id,expected_revision}]}` → `items[]`；复用逐条 `I/publish` | 不重复追加；确认数等于合格数，零款禁用。中断后已提交款按原键核对；尚未发起款不发布、不续发。 |
| 010 / backend-010 | `GET I/impact` → `case_ids,cases`；`POST I/unlist` 或 `I/archive {expected_revision,confirmed:true,case_ids}` | 确认前列关联案例；提交时集合变化要重核，不连带写案例；有历史永不删除，已下架才可归档；取消不发写。 |

**已和后端对齐的传输细节**（实现以[后端计划接口表及联调细则](../plan-backend.md#backend-interface-ledger)为准）：

- 新建位置先 `POST A/directory/nodes {}` → 201 `{id}`，ID 入 directory 正文 `nodes`，再用 `PUT I/draft`，分配本身不改变线上树。
- 后台 `state=online|offline|archived`、`has_draft=true|false` 可独立或组合；offline 指未归档且无 live，默认不含归档。只给产品传 `node_id`；`total` 始终按 ID 去重。表单及配置逐字段按后端计划接口表；案例 `place_ids=[]`。
- 目录 `counts` 为板块/节点及子树去重结果，不受细筛；列表 `total` 为实际匹配数，案例 `tag` 匹配 `category_key`。四页 `{page,body}` 的固定槽映射、素材投影和 `{services,business_contact}` 的独立版本按[后端联调细则](../plan-backend.md#backend-interface-ledger)。私有草稿用原字段，预览图只以本回应的 `media_urls` 解引用。
- `GET A/audit?target_kind=product&target_id={id}&request_key={key}&page=1&page_size=1` 查当前发布人原键；其他条目换对应 kind。仅 `details.receipt` 匹配原绑定算成功，空结果仍未知；手动重试须再次核对、复用原绑定与原键，永不静默重发。

### 2.3 Visual Evidence Manifest

每行是一个实际 `Task ID + Case ID`，表内代号是确定性字段展开规则，不是空白模板。若一行含多个状态/尺寸，对每个变体按相同路径下的 `variants/<名称>/` 再采 reference/current 并在主 `manifest.md` 列全，不拼成一张图代替覆盖。`P#…`、`H` 用 §1 的固定 revision 与 SHA；`+G`/`G` 按列明缺口补正式来源，否则不进入视觉通过。首次与每次重审校验 source hash、资源和环境；变更时记录获批时间/修订，不沿用旧图。

- 对每行展开 `V=.fp-execute/visual/frontend-<三位号>/<Case ID>/`（相对于变更目录）：`M=V/manifest.md`，`R=V/reference.png`，`C=V/current.png`，`D=V/diff.png`。可选 diff 缺失须在 M 写 `missing diff` 和原因；不得替代 R/C。Figma node、variables/Auto Layout 均 `N/A: 非 Figma`；assets/token 来自对应静态源，G 部分为未批准。Mask `None`；稳定数据与时间，无法固定的非业务时间戳须明确记录局部再核准，不能遮挡内容/状态。
- `PC` = 1440×900、窄窗 768×900；`H5` = 360×800、390×844、400×844；这些是可复现的抽样环境，不是新增断点。桌面采集 DPR 1、`zh-CN`、light，验证 `devicePixelRatio/navigator.language`，保存实际字体与浏览器版本；不符先配置环境。`真机` 另记实际机型、系统/浏览器、安全区、视口/DPR。所有视觉场景用隔离环境、企业授权的无敏感相同尺寸素材；标识以稳定业务名/数量定位，真实运行分配的 ID 只记入证据。原稿的示意资料可对照版式，不能冒充正式企业资料。
- 每行 Command/tool 均为 `CAP`：在已有 CLI 分离的 `-s=ref` 打开获批静态文件/画板并到同一状态，`-s=current` 在真实同源目标 URL 通过本行 UI 操作到状态，分别执行 `playwright-cli -s=ref resize W H`、`playwright-cli -s=current resize W H`、`playwright-cli -s=ref screenshot --filename="$R"`、`playwright-cli -s=current screenshot --filename="$C"`；运行前按行设置 W/H、R、C，并把完整命令、路由、状态、数据/环境摘要写 M。真机补原生截图，CLI 模拟只作对照。无正式对照，不执行冒名截取。核心视觉独立只读审查按 case 逐项比，不设全局像素阈值。

| Task ID + Case ID | Approved design source / revision | Frame/variant / assets | Runtime route | Scenario/state / deterministic non-sensitive fixture | Viewport | Acceptance rule | Reference / Current / Diff | Failure class / Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 002 AUTH | G | 登录/首次改密/错误 | /admin/login | 新初始管理员→改密，失效会话 | PC | 强制改密不露工作区，密码不回显 | R/C/D | core / CANNOT_VERIFY |
| 002 GOV | P#desk、#accounts + G | 侧栏、权限表与审计；G 开通表单/空工作台 | /admin/、/admin/accounts | 新开 E、P，A 无编辑权 | PC | 账号、状态、能力分列，空数据不造计数；窄窗能操作 | R/C/D | core / PENDING；G 阻塞 |
| 003 CONFIG | P#pages、#contact、#cases + G | 四页配置、上传失败 | /admin/pages | 四张顺序海报、独立服务图与未配联系、上传失败 | PC | 各配置位置清楚；旧图保留、提示不吞文字 | R/C/D | core / PENDING；失败态缺图 |
| 003 TREE | P#catalog + G | 板块列表与树；G 节点编辑控件 | /admin/directory | 三板块、一类无细类，调整顺序并停用一项 | PC | 只改同级顺序，列出受影响位置，不显示删除产品 | R/C/D | core / PENDING；G 阻塞 |
| 004 LIST | P#desk、#accounts 局部 + G | 条目/标记、表格；G 两列表全页/筛选与空结果 | /admin/products、/admin/cases | 同一双位置草稿，两种名称检索，0/多页 | PC | 一款一行，线上与草稿双标，案例无产品批量入口 | R/C/D | core / CANNOT_VERIFY 全页 |
| 004 EDIT | P#product、#cases + G | 两种编辑表单、换图失败/离开确认 | /admin/products/:id、/admin/cases/:id | 缺长图产品、可空关联案例，各做二次编辑 | PC | 产品/案例字段不串；缺项仍可存，未提交内容不误清 | R/C/D | core / PENDING；G 阻塞 |
| 004 DELETE | P#history 仅危险动作分区 + G | 两种首次草稿删除/取消，无正式确认框 | /admin/products、/admin/cases | 从未发布的测试产品与案例 | PC | 显示本条身份及后果，取消/确认明显不同 | R/C/D | core / CANNOT_VERIFY 确认态 |
| 005 SINGLE | P#release、#desk + G | 差异、缺图、合格确认与单条反馈 | /admin/products/:id、/admin/cases/:id、/admin/pages、/admin/directory | 测试产品双位置、独立案例、目录和配置，缺项/补齐、无稿 | PC | 列出字段与影响位置，不能把多条或整站误作本条；非产品差异布局缺对照则停 | R/C/D | core / PENDING；G 阻塞 |
| 006 HOME | H 首页 + G | 海报/圆点/固定导航；G 无图/坏图状态若原稿不能取 | / | 已核可的四海报、空集及仅一张可展示 | H5 | 4 秒、按住/读长图/离开暂停，回顶恢复；一张静止、零张无坏图/多余圆点 | R/C/D | core / PENDING |
| 006 CATALOG | H 产品目录/详情 + G | 目录/细筛/搜索/返回/复制回退 | /catalog、/products?id=… | 一类三款、细类一款；同款两位置、无效 ID、长名称 | H5 | 封面约 2.6∶1、36 px 搜索、约 80 px 左栏，右端总数 3；详情 16∶9、六项一长图，复制失败可选文本 | R/C/D | core / PENDING；缺失错误变体阻塞 |
| 006 CASES | H 案例 | 重点横卡/双列/详情/搜索 | /cases、/cases/detail?id=… | 相同类别一条、多条、零命中、无内部关联案例 | H5 | 首条约 61∶39，其余双列；一条无空网格；显式清空和手删空不同，不显示内部跳转 | R/C/D | core / PENDING |
| 006 CONTACT | H 联系 + G | 服务长图/两入口弹层；G 非示意码实配态 | /contact | 已公布服务长图、无可选渠道，另配授权测试联系资料 | H5 | 标题 17 px，服务图等比可放大、关闭回原处；两处用同一弹层，未配不显示无效操作 | R/C/D | core / PENDING；G 阻塞 |
| 007 BAD | P#product、#release；H 目录 | 草稿缺图与线上旧版 | /admin/products/:id → /preview → /catalog | 两处线上同款、缺长图新稿 | PC/H5 | 私有卡片/详情与公开同布局不同版本；访客两处仍旧 | R/C/D | core / PENDING |
| 007 LIVE | P#release；H 目录/详情 | 补图上线 | 同 BAD | 同 ID 补图并确认，旧稿文案与新文案可识别 | PC/H5 | 发布后两处同版、同裁切；原卡片无草稿标识 | R/C/D | core / PENDING |
| 007 RACE | P#product 局部 + G | 保存及旧确认的并发冲突 | /admin/products/:id、/preview | E1 和 E2 同修订保存；P 持旧预览 | PC/H5 | 保留输入；冲突与成功可区分，不能悄换新版 | R/C/D | core / CANNOT_VERIFY 冲突态 |
| 007 STALE | P#product 局部 + G | 非法参数及过期预览的空画面、错误提示 | /preview | 同一条目的旧修订；缺 ID 或非法修订；新修订可作对照 | PC/H5 | 无有效参数不请求；旧修订只提示冲突，不显示新稿或线上 | R/C/D | core / CANNOT_VERIFY 缺获批失败态 |
| 007 SWITCH | P#product 局部 + G | 从甲切乙时清空、加载及匹配结果 | /admin/products/:id、/preview | 两份已存稿，独立真实受控慢连接延迟甲结果 | PC/H5 | 切换不留甲画面；乙出现后甲的成功或失败不改变画面或提示 | R/C/D | core / CANNOT_VERIFY 缺获批切换态 |
| 008 REST | P#history + G | 版本、覆盖既有草稿/冲突与拒发 | /admin/items/:id/history | 同款两个版本、同时打开的编辑、另有对照条目 | PC | 确认写明条目、来源版本和覆盖；线上版标识不变 | R/C/D | core / PENDING；覆盖/冲突待图 |
| 009 APPEND | P#product 局部 + G | 产品选择/追加去重/逐款回显 | /admin/products | 已有位置、已有新文案、未选对照三款 | PC | 明示仅存草稿；逐 ID 反馈不冒充上线 | R/C/D | core / CANNOT_VERIFY 批量态 |
| 009 BATCH | P#release 仅单条 + G | 多选、逐款检查、零款、部分成功与未知回执 | /admin/products | 8 合格＋1 缺图＋1 无稿，另有未选合格 | PC | 明示「发布这8款」，零款禁用；未知、跳过、成功各用文字区分 | R/C/D | core / CANNOT_VERIFY 批量态 |
| 010 REVOKE | P#accounts、#release + G | 撤权/停用旧页面 | /admin/accounts、/admin/products/:id | A、P 两个账号；旧页两次写操作 | PC | 说清未执行，撤权和停用后剩余能力有别 | R/C/D | core / PENDING；旧页受拒待图 |
| 010 UNLIST | P#history；H 目录/案例 | 关联提示、取消、确认 | /admin/products/:id → /catalog、/cases | 两处同款与独立线上案例 | PC/H5 | 关联名单可识别；取消不变，下架只移产品 | R/C/D | core / PENDING |
| 010 ARCH | P#history、#accounts 局部 + G | 归档阻止/确认/退出日常列表 | /admin/products、/admin/cases | 已发布的产品与案例各一，另保留关联案例 | PC | 不允许在线直接归档，不删历史；归档后仍有检索入口 | R/C/D | core / CANNOT_VERIFY 归档态 |
| 011 QR | P#contact、#history；H 联系 + G | 正确/错误两版码，恢复后重发 | /admin/pages → /contact | 企业授权的两张非敏感可验测试码；服务卡不变 | PC/H5 | 两入口同码，无码无保存；单条纠正不挪服务区 | R/C/D | core / PENDING；G 为实配态 |
| 011 OTHER | H 四页 + P 四页编辑 | 第二部署四页/同版式不同内容 | 两个域名的公开四页、/admin/ | 第一家五板块 43 类和四海报；第二家护肤/彩妆/香氛与独立图文 | PC/H5 | 无写死的微肽文案/板块/联系方式；按同布局核，不拿第一家文案作为第二家基准 | R/C/D | core / PENDING |
| 011 PHONE | H 四页 | 真机安全区、返回、长按/复制 | /、/catalog → /products?id=…、/cases、/contact | 核准长海报/服务图，真实手机复制成功与拒绝、真实码 | 真机+H5 | 可读最后一项，保存/系统长按有可用路径，拒绝复制可选文本 | R/C/D | core / PENDING；无真机 BLOCKED |
| 011 DR | P#history、#product；H 详情 | 异机恢复后同一版本/草稿/历史图 | 恢复域 /admin/items/:id/history、/preview、/products?id=… | UI 建立三个可辨内容/图片并记录 ID，再备份、异机恢复 | PC/H5 | 公开只见线上图；历史图和草稿仍能授权显示且匿名拒绝 | R/C/D | core / PENDING；无恢复机 BLOCKED |

### 2.4 UI/E2E Delivery Contract

以下独立表不持有视觉字段。`L` 是 `SOURCE_READY → STATIC_UI_READY → VISUAL_REVIEW_PASS → INTERACTION_READY → FRONTEND_E2E_PASS`，其后才可 FINAL_REVIEW → ARCHIVE。`B=business-flow`，`I=interactive`，两者均 `REQUIRED`。`E=.fp-execute/e2e/frontend-<三位号>/<Case ID>/`，每行的 `K` **精确展开**为该行的 `E/coverage-matrix.md`，`e2e-result.md` 同目录。Route ref 指向上表同 case 的真实入口，不是设计路径。当前代码证据：尚无生产实现；执行时将实际源码路径/分支和代码修订填入 K。不得因暂无代码标 N/A。

| Task ID | Case ID | Source-derived condition / requirement reference | UI Delivery Level | Runtime route ref | E2E Applicability | Lifecycle | Coverage matrix | N/A / BLOCKED rationale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| frontend-002 | AUTH | §3.7：首登、错误、改密、退出、失效 | B | AUTH | REQUIRED | L | K | 需真实首账号及缺失正式状态图 |
| frontend-002 | GOV | §3.7：管理员开/停/授/撤；角色分权与限定日志 | B | GOV | REQUIRED | L | K | 空工作区/表单变体缺源即阻塞 |
| frontend-003 | CONFIG | §§3.1、3.4–3.5：替换、排序、空渠道、上传拒绝 | B | CONFIG | REQUIRED | L | K | 不安全触发的失败项阻塞 |
| frontend-003 | TREE | §3.2：层级排序、停用、无细类；保存后重开 | B | TREE | REQUIRED | L | K | 未批准编辑变体阻塞 |
| frontend-004 | LIST | §§3.3、3.4：名称/编号/分类、品牌/案例产品名、两轴筛选与翻页 | B | LIST | REQUIRED | L | K | 全页缺源；已上线且有草稿的组合由 007/BAD 在同一列表终验，本行独立验证已有稿/无线上及空集，不等待后续造数 |
| frontend-004 | EDIT | §§3.3、3.4：跨位置、不完整可存、未保存离开、案例独立 | B | EDIT | REQUIRED | L | K | 无法安全触发上传失败则阻塞 |
| frontend-004 | DELETE | §3.6 WF-008，两个列表的取消、删除、日志 | B | DELETE | REQUIRED | L | K | 首次草稿即可准备；缺正式确认态 |
| frontend-005 | SINGLE | §3.6：逐条校验、合格才写、版本/操作者、无稿/自发 | B | SINGLE | REQUIRED | L | K | 不依赖 H5 回读：先核 PC 的差异、回执和审计 |
| frontend-006 | HOME | §§3.1、4.1：页签、轮播暂停、单/无图 | I | HOME | REQUIRED | L | K | 单可展示图须合法产生，不能发布不合格轮播 |
| frontend-006 | CATALOG | §§3.2、3.3：总数/筛选/分页、慢响应、复制、详情未公开 404 | B | CATALOG | REQUIRED | L | K | 需真实 UI 已发布条目；真实慢网/拒绝无安全触发则阻塞 |
| frontend-006 | CASES | §3.4：清空两分支，首条、零条、单条、深链 | B | CASES | REQUIRED | L | K | 需真实独立发布案例 |
| frontend-006 | CONTACT | §3.5：放大返回、两入口、可选联系隐藏 | I | CONTACT | REQUIRED | L | K | 正式实配图缺失时不能报视觉通过 |
| frontend-007 | BAD | §3.6 WF-001：缺图不改两个线上位置，预览拒绝匿名 | B | BAD | REQUIRED | L | K | 需要 E、P、V 隔离会话 |
| frontend-007 | LIVE | §3.6 WF-002：补图后仅同款两个位置升级 | B | LIVE | REQUIRED | L | K | 与 BAD 联跑可共享 run/产品 ID，不共享判定 |
| frontend-007 | RACE | D-008、D-017 WF-012：并发保存与预览后旧确认 | B | RACE | REQUIRED | L | K | 真实旧页触发 409；缺正式冲突图 |
| frontend-007 | STALE | D-025 WF-013：旧预览单独返回冲突；缺/非法参数不取数 | B | STALE | REQUIRED | L | K | 不用发布拒绝替代预览证据；缺正式失败态图 |
| frontend-007 | SWITCH | D-025 WF-014：两条真实预览响应换序，旧响应不接管 | B | SWITCH | REQUIRED | L | K | 无可安全复现的真实延迟或缺正式切换态图即 BLOCKED |
| frontend-008 | REST | D-021 WF-003：无发布权编辑恢复、同事竞争、再发被拒 | B | REST | REQUIRED | L | K | 无法经真实旧页触发拒绝不伪造响应 |
| frontend-009 | APPEND | §3.3 WF-004：重复追加/只存选中草稿 | B | APPEND | REQUIRED | L | K | 正式批量交互图缺失 |
| frontend-009 | BATCH | §3.6 WF-005：8/1/1、0 合格、断线核回执与同批单款纠正 | B | BATCH | REQUIRED | L | K | 提交后丢回执必须真实发生；无法安全制造则 BLOCKED |
| frontend-010 | REVOKE | §3.7 WF-006：旧页撤权后仍编辑，停用后拒绝保存 | B | REVOKE | REQUIRED | L | K | 不使用客户端改角色/权限 |
| frontend-010 | UNLIST | §§3.3–3.4 WF-007：先取消再下架、案例仍在 | B | UNLIST | REQUIRED | L | K | 需真实公开投影重进 |
| frontend-010 | ARCH | §3.6 WF-009：拒绝直接归档/删除、归档后历史可追 | B | ARCH | REQUIRED | L | K | 不给 UI 暗加非法操作按钮来制造拒绝 |
| frontend-011 | QR | §3.5 WF-010：换码/纠正、公私图片最后引用 | B | QR | REQUIRED | L | K | 正式授权可扫码素材和独立 V 才可验证 |
| frontend-011 | OTHER | P-001、D-019 WF-011：第二企业真实隔离交付 | B | OTHER | REQUIRED | L | K | 缺独立第二部署或核准资料即阻塞 |
| frontend-011 | PHONE | §4.1、§五：窄屏设备、平台复制和保存回退 | I | PHONE | REQUIRED | L | K | 模拟器/桌面不能替代真机记录 |
| frontend-011 | DR | D-019：异机重进线上、草稿、历史图与权限 | B | DR | REQUIRED | L | K | 同机重启/仅后端备份成功不算还原 |

**履行每行 L 的方式**：保存来源与环境指纹，再完成静态 UI。独立只读 reviewer 只写视觉报告，比对真实路由状态和 R/C/D；审查前读 `${CLAUDE_PLUGIN_ROOT}/skills/_shared/visual-review-reuse.md`。缺批准的核心变体不能过视觉门禁。视觉 FAIL 只回 STATIC_UI_READY，交互 FAIL 回 INTERACTION_READY；输入或画面变更重审。最多三次；第三次不通过维持 BLOCKED，不转 review debt。

**E2E 操作及记录**：按行先建隔离环境，确认 `BASE` 为实际批准域名。用 `playwright-cli -s=A open "$BASE/admin/login"`、`-s=E`、`-s=E2`、`-s=P` 分别真登录，`-s=V open "$BASE/"` 及独立 `V2` 真匿名；不能只开共享认证的标签。每个 case 走其任务内操作；`snapshot → click/fill/upload → requests → reload → snapshot`，必要时 `tracing-start/stop`。只留脱敏的 method/URL/status、响应中的目标 ID、revision、seq、request_key 与前后断言，禁止保存含凭证或个人信息的原始 trace。K 逐条映射来源/代码、前提、主分支、边界/验证、加载空错重试、权限隔离、状态并发、持久化、导航、分页筛序、兼容、证据和处理理由；状态只用 `covered | N/A | BLOCKED`。不适用的是有依据的单个条件，不是 REQUIRED 本身。

`e2e-result.md` 记录 Executed command、Environment identity、Destination、Start、End、Attempts、Test IDs、Artifacts、Coverage matrix reference、Cleanup、实际结果。B/I 均须真实前端、`Mocked Core API: false`；B 另有同一次真实核心请求及持久化/权限结果。禁止 route/intercept、MSW、Cypress stubs、fixture JSON、mock module、硬编码业务数据、store/localStorage 注入、DB seed 或直接 API 写。真实拒绝用自然旧页竞态、隔离账号/环境等；无法安全触发记 BLOCKED，不以隐藏按钮/截图代替服务端拒绝。视觉样本不作 E2E。每次正常/失败后记录已建资源、回收结果；未创建也需列查询/环境证据。

### 2.5 Business Workflows

[设计中的 14 个工作流](../../design/frontend.md#business-workflows) 是终态定义唯一 owner。下表只绑定执行者；按对应设计行按序 setup → action → verify → cleanup，验证每个参与者交接的**同一资源**。下面方法均指从业务 UI 触发的浏览器请求。`e2e-result.md` 按 `Workflow ID / Run ID、Stage、Actor/session、Action/expected、Request/response/resource ID、Re-entry/permission proof、Cleanup、Status/evidence` 逐阶段留证，K 链具体阶段，不重复打勾。

| Workflow ID / 来源终态 | Owner Task ID + Case ID | Actors / isolated sessions | Stages / resource handoff / expected result（详见对应设计行） |
| --- | --- | --- | --- |
| WF-001 缺图拦截 | frontend-007 / BAD | E、P、V | 同一条目/修订：PUT 草稿→GET 私有预览→POST check→V 重入两分类仍旧。 |
| WF-002 合格上线 | frontend-007 / LIVE | E、P、V | 同一条目补图，核修订→确认→两位置、详情、日志都对应返回版本。 |
| WF-003 恢复不回滚 | frontend-008 / REST | E（无发布权）、E2、P/A 辅助制造旧页、V | 版本/期望修订传递；先 409 再由 E 恢复；新稿可见、发布 403、线上及对照条目不变。 |
| WF-004 仅追加草稿 | frontend-009 / APPEND | E、V | 选中 ID 集合两次追加，重开与未选对照核差异，V 回读旧版。 |
| WF-005 部分发布/中断 | frontend-009 / BATCH | P、V | 分开记录正常混合批与中断批。提交但未收回执的款按原键核实/重试；未发起的 ID 重进仍未发布，无自动补发。 |
| WF-006 撤权/停用 | frontend-010 / REVOKE | A、P、V | PATCH 真实账号→旧页发布拒绝/草稿可存→停用后旧会话保存拒绝→历史在线内容不变。 |
| WF-007 仅下架产品 | frontend-010 / UNLIST | P、V | impact 的关联集合→取消/确认→V 重进两分类、搜索、产品深链及案例详情。 |
| WF-008 删除首次草稿 | frontend-004 / DELETE | E | 两种稳定 ID 各一次取消/DELETE→刷新对应列表和可读日志→无已发资源。 |
| WF-009 下架后归档 | frontend-010 / ARCH | P、V | 同款/案例尝试非法状态、下架再归档→重查版本/操作人/关联案例。 |
| WF-010 新商务码 | frontend-011 / QR | E、P、V | 素材 ID→保存/预览→确认→匿名两入口取新码；解除最后引用旧图 404，共用图仍可读。 |
| WF-011 第二企业 | frontend-011 / OTHER | 两域独立 E、P、V | 空部署 UI 新建/发布→独立 V 重进四页并在第一家复查；保留各域与资源 ID。 |
| WF-012 修订冲突 | frontend-007 / RACE | E、E2、P | 两编辑同修订→过期 PUT 保留输入→预览后又改→旧修订确认拒绝，原 live 不变。 |
| WF-013 旧预览不可渲染 | frontend-007 / STALE | E、E2 | E2 保存后，E 重新打开旧修订；证明实际预览 GET 返回 409，画面空且无回退读取；以同条新修订重进成功。 |
| WF-014 迟到响应不接管 | frontend-007 / SWITCH | E | 对照实际甲乙请求 ID、响应时序、切换状态和最终画面；放行甲后仍显示乙，重入核对两份草稿均未写。 |

业务清理先走正常 UI：首稿删除，历史条目下架归档，恢复账号原权限；不能删除历史，也不为清理误动生产。尚无下架 UI 的独立早期 case，仅在预先批准的专用测试部署上创建数据并由部署人员销毁，记录资源和销毁结果；否则 BLOCKED。每个 WF 独立建前提，WF-001/002 连测时保持同一个产品 ID，独跑 002 也经 UI 重建同一前置状态。优先级以本表唯一 owner 为准。
