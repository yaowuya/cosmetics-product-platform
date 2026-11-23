# 工程、账号与配置

所有 Files 相对仓库根；同一花括号内逐一展开为精确路径。按 [组件/接口/视觉与 E2E 契约](05-interfaces.md) 的同号 case 实施。每项先写断言再写实现；单测样本只在进程内测纯逻辑，不流入浏览器或真实业务请求。执行共通的类型、构建、独立视觉及真实浏览器门槛；本计划内不执行提交。FIGCAP/PRES 均 None（来源及替代对照见契约 §1）。

- [x] **Task frontend-001: 建立彼此隔离的两个构建入口和同源传输边界**

**Files:** Create: `frontend/{package.json,package-lock.json,shared/contracts.ts}`、`frontend/h5/{package.json,vite.config.ts,tsconfig.json,index.html}`、`frontend/h5/src/{main.ts,App.vue,manifest.json,pages.json,public-api.ts,pages/Home.vue}`、`frontend/admin/{package.json,vite.config.ts,tsconfig.json,index.html}`、`frontend/admin/src/{main.ts,App.vue,routes.ts,api.ts}`；Test: `frontend/tests/contracts.test.mjs`。

**Reasoning:** 在没有生产包的仓库先建立可核验产物，不交付空壳作业务页面。

**Depends on:** None

**Interfaces:** Consumes D-001、002、013、016、017 与已批准目录；Produces 两个构建根、公共传输类型和独立客户端；Contract checks：不共用有凭据的 admin 请求；无产物包含示例数据。

