const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const publicApi = require('../lib/public-api');
const id = '9007199254740999';
const response = (page, ids, total = ids.length) => ({ page, page_size:20, total, items:ids.map(value => ({id:value,body:{name:`产品${value}`,brand_name:`案例${value}`}})) });
const event = dataset => ({ currentTarget:{dataset} });

function harness(route, decide, overrides = {}) {
  const calls = [], actions = [];
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram:{envVersion:'develop'} }),
    request(options) {
      const url = new URL(options.url);
      calls.push(url);
      Promise.resolve().then(() => decide(url)).then(result => {
        if (result instanceof Error) options.fail();
        else if (typeof result === 'number') options.success({statusCode:result,data:{}});
        else options.success({statusCode:200,data:result});
      },() => options.fail());
    },
    navigateTo: options => actions.push(['navigateTo',options.url]),
    navigateBack: options => { actions.push(['navigateBack',options.delta]); options.fail(); },
    switchTab: options => actions.push(['switchTab',options.url]),
    pageScrollTo: () => {}, stopPullDownRefresh: () => {},
    setClipboardData: options => { actions.push(['clipboard',options.data]); options.fail(); },
    showToast: options => actions.push(['toast',options.title]),
    makePhoneCall: options => actions.push(['phone',options.phoneNumber]),
    previewImage: options => actions.push(['preview',options.current]),
    ...overrides,
  };
  let page;
  global.Page = definition => {
    page = {...definition,data:structuredClone(definition.data),setData(patch,after) {
      // Support mini-program data-path patches without depending on the WXML runtime.
      for (const [key,value] of Object.entries(patch)) {
        const segments = key.replace(/\[(\d+)\]/g,'.$1').split('.');
        let target = this.data;
        for (const part of segments.slice(0,-1)) target = target[part];
        target[segments.at(-1)] = value;
      }
      if (after) after();
    }};
  };
  const script = resolve(__dirname,'../pages',route,'index.js');
  delete require.cache[script];
  const original = publicApi.pageApi;
  // Inject a test origin only for the page registration, then restore the production export.
  publicApi.pageApi = platform => publicApi.createPublicApi({ origin:'https://published.example.cn', request: options => platform.request(options) });
  try { require(script); } finally { publicApi.pageApi = original; }
  return { page,calls,actions };
}

function directory(url) {
  if (url.pathname.endsWith('/pages/catalog')) return {page:'catalog',body:{slogan_top:'精选'}};
  if (url.pathname.endsWith('/catalog')) return { nodes:[
    {id:'1',parent_id:null,level:'board',name:'护肤'}, {id:'2',parent_id:'1',level:'category',name:'霜'},
    {id:'3',parent_id:'2',level:'subcategory',name:'面霜'}, {id:'4',parent_id:null,level:'board',name:'身体'},
  ], counts:{'1':21,'2':21,'3':2,'4':1} };
  const page = Number(url.searchParams.get('page'));
  if (url.searchParams.get('board_id') === '4') return response(page,['44']);
  return response(page,page === 1 ? Array.from({length:20},(_,i)=>String(100+i)) : [id],21);
}

test('catalog keeps appended rows and scroll on tab-detail return and board round-trip', async () => {
  const { page,calls,actions } = harness('catalog',directory);
  await page.onLoad();
  assert.equal(page.data.category,'2');
  assert.equal(page.data.count,21);
  await page.onLoadMore();
  assert.equal(page.data.items.length,21);
  page.onRightScroll({detail:{scrollTop:470}});
  page.onOpenProduct(event({id}));
  assert.deepEqual(actions.at(-1),['navigateTo',`/pages/product/index?id=${id}`]);
  const before = calls.length;
  if (page.onShow) page.onShow();
  assert.equal(calls.length,before);
  await page.onBoard(event({id:'4'}));
  await page.onBoard(event({id:'1'}));
  assert.equal(calls.length,before+1);
  assert.equal(page.data.items.length,21);
  assert.equal(page.data.rightTop,470);
  await page.onFine(event({id:'3'}));
  assert.equal(calls.at(-1).searchParams.get('node_id'),'3');
  await page.onSearch({detail:{value:' 晚霜 '}});
  assert.equal(calls.at(-1).searchParams.get('node_id'),null);
  assert.equal(calls.at(-1).searchParams.get('q'),'晚霜');
  page.onUnload();
});

