# 微信原生企业展示小程序

四个原生 Tab（首页、产品目录、品牌案例、联系我们），两个独立详情页。没有 `web-view`、登录、草稿入口或本地商品数据；与现有 H5 读取同一套后台已发布内容。无需 npm 安装或打包，微信开发者工具直接编译原生源码。

## 开发者工具导入

1. 如果本目录还没有 `project.config.json`，先把[工程模板](project.config.example.json)复制为 `project.config.json`；已有本机配置就直接保留。打开微信开发者工具，选择 **导入项目 → 小程序**，项目目录选本目录（`frontend/miniapp`，不是仓库根目录）。模板里的 `touristappid` 是占位值，请在工具内选择自己有权限的小程序 AppID，不填 AppSecret。Git 忽略本机的 `project.config.json` 和 `project.private.config.json`，团队共用设置修改模板。
2. 在仓库根目录运行 `make serve`（Windows 也可运行 `.venv/Scripts/python.exe main.py`），按[开发部署手册](../../docs/开发部署手册.md#L17-L35)复用本机 MySQL 和证书。H5 和管理端继续使用原来的 `https://127.0.0.1:5144`。
3. 另开终端，运行 `node frontend/tools/miniapp-local.cjs`。小程序[开发版来源](lib/config.js#L2-L6)使用 `https://127.0.0.1:5145`，首页海报等图片也走 HTTPS。[本机转发工具](../tools/miniapp-local.cjs)只在本机监听，转发已发布内容的 GET 请求。它与本机后端共用证书和私钥，分别通过 `SHOWCASE_TLS_CERT_FILE` 和 `SHOWCASE_TLS_KEY_FILE` 指定。默认配置可用 `curl --cacert .local/showcase/tls.crt -f https://127.0.0.1:5145/api/public/pages/home` 确认端口能读到 JSON。
4. 在微信开发者工具的「设置 → 项目设置 → 本地设置」中，仅为本机模拟器调试勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」，不要提交关闭配置。图片由渲染层加载，本机 HTTPS 证书需要覆盖 `127.0.0.1` 并受当前系统用户信任。`127.0.0.1` 只指当前设备，不用于真机或发布。换 QA 来源时只填协议、主机及所需端口，不加 `/api`、尾斜杠或参数。
5. 编译并检查六页。空配置会显示未配置，尚未发布的数据会显示空态，服务失败可重试。接通后若没有内容，先用正常管理端流程在独立 QA 环境发布合成海报、分类、商品、案例和联系方式。

## 接现有腾讯云服务器

1. DNS 给 API 主机名添加 A 记录，指向服务器公网 IP（或现有网关）。如使用中国大陆服务，按要求完成网站 ICP 备案，并另行核对小程序主体、服务类目和微信备案。
2. 让现有网关在该域名的 **HTTPS 443** 提供受信任的完整证书链，把 `/api/public/`（包含 `/api/public/media/`）原样转发到现有公开服务。不要把后台路由、FastAPI 端口或数据库一并暴露；现有 H5/PC 的入口不必更换。参见 [原部署边界](../../deploy/runbook.md#L5-L10)。
3. 在微信公众平台的小程序「开发管理 → 开发设置 → 服务器域名」填写 **request 合法域名** `https://你的域名`。代码未调用 `wx.downloadFile` 或 WebView；仍须在真机核对远程 `<image>` 和 `wx.previewImage` 的实际加载/预览，若平台对使用的媒体能力提示下载域名校验，再在相应白名单配置同一 HTTPS 主机。不要登记服务器 IP 或申请 WebView 业务域名来替代 request 合法域名。见 [微信网络文档](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)。
4. 分别填写 `trial` 和 `release`（可以是相同获准来源，也可分测试、生产）。它们只认明确配置的公网 HTTPS 主机，不继承 `develop`，也不接受裸 IP 和非 443 端口。体验版和正式版保持校验开启。正式发布前请从手机网络和 Wi-Fi 分别访问，排查证书链、DNS、域名白名单及网关路径。

## 验证与发布前检查

域名就绪后，先在电脑上对自己的测试域名执行以下只读检查。把 `miniapi.example.com` 换成已授权域名；不要加 `-k` 或 `-L`，以便看见证书问题和 30x 跳转。

```bash
curl -i https://miniapi.example.com/api/public/pages/home
curl -i https://miniapi.example.com/api/public/catalog
```

预期直接返回 `200` 和 JSON：第一条含 `page: "home"` 与 `body`，第二条含 `nodes` 与 `counts`。如果收到 H5 HTML、登录页或重定向，先查网关是否将 `/api/public/` 原样转发；命令通过不代表微信域名白名单或真机媒体通过。

本地在仓库根目录运行 `npm --prefix frontend/miniapp test`（Node 24）。参数 `--test-isolation=none` 避免受限 Windows 环境无法启动测试子进程。此命令检查原生入口文件、网络契约及以受控 `wx` 回调运行的页面脚本，不是微信编译、模拟器或真机验收。

| 场景 | 模拟器 / iOS / Android 验收 |
| --- | --- |
| 首页 | 至少两张发布长海报；纵向读完整图、横向翻页，阅读、按住或隐藏 Tab 时不自动跳页；空/断图有正确反馈。 |
| 产品目录 | 至少两个板块、三层分类和超过 20 件商品；计数、搜索、分页和失败重试；详情返回恢复列表与滚动，主动刷新时更新。 |
| 品牌案例 | 标签、搜索、精选与双列布局；超过 20 条可追加；进详情再返回不重置。 |
| 详情与联系 | 校验详情长图和公开媒体；复制配方编号/微信号/邮箱、电话、二维码预览与拒绝/缺字段反馈；用 QA 后台撤下产品/案例后重开旧详情应不可用，私有图不可读。 |

细化场景见 [执行记录](../../fp-docs/changes/wechat-native-miniapp/.fp-execute/progress.md)。正式 AppID、域名、真机体验和微信提审均与本地代码交付分开；由小程序管理员授权后上传、提审、发布。本次未操作腾讯云或微信公众平台。
