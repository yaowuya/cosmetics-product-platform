const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname,'..');
const read = file => readFileSync(resolve(root,file),'utf8');
const json = file => JSON.parse(read(file));

test('native tabs ship local PNG icons for both selection states', () => {
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  for (const { text, iconPath, selectedIconPath } of json('app.json').tabBar.list) {
    assert.match(iconPath || '', /^assets\/tab-bar\/.+\.png$/, text);
    assert.match(selectedIconPath || '', /^assets\/tab-bar\/.+\.png$/, text);
    assert.notEqual(iconPath,selectedIconPath,text);
    for (const path of [iconPath, selectedIconPath]) {
      const image = readFileSync(resolve(root,path));
      assert.deepEqual(image.subarray(0,8),signature,path);
      assert.ok(image.length <= 40 * 1024,path);
    }
  }
});

test('product details eagerly display the cover and lazily load each original gallery image', () => {
  const template = read('pages/product/index.wxml');
  const cover = template.match(/<image\b[^>]+src="\{\{detail\.image\}\}"[^>]*>/)?.[0] || '';
  const longImage = template.match(/<image\b[^>]+src="\{\{item\}\}"[^>]*>/)?.[0] || '';
  assert.ok(cover);
  assert.doesNotMatch(cover,/\blazy-load\b/);
  assert.match(template,/wx:for="\{\{detail\.gallery\}\}"/);
  assert.match(longImage,/\blazy-load="\{\{true\}\}"/);
  assert.match(longImage,/\bmode="widthFix"/);
});

test('catalog renders both directory image variants as white square contain', () => {
  const template = read('pages/catalog/index.wxml');
  for (const source of ['thumbnail','image']) {
    const binding = `src="{{item.${source}}}"`;
    const image = template.match(/<image\b[^>]+class="product-thumb"[^>]*>/g)?.find(tag => tag.includes(binding)) || '';
    assert.match(image,/\bmode="aspectFit"/);
  }
  assert.match(read('pages/catalog/index.wxss'),/image\.product-thumb\s*\{[^}]*background:\s*#fff\b/);
});

test('project imports as six native pages with four tab entries, without package dependencies', () => {
  const config = json('project.config.example.json');
  assert.equal(config.appid,'touristappid');
  assert.equal(config.compileType,'miniprogram');
  assert.equal(config.miniprogramRoot,'./');
  assert.equal(config.setting.urlCheck,true);
  assert.deepEqual(Object.keys(json('package.json').dependencies || {}),[]);
  const app = json('app.json');
  assert.deepEqual(app.pages.map(route=>route.split('/')[1]),['home','catalog','product','cases','case','contact']);
  assert.deepEqual(app.tabBar.list.map(item=>item.text),['首页','产品目录','品牌案例','联系我们']);
  assert.deepEqual(app.tabBar.list.map(item=>item.pagePath),[app.pages[0],app.pages[1],app.pages[3],app.pages[5]]);
  for (const route of app.pages) {
    assert.equal(existsSync(resolve(root,`${route}.js`)),true,route);
    assert.equal(existsSync(resolve(root,`${route}.wxss`)),true,route);
    assert.ok(json(`${route}.json`).navigationBarTitleText,route);
    const wxml = read(`${route}.wxml`);
    assert.doesNotMatch(wxml,/<web-view\b/);
    let registered;
    const savedPage = global.Page;
    global.Page = definition => { registered = definition; };
    try { require(resolve(root,`${route}.js`)); } finally {
      delete require.cache[resolve(root,`${route}.js`)];
      if (savedPage === undefined) delete global.Page;
      else global.Page = savedPage;
    }
    assert.ok(registered,route);
    for (const [,handler] of wxml.matchAll(/\b(?:bind|catch):?[a-z]+="([\w]+)"/g)) {
      assert.equal(typeof registered[handler],'function',`${route}: ${handler}`);
    }
  }
});
