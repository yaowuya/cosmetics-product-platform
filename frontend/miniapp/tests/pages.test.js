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

test('catalog keeps mounted cards on tab return and removes unpublished results after revalidating', async () => {
  let published = true;
  const { page } = harness('catalog', url => {
    if (url.pathname.endsWith('/pages/catalog')) return {page:'catalog',body:{
      cover_asset_url:'/api/public/media/61', cover_thumbnail_url:'/api/public/media/61/display-thumbnail',
    }};
    if (!url.pathname.endsWith('/products')) return directory(url);
    return { ...response(1,published ? [id] : []), items: published ? [{ id, body: {
      name: '产品', catalog_thumbnail_url: '/api/public/media/62/catalog-thumbnail',
    } }] : [] };
  });
  await page.onLoad();
  await page.onShow?.();
  const cover = page.data.cover;
  assert.equal(cover.image,'https://published.example.cn/api/public/media/61/display-thumbnail');
  page.onRightScroll({detail:{scrollTop:470}});
  const cards = page.data.items;
  await page.onShow?.();
  assert.equal(page.data.items,cards);
  assert.equal(page.data.cover,cover);
  assert.equal(page.currentView().right,470);

  page.onCoverError(event({src:cover.image}));
  page.onImageError(event({id,src:cards[0].thumbnail,version:cards[0].imageVersion}));
  assert.equal(page.data.failedThumbnails[id],cards[0].thumbnail);
  await page.onShow();
  assert.equal(page.data.items,cards);
  assert.equal(page.data.coverFailed,false);
  assert.equal(page.data.failedThumbnails[id],undefined);

  published = false;
  const refreshing = page.onShow?.();
  assert.equal(page.data.items,cards);
  assert.equal(page.data.configPhase,'ready');
  await refreshing;
  assert.deepEqual(page.data.items,[]);
  assert.equal(page.data.phase,'empty');
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
    return {items:[{id,body:{name:'面霜',catalog_image_url:`/api/public/media/1${media}`}}],total:1,page:1,page_size:20};
  });
  await page.onLoad();
  const stale = page.data.cover.image;
  const staleImage = page.data.items[0].image;
  const staleVersion = page.data.imageVersion;
  media = '2';
  await page.onRefresh();
  page.onCoverError(event({src:stale}));
  page.onImageError(event({id,src:staleImage,version:staleVersion}));
  assert.equal(page.data.coverFailed,false);
  assert.equal(page.data.broken[id],undefined);
  const current = page.data.cover.image;
  const currentImage = page.data.items[0].image;
  page.onCoverError(event({src:current}));
  page.onImageError(event({id,src:currentImage,version:page.data.imageVersion}));
  assert.equal(page.data.coverFailed,true);
  assert.equal(page.data.broken[id],currentImage);
  page.onUnload();
});