**Template:** H5/PC mount. **Script:** isolated clients and wire IDs. **Style:** no business UI. **Visual Checks:** N/A: build-only; [Frontend Interface and Visual Contract](05-interfaces.md#2-frontend-interface-and-visual-contract).

1. **失败测试：** 传入 `kind=public` 的客户端只能构造 `/api/public/...` 同源读请求；`assert.throws(() => publicPath('/api/admin/me'))`；十进制字符串 `9007199254740993` 往返不丢位，204 不解析 JSON。
2. **红：** `node --test frontend/tests/contracts.test.mjs`，预期缺客户端或错误允许跨族路径。
3. **最小实现：** TS 常规组件、Vue `<script setup>`，H5 `createSSRApp` 和 uni 注册，PC `createApp` 与 Element Plus；只创建技术挂载点（Home 无业务布局），不造假仪表盘、假账号或回放页。管理客户端拒绝外域；公开 GET 不带会话。测试验证 H5 history 路由可深链（不依赖 hash），输出 `frontend/h5/dist/build/h5/` 和 `frontend/admin/dist/`。开发时由批准的独立测试域、受信测试证书/密钥（在树外）和 PC Vite `server.https/server.proxy` 提供同源 `/admin/`、真实 `/api` 反代；跨端阶段再接 H5 上游。保留服务端 Origin/Host 校验，不放宽 CSRF、禁 Mock，未具备证书/环境则不能跑 E2E。
4. **绿：** 重跑上述单测，`npm --prefix frontend run typecheck`、`npm --prefix frontend run build` 均成功；单测读取两处真实 HTML 的资产前缀正确。无 UI 业务 case/工作流；技术产物不是 `STATIC_UI_READY`，认证/公开首屏由 002/006 单独验收。
5. **检查点：** 仅核本项 Files、无凭据/未授权依赖；预计提交说明 `build: 建立独立 H5 与后台入口`，另行授权才提交。

- [ ] **Task frontend-002: 管理员先改密，再开通与治理账号**

**Files:** Create: `frontend/admin/src/{session.ts,pages/Login.vue,pages/Desk.vue,pages/Governance.vue}`；Modify: `frontend/admin/src/{App.vue,routes.ts,api.ts}`、`frontend/shared/contracts.ts`；Test: `frontend/tests/session.test.mjs`。

**Reasoning:** A 能从空部署真实开 E/P 账号，供后续 UI 独立造数据；不等产品内容或发布界面。

**Depends on:** frontend-001, backend-002, backend-003

**Interfaces:** Consumes 会话/能力、授权审计；Produces `/admin/login`、`/admin/`、`/admin/accounts`、分权守卫及可查日志（只含真实可见行）；Contract checks：强改密时不循环重试 `/me`，撤权后关闭敏感面板。

**Template:** Login, Desk, Governance. **Script:** current session and capabilities. **Style:** PC workbench. **Visual Checks:** AUTH/GOV; [Frontend Interface and Visual Contract](05-interfaces.md#2-frontend-interface-and-visual-contract).

1. **失败测试：** `assert.equal(landing({must_change_password:true,can_manage:true}), 'change-password')`；仅治理、仅编辑、编辑+发布三组菜单/行为不同；旧权限清除后不能保留敏感行。
2. **红：** `node --test frontend/tests/session.test.mjs`，预期不能区分治理和发布。
3. **最小实现：** 真实登录取匿名 CSRF，提交后按登录响应判断首登；改密后重取能力。工作台侧栏+四位置导航，无权/未接入入口不能假报可用；治理页用表单、账号表、审计过滤/分页。授权对话框说明目标和能力；凭证仅在请求瞬间使用。窄窗表格可操作；正式画板与缺失变体见 AUTH、GOV。
4. **绿：** 重跑单测+两构建。`AUTH/GOV` 按契约 L、CAP 和 K 留证。由环境人员用 backend-002 一次性 bootstrap 创建首账号；使用 **001 的 HTTPS 入口+获准的独立真实 API/MySQL**（记录实际域名、证书、版本；无则 BLOCKED，不默认 backend-015 已部署）。A 改密、开通 E/P、启停/授权/收回再恢复，分会话重登并查变更的真实 audit ID，普通编辑无治理数据；匿名深链回登录、错误密码和退出失效。内容日志暂不造，后续 004 起核对；末尾停用测试账号或销毁部署。
5. **检查点：** 复核没有口令/令牌进日志、缓存或证据；预计 `feat: 接入首登和账号治理`，仅另获授权提交。

- [ ] **Task frontend-003: 按固定页面位置维护企业配置与目录草稿**

**Files:** Create: `frontend/admin/src/{editor.ts,pages/Configuration.vue,pages/Directory.vue}`；Modify: `frontend/admin/src/{pages/Desk.vue,routes.ts,api.ts}`、`frontend/shared/contracts.ts`；Test: `frontend/tests/config.test.mjs`。

**Reasoning:** 先给编辑真实可重开的六种配置与有效目录工作副本；无需 H5、发布或未来批量造数。

**Depends on:** frontend-002, backend-005, backend-006

**Interfaces:** Consumes 固定配置 Item、节点分配、受保护上传与 `I/draft`；Produces `/admin/pages`、`/admin/directory` 与按 ID+修订的工作副本；Contract checks：打开顺序/位置不串、编辑同时写 409 不覆盖。

**Template:** Configuration and tree forms. **Script:** fixed slot, upload context, node ID. **Style:** PC workbench. **Visual Checks:** CONFIG/TREE; [Frontend Interface and Visual Contract](05-interfaces.md#2-frontend-interface-and-visual-contract).

1. **失败测试：** 树中同名但不同 ID 的两个分类，改名/排序不改变 ID/父节点；`assert.deepEqual(moveWithinParent(nodes,id,1).map(n=>n.id), expectedOrder)`；上传失败不改引用，成功但未保存不冒充草稿。
2. **红：** `node --test frontend/tests/config.test.mjs`，预期丢失位置身份或更新错误位置。
3. **最小实现：** 工作台进入首页（海报增删换图、排序）、目录封面、案例页头/标签、服务说明/有序服务卡、独立商务码/可选渠道；各归本条编辑和保存。树用 `el-tree`/表单在同父内排序，增节点先 `POST A/directory/nodes {}` 再将新 ID 写入目录草稿，板块、分类、细类名/图标/启停明确。控件错误就地提示，弃改弹窗；失败留旧图，换条目不泄上条内容。
4. **绿：** 重跑单测及构建。`CONFIG/TREE` 各走 L/CAP/K：E 逐页替换、排序并保存重进；另一会话读同修订，上传拒绝不污染草稿。新建三层、另留无细类分类、改名/排序/停用，再从 UI 重开核稳定 ID 与有序正文；草稿新 ID 尚不承诺允许产品发布。早期只核真实管理 GET/PUT，不借未来 H5 造数或断言线上成功；独立测试部署回收。
5. **检查点：** 对照稿只有已绘制位置可判通过；预计 `feat: 编辑固定页面资料与企业目录`，仅另获授权提交。
