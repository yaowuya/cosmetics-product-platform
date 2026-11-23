# 预览、恢复、批量与条目退出

以下按[接口与证据契约](05-interfaces.md)履行 L、CAP、K，FIGCAP/PRES 均 None。使用真实前置 UI 独立建立本次资源，不以其他 case 的测试残留作前提。每项同时查前后端相应请求/响应、修订、公开与授权重进结果；获准隔离测试域不可用则阻塞。Files 花括号对应逐个命名的文件。

- [ ] **Task frontend-007: 从指定已保存修订预览，并阻止冲突的保存和确认**

**Files:** Create: `frontend/h5/src/{preview-api.ts,pages/Preview.vue}`；Modify: `frontend/h5/src/{pages.json,views/ProductView.vue,views/CaseView.vue,views/PageContent.vue}`、`frontend/admin/src/{editor.ts,pages/ItemEditor.vue,pages/Configuration.vue,pages/Directory.vue,panels/Release.vue}`、`frontend/shared/contracts.ts`；Test: `frontend/tests/preview.test.mjs`。

**Reasoning:** 这是第一项同时具备后台造稿、单条确认、公开 H5 与受保护 H5 的任务，拥有跨分类主链与修订冲突的终态；不让前三项为 H5 造假数据。

**Depends on:** frontend-005, frontend-006, backend-006, backend-009

**Interfaces:** Consumes `I/preview?revision=` 返回的类型、槽及本次 `media_urls`；Produces `/preview?id=…&revision=…` 的受保护宿主；Contract checks：只渲染已保存修订，当前条目、修订与请求轮次均须匹配，无失权或 409 回退。

