# 微信原生小程序 Frontend Plan

> 执行方式：`fp-execute` 全自动。P-004 先交付代码及本地验证，独立记录原生和正式验收；未取得真实证据不得勾选受阻 UI 任务。

## Frontend Reuse And Directory Confirmation

- Frontend Scope: `new-module`。
- Reference Modules: [现有 H5 导航](../../../../frontend/h5/src/views/ShowcaseNav.vue)、[浏览约定](../../../../frontend/h5/src/browse.ts)、[公开层](../../../../app/controllers/public/catalog.py)。
- Reuse Decisions: [唯一前端设计复用表](../design/frontend.md#frontend-reuse-decisions)；复用发布接口和展示规则，不共享浏览器运行时。
- Directory Proposal: 下表列完新文件及接入点。没有要修改的 H5、PC、服务端、数据库或工作区配置。
- Directory Confirmation: `confirmed`，来源是用户 m00307 “不需要我确认，请最佳推荐，往下走”；按其委托确认推荐结构并继续，没有逐文件用户确认记录。

## Global Constraints

- 运行时及 UI 组件：[D-001/D-002/D-004](../design/frontend.md#decision-ledger)，纯原生 WXML/WXSS/JavaScript，原生 Tab 和页面栈，无依赖、无 WebView、无生产数据回退。
- 项目 [frontend settings](../../../settings/frontend.md) 的 Vue 预设只适用 H5 和管理端；新工程沿用已批准 H5 色值、比例、布局和文案语义。注释按 FeaturePilot 的 `engineering-quality` 规则说明模块边界和异步/网络约束。
- 当前工具：Node 24.22.1/npm 11.21.0；现有 `.venv`、本机 MySQL 8 与 `frontend/node_modules`、本地 QA TLS；可使用 [现有发布 API 测试和专用 MySQL 守卫](../../../../tests/conftest.py#L11-L31)。未在 PATH 或常见安装目录确认微信开发者工具。Playwright 可服务已有 Web 测试，不能替代原生运行时；不得隐式安装软件。
- 本地命令：`npm --prefix frontend/miniapp test`；`npm --prefix frontend test`、`npm --prefix frontend run typecheck`、`npm --prefix frontend run build`（[现有脚本](../../../../frontend/package.json#L5-L9)）。

## File Structure

```text
frontend/miniapp/ [new]
  app.js app.json app.wxss project.config.json package.json README.md
  lib/ config.js public-api.js model.js paging.js page-feedback.js
  pages/ home/ catalog/ product/ cases/ case/ contact/
    各自 index.js index.json index.wxml index.wxss
  tests/ public-api.test.js model.test.js paging.test.js app.test.js pages.test.js
```

| Path | Action | Responsibility |
| --- | --- | --- |
| `frontend/miniapp/app.js` | create | 注册 App，不设置全局业务状态 |
| `frontend/miniapp/app.json` | create | 六页入口、四原生 Tab 和导航主题 |
| `frontend/miniapp/app.wxss` | create | 通用颜色、图片、列表与加载反馈 |
| `frontend/miniapp/project.config.json` | create | 开发者工具导入、包内排除测试与交付文件 |
| `frontend/miniapp/package.json` | create | 独立零依赖 Node 验证命令，不加入现有 npm 工作区 |
| `frontend/miniapp/lib/config.js` | create | 三环境配置和内网/正式网络边界 |
| `frontend/miniapp/lib/public-api.js` | create | 仅匿名已发布读的固定方法、状态与媒体解析 |
| `frontend/miniapp/lib/model.js` | create | 展示数据选择和公开目录树投影 |
| `frontend/miniapp/lib/paging.js` | create | 两个列表的代次、单追加、重试、去重与内存快照 |
| `frontend/miniapp/lib/page-feedback.js` | create | 非分页资源的独立加载与重试状态、原生导航小帮助 |
| `frontend/miniapp/pages/home/index.{js,json,wxml,wxss}` | create | JS 驱动可见性与轮播；JSON 配置首页；WXML 长图与反馈；WXSS 海报排版 |
| `frontend/miniapp/pages/catalog/index.{js,json,wxml,wxss}` | create | JS 驱动树、筛选、同步滚动和分页；JSON 配置 Tab；WXML 左右栏；WXSS 目录比例与上下级视觉 |
| `frontend/miniapp/pages/product/index.{js,json,wxml,wxss}` | create | JS 独立取产品 ID；JSON 配置栈页；WXML 图文、重试和返回；WXSS 长图与字段布局 |
| `frontend/miniapp/pages/cases/index.{js,json,wxml,wxss}` | create | JS 驱动标签、搜索与分页；JSON 配置页级刷新；WXML 精选和双列；WXSS 头图、选中态和网格 |
| `frontend/miniapp/pages/case/index.{js,json,wxml,wxss}` | create | JS 独立取案例 ID；JSON 配置栈页；WXML 信息与配图；WXSS 正文和封面 |
| `frontend/miniapp/pages/contact/index.{js,json,wxml,wxss}` | create | JS 驱动公开联系和原生动作；JSON 配置 Tab；WXML 服务、联系方式与反馈；WXSS 咨询区与服务卡 |
| `frontend/miniapp/tests/public-api.test.js` | create | 环境/请求/形状/媒体入口行为 |
| `frontend/miniapp/tests/model.test.js` | create | 层级、分页请求、详情和媒体显示投影 |
| `frontend/miniapp/tests/paging.test.js` | create | 手动控制返回顺序、追加失败恢复、快照 |
| `frontend/miniapp/tests/app.test.js` | create | 六页注册、原生 Tab、项目导入和静态源约束 |
| `frontend/miniapp/tests/pages.test.js` | create | 驱动生产 Page 定义的受控回调测试；不是原生 E2E |
| `frontend/miniapp/README.md` | create | 导入、配置、合法域名、真机矩阵和禁止外部写入边界 |
| `frontend/h5/`、`frontend/admin/`、`app/controllers/public/`、`tests/test_public.py` | reuse | 参考、接口复用和现有回归，不改文件 |

## 1. Page goal and visual contract

在原生 Tab 浏览企业海报、目录、案例和联系信息；打开产品或案例详情不丢失已浏览列表；下架内容不可从详情入口继续读取。没有 Figma 或独立原生参考截图；视觉源为 [H5 现有页面/WXSS 约定](../design/frontend.md#visual-source)。不以 H5 浏览器或 POC 声称微信原生验收；核心视觉缺证记录 `CANNOT_VERIFY`。无 `FIGCAP-*` 或 `PRES-*`。

## 2. Frontend Interface and Visual Contract

| Contract | Owner | Shape / behavior / verification |
| --- | --- | --- |
| 公开读取 | frontend-001 | `createPublicApi({request, origin})` 生成 `page/catalog/products/cases/product/case/mediaUrl`；校验版本、同源、固定路由、字符串 ID、缺失与失败，见 [设计](../design/frontend.md#接口权限与兼容边界) |
| 列表协调 | frontend-001 | `createPaging({load, render})` 唯一活跃代次；`reset/append/retry/invalidate/snapshot/restore` 约束输出；空结果、失败保留已有数据 |
| 路由、组件和样式 | frontend-002 | [页面与组件树、视觉范围](../design/frontend.md#前端设计)；原生入口 `pages/{home,catalog,product,cases,case,contact}/index`；两详情独立获取，目录和案例不要在 `onShow` 重置 |

### Visual Evidence Manifest

以下每行以 `V=<change>/.fp-execute/visual/frontend-002/<Case ID>/` 展开 `manifest.md`、`reference.png`、`current.png`、可选 `diff.png`。参考是已批准的 H5 内容布局（用户 m00225，设计 D-001），以 QA 合成业务视觉素材截图为参考；原生端必须在对应真实微信路由同数据采集；无截图时不得填路径为已有文件。Figma node/revision/Auto Layout/变量均不适用，版式来源是所链设计/H5；环境指定同一 QA 编号发布结果、390×844、DPR 3、zh-CN、浅色、动态原生状态栏不比较；窄屏及设备另验。Diff 未生成，原生截图未取得；不以全局像素阈值判断。

| Case ID / owner | Approved source / scenario | Runtime route | Fixture and acceptance | Tool / failure class |
| --- | --- | --- | --- | --- |
| VC-01 / frontend-002 | [设计 VC-01](../design/frontend.md#visual-checks)，双长海报、读到下段、断图 | `pages/home/index` | 两张不同标记长图；图不裁切、横向可换、阅读不被打断 | 微信开发者工具模拟器，必要时双真机；core |
| VC-02 / frontend-002 | [设计 VC-02](../design/frontend.md#visual-checks)，目录与键盘、筛选返回 | `pages/catalog/index` | 两个板块、三级目录、超过 20 件合成发布商品；封面 2.6:1、左右栏和计数不过界 | 微信开发者工具模拟器、键盘和真机返回；core |
| VC-03 / frontend-002 | [设计 VC-03](../design/frontend.md#visual-checks)，案例精选、追加和详情 | `pages/cases/index` → `pages/case/index` | 超过 20 条及带长图案例；精选 61:39、其余两列、长标题/图不裁切 | 微信开发者工具同数据两路由、截图和独立复核；core |
| VC-04 / frontend-002 | [设计 VC-04](../design/frontend.md#visual-checks)，产品详情/联系/缺字段 | `pages/product/index` 与 `pages/contact/index` | 合成产品、公开联系含与不含各字段；详情封面 16:9、长图完整、按钮不伪造 | 微信开发者工具、两端设备联系操作；core |

### UI/E2E Delivery Contract

`E=<change>/.fp-execute/e2e/frontend-002/<Case ID>/coverage-matrix.md`，证据同目录独立记录。统一从 `SOURCE_READY → STATIC_UI_READY → VISUAL_REVIEW_PASS → INTERACTION_READY → FRONTEND_E2E_PASS`，本地 Node 只能验证 Page 脚本，不能通过视觉或真实 E2E；未取得所需微信运行时/参考/实际对应证据为 `BLOCKED`。E2E 访问 QA 的已发布数据，准备/发布/撤回由正常后台 UI 操作；不注入业务数据。小程序没有登录、写入或多角色业务流程，正常后台操作只用来准备真实已发布、撤下和缺字段的环境条件。

| Task / Case | Source-derived conditions | UI Delivery Level | Runtime case | E2E Applicability | Coverage |
| --- | --- | --- | --- | --- | --- |
| frontend-002 / VC-01 | [设计：海报](../design/frontend.md#状态并发与执行流程)，发布/空/故障、手势、定时/切 Tab | interactive | VC-01 | REQUIRED | `E` for VC-01 |
| frontend-002 / VC-02 | [设计：目录](../design/frontend.md#状态并发与执行流程)，层级/查询/计数、分页/返回、追加/搜索竞争、空错重试 | interactive | VC-02 | REQUIRED | `E` for VC-02 |
| frontend-002 / VC-03 | [设计：案例](../design/frontend.md#页面视图)，标签/查询、追加顺序、列表返回、存在/撤下、空错重试 | interactive | VC-03 | REQUIRED | `E` for VC-03 |
| frontend-002 / VC-04 | [P-003](../proposal.md#handoff-decision-ledger)、[D-006](../design/frontend.md#decision-ledger)，详情/媒体可见性、复制/拨号/预览、字段缺失、退出 | interactive | VC-04 | REQUIRED | `E` for VC-04 |

## 3. Task breakdown

- [x] **Task frontend-001: 公开请求、视图投影和分页协调**

**Files:** Create `frontend/miniapp/lib/{config,public-api,model,paging}.js`、`frontend/miniapp/package.json`。Test `frontend/miniapp/tests/{public-api,model,paging}.test.js`。

**Reasoning:** 所有页面同一个明确的来源；两个列表有同一代次不变量，不能重复实现网络和分页边界。

**Depends on:** None

**Interfaces:** Consumes 现有公开路由和投影，微信回调式 `request` 与 `getAccountInfoSync`；Produces 第 2 节的请求/列表契约和纯显示投影；Contract checks 对比实际查询键、数字串、状态和快照。

1. 写失败测试：未知或误配置的正式源不发请求；仅发公开端点和允许的参数；目录节点有效；快速搜索旧结果不覆盖、追加失败可重试、重复项只渲染一次。
2. 运行 `node --test --test-isolation=none frontend/miniapp/tests/public-api.test.js frontend/miniapp/tests/model.test.js frontend/miniapp/tests/paging.test.js`；预期因未实现模块或调用行为失败。
3. 实现仅需要的配置、公开客户端、投影和分页。保持字符串 ID；不新增 API 或业务缓存；只在调用边界清洗数据。UI/视觉不适用（无呈现文件）。
4. 重跑同命令，预期全部通过；评审契约、失败分支和隐私，记录 Make it Right。
5. 核验通过后按执行账本记任务范围及验证；不推送或发布。

- [ ] **Task frontend-002: 六个原生页面、对接说明与本地验证**

**Files:** Create `frontend/miniapp/{app.js,app.json,app.wxss,project.config.json,README.md}`、`frontend/miniapp/lib/page-feedback.js`、`frontend/miniapp/pages/{home,catalog,product,cases,case,contact}/index.{js,json,wxml,wxss}`。Test `frontend/miniapp/tests/{app,pages}.test.js`。

**Reasoning:** 作为可直接导入的一整套原生图册，先完成目录→详情→返回纵切，随后完成案例、首页和联系，集中登记各 VC 的独立验收结果。

**Depends on:** frontend-001

**Interfaces:** Consumes 公开客户端、列表状态与视觉合同；Produces 四 Tab、两详情、生命周期、手势和微信操作；Contract checks 按原生配置、路由参数、可见数据、发布边界与错误分支验证。

1. 写失败测试：项目六页可导入且非 WebView，驱动目录/详情与列表恢复，之后逐纵切补案例、首页与联系脚本测试；检查加载、缺失、故障、快捷操作及可见状态。
2. 每一纵切运行 `node --test --test-isolation=none frontend/miniapp/tests/app.test.js frontend/miniapp/tests/pages.test.js`；预期因缺少当前切片或行为失败。
3. 按[设计组件树](../design/frontend.md#ui-组件树与-figma-解析映射)实现。WXML 骨架、Page 状态与 WXSS 的比例/选中态均按第 2 节；绝不把 Node 注入当原生数据或真实 E2E。说明开发者工具导入、合法域名、可信 443 与测试版/正式版配置和无生产变更策略。
4. 运行 `npm --prefix frontend/miniapp test`，以及 Global Constraints 的原前端命令；现有后端公开层使用已验证隔离环境后运行 `.venv/Scripts/python.exe -m pytest -q tests/test_public.py`。跟踪 VC-01 至 VC-04：需独立视觉复核和真实微信点击、请求及条件覆盖，见第 2 节；没有运行时不可宣称编译或真机通过，仍可按 P-004 给出可验证代码与实际结果。
5. 核验完成才标完成；未取得真实原生结果保留 checkbox 并登记阻塞，禁止虚报最终流水线通过。

## Coverage Matrix

| Source | Requirement | Tasks | Verification |
| --- | --- | --- | --- |
| [提案](../proposal.md#what-changes) §§1–2 | 六原生视图，后台统一发布，撤下后无回退 | frontend-001, frontend-002 | 微信 VC-01–VC-04；Node 仅适配与脚本；现有真实公开边界测试 |
| [D-003/D-004](../design/frontend.md#decision-ledger) | 返回、代次、异步重试、环境隔离 | frontend-001, frontend-002 | `npm --prefix frontend/miniapp test`；VC-02/VC-03 |
| [D-001/D-006](../design/frontend.md#decision-ledger) | H5 内容层级、图片比例、微信快捷操作 | frontend-002 | VC-01–VC-04 |
| [提案 P-004](../proposal.md#handoff-decision-ledger) | 本地验收和正式验收分记，原 H5/后台不变 | frontend-002 | 回归命令、使用说明、原生证据不替代 |
