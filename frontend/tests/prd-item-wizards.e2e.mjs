import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { button, field } from './prd-harness.mjs';

const scenarios = [
  {
    collection: 'products', noun: '产品', nameField: '产品名称', nameKey: 'name',
    detailsStep: '产品详情', detailsField: '功效', detailsKey: 'benefit',
    finalStep: '图片与展示位置', imageField: '产品封面图', imageKey: 'cover_asset_id', fixture: 'cover',
  },
  {
    collection: 'cases', noun: '案例', nameField: '案例产品名称', nameKey: 'product_name',
    detailsField: '案例亮点', detailsKey: 'highlight',
    finalStep: '案例内容与图片', imageField: '案例图片', imageKey: 'image_asset_id', fixture: 'square',
  },
];

const rowNamed = (page, name) => page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
const rowAction = (row, name) => button(row, name).or(row.getByRole('link', { name, exact: true }));
const footerAction = (dialog, action) => button(dialog.locator('footer'), action);

async function fullHeightDrawer(page, dialog, fullWidth = false) {
  assert.match(await dialog.getAttribute('class') ?? '', /\bitem-wizard-drawer\b/);
  await page.waitForFunction(expectedFullWidth => {
    const drawer = document.querySelector('.el-drawer.item-wizard-drawer');
    if (!drawer) return false;
    const { top, right, height, width } = drawer.getBoundingClientRect();
    return Math.abs(top) <= 1 && Math.abs(right - innerWidth) <= 1 && Math.abs(height - innerHeight) <= 1
      && (!expectedFullWidth || Math.abs(width - innerWidth) <= 1);
  }, fullWidth);
  const footer = await dialog.locator('.wizard-footer').boundingBox();
  const form = await dialog.locator('.wizard-content').boundingBox();
  assert.ok(footer && form && form.y + form.height <= footer.y + 1);
  assert.ok(footer.y + footer.height <= page.viewportSize().height + 1);
}

async function assertStep(dialog, visible, { previous = false, last = false } = {}) {
  await visible.waitFor();
  await footerAction(dialog, '取消').waitFor();
  if (previous) await footerAction(dialog, '上一步').waitFor();
  else assert.equal(await footerAction(dialog, '上一步').isVisible(), false, '首步不显示上一步');
  if (last) {
    await footerAction(dialog, '保存').waitFor();
    assert.equal(await footerAction(dialog, '下一步').isVisible(), false, '末步不显示下一步');
  } else {
    assert.equal(await footerAction(dialog, '保存').isVisible(), false, '仅末步可保存');
    assert.equal(await footerAction(dialog, '保存草稿').isVisible(), false, '不得在前置步骤提前保存草稿');
    await footerAction(dialog, '下一步').waitFor();
  }
}

async function openWizard(page, scenario, action, launch) {
  const at = page.url();
  const dialog = page.getByRole('dialog', { name: `${action}${scenario.noun}`, exact: true });
  await launch();
  await dialog.waitFor();
  assert.equal(page.url(), at, `${action}${scenario.noun}应停留在当前列表`);
  for (const label of ['基础信息', scenario.detailsStep, scenario.finalStep].filter(Boolean)) {
    await dialog.getByText(label, { exact: true }).first().waitFor();
  }
  await assertStep(dialog, field(dialog, scenario.nameField));
  await fullHeightDrawer(page, dialog);
  assert.equal(await field(dialog, scenario.detailsField).isVisible(), false, '首步只显示基础信息');
  assert.equal(await field(dialog, scenario.imageField).isVisible(), false, '首步不显示图片字段');
  return dialog;
}

