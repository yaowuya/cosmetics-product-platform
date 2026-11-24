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
  const edit = button(row, '编辑').or(row.getByRole('link', { name: '编辑', exact: true }));
  const dialog = await openWizard(page, scenario, '编辑', () => edit.click());
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
  const row = rowNamed(page, name);
  const panel = page.locator('section[aria-label="发布检查"]');
  const checkPath = `/api/admin/items/${original.id}/check`;
  const check = () => h.observe(page, 'POST', checkPath, () => button(panel, '检查发布').click());
  await button(row, '发布检查').click();
  assert.equal((await (await check()).json()).eligible, true);
  const confirm = button(panel, '确认发布');
  await confirm.and(panel.locator('button:enabled')).waitFor();

  const dialog = await openWizard(page, scenario, '编辑', () => button(row, '编辑').click());
  await field(dialog, scenario.nameField).fill(`${name}-修订`);
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
  return '列表刷新失败也会失效旧发布检查；再次检查使用刚保存的修订';
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
        if (origin === h.base && /^\/api\/admin\/(?:products|cases|items)(?:\/|$)/.test(pathname)
          && request.method() !== 'GET') writes.push([request.method(), pathname]);
      };
      page.on('request', watchWrites);
      try {
        const item = await addDraft(h, scenario, name, endpoint);
        assert.equal(page.url(), listUrl, '新增成功后应停留在当前列表');
        await editDraft(h, scenario, name, item);
        assert.equal(page.url(), listUrl, '编辑成功后应停留在当前列表');
        assert.equal(await search.inputValue(), name, '保存后保留当前列表筛选条件');
        assert.deepEqual(writes, [['POST', endpoint], ['POST', endpoint], ['PUT', `/api/admin/items/${item.id}/draft`]],
          '取消和步骤切换不写入，保存只创建或更新草稿');
        return '从当前列表新增及编辑同一草稿；步骤、取消、失败保留及重试、草稿与列表刷新均通过';
      } finally {
        page.off('request', watchWrites);
      }
    });
  }
  await h.runCase('WIZARD-release-revision', () => releaseCheckAfterEdit(h));
}
