const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveOrigin } = require('../lib/config');
const { createPublicApi } = require('../lib/public-api');

const origin = 'https://showcase.example.com';
const largeId = '9007199254740993';

function client(respond) {
  const calls = [];
  const api = createPublicApi({ origin, request(options) { calls.push(options); respond(options); } });
  return { api, calls };
}

test('a misconfigured release does not inherit develop or use IP, paths or arbitrary ports', () => {
  const config = { develop: 'http://127.0.0.1:5155', trial: origin };
  assert.equal(resolveOrigin('develop', config), config.develop);
  assert.equal(resolveOrigin('trial', config), origin);
  assert.equal(resolveOrigin('release', config), '');
  assert.equal(resolveOrigin(undefined, config), '');
  for (const value of ['https://127.0.0.1', 'http://showcase.example.com', `${origin}/api`, `${origin}:5155`,
    'https://user@showcase.example.com', `${origin}?path=`, 'https://demo.localhost', 'https://127.0.0.1.nip.io:123']) {
    assert.equal(resolveOrigin('release', { release: value }), '', value);
  }
});

test('product search only sends bounded public GET parameters and preserves decimal IDs', async () => {
  const data = { page: 2, page_size: 20, total: 24, items: [{ id: largeId, body: { name: '有效' } }] };
  const { api, calls } = client(({ success }) => success({ statusCode: 200, data }));
  assert.deepEqual(await api.products({ board_id: largeId, node_id: '2', q: '  美白/组合  ', revision: '9' }, 2), data);
  const req = calls[0];
  assert.equal(req.method, 'GET');
  const url = new URL(req.url);
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, '/api/public/products');
  assert.deepEqual(Object.fromEntries(url.searchParams), { board_id: largeId, q: '美白/组合', page: '2', page_size: '20' });
  assert.equal(req.header.Authorization, undefined);
  assert.equal(req.header.Cookie, undefined);
  await assert.rejects(api.products({ board_id: 'bad' }, 1), { kind: 'input' });
  await assert.rejects(api.product('9223372036854775808'), { kind: 'input' });
  await assert.rejects(api.page('../manage'), { kind: 'input' });
  assert.equal(calls.length, 1);
});

test('detail distinguishes not public, transport failure and invalid responses', async () => {
  const missing = client(({ success }) => success({ statusCode: 404, data: {} }));
  await assert.rejects(missing.api.product(largeId), { kind: 'missing' });
  assert.equal(missing.calls[0].url, `${origin}/api/public/products/${largeId}`);
  await assert.rejects(client(({ fail }) => fail()).api.case('1'), { kind: 'network' });
  await assert.rejects(client(({ success }) => success({ statusCode: 302 })).api.case('1'), { kind: 'http' });
  await assert.rejects(client(({ success }) => success({ statusCode: 200, data: { id: 1, body: {} } })).api.case('1'), { kind: 'contract' });
  await assert.rejects(client(({ success }) => success({ statusCode: 200, data: { id: '2', body: {} } })).api.case('1'), { kind: 'contract' });
  await assert.rejects(createPublicApi({ origin: '', request() { assert.fail('no fallback'); } }).page('home'), { kind: 'config' });
});

test('known page and case list use different endpoints and strict envelope shapes', async () => {
  const { api, calls } = client(({ url, success }) => success({ statusCode: 200, data: url.endsWith('/home')
    ? { page: 'home', body: {} } : { items: [], total: 0, page: 1, page_size: 20 } }));
  assert.deepEqual(await api.page('home'), {});
  await api.cases({ tag: '护理 + 样例', q: '  亮泽 ' }, 1);
  assert.deepEqual(Object.fromEntries(new URL(calls[1].url).searchParams), { tag: '护理 + 样例', q: '亮泽', page: '1', page_size: '20' });
  await assert.rejects(client(({ success }) => success({ statusCode: 200, data: { nodes: [], counts: [] } })).api.catalog(), { kind: 'contract' });
  await assert.rejects(client(({ success }) => success({ statusCode: 200, data: { items: [], total: 0, page: 2, page_size: 20 } })).api.cases({}, 1), { kind: 'contract' });
});

test('remote images accept only canonical same-origin published media paths', () => {
  const { api } = client(() => assert.fail('media URL resolution is pure'));
  assert.equal(api.mediaUrl(`/api/public/media/${largeId}`), `${origin}/api/public/media/${largeId}`);
  for (const path of [`${origin}/api/public/media/2`, '//elsewhere.test/p.jpg', '/api/admin/media/2', '/api/public/media/02',
    '/api/public/media/2?preview=1', '/api/public/media/%32', '/api/public/media/2#sample', '/api/public/media/2\n']) {
    assert.equal(api.mediaUrl(path), '', path);
  }
});