test('catalog treats whitespace as category browsing while retaining the text being typed', async () => {
  const { page,calls } = harness('catalog',directory);
  await page.onLoad();
  await page.onFine(event({id:'3'}));
  await page.onSearch({detail:{value:' 晚霜 '}});
  assert.equal(page.data.searchActive,true);
  await page.onSearch({detail:{value:' \u3000'}});
  assert.equal(page.data.q,' \u3000');
  assert.equal(page.data.searchActive,false);
  assert.equal(calls.at(-1).searchParams.get('node_id'),'3');
  assert.equal(calls.at(-1).searchParams.has('q'),false);
  page.onUnload();
});

test('catalog uses bundled board icons and falls back when the current upload fails', async () => {
  let uploaded = '/api/public/media/61';
  const names = ['护肤','冻干','二类','洗护','外贸','其他'];
  const { page } = harness('catalog', url => {
    if (!url.pathname.endsWith('/catalog') || url.pathname.endsWith('/pages/catalog')) return directory(url);
    return { nodes:names.map((name,index) => ({
      id:String(index+1), parent_id:null, level:'board', name, icon_url:index === 0 ? uploaded : '',
    })), counts:{} };
  });
  await page.onLoad();
  const oldUpload = `https://published.example.cn${uploaded}`;
  assert.equal(page.data.boards[0].displayIcon,oldUpload);
  assert.deepEqual(page.data.boards.slice(1).map(board => board.displayIcon),
    ['snowflake','shield','bubbles','globe','briefcase'].map(name => `/assets/catalog/${name}.png`));

  uploaded = '/api/public/media/62';
  await page.onRefresh();
  const currentUpload = `https://published.example.cn${uploaded}`;
  page.onBoardIconError(event({id:'1',src:oldUpload}));
  assert.equal(page.data.boards[0].displayIcon,currentUpload);
  page.onBoardIconError(event({id:'1',src:currentUpload}));
  assert.equal(page.data.boards[0].displayIcon,'/assets/catalog/droplets.png');
  assert.equal(page.data.boards[0].icon,currentUpload);
  page.onUnload();
});

test('catalog ignores media errors from a previous published image', async () => {
  let media = '1';
  const { page } = harness('catalog', url => {
    if (url.pathname.endsWith('/pages/catalog')) return {page:'catalog',body:{cover_asset_url:`/api/public/media/${media}`}};
    if (url.pathname.endsWith('/catalog')) return directory(url);
    return {items:[{id,body:{name:'面霜',cover_asset_url:`/api/public/media/${media}`}}],total:1,page:1,page_size:20};
  });
  await page.onLoad();
  const stale = page.data.cover.image;
  media = '2';
  await page.onRefresh();
  page.onCoverError(event({src:stale}));
  page.onImageError(event({id,src:stale}));
  assert.equal(page.data.coverFailed,false);
  assert.equal(page.data.broken[id],undefined);
  const current = page.data.cover.image;
  page.onCoverError(event({src:current}));
  page.onImageError(event({id,src:current}));
  assert.equal(page.data.coverFailed,true);
  assert.equal(page.data.broken[id],current);
  page.onUnload();
});

test('product re-reads the current publication and never substitutes the previous detail for 404', async () => {
  let live = true;
  const { page,calls,actions } = harness('product', () => live ? {id,body:{name:'面霜',formula_no:'A-44'}} : 404);
  await page.onLoad({id});
  assert.equal(page.data.detail.formula,'A-44');
  page.onCopyFormula();
  assert.equal(page.data.fallback,'A-44');
  live = false;
  await page.onRetry();
  assert.equal(page.data.phase,'missing');
  assert.equal(page.data.detail,null);
  assert.equal(calls.length,2);
  page.onBack();
  assert.deepEqual(actions.at(-1),['switchTab','/pages/catalog/index']);
  page.onUnload();
});