async function lastStep(dialog, scenario, details) {
  await footerAction(dialog, '下一步').click();
  const content = field(dialog, scenario.detailsField);
  if (scenario.detailsStep) {
    await assertStep(dialog, content, { previous: true });
    assert.equal(await field(dialog, scenario.imageField).isVisible(), false, '产品图片只在末步显示');
  }
  await content.waitFor();
  if (details !== undefined) await content.fill(details);
  if (details !== undefined && scenario.collection === 'products') {
    for (const [label, minimum] of [['功效', 130], ['核心成分', 160], ['产品亮点', 200]]) {
      const box = await field(dialog, label).boundingBox();
      assert.ok(box && box.height >= minimum, `「${label}」至少应高 ${minimum}px，实际 ${box?.height ?? '不可见'}`);
    }
    await field(dialog, '核心成分').fill('测试成分');
    await field(dialog, '产品亮点').fill('测试亮点');
  }
  if (scenario.detailsStep) await footerAction(dialog, '下一步').click();
  await assertStep(dialog, field(dialog, scenario.imageField), { previous: true, last: true });
  assert.equal(await field(dialog, scenario.nameField).isVisible(), false, '末步不再显示基础信息');
  if (scenario.detailsStep) await dialog.getByRole('heading', { name: '展示位置', exact: true }).waitFor();
}

async function toBasic(dialog, scenario) {
  await footerAction(dialog, '上一步').click();
  if (scenario.detailsStep) {
    await assertStep(dialog, field(dialog, scenario.detailsField), { previous: true });
    await footerAction(dialog, '上一步').click();
  }
  await assertStep(dialog, field(dialog, scenario.nameField));
}

async function upload(h, dialog, scenario) {
  const file = h.files[scenario.fixture];
  assert.ok(file && dirname(realpathSync(file)) === realpathSync(join(h.box, 'assets')), `缺少隔离测试图片 ${scenario.fixture}`);
  const response = await h.observe(h.E, 'POST', '/api/admin/media',
    () => field(dialog, scenario.imageField).setInputFiles(file), 201);
  await dialog.getByRole('img', { name: scenario.imageField, exact: true }).waitFor();
  return (await response.json()).id;
}

async function assertBlockedSave(dialog, scenario) {
  await footerAction(dialog, '保存').click();
  await dialog.getByRole('alert').filter({ hasText: '请补齐必填项后保存草稿' }).waitFor();
  assert.equal(await field(dialog, scenario.nameField).getAttribute('aria-invalid'), 'true');
  await field(dialog, scenario.nameField).waitFor();
}

/** Open the actual uploaded asset and verify Escape closes only the image dialog. */
async function assertLargePreview(page, drawer, name) {
  const image = drawer.getByRole('img', { name, exact: true });
  await image.waitFor();
  const box = await image.boundingBox();
  assert.ok(box && box.height >= 150, `「${name}」的预览至少应高 150px，实际 ${box?.height ?? '不可见'}`);
  const src = await image.getAttribute('src');
  assert.ok(src, `「${name}」缺少预览地址`);
  await button(drawer, `预览${name}`).click();
  const preview = page.getByRole('dialog', { name: `查看${name}`, exact: true });
  const fullImage = preview.getByRole('img', { name, exact: true });
  await fullImage.waitFor();
  assert.equal(await fullImage.getAttribute('src'), src, `「${name}」应查看已上传的图片`);
  await fullImage.evaluate(element => element.decode());
  await page.keyboard.press('Escape');
  await preview.waitFor({ state: 'hidden' });
  await footerAction(drawer, '保存').waitFor();
  await fullHeightDrawer(page, drawer);
}

async function completeProductImages(h, page, dialog) {
  const firstPlacement = page.locator('.el-cascader-menu').first().locator('label.el-checkbox').first();
  await h.upload(page, field(dialog, '添加详情竖图'), h.files.long);
  await assertLargePreview(page, dialog, '详情竖图 1');
  await dialog.locator('.place-cascader').click();
  await firstPlacement.click();
  await dialog.getByRole('heading', { name: '展示位置', exact: true }).click();
}

// Fault injection is limited to one browser save; all setup, uploads, retries and draft writes are real.
async function rejectFirstSave(h, dialog, path) {
  const endpoint = h.base + path;
  const reject = route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { code: 'temporary_failure', message: '临时保存失败，可重试' } })
    : route.fallback();
  await h.E.route(endpoint, reject);
  try {
    await h.observe(h.E, 'POST', path, () => footerAction(dialog, '保存').click(), 503);
    await dialog.getByRole('alert').filter({ hasText: '临时保存失败，可重试' }).waitFor();
  } finally {
    await h.E.unroute(endpoint, reject);
  }
}