**Template:** Preview and shared H5 views. **Script:** item/revision/request match. **Style:** same H5 rendering in PC preview. **Visual Checks:** BAD/LIVE/RACE/STALE/SWITCH; [Frontend Interface and Visual Contract](05-interfaces.md#2-frontend-interface-and-visual-contract).

1. **失败测试：** `assert.deepEqual(previewSelection(saved,unsaved),{id:saved.id,revision:saved.revision})`；无效参数发零请求；切乙后甲的迟到成功或失败不更改当前视图，409 后不调用其他接口补读。
2. **红：** `node --test frontend/tests/preview.test.mjs`，预期错误读取工作副本、切换残留旧画面或旧响应覆盖当前目标。
3. **最小实现：** 窄屏 iframe 只在保存后打开，产品先卡片再详情，其他内容复用对应 H5 视图。切换即清空，只提交与当前 ID、修订和请求匹配的结果；不另取 Item 读取最新草稿。失权清空、停止私有读。无缓存或私有正文持久化。冲突保留输入，检查确认绑定已核修订。
4. **绿：** 重跑单测、类型检查与构建。`BAD/LIVE/RACE/STALE/SWITCH` 分别走 L/CAP/K，按 WF-001、002、012、013、014 的[唯一流程定义](../../design/frontend.md#business-workflows)执行。BAD 另核无线上首稿三处不可见、匿名预览与私有图拒绝、PC 双轴+分类组合仍一行；LIVE 核对未选合格稿不变。STALE 从真实编辑页保存新修订后重开旧链接：见预览 GET 409、空画面及无其他读取；无效参数分支查零请求。SWITCH 在隔离环境通过真实请求时序让甲迟返，保存乙画面和甲实际响应，复查同一草稿没有预览写入；不得改写响应。无获批状态图或无法安全制造真实换序时，对应 case BLOCKED。逐阶段留证并按正常流程清理。
5. **检查点：** 公开及预览路由使用不同取数函数但同一渲染组件；预计 `feat: 以保存修订预览并保护编辑输入`，仅另获授权提交。

- [ ] **Task frontend-008: 让只有编辑权的人把历史版本恢复成新草稿**

**Files:** Create: `frontend/admin/src/panels/History.vue`；Modify: `frontend/admin/src/{routes.ts,api.ts,editor.ts,pages/ItemEditor.vue,pages/Configuration.vue,pages/Directory.vue}`、`frontend/shared/contracts.ts`；Test: `frontend/tests/history.test.mjs`。

**Reasoning:** D-021/WF-003 是独立可审核的交付：恢复可以由无发布权编辑完成，和恢复后再次发布不是一个动作。

**Depends on:** frontend-007, backend-011

**Interfaces:** Consumes 分页版本、actor/来源 seq、expected_revision 与 confirm_overwrite；Produces `/admin/items/:id/history`（路由宿主组合 History 面板）、只读版本对比和恢复 UI；Contract checks：必要时确认覆盖、单条原子恢复、冲突不抹同事草稿、当前发布权限单独判断。

**Template:** History panel. **Script:** version, edit permission, overwrite confirmation. **Style:** PC labels and dialogs. **Visual Checks:** REST; [Frontend Interface and Visual Contract](05-interfaces.md#2-frontend-interface-and-visual-contract).

1. **失败测试：** `assert.equal(canRestore({can_edit:true,can_publish:false}),true)`；当前有草稿但未确认时不能发 restore；409 保留本地选择且需重新核对；成功不得随后调用 publish。
2. **红：** `node --test frontend/tests/history.test.mjs`，预期恢复错误地要求发布权或覆写未确认稿。
3. **最小实现：** 历史按版本、时间、来源修订、操作者展示，对照线上/草稿且只从私有端读历史图。确认文字指出条目、来源版、有无当前草稿；取消不发写，恢复成功显示“已恢复为草稿”，刷新草稿和审计，不显示“已上线”。无权编辑者不能使用恢复，但治理本身不授任何发布能力。
4. **绿：** 重跑单测、类型检查与构建。`REST` 走 L/CAP/K。WF-003：用 003–007 建同款至少两版和另一个对照条目；E（只有编辑权）选旧版本，E2 在覆盖确认前保存，E 提交得 409，重新进入看到同事草稿。重新核对来源、再次确认后，仅本条出现新修订及含操作者、来源 seq 的恢复审计；其他条目的草稿/记录不变，V 从两分类仍见原 live。验证 E 发布 403：测试阶段让 E 曾持发布权时在其独立会话保留已核对的真实确认界面，由 A 撤权，再按上述流程以编辑身份恢复；用同账号另一未刷新的旧页真实发起发布（不注入按钮/Token），记录服务器先拒绝权限；不可安全重现则明确 BLOCKED。最后恢复权限/销毁测试部署。
5. **检查点：** 确认恢复不动原版本和 live；预计 `feat: 编辑独立恢复历史为草稿`，仅另获授权提交。

- [ ] **Task frontend-009: 多选产品追加位置、只发布合格款并核对中断回执**

**Files:** Create: `frontend/admin/src/{batch.ts,panels/Batch.vue}`；Modify: `frontend/admin/src/{api.ts,pages/Items.vue,panels/Release.vue}`、`frontend/shared/contracts.ts`；Test: `frontend/tests/batch.test.mjs`。

**Reasoning:** 批量追加只写选中产品的工作稿；批量发布的事务单位始终是一款。跨批后仅恢复一款要用前项的真实历史 UI。

**Depends on:** frontend-007, frontend-008, backend-007, backend-008, backend-009

**Interfaces:** Consumes Choice/Check/Receipt 与已恢复版本面板、按键检索 audit；Produces 产品表批量面板、逐款状态和只读核单/手动同键复核；Contract checks：案例不开放批量，未选永不提交、unknown 不当失败，筛选/翻页保留明确选择计数或要求明确重选。

**Template:** Batch panel. **Script:** selected IDs, eligible checks, ambiguous receipt. **Style:** PC text status, not color-only. **Visual Checks:** APPEND/BATCH; [Frontend Interface and Visual Contract](05-interfaces.md#2-frontend-interface-and-visual-contract).

1. **失败测试：** `assert.deepEqual(toConfirm(checks).map(x=>x.id),eightIds)`；无合格款禁用，每条保留单独 `request_key`+源修订；断线进入 `unknown`，空核单不退回“尚未发布”，无自动重发。追加重复位置不把未变行标为已上线。
2. **红：** `node --test frontend/tests/batch.test.mjs`，预期发送无稿款、丢失键或误清未知状态。
3. **最小实现：** Element Plus 多选与面板区分“追加展示位置（仅存草稿）”和“发布检查”。列出逐款缺项、无稿、可发及影响位置；数量等于合格数，0 禁用。逐 ID 发送确认，关闭前提示未完成，暂停发送不声称取消已到达请求。为关页重进，仅存当前同源、账号绑定的待核单标识（ID/原修订/原键，不含草稿、口令或图片）；先重验当前会话权限，再调用只读 audit，完成或登出清理。只允许明确二次确认后同绑定原键重试，不能新键补发；已失权立即停止、清除敏感结果。
4. **绿：** 重跑单测、类型检查和构建，`APPEND/BATCH` 各走 L/CAP/K。WF-004 核甲的去重、乙的原稿、丙未选，V 回读旧版。WF-005 先在稳定网络完成 8 合格＋1 缺图＋1 无稿的正常批次，另留未选对照；查零款禁用、八款各一版本及同批只恢复一款。另用真实 UI 重建混合批次，在一款已提交而回执未到、至少一款尚未发起时真实断连，不替换请求或响应。重进按原键核对，空回执仍未知，手动同键复核后不得重复版本或日志。用请求及同一 ID 重进证明未发起各款不自动补发且状态未变。触发不了真实中断就记 BLOCKED，正常批次不能代替。按正常流程回收。
5. **检查点：** 复核中断时证据脱敏、批内失败不损其他款；预计 `feat: 逐款核对并发布所选合格产品`，仅另获授权提交。

- [ ] **Task frontend-010: 限定下架归档，并在旧页面落实撤权与停用**

**Files:** Modify: `frontend/admin/src/{api.ts,session.ts,pages/Items.vue,pages/ItemEditor.vue,pages/Governance.vue,panels/Release.vue,panels/History.vue,panels/Batch.vue}`；Test: `frontend/tests/retire.test.mjs`。

**Reasoning:** 对同一关联案例检查下架和归档的影响；跨独立会话证明治理不仅是隐藏按钮。

**Depends on:** frontend-002, frontend-007, frontend-008, frontend-009, backend-003, backend-010

**Interfaces:** Consumes `I/impact` 的 case_ids、期望修订、I/unlist/archive、线上和审计；Produces 产品/案例行级影响清单、取消/确认、归档筛选、权限失效结果；Contract checks：对比集合变了重新确认，绝不对关联案例发写；归档仍能查历史。

**Template:** row actions and confirmation panels. **Script:** impact set, lifecycle and session status. **Style:** PC dangerous-action boundary. **Visual Checks:** REVOKE/UNLIST/ARCH; [Frontend Interface and Visual Contract](05-interfaces.md#2-frontend-interface-and-visual-contract).

1. **失败测试：** `assert.equal(canArchive({live_id:'3',has_history:true}),false)`；下架后留历史不能删除；确认版本/案例集合变化不沿用旧确认，撤权响应后批量结果不再显示。
2. **红：** `node --test frontend/tests/retire.test.mjs`，预期线上允许归档或取消仍发写。
3. **最小实现：** 两个列表按行读取目标、关联名单、影响位置，二次确认写本人操作的唯一目标。已下架有历史只允许归档；归档结果退出日常列表但可筛出看历史与审计。旧页面收到 401/403 不自动重试；可用 edit 与 publish 分开刷新，停用后清理并离开私有界面。
4. **绿：** 重跑单测、类型检查和构建。`REVOKE/UNLIST/ARCH` 各走 L/CAP/K。WF-006：A 与 P 分会话，P 自发后仍开另一已核表单；A 撤权，旧页再确认应失败且仍能存稿；再停用，旧会话保存拒绝。核普通 E 与仅治理 A 不能自授（E）、不能批量看检查/发布或归档；以此前拥有合法能力的保留页按 UI 正常提交验证实际拒绝并查 A 的授权记录，无法安全触发的分支记 BLOCKED。WF-007：双位置产品关联独立线上案例，先取消再确认下架，V 重进两个分类/搜索/详情，产品不可见、案例图文仍在。WF-009：产品与案例各有历史，验证在线不能删/归档、下架后仍不能删；需要实际服务端拒绝时可在合规旧页与另一会话状态切换间复现，不加非法按钮。归档时列案例名，集合若变重新查；下架再归档各自目标，默认列表排除、历史和审计可查且关联案例保持公开。复原账号原权限或销毁部署，记录交接的全部 ID。
5. **检查点：** 发版不回退业务版本，不让禁用页面用缓存显示“成功”；预计 `feat: 安全下架归档并响应授权变更`，仅另获授权提交。
