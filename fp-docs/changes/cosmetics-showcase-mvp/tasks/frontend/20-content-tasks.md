# 两个管理列表、单条发布与公开 H5

沿用[工程片的路径与 TDD 约定](10-foundation-tasks.md)，视觉/E2E case 的唯一字段、实际命令、生命周期 L、证据 K 和所需获批状态见[接口契约](05-interfaces.md)。以下 Files 均为计划路径；独立真实运行需要 001/002 的获准 HTTPS 环境。FIGCAP/PRES 均 None，无业务模拟环境。

- [ ] **Task frontend-004: 分开维护全部产品和全部案例，并安全删除首次草稿**

**Files:** Create: `frontend/admin/src/pages/{Items,ItemEditor}.vue`；Modify: `frontend/admin/src/{routes.ts,api.ts,editor.ts,pages/Desk.vue}`、`frontend/shared/contracts.ts`；Test: `frontend/tests/items.test.mjs`。

**Reasoning:** 编辑能建、查、改、删除未发资料；首稿删除无需未来的在线测试数据。已发/归档动作留给 005/010。

**Depends on:** frontend-003, backend-004, backend-010

**Interfaces:** Consumes 两列表、Item、共享编辑/上传、`DELETE I/draft` 和审计；Produces `/admin/products`、`/admin/cases` 与 `/:id` 编辑页；Contract checks：类型隔离、两轴筛选、同款只一行、不用预览替代保存。

