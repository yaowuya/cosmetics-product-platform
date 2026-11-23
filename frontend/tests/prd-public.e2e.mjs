import assert from 'node:assert/strict';

// 微肽交接稿 §5.1。仅验收该样例；不是所有企业都必须有这五个板块。
const categories = {
  护肤: '净澈清洁、基础维稳、功效护肤、电商爆品、创新剂型、功效水光、以油养肤、眼部专项、底妆专项、面膜棉片、院线护理、身体护理',
  冻干: '冻干粉、冻干絮、冻干球、冻干油、冻干乳、冻干微球、冻干冰晶、冻干面膜、冻干眼膜',
  二类: '防晒清洁、重组胶原蛋白、重组贻贝蛋白、透明质酸钠、生物多糖、海藻糖、生物玻璃、眼部护理、私密护理、鼻腔护理、其他',
  洗护: '洗发护理、护发修护、头皮护理、沐浴清洁',
  外贸: '净澈清洁、多肽抗老、蓝铜肽、视觉爆款、以油养肤、身体头皮、面膜系列',
};
const routes = { 首页: '/', 产品目录: '/catalog', 品牌案例: '/cases', 联系我们: '/contact' };
const nav = page => page.getByRole('navigation', { name: '主导航', exact: true });
const labels = async locator => (await locator.allInnerTexts()).map(s => s.trim());
const input = page => page.locator('.h5-search input'); // uni-input 内可实际输入的原生控件

async function visit(h, page, path) {
  h.require(h.sample && page, '缺少只读样例地址或匿名浏览页');
  assert.equal(new URL(h.sample).origin, 'https://localhost:5143', '公开用例只接受指定的样例站');
  const res = await page.goto(new URL(path, h.sample).href, { waitUntil: 'domcontentloaded' });
  assert.ok(res?.ok(), `样例页面 ${path} 未正常打开`);
}

async function checkNav(page, label) {
  const bar = nav(page);
  await bar.locator('a[aria-current="page"]').filter({ hasText: label }).waitFor();
  assert.deepEqual(await labels(bar.locator('a[aria-current="page"]')), [label], '当前入口应与页面一致');
  assert.equal(new URL(page.url()).pathname, routes[label]);
  assert.deepEqual(await labels(bar.getByRole('link')), Object.keys(routes), '四个固定导航入口及顺序');
  const atBottom = await bar.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top >= 0 && Math.abs(r.bottom - innerHeight) <= 2;
  });
  assert.ok(atBottom, '主导航应完整可见并位于视口底端');
}

async function navigate(page, label) {
  await nav(page).getByRole('link', { name: label, exact: true }).click();
  await checkNav(page, label);
}

async function choose(page, group, name) {
  const area = page.locator(group);
  await area.getByRole('button', { name, exact: true }).click();
  await area.getByRole('button', { name, exact: true, pressed: true }).waitFor();
}

async function ready(page, scope) {
  await page.waitForFunction(selector => {
    const el = document.querySelector(selector);
    return el && !el.querySelector('.h5-empty[role="status"]') && !!el.querySelector('.product-card,.case-card,.h5-empty');
  }, scope, { timeout: 10000 });
  assert.equal(await page.locator(`${scope} [role="alert"]`).count(), 0, '列表不能以错误态代替搜索结果');
}

async function imageMetrics(image) {
  await image.waitFor({ state: 'attached' });
  return image.evaluate(async img => {
    await img.decode();
    const { width, height } = img.getBoundingClientRect();
    return { src: img.currentSrc, width, height, nw: img.naturalWidth, nh: img.naturalHeight };
  });
}

function proportional(m, what) {
  assert.ok(m.nw > 0 && m.nh > 0 && m.width > 0 && m.height > 0, `${what}必须加载并显示`);
  assert.ok(Math.abs(m.height - m.width * m.nh / m.nw) <= 2, `${what}应保持原图比例`);
}

async function backToProducts(page) {
  await page.getByRole('button', { name: '返回产品目录', exact: true }).click();
  await checkNav(page, '产品目录');
  await ready(page, '.catalog-results');
}

// 使用独立匿名视口；不改其他用例的尺寸、动效偏好或浏览位置。
async function narrow(h, task) {
  const page = await h.browser.newPage({ viewport: { width: 360, height: 520 }, deviceScaleFactor: 1,
    isMobile: true, hasTouch: true, reducedMotion: 'no-preference', locale: 'zh-CN', ignoreHTTPSErrors: true });
  try { await page.bringToFront(); return await task(page); } finally { await page.close(); }
}

