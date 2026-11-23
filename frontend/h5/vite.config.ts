import uniModule from '@dcloudio/vite-plugin-uni';
import { defineConfig } from 'vite';

// DCloud 插件是 CommonJS 包，兼容其 ESM 载入形态。
const uni = (typeof uniModule === 'function' ? uniModule : (uniModule as { default: typeof uniModule }).default);

// 开发服务不是 API 源。公开页请求同源 /api，仅 serve 时转到本机 HTTPS，并忽略自签证书。
// 构建产物由 5144 同源提供，不在这里代理。保留 Host，与管理端一致。
export default defineConfig(({ command }) => ({
  plugins: [uni()],
  base: '/',
  server: command === 'serve'
    ? {
        proxy: {
          '/api': {
            target: 'https://127.0.0.1:5144',
            changeOrigin: false,
            secure: false,
          },
        },
      }
    : undefined,
}));
