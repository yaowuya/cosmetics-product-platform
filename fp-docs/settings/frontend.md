# FeaturePilot Frontend Settings

公开 H5 和 PC 管理后台是同一 npm 工作区中的两个应用。两者分别构建，均从部署站点的 `/api` 访问后端。

## Frontend Framework and Source Locations

| 应用根目录 | 框架和入口 | 路由 |
| --- | --- | --- |
| `frontend/admin` | Vue 3.4.21、Vite；`src/main.ts` | `src/routes.ts`；部署在 `/admin/` |
| `frontend/h5` | Vue 3.4.21、uni-app H5；`src/main.ts` | `src/pages.json` 声明页面，`src/main.ts` 登记公开地址 |

## Code Standards

### PC 管理后台

- Built-in preset: `vue`
- Rule resources: `skills/_shared/code-standards/common.md`, `skills/_shared/code-standards/vue.md`
- Applies to: `frontend/admin`；Vue 3.4.21，依据 `frontend/admin/package.json` 和 `frontend/admin/src/main.ts`。
- Project rule sources: `README.md` 的“构建和验证”，适用于工作区命令、静态部署路径和同源 API。
- Confirmed overrides: none

### 公开 H5

- Built-in preset: `vue`
- Rule resources: `skills/_shared/code-standards/common.md`, `skills/_shared/code-standards/vue.md`
- Applies to: `frontend/h5`；Vue 3.4.21、uni-app H5，依据 `frontend/h5/package.json` 和 `frontend/h5/src/main.ts`。
- Project rule sources: `README.md` 的“构建和验证”，适用于工作区命令、静态部署路径和同源 API。
- Confirmed overrides: none

## Component Library and Imports

后台使用 Element Plus 2.11.5；`frontend/admin/src/App.vue` 引入全局样式及中文语言包，页面按需导入 `El*` 组件。H5 使用 uni-app 组件，不沿用后台组件库。

## Design Tokens and Styling

各端的应用级样式见本端 `src/App.vue`，页面和视图可使用组件局部样式。未登记跨端共用的设计 token。

## Figma / Screenshot Handling

仓库中的设计参考位于 `docs/`。未登记 Figma 文件或节点映射；设计稿和原型不能代替生产实现的验证。

## Prototype Base Reference

未登记项目级原型基座。本文件不授权创建基座，也不把参考原型当成任一应用的运行入口。

## Preview and Visual Verification

从仓库根运行 `npm --prefix frontend run dev -w showcase-admin` 或 `npm --prefix frontend run dev -w showcase-h5` 启动对应开发预览。交付验证依次执行工作区的 `typecheck`、`build` 和 `test`；产物测试依赖两端已构建的文件。真实手机和部署环境的验收与本地构建分开记录。

## Unknowns

未登记共享 token 或外部设计系统映射。
