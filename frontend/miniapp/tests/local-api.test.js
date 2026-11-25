const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { createLocalApiServer } = require('../../tools/miniapp-local.cjs');

async function listen(t, server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('local HTTP bridge preserves published responses but excludes admin, non-GET and credentials', async t => {
  const calls = [];
  const upstream = http.createServer((req, res) => {
    calls.push({ url: req.url, headers: req.headers });
    if (req.url.endsWith('/products/42')) {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"code":"not_found"}');
    } else if (req.url.endsWith('/media/42/thumbnail')) {
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store' }).end('thumbnail');
    } else if (req.url.endsWith('/media/42')) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).end(Buffer.from([137, 80, 78, 71]));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'ignored=1' }).end('{"items":[]}');
    }
  });
  const target = await listen(t, upstream);
  const bridge = await listen(t, createLocalApiServer((path, receive) => http.request(target + path, receive)));

  const list = await fetch(`${bridge}/api/public/products?q=%E7%94%A8`, {
    headers: { Authorization: 'Bearer test-only', Cookie: 'test-only=1' },
  });
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), { items: [] });
  assert.equal(list.headers.get('set-cookie'), null);
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(calls[0].headers.cookie, undefined);

  const media = await fetch(`${bridge}/api/public/media/42`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'image/png');
  assert.equal(media.headers.get('cache-control'), 'no-store');
  assert.deepEqual([...new Uint8Array(await media.arrayBuffer())], [137, 80, 78, 71]);
  const thumbnail = await fetch(`${bridge}/api/public/media/42/thumbnail`);
  assert.equal(thumbnail.status, 200);
  assert.equal(thumbnail.headers.get('content-type'), 'image/webp');
  assert.equal(await thumbnail.text(), 'thumbnail');
  const missing = await fetch(`${bridge}/api/public/products/42`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { code: 'not_found' });

  assert.equal((await fetch(`${bridge}/api/admin/accounts`)).status, 404);
  assert.equal((await fetch(`${bridge}/api/public/%2e%2e%2fadmin/accounts`)).status, 404);
  assert.equal((await fetch(`${bridge}/api/public/products`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${bridge}/api/public/media/42/thumbnail`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${bridge}/api/public/media/42/detail`)).status, 404);
  assert.deepEqual(calls.map(({ url }) => url), [
    '/api/public/products?q=%E7%94%A8', '/api/public/media/42', '/api/public/media/42/thumbnail', '/api/public/products/42',
  ]);
});