test('catalog falls back from a thumbnail only to its independent square original', async () => {
  const originalPath = '/api/public/media/62';
  const thumbnailPath = `${originalPath}/thumbnail`;
  const wideCover = '/api/public/media/63';
  const generatedPath = `${wideCover}/catalog-thumbnail`;
  const origin = 'https://published.example.cn';
  const { page } = harness('catalog', url => {
    if (url.pathname.endsWith('/catalog')) return directory(url);
    return { ...response(1,[id,'72','73','74','75','76']), items:[
      {id,body:{name:'面霜',cover_asset_url:originalPath,thumbnail_asset_url:originalPath,catalog_image_url:originalPath,cover_thumbnail_url:thumbnailPath,catalog_thumbnail_url:generatedPath}},
      {id:'72',body:{name:'面膜',cover_asset_url:wideCover,thumbnail_asset_url:wideCover,cover_thumbnail_url:`${wideCover}/thumbnail`}},
      {id:'73',body:{name:'乳液',cover_asset_url:wideCover,thumbnail_asset_url:originalPath,cover_thumbnail_url:`${wideCover}/thumbnail`}},
      {id:'74',body:{name:'精华',cover_asset_url:wideCover,catalog_image_url:originalPath,cover_thumbnail_url:`${wideCover}/thumbnail`}},
      {id:'75',body:{name:'洁面',cover_asset_url:wideCover,thumbnail_asset_url:wideCover,catalog_image_url:`https://untrusted.example.cn${wideCover}`,cover_thumbnail_url:`${wideCover}/thumbnail`}},
      {id:'76',body:{name:'旧商品',cover_asset_url:wideCover,thumbnail_asset_url:wideCover,catalog_thumbnail_url:generatedPath}},
    ] };
  });
  await page.onLoad();
  assert.deepEqual(page.data.items.map(({image,thumbnail}) => ({image,thumbnail})), [
    {image:origin + originalPath,thumbnail:origin + thumbnailPath},
    {image:'',thumbnail:''},
    {image:origin + originalPath,thumbnail:''},
    {image:origin + originalPath,thumbnail:''},
    {image:'',thumbnail:''},
    {image:'',thumbnail:origin + generatedPath},
  ]);

  const firstVersion = page.data.imageVersion;
  const firstNodeKey = page.data.items[0].imageKey;
  assert.equal(page.data.items[0].imageVersion,firstVersion);
  const oldThumbnailError = event({id,src:origin + thumbnailPath,version:firstVersion});
  await page.onFine(event({id:'3'}));
  assert.notEqual(page.data.imageVersion,firstVersion);
  assert.notEqual(page.data.items[0].imageKey,firstNodeKey);
  assert.equal(page.data.items[0].imageVersion,page.data.imageVersion);
  page.onImageError(oldThumbnailError);
  assert.equal(page.data.failedThumbnails[id],undefined);

  const currentVersion = page.data.imageVersion;
  page.onImageError(event({id:'76',src:origin + generatedPath,version:currentVersion}));
  assert.equal(page.data.failedThumbnails['76'],origin + generatedPath);
  assert.equal(page.data.items.find(item => item.id === '76').image,'');
  const thumbnailError = event({id,src:origin + thumbnailPath,version:currentVersion});
  page.onImageError(thumbnailError);
  assert.equal(page.data.failedThumbnails[id],origin + thumbnailPath);
  assert.equal(page.data.broken[id],undefined);
  page.onImageError(event({id,src:origin + wideCover,version:currentVersion}));
  assert.equal(page.data.broken[id],undefined);
  page.onImageError(event({id,src:origin + originalPath,version:currentVersion}));
  assert.equal(page.data.broken[id],origin + originalPath);
  page.onImageError(thumbnailError);
  assert.equal(page.data.broken[id],origin + originalPath);

  await page.onRefresh();
  page.onImageError(thumbnailError);
  assert.equal(page.data.failedThumbnails[id],undefined);
  assert.equal(page.data.broken[id],undefined);
  page.onUnload();
});

