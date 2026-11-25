import { createSSRApp } from 'vue';
import App from './App.vue';

/** 为 uni 的保活路由登记公开地址，并沿用页面中的无障碍导航。 */
function registerPublicPaths() {
  type PageRoute = { path: string; alias?: string; meta: Record<string, unknown> };
  const { __uniRoutes: routes, __uniConfig: config } = window as unknown as {
    __uniRoutes: PageRoute[];
    __uniConfig: { tabBar?: { shown: boolean } };
  };
  // Keep the runtime's tab lifecycle without rendering a second bar or reserving its height.
  if (config.tabBar) config.tabBar.shown = false;
  const paths: Record<string, string[]> = { Catalog: ['/catalog'], Cases: ['/cases', '/cases/detail'],
    Contact: ['/contact'], Product: ['/products'], Preview: ['/preview'] };
  for (const [page, urls] of Object.entries(paths)) {
    const registered = routes.find(route => route.path === `/pages/${page}`);
    if (!registered) continue;
    for (const path of urls) {
      if (routes.some(route => route.path === path)) continue;
      // The case detail shares the component but must not enter the tab cache.
      const meta = path === '/cases/detail'
        ? { ...registered.meta, isTabBar: false, isQuit: false, tabBarIndex: undefined }
        : registered.meta;
      routes.push({ ...registered, path, meta });
    }
  }
}

/** uni-app 的 H5 启动入口，不安装管理会话或后台组件。 */
export function createApp() {
  registerPublicPaths();
  return { app: createSSRApp(App) };
}
