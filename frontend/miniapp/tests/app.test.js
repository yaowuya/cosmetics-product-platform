const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname,'..');
const read = file => readFileSync(resolve(root,file),'utf8');
const json = file => JSON.parse(read(file));

test('project imports as six native pages with four tab entries, without package dependencies', () => {
  const config = json('project.config.json');
  assert.equal(config.compileType,'miniprogram');
  assert.equal(config.miniprogramRoot,'./');
  assert.notEqual(config.setting.urlCheck,false);
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