function draftMatches(item, scenario, expected) {
  assert.equal(item.live_id, null, '保存不能上线');
  assert.ok(item.id && item.draft, '应返回已保存的草稿');
  assert.equal(item.draft[scenario.nameKey], expected.name);
  assert.equal(item.draft[scenario.detailsKey], expected.details);
  assert.equal(item.draft[scenario.imageKey], expected.image);
}

async function addDraft(h, scenario, name, endpoint) {
  const page = h.E;
  const add = () => button(page, `新增${scenario.noun}`).click();
  let dialog = await openWizard(page, scenario, '新增', add);
  await field(dialog, scenario.nameField).fill(`${name}-放弃`);
  h.setConfirm(page, false);
  try {
    await footerAction(dialog, '取消').click();
    assert.equal(await field(dialog, scenario.nameField).inputValue(), `${name}-放弃`, '拒绝放弃时保留输入');
  } finally {
    h.setConfirm(page, true);
  }
  await footerAction(dialog, '取消').click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await rowNamed(page, `${name}-放弃`).count(), 0, '取消不得创建草稿');

  if (scenario.collection === 'products') {
    await page.route(`${h.base}/api/admin/config/directory`, route => route.fulfill({ status: 503,
      json: { code: 'temporary_failure', message: '展示位置暂不可用' } }), { times: 1 });
  }
  dialog = await openWizard(page, scenario, '新增', add);
  assert.equal(await field(dialog, scenario.nameField).inputValue(), '', '重新新增不得带回已放弃内容');
  if (scenario.collection === 'products') {
    await field(dialog, '配方编号').fill(name);
    await field(dialog, '简短功效').fill('测试简短功效');
    await field(dialog, '是否生产过').selectOption('待确认');
  }
  else await field(dialog, '品牌名称').fill('向导回归测试品牌');
  const details = '首次填写的测试内容';
  await lastStep(dialog, scenario, details);
  if (scenario.collection === 'products') {
    const desktop = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 420 });
    await fullHeightDrawer(page, dialog, true);
    assert.ok(await dialog.locator('.wizard-content').evaluate(el => el.scrollHeight > el.clientHeight));
    await page.setViewportSize(desktop);
  }
  await assertBlockedSave(dialog, scenario);
  await field(dialog, scenario.nameField).fill(name);
  await lastStep(dialog, scenario);
  const image = await upload(h, dialog, scenario);
  if (scenario.collection === 'products') {
    await assertLargePreview(page, dialog, scenario.imageField);
    await dialog.getByRole('alert').filter({ hasText: '展示位置加载失败' }).waitFor();
    await h.observe(page, 'GET', '/api/admin/config/directory', () => button(dialog, '重试加载展示位置').click(), 200);
    await dialog.getByRole('img', { name: scenario.imageField, exact: true }).waitFor();
    await completeProductImages(h, page, dialog);
  }
  await rejectFirstSave(h, dialog, endpoint);
  await dialog.getByRole('img', { name: scenario.imageField, exact: true }).waitFor();
  await toBasic(dialog, scenario);
  assert.equal(await field(dialog, scenario.nameField).inputValue(), name, '保存失败后保留前面步骤的输入');
  await lastStep(dialog, scenario);
  await dialog.getByRole('img', { name: scenario.imageField, exact: true }).waitFor();
  const item = await (await h.observe(page, 'POST', endpoint, () => footerAction(dialog, '保存').click(), 201)).json();
  draftMatches(item, scenario, { name, details, image });
  await dialog.waitFor({ state: 'hidden' });
  await rowNamed(page, name).getByText('有草稿', { exact: true }).waitFor();
  return item;
}

