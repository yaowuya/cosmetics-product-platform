# 待确认：新模块目录与文件职责（一次性）

访客在企业自己的公开 H5 浏览发布版；编辑在独立 PC 入口维护草稿。在后台打开手机宽度的预览时，加载的是真实 H5 组件，不是另一套 PC 手机模型。以下是**拟新增**的两个应用，不是已有代码或已获实施授权的清单。

## Frontend Reuse And Directory Confirmation

- Frontend Scope: `new-module`。Reference Modules：仓库根只有说明、`docs/` 与 `fp-docs/`，未发现生产 package、页面注册、既有锁文件、组件或项目 E2E runner。项目 manifest、agent/frontend/prototype-style settings、技术规范 preset 均未登记。
- Reuse Decisions：[前端设计：Frontend Reuse Decisions](../../design/frontend.md#frontend-reuse-decisions) 是唯一决定源。保留定稿的交互与版式，不复制示例应用、内置数据、角色或示意品牌。PC 组合 Element Plus 原生表格、表单、上传、选择、分页、对话框；不建通用 CRUD 框架。
- Directory Proposal：下列为完整前端新增树；同目录花括号仅合并显示**逐一列名**的文件，注释按列名顺序对应。`[new]` 新增，`[reuse]` 只读，不修改已有来源。目录和文件职责一起确认。
- Directory Confirmation: `confirmed`。Confirmation Source：用户看过本文件对应的完整前端目录与逐文件职责后回复「改完之后，实现代码，遇到问题，你用你的最佳实践，决策」。本次沿用所列路径；该授权不确认未获批的视觉参考或替代真实验收。

## File Structure

```text
frontend/                                        # 项目根相对路径；以下各叶子均 [new]
├─ package.json                                  # [new] 两个 npm workspace、统一类型检查/构建脚本
├─ package-lock.json                             # [new] 仅获准安装业务构建依赖后生成并锁定两个应用
├─ shared/contracts.ts                           # [new] public 投影、admin 修订/权限/逐款回执的 TS 形状；无会话逻辑
├─ h5/
│  ├─ {package.json,vite.config.ts,tsconfig.json} # [new] H5 编译依赖与脚本；uni 插件；TS 范围
│  ├─ index.html                                 # [new] H5 挂载文档，不含企业文案
│  └─ src/
│     ├─ {main.ts,App.vue,manifest.json,pages.json} # [new] 创建 uni 应用；生命周期/安全区样式；H5 构建参数；路由及公开别名
│     ├─ {public-api.ts,preview-api.ts}           # [new] 匿名只读投影；私有指定修订和受保护图片分开取
│     ├─ {browse.ts,platform.ts}                  # [new] 查询代次、分栏记忆与筛选；复制/长图/二维码的 H5 差异
│     ├─ pages/{Home,Catalog,Cases,Contact}.vue    # [new] / 轮播；/catalog 目录；/cases 筛选及案例详情态；/contact 服务与联系
│     ├─ pages/{Product,Preview}.vue              # [new] 产品 ID 深链宿主；/preview 仅加载指定草稿，不在四页签内
│     └─ views/{ShowcaseNav,ProductView,CaseView,PageContent}.vue
│                                                 # [new] 四固定入口；共用产品卡/详情；共用案例卡/详情；按位置渲染海报/页头/服务/联系
├─ admin/
│  ├─ {package.json,vite.config.ts,tsconfig.json} # [new] PC Vue/Element Plus 依赖及脚本；/admin/ 输出 base；TS 范围
│  ├─ index.html                                 # [new] PC 挂载文档
│  └─ src/
│     ├─ {main.ts,App.vue,routes.ts}               # [new] 注册 Vue/Element Plus；导航与表单工作区壳；同源 /admin 子路由和守卫
│     ├─ {api.ts,session.ts,editor.ts,batch.ts}   # [new] 有凭据的 API/CSRF；登录能力；工作副本及冲突；所选 ID/逐款检查与回执
│     ├─ pages/{Login,Desk,Governance}.vue        # [new] 登录及强制改密；按展示位置导航；账号治理与裁剪后的日志查询
│     ├─ pages/{Configuration,Directory}.vue      # [new] 固定位置配置及上传排序；板块/分类树编辑发布
│     ├─ pages/{Items,ItemEditor}.vue             # [new] 两个独立列表路由、查询与行操作；按产品/案例字段编辑，嵌真实 H5 预览
│     └─ panels/{Release,History,Batch}.vue       # [new] 单条检查/确认及影响提示；版本与恢复；仅产品批量追加/检查/确认
└─ tests/{contracts,session,config,items,release,browse,preview,history,batch,retire,delivery}.test.mjs
                                                  # [new] 依次检验传输边界、身份、配置、条目、发布、公开浏览、预览冲突、恢复、批量、清理、交付包边界
```

**只读设计接入点 `[reuse]`**：用户明确指定本变更的 `prototype.html`（PC 管理稿）和 `docs/cosmetics-platform-design-spec/prototype/index.html`（H5 定稿）。交接包的分段源可用于读取布局、尺寸与样式，但两份 HTML 不进入生产入口；原型的假数据和角色模拟也不进入生产。未绘制的鉴权状态按同稿的控件与排版实现，不冒填逐状态的原图比较结果。

## Global Constraints

- [前端设计](../../design/frontend.md) D-001、002、017：uni-app + Vue 3 + TS 只编译 H5；独立 PC Vue 3 + TS + Element Plus；同源不同客户端与路由。无企业切换、线索、购物、小程序、自由搭页。D-021：编辑可恢复，不能借恢复直接上线。
- 本机 `node --version` = `v24.22.1`、`npm --version` = `11.21.0`；`playwright-cli --version` = `0.1.22`，已核 CLI help。使用现有 CLI；不安装浏览器、扩展、测试依赖，不写 Playwright 配置或 CI。CLI 版本不证明浏览器、环境或真机就绪。
- 当前没有可运行的项目脚本。下文 `npm --prefix frontend run typecheck`、`npm --prefix frontend run build` 是 001 **要建立**的入口，不是当前已通过的命令；拟用两个工作区的 vue-tsc 与原生构建（uni H5 / Vue Vite）。业务依赖版本以首次经批准核对的兼容组合和唯一 lock 为准，记录实际命令和版本。未获安装许可或工具不可用则报告阻塞。单测用本机 `node --test frontend/tests/<已列文件>.test.mjs`，测试纯 TS 逻辑或真实构建产物；不为测试造页面或引入浏览器 runner。
- 实施者及 reviewer 自行读 `${CLAUDE_PLUGIN_ROOT}/skills/_shared/{engineering-quality,frontend-reuse-contract,ui-e2e-contract}.md`。公开契约及权限、修订匹配、未知回执等非显然处同步说明，在每项绿测后对照实际行为自审。不建通用权限框架或按字段拆文件。
- 独立可交付边界：早期账号用一次性初始化的真实管理员；配置和条目从空状态经 PC 新建或修改，检查重进。临时写入只用获批的可销毁隔离部署。已发布内容终验放在后台单条确认之后，不让前序任务等待批量或完整 H5 才能造数。单项准备只用本任务及前置 UI，重跑不依赖其他 case 的遗留物。
- 执行只在目录及计划批准后按 `fp-execute` 逐项 TDD。核心视觉前置：现有静态稿只覆盖绘出的部分；`002/AUTH` 登录与首次改密、`007/STALE` 旧修订及 `007/SWITCH` 切换等尚无批准对照，详见[接口契约的 G 项](05-interfaces.md#1-来源和浏览器能力)。不得以本地交互稿或运行截图补源；真实 UI/E2E 同样未验。步骤 5 不授权 Git 提交。

## 1. Page goal and visual context

发布数据验证与画面对照分开。H5 四页、详情和受保护预览使用相同渲染，管理区按四个页面位置、两个条目列表、发布操作和账号治理分工。设计来源、参考图的范围及不足、运行时路由和状态归 [接口与证据契约](05-interfaces.md)；提案/设计覆盖归 [验收映射](90-coverage.md)。
