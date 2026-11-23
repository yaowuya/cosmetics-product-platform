import assert from 'node:assert/strict';
import { isDeepStrictEqual as same } from 'node:util';

// Reads below listen to traffic caused by a real page action. In particular, the
// daily product list and the archive badge use the SAME path but different queries.
const origin = 'https://127.0.0.1:5155';
const products = '/api/admin/products';
const publicProducts = '/api/public/products';
const editor = id => `/admin/products/${id}`;
const itemApi = id => `/api/admin/items/${id}`;
const idList = rows => rows.map(row => row.id).sort();
const sorted = values => [...values].sort();
const byId = rows => new Map(rows.map(row => [row.id, row]));
const bodyOf = row => row?.draft ?? row?.live;
const nameOf = row => row?.summary?.name ?? bodyOf(row)?.name;
const rowFor = (page, name) => page.locator('.el-table__row').filter({ has: page.getByRole('link', { name, exact: true }) });
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const page1 = { page: '1', page_size: '20' };
const daily = { ...page1, state: null, has_draft: null, node_id: null };

function responseTo(page, path, query) {
  return page.waitForResponse(r => {
    const u = new URL(r.url());
    return r.request().method() === 'GET' && u.origin === origin && u.pathname === path &&
      Object.entries(query).every(([key, value]) => u.searchParams.get(key) === value);
  });
}
async function uiGet(page, path, query, act) {
  const [r] = await Promise.all([responseTo(page, path, query), act()]);
  assert.ok(r.ok(), `${path} 返回 ${r.status()}`);
  return r.json();
}
function completePage(data, what) {
  assert.equal(data.items.length, data.total, `${what}未完整显示，不能据首页断言不存在`);
  return data.items;
}
// Keep presentation failures until the end of the case. They must not prevent
// independent reads or a later case whose actual business prerequisites exist.
function evidence() {
  const failures = [];
  return {
    expect(ok, why) { if (!ok) failures.push(why); },
    async read(label, fn) {
      try { await fn(); } catch (error) { failures.push(`${label}：${String(error.message).split('\n')[0]}`); }
    },
    finish(summary) { if (failures.length) throw new Error(failures.join('；')); return summary; },
  };
}
function missingLong(check) {
  return check?.eligible === false && check.issues.some(issue => issue.field === 'detail_asset_id');
}
function matchesMedia(url, id) {
  if (!url || !id) return false;
  const u = new URL(url, origin);
  return u.origin === origin && u.pathname === `/api/public/media/${id}`;
}
function cardMatches(record, body) {
  return !!record && record.body.name === body.name && record.body.short_benefit === body.short_benefit &&
    matchesMedia(record.body.thumbnail_asset_url, body.thumbnail_asset_id);
}
function detailMatches(record, body) {
  return !!record && ['name', 'formula_no', 'benefit', 'ingredients', 'highlights', 'production_status'].every(k => record.body[k] === body[k]) &&
    matchesMedia(record.body.cover_asset_url, body.cover_asset_id) && matchesMedia(record.body.detail_asset_url, body.detail_asset_id);
}
function recordedPublish(row, receipt, sourceRevision, actorId) {
  return row.action === 'publish' && row.target_kind === 'product' && row.target_id === receipt.id && row.actor_id === actorId &&
    row.details?.source_revision === sourceRevision && !!receipt.request_key && row.request_key === receipt.request_key &&
    same(row.details.receipt, receipt);
}
function identifiesAffectedCases(dialog, cases) {
  return cases.every(row => dialog.result.case_ids.includes(row.id) && dialog.text.includes(row.draft.product_name) &&
    dialog.text.includes(row.draft.brand_name)) && /案例不会|不.*案例/.test(dialog.text);
}
function state(row) {
  return row && [row.id, row.revision, row.live_id, row.live, row.draft, sorted(row.place_ids), row.archived_at];
}

