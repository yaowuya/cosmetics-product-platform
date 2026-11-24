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

  dialog = await openWizard(page, scenario, '新增', add);
  assert.equal(await field(dialog, scenario.nameField).inputValue(), '', '重新新增不得带回已放弃内容');
  await field(dialog, scenario.nameField).fill(name);
  if (scenario.collection === 'products') await field(dialog, '配方编号').fill(name);
  else await field(dialog, '品牌名称').fill('向导回归测试品牌');
  const details = '首次填写的测试内容';
  await lastStep(dialog, scenario, details);
  const image = await upload(h, dialog, scenario);
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
      assert.equal(await dialog.getByRole('img').count(), 0);
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

/** A list refresh failure must not let the earlier release check survive an edit. */
async function releaseCheckAfterEdit(h) {
  const page = h.logins.P ? await h.newPage('P') : h.E;
  const scenario = scenarios[0];
  const endpoint = '/api/admin/products';
  const directoryReply = await page.request.get(h.base + '/api/admin/config/directory');
  assert.ok(directoryReply.ok());
  const directory = await directoryReply.json();
  const place = h.places?.a ?? directory.live?.nodes?.find(node => node.level === 'category' && node.enabled)?.id;
  assert.ok(place, '隔离环境需要已发布的展示分类');
  const name = `向导发布检查-${randomUUID().slice(0, 8)}`;
  const original = await h.createProduct(page, { name, code: name, places: [place] });
  const search = field(page, '搜索产品');
  await search.fill(name);
  await search.press('Enter');
  const row = rowNamed(page, name);
  const panel = page.locator('section[aria-label="发布检查"]');
  const checkPath = `/api/admin/items/${original.id}/check`;
  const check = () => h.observe(page, 'POST', checkPath, () => button(panel, '检查发布').click());
  await button(row, '发布检查').click();
  assert.equal((await (await check()).json()).eligible, true);
  const confirm = button(panel, '确认发布');
  await confirm.and(panel.locator('button:enabled')).waitFor();

  const savedName = `${name}-修订`;
  const dialog = await openWizard(page, scenario, '编辑', () => button(row, '编辑').click());
  await field(dialog, scenario.nameField).fill(savedName);
  await lastStep(dialog, scenario);
  const listRequests = url => url.origin === h.base && url.pathname === endpoint;
  const failList = route => route.request().method() === 'GET'
    ? route.fulfill({ status: 503, json: { code: 'temporary_failure', message: '产品列表暂时无法刷新' } })
    : route.fallback();
  await page.route(listRequests, failList);
  try {
    const saved = await (await h.observe(page, 'PUT', `/api/admin/items/${original.id}/draft`,
      () => footerAction(dialog, '保存').click(), 200)).json();
    assert.notEqual(saved.revision, original.revision);
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('alert').filter({ hasText: '产品列表暂时无法刷新' }).waitFor();
    assert.equal(await confirm.isDisabled(), true, '刷新失败也不能继续确认旧修订');
    const report = await check();
    assert.equal(report.request().postDataJSON().expected_revision, saved.revision, '再次检查必须使用刚保存的修订');
    assert.equal((await report.json()).eligible, true);
  } finally {
    await page.unroute(listRequests, failList);
  }
  // Reuse the eligible product so the archived view exercises the real published snapshot, not a mocked list row.
  const itemPath = `/api/admin/items/${original.id}`;
  const receipt = await (await h.observe(page, 'POST', `${itemPath}/publish`, () => confirm.click())).json();
  const revisedRow = rowNamed(page, savedName);
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
  return '列表刷新失败后重新检查使用刚保存的修订；真实归档后可只读查看最后发布的版本';
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
        assert.deepEqual(writes, [['POST', '/api/admin/media'], ['POST', endpoint], ['POST', endpoint],
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
  await h.runCase('WIZARD-release-revision', () => releaseCheckAfterEdit(h));
}
