import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Run the real H5 build with only synthetic, intercepted responses. No server or database is required.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const bundle = new URL('../h5/dist/build/h5/', import.meta.url);
const site = 'https://showcase.test';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR42mNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=', 'base64');
const tallImage = '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="1200"><rect width="100%" height="100%" fill="lightblue"/></svg>';
const media = id => `/api/public/media/${id}`;
const posterPaths = [media(1), media(2), media(3)];
const cover = media(8);
const longPaths = [media(9), media(10), media(11)];
const square = media(12);
const thumbnail = `${square}/thumbnail`;
const generatedCatalog = `${cover}/catalog-thumbnail`;
const caseImage = media(13);
const caseThumbnail = `${caseImage}/display-thumbnail`;
const catalogBanner = media(14);
const bannerThumbnail = `${catalogBanner}/display-thumbnail`;
const privateMedia = id => `/api/admin/media/${id}?item_id=1&revision=2`;
const product = { id: '1', body: {
  name: '验证用产品', benefit: '用于留出真实滚动的图文详情。'.repeat(240),
  cover_asset_url: cover, detail_asset_urls: longPaths,
} };
const listing = { id: '1', body: {
  name: product.body.name, catalog_image_url: square, cover_asset_url: square, cover_thumbnail_url: thumbnail,
  catalog_thumbnail_url: generatedCatalog,
} };

function holdResponse() {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  return { pending, release };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 520 } });
const imageRequests = [];
let posterOne = holdResponse();
const posterTwo = holdResponse();
let failThumbnail = false;
let failGeneratedCatalog = false;
let failSquare = false;
let failPosters = false;
const api = {
  '/api/public/pages/home': { page: 'home', body: { poster_asset_urls: posterPaths } },
  '/api/public/pages/catalog': { page: 'catalog', body: {} },
  '/api/public/catalog': { nodes: [{ id: '1', parent_id: null, level: 'board', name: '护肤' }], counts: { 1: 1 } },
  '/api/public/products': { items: [listing], total: 1, page: 1, page_size: 20 },
  '/api/public/products/1': product,
  '/api/public/pages/cases': { page: 'cases', body: {} },
  '/api/public/cases': { items: [{ id: '1', body: {
    brand_name: '验证用案例', image_asset_url: caseImage, image_thumbnail_url: caseThumbnail,
  } }], total: 1, page: 1, page_size: 20 },
  '/api/public/cases/1': { id: '1', body: { brand_name: '验证用案例', image_asset_url: caseImage } },
  '/api/admin/items/1/preview': { id: '1', revision: '2', kind: 'product', config_slot: null, place_ids: [], body: {
    name: '验证用预览', thumbnail_asset_id: '12', cover_asset_id: '8', detail_asset_ids: ['9', '10', '11'],
  }, media_urls: Object.fromEntries([8, 9, 10, 11, 12].map(id => [id, privateMedia(id)])) },
};