async function editDraft(h, scenario, name, original) {
  const page = h.E;
  const row = rowNamed(page, name);
  const dialog = await openWizard(page, scenario, '编辑', () => rowAction(row, '编辑').click());
  await field(dialog, scenario.nameField).and(dialog.locator('input:enabled')).waitFor();
  assert.equal(await field(dialog, scenario.nameField).inputValue(), name, '编辑应载入所选行的草稿');
  const nextName = `${name}-修订`;
  const details = original.draft[scenario.detailsKey];
  const image = original.draft[scenario.imageKey];
  await field(dialog, scenario.nameField).fill('');
  await lastStep(dialog, scenario);
  await assertBlockedSave(dialog, scenario);
  await field(dialog, scenario.nameField).fill(nextName);
  await lastStep(dialog, scenario);
  await dialog.getByRole('img', { name: scenario.imageField, exact: true }).waitFor();
  const item = await (await h.observe(page, 'PUT', `/api/admin/items/${original.id}/draft`,
    () => footerAction(dialog, '保存').click(), 200)).json();
  assert.equal(item.id, original.id, '编辑不能另建草稿');
  draftMatches(item, scenario, { name: nextName, details, image });
  await dialog.waitFor({ state: 'hidden' });
  await rowNamed(page, nextName).getByText('有草稿', { exact: true }).waitFor();
  return item;
}

/** Verify the actual private image decodes; merely rendering an img can hide a broken or public URL. */
async function assertPrivateImage(dialog, { name, id, itemId, revision, seq }) {
  const image = dialog.getByRole('img', { name, exact: true });
  await image.scrollIntoViewIfNeeded();
  const src = new URL(await image.getAttribute('src'), 'https://fixture.invalid');
  assert.equal(src.pathname, `/api/admin/media/${id}`);
  assert.deepEqual(Object.fromEntries(src.searchParams), revision
    ? { item_id: itemId, revision } : { item_id: itemId, seq: String(seq) });
  await image.evaluate(element => element.decode());
}

async function viewSavedItem(page, { noun, name, entry, version, listUrl, searchValue, image }) {
  const row = rowNamed(page, name);
  const dialog = page.getByRole('dialog', { name: `查看${noun}`, exact: true });
  const savedName = dialog.getByText(name, { exact: true });
  const editActions = { name: /保存|上传|编辑/, includeHidden: true };

  await rowAction(row, entry).click();
  await dialog.waitFor();
  assert.equal(page.url(), listUrl, `点击「${entry}」应在原列表打开查看弹窗`);
  await savedName.waitFor();
  await dialog.getByText(version, { exact: true }).waitFor();
  await assertPrivateImage(dialog, image);
  assert.equal(await dialog.locator('form, [role="form"], input, select, textarea').count(), 0, '查看弹窗不得包含表单或输入控件');
  assert.equal(await dialog.getByRole('button', editActions).or(dialog.getByRole('link', editActions)).count(), 0,
    '查看弹窗不得提供保存、上传或编辑操作');

  // Move away from any focused close button before testing Enter in the read-only content.
  await savedName.click();
  await page.keyboard.press('Enter');
  await button(dialog, '关闭').click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(page.url(), listUrl, '关闭查看不应改变列表 URL');
  assert.equal(await field(page, `搜索${noun}`).inputValue(), searchValue, '关闭查看后应保留搜索词');
  await row.waitFor();
}

/** An image failure must refresh the snapshot instead of retrying a possibly stale draft URL. */
async function retryDraftMedia(h, page, scenario, saved, name) {
  const key = scenario.imageKey;
  const asset = saved.draft[key];
  const dialog = page.getByRole('dialog', { name: `查看${scenario.noun}`, exact: true });
  const mediaPath = url => url.origin === h.base && url.pathname === `/api/admin/media/${asset}`;
  const failMedia = route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'test image unavailable' });
  await page.route(mediaPath, failMedia);
  try {
    await rowAction(rowNamed(page, name), '查看').click();
    await dialog.getByText(scenario.imageField, { exact: true }).scrollIntoViewIfNeeded();
    await dialog.getByRole('alert').getByText('图片无法加载', { exact: true }).waitFor();
  } finally {
    await page.unroute(mediaPath, failMedia);
  }
  await h.observe(page, 'GET', `/api/admin/items/${saved.id}`,
    () => button(dialog, '重试加载').click());
  await assertPrivateImage(dialog, { name: scenario.imageField, id: asset, itemId: saved.id, revision: saved.revision });
  await button(dialog, '关闭').click();
  await dialog.waitFor({ state: 'hidden' });
}

