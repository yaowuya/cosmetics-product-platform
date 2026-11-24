# 原始需求浏览器自测

这些用例只运行在隔离测试环境中，不用于启动交付站点。[测试入口](prd-selftest.mjs)按阶段调用本目录中的用例，具体操作和预期结果见各用例的断言。不连接公网，不使用企业业务库、默认端口 3306 或 Django 的 `TEST.NAME`。需要已经安装的 MySQL 8、可运行本项目后端的 Python 环境、Node、Playwright 和 Chrome；脚本不下载它们。

## 一次运行

1. 在仓库根按项目 README 运行两端 typecheck、build 和 Node 测试。`serve` 会在启动测试数据库前检查管理端和 H5 的 `index.html` 是否都已构建；缺任一端都会退出。另在通过 `tests/conftest.py` 身份限制的**专用数据库**运行完整 pytest；它与下面的浏览器写入库不是同一个库。
2. `https://localhost:5143` 是本机只读样例站，需有经 UI 发布的四张海报、五板块 43 类及 PRD 样例资料。不要把设计 HTML 当业务站、不要把这套数据灌入第二企业。`https://127.0.0.1:5155` 专用于本轮可写站。`prd-harness.mjs` 进入角色操作前会核对就绪状态与运行标记。
3. 创建一个只允许本机当前用户访问的 `.local/showcase` 目录，在其中准备只用于回环地址的 `tls.crt` 与 `tls.key`，创建空的 `prd-selftest.<随机字母数字>` 子目录。下面的 `$run` 是该目录，`$env:PRD_MYSQLD` 指向**已有** `mysqld` 可执行文件。运行 `python -I frontend/tests/prd-lab.py prepare $run`：它只在新目录初始化新的 datadir，显式执行迁移和正式首管 bootstrap；此时不插入产品、案例、配置正文。随后在本机预览进程中运行 `python -I frontend/tests/prd-lab.py serve $run`。该实例只监听回环地址；不得将私有目录发布为静态文件或上传到 Git。
4. 将 `$env:PLAYWRIGHT_MODULE` 指向已安装的 Playwright（若 Node 已能解析则不需要）。从仓库根运行 `node frontend/tests/prd-selftest.mjs <阶段> $run`，依次执行 `setup`、`public`、`revisions`、`products`、`catalog`、`governance`、`audit`。`catalog` 在一次性企业内用新增的专用测试发布人建立真实三款/一款对照，避免把样例缺少所需分类组合算成业务失败。只有 `public` 与产品写入阶段可以并行。`governance` 会撤回及停用本轮生成的发布人，必须晚于所有需要该身份的测试。`audit` 只从两个企业公开页复核结果，不重放发布。不要在非空、已测过的站点盲目重跑写入套件；新的完整运行使用新的目录和实例。
5. 每段 `cases-<阶段>-<轮次>.json` 逐例记 PASS/FAIL/BLOCKED、时间和实际网络证据区间；`network-*.ndjson` 只存角色、方法、路径和状态。无前提的阻塞不等于通过，最终以逐项报告为准。真实手机、真实企业二维码和干净异机恢复仍需各自的实际环境。停止本轮 `serve` 会关闭它创建的测试数据库，不停止既有企业服务；记录必要的脱敏证据后，可回收自己创建的运行目录。

`fixtures/prd/qrA.png` 与 `qrB.png` 分别编码纯文本 `PRD-LOCAL-A`、`PRD-LOCAL-B`。这两张是本测试的输入，不是企业联系方式，不能进入公开应用包。浏览器对实际返回的图片字节与这两个经离线读取的文件进行比较；此结果不代表手机已经扫码。

## 单独验证产品与案例向导及查看

完成 `setup` 并保持隔离实例运行后，执行 `node frontend/tests/prd-selftest.mjs item-wizards $run`。这个可选阶段用编辑账号 E 从列表新增、编辑和查看产品与案例草稿；发布和归档用发布账号 P（单账号隔离环境则要求 E 同时可发布）。

向导检查步骤、放弃修改和保存失败后重试。查看从名称和「查看」两个入口打开，显示已保存的名称和修订，按 Enter 不写入 API，关闭后保持列表 URL 和搜索词。

测试还模拟编辑后列表刷新失败，验证旧发布检查作废。重新检查后发布、下架并归档同一测试产品，验证归档行没有编辑入口，查看时显示历史版本，关闭后保留归档筛选。除故障注入外，请求均走真实 API。成功运行会留下两条未发布的测试草稿和一条已归档测试产品。
