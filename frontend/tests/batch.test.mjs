import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createRenderer, h, nextTick, ref } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { matchedRouteKey } from 'vue-router';
import { decodeAttempts, toConfirm, matchesReceipt } from '../admin/src/batch.ts';
import { account } from '../admin/src/session.ts';

test('批量只确认仍在勾选且修订一致的合格款',()=>{
 const checks=[{id:'1',revision:'4',eligible:true},{id:'2',revision:'1',eligible:false},{id:'3',revision:'3',eligible:true}];
 assert.deepEqual(toConfirm(checks,[{id:'1',revision:'4'},{id:'2',revision:'1'},{id:'3',revision:'2'}]).map(r=>r.id),['1']);
});
test('待核单数据格式受限，回执与原键、原修订和对象对应',()=>{
 const a={id:'1',revision:'4',kind:'product',key:'one-key'};
 assert.deepEqual(decodeAttempts(JSON.stringify([a,{not:'valid'}])),[a]);
 assert.deepEqual(decodeAttempts('{}'),[]);
 const row={target_id:'1',target_kind:'product',request_key:'one-key',details:{source_revision:'4',receipt:{id:'1',request_key:'one-key',release_id:'8',seq:1,revision:'5'}}};
 assert.equal(matchesReceipt(a,row)?.release_id,'8');assert.equal(matchesReceipt({...a,revision:'1'},row),null);
});

// 只在内存中加载这个 SFC。用真实按钮与 Vue 的刷新时序检验反馈，不启动浏览器或后端。
const panelUrl = new URL('../admin/src/panels/Batch.vue', import.meta.url);
async function loadBatchPanel() {
  const hook = registerHooks({ load(url, context, next) {
    if (url !== panelUrl.href) return next(url, context);
    const filename = fileURLToPath(url);
    const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename });
    return { format: 'module-typescript', shortCircuit: true, source: compileScript(descriptor, { id: 'batch-unit', inlineTemplate: true }).content };
  } });
  try { return (await import(panelUrl)).default; } finally { hook.deregister(); }
}

const element = tag => ({ tag, children: [] });
const renderer = createRenderer({
  createElement: element, createText: text => ({ text }), createComment: () => ({ text: '' }),
  setText: (node, text) => { node.text = text; },
  setElementText: (node, text) => { node.children = [{ text }]; },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1],
  patchProp: (node, key, oldValue, value) => { node[key] = value; },
  remove(node) { const list = node.parent.children; list.splice(list.indexOf(node), 1); },
  insert(node, parent, anchor) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    parent.children.splice(anchor ? parent.children.indexOf(anchor) : parent.children.length, 0, node);
    node.parent = parent;
  },
});
const descendants = node => [node, ...(node.children ?? []).flatMap(descendants)];
const content = node => node.text ?? node.children.map(content).join('');

