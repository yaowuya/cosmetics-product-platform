# Execution Progress

Plan files: [唯一前端计划](../tasks/plan-frontend.md)

Base SHA: `0e7c09b138f8f883d4af2c41efb761393e98ff92`（实现开始时的基线；不是当前 HEAD）。

## Completed

- `frontend-001`：完成版本来源解析、固定公开 GET、视图投影和分页协调。先写行为测试，观察缺模块失败后实现，九项模块测试通过；复核 ID 不转 JS Number、正式环境不回退、分页代次和失败保留。唯一任务计划已勾选。
- `frontend-002` 本地交付部分：四原生 Tab、两个独立详情、原生电话/剪贴板/二维码、开发者工具工程与[使用说明](../../../../frontend/miniapp/README.md)。配方编号复制保留 H5 行为；本地回归发现目录旧图的迟到失败可能误隐藏当前图，新增失败测试后按当前源匹配修复。未改 H5、PC、后端、数据库、根工作区依赖或线上配置。
- `npm --prefix frontend/miniapp test`：17/17 PASS。涵盖 JSON/入口、WXML 事件到 Page 方法的静态接线、公开请求边界、筛选分页并发、目录回退、独立详情 404、海报计时、联系系统 API 参数。纯 Node/受控 `wx` 回调，不表示原生编译、视觉或真实 E2E 通过。
- `npm --prefix frontend run typecheck`：PASS。现有 Web `npm --prefix frontend test` 子进程 `Error: spawn EPERM`；改用同测试集 `node --test --test-isolation=none 'tests/*.test.mjs'`（在 `frontend` 下）：33/35，两个 dev 代理用例都在 esbuild 启动时 `Error: spawn EPERM`。`npm --prefix frontend run build` 的 H5/admin 均在 esbuild 启动时同样受阻。未尝试绕过限制。
- `.venv/Scripts/python.exe -B -m pytest -q -p no:cacheprovider tests/test_api_contract.py tests/test_http_boundaries.py tests/test_layer_contract.py`：6/6 PASS（现有 Starlette TestClient 弃用警告）。公开路径/方法、非法 ID 和预览参数拒绝、管理路由匿名隔离、后端分层通过；这是进程内契约测试，不启动服务器或连接数据库。
- MySQL 发布回归未验证：实现阶段尝试启动独立 loopback 临时 MySQL，作业无测试结果，超时后停止，未发现临时数据目录，已移除辅助脚本。`tests/test_public.py` / `tests/test_public_media.py` 未获得 PASS；没有原生真实互通结果。

## Blocked

- `frontend-002` 总任务（`interactive`）：提交检查之前的最高证据阶段为 `SOURCE_READY`。未确认可用微信开发者工具，静态源码检查不代替 `STATIC_UI_READY` 的真实编译/渲染；原生视觉 `CANNOT_VERIFY`，E2E `REQUIRED / BLOCKED`。UI 计划复选框保留未勾。按 P-004 仍先交付代码和本地可执行测试。

| Case | 视觉证据预检 | 真实端到端矩阵 |
| --- | --- | --- |
| VC-01 首页 | [视觉](visual/frontend-002/VC-01/manifest.md) | [E2E](e2e/frontend-002/VC-01/coverage-matrix.md) |
| VC-02 目录 | [视觉](visual/frontend-002/VC-02/manifest.md) | [E2E](e2e/frontend-002/VC-02/coverage-matrix.md) |
| VC-03 案例 | [视觉](visual/frontend-002/VC-03/manifest.md) | [E2E](e2e/frontend-002/VC-03/coverage-matrix.md) |
| VC-04 详情与联系 | [视觉](visual/frontend-002/VC-04/manifest.md) | [E2E](e2e/frontend-002/VC-04/coverage-matrix.md) |

- 正式验收：需要小程序开发者工具、有效 AppID、可信 HTTPS 443/合法域名、正常发布的隔离 QA 内容、实际模拟器和 iOS/Android 操作。不以 H5 页面或注入用例代替；管理员决定何时上传、提审或上线。
- 最终审查预检：`git rev-parse --verify HEAD` 返回 `fatal: Needed a single revision`（退出 128）；原基线可读但不能作为当前提交目标。另有原生真实证据缺失，不能进入通过态或归档。见[最终审查预检](reviews/20261124-1533-final-review.md)。未代用户重建分支、暂存或提交。

## Notes

- 用户委托采用推荐并继续（m00307）；无生产变更、无工具安装授权。`.codegraph/` 原本不存在；未初始化。外置 `crapper`、`dryer`、`mutator` 未发现，不将其记作已执行。
- 原 H5/PC/共享图标的已有差异未纳入本变更或改动。
- 本机联调补记（2026-11-24）：用户的 DevTools 3.18.0 已编译并启动页面，但即使启用仅本地的「不校验」，`wx.request` 仍报告 `net::ERR_CERT_AUTHORITY_INVALID`（m01103）。同一 HTTPS 端口无信任时自签验证红、指定本机证书后通过。新增独立[本机只读入口](../../../../frontend/tools/miniapp-local.cjs)和[联调说明](../../../../frontend/miniapp/README.md#L5-L11)，开发版改用回环 HTTP 5145；原 HTTPS 5144 `/health/ready` 仍为 `200`，桥接下七条实际公开读路由为 `200`、管理路由为 `404`。Node 检查 18/18。随后用户确认本机联调已恢复（m01193）；这是开发者工具冒烟，不视作逐页视觉验收或真机 E2E。
- 提交前复核：分支引用经授权恢复至 `5959a0dd620cbdd71575cc8fd4082e13dc6cd6b3`，先前 HEAD 报错仅记录于历史预检。修复纯空白关键词的筛选呈现、目录断图时的发布文案回退，并明确强制本机桥接的上游证书验证。小程序 Node 回归 20/20。正式视觉与真实 E2E 仍待验证。