// 同时观察圆点和实际图片位置；只读取真实浏览器时钟，不替换计时器或分发伪造事件。
async function settledPoster(page, expected = -1, timeout = 10000) {
  const value = await page.waitForFunction(index => {
    const track = document.querySelector('.poster-track');
    const dots = [...document.querySelectorAll('.poster-dots button')];
    const active = dots.findIndex(dot => dot.getAttribute('aria-current') === 'true');
    if (!track?.clientWidth || active < 0 || (index >= 0 && active !== index)) return false;
    if (Math.abs(track.scrollLeft - active * track.clientWidth) > 1) return false;
    return { index: active, at: performance.now() };
  }, expected, { polling: 35, timeout });
  return value.jsonValue();
}

async function staysOnPoster(page, index) {
  const start = await page.evaluate(() => performance.now());
  const result = await page.waitForFunction(({ start, index }) => {
    const track = document.querySelector('.poster-track');
    const dot = document.querySelectorAll('.poster-dots button')[index];
    if (!track || dot?.getAttribute('aria-current') !== 'true' || Math.abs(track.scrollLeft - index * track.clientWidth) > 1) return 'moved';
    return performance.now() - start >= 4900 && 'still'; // 连续观察，跨过一个完整播放周期
  }, { start, index }, { polling: 35, timeout: 10000 });
  assert.equal(await result.jsonValue(), 'still', '阅读或按住时，海报和圆点均不应改变');
}

async function pointAt(page, locator) {
  const r = await locator.boundingBox();
  assert.ok(r && r.width > 0 && r.height > 0, '交互区域必须可见');
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  return r;
}