test('product re-reads the current publication and never substitutes the previous detail for 404', async () => {
  let live = true;
  const originalCover = '/api/public/media/62';
  const { page,calls,actions } = harness('product', () => live ? {id,body:{
    name:'面霜',formula_no:'A-44',cover_asset_url:originalCover,cover_thumbnail_url:`${originalCover}/thumbnail`,
  }} : 404);
  await page.onLoad({id});
  assert.equal(page.data.detail.formula,'A-44');
  assert.equal(page.data.detail.image,`https://published.example.cn${originalCover}`);
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

test('product gallery errors affect only the failed original and reset on retry', async () => {
  const urls = ['67','68','69'].map(number => `/api/public/media/${number}`);
  const origin = 'https://published.example.cn';
  const { page } = harness('product', () => ({id,body:{
    cover_asset_url:'/api/public/media/66',detail_asset_urls:urls,
  }}));
  await page.onLoad({id});
  assert.deepEqual(page.data.detail.gallery,urls.map(url => origin + url));
  const error = event({src:origin + urls[1],version:page.data.galleryVersion});
  page.onLongError(error);
  assert.deepEqual(page.data.failedGallery,{[origin + urls[1]]:true});
  assert.equal(page.data.coverFailed,false);
  await page.onRetry();
  page.onLongError(error);
  assert.deepEqual(page.data.failedGallery,{});
  assert.deepEqual(page.data.detail.gallery,urls.map(url => origin + url));
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

test('case cards use their own thumbnails, stay mounted on tab return, and drop withdrawn cases', async () => {
  let published = true;
  const original = '/api/public/media/62';
  const thumbnail = `${original}/display-thumbnail`;
  const { page } = harness('cases', url => {
    if (url.pathname.endsWith('/pages/cases')) return {page:'cases',body:{}};
    const body = {brand_name:'品牌',image_asset_url:original};
    const items = [{id,body:{...body,image_thumbnail_url:thumbnail}},
      {id:'72',body:{...body,image_thumbnail_url:'/api/public/media/63/display-thumbnail'}}];
    const visible = published ? items : items.slice(1);
    return {...response(1,visible.map(item => item.id)),items:visible};
  });
  await page.onLoad();
  await page.onShow();
  const cards = page.data.items;
  assert.deepEqual(cards.map(item => item.image),[thumbnail,original].map(path => `https://published.example.cn${path}`));
  await page.onShow();
  assert.equal(page.data.items,cards);
  page.onCardImageError(event({id,src:cards[0].image}));
  assert.equal(page.data.brokenImages[id],cards[0].image);
  await page.onShow();
  assert.equal(page.data.items,cards);
  assert.equal(page.data.brokenImages[id],undefined);
  published = false;
  const refreshing = page.onShow();
  assert.equal(page.data.items,cards);
  await refreshing;
  assert.deepEqual(page.data.items.map(item => item.id),['72']);
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
  page.onPosterLoad(posterEvent(0,0));
  page.onPosterLoad(posterEvent(1,0));
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
  const second = page.data.posters[1];
  page.onPosterError(posterEvent(0,0));
  assert.deepEqual(Object.keys(page.data.mountedPosters),[second]);
  page.onUnload();
});

test('home prefetches only the next poster and waits for it before rotating', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const posters = [1,2,3,4].map(number => `/api/public/media/${number}`);
  const { page } = harness('home', () => ({page:'home',body:{poster_asset_urls:posters}}));
  await page.onLoad();
  page.onShow();
  const [first,second,third,fourth] = page.data.posters;
  const completed = src => event({src,version:page.data.posterVersion});
  const mounted = () => Object.keys(page.data.mountedPosters);
  assert.deepEqual(mounted(),[first]);
  t.mock.timers.tick(8000);
  assert.equal(page.data.current,0);
  page.onPosterLoad(completed(first));
  assert.deepEqual(mounted(),[first,second]);
  t.mock.timers.tick(8000);
  assert.equal(page.data.current,0);
  page.onPosterLoad(completed(second));
  assert.deepEqual(mounted(),[first,second]);
  t.mock.timers.tick(3999);
  assert.equal(page.data.current,0);
  t.mock.timers.tick(1);
  assert.equal(page.data.current,1);
  assert.deepEqual(mounted(),[first,second,third]);
  page.selectPoster(event({index:3}));
  assert.equal(page.data.current,3);
  assert.deepEqual(mounted(),[first,second,fourth]);
  page.onUnload();
});

test('home reuses mounted posters on tab return and removes withdrawn ones after a fresh response', async () => {
  let posters = ['/api/public/media/1','/api/public/media/2'];
  let offline = false;
  const { page } = harness('home', () => offline ? new Error('offline') : {page:'home',body:{poster_asset_urls:posters}});
  await page.onLoad();
  await page.onShow();
  const first = page.data.posters[0];
  const second = page.data.posters[1];
  page.onPosterLoad(event({src:first,version:page.data.posterVersion}));
  page.selectPoster(event({index:1}));
  const mounted = page.data.mountedPosters;

  page.onHide();
  await page.onShow();
  assert.equal(page.data.mountedPosters,mounted);
  assert.equal(page.data.current,1);
  offline = true;
  page.onHide();
  await page.onShow();
  assert.equal(page.data.mountedPosters,mounted);
  assert.equal(page.data.phase,'ready');

  offline = false;
  posters = [posters[1]];
  page.onHide();
  const refreshing = page.onShow();
  assert.equal(page.data.mountedPosters,mounted);
  await refreshing;
  assert.deepEqual(page.data.posters,[second]);
  assert.deepEqual(Object.keys(page.data.mountedPosters),[second]);

  posters = [];
  page.onHide();
  await page.onShow();
  assert.equal(page.data.phase,'empty');
  assert.deepEqual(page.data.posters,[]);
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
