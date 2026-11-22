import uniModule from '@dcloudio/vite-plugin-uni';
import { defineConfig } from 'vite';

// DCloud 插件是 CommonJS 包，兼容其 ESM 载入形态。
const uni = (typeof uniModule === 'function' ? uniModule : (uniModule as { default: typeof uniModule }).default);
export default defineConfig({ plugins: [uni()], base: '/' });