/** A failed or inconsistent history read must not expose a public fallback for a live item. */
async function retryReleaseHistory(h, page, row, name, item, receipt, imageName) {
  const dialog = page.getByRole('dialog', { name: '查看产品', exact: true });
  const versionsPath = `/api/admin/items/${item.id}/versions`;
  const match = url => url.origin === h.base && url.pathname === versionsPath;
  const retry = () => button(dialog, '重试加载').click();
  for (const [status, text, action] of [
    [503, '历史版本暂时无法加载', () => rowAction(row, '查看').click()],
    [200, '版本资料已变化，请重试加载。', retry],
  ]) {
    const routeHandler = async route => {
      if (status === 503) return route.fulfill({ status, json: { code: 'temporary_failure', message: text } });
      const response = await route.fetch();
      const page = await response.json();
      page.items[0].release_id = String(BigInt(receipt.release_id) + 1n);
      return route.fulfill({ response, json: page });
    };
    await page.route(match, routeHandler);
    try {
      await h.observe(page, 'GET', versionsPath, action, status);
      await dialog.getByRole('alert').filter({ hasText: text }).waitFor();
      assert.equal(await dialog.getByText(name, { exact: true }).count(), 0, '不可退回到未经确认的线上资料');
      assert.equal(await dialog.getByRole('region', { name: '条目资料' }).locator('img[src]').count(), 0,
        '版本加载失败时不得显示条目图片');
    } finally {
      await page.unroute(match, routeHandler);
    }
  }
  await h.observe(page, 'GET', versionsPath, retry);
  await dialog.getByText(`版本 ${receipt.seq}`, { exact: true }).waitFor();
  await assertPrivateImage(dialog, { name: imageName, id: item.draft.cover_asset_id, itemId: item.id, seq: receipt.seq });
  await button(dialog, '关闭').click();
  await dialog.waitFor({ state: 'hidden' });
}

async function publishFromList(h, page, row, saved) {
  const path = `/api/admin/items/${saved.id}`;
  const writes = [];
  const observe = request => {
    const url = new URL(request.url());
    if (url.origin === h.base && request.method() === 'POST' && [path + '/check', path + '/publish'].includes(url.pathname)) {
      writes.push(url.pathname);
    }
  };
  const dialog = page.getByRole('dialog', { name: '确认发布', exact: true });
  page.on('request', observe);
  try {
    await button(row, '发布').click();
    await button(dialog, '取消').click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(writes, [], '取消发布不能检查或写入');

    await button(row, '发布').click();
    assert.deepEqual(writes, [], '打开确认框不能发起检查或发布');
    const response = await h.observe(page, 'POST', path + '/publish', () => button(dialog, '确认发布').click());
    assert.equal(response.request().postDataJSON().expected_revision, saved.revision);
    assert.deepEqual(writes, [path + '/publish'], '确认只提交一次发布请求');
    await dialog.waitFor({ state: 'hidden' });
    return response.json();
  } finally {
    page.off('request', observe);
  }
}

