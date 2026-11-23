import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';

const h5Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../h5');
const configFile = path.join(h5Root, 'vite.config.ts');

async function load(command) {
  const previous = process.cwd();
  const previousPlatform = process.env.UNI_PLATFORM;
  process.env.UNI_PLATFORM = 'h5';
  process.chdir(h5Root);
  try {
    const loaded = await loadConfigFromFile(
      { command, mode: command === 'serve' ? 'development' : 'production' },
      configFile,
      h5Root,
    );
    assert.ok(loaded, 'H5 Vite 配置应能加载');
    return loaded.config;
  } finally {
    process.chdir(previous);
    if (previousPlatform === undefined) delete process.env.UNI_PLATFORM;
    else process.env.UNI_PLATFORM = previousPlatform;
  }
}

test('H5 开发服务把 /api 转到本机后端', async () => {
  const config = await load('serve');
  const proxy = config.server?.proxy?.['/api'];
  assert.equal(proxy?.target, 'https://127.0.0.1:5144');
  assert.equal(proxy?.secure, false);
  assert.equal(proxy?.changeOrigin, false);
});

test('H5 构建不带开发代理', async () => {
  const config = await load('build');
  assert.equal(config.server?.proxy, undefined);
});