**Template:** two lists and ItemEditor. **Script:** stable ID, filters, draft revision. **Style:** PC form/status layout. **Visual Checks:** LIST/EDIT/DELETE; [Frontend Interface and Visual Contract](05-interfaces.md#2-frontend-interface-and-visual-contract).

1. **失败测试：** `assert.equal(canDelete({has_history:true,live_id:null}),false)`；验证离开未提交编辑先问、未确认不产生删除请求、编辑器接到 409 后保留用户输入。
2. **红：** `node --test frontend/tests/items.test.mjs`，预期无上述状态边界。
3. **最小实现：** `el-table`+搜索/筛选/分页，按稳定 ID 作 row-key；产品多位置仅显示路径列表，搜索名称或编号；案例按客户品牌或案例产品名查。编辑页把产品资料、展示分类分区，案例独立图文/顺序/可空后台关联；上传替换不改变 live。新建处 POST、按行打开后 PUT，即使缺业务字段可存；显示修订、未保存标记，服务端字段路径映射到控件。删除资格、条目身份和二次确认清晰；不提前绘制假的预览或发布检查结果。
4. **绿：** 重跑单测、类型检查和构建。`LIST/EDIT/DELETE` 分别完成 L/CAP/K：用 003 分配的位置建立跨类未发产品、独立案例及足够翻页的对照稿；测试两组搜索/无结果、草稿过滤、重开并核响应稳定 ID。若初次稿无可选已发目录，可先建立无位置稿，双位置 **线上且有稿** 组合由 007/BAD 负责终验；不伪造 live。WF-008 对两种首稿先取消、重开，再确认并查对应 ID 的删除审计/操作者；取消期间没有 DELETE。清理剩余首稿，记录验证证据。筛选排序不插入空行。
5. **检查点：** 复核同名条目不误操作、未提交草稿不入持久存储；预计 `feat: 分开维护产品与案例草稿`，另行批准才提交。

- [ ] **Task frontend-005: 从目标行或固定位置检查、确认并追溯单条发布**

**Files:** Create: `frontend/admin/src/panels/Release.vue`；Modify: `frontend/admin/src/{api.ts,editor.ts,pages/Items.vue,pages/ItemEditor.vue,pages/Configuration.vue,pages/Directory.vue}`、`frontend/shared/contracts.ts`；Test: `frontend/tests/release.test.mjs`。

**Reasoning:** 从空库先完成目录自身的发布，再建可发多位置产品；使后续 H5 有真实可访问的数据。不是整页/整站自动上线。

**Depends on:** frontend-003, frontend-004, backend-008, backend-009

**Interfaces:** Consumes 同一条目 draft/live/修订、检查、确认和审计回执；Produces 可复用 Release 面板、影响位置、编辑字段错误定位；Contract checks：仅已检查的 ID+修订可确认，空结果/网络超时不报成功。

**Template:** Release panel. **Script:** check, confirmed revision, receipt. **Style:** PC action and error states. **Visual Checks:** SINGLE; [Frontend Interface and Visual Contract](05-interfaces.md#2-frontend-interface-and-visual-contract).

1. **失败测试：** 检查成功后编辑条目或切换行，`assert.equal(canConfirm(checked,current),false)`；缺项定位、取消不提交；同键回执可核对，未知状态不会产生自动重发命令。
2. **红：** `node --test frontend/tests/release.test.mjs`，预期过期检查仍可发或成功判定错误。
3. **最小实现：** 产品、案例两张表按行操作，不需先勾选；目录与各配置位置也用相同单条面板。文案及版式依 #release 显示当前草稿和线上差异、目标身份/修订、缺项/位置；检查只读业务状态，确认后才提交单键。禁用无稿/不合格/无权入口，拒绝时不冒充权限边界。409 返回重核；422 错误就地关联；401/403 处理沿用 002。
4. **绿：** 重跑单测、类型检查、构建；`SINGLE` 走 L/CAP/K。E 先录页面资料与目录、P 分条检查/发布；先建一款缺图和另一款合格稿、独立案例与未选对照。用真实 UI 补齐并分别从行核对/确认一条；P 可发布自己改的内容，不强需二审。重入 PC 对比 `live_id/draft`、成功版本号和审计，检查未改线上、确认只动该记录、对照稿还在。验证少于三张正式海报不可发、无档不能确认。此任务不依赖 H5/版本面板；版本来源为 Receipt 和 audit。无下架 UI 时由授权人员销毁专用环境。
5. **检查点：** 保存成功≠发布成功，校验业务拒绝不混同网络失败；预计 `feat: 逐条核对并确认发布`，另行批准才提交。

- [ ] **Task frontend-006: 在四个固定页公开展示本企业当前发布版**

**Files:** Create: `frontend/h5/src/{browse.ts,platform.ts,pages/Catalog.vue,pages/Cases.vue,pages/Contact.vue,pages/Product.vue,views/ShowcaseNav.vue,views/ProductView.vue,views/CaseView.vue,views/PageContent.vue}`；Modify: `frontend/h5/src/{public-api.ts,App.vue,pages.json,pages/Home.vue}`、`frontend/{h5/vite.config.ts,admin/vite.config.ts,shared/contracts.ts}`；Test: `frontend/tests/browse.test.mjs`。

**Reasoning:** 生产 H5 用真实匿名投影，新企业不随源码得到任何微肽资料。只准备前置后台 UI 能创建/发布的资料，不依赖后续批量和预览。

**Depends on:** frontend-005, backend-012, backend-013

**Interfaces:** Consumes §2.2 public 页面/目录/产品/案例/媒体及两个构建入口；Produces `/`、`/catalog`、`/cases`、`/contact`、产品和案例深链及复用视图；Contract checks：公开客户端不取私有接口、列表与详情同一个 ID、无内部联系或预览参数后门。

**Template:** four H5 pages and shared views. **Script:** read projection, filter, scroll, carousel. **Style:** H5 safe area and long images. **Visual Checks:** HOME/CATALOG/CASES/CONTACT; [Frontend Interface and Visual Contract](05-interfaces.md#2-frontend-interface-and-visual-contract).

1. **失败测试：** `assert.equal(acceptResponse(oldQuery,currentQuery),false)`；第三款总数、细分类一款；换板块/详情返回恢复本次滚动，案例清空按钮与手工删空不同，轮播遇单图/离开/阅读暂停。
2. **红：** `node --test frontend/tests/browse.test.mjs`，预期慢响应覆盖新查询、或返回重置了分类/滚动。
3. **最小实现：** 页面/层级：四固定页签 + 安全区；首页全宽等比图、滑动/圆点、4 秒/可见性计时；目录封面/搜索/板块/左右列与详情；案例页头+横卡/双列+详情；服务说明、长图和独立联系区。无图不回填、封面自带字不叠字、未知生产情况显示“待确认”。详情六项+长图，复制编号无购买栏；合作咨询/查看二维码共弹层，可放大/长按或使用系统可用保存、未配渠道隐藏。载入、空与失败重试是不同状态；请求按代次忽略旧结果。案例详情复用 Cases 宿主和 CaseView，由路由适配映射 `/cases/detail?id=`（不可新增第五标签）。深链处理由 Vite/部署入口识别并保留 URL 与查询。
4. **绿：** 重跑单测、类型检查与构建。`HOME/CATALOG/CASES/CONTACT` 逐行 L/CAP/K。单独从 003–005 的 PC 页面创建并发布本 case 资料；V 与 V2 通过真实链接访问、刷新、转发。首页四图切换、按住/向下读/切页/后台后回顶，空部署测试零图；只剩一张可展示的场景只接受合法真实运行条件（如隔离浏览器受控断网导致其余真实媒体加载失败），绝不发布仅一张正式海报，不可触发写 BLOCKED。目录当前板块分别搜名称/英文名/编号/分类/细类，不穿板块；三款与一款的两个计数、隐藏/恢复细筛、空分类/无结果、加载后分页/去重/返回、不可读深链通用 404。独立案例不创建产品，零/一/多条、两种清空路径、可转发深链。两入口同联系弹层、关闭回位、空字段不造数据。实机专项由 011，不以桌面测试代替；销毁测试环境。若跨端 HTTPS 环境未备不算通过。
5. **检查点：** 确认匿名媒体真实访问且无私有数据、资料来自该企业；预计 `feat: 展示企业四页与公开详情`，另行批准才提交。
