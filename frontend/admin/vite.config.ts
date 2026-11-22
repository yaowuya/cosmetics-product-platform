import { readFileSync } from 'node:fs';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'ADMIN_TEST_');
  const certificate = env.ADMIN_TEST_TLS_CERT;
  const key = env.ADMIN_TEST_TLS_KEY;
  const api = env.ADMIN_TEST_API_ORIGIN;
  if (command === 'serve' && (certificate || key || api) && !(certificate && key && api)) {
    throw new Error('HTTPS API testing requires certificate, key and API origin together');
  }
  return {
    plugins: [vue()],
    base: '/admin/',
    server: command === 'serve' && certificate && key && api
      ? {
          // 证书路径由获准的测试环境提供；保留 Host，不能靠代理绕过权限校验。
          https: { cert: readFileSync(certificate), key: readFileSync(key) },
          proxy: { '/api': { target: api, changeOrigin: false } },
        }
      : undefined,
  };
});
