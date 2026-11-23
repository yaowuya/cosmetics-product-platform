import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { publicPath, publicRequestOptions } from '../h5/src/public-api.ts';
import { adminPath, adminRequestOptions } from '../admin/src/api.ts';
import { readResponse } from '../shared/contracts.ts';

test('公开客户端只构造同源匿名 GET', () => {
  assert.equal(publicPath('/api/public/products?q=serum'), '/api/public/products?q=serum');
  assert.throws(() => publicPath('/api/admin/me'));
  assert.throws(() => publicPath('https://other.invalid/api/public/products'));
  assert.deepEqual(publicRequestOptions(), { method: 'GET', credentials: 'omit', redirect: 'error' });
});

test('管理写请求走同源管理入口并要求防伪值', () => {
  assert.equal(adminPath('/api/admin/items/1/draft'), '/api/admin/items/1/draft');
  assert.throws(() => adminPath('/api/public/products'));
  assert.throws(() => adminPath('https://other.invalid/api/admin/me'));
  assert.throws(() => adminRequestOptions('PUT', { body: {} }));
  const request = adminRequestOptions('PUT', { csrfToken: 'session-csrf', body: { revision: '1' } });
  assert.equal(request.credentials, 'same-origin');
  assert.equal(request.redirect, 'error');
  assert.equal(request.headers.get('X-CSRF-Token'), 'session-csrf');
  assert.equal(request.body, '{"revision":"1"}');
});

test('响应保留十进制标识且 204 不要求正文', async () => {
  const id = '9007199254740993';
  assert.deepEqual(await readResponse(Response.json({ id, revision: '0' })), { id, revision: '0' });
  assert.equal(await readResponse(new Response(null, { status: 204 })), undefined);
});

test('真实构建入口各自引用存在的脚本', async () => {
  const builds = [
    { dir: new URL('../h5/dist/build/h5/', import.meta.url), base: '/' },
    { dir: new URL('../admin/dist/', import.meta.url), base: '/admin/' },
  ];
  for (const { dir, base } of builds) {
    const html = await readFile(new URL('index.html', dir), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(scripts.length > 0, `${base} must include a built entry script`);
    for (const script of scripts) {
      assert.ok(script.startsWith(`${base}assets/`), `${base} must not load ${script}`);
      assert.ok((await stat(new URL(script.slice(base.length), dir))).isFile());
    }
  }
});
