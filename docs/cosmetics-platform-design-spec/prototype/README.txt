微肽生物 · 产品电子册 · 静态文件完整包

本包包含2026年11月22日更新：
首页使用用户提供的4张产品长图轮播，每4秒自动切换、支持左右切换和底部圆点指示。
4张原图均为1228×2048；按原比例完整显示，圆点紧接图片下方。
长图可以上下阅读，阅读中下部时暂停自动翻页；回到顶部后恢复。
产品目录沿用已确认的第10个方案：80px分类栏，数量在右侧筛选栏末端。
身体护理已移到护肤分类末尾；护肤共12类，洗护共4类。
品牌案例分为精选案例、冻干案例、二类案例、外贸案例。
护肤案例、洗护案例入口与对应示例已移除；产品目录的护肤、洗护板块保留。
品牌案例顶部大卡片右侧仅展示品牌名称、产品名称、简短亮点介绍。
案例亮点保存在src/catalog-data.json的caseHighlight字段中，修改后运行build.py。
联系我们采用“服务与合作”页面：服务内容纵向展示、支持放大，顶部可直接打开联系二维码弹窗。
当前服务内容与二维码均为示意；企业可在src/contact-data.json中维护自己的资料。
联系我们文字已精修：页头与服务主标题17px（窄屏服务标题16px）、联系区与弹窗标题14px。

一、直接预览
1. 将整个ZIP解压到任意文件夹。
2. 双击根目录的 index.html，用 Chrome 或 Edge 浏览器打开。
3. 不需要安装 Node.js、不需要启动后台，也不需要联网加载图片。
4. 桌面显示 HONOR 400 手机式预览；手机浏览器自动适配屏幕。
   如需直接查看产品目录，可在页面底部点击“产品目录”。

二、文件用途
index.html              可直接预览、也可部署的完整静态页面。
src/app.html            应用页面模板。
src/app.js              导航、搜索、筛选、详情、轮播等交互源码。
src/catalog-data.json   分类、产品、配方编号及示例详情数据。
src/contact-data.json   服务标题、文案、图片路径、联系二维码及可选联系方式。
src/contact-dialog.html 服务图片及联系二维码弹窗模板。
src/*.css               页面、设备外框、公司介绍、联系页和案例样式。
src/*.html              各页面与手机外框模板。
src/assets/            全部图片与资产说明；包含4张首页JPEG原图及WebP预览副本。
src/icons.json         页面使用的35个图标定义。
build.py               便携构建脚本，仅使用Python标准库。
licenses/              第三方图标许可证。

三、修改后重新生成
1. 修改 src/ 中相应的模板、样式、交互、产品数据或图片。
2. 在本文件夹打开终端，使用已安装的Python 3.9或更高版本运行：
   Windows：py -3 build.py
   macOS / Linux：python3 build.py
3. 脚本会更新本文件夹下的 index.html；刷新或重新打开即可。
4. src/ 内的HTML和JavaScript是构建模板，请通过根目录index.html预览。
   build.py会覆盖index.html，因此需要长期保留的修改请写在src/中。

四、替换首页长图
4张轮播海报分别是（按播放顺序）：
src/assets/home-poster-01.jpg    光感微珠素颜霜
src/assets/home-poster-02.jpg    三曜凝时精华油
src/assets/home-poster-03.jpg    三相双仓抗醇精华
src/assets/home-poster-04.jpg    双萃奢润精华粉底液
这4个JPEG文件保留用户上传的原始字节，页面中没有裁切或拉伸。
替换这4个文件后运行build.py即可；图片始终按原比例显示。
当前图片尺寸1228×2048，宽高比约3:5；建议新图使用同样尺寸。
400px显示宽度对应约667px高，360px宽对应约600px高。
如需增加到5张或更多，在src/company.html中增加同结构的company-slide，
并将build.py中首页asset_files的range上限调整为“总张数+1”。
圆点数量会自动同步。修改图片比例时，同步company.html的width/height
以及company.css内company-track的aspect-ratio。
home-preview-*.webp仅用于聊天中的轻量预览，原始尺寸与JPEG相同。
旧版home-poster-*.webp及其提示词是历史示例素材，当前首页不再使用。

五、替换服务图片与联系方式
1. 打开src/contact-data.json，可修改页面标题、服务项目及服务顺序。
2. services数组中每个项目的image填写相对于src的图片路径，例如assets/service-research.jpg。
   路径为空时展示现有版式示意；填写后改为图片，完整显示原比例，点击可放大。
   可添加或删除服务项目；设置enabled为false可隐藏项目。id应唯一。
3. contact.qrImage填写二维码图片路径，例如assets/contact-qr.png。
   未提供真实二维码时只显示明确标注的示意图，不会生成假的可扫码图片。
4. contact.wechatId、phone、email按需填写，留空时不展示对应操作。
   配置真实二维码后弹窗提供保存二维码，填写微信号后提供复制微信号。
5. 资料替换完成后，将isDemo设为false，并修改或清空contact.note示例提示。
6. 运行build.py重新生成index.html。支持PNG、JPEG、WebP、GIF、SVG，图片保存在src目录内。
   手机端可用长图，建议常规服务图片采用1200×800px；二维码单独上传清晰正方形原图。

六、部署
将根目录的 index.html 上传到静态网站目录即可。
图片、样式、图标、数据和JavaScript已内嵌在该文件中。
src/和build.py用于后续修改，线上运行只需要index.html。

七、当前内容说明
这是交互原型，保留首页轮播、产品目录、品牌案例和联系我们。
产品图片、功效、成分和生产状态等示例内容，以页面标记为准。
本包未接入后端数据库或后台管理系统。
本地打开时，如果浏览器限制一键复制配方编号，页面会弹出手动复制窗口。