async function openBatch(t, selected, respond) {
  const panel = await loadBatchPanel();
  let app;
  t.after(() => app?.unmount());
  const owner = account.value;
  account.value = { id: '42', can_publish: true, csrf_token: 'unit-fixture' };
  t.after(() => { account.value = owner; });
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  for (const [key, value] of Object.entries({ window: { addEventListener() {}, removeEventListener() {} }, confirm: () => true, localStorage: storage })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  t.mock.method(globalThis, 'fetch', respond);
  const root = element('root');
  app = renderer.createApp({ setup: () => () => h(panel, {
    selected: selected.value, mode: 'recover', nodes: [], onChanged: () => { selected.value = []; },
  }) });
  app.provide(matchedRouteKey, ref({ leaveGuards: new Set() }));
  app.mount(root);
  return {
    lines: () => descendants(root).filter(node => node.class === 'list-line').map(content),
    async click(label) {
      const button = descendants(root).find(node => node.tag === 'button' && content(node) === label);
      assert.ok(button && !button.disabled, `应可操作：${label}`);
      await button.onClick(); await nextTick();
    },
  };
}

test('混合十款按检查快照展示；列表刷新后仍可识别八款成功和两款跳过的原因', async t => {
  const bodies = Array.from({ length: 10 }, (_, i) => ({ name: `产品[${i}]`, formula_no: `F-${i}` }));
  const items = bodies.map((body, i) => ({ id: String(i + 1), revision: '2', kind: 'product',
    ...(i === 9 ? { live: body, draft: null } : i === 8 ? { draft: body } : { summary: body }),
  }));
  const checks = items.map(({ id, revision }, i) => ({ id, revision, eligible: i < 8, place_ids: [],
    issues: i < 8 ? [] : i === 8 ? [{ field: 'detail_asset_id', reason: '发布必填项未设置' }] : [{ field: 'draft', reason: '没有可发布的草稿' }],
  }));
  const posts = [], selected = ref(items);
  const view = await openBatch(t, selected, async (url, init) => {
    if (url === '/api/admin/products/batch-check') return Response.json({ items: checks });
    const id = /^\/api\/admin\/items\/(\d+)\/publish$/.exec(url)?.[1];
    assert.ok(id); const payload = JSON.parse(init.body);
    posts.push({ id, revision: payload.expected_revision, key: payload.request_key });
    return Response.json({ id, release_id: id, seq: Number(id), revision: '3', request_key: payload.request_key });
  });
  await view.click('批量发布检查');
  const checked = view.lines();
  await view.click('发布这 8 款');
  assert.deepEqual(posts.map(x => [x.id, x.revision]), items.slice(0, 8).map(x => [x.id, x.revision]));
  assert.equal(new Set(posts.map(x => x.key)).size, 8);
  assert.equal(selected.value.length, 0, '模拟父级刷新后不再有已选行');
  const results = view.lines();
  for (const [title, lines] of [['检查', checked], ['结果', results]]) {
    assert.equal(lines.length, 10, `${title}应各有十款`);
    for (const [i, body] of bodies.entries()) {
      const line = lines.find(s => s.includes(body.name));
      assert.ok(line?.includes(body.formula_no), `${title}缺少 ${body.name} 的配方编号`);
      if (i === 8) { assert.match(line, /长图/); assert.match(line, /发布必填项未设置/); }
      else if (i === 9) assert.match(line, /没有可发布的草稿/);
      else assert.ok(title === '检查' ? line.includes('可发布') : line.includes('已发布') && line.includes(`版本 ${i + 1}`));
    }
  }
});

test('同批回执待核时停止，核对只更新原快照中的那一款，不重发或继续队列', async t => {
  const items = ['1', '2', '3'].map(id => ({ id, revision: '4', summary: { name: `样品${id}`, formula_no: `F${id}` } }));
  const checks = items.map(({ id, revision }) => ({ id, revision, eligible: id !== '2', place_ids: [],
    issues: id === '2' ? [{ field: 'thumbnail_asset_id', reason: '引用的图片不可用' }] : [],
  }));
  const posts = [];
  const view = await openBatch(t, ref(items), async (url, init) => {
    if (url === '/api/admin/products/batch-check') return Response.json({ items: checks });
    if (init.method === 'POST') { posts.push([url, JSON.parse(init.body)]); throw new TypeError('模拟回执中断'); }
    const key = posts[0][1].request_key;
    assert.equal(new URL(url, 'https://unit.invalid').searchParams.get('request_key'), key);
    const receipt = { id: '1', release_id: '8', seq: 2, revision: '5', request_key: key };
    return Response.json({ items: [{ target_kind: 'product', target_id: '1', request_key: key, details: { source_revision: '4', receipt } }] });
  });
  await view.click('批量发布检查'); await view.click('发布这 2 款');
  const [unknown, skipped, unstarted] = view.lines();
  assert.match(unknown, /样品1.*F1.*待核对/);
  assert.match(skipped, /样品2.*F2.*跳过.*方图.*引用的图片不可用/);
  assert.match(unstarted, /样品3.*F3.*未发起/);
  const stored = JSON.parse(localStorage.getItem('showcase/pending-receipts/42'));
  assert.deepEqual(stored, [{ id: '1', revision: '4', kind: 'product', key: posts[0][1].request_key }]);
  await view.click('核对回执');
  const resolved = view.lines();
  assert.match(resolved[0], /样品1.*F1.*已发布.*版本 2/);
  assert.deepEqual(resolved.slice(1), [skipped, unstarted]);
  assert.deepEqual(posts.map(([url]) => url), ['/api/admin/items/1/publish']);
});

test('切换账号会清除本轮反馈；旧请求返回不能恢复快照或续发下一款', async t => {
  const items = ['1', '2'].map(id => ({ id, revision: '4', summary: { name: `原款${id}`, formula_no: `F${id}` } }));
  const started = Promise.withResolvers(), reply = Promise.withResolvers(), posts = [];
  const view = await openBatch(t, ref(items), async (url, init) => {
    if (url === '/api/admin/products/batch-check') {
      return Response.json({ items: items.map(({ id, revision }) => ({ id, revision, eligible: true, issues: [], place_ids: [] })) });
    }
    posts.push(url); started.resolve(); await reply.promise;
    return Response.json({ id: '1', revision: '5', release_id: '8', seq: 1, request_key: JSON.parse(init.body).request_key });
  });
  await view.click('批量发布检查');
  const run = view.click('发布这 2 款'); await started.promise;
  account.value = { id: '43', can_publish: true, csrf_token: 'second-unit-fixture' };
  await nextTick(); reply.resolve(); await run;
  assert.deepEqual(view.lines(), []);
  assert.deepEqual(posts, ['/api/admin/items/1/publish']);
  assert.equal(localStorage.getItem('showcase/pending-receipts/43'), null);
});
