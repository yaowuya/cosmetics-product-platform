const test = require('node:test');
const assert = require('node:assert/strict');
const { projectCatalog, selectBoard, homeView, catalogCover, productView, caseHeader, contactView } = require('../lib/model');
const media = path => typeof path === 'string' && /^\/api\/public\/media\/[1-9]\d*$/.test(path) ? `https://public.cn${path}` : '';

test('directory keeps valid linked tiers in server order and constrains a saved selection to its own board', () => {
  const tree = projectCatalog({ counts: { '1': 2, '2': 1 }, nodes: [
    {id:'3',level:'subcategory',parent_id:'2',name:'细分'}, {id:'9',level:'category',parent_id:'4'},
    {id:'1',level:'board',parent_id:null,name:'护肤'}, {id:'2',level:'category',parent_id:'1',name:'洁面'},
    {id:'4',level:'board',parent_id:null,name:'身体'}, {id:'8',level:'subcategory',parent_id:'1'},
    {id:'6',level:'category',parent_id:'99'}, {id:2,level:'category',parent_id:'4'},
  ] }, media);
  assert.deepEqual(tree.boards.map(board => board.id), ['1','4']);
  assert.deepEqual(tree.categories['1'].map(node => node.id), ['2']);
  assert.deepEqual(tree.fine['2'].map(node => node.id), ['3']);
  assert.equal(tree.counts['1'], 2);
  assert.deepEqual(selectBoard(tree,'1',{category:'9',fine:'8',q:'晚霜'}), {category:'2',fine:'',q:'晚霜',left:0,right:0});
});

test('catalog cover retains published slogan for a failed image that embeds the same text', () => {
  const path = '/api/public/media/4';
  assert.deepEqual(catalogCover({cover_asset_url:path,image_has_text:true,slogan_top:' 精选 '},media),
    {image:media(path),imageHasText:true,top:'精选',bottom:''});
  assert.deepEqual(catalogCover({cover_asset_url:'//else.cn/image',image_has_text:true,slogan_bottom:'精选'},media),
    {image:'',imageHasText:false,top:'',bottom:'精选'});
});

test('public media, cards and controls never fill in missing business contacts', () => {
  const path = '/api/public/media/4';
  assert.deepEqual(homeView({poster_asset_urls:[path,path,'//else.cn/image']},media),[media(path)]);
  assert.deepEqual(contactView({},media),{qr:'',wechat:'',phone:'',email:''});
  assert.equal(contactView({business_contact:{qr_asset_url:path,wechat_id:' wx-team '}},media).wechat,'wx-team');
  const item = productView({id:'9007199254740999',body:{name:'面霜',formula_no:'290',detail_asset_url:path}},media);
  assert.equal(item.id,'9007199254740999');
  assert.equal(item.formula,'290');
  assert.deepEqual(item.gallery,[media(path)]);
  assert.deepEqual(caseHeader({filters:[{key:'skin',label:'护肤'},{key:' skin ',label:'重复'},{key:'missing'}]},media).tags,[{key:'skin',label:'护肤'}]);
});

test('product gallery keeps up to three valid originals in their published order', () => {
  const images = ['2','1','3','4','9'].map(id => `/api/public/media/${id}`);
  const item = {id:'1',body:{cover_asset_url:images[4],detail_asset_url:images[4],
    detail_asset_urls:[images[0],'//else.cn/image',images[1],images[0],images[2],images[3]]}};
  assert.deepEqual(productView(item,media).gallery,images.slice(0,3).map(media));
  assert.equal(productView(item,media).image,media(images[4]));
});

test('case categories show the default 精选案例 only once and keep published filters in order', () => {
  const header = caseHeader({filters:[
    {key:'featured',label:'精选案例'}, {key:'freeze',label:'冻干案例'},
    {key:'medical',label:'二类案例'}, {key:'export',label:'外贸案例'},
    {key:'another-recommendation',label:' 精选案例 '}, {key:'customer',label:'客户共创案例'},
  ]},media);
  assert.deepEqual(header.tags, [
    {key:'freeze',label:'冻干案例'}, {key:'medical',label:'二类案例'},
    {key:'export',label:'外贸案例'}, {key:'customer',label:'客户共创案例'},
  ]);
  assert.equal(header.allLabel, '精选案例');
  assert.deepEqual(caseHeader({filters:[{key:'featured',label:'品牌推荐'}]},media).tags,
    [{key:'featured',label:'品牌推荐'}]);
});