/** Publish after editing and verify that history contains the revised saved version. */
async function releaseAfterEdit(h) {
  const page = h.logins.P ? await h.newPage('P') : h.E;
  const scenario = scenarios[0];
  const directoryReply = await page.request.get(h.base + '/api/admin/config/directory');
  assert.ok(directoryReply.ok());
  const directory = await directoryReply.json();
  const place = h.places?.a ?? directory.live?.nodes?.find(node => node.level === 'category' && node.enabled)?.id;
  assert.ok(place, '隔离环境需要已发布的展示分类');
  const name = `向导发布-${randomUUID().slice(0, 8)}`;
  const original = await h.createProduct(page, { name, code: name, places: [place], detailFiles: [h.files.long, h.files.poster1, h.files.poster2] });
  const [firstDetail, secondDetail, thirdDetail] = original.draft.detail_asset_ids;
  const search = field(page, '搜索产品');
  await search.fill(name);
  await search.press('Enter');
  const row = rowNamed(page, name);
  const savedName = `${name}-修订`;
  const dialog = await openWizard(page, scenario, '编辑', () => button(row, '编辑').click());
  await field(dialog, scenario.nameField).fill(savedName);
  await lastStep(dialog, scenario);
  assert.equal(await field(dialog, '添加详情竖图').count(), 0, '三张竖图时不能继续上传');
  await button(dialog, '上移详情竖图 3').click();
  const saved = await (await h.observe(page, 'PUT', `/api/admin/items/${original.id}/draft`,
    () => footerAction(dialog, '保存').click(), 200)).json();
  assert.notEqual(saved.revision, original.revision);
  assert.deepEqual(saved.draft.detail_asset_ids, [firstDetail, thirdDetail, secondDetail]);
  await dialog.waitFor({ state: 'hidden' });
  // Reuse the eligible product so the archived view exercises the real published snapshot, not a mocked list row.
  const itemPath = `/api/admin/items/${original.id}`;
  const revisedRow = rowNamed(page, savedName);
  const receipt = await publishFromList(h, page, revisedRow, saved);
  await revisedRow.getByText('已上线', { exact: true }).waitFor();
  await retryReleaseHistory(h, page, revisedRow, savedName, original, receipt, scenario.imageField);
  await h.observe(page, 'POST', `${itemPath}/unlist`, () => button(revisedRow, '下架').click());
  await revisedRow.getByText('已下架', { exact: true }).waitFor();
  const archived = await (await h.observe(page, 'POST', `${itemPath}/archive`, () => button(revisedRow, '归档').click())).json();
  assert.ok(archived.archived_at && !archived.live_id && !archived.draft, '归档前置数据必须只保留历史版本');
  await revisedRow.waitFor({ state: 'hidden' });

  const state = page.getByRole('combobox', { name: '线上状态', exact: true });
  await search.fill(savedName);
  await search.press('Enter');
  await state.selectOption('archived');
  await revisedRow.getByText('已归档', { exact: true }).waitFor();
  assert.equal(await rowAction(revisedRow, '编辑').count(), 0, '归档条目不得提供编辑入口');
  await viewSavedItem(page, { noun: '产品', name: savedName, entry: '查看', version: `版本 ${receipt.seq}`,
    listUrl: h.base + '/admin/products', searchValue: savedName,
    image: { name: scenario.imageField, id: original.draft[scenario.imageKey], itemId: original.id, seq: receipt.seq } });
  assert.equal(await state.inputValue(), 'archived', '关闭查看后应保留归档筛选');
  return '产品取消发布无写入，一次确认直接发布最新保存修订；归档后可查看最后发布版本';
}

