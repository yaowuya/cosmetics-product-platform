import { createSSRApp } from 'vue';
import App from './App.vue';

/** H5 对外使用稳定的业务地址。复用 uni 已生成的页面描述，不生成第二套页面或路由器。 */
function registerPublicPaths() {
  type PageRoute = { path: string; alias?: string; meta: Record<string, unknown> };
  const routes = (window as unknown as { __uniRoutes: PageRoute[] }).__uniRoutes;
  const paths: Record<string, string[]> = { Catalog: ['/catalog'], Cases: ['/cases', '/cases/detail'],
    Contact: ['/contact'], Product: ['/products'], Preview: ['/preview'] };
  for (const [page, urls] of Object.entries(paths)) {
    const registered = routes.find(route => route.path === `/pages/${page}`);
    if (!registered) continue;
    for (const path of urls) if (!routes.some(route => route.path === path)) routes.push({ ...registered, path });
  }
}

/** uni-app 的 H5 启动入口，不安装管理会话或后台组件。 */
export function createApp() {
  registerPublicPaths();
  return { app: createSSRApp(App) };
}