test('cases request current tags, append in order, and retain tab state when opening detail', async () => {
  const { page,calls,actions } = harness('cases', url => {
    if (url.pathname.endsWith('/pages/cases')) return { page:'cases', body:{title:'案例集',filters:[{key:'lab',label:'实验室'}]} };
    const number = Number(url.searchParams.get('page'));
    return response(number,number === 1 ? Array.from({length:20},(_,i)=>String(200+i)) : [id],21);
  });
  await page.onLoad();
  await page.onSearch({detail:{value:' \u3000'}});
  assert.equal(page.data.searchActive,false);
  assert.equal(calls.at(-1).searchParams.has('q'),false);
  await page.onSelectTag(event({tag:'lab'}));
  assert.equal(calls.at(-1).searchParams.get('tag'),'lab');
  await page.onSearch({detail:{value:'品牌'}});
  assert.equal(page.data.searchActive,true);
  assert.equal(calls.at(-1).searchParams.get('q'),'品牌');
  await page.onLoadMore();
  assert.equal(page.data.items.length,21);
  assert.equal(page.data.items[0].id,'200');
  page.onOpenCase(event({id}));
  assert.deepEqual(actions.at(-1),['navigateTo',`/pages/case/index?id=${id}`]);
  const before = calls.length;
  if (page.onShow) page.onShow();
  assert.equal(calls.length,before);
  assert.equal(page.data.tag,'lab');
  await page.onClear();
  assert.equal(calls.at(-1).searchParams.get('tag'),null);
  assert.equal(calls.at(-1).searchParams.get('q'),null);
  page.onUnload();
});

test('case distinguishes retryable connection errors from withdrawn detail', async () => {
  let outcome = new Error('offline');
  const { page,calls,actions } = harness('case', () => outcome);
  await page.onLoad({id});
  assert.equal(page.data.phase,'error');
  outcome = 404;
  await page.onRetry();
  assert.equal(page.data.phase,'missing');
  assert.equal(page.data.detail,null);
  await page.onRetry();
  assert.equal(calls.length,2);
  page.onBack();
  assert.deepEqual(actions.at(-1),['switchTab','/pages/cases/index']);
  page.onUnload();
});

test('home rotates only while idle at the top and drops broken posters without reviving stale images', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const poster = number => `/api/public/media/${number}`;
  const { page } = harness('home', () => ({page:'home',body:{poster_asset_urls:[poster(1),poster(2)]}}));
  await page.onLoad();
  page.onShow();
  assert.equal(page.data.phase,'ready');
  assert.equal(page.data.posters.length,2);
  const posterEvent = (index, scrollTop) => ({ ...event({src:page.data.posters[index],version:page.data.posterVersion}), detail:{scrollTop} });
  page.onPosterScroll(posterEvent(0,120));
  t.mock.timers.tick(4001);
  assert.equal(page.data.current,0);
  page.onPosterScroll(posterEvent(0,0));
  page.onTouchStart();
  t.mock.timers.tick(4001);
  assert.equal(page.data.current,0);
  page.onTouchEnd({touches:[]});
  t.mock.timers.tick(4000);
  assert.equal(page.data.current,1);
  page.onHide();
  t.mock.timers.tick(4000);
  assert.equal(page.data.current,1);
  const stale = posterEvent(0,0);
  page.onPosterError(posterEvent(1,0));
  page.onPosterError(posterEvent(0,0));
  assert.equal(page.data.phase,'error');
  assert.match(page.data.message,/图片/);
  await page.retry();
  page.onPosterError(stale);
  assert.equal(page.data.posters.length,2);
  page.onUnload();
});

test('contact uses only published values for clipboard, dial and preview, with no actions for missing fields', async () => {
  const { page,actions } = harness('contact', () => ({page:'contact',body:{business_contact:{qr_asset_url:'/api/public/media/98',wechat_id:'qa-wechat',phone:'020-12345678',email:'qa@example.cn'}}}));
  await page.onLoad();
  assert.equal(page.data.phase,'ready');
  page.openContact();
  assert.equal(page.data.dialog,'contact');
  page.copyWechat();
  assert.equal(page.data.fallback,'qa-wechat');
  page.copyEmail();
  assert.equal(page.data.fallback,'qa@example.cn');
  page.dialPhone();
  page.previewQr();
  assert.deepEqual(actions,[['clipboard','qa-wechat'],['clipboard','qa@example.cn'],['phone','02012345678'],['preview','https://published.example.cn/api/public/media/98']]);
  page.onQrError(event({src:page.data.contact.qr}));
  page.previewQr();
  assert.equal(actions.length,4);
  page.closeDialog();
  assert.equal(page.data.fallback,'');
  page.onUnload();

  const empty = harness('contact', () => ({page:'contact',body:{}}));
  await empty.page.onLoad();
  assert.equal(empty.page.data.phase,'empty');
  empty.page.openContact();
  empty.page.copyEmail();
  empty.page.dialPhone();
  empty.page.previewQr();
  assert.equal(empty.page.data.dialog,'');
  assert.equal(empty.page.data.services.length,3);
  assert.deepEqual(empty.actions,[]);
  empty.page.onUnload();
});