async function checkContact(h, page, openContact) {
  // 以此导航真正加载的公开配置为预期，不能根据按钮本身推断哪些按钮本来就不该出现。
  const response = await h.observe(page, 'GET', '/api/public/pages/contact', openContact);
  const { body } = await response.json();
  const card = body.services?.cards?.find(card => card.image_asset_url);
  const c = body.business_contact || {};
  h.require(card, '已发布样例缺少可放大的服务图');
  await checkNav(page, '联系我们');
  await page.getByRole('heading', { name: '服务与合作', exact: true }).waitFor();
  const first = page.locator('.service-list button img').first();
  await first.scrollIntoViewIfNeeded();
  const original = await imageMetrics(first);
  proportional(original, '服务图');
  assert.ok(original.src === new URL(card.image_asset_url, page.url()).href, '服务图应来自本次展示的服务卡');
  await first.click();
  const dialog = page.getByRole('dialog');
  await page.getByRole('dialog', { name: '图片预览', exact: true }).waitFor();
  const zoom = await imageMetrics(dialog.getByRole('img', { name: '放大的服务图片' }));
  proportional(zoom, '服务大图');
  assert.ok(zoom.src === original.src, '打开的是点击的服务图原图');
  const close = async () => {
    await dialog.getByRole('button', { name: '关闭弹层' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await checkNav(page, '联系我们');
  };
  await close();

  const qr = Boolean(c.qr_asset_url), wx = Boolean(c.wechat_id), tel = Boolean(c.phone), mail = Boolean(c.email);
  const channels = [qr, wx, tel, mail];
  h.require(channels.some(Boolean), '样例未发布任何联系渠道，不能验证双入口');
  h.require(channels.includes(false), '样例四种渠道全有，缺少验证隐藏空渠道的前提');
  assert.equal(await page.locator('.contact-card img').count(), Number(qr), '没有二维码时不能出现示意码');
  const snapshots = [];
  for (const entry of ['合作咨询', qr ? '查看二维码' : '查看联系方式']) {
    await page.getByRole('button', { name: entry, exact: true }).click();
    await page.getByRole('dialog', { name: '商务联系', exact: true }).waitFor();
    for (const [selector, enabled] of [['img.qr-image', qr], ['a[download]', qr], ['a[href^="tel:"]', tel], ['a[href^="mailto:"]', mail]]) {
      assert.equal(await dialog.locator(selector).count(), Number(enabled), `只呈现已配置渠道：${selector}`);
    }
    assert.equal(await dialog.getByRole('button', { name: '复制', exact: true }).count(), Number(wx), '未配置微信号时不提供复制');
    const text = await dialog.innerText();
    assert.equal(text.includes('微信号：'), wx);
    assert.equal(text.includes('电话：'), tel);
    assert.equal(text.includes('邮箱：'), mail);
    if (wx) assert.ok(text.includes(c.wechat_id), '微信号与发布资料不符');
    if (mail) assert.ok(await dialog.locator('a[href^="mailto:"]').getAttribute('href') === `mailto:${c.email}`, '邮件入口与发布资料不符');
    if (tel) assert.ok(await dialog.locator('a[href^="tel:"]').getAttribute('href') === `tel:${c.phone.replace(/[^\d+]/g, '')}`, '电话入口与发布资料不符');
    if (qr) {
      const image = await imageMetrics(dialog.locator('img.qr-image'));
      assert.ok(image.src === new URL(c.qr_asset_url, page.url()).href, '弹层与发布的二维码不符');
      assert.ok(await dialog.locator('a[download]').evaluate(a => a.href) === image.src, '保存入口与所示码图不一致');
    }
    snapshots.push(await dialog.evaluate(el => JSON.stringify([el.innerText.trim(), [...el.querySelectorAll('img,a')].map(e => e.src || e.href)])));
    await close();
  }
  assert.ok(snapshots[0] === snapshots[1], '两个联系入口必须展示相同的内容、图片和链接');
  return channels.filter(x => !x).length; // 不向报告输出微信号、电话、邮箱或二维码地址
}

export async function runPublic(h) {
  await h.runCase('PRD-01', async () => {
    const page = h.S;
    await visit(h, page, '/');
    await checkNav(page, '首页');
    await page.locator('.poster-track img').first().waitFor();
    const posters = page.locator('.poster-slide img');
    assert.equal(await posters.count(), 4, '样例应有四张海报');
    const images = await Promise.all((await posters.all()).map(imageMetrics));
    assert.equal(new Set(images.map(m => m.src)).size, 4, '四张有效的独立海报');
    assert.equal(await page.locator('main :is(header,h1,[role="banner"])').count(), 0, '不得恢复旧首页标题栏');
    assert.doesNotMatch(await page.locator('main').innerText(), /公司介绍|意向清单/);
    await navigate(page, '产品目录');
    await page.locator('.board-tabs button').first().waitFor();
    assert.deepEqual(await labels(page.locator('.board-tabs button')), Object.keys(categories));
    let sum = 0;
    for (const [board, names] of Object.entries(categories)) {
      await choose(page, '.board-tabs', board);
      const actual = await labels(page.locator('.category-rail button'));
      assert.deepEqual(actual, names.split('、'), `${board}的分类名称和顺序`);
      sum += actual.length;
    }
    assert.equal(sum, 43);
    await choose(page, '.board-tabs', '护肤');
    await choose(page, '.category-rail', '净澈清洁');
    await ready(page, '.catalog-results');
    const card = page.locator('.product-card').first();
    h.require(await card.count(), '样例净澈清洁没有已发布产品可打开');
    const name = (await card.locator('strong').innerText()).trim();
    await card.click();
    await page.locator('.detail-info h1').waitFor();
    assert.equal(await page.locator('.detail-label').innerText(), '产品名称');
    assert.ok(name && (await page.locator('.detail-info h1').innerText()).trim() === name, '详情名称必须与卡片一致');
    assert.deepEqual(await labels(page.locator('.detail-fields dt')), ['功效', '核心成分', '产品亮点', '配方编号', '是否生产过']);
    const values = await labels(page.locator('.detail-fields dd'));
    assert.equal(values.length, 5);
    assert.ok(values.every(v => v && !/^(?:—|待补充|复制)$/.test(v)), '五个字段必须有内容，不能用空值或复制按钮占位');
    assert.equal(await page.locator('.detail-view img').count(), 2, '详情仅一张封面和一张长图');
    assert.equal(await page.locator('.detail-long').count(), 1);
    const cover = await imageMetrics(page.locator('.detail-photo'));
    assert.ok(Math.abs(cover.height - cover.width * 9 / 16) <= 2, '详情封面为 16:9');
    proportional(await imageMetrics(page.locator('.detail-long')), '详情长图');
    assert.doesNotMatch(await page.locator('.detail-view').innerText(), /意向清单|加入购物车|立即购买/);
    await backToProducts(page);
    await navigate(page, '品牌案例'); await ready(page, '.case-results');
    await navigate(page, '联系我们'); await page.getByRole('heading', { name: '服务与合作' }).waitFor();
    return `四个入口按序访问，四张海报、五板块共 ${sum} 类；产品名称加五项资料和单张长图已核对。`;
  });

  await h.runCase('SAMPLE-CATALOG-MIX', async () => narrow(h, async page => {
    const meta = await h.observe(page, 'GET', '/api/public/catalog', () => visit(h, page, '/catalog'));
    const { nodes, counts } = await meta.json();
    const byParent = n => nodes.find(p => p.id === n.parent_id);
    const fine = nodes.find(n => n.level === 'subcategory' && counts[n.id] === 1 && counts[n.parent_id] === 3);
    h.require(fine, '样例没有父类三款且细类一款的已发布数据。该业务由隔离企业 PRD-12 使用真实 UI 新建的确定性数据验证。');
    const cat = byParent(fine), board = byParent(cat);
    await choose(page, '.board-tabs', board.name); await choose(page, '.category-rail', cat.name);
    await ready(page, '.catalog-results');
    const cards = page.locator('.product-card');
    const all = await labels(cards.locator('strong'));
    assert.equal(all.length, 3, '未细筛时应实际显示三款');
    await choose(page, '.fine-filters', fine.name); await ready(page, '.catalog-results');
    const verifyOne = async () => {
      assert.equal(await cards.count(), 1, '细筛结果只剩一款');
      assert.match(await page.locator('.catalog-results .category-total').innerText(), /^\s*3\s*款\s*$/);
      for (const [group, name] of [['.board-tabs', board.name], ['.category-rail', cat.name], ['.fine-filters', fine.name]]) {
        assert.equal(await page.locator(group).getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'true', '保留分类选择');
      }
    };
    await verifyOne();
    const name = (await cards.locator('strong').innerText()).trim();
    const other = all.find(n => n !== name);
    h.require(other, '缺少同板块但在当前细筛以外的具名产品');
    const rail = page.locator('.category-rail');
    const max = await rail.evaluate(el => el.scrollHeight - el.clientHeight);
    h.require(max > 0, '样例分类栏不足以验证非零返回位置');
    await rail.hover(); await page.mouse.wheel(0, max + 100);
    const restored = () => page.waitForFunction(y => Math.abs(document.querySelector('.category-rail').scrollTop - y) <= 1, max, { timeout: 5000 });
    await restored();
    await cards.click(); await page.locator('.detail-info h1').waitFor();
    assert.ok((await page.locator('.detail-info h1').innerText()).trim() === name);
    await backToProducts(page); await verifyOne(); await restored();
    assert.ok((await cards.locator('strong').innerText()).trim() === name, '返回后仍是同一款');
    await input(page).fill(other); await ready(page, '.catalog-results');
    assert.ok((await labels(cards.locator('strong'))).includes(other), '搜索需跨出当前细筛、命中本板块产品');
    assert.match(await page.locator('.filter-row [role="status"]').innerText(), /找到\s*[1-9]\d*\s*款/);
    assert.equal(await page.locator('.fine-filters:visible').count(), 0, '搜索时隐藏细筛');
    await page.getByRole('button', { name: '清空搜索', exact: true }).click(); await ready(page, '.catalog-results');
    assert.equal(await input(page).inputValue(), ''); await verifyOne();
    assert.ok((await cards.locator('strong').innerText()).trim() === name, '清空恢复原细筛结果');
    const outside = nodes.find(n => n.level === 'board' && n.id !== board.id && counts[n.id] === 0);
    h.require(outside, '缺少已知不含该产品的空板块作为独立负对照');
    await choose(page, '.board-tabs', outside.name); await ready(page, '.catalog-results');
    await input(page).fill(other); await ready(page, '.catalog-results');
    await page.getByText('没有找到相关产品', { exact: true }).waitFor();
    assert.match(await page.locator('.filter-row [role="status"]').innerText(), /找到\s*0\s*款/);
    assert.equal(await cards.count(), 0, '同关键词不能越板块命中');
    return `分类三款、细筛一款；详情返回保留选择和左栏 ${max}px 位置，板块内外同词正负对照、清空恢复均通过。`;
  }));

  await h.runCase('PUBLIC-CASE', async () => {
    const page = h.S;
    const header = await h.observe(page, 'GET', '/api/public/pages/cases', () => visit(h, page, '/cases'));
    const tags = (await header.json()).body.filters;
    await ready(page, '.case-results');
    if (await input(page).inputValue()) { await page.getByRole('button', { name: '清空案例搜索' }).click(); await ready(page, '.case-results'); }
    const response = await h.observe(page, 'GET', '/api/public/cases', () => choose(page, '.case-filters', '精选案例'));
    const collection = await response.json();
    // 用精选页实际加载的公开条目构造正、负对照，不能拿一个全站本来就没有的词证明范围正确。
    h.require(collection.items.length === collection.total && collection.total > 0 && tags?.length >= 2, '样例需有可核对的精选条目和至少两个具名案例筛选');
    const matches = (b, query) => ['brand_name', 'product_name', 'highlight', 'description'].some(k => String(b[k] || '').toLowerCase().includes(query.toLowerCase()));
    let probe;
    for (const { id, body } of collection.items) {
      const own = tags.find(tag => tag.key === body.category_key), word = body.product_name?.trim();
      if (!own || !word) continue;
      const hits = collection.items.filter(row => matches(row.body, word));
      const foreign = tags.find(tag => tag.key !== own.key && !hits.some(row => row.body.category_key === tag.key));
      if (foreign && hits.filter(row => row.body.category_key === own.key).length === 1) { probe = { id, own, foreign, word }; break; }
    }
    h.require(probe, '样例需有在本分类唯一命中、另一分类确实没有的案例');
    const tag = name => choose(page, '.case-filters', name);
    const search = async word => { await input(page).fill(word); await ready(page, '.case-results'); };
    const noGrid = async () => assert.equal(await page.locator('.case-grid:visible,.cases-grid-title:visible').count(), 0, '不足两条时不显示空网格或其标题');
    const isFeatured = async () => {
      assert.equal(await input(page).inputValue(), '');
      assert.equal(await page.getByRole('button', { name: '精选案例', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.case-card').count(), collection.total, '重置后恢复精选结果');
    };
    await tag(probe.own.label); await search(probe.word);
    assert.equal(await page.locator('.case-card').count(), 1); await noGrid();
    const featured = page.locator('.case-featured');
    assert.equal(new URL(await featured.getAttribute('href'), page.url()).searchParams.get('id'), String(probe.id));
    await featured.click(); await page.locator('.detail-info h1').waitFor();
    assert.ok((await page.locator('.detail-info h1').innerText()).trim() === probe.word);
    await page.getByRole('button', { name: '返回品牌案例' }).click(); await ready(page, '.case-results');
    await input(page).waitFor({ state: 'visible' });
    assert.equal(await input(page).inputValue(), probe.word, '从详情返回时，可见搜索框应恢复原关键词');
    assert.equal(await page.getByRole('button', { name: probe.own.label, exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.case-card').count(), 1, '从详情返回时仍只显示搜索命中的案例');
    await input(page).press('ControlOrMeta+a');
    const deleted = await h.observe(page, 'GET', '/api/public/cases', () => input(page).press('Backspace'));
    const query = new URL(deleted.url()).searchParams;
    assert.equal(query.get('q') || '', '', '手删空应实际移除请求中的关键词');
    assert.equal(query.get('tag'), probe.own.key, '手删空应继续在原分类内查询');
    await ready(page, '.case-results');
    assert.equal(await input(page).inputValue(), '');
    assert.equal(await page.getByRole('button', { name: probe.own.label, exact: true }).getAttribute('aria-pressed'), 'true', '手删空应保留当前分类');
    assert.equal(await page.locator('.case-card').count(), collection.items.filter(r => r.body.category_key === probe.own.key).length);
    for (const clear of ['清空案例搜索', '重新查找']) {
      await tag(probe.foreign.label); await search(probe.word);
      await page.getByText('没有找到相关案例', { exact: true }).waitFor();
      assert.equal(await page.locator('.case-card').count(), 0, '当前案例分类外的已知产品不得命中'); await noGrid();
      await page.getByRole('button', { name: clear, exact: true }).click(); await ready(page, '.case-results'); await isFeatured();
    }
    return '已知案例在所属筛选一条、另一筛选零条，均无空网格；实进详情并返回，手删空保留筛选，两个显式重置入口均回精选。';
  });

  await h.runCase('PUBLIC-CONTACT', async () => {
    const missing = await checkContact(h, h.S, () => visit(h, h.S, '/contact'));
    return `服务原图预览和关闭、两入口弹层内容一致；${missing} 个未配置渠道的对应操作未出现。`;
  });

  await h.runCase('PUBLIC-POSTER', async () => narrow(h, async page => {
    await visit(h, page, '/'); await checkNav(page, '首页');
    const first = await settledPoster(page);
    const dots = page.locator('.poster-dots button'), track = page.locator('.poster-track');
    assert.equal(await dots.count(), 4);
    const rect = await track.boundingBox(), dotsBox = await page.locator('.poster-dots').boundingBox(), navBox = await nav(page).boundingBox();
    assert.ok(Math.abs(rect.width - 360) <= 1 && dotsBox.y >= rect.y + rect.height - 2 && dotsBox.y + dotsBox.height <= navBox.y + 2, '海报全宽，圆点在海报和底部导航之间');
    const m = await imageMetrics(page.locator('.poster-slide img').nth(first.index)); proportional(m, '首页海报');
    assert.ok(Math.abs(m.width - rect.width) <= 1, '原图按轨道全宽展示');
    h.require(await page.evaluate(() => !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches), '前台且允许动效才能测量正常播放周期');
    // 丢弃打开页面后的不完整首周期，在两次真正到位的自然切换之间量时。
    const start = await settledPoster(page, (first.index + 1) % 4);
    const end = await settledPoster(page, (start.index + 1) % 4);
    const elapsed = Math.round(end.at - start.at);
    assert.ok(Math.abs(elapsed - 4000) <= 700, `自然轮播实测 ${elapsed} ms，预期约 4 秒（±700 ms 测量余量）`);
    await pointAt(page, track); await page.mouse.down();
    try { await staysOnPoster(page, end.index); } finally { await page.mouse.up(); }
    const resumed = await settledPoster(page, (end.index + 1) % 4);
    const manual = resumed.index === 2 ? 1 : 2;
    await dots.nth(manual).click(); await settledPoster(page, manual, 2500);
    await pointAt(page, track); await page.mouse.wheel(-rect.width, 0); await settledPoster(page, manual - 1, 2500);
    return `前台相邻自然切换实测 ${elapsed} ms；连续按住 4.9 秒未动，松开后自动前进。点击圆点和水平滚动均核对了实际图片位置。`;
  }));

  await h.runCase('MOBILE-VIEWPORT', async () => narrow(h, async page => {
    await visit(h, page, '/'); await checkNav(page, '首页');
    const { index } = await settledPoster(page);
    const slide = page.locator('.poster-slide').nth(index), track = page.locator('.poster-track');
    const m = await imageMetrics(slide.locator('img')); proportional(m, '窄屏长海报');
    const distance = await slide.evaluate(el => el.scrollHeight - el.clientHeight);
    h.require(distance > 3, '样例当前海报在窄屏可用区内没有纵向长内容');
    const before = await nav(page).boundingBox(); await pointAt(page, track); await page.mouse.wheel(0, distance + 100);
    const scrollEquals = y => page.waitForFunction(({ i, y }) => Math.abs(document.querySelectorAll('.poster-slide')[i].scrollTop - y) <= 1, { i: index, y }, { timeout: 5000 });
    await scrollEquals(distance); await staysOnPoster(page, index); await checkNav(page, '首页');
    assert.ok(Math.abs((await nav(page).boundingBox()).y - before.y) <= 1, '阅读海报时导航不能跟随图片移动');
    await page.mouse.wheel(0, -distance - 100); await scrollEquals(0);
    await settledPoster(page, (index + 1) % await page.locator('.poster-dots button').count());
    await navigate(page, '产品目录'); await ready(page, '.catalog-results');
    await navigate(page, '品牌案例'); await ready(page, '.case-results');
    const missing = await checkContact(h, page, () => navigate(page, '联系我们'));
    assert.ok(await page.evaluate(() => innerWidth === 360 && document.documentElement.scrollWidth <= innerWidth + 1), '窄屏内容不得撑宽页面');
    await navigate(page, '首页'); await page.locator('.poster-track img').first().waitFor();
    return `Chrome 360×520 窄屏模拟：纵读 ${distance}px 暂停，回顶续播，导航固定；四页切换、服务大图、联系弹层及 ${missing} 个缺项已核。非真机。`;
  }));

  await h.runCase('PRD-18', async () => {
    h.require(false, '未接入真实窄屏手机；MOBILE-VIEWPORT 是独立的浏览器模拟，不证明真机触控、安全区或系统行为。');
  });
}