export async function runProducts(h) {
  const { A, E, P, V, V2 } = h;
  const family = `${h.prefix}-验品`;
  const tag = suffix => `${family}-${suffix}`;
  const t = h.places ?? {};
  const boards = h.boards ?? {};
  const entries = {}; // IDs only after successful UI saves; never guess an ID.
  const firstRelease = {}, batchReceipts = new Map();
  let linkedCase, sameBrandCase, caseRelease, retired, onlinePolicy, priorLive, publicCaseBefore;
  let actorIds, tree;

  function ready(...keys) {
    h.require(h.base?.replace(/\/$/, '') === origin && typeof h.prefix === 'string' && h.prefix.trim(), '缺少本轮隔离实例或唯一前缀');
    h.require(keys.every(k => t[k] && boards[k]), '所需已发布板块、分类尚未准备好');
  }
  async function observeJson(page, method, path, act) {
    const r = await h.observe(page, method, path, act);
    return r.json();
  }
  async function readItem(page, row) {
    const item = await uiGet(page, itemApi(row.id), {}, () => h.open(page, editor(row.id)));
    // onMounted loads asynchronously: do not type into the initial empty work copy.
    await page.locator('header.page-head').getByText(new RegExp(`修订\\s*${item.revision}(?:\\s|$)`)).waitFor();
    return item;
  }
  async function create(key, label, places, extra = {}) {
    const item = await h.createProduct(E, { name: tag(label), code: `${h.prefix}-PF-${key}`,
      benefit: tag(`${key}正式功效`), short: tag(`${key}正式卡片`), places, ...extra });
    entries[key] = item;
    return item;
  }
  async function publishFirst(key) {
    firstRelease[key] = await h.publish(P, editor(entries[key].id));
    return firstRelease[key];
  }
  async function revise(row, { benefit, short, removeLong = false, uploadLong = false }) {
    await readItem(E, row);
    if (benefit) await E.getByLabel('功效', { exact: true }).fill(benefit);
    if (short) await E.getByLabel('简短功效', { exact: true }).fill(short);
    if (removeLong) {
      const media = E.locator('label.field').filter({ has: E.getByText('产品详情长图', { exact: true }) });
      await button(media, '移除').click();
    }
    if (uploadLong) await h.upload(E, 2, h.files.long);
    return h.save(E);
  }
  async function adminList(page) {
    return uiGet(page, products, { ...daily, q: null }, () => h.open(page, '/admin/products'));
  }
  async function searchAdmin(page, q, filters = {}) {
    const input = page.getByPlaceholder('产品名称或配方编号');
    return uiGet(page, products, { ...daily, ...filters, q: q || null }, async () => {
      if ((await input.inputValue()) === q) await button(page, '查询').click();
      else { await input.fill(q); await input.press('Tab'); }
    });
  }
  async function familyList(page) {
    await adminList(page);
    return completePage(await searchAdmin(page, family), '本轮产品列表');
  }
  async function actors() {
    if (!actorIds) {
      const data = await uiGet(A, '/api/admin/accounts', page1, () => h.open(A, '/admin/accounts'));
      const ids = Object.fromEntries(['E', 'P'].map(role => [role, data.items.find(a => a.login === h.logins[role])?.id]));
      assert.ok(ids.E && ids.P && ids.E !== ids.P, '治理列表未能区分本轮编辑和发布人');
      actorIds = ids;
    }
    return actorIds;
  }
  async function audit(id) {
    if (new URL(E.url()).pathname !== '/admin/accounts') {
      await uiGet(E, '/api/admin/audit', { target_id: null }, () => h.open(E, '/admin/accounts'));
    }
    await E.getByLabel('对象类型').selectOption('product');
    await E.getByLabel('对象编号').fill(id);
    const data = await uiGet(E, '/api/admin/audit', { ...page1, target_kind: 'product', target_id: id }, () => button(E, '查询').click());
    return completePage(data, '该产品的操作记录');
  }
  async function history(page, id, enter = () => h.open(page, `/admin/items/${id}/history`)) {
    const data = await uiGet(page, `${itemApi(id)}/versions`, {}, enter);
    return completePage(data, '该产品的历史版本');
  }
  async function decision(page, accept, act) {
    await h.setConfirm(page, accept);
    try {
      const [dialog, result] = await Promise.all([page.waitForEvent('dialog', { predicate: d => d.type() === 'confirm' }), act()]);
      return { text: dialog.message(), result };
    } finally { await h.setConfirm(page, true); }
  }
  function writesSince(index, end) {
    return h.events.slice(index).filter(e => e.method !== 'GET' && end.test(e.path));
  }
  async function blockedDetail(row) {
    await h.observe(V2, 'GET', `${publicProducts}/${row.id}`, () => h.open(V2, `/products?id=${row.id}`), 404);
    await V2.getByRole('alert').waitFor();
    assert.equal(await V2.locator('.detail-view').count(), 0, '不可见产品仍呈现详情');
  }
  async function catalog(key, keyword = '') {
    if (!tree || new URL(V.url()).pathname !== '/catalog') {
      const [meta, initial] = await Promise.all([responseTo(V, '/api/public/catalog', {}), responseTo(V, publicProducts, { page: '1' }), h.open(V, '/catalog')]);
      assert.ok(meta.ok() && initial.ok(), '目录初始化请求失败');
      tree = await meta.json();
      await initial.finished();
    }
    const board = tree.nodes.find(n => n.id === boards[key]);
    const category = tree.nodes.find(n => n.id === t[key] && n.parent_id === boards[key]);
    assert.ok(board && category, `公开目录缺少配置中的板块/分类 ${key}`);
    const tab = button(V.locator('.board-tabs'), board.name);
    if ((await tab.getAttribute('aria-pressed')) !== 'true') {
      await uiGet(V, publicProducts, { board_id: board.id }, () => tab.click());
    }
    const categoryButton = button(V.locator('.category-rail'), category.name);
    const scope = { board_id: board.id, node_id: category.id, q: null };
    // Explicitly choosing the category also clears remembered search and fine filters.
    let page = await uiGet(V, publicProducts, { ...scope, page: '1' }, () => categoryButton.click());
    if (keyword) {
      Object.assign(scope, { node_id: null, q: keyword });
      page = await uiGet(V, publicProducts, { ...scope, page: '1' }, () => V.locator('.h5-search input').fill(keyword));
    }
    const all = [...page.items];
    // Never infer absence from an unloaded page. Only a bounded local run is expected.
    assert.ok(page.total <= 60, '公开分类超出隔离验收范围');
    for (let n = 2; all.length < page.total && n <= 3; n++) {
      const next = await uiGet(V, publicProducts, { ...scope, page: String(n) }, () => button(V.locator('.catalog-results'), '加载更多').click());
      all.push(...next.items);
    }
    assert.equal(all.length, page.total, '公开结果未读完整');
    return all;
  }
  async function linkedProduct(key, row, body) {
    const hits = (await catalog(key)).filter(i => i.id === row.id);
    assert.ok(hits.length === 1 && cardMatches(hits[0], body), `分类 ${key} 未唯一展示预期卡片图文`);
    const link = V.locator(`.product-card[href="/products?id=${row.id}"]`);
    await link.getByText(body.short_benefit, { exact: true }).waitFor();
    const detail = await uiGet(V, `${publicProducts}/${row.id}`, {}, () => link.click());
    assert.ok(detail.id === row.id && detailMatches(detail, body), `从分类 ${key} 打开的详情图文不是预期版本`);
    await V.locator('.detail-info').getByText(body.benefit, { exact: true }).waitFor();
    await V.locator('.detail-long').waitFor();
    return detail;
  }
  async function publicCase(row) {
    const name = row.draft.product_name;
    await uiGet(V2, '/api/public/cases', { page: '1' }, () => h.open(V2, '/cases'));
    const input = V2.locator('.h5-search input');
    const data = await uiGet(V2, '/api/public/cases', { q: name, page: '1' }, async () => {
      if ((await input.inputValue()) !== name) await input.fill(name);
      else await button(V2.locator('.case-filters'), '精选案例').click();
    });
    assert.ok(data.items.some(x => x.id === row.id), '关联案例在品牌案例列表中不可见');
    const detail = await uiGet(V2, `/api/public/cases/${row.id}`, {}, () => V2.locator(`.case-card[href="/cases/detail?id=${row.id}"]`).click());
    await V2.locator('.detail-view').getByText(name, { exact: true }).waitFor();
    await V2.locator('.detail-view').getByText(row.draft.highlight, { exact: true }).waitFor();
    assert.ok(detail.id === row.id && ['brand_name','product_name','highlight','description'].every(k => detail.body[k] === row.draft[k]), '公开案例并非发布时的原文');
    assert.ok(matchesMedia(detail.body.image_asset_url, row.draft.image_asset_id), '关联案例图片不是本案例的发布图');
    assert.equal(await V2.locator('.detail-view a[href*="/products"]').count(), 0, '案例详情仍有指向产品的跳转');
    return detail;
  }
  async function selectRows(page, selected) {
    await familyList(page);
    for (const item of selected) await page.getByRole('checkbox', { name: `选择${nameOf(item)}`, exact: true }).check();
  }
  async function checkBatch(selected) {
    await selectRows(P, selected);
    const data = await observeJson(P, 'POST', `${products}/batch-check`, () => button(P.locator('.bulk-bar'), '批量发布检查').click());
    return data.items;
  }

  await h.runCase('PRD-03', async () => {
    ready('a', 'b'); const e = evidence();
    const row = await create('cross', '双分类精华', [t.a, t.b]);
    const v1 = await publishFirst('cross');
    const edit = await revise(row, { benefit: tag('精华新版功效'), short: tag('精华新版卡片'), removeLong: true });
    assert.ok(edit.draft && !edit.draft.detail_asset_id, '未实际保存缺长图的新稿');
    const since = h.events.length;
    const check = await h.check(P, editor(row.id));
    e.expect(missingLong(check) && same(sorted(check.place_ids), sorted([t.a, t.b])), '检查没有同时指出缺长图和两个影响位置');
    e.expect(await button(P, '确认发布').isDisabled(), '缺图草稿仍可确认发布');
    for (const k of ['a', 'b']) await e.read(`${k} 分类旧版`, () => linkedProduct(k, row, row.draft));
    e.expect(writesSince(since, /\/publish$/).length === 0, '缺图检查产生了发布请求');
    const repaired = await revise(row, { uploadLong: true });
    const v2 = await h.publish(P, editor(row.id));
    e.expect(v2.id === row.id && v2.seq === v1.seq + 1 && v2.release_id !== v1.release_id, '修复后未生成该产品的下一版本');
    for (const k of ['a', 'b']) await e.read(`${k} 分类新版`, () => linkedProduct(k, row, repaired.draft));
    return e.finish('缺长图时两分类保留旧版；补图确认后从两个分类均打开同一款新版完整图文。');
  });

  await h.runCase('PRD-04', async () => {
    ready('a'); const e = evidence();
    const row = await create('incomplete', '缺图新品', [t.a], { omitLong: true });
    e.expect(missingLong(await h.check(P, editor(row.id))) && await button(P, '确认发布').isDisabled(), '新品缺图未被检查拦下');
    const stored = await readItem(E, row);
    e.expect(!!stored.draft && !stored.draft.detail_asset_id && !stored.live_id && !stored.has_history, '新品草稿或未上架状态不符');
    for (const q of ['', row.draft.name, row.draft.formula_no]) {
      await e.read(q ? '新品搜索' : '新品所在分类', async () => assert.ok(!(await catalog('a', q)).some(x => x.id === row.id), '公开结果包含新品'));
    }
    await e.read('新品公开详情', () => blockedDetail(row));
    return e.finish('新品草稿保留，发布检查定位长图；目录、名称与编号搜索、匿名详情均未公开。');
  });

  await h.runCase('PRD-05', async () => {
    ready('a', 'b', 'c'); const e = evidence();
    // Also provides a real online/no-draft negative control for the later bulk run.
    await create('steady', '未选稳定款', [t.a]); await publishFirst('steady');
    const row = entries.cross;
    h.require(row && (await readItem(E, row)).live_id, '尚无已在两分类发布的产品');
    const changed = await revise(row, { benefit: tag('筛选待发文案') });
    h.require(changed.draft && changed.live_id, '未建立已上线且另有草稿的前置状态');
    await adminList(E);
    function checkOne(data, message) {
      e.expect(data.total === 1 && data.items.length === 1 && data.items[0].id === row.id, message);
    }
    for (const q of [row.draft.name, row.draft.formula_no]) {
      checkOne(await searchAdmin(E, q), '按名称/配方编号未唯一命中');
      await rowFor(E, row.draft.name).first().waitFor();
      e.expect(await rowFor(E, row.draft.name).count() === 1, '列表重复渲染同一产品');
    }
    await searchAdmin(E, family);
    const filters = { ...daily, q: family };
    for (const [label, key, value] of [['线上状态', 'state', 'online'], ['草稿状态', 'has_draft', 'true'],
      ['展示分类', 'node_id', t.a], ['展示分类', 'node_id', t.b], ['展示分类', 'node_id', t.c]]) {
      filters[key] = value;
      const data = await uiGet(E, products, { ...filters }, () => E.getByRole('combobox', { name: label, exact: true }).selectOption(value));
      if (key !== 'node_id') continue;
      if (value === t.c) e.expect(data.total === 0, '不所属分类仍命中');
      else {
        checkOne(data, '所属分类 + 已上线 + 有草稿没有只返回目标款');
        await rowFor(E, row.draft.name).first().waitFor();
        const line = await rowFor(E, row.draft.name).first().innerText();
        e.expect(line.includes('已上线') && line.includes('有草稿') && await rowFor(E, row.draft.name).count() === 1, '列表状态或去重不符');
      }
    }
    for (const k of ['a', 'b']) await e.read(`核对真实分类 ${k}`, async () => {
      const matches = (await catalog(k)).filter(i => i.id === row.id);
      assert.ok(matches.length === 1 && cardMatches(matches[0], changed.live), '公开分类中未唯一匹配线上版');
    });
    return e.finish('名称、配方编号及两个所属分类均唯一命中；已上线/有草稿组合排除对照款，非所属分类无结果。');
  });

  await h.runCase('PRD-06-P', async () => {
    ready('a', 'c'); const e = evidence();
    const other = await create('hold', '未选合格草稿', [t.c]);
    assert.ok((await h.check(P, editor(other.id))).eligible, '旁侧对照不是合格草稿');
    await adminList(E);
    await E.getByRole('link', { name: '新增产品', exact: true }).click();
    const name = tag('行发布甲'), code = `${h.prefix}-PF-alpha`;
    for (const [label, value] of [['产品名称', name], ['配方编号', code], ['简短功效', tag('甲初始卡片')], ['功效', tag('甲初始功效')],
      ['核心成分', tag('甲成分')], ['产品亮点', tag('甲亮点')]]) await E.getByLabel(label, { exact: true }).fill(value);
    await E.getByLabel('是否生产过').selectOption('待确认');
    for (const id of [t.a, t.c]) await E.locator(`.place-choice input[value="${id}"]`).check();
    for (const [i, file] of [h.files.square, h.files.cover, h.files.long].entries()) await h.upload(E, i, file);
    const row = entries.alpha = await observeJson(E, 'POST', products, () => button(E, '保存草稿').click());
    await E.waitForURL(`${origin}/admin/products/${row.id}`);
    await adminList(E);
    for (const q of [name, code]) { const data = await searchAdmin(E, q); e.expect(data.total === 1 && data.items[0]?.id === row.id, '新增产品未按名称/配方编号唯一查到'); }
    await uiGet(E, itemApi(row.id), {}, () => rowFor(E, name).getByRole('link', { name: '编辑', exact: true }).click());
    await E.locator('header.page-head').getByText(/修订/).waitFor();
    await E.getByLabel('功效', { exact: true }).fill(tag('行编辑后的功效'));
    const saved = await h.save(E);
    await adminList(P); await searchAdmin(P, code);
    await button(rowFor(P, name), '发布检查').click();
    const panel = P.locator('section[aria-label="发布检查"]');
    const since = h.events.length;
    const check = await observeJson(P, 'POST', `${itemApi(row.id)}/check`, () => button(panel, '检查发布').click());
    assert.ok(check.id === row.id && check.eligible && check.revision === saved.revision, '行内检查没有合格的目标修订');
    await e.read('行内确认前的 H5', async () => {
      const ids = idList(await catalog('c')); assert.ok(!ids.includes(row.id) && !ids.includes(other.id), '仅检查已导致草稿公开');
    });
    const { result: receipt } = await decision(P, true, () => observeJson(P, 'POST', `${itemApi(row.id)}/publish`, () => button(panel, '确认发布').click()));
    firstRelease.alpha = receipt;
    e.expect(receipt.id === row.id && receipt.seq === 1 && same(writesSince(since, /\/publish$/).map(x => x.path), [`${itemApi(row.id)}/publish`]), '单条确认没有只发布目标款');
    await e.read('发布后 H5', () => linkedProduct('c', row, saved.draft));
    const untouched = await readItem(E, other);
    e.expect(same(state(other), state(untouched)), '单发连带改变了旁侧合格草稿');
    await e.read('旁侧合格草稿 H5', async () => assert.ok(!(await catalog('c')).some(x => x.id === other.id), '未选款公开'));
    await e.read('行发布记录', async () => {
      const id = (await actors()).P; assert.ok((await audit(row.id)).some(x => recordedPublish(x, receipt, saved.revision, id)), '缺少对应修订和发布人的发布记录');
    });
    return e.finish('由新增入口建稿，从查找到的产品行编辑并发布；确认前 H5 未变化，确认后仅目标款上线且有独立发布记录。');
  });

  await h.runCase('PRD-07-P', async () => {
    ready('a'); const e = evidence(); const row = entries.incomplete;
    h.require(row?.id, '没有可删除的未发布草稿');
    const before = await readItem(E, row);
    h.require(before.draft && !before.has_history && !before.live_id, '目标不是从未发布的草稿');
    const name = nameOf(before);
    await adminList(E); await searchAdmin(E, name);
    const since = h.events.length;
    const cancel = await decision(E, false, () => button(rowFor(E, name), '删除草稿').click());
    e.expect(cancel.text.includes(name) && writesSince(since, /\/draft$/).length === 0, '取消前未核对条目或取消已写入');
    const kept = await readItem(E, row);
    e.expect(same(state(before), state(kept)) && await E.getByLabel('产品名称', { exact: true }).isEditable(), '取消后原草稿未保持可编辑');
    await adminList(E); await searchAdmin(E, name);
    const yes = await decision(E, true, () => h.observe(E, 'DELETE', `${itemApi(row.id)}/draft`, () => button(rowFor(E, name), '删除草稿').click()));
    e.expect(yes.text.includes(name), '删除确认未标识所删产品');
    await adminList(E); const data = await searchAdmin(E, name);
    e.expect(data.total === 0, '确认删除后产品仍在日常列表');
    const actor = (await actors()).E;
    e.expect((await audit(row.id)).some(x => x.action === 'delete_draft' && x.actor_id === actor && x.target_id === row.id && x.details?.label === name), '无可辨认条目和编辑的删除记录');
    return e.finish('删除先取消，原草稿仍可编辑；再次确认后列表移除且能追溯条目与编辑。');
  });

  await h.runCase('PRD-09', async () => {
    ready('a', 'b', 'c'); const e = evidence();
    const beta = await create('beta', '批量乙', [t.b]); await publishFirst('beta');
    const changed = await revise(beta, { benefit: tag('乙未发文案'), short: tag('乙待发卡片') });
    const alpha = entries.alpha, steady = entries.steady;
    h.require(alpha?.id && steady?.id, '缺少已有目标分类的甲或未勾选对照丙');
    const before = byId(await familyList(E));
    h.require([alpha, beta, steady].every(x => before.get(x.id)?.live_id) && changed.draft, '需三款线上资料及乙的文字草稿');
    const relevant = rows => rows.filter(x => [alpha.id, beta.id, steady.id].includes(x.id)).sort((a,b) => a.id.localeCompare(b.id));
    const beforeH5 = {}; for (const k of ['a','b','c']) await e.read(`追加前分类 ${k}`, async () => { beforeH5[k] = relevant(await catalog(k)); });
    const since = h.events.length;
    for (let i = 1; i <= 2; i++) {
      await selectRows(E, [alpha, beta]); await button(E.locator('.bulk-bar'), '批量修改').click();
      const panel = E.locator('section[aria-label="批量操作"]');
      await panel.locator(`input[type="checkbox"][value="${t.c}"]`).check();
      const { result } = await decision(E, true, () => observeJson(E, 'POST', `${products}/batch-append`, () => button(panel, '追加展示位置').click()));
      e.expect(same(idList(result.items), sorted([alpha.id, beta.id])) && result.items.every(x => ['changed','unchanged'].includes(x.status)), `第 ${i} 次追加未仅成功处理甲乙`);
    }
    const after = byId(await familyList(E)), a = after.get(alpha.id), b = after.get(beta.id);
    e.expect(same(sorted(a.place_ids), sorted([t.a, t.c])) && same(bodyOf(a), bodyOf(before.get(alpha.id))), '甲原资料丢失或重复分类');
    e.expect(same(sorted(b.place_ids), sorted([t.b, t.c])) && same(b.draft, changed.draft), '乙原分类/未发布文案丢失或目标分类重复');
    e.expect(same(state(after.get(steady.id)), state(before.get(steady.id))), '未勾选丙的状态改变');
    e.expect([alpha,beta,steady].every(x => after.get(x.id).live_id === before.get(x.id).live_id && same(after.get(x.id).live, before.get(x.id).live)) && !writesSince(since, /\/publish$/).length, '追加操作改动了线上版');
    for (const k of ['a','b','c']) await e.read(`追加后分类 ${k}`, async () => assert.ok(same(beforeH5[k], relevant(await catalog(k))), '分类公开图文/位置改变'));
    await e.read('乙的文字稿没有泄露到详情', () => linkedProduct('b', beta, before.get(beta.id).live));
    return e.finish('重复追加只作用于甲乙，原分类不丢不重，乙保留改稿文案；未选丙及三款公开展示不变。');
  });

  await h.runCase('PRD-10', async () => {
    ready('a', 'b', 'c'); const e = evidence();
    const { alpha, beta, cross, steady, hold } = entries;
    h.require([alpha,beta,cross,steady,hold].every(x => x?.id), '缺少两款有历史的产品、缺项/无草稿/未选对照');
    const initial = byId(await familyList(E));
    h.require([alpha,beta,cross,steady].every(x => initial.get(x.id)?.live_id) && !initial.get(steady.id)?.draft && initial.get(hold.id)?.draft, '混合清单的线上及草稿前置状态不齐');
    await revise(alpha, { benefit: tag('批次甲二版'), short: tag('批次甲新卡片') });
    await revise(beta, { benefit: tag('批次乙二版'), short: tag('批次乙新卡片') });
    await revise(cross, { benefit: tag('缺项不得上线'), removeLong: !!bodyOf(initial.get(cross.id)).detail_asset_id });
    const eligible = [alpha, beta];
    for (let n = 3; n <= 8; n++) eligible.push(await create(`batch${n}`, `合格第${n}款`, [t.a]));
    const skip = [cross, steady], selected = [...eligible, ...skip], controls = [...skip, hold];
    const before = byId(await familyList(E));
    const baselines = new Map();
    for (const x of controls) await e.read(`对照审计基线 ${nameOf(x)}`, async () => baselines.set(x.id, idList(await audit(x.id))));
    const index = h.events.length;
    await e.read('只选不可发款', async () => {
      const zero = await checkBatch(skip);
      assert.ok(same(idList(zero), idList(skip)) && zero.every(x => !x.eligible), '零合格检查结果不符');
      const no = P.locator('section[aria-label="批量操作"]').getByRole('button', { name: /^发布这\s*0\s*款$/ });
      await no.waitFor(); assert.ok(await no.isDisabled(), '没有合格草稿仍可确认');
    });
    const checks = await checkBatch(selected), checked = byId(checks);
    // Never submit an unexpected queue, even when the test would otherwise continue.
    assert.ok(same(idList(checks), idList(selected)) && same(idList(checks.filter(x => x.eligible)), idList(eligible)) &&
      checks.every(x => x.revision === before.get(x.id)?.revision), '预检并非本次选择的精确八款合格修订，未提交');
    e.expect(missingLong(checked.get(cross.id)) && checked.get(steady.id)?.issues.some(x => x.field === 'draft'), '两个跳过原因未与各自产品对应');
    const panel = P.locator('section[aria-label="批量操作"]');
    const confirm = panel.getByRole('button', { name: /^发布这.*款$/ });
    await confirm.waitFor();
    e.expect(/^发布这\s*8\s*款$/.test((await confirm.innerText()).trim()), '确认按钮没有写明实际可发布八款');
    const lines = await panel.locator('.list-line').allInnerTexts();
    e.expect(selected.every(x => lines.some(s => s.includes(nameOf(x)) && s.includes(bodyOf(x).formula_no))), '逐款检查清单未同时展示产品名和配方编号');
    e.expect(eligible.every(x => lines.some(s => s.includes(nameOf(x)) && s.includes('可发布'))), '可发布结论未逐款可见');
    e.expect(lines.some(s => s.includes(nameOf(cross)) && /长图|detail_asset_id/.test(s)) && lines.some(s => s.includes(nameOf(steady)) && /草稿/.test(s)), '清单未指明缺长图与无草稿的各自原因');
    await e.read('检查后线上状态', async () => {
      const current = byId(await familyList(E));
      assert.ok([...selected,hold].every(x => same(state(before.get(x.id)), state(current.get(x.id)))), '仅检查便改变了产品状态');
      await linkedProduct('a', cross, before.get(cross.id).live);
    });
    e.expect(!writesSince(index, /\/publish$/).length, '批量检查阶段发出了发布请求');

    const posts = [], responses = [];
    const publishId = req => {
      const u = new URL(req.url());
      return req.method() === 'POST' && u.origin === origin && u.pathname.match(/^\/api\/admin\/items\/(\d+)\/publish$/)?.[1];
    };
    const onRequest = req => { const id = publishId(req); if (id) posts.push(id); };
    const onResponse = r => { const id = publishId(r.request()); if (id) responses.push({ id, r }); };
    P.on('request', onRequest); P.on('response', onResponse);
    try {
      await decision(P, true, () => uiGet(P, products, { ...daily, q: family }, () => confirm.click()));
    } finally {
      P.off('request', onRequest); P.off('response', onResponse);
      for (const {id,r} of responses) if (r.ok()) {
        const receipt = await r.json(); if (receipt.id === id) batchReceipts.set(id, receipt);
      }
    }
    e.expect(posts.length === 8 && same(sorted(posts), idList(eligible)), '发布 POST 次数或目标不是精确的八款各一次');
    e.expect(batchReceipts.size === 8 && new Set([...batchReceipts.values()].map(x => x.release_id)).size === 8, '八款没有各自独立的成功回执和版本');
    const resultLines = await panel.locator('.list-line').allInnerTexts();
    h.write('batch-feedback-observed.json', { checks: lines, results: resultLines, submittedIds: posts });
    e.expect(selected.every(x => resultLines.some(s => s.includes(nameOf(x)) && s.includes(bodyOf(x).formula_no))), '发布后的清单没有保留每款对应的产品名与配方编号');
    e.expect(resultLines.some(s => s.includes(nameOf(cross)) && /长图|detail_asset_id/.test(s)), '跳过的缺图款在刷新后丢失具体缺项');
    e.expect(eligible.every(x => resultLines.some(s => s.includes(nameOf(x)) && s.includes('已发布') && s.includes(`版本 ${batchReceipts.get(x.id)?.seq}`))), '结果清单未逐款标明成功版本');
    e.expect(skip.every(x => resultLines.some(s => s.includes(nameOf(x)) && /缺|草稿|未发布|跳过/.test(s))), '发布结果清单未保留两款未发条目及原因');
    const after = byId(await familyList(E));
    const ids = await actors();
    for (const x of eligible) await e.read(`版本与审计 ${nameOf(x)}`, async () => {
      const receipt = batchReceipts.get(x.id), old = before.get(x.id), now = after.get(x.id), seq = old.live_id ? 2 : 1;
      assert.ok(receipt?.seq === seq && receipt.release_id === now.live_id && receipt.revision === now.revision && !now.draft && same(now.live, old.draft) && same(sorted(now.place_ids), sorted(old.place_ids)), '回执序号、线上图文/位置或草稿状态不符');
      const publishes = (await audit(x.id)).filter(r => r.action === 'publish');
      assert.ok(publishes.length === seq && publishes.some(r => recordedPublish(r, receipt, old.revision, ids.P)), '无唯一对应本次修订、回执和发布人的独立记录');
    });
    for (const x of controls) await e.read(`未发对照 ${nameOf(x)}`, async () => {
      assert.ok(same(state(after.get(x.id)), state(before.get(x.id))) && same(idList(await audit(x.id)), baselines.get(x.id)), '对照产品、草稿或记录改变');
    });
    await e.read('缺项款仍展示旧版', () => linkedProduct('b', cross, before.get(cross.id).live));
    await e.read('未勾选草稿仍未上线', () => blockedDetail(hold));
    return e.finish('混合十款预检、零合格禁用、八个单款 POST、回执版本和八条独立发布记录均经核对；另外三款状态保持。');
  });

  await h.runCase('PRD-11', async () => {
    ready('a', 'b'); const e = evidence(); const a = entries.alpha, b = entries.beta;
    h.require(a && b && [a,b].every(x => batchReceipts.get(x.id)?.seq === 2) && firstRelease.alpha?.seq === 1, '缺少同一批次甲乙的第二版回执或甲的第一版');
    const before = byId(await familyList(E));
    h.require([a,b].every(x => before.get(x.id)?.live_id === batchReceipts.get(x.id).release_id), '同批二版已不再是当前线上版本');
    const aLog = idList(await audit(a.id)), bLog = idList(await audit(b.id));
    const versions = await history(E, a.id);
    const old = versions.find(x => x.seq === 1 && x.release_id === firstRelease.alpha.release_id);
    assert.ok(old && versions.some(x => x.release_id === before.get(a.id).live_id), '历史页没有甲的一、二版');
    const line = E.locator('section[aria-label="历史版本"] .list-line').filter({ has: button(E, '查看版本 1') });
    await button(line, '查看版本 1').click();
    await E.getByRole('heading', { name: '版本 1 的内容' }).waitFor();
    const since = h.events.length;
    const { result, text } = await decision(E, true, () => observeJson(E, 'POST', `${itemApi(a.id)}/versions/1/restore`, () => button(line, '恢复为草稿').click()));
    e.expect(text.includes(nameOf(a)) && text.includes('版本 1'), '恢复前没有核对甲与旧版本');
    e.expect(result.id === a.id && same(result.draft, old.body) && same(sorted(result.place_ids), sorted(old.place_ids)) && result.live_id === before.get(a.id).live_id, '恢复不是仅把所选旧版复制成新草稿');
    const after = byId(await familyList(E));
    e.expect(!before.get(b.id).draft && !after.get(b.id).draft && same(state(after.get(b.id)), state(before.get(b.id))) && same(after.get(a.id).draft, old.body), '不是只有甲出现恢复稿，或乙的状态改变');
    const newLogs = (await audit(a.id)).filter(x => !aLog.includes(x.id));
    const actor = (await actors()).E;
    e.expect(newLogs.length === 1 && newLogs[0].action === 'restore' && newLogs[0].target_id === a.id && newLogs[0].actor_id === actor && newLogs[0].details.source_release_id === old.release_id && same(idList(await audit(b.id)), bLog), '恢复记录不是仅落在甲或来源版本不明');
    e.expect(!writesSince(since, /\/publish$/).length, '恢复直接触发发布');
    for (const [k,x] of [['a',a],['b',b]]) await e.read('单款恢复后 H5', () => linkedProduct(k, x, before.get(x.id).live));
    return e.finish('甲第一版仅恢复为草稿并产生一条恢复记录；甲乙线上仍为同批二版，乙的草稿和审计未变。');
  });

  // Run retirement before archive: both cases inspect the SAME real relationship.
  await h.runCase('PRD-13', async () => {
    ready('a', 'b'); const e = evidence(); const row = entries.cross;
    h.require(row?.id, '缺少跨分类产品');
    priorLive = await readItem(E, row);
    h.require(priorLive.live_id, '跨分类产品没有可下架的线上版');
    linkedCase = await h.createCase(E, { name: tag('关联合作案例'), brand: tag('关联案例品牌'), highlight: tag('案例亮点独立保留'), description: tag('合作图文独立于产品'), related: row.id });
    sameBrandCase = await h.createCase(E, { name: tag('同品牌另一案例'), brand: linkedCase.draft.brand_name, highlight: tag('独立草稿'), related: row.id });
    caseRelease = await h.publish(P, `/admin/cases/${linkedCase.id}`);
    await e.read('下架前案例图文', async () => { publicCaseBefore = await publicCase(linkedCase); });
    for (const k of ['a','b']) await e.read(`下架前分类 ${k}`, () => linkedProduct(k, row, priorLive.live));
    const name = nameOf(priorLive);
    await adminList(P); await searchAdmin(P, name);
    const current = rowFor(P, name); await current.waitFor();
    onlinePolicy = { noDelete: await button(current, '删除草稿').count() === 0 || await button(current, '删除草稿').isDisabled(),
      noArchive: await button(current, '归档').count() === 0 || await button(current, '归档').isDisabled() };
    const since = h.events.length;
    const cancel = await decision(P, false, () => observeJson(P, 'GET', `${itemApi(row.id)}/impact`, () => button(current, '下架').click()));
    h.write('unlist-impact-observed.json', { ids: cancel.result.case_ids, confirmation: cancel.text });
    e.expect(identifiesAffectedCases(cancel, [linkedCase, sameBrandCase]), '下架前没有明确列出关联案例与影响范围');
    e.expect(!writesSince(since, /\/unlist$/).length && (await readItem(E, row)).live_id === priorLive.live_id, '取消下架仍改变线上状态');
    for (const k of ['a','b']) await e.read(`取消下架后分类 ${k}`, () => linkedProduct(k, row, priorLive.live));
    const yes = await decision(P, true, () => observeJson(P, 'POST', `${itemApi(row.id)}/unlist`, () => button(current, '下架').click()));
    retired = yes.result;
    e.expect(retired.id === row.id && !retired.live_id && retired.has_history, '下架回执不符');
    for (const k of ['a','b']) for (const q of ['', priorLive.live.formula_no]) await e.read(`下架后 ${k} ${q ? '搜索' : '分类'}`, async () => assert.ok(!(await catalog(k,q)).some(x => x.id === row.id), '下架款仍可见'));
    await e.read('下架后产品详情', () => blockedDetail(row));
    await e.read('下架后关联案例', async () => assert.ok(same(await publicCase(linkedCase), publicCaseBefore), '案例公开图文改变'));
    return e.finish('下架前核对关联案例；取消后两个分类仍是原版，确认后两处、搜索和详情均不可见；案例图文仍可读，无失效产品跳转。');
  });

  await h.runCase('PRD-08-P', async () => {
    ready(); const e = evidence(); const row = entries.cross;
    h.require(row && retired?.id === row.id && !retired.live_id && caseRelease?.id === linkedCase?.id && linkedCase, '缺少已经下架的产品和仍在线的关联案例');
    e.expect(onlinePolicy?.noDelete && onlinePolicy?.noArchive, '在线产品仍可直接删除或归档');
    const name = nameOf(priorLive);
    await adminList(P); await searchAdmin(P, name); const current = rowFor(P, name); await current.waitFor();
    e.expect((await current.innerText()).includes('已下架') && (await button(current, '删除草稿').count() === 0 || await button(current, '删除草稿').isDisabled()), '下架后可删除或未显示已下架');
    const cancel = await decision(P, false, () => observeJson(P, 'GET', `${itemApi(row.id)}/impact`, () => button(current, '归档').click()));
    h.write('archive-impact-observed.json', { ids: cancel.result.case_ids, confirmation: cancel.text });
    e.expect(identifiesAffectedCases(cancel, [linkedCase, sameBrandCase]), '归档前未列出关联案例或未说明案例不受影响');
    const ok = await decision(P, true, () => observeJson(P, 'POST', `${itemApi(row.id)}/archive`, () => button(current, '归档').click()));
    e.expect(ok.result.id === row.id && !!ok.result.archived_at && ok.result.has_history && !ok.result.live_id, '没有归档并保留历史的实际回执');
    await adminList(P); const dailyRows = await searchAdmin(P, name);
    e.expect(dailyRows.total === 0, '归档产品未退出日常列表');
    const archived = await uiGet(P, products, { ...daily, q: name, state: 'archived' }, () => P.getByRole('button', { name: /^已归档/ }).click());
    e.expect(archived.items.some(x => x.id === row.id && x.archived_at), '归档列表未保留目标条目');
    const versions = await history(P, row.id, () => rowFor(P, name).getByRole('link', { name: '历史版本', exact: true }).click());
    e.expect(versions.some(v => v.release_id === priorLive.live_id && same(v.body, priorLive.live)) && versions.some(v => v.seq === 1), '归档后无法读取历史版本内容');
    const actor = (await actors()).P, logs = await audit(row.id);
    e.expect(['publish','unlist','archive'].every(action => logs.some(x => x.action === action && x.target_id === row.id && x.actor_id === actor)), '归档后缺少独立发布、下架或归档日志');
    await e.read('归档后案例', async () => {
      const currentCase = await publicCase(linkedCase); // Always checks saved case text and photo independently.
      if (publicCaseBefore) assert.ok(same(currentCase, publicCaseBefore), '归档连带改变了案例图文');
    });
    return e.finish('线上不能删除/归档、下架后不能删除；归档前可核对关联案例，归档后日常列表移除，历史版本、日志和案例图文保留。');
  });
}