/** Exercise both list wizards against a signed-in editor and the disposable fixture's actual API. */
export async function runItemWizards(h) {
  for (const scenario of scenarios) {
    await h.runCase(`WIZARD-${scenario.collection}`, async () => {
      const page = h.E;
      const path = `/admin/${scenario.collection}`;
      const endpoint = `/api/admin/${scenario.collection}`;
      const name = `向导-${scenario.noun}-${randomUUID().slice(0, 8)}`;
      await h.open(page, path);
      const listUrl = page.url();
      // Match the test draft by name even after this fixture accumulates multiple pages.
      const search = field(page, `搜索${scenario.noun}`);
      await search.fill(name);
      await Promise.all([
        page.waitForResponse(response => {
          const url = new URL(response.url());
          return url.origin === h.base && url.pathname === endpoint && url.searchParams.get('q') === name
            && response.request().method() === 'GET' && response.ok();
        }),
        search.press('Enter'),
      ]);
      const writes = [];
      const watchWrites = request => {
        const { origin, pathname } = new URL(request.url());
        const method = request.method();
        if (origin === h.base && pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
          writes.push([method, pathname]);
        }
      };
      page.on('request', watchWrites);
      try {
        const item = await addDraft(h, scenario, name, endpoint);
        assert.equal(page.url(), listUrl, '新增成功后应停留在当前列表');
        const saved = await editDraft(h, scenario, name, item);
        assert.equal(page.url(), listUrl, '编辑成功后应停留在当前列表');
        assert.equal(await search.inputValue(), name, '保存后保留当前列表筛选条件');
        const mediaWrites = Array.from({ length: scenario.collection === 'products' ? 2 : 1 }, () => ['POST', '/api/admin/media']);
        assert.deepEqual(writes, [...mediaWrites, ['POST', endpoint], ['POST', endpoint],
          ['PUT', `/api/admin/items/${item.id}/draft`]], '取消和步骤切换不写入；只有上传和保存可写入');
        const savedName = saved.draft[scenario.nameKey];
        const beforeView = writes.length;
        const image = { name: scenario.imageField, id: saved.draft[scenario.imageKey], itemId: saved.id, revision: saved.revision };
        for (const entry of [savedName, '查看']) {
          await viewSavedItem(page, { noun: scenario.noun, name: savedName, entry, version: `修订 ${saved.revision}`,
            listUrl, searchValue: name, image });
          assert.deepEqual(writes.slice(beforeView), [], `通过「${entry}」打开、按 Enter 和关闭查看弹窗不得发出 API 写入`);
        }
        if (scenario.collection === 'products') await retryDraftMedia(h, page, scenario, saved, savedName);
        assert.deepEqual(writes.slice(beforeView), [], '重试图片不得发出 API 写入');
        return '新增、编辑及两种入口查看同一草稿；步骤、取消、重试、已保存修订、只读和列表筛选均通过';
      } finally {
        page.off('request', watchWrites);
      }
    });
  }
  await h.runCase('WIZARD-release-revision', () => releaseAfterEdit(h));
  await h.runCase('WIZARD-case-release', async () => {
    const page = h.logins.P ? await h.newPage('P') : h.E;
    const name = `向导案例发布-${randomUUID().slice(0, 8)}`;
    const saved = await h.createCase(page, { name, brand: '向导测试' });
    const search = field(page, '搜索案例');
    await search.fill(name);
    await search.press('Enter');
    const row = rowNamed(page, name);
    await publishFromList(h, page, row, saved);
    await row.getByText('已上线', { exact: true }).waitFor();
    return '案例取消发布无写入，一次确认直接上线';
  });
  await h.runCase('WIZARD-release-permission', async () => {
    const page = await h.newPage(h.logins.P ? 'P' : 'E');
    try {
      const name = `向导发布权限-${randomUUID().slice(0, 8)}`;
      const saved = await h.createCase(page, { name, brand: '向导测试' });
      const publish = `/api/admin/items/${saved.id}/publish`;
      await page.route(h.base + publish, route => route.fulfill({ status: 502, json: {} }));
      await page.route(url => url.origin === h.base && url.pathname === '/api/admin/audit',
        route => route.fulfill({ status: 403, json: { message: '需要发布权限' } }));
      await page.route(`${h.base}/api/admin/me`, async route => {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...await response.json(), can_publish: false } });
      });
      await rowAction(rowNamed(page, name), '发布').click();
      const dialog = page.getByRole('dialog', { name: '确认发布', exact: true });
      await h.observe(page, 'POST', publish, () => button(dialog, '确认发布').click(), 502);
      assert.ok(await button(dialog, '取消').isDisabled());
      await h.observe(page, 'GET', '/api/admin/audit', () => button(dialog, '核对回执').click(), 403);
      await dialog.getByText('发布结果待核对，请联系有发布权限的同事。').waitFor();
      await button(dialog, '取消').click();
      await dialog.waitFor({ state: 'hidden' });
      return '发布结果不明时保留核对，失去发布权限后可以关闭弹窗';
    } finally { await page.context().close(); }
  });
}
