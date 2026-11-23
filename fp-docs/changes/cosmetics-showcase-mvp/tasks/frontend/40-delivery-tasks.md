# 跨企业与恢复交付

- [ ] **Task frontend-011: 用两家企业、真实手机和干净恢复机验收同一套交付物**

**Files:** Create/Test: `frontend/tests/delivery.test.mjs`。复用两个应用实际构建产物、已有配置编辑、真实预览、发布、历史及公开展示入口。修复确有证据的缺陷时回到该行为的 owner；不加演示页面、验证专用角色或内置企业数据。

**Reasoning:** 能在开发机打开一家企业的首页，不能证明换一家企业不用改代码，也不能证明备份后草稿图、历史图与公开图仍按原权限展示。用相同构建在独立部署中实际重进页面；后端探针和 PC 浏览器模拟都不能代替真机。

**Depends on:** frontend-007, frontend-008, frontend-009, frontend-010, backend-016

**Interfaces:** Consumes: 双构建输出、同源反代、指定修订预览、历史与素材权限、第二实例、配对备份及空的恢复目标。Produces: 同一发布包的可复查交付记录。Contract checks: 真实两域隔离，真实手机操作，恢复后公开/草稿/历史三组文字、版本和图片匹配；匿名上下文无权读私有图。

**Template:** existing views only. **Script:** real delivery artifacts and replay. **Style:** approved mobile/PC mapping. **Visual Checks:** QR/OTHER/PHONE/DR; [Frontend Interface and Visual Contract](05-interfaces.md#2-frontend-interface-and-visual-contract).

**Capability / Preservation Ownership:** FIGCAP/PRES 均 None（无 Figma 或既有生产回放）。Browser replay: [契约](05-interfaces.md) 中 `011 / QR、OTHER、PHONE、DR`，其中 QR/OTHER 分别持有 WF-010/011。每个 case 使用自己的记录，不共用结论。

1. **Step 1: Write the failing test.** 在 `delivery.test.mjs` 以 Node 原生测试验证两个构建入口的实际本地脚本引用能在各自的部署基址解析并找到字节；禁止 PC 入口解析到 H5 的脚本根或引用设计包。断言如 `assert.ok(existsSync(resolvedAsset), entry + ' 缺少入口脚本')`。将一套已构建产物复制到临时目录，移除一份入口脚本作为负例；缺少任意一端不能报告可交付。测试不修改原产物。
2. **Step 2: Run test to verify it fails.** `node --test frontend/tests/delivery.test.mjs`；在临时缺文件或基址错误的样本上观察校验未识别错误的红测。缺少依赖、环境连接失败不是预期的红测。记录所测入口，不打印凭据。
3. **Step 3: Write minimal implementation.** 只补足缺失的构建核对；复用生产视图验证以下场景，不开发新界面。
   - **Template / script / style:** 四页顺序、目录位置、产品卡/详情、案例、服务/联系及预览各走原入口。扫码、保存或长按、复制失败退回选中文字走 `platform.ts` 既有边界。无企业条件分支。不因设备窄而裁断长图或遮住末项。
   - **QR / WF-010:** 编辑在 PC 上传企业授权的测试码，记录素材 ID；发布前匿名不能取新图。发布人只发布联系条目，匿名手机从两个入口扫码读到同一个测试值；无其他公开引用的旧图返回 404，仍有公开引用的图可读。更正误发时先恢复草稿再发布，服务卡不变。
   - **OTHER / WF-011:** 从第二家企业空实例经独立管理员、编辑、发布人依次开通账号、配置并发布四页。记录两个域及各自的条目与版本，用各自匿名会话重入；第二家没有第一家的海报、分类和联系方式。在第一家重查原值和版本；不以复制样例数据库或改前端常量代替验收。
   - **PHONE:** 在实际手机浏览真实域；查看长海报、返回列表位置与底部安全区，实测复制、放大及系统允许的保存路径。拒绝权限时验证退路。记录机型、系统、DPR 和实际视口；桌面缩窄不算通过。
   - **DR:** 在专用源环境经 UI 产生可识别的旧版本、当前版本及未发布草稿，分别引用不同图片，记录稳定 ID、修订/版本及图片特征。部署人员从同一停写点备份至异机并还原到干净隔离目标。恢复域重新登录，与独立匿名会话分别打开三种视图，检查数据和图片与原记录一致；匿名图直链和公开详情不得暴露草稿或历史私图。绝不对生产源执行清理/覆盖。
   - **Visual / UX Checks、UI/E2E Lifecycle:** 四个 case 均按[视觉与真实 E2E 契约](05-interfaces.md)分别取得 `SOURCE_READY → STATIC_UI_READY → VISUAL_REVIEW_PASS → INTERACTION_READY → FRONTEND_E2E_PASS` 证据。每个 case 在 `.fp-execute/e2e/frontend-011/<Case ID>/` 留 `coverage-matrix.md` 和 `e2e-result.md`，记录 UI 发起的真实请求、版本、角色、刷新后的断言和清理结果；视觉证据单独保存。无正式对照、真实码、真机、第二部署、恢复机或一致性备份按受影响 case 记 BLOCKED，不用模版截图或同机重启代验。
4. **Step 4: Run test to verify it passes.** `npm --prefix frontend run typecheck`、`npm --prefix frontend run build`、`node --test frontend/tests/delivery.test.mjs`。预期完整产物两端通过、临时缺损/错根样本均被拒绝。再用 `playwright-cli -s=V open "$BASE/"` 与独立 `V2`、`E`、`P` 会话按上文重放；DR 使用恢复域重新登录。按授权清理测试环境，复看日志脱敏、界面与契约一致。仅构建通过不勾选任务。
5. **Step 5: Commit（候选检查点）.** 保留通过证据并核对实际改动；只有另获 Git 授权才按 `fp-commit` 提交本项测试和实际修复，绝不提交备份、真实客户素材、凭据或本地原型。
