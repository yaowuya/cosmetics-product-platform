import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const button = (root, name) => root.getByRole('button', { name, exact: true });
const link = (root, name) => root.getByRole('link', { name, exact: true });
const itemRow = (page, name) => page.locator('tr.el-table__row').filter({ has: button(page, name) });
const versionRow = (page, seq) => page.locator('.list-line').filter({ has: button(page, `查看版本 ${seq}`) });
const privateFrame = 'iframe[title*="草稿"]';

/** Run after the product suite. All mutations go through the displayed forms of the disposable tenant. */
export async function runGovernance(h) {
  const { A, E, P, V, V2 } = h;
  const t = (suffix) => `${h.prefix}-${suffix}`;
  const sandbox = () => h.require(h.prefix && new URL(h.base).origin === 'https://127.0.0.1:5155', '需要带本轮前缀的一次性本机企业');
  const itemPath = id => `/api/admin/items/${id}`;
  const editor = (kind, id) => `/admin/${kind}/${id}`;
  async function getItem(page, kind, id) {
    const item = await (await h.observe(page, 'GET', itemPath(id), () => h.open(page, editor(kind, id)))).json();
    await button(page, '版本记录').waitFor(); // Only present once the editor adopts the loaded item.
    return item;
  }

  // Both the normal and archived lists request the same endpoint. Match the real form's query as well.
  async function listRead(page, path, query, action) {
    const [response] = await Promise.all([page.waitForResponse(res => {
      const u = new URL(res.url());
      return res.request().method() === 'GET' && u.origin === new URL(h.base).origin && u.pathname === path &&
        Object.entries(query).every(([k, v]) => u.searchParams.get(k) === v);
    }), action()]);
    assert.ok(response.ok(), `列表读取失败：${path} (${response.status()})`);
    return response.json();
  }
  const openList = (page, kind) => listRead(page, `/api/admin/${kind}`, { state: null, q: null, page_size: '20' }, () => h.open(page, `/admin/${kind}`));
  async function searchList(page, kind, term) {
    await openList(page, kind);
    const field = page.getByPlaceholder(kind === 'products' ? '产品名称或配方编号' : '品牌名或案例产品名');
    await field.fill(term);
    return listRead(page, `/api/admin/${kind}`, { q: term, state: null, page_size: '20' }, () => field.press('Enter'));
  }
  async function singleRow(page, kind, term, name, id) {
    const list = await searchList(page, kind, term);
    assert.deepEqual(list.items.map(i => i.id), [id]);
    assert.equal(list.total, 1);
    const row = itemRow(page, name);
    await row.waitFor();
    return row;
  }
  async function publicCases(term) {
    await h.observe(V, 'GET', '/api/public/cases', () => h.open(V, '/cases'));
    const result = await listRead(V, '/api/public/cases', { q: term, tag: null }, async () => {
      await V.locator('.cases-tools input').fill(term);
      await button(V, '精选案例').click();
    });
    await V.locator(result.total ? '.case-results .case-card' : '.case-results .h5-empty strong').first().waitFor();
    return result;
  }
  async function audit(page, kind, id) {
    await h.open(page, '/admin/accounts');
    await h.observe(page, 'GET', '/api/admin/audit', () => button(page, '操作记录').click());
    await page.getByLabel('对象类型').selectOption(kind);
    await page.getByLabel('对象编号').fill(id);
    return (await listRead(page, '/api/admin/audit', { target_kind: kind, target_id: id }, () => button(page, '查询').click())).items;
  }
  async function roster() {
    const result = await h.observe(A, 'GET', '/api/admin/accounts', () => h.open(A, '/admin/accounts'));
    const { items } = await result.json();
    const ownLogin = (await A.locator('.topbar-right > span').first().innerText()).trim();
    const actors = Object.fromEntries(Object.entries({ A: ownLogin, E: h.logins.E, P: h.logins.P }).map(([role, login]) =>
      [role, items.find(row => row.login === login)]));
    h.require(actors.A && actors.E && actors.P && new Set(Object.values(actors).map(row => row.id)).size === 3,
      '未在本次企业账号页定位到三位不同的测试角色');
    return actors;
  }
  const history = async (page, path, id) => {
    await h.open(page, path);
    return (await (await h.observe(page, 'GET', `${itemPath(id)}/versions`, () => button(page, '版本记录').click())).json()).items;
  };
  const receiptAudit = (events, receipt, actor) => assert.ok(events.some(ev => ev.action === 'publish' &&
    ev.actor_id === actor && ev.target_id === receipt.id && ev.details.receipt?.release_id === receipt.release_id && ev.occurred_at), '缺少该操作者和该版本对应的发布记录');

  await h.runCase('PRD-06-C', async () => {
    sandbox();
    const name = t('06C案例'), brand = t('06C品牌'), edited = t('06C已存亮点');
    const other = await h.createCase(E, { name: t('06C保留稿'), brand: t('06C其他品牌'), highlight: t('保留亮点') });
    assert.equal((await h.check(P, editor('cases', other.id))).eligible, true, '对照条目应是合格但未发布的草稿');
    const created = await h.createCase(E, { name, brand, highlight: t('06C初稿亮点') });
    assert.ok(created.draft && !created.live_id);
    assert.equal((await publicCases(name)).total, 0);
    await singleRow(E, 'cases', brand, name, created.id);
    const found = await singleRow(E, 'cases', name, name, created.id);
    await button(found, '编辑').click();
    const dialog = E.getByRole('dialog', { name: '编辑案例', exact: true });
    await button(dialog, '下一步').click();
    await dialog.getByLabel('案例亮点', { exact: true }).fill(edited);
    const saved = await (await h.observe(E, 'PUT', `${itemPath(created.id)}/draft`, () => button(dialog, '保存').click())).json();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(saved.draft.highlight, edited);
    const row = await singleRow(P, 'cases', name, name, created.id);
    await button(row, '发布检查').click();
    const panel = P.getByRole('region', { name: '发布检查' });
    const check = await (await h.observe(P, 'POST', `${itemPath(created.id)}/check`, () => button(panel, '检查发布').click())).json();
    assert.ok(check.eligible && check.id === created.id && check.revision === saved.revision);
    assert.equal((await publicCases(name)).total, 0, '列表行检查不应发布');
    const receipt = await (await h.observe(P, 'POST', `${itemPath(created.id)}/publish`, () => button(panel, '确认发布').click())).json();
    assert.equal(receipt.id, created.id);
    const visible = await publicCases(name);
    assert.deepEqual(visible.items.map(i => [i.id, i.body.highlight]), [[created.id, edited]]);
    await V.locator('.case-card').getByText(edited, { exact: true }).waitFor();
    const untouched = await getItem(E, 'cases', other.id);
    assert.equal(untouched.revision, other.revision); assert.deepEqual(untouched.draft, other.draft);
    assert.ok(!untouched.live_id && !untouched.has_history);
    assert.equal((await publicCases(other.draft.product_name)).total, 0);
    receiptAudit(await audit(E, 'case', created.id), receipt, (await roster()).P.id);
    return '品牌名和案例产品名均能定位同一行；检查前后匿名不可见，确认后仅目标上线，另一合格草稿、修订未变且发布记录可查。';
  });

  await h.runCase('PRD-07-C', async () => {
    sandbox();
    const name = t('07C删除案例'), keep = t('07C取消后仍可编辑');
    const item = await h.createCase(E, { name, brand: t('07C品牌'), highlight: t('07C亮点') });
    assert.ok(!item.has_history && !item.live_id);
    let row = await singleRow(E, 'cases', name, name, item.id);
    const since = h.events.length;
    await h.setConfirm(E, false);
    try {
      const [dialog] = await Promise.all([E.waitForEvent('dialog'), button(row, '删除草稿').click()]);
      assert.ok(dialog.message().includes(name));
    } finally { await h.setConfirm(E, true); }
    const still = await getItem(E, 'cases', item.id);
    assert.equal(still.revision, item.revision);
    assert.ok(!h.events.slice(since).some(ev => ev.method === 'DELETE' && ev.path === `${itemPath(item.id)}/draft`));
    await E.getByLabel('案例亮点', { exact: true }).fill(keep);
    assert.equal((await h.save(E)).draft.highlight, keep);
    row = await singleRow(E, 'cases', name, name, item.id);
    await h.observe(E, 'DELETE', `${itemPath(item.id)}/draft`, () => button(row, '删除草稿').click(), 204);
    assert.equal((await searchList(E, 'cases', name)).total, 0);
    await E.getByText('没有符合条件的案例。', { exact: true }).waitFor();
    assert.equal(await itemRow(E, name).count(), 0);
    const rows = await audit(E, 'case', item.id), actor = (await roster()).E.id;
    assert.ok(rows.some(ev => ev.action === 'delete_draft' && ev.actor_id === actor && ev.target_kind === 'case' && ev.target_id === item.id && ev.details.label === name && ev.occurred_at));
    return '取消删除无写入，原草稿仍可修改保存；确认后列表不再命中，删除记录保留原案例名称、对象和实际编辑者。';
  });

  await h.runCase('PRD-08-C', async () => {
    sandbox();
    const name = t('08C归档案例');
    const item = await h.createCase(E, { name, brand: t('08C品牌'), highlight: t('08C发布快照') });
    const receipt = await h.publish(P, editor('cases', item.id));
    const online = await singleRow(P, 'cases', name, name, item.id);
    assert.equal(await button(online, '删除草稿').count(), 0); assert.equal(await button(online, '归档').count(), 0);
    assert.deepEqual((await publicCases(name)).items.map(i => i.id), [item.id]);
    const oldLink = await V.locator('.case-card').getAttribute('href');
    const offline = await (await h.observe(P, 'POST', `${itemPath(item.id)}/unlist`, () => button(online, '下架').click())).json();
    assert.ok(!offline.live_id && offline.has_history && !offline.archived_at);
    const removed = await singleRow(P, 'cases', name, name, item.id);
    assert.equal(await button(removed, '删除草稿').count(), 0);
    assert.equal((await publicCases(name)).total, 0);
    await h.observe(V, 'GET', `/api/public/cases/${item.id}`, () => h.open(V, oldLink), 404);
    const archived = await (await h.observe(P, 'POST', `${itemPath(item.id)}/archive`, () => button(removed, '归档').click())).json();
    assert.ok(archived.archived_at && !archived.live_id);
    assert.equal((await searchList(P, 'cases', name)).total, 0);
    await P.getByText('没有符合条件的案例。', { exact: true }).waitFor();
    const archiveList = await listRead(P, '/api/admin/cases', { q: name, state: 'archived', page_size: '20' }, () => P.getByRole('button', { name: /^已归档/ }).click());
    assert.deepEqual(archiveList.items.map(i => i.id), [item.id]);
    const records = await (await h.observe(P, 'GET', `${itemPath(item.id)}/versions`, () => link(itemRow(P, name), '历史版本').click())).json();
    const version = records.items.find(v => v.release_id === receipt.release_id);
    assert.ok(version && version.seq === receipt.seq && version.body.highlight === item.draft.highlight);
    await button(P, `查看版本 ${receipt.seq}`).click();
    await P.getByRole('heading', { name: `版本 ${receipt.seq} 的内容`, exact: true }).waitFor();
    assert.ok(await button(versionRow(P, receipt.seq), '恢复为草稿').isDisabled());
    const rows = await audit(E, 'case', item.id), actor = (await roster()).P.id;
    receiptAudit(rows, receipt, actor);
    assert.ok(['unlist', 'archive'].every(action => rows.some(ev => ev.action === action && ev.actor_id === actor && ev.target_id === item.id && ev.occurred_at)));
    return '线上无删除和归档入口；下架后旧公开链接不可达，仍不能删除。归档移出日常列表，原发布快照及发布、下架、归档日志均保留。';
  });

  await h.runCase('PRD-14', async () => {
    sandbox();
    const name = t('14独立定制案例'), brand = t('14独立合作品牌');
    const before = await openList(E, 'products');
    const catalog = async () => (await h.observe(V, 'GET', '/api/public/catalog', () => h.open(V, '/catalog'))).json();
    const { counts } = await catalog();
    const header = await (await h.observe(V, 'GET', '/api/public/pages/cases', () => h.open(V, '/cases'))).json();
    const tag = header.body.filters?.at(-1);
    h.require(tag?.key && tag?.label, '需要一个已发布的案例筛选分类');
    const item = await h.createCase(E, { name, brand, category: tag.key, highlight: t('14独立项目亮点') });
    assert.ok(!item.draft.related_product_id, '该合作不关联目录产品');
    await h.publish(P, editor('cases', item.id));
    assert.equal((await openList(E, 'products')).total, before.total);
    assert.equal((await searchList(E, 'products', name)).total, 0);
    assert.deepEqual((await catalog()).counts, counts, '案例发布不应改变任何目录节点的产品数');
    await publicCases(brand);
    const chip = button(V, tag.label);
    const filtered = await listRead(V, '/api/public/cases', { q: brand, tag: tag.key }, () => chip.click());
    assert.equal(await chip.getAttribute('aria-pressed'), 'true');
    assert.equal(filtered.total, 1); assert.deepEqual(filtered.items.map(i => i.id), [item.id]);
    const results = V.locator('.case-results');
    await results.locator('a.case-featured').getByText(name, { exact: true }).waitFor();
    assert.equal(await results.locator('.case-card').count(), 1);
    assert.equal(await results.locator('.case-grid,.cases-grid-title').count(), 0);
    await results.locator('a.case-featured').click();
    await V.getByRole('heading', { name, exact: true }).waitFor();
    assert.equal(await V.locator('.detail-view a[href*="/products"]').count(), 0);
    return '独立定制案例可发布并打开详情；产品总数、各目录计数未变，产品列表也无同名条目；按品牌筛至一条只展示精选卡，无空网格。';
  });

  await h.runCase('PRD-15', async () => {
    sandbox();
    h.require(h.files.qrA && h.files.qrB, '缺少两份已在本机离线解码核对的不同 QA 二维码');
    const [goodBytes, badBytes] = await Promise.all([readFile(h.files.qrA), readFile(h.files.qrB)]);
    h.require(!goodBytes.equals(badBytes), '两份 QA 二维码素材相同');
    const path = '/admin/pages/business_contact';
    const readContact = async () => (await (await h.observe(V, 'GET', '/api/public/pages/contact', () => h.open(V, '/contact'))).json()).body;
    const baseline = await readContact();
    h.require(baseline.business_contact?.email && !baseline.business_contact.qr_asset_url, '需要本轮仅有测试邮箱、尚无二维码的联系位置');
    async function uploadQr(file) {
      await h.open(E, path);
      await E.getByRole('heading', { name: '位置资料' }).waitFor();
      const media = await h.upload(E, 0, file), item = await h.save(E);
      assert.equal(item.draft.qr_asset_id, media.id);
      return { media, item, receipt: await h.publish(P, path) };
    }
    async function verifyContact(media, expectedBytes) {
      const body = await readContact();
      const { qr_asset_url: src, ...fields } = body.business_contact;
      assert.deepEqual(fields, baseline.business_contact);
      const u = new URL(src, h.base);
      assert.ok(u.origin === new URL(h.base).origin && u.pathname === `/api/public/media/${media.id}` && !u.search);
      const card = V.getByAltText('商务联系二维码', { exact: true });
      await card.waitFor(); await card.evaluate(img => img.decode());
      assert.equal(new URL(await card.getAttribute('src'), h.base).href, u.href);
      assert.equal(await V.locator('.contact-service').count(), 3);
      await button(V, '合作咨询').click();
      const modal = V.getByRole('dialog', { name: '联系商务合作' });
      const qr = modal.getByAltText('长按保存商务二维码');
      await qr.waitFor(); await qr.evaluate(img => img.decode());
      assert.equal(new URL(await qr.getAttribute('src'), h.base).href, u.href);
      assert.equal(new URL(await link(modal, '保存二维码').getAttribute('href'), h.base).href, u.href);
      await button(modal, '关闭弹层').click();
      // Follow exactly the displayed image link in the other anonymous browser; compare immutable bytes.
      const image = await V2.goto(u.href);
      assert.ok(image?.ok() && (await image.body()).equals(expectedBytes), '实际公开二维码不是离线核对过的 QA 原图');
      return u.href;
    }
    const good = await uploadQr(h.files.qrA);
    await verifyContact(good.media, goodBytes);
    const bad = await uploadQr(h.files.qrB);
    assert.notEqual(good.media.id, bad.media.id); assert.equal(bad.item.id, good.item.id);
    const obsoleteUrl = await verifyContact(bad.media, badBytes);
    const id = good.item.id, actors = await roster(), versions = await history(E, path, id);
    for (const v of [good, bad]) assert.ok(versions.some(row => row.seq === v.receipt.seq && row.release_id === v.receipt.release_id && row.actor_id === actors.P.id && row.body.qr_asset_id === v.media.id));
    const correct = versionRow(E, good.receipt.seq);
    await button(correct, `查看版本 ${good.receipt.seq}`).click();
    await E.getByAltText('当前历史版本的私有图片').waitFor();
    const restored = await (await h.observe(E, 'POST', `${itemPath(id)}/versions/${good.receipt.seq}/restore`, () => button(correct, '恢复为草稿').click())).json();
    assert.equal(restored.draft.qr_asset_id, good.media.id); assert.equal(restored.live_id, bad.receipt.release_id);
    const preview = E.frameLocator(privateFrame).getByAltText('商务联系二维码');
    await preview.waitFor(); await preview.evaluate(img => img.decode());
    assert.equal(new URL(await preview.getAttribute('src'), h.base).pathname, `/api/admin/media/${good.media.id}`);
    await verifyContact(bad.media, badBytes);
    const republished = await h.publish(P, path);
    assert.ok(republished.seq > bad.receipt.seq);
    await verifyContact(good.media, goodBytes);
    assert.equal((await V2.goto(obsoleteUrl))?.status(), 404, '原错误二维码已无公开引用');
    const events = await audit(E, 'config', id);
    assert.ok(events.some(e => e.action === 'restore' && e.actor_id === actors.E.id && e.details.source_release_id === good.receipt.release_id));
    receiptAudit(events, republished, actors.P.id);
    return '用两份经本机离线核对的 QA 码比对公开图片字节：恢复只改草稿，重发后联系区、弹层均回到正确码，旧地址返回 404，服务卡不变；未使用真实企业码或手机扫码。';
  });

  let previewTarget;
  const isolated = await h.runCase('PRD-17', async () => {
    sandbox(); h.require(h.places.a && h.boards.a, '需要本轮护肤分类和板块');
    const name = t('17公开产品'), code = t('17-LIVE'), privateCode = t('17-DRAFT');
    const liveText = t('17线上功效'), draftText = t('17仅草稿功效');
    const item = await h.createProduct(E, { name, code, benefit: liveText, places: [h.places.a] });
    const path = editor('products', item.id);
    const receipt = await h.publish(P, path);
    await getItem(E, 'products', item.id);
    await E.getByLabel('功效', { exact: true }).fill(draftText);
    await E.getByLabel('配方编号', { exact: true }).fill(privateCode);
    const saved = await h.save(E);
    assert.equal(saved.live_id, receipt.release_id);
    const frame = E.frameLocator(privateFrame);
    await frame.getByText(`草稿预览 · 修订 ${saved.revision}`, { exact: true }).waitFor();
    await frame.getByText(privateCode, { exact: true }).waitFor();
    await frame.getByText(draftText, { exact: true }).waitFor();
    assert.notEqual(V.context(), V2.context(), '两位匿名访客须使用各自的浏览器上下文');
    await h.observe(V, 'GET', '/api/public/products', () => h.open(V, '/catalog'));
    const matches = await listRead(V, '/api/public/products', { board_id: h.boards.a, q: code }, async () => {
      await button(V, '护肤').click(); await V.locator('.catalog-tools input').fill(code);
    });
    assert.deepEqual(matches.items.map(i => i.id), [item.id]);
    const card = V.locator('a.product-card').filter({ hasText: name });
    const href = await card.getAttribute('href');
    assert.equal(href, `/products?id=${item.id}`);
    for (const page of [V, V2]) {
      const detail = await (await h.observe(page, 'GET', `/api/public/products/${item.id}`, () => page === V ? card.click() : h.open(page, href))).json();
      assert.equal(new URL(page.url()).href, new URL(href, h.base).href);
      assert.equal(detail.body.formula_no, code); assert.equal(detail.body.benefit, liveText);
      assert.ok(!JSON.stringify(detail).includes(privateCode) && !JSON.stringify(detail).includes(draftText));
      await page.getByRole('heading', { name, exact: true }).waitFor();
      await page.getByText(code, { exact: true }).waitFor(); await page.getByText(liveText, { exact: true }).waitFor();
      assert.equal(await page.getByText(draftText, { exact: true }).count(), 0);
      assert.equal(await page.locator('.preview-stamp,a[href^="/admin"],iframe').count(), 0);
      assert.equal(await button(page, '保存草稿').count() + await button(page, '确认发布').count(), 0);
    }
    previewTarget = { id: item.id, path, saved, seq: receipt.seq };
    return '编辑预览展示指定修订的新配方编号、新功效；两位独立匿名访客打开同一公开详情链接，均看到线上编号和功效，没有草稿内容或后台入口。';
  });

  await h.runCase('REVISION', async () => {
    sandbox(); h.require(isolated && previewTarget, '需要 PRD-17 已保存的草稿及历史版本');
    const { id, path, saved, seq } = previewTarget;
    const second = await h.newPage('E');
    try {
      await history(E, path, id);
      const oldRow = versionRow(E, seq); await oldRow.waitFor();
      await getItem(second, 'products', id);
      await second.getByLabel('功效', { exact: true }).fill(t('竞争者新修订'));
      const newer = await h.save(second); assert.notEqual(newer.revision, saved.revision);
      await h.observe(E, 'POST', `${itemPath(id)}/versions/${seq}/restore`, () => button(oldRow, '恢复为草稿').click(), 409);
      await E.locator('[aria-label="历史版本"] [role="alert"]').waitFor();
      const current = await getItem(E, 'products', id);
      assert.equal(current.revision, newer.revision); assert.deepEqual(current.draft, newer.draft); assert.equal(current.live_id, saved.live_id);
      assert.ok(!(await audit(E, 'product', id)).some(ev => ev.action === 'restore'));
      return '另一编辑页保存新修订后，旧历史页恢复返回 409；重新读取确认新草稿和线上版本均未被覆盖，没有成功恢复日志。';
    } finally { await second.close(); }
  });

  // Last: only the publisher account created for this run loses authority/is disabled. Never change A or E.
  await h.runCase('PRD-16', async () => {
    sandbox(); h.require(h.places.a && h.logins.P && h.logins.E, '需要本次测试角色及展示分类');
    const actors = await roster();
    h.require(actors.P.enabled && actors.P.can_publish && actors.P.can_edit && !actors.P.can_manage, '本轮发布人初始角色不符合前置条件');
    h.require(actors.E.enabled && actors.E.can_edit && !actors.E.can_publish && !actors.E.can_manage && actors.A.can_manage && !actors.A.can_publish, '需要普通编辑和未获发布权的管理员');
    await h.open(E, '/admin/accounts'); await button(E, '操作记录').waitFor();
    for (const action of ['企业账号', '开通账号', '调整权限']) assert.equal(await button(E, action).count(), 0);
    const name = t('16权限验证产品'), code = t('16-P');
    const item = await h.createProduct(P, { name, code, places: [h.places.a], benefit: t('16自编自发') });
    const path = editor('products', item.id), receipt = await h.publish(P, path);
    receiptAudit(await audit(E, 'product', item.id), receipt, actors.P.id);
    await getItem(P, 'products', item.id);
    await P.getByLabel('功效', { exact: true }).fill(t('16待审草稿')); await h.save(P);
    const row = await singleRow(P, 'products', code, name, item.id);
    const offline = await (await h.observe(P, 'POST', `${itemPath(item.id)}/unlist`, () => button(row, '下架').click())).json();
    assert.ok(offline.draft && !offline.live_id && offline.has_history);
    for (const [page, role] of [[E, actors.E], [A, actors.A]]) {
      if (!role.can_edit) {
        await h.open(page, '/admin/');
        const nav = page.locator('aside.rail');
        await link(nav, '账号与操作记录').waitFor({ state: 'attached' });
        assert.equal(await link(nav, '全部产品').count() + await link(nav, '发布检查').count(), 0);
        continue;
      }
      const target = await singleRow(page, 'products', name, name, item.id);
      await target.getByRole('checkbox').check();
      for (const control of [button(page, '批量发布检查'), button(target, '发布检查'), button(target, '归档')]) assert.ok(await control.isDisabled());
      assert.equal(await page.getByRole('region', { name: '发布检查' }).count(), 0);
      await h.open(page, path);
      await button(page.getByRole('navigation', { name: '内容编辑视图' }), '发布检查').click();
      assert.ok(await button(page, '检查发布').isDisabled() && await button(page, '确认发布').isDisabled());
    }
    async function removeCapability(label, key) {
      const latest = await roster();
      assert.equal(latest.P.id, actors.P.id); assert.equal(latest.P[key], true);
      const target = A.locator('tr.el-table__row').filter({ has: A.getByText(h.logins.P, { exact: true }) });
      await button(target, '调整权限').click();
      const form = A.locator('form').filter({ has: A.getByRole('heading', { name: `调整 ${h.logins.P} 的权限`, exact: true }) });
      await form.getByRole('checkbox', { name: label, exact: true }).uncheck();
      const changed = await (await h.observe(A, 'PATCH', `/api/admin/accounts/${actors.P.id}`, () => button(form, '保存权限').click())).json();
      assert.ok(changed.id === actors.P.id && changed[key] === false);
    }
    const checked = await h.check(P, path);
    assert.ok(checked.eligible && checked.revision === offline.revision);
    const oldCheck = await h.newPage('P');
    try {
      await getItem(oldCheck, 'products', item.id); await button(oldCheck, '发布检查').click();
      assert.ok(await button(oldCheck, '检查发布').isEnabled() && await button(P, '确认发布').isEnabled());
      await removeCapability('发布', 'can_publish');
      // These buttons really were enabled on the two independently opened pages; do not force clicks.
      for (const [page, text, action] of [[oldCheck, '检查发布', 'check'], [P, '确认发布', 'publish']]) {
        const denied = await h.observe(page, 'POST', `${itemPath(item.id)}/${action}`, () => button(page, text).click(), 403);
        assert.equal((await denied.json()).code, 'forbidden');
        await page.locator('[aria-label="发布检查"] [role="alert"]').waitFor();
      }
      await getItem(P, 'products', item.id);
      await P.getByLabel('功效', { exact: true }).fill(t('16停用后不得保存'));
      await removeCapability('启用', 'enabled');
      const denied = await h.observe(P, 'PUT', `${itemPath(item.id)}/draft`, () => button(P, '保存草稿').click(), 401);
      assert.ok(['session_expired', 'session_required'].includes((await denied.json()).code));
      await P.waitForURL(url => url.pathname === '/admin/login');
    } finally { await oldCheck.close(); }
    const remaining = await getItem(E, 'products', item.id);
    assert.equal(remaining.revision, offline.revision); assert.deepEqual(remaining.draft, offline.draft); assert.equal(remaining.live_id, null);
    const contentLog = await audit(E, 'product', item.id);
    assert.equal(contentLog.filter(ev => ev.action === 'publish').length, 1);
    const log = await audit(A, 'account', actors.P.id);
    for (const key of ['can_publish', 'enabled']) assert.ok(log.some(ev => ev.action === 'account_updated' && ev.actor_id === actors.A.id && ev.target_id === actors.P.id && ev.details[key]?.before === true && ev.details[key].after === false && ev.occurred_at));
    return '普通编辑无治理入口，编辑与未获发布权的管理员不能批量检查、发布或归档；发布人可自发。真实撤权后两旧页检查和发布均被拒，停用后旧编辑页保存被拒，草稿、发布次数与治理日志均已核对。';
  });
}
