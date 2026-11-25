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
const long = media(9);
const thumbnail = `${cover}/thumbnail`;
const product = { id: '1', body: {
  name: '验证用产品', benefit: '用于留出真实滚动的图文详情。'.repeat(240),
  cover_asset_url: cover, detail_asset_url: long, cover_thumbnail_url: thumbnail,
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
let failPosters = false;
const api = {
  '/api/public/pages/home': { page: 'home', body: { poster_asset_urls: posterPaths } },
  '/api/public/pages/catalog': { page: 'catalog', body: {} },
  '/api/public/catalog': { nodes: [{ id: '1', parent_id: null, level: 'board', name: '护肤' }], counts: { 1: 1 } },
  '/api/public/products': { items: [product], total: 1, page: 1, page_size: 20 },
  '/api/public/products/1': product,
};

try {
  await page.route('**/*', async route => {
    const { origin, pathname } = new URL(route.request().url());
    if (origin !== site) return route.abort();
    if (api[pathname]) return route.fulfill({ json: api[pathname] });
    if (pathname.startsWith('/api/public/media/')) {
      imageRequests.push(pathname);
      if (pathname === media(1)) await posterOne.pending;
      if (pathname === media(2)) await posterTwo.pending;
      if (pathname === thumbnail && failThumbnail) return route.fulfill({ status: 404 });
      if (posterPaths.includes(pathname)) {
        if (failPosters) return route.fulfill({ status: 404 });
        return route.fulfill({ contentType: 'image/svg+xml', headers: { 'Cache-Control': 'no-store' }, body: tallImage });
      }
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
  const card = page.locator('.product-thumb').first();
  await card.evaluate(node => node.decode());
  assert.equal(await card.getAttribute('src'), thumbnail);
  assert.deepEqual(imageRequests, [thumbnail], '目录有缩略图时不下载封面原图');

  imageRequests.length = 0;
  failThumbnail = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(expected => document.querySelector('.product-thumb')?.getAttribute('src') === expected, cover);
  await card.evaluate(node => node.decode());
  assert.deepEqual(imageRequests, [thumbnail, cover], '目录缩略图失败时回退原图一次');

  imageRequests.length = 0;
  delete product.body.cover_thumbnail_url;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await card.evaluate(node => node.decode());
  assert.deepEqual(imageRequests, [cover], '旧版 API 可继续展示封面原图');

  imageRequests.length = 0;
  await page.goto(`${site}/products?id=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('.detail-photo').evaluate(node => node.decode());
  assert.deepEqual(imageRequests, [cover], '远离视口的详情长图不在首屏下载');
  await page.locator('.detail-long-slot').scrollIntoViewIfNeeded();
  await page.locator('.detail-long').evaluate(node => node.decode());
  assert.deepEqual(imageRequests, [cover, long], '长图接近视口后请求原图');
  console.log('H5 homepage image order, catalog fallback, and detail lazy loading passed.');
} finally {
  posterOne.release();
  posterTwo.release();
  await browser.close();
}