try {
  await page.route('**/*', async route => {
    const { origin, pathname } = new URL(route.request().url());
    if (origin !== site) return route.abort();
    if (api[pathname]) return route.fulfill({ json: api[pathname] });
    if (/^\/api\/(?:public|admin)\/media\//.test(pathname)) {
      imageRequests.push(pathname);
      if (pathname === media(1)) await posterOne.pending;
      if (pathname === media(2)) await posterTwo.pending;
      if (pathname === thumbnail && failThumbnail) return route.fulfill({ status: 404 });
      if (pathname === generatedCatalog && failGeneratedCatalog) return route.fulfill({ status: 404 });
      if (pathname === square && failSquare) return route.fulfill({ status: 404 });
      if (posterPaths.includes(pathname)) {
        if (failPosters) return route.fulfill({ status: 404 });
        return route.fulfill({ contentType: 'image/svg+xml', headers: { 'Cache-Control': 'no-store' }, body: tallImage });
      }
      if (longPaths.includes(pathname)) return route.fulfill({ contentType: 'image/svg+xml', body: tallImage });
      return route.fulfill({ contentType: 'image/png', headers: { 'Cache-Control': 'no-store' }, body: image });
    }
    if (pathname.startsWith('/assets/')) return route.fulfill({ path: fileURLToPath(new URL(pathname.slice(1), bundle)) });
    return route.fulfill({ contentType: 'text/html', body: await readFile(new URL('index.html', bundle)) });
  });

  await page.goto(site, { waitUntil: 'domcontentloaded' });
  const dots = page.locator('.poster-dots button');
  await dots.first().waitFor();
  await page.waitForTimeout(150);
  assert.deepEqual(imageRequests, [media(1)], '首张未加载完成时只有其原图请求');
  const secondRequest = page.waitForRequest(`${site}${media(2)}`);
  posterOne.release();
  await secondRequest;
  await page.waitForTimeout(4200);
  assert.equal(await dots.first().getAttribute('aria-current'), 'true', '下一张仍在请求时不得自动切换');
  assert.deepEqual(imageRequests, [media(1), media(2)], '只预取一张');
  const firstSlide = page.locator('.poster-slide').first();
  await firstSlide.evaluate(slide => { slide.scrollTop = 160; });
  await page.waitForFunction(() => document.querySelector('.poster-slide')?.scrollTop >= 100);
  posterTwo.release();
  await page.locator('.poster-slide').nth(1).locator('img').evaluate(node => node.decode());
  await page.waitForTimeout(4200);
  assert.equal(await dots.first().getAttribute('aria-current'), 'true', '长图阅读期间继续暂停');
  await firstSlide.evaluate(slide => { slide.scrollTop = 0; });
  const thirdRequest = page.waitForRequest(`${site}${media(3)}`);
  await page.waitForFunction(() => document.querySelectorAll('.poster-dots button')[1]?.getAttribute('aria-current') === 'true');
  await thirdRequest;
  await dots.nth(2).click();
  await page.waitForFunction(() => {
    const track = document.querySelector('.poster-track');
    const active = document.querySelectorAll('.poster-dots button')[2];
    return active?.getAttribute('aria-current') === 'true' && Math.abs(track.scrollLeft - 2 * track.clientWidth) <= 2;
  });

  failPosters = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  const posterError = page.getByRole('alert').filter({ hasText: '海报加载失败' });
  await posterError.waitFor();
  failPosters = false;
  await posterError.getByRole('button', { name: '重试' }).click();
  await page.locator('.poster-track img').first().evaluate(node => node.decode());

  posterOne = holdResponse();
  imageRequests.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await dots.first().waitFor();
  const manualRequest = page.waitForRequest(`${site}${media(3)}`, { timeout: 2500 });
  await dots.nth(2).click();
  await manualRequest;
  await page.locator('.poster-slide').nth(2).locator('img').evaluate(node => node.decode());
  assert.deepEqual(imageRequests, [media(1), media(3)], '手动翻页可在首张仍下载时立即加载目标原图');
  posterOne.release();

  imageRequests.length = 0;
  await page.goto(`${site}/catalog`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('img.product-thumb').first();
  await card.evaluate(node => node.decode());
  assert.equal(await card.getAttribute('src'), thumbnail);
  assert.equal(await card.evaluate(node => getComputedStyle(node).objectFit), 'contain');
  assert.deepEqual(imageRequests, [thumbnail], '目录只请求由独立方图生成的缩略图');

  imageRequests.length = 0;
  failThumbnail = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(expected => document.querySelector('.product-thumb')?.getAttribute('src') === expected, square);
  await card.evaluate(node => node.decode());
  assert.deepEqual(imageRequests, [thumbnail, square], '缩略图失败只回退独立方图原图');

  imageRequests.length = 0;
  failSquare = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.product-thumb.no-image').waitFor();
  assert.deepEqual(imageRequests, [thumbnail, square], '方图原图失败后展示占位，不尝试宽封面');
  failSquare = false;

  imageRequests.length = 0;
  delete listing.body.catalog_image_url;
  delete listing.body.catalog_thumbnail_url;
  listing.body.cover_asset_url = cover;
  listing.body.cover_thumbnail_url = `${cover}/thumbnail`;
  listing.body.thumbnail_asset_url = cover;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.product-thumb.no-image').waitFor();
  assert.deepEqual(imageRequests, [], '旧 API 的封面别名和宽图派生不用于目录');

  imageRequests.length = 0;
  listing.body.thumbnail_asset_url = square;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await card.evaluate(node => node.decode());
  assert.deepEqual(imageRequests, [square], '旧版 API 真实的独立缩略图可继续展示');

  imageRequests.length = 0;
  listing.body.thumbnail_asset_url = cover;
  listing.body.catalog_thumbnail_url = generatedCatalog;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await card.evaluate(node => node.decode());
  assert.deepEqual(imageRequests, [generatedCatalog], '旧产品只请求生成后的目录缩略图');

  imageRequests.length = 0;
  failGeneratedCatalog = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.product-thumb.no-image').waitFor();
  assert.deepEqual(imageRequests, [generatedCatalog], '生成后的目录缩略图缺失时直接展示占位');

  imageRequests.length = 0;
  listing.body.catalog_thumbnail_url = `${generatedCatalog}?v=1`;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.product-thumb.no-image').waitFor();
  assert.deepEqual(imageRequests, [], '生成缩略图只接受规范公开路径');

  imageRequests.length = 0;
  await page.goto(`${site}/products?id=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('.detail-photo').evaluate(node => node.decode());
  assert.deepEqual(imageRequests, [cover], '远离视口的详情长图不在首屏下载');
  const slots = page.locator('.detail-long-slot');
  assert.equal(await slots.count(), 3);
  for (const [index, expected] of longPaths.entries()) {
    await slots.nth(index).evaluate(node => window.scrollBy(0, node.getBoundingClientRect().top - innerHeight + 100));
    const shown = slots.nth(index).locator('.detail-long');
    await shown.evaluate(node => node.decode());
    assert.equal(await shown.getAttribute('src'), expected);
    assert.deepEqual(imageRequests, [cover, ...longPaths.slice(0, index + 1)], '详情图片按各自视口位置请求，保留顺序和原图');
  }

  imageRequests.length = 0;
  delete product.body.detail_asset_urls;
  product.body.detail_asset_url = longPaths[0];
  await page.goto(`${site}/products?id=1`, { waitUntil: 'domcontentloaded' });
  await slots.first().scrollIntoViewIfNeeded();
  await page.locator('.detail-long').evaluate(node => node.decode());
  assert.deepEqual(imageRequests, [cover, longPaths[0]], '旧单图详情仍加载原图');

  imageRequests.length = 0;
  api['/api/public/pages/catalog'].body = { cover_asset_url: catalogBanner, cover_thumbnail_url: bannerThumbnail };
  await page.goto(`${site}/catalog`, { waitUntil: 'domcontentloaded' });
  await page.locator('.catalog-cover img').evaluate(node => node.decode());
  assert.deepEqual(imageRequests, [bannerThumbnail], '目录顶部请求等比缩小的展示图');

  imageRequests.length = 0;
  await page.goto(`${site}/cases`, { waitUntil: 'domcontentloaded' });
  await page.locator('.case-featured img').evaluate(node => node.decode());
  assert.deepEqual(imageRequests, [caseThumbnail], '案例列表只请求展示缩略图');
  imageRequests.length = 0;
  await page.goto(`${site}/cases/detail?id=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('.detail-photo').evaluate(node => node.decode());
  assert.deepEqual(imageRequests, [caseImage], '案例详情继续请求原图');

  await page.goto(`${site}/preview?id=1&revision=2&mode=card`, { waitUntil: 'domcontentloaded' });
  await card.evaluate(node => node.decode());
  assert.equal(await card.getAttribute('src'), privateMedia(12), '草稿卡片展示授权的独立方图');
  await page.goto(`${site}/preview?id=1&revision=2`, { waitUntil: 'domcontentloaded' });
  await page.locator('.detail-long').last().waitFor();
  assert.equal(await page.locator('.detail-photo').getAttribute('src'), privateMedia(8));
  assert.deepEqual(await page.locator('.detail-long').evaluateAll(nodes => nodes.map(node => node.getAttribute('src'))),
    [9, 10, 11].map(privateMedia), '草稿详情保留授权原图、顺序和立即挂载');
  console.log('H5 homepage, catalog and case variants, original detail images, and private previews passed.');
} finally {
  posterOne.release();
  posterTwo.release();
  await browser.close();
}
