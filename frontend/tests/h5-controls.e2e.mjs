import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// This read-only smoke test needs a local instance with published posters, categories and case filters.
const origin = new URL(process.argv[2]);
assert.ok(origin.protocol === 'https:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'zh-CN', ignoreHTTPSErrors: true });
  for (const [route, selector, expectedHeight] of [
    ['/', '.poster-dots button', 26], ['/catalog', '.category-rail button', 48], ['/cases', '.case-filters button', 29],
  ]) {
    await page.goto(new URL(route, origin).href);
    const control = page.locator(selector).first();
    await control.waitFor();
    assert.equal(await control.evaluate(el => getComputedStyle(el).borderTopWidth), '0px', `${selector}: browser-default border`);
    assert.equal(Math.round((await control.boundingBox()).height), expectedHeight, `${selector}: hit area`);
    if (route === '/catalog') {
      assert.equal(await page.locator('.board-tabs button').first().evaluate(el => getComputedStyle(el).flexDirection), 'column');
    }
    if (route === '/cases') {
      const bar = page.locator('.cases-tools .h5-search');
      const search = bar.locator('input');
      assert.equal(Math.round((await bar.boundingBox()).height), 34, '案例搜索栏高度');
      assert.equal(await search.evaluate(el => getComputedStyle(el).borderTopWidth), '0px', '案例输入不应带浏览器默认的内框');
      assert.equal(Math.round((await search.boundingBox()).height), 32, '案例输入区域保留设计稿高度');
      const next = page.locator('.case-filters button').nth(1);
      await next.focus();
      await page.keyboard.press('Enter');
      assert.equal(await next.getAttribute('aria-pressed'), 'true');
      assert.equal(await next.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(78, 139, 219)');
    }
  }
  console.log('H5 native controls: poster and filter sizes, active state and keyboard selection passed.');
} finally {
  await browser.close();
}
