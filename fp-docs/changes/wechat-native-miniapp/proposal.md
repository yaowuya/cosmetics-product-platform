# 微信原生小程序

## Why

现有 H5 已能展示企业图册，但微信用户还没有独立的小程序入口。首版在微信内提供同一套公开内容，用原生页面浏览产品和案例，并保留现有后台的发布方式。

## What Changes

### 1. 提供六个原生公开页面

- 首页展示已发布的企业介绍，可进入产品目录、品牌案例和联系我们。
- 产品目录支持目录板块、分类、搜索和分页。产品详情展示已发布图文和图片；返回列表时保留筛选、搜索和浏览位置。
- 品牌案例列表支持标签筛选、搜索和分页。案例详情展示已发布图文和图片。
- 联系我们提供一键拨号、复制微信号和二维码预览。无对应数据时不提供该操作。

### 2. 与 H5 共用发布结果

小程序读取现有匿名公开接口和图片，无需登录。后台发布一次，两个访问端都读取当前公开版本；下架后，小程序重新请求详情或图片时不再展示已撤下的公开内容。已下架和不存在的详情须有明确退出路径，不能回退为草稿或历史版本。

### 3. 本地交付和真机验收分开

交付原生小程序代码、本地验证结果和接入说明。使用正式 AppID 和合法 HTTPS 域名配置微信请求后，再分别验收 iOS 和 Android 的网络、图片、返回和联系操作。未实测的项目单列，不将本地通过视为真机通过。

## Capabilities

### New Capabilities

- `native-miniapp-showcase`：微信用户可在原生页面浏览图册、搜索产品和案例、查看详情并联系企业。
- `native-miniapp-verification`：开发人员可验证本地交付，并按说明使用正式微信配置进行后续验收。

### Modified Capabilities

- `public-showcase-distribution`：现有发布结果增加微信小程序读取端；发布规则、数据模型和公开接口契约不变。

## Out of Scope

- 不使用 `web-view`，不迁移后台登录、管理、草稿、历史或非公开预览。
- 不新增独立发布渠道，不改数据库、发布规则、现有 H5 或 PC 后台业务。
- 不代申请域名或 AppID，不配置未授权的生产环境，不提交微信审核或发布。

## Impact

- 新增独立的原生小程序工程及面向本地交付的测试和说明。现有 H5 和 PC 的构建、入口和访问方式须保持可用。
- [公开目录、页面、产品和案例接口](../../../app/controllers/public/catalog.py#L11-L57)及[公开图片接口](../../../app/controllers/public/media.py#L11-L18)由小程序直接复用，不新增后台写入。原生应用不调用管理或预览接口。
- [现有 HTTPS 部署](../../../deploy/runbook.md#L5-L10)通过网关分发 API，并不直接暴露后端。正式微信网络接入需核对合法 HTTPS 域名和网关可达性，不将上述外部配置计为本地完成。

### Handoff Decision Ledger

| ID | Decision | Source | Blocking | Status | Evidence / explicit confirmation |
| --- | --- | --- | --- | --- | --- |
| P-001 | 使用微信原生页面，不嵌入 H5 | 用户消息 m00082 | yes | `user-confirmed` | P-001：选择“整套原生小程序”；用户消息 m00082。 |
| P-002 | 覆盖现有公开 H5，不迁入后台功能 | 用户消息 m00123；[README:3–11](../../../README.md#L3-L11) | yes | `user-confirmed` | P-002：要求“走fp-start，完成完整的小程序”，沿用此前讨论的完整公开范围；用户消息 m00123。 |
| P-003 | H5 与小程序共用一套发布内容 | 用户选择 P-003（m00171）；[公开 API](../../../app/controllers/public/catalog.py#L11-L57) | yes | `user-confirmed` | P-003：选择“共用一套发布内容（推荐）”；用户选择 m00171。 |
| P-004 | 本地代码与验证先交付，正式环境和真机验收单列 | 用户选择 P-004（m00174） | yes | `user-confirmed` | P-004：选择“先交付可验证的代码，真机单列（推荐）”；用户选择 m00174。 |
| P-005 | 新建独立变更的单文件提案 | 用户选择 P-005（m00176） | yes | `user-confirmed` | P-005：选择“新建独立变更的单文件提案（推荐）”；用户选择 m00176。 |

### Pre-write Confirmation Evidence

- Covered IDs: `P-001`, `P-002`, `P-003`, `P-004`, `P-005`
- Outstanding blocking decisions: `none`
- Explicit user authorization to write: 用户选择“授权写入该提案（推荐）”（m00187），批准按上述决定新建单文件 `fp-docs/changes/wechat-native-miniapp/proposal.md`；不覆盖、删除、转换或修改源码。
