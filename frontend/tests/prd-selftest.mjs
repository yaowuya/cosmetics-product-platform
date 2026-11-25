import assert from 'node:assert/strict';
import {createHarness,button,field} from './prd-harness.mjs';
const [stage,dir]=process.argv.slice(2);
assert.ok(['setup','public','catalog','revisions','products','item-wizards','governance','audit'].includes(stage)&&dir,'Expected a stage and private QA run directory');
const h=await createHarness(stage,dir);

/** Capture public content by navigating the actual H5 pages; keep only stable, non-secret observations. */
async function publicSummary(page,origin){
  await page.goto(origin+'/catalog');await page.locator('.board-tabs button').first().waitFor();const names=await page.locator('.board-tabs button').allTextContents();
  await page.goto(origin+'/');await page.locator('.poster-slide img').first().waitFor();
  const slides=page.locator('.poster-slide'), dots=page.locator('.poster-dots button'), posters=[];
  const count=await slides.count();
  for(let index=0;index<count;index++){
    if(count>1)await dots.nth(index).click();
    posters.push(await slides.nth(index).locator('img').getAttribute('src'));
  }
  await page.goto(origin+'/cases');await page.locator('.case-featured,.case-results .h5-empty strong').first().waitFor();return {names,posters,firstCase:(await page.locator('.case-featured strong').allTextContents()).join('')};
}
async function setup(){
  await h.runCase('LAB-ACCOUNTS',async()=>{await h.firstAccounts();assert.ok(await h.E.getByRole('link',{name:'全部产品',exact:true}).isVisible());return 'A、E、P 经 UI 首次改密并进入分权工作区；V/V2 是独立匿名上下文';});
  await h.runCase('TENANT-SETUP',async()=>{
    h.require(h.E&&h.P,'账号前置未完成');const e=h.E,p=h.P;
    const baseline=await publicSummary(h.S,h.sample);assert.ok(baseline.names.length);h.write('sample-before.json',baseline);
    await h.open(e,'/admin/directory');await button(e,'＋ 新增节点').waitFor();assert.equal(await e.locator('.tree-row').count(),0,'Refusing to replace an existing directory');
    const boards={},places={};async function add(name,parent=''){await button(e,'＋ 新增节点').click();await field(e,'节点名称').fill(name);await e.getByRole('combobox',{name:'所在位置',exact:true}).selectOption(parent);const response=await h.observe(e,'POST','/api/admin/directory/nodes',()=>button(e,'添加到草稿').click(),201);return (await response.json()).id;}
    for(const [k,board,c] of [['a','护肤','基础'],['b','彩妆','色彩'],['c','香氛','香调']]){boards[k]=await add(board);places[k]=await add(c,boards[k]);}
    await h.save(e);await h.publish(p,'/admin/directory');Object.assign(h,{boards,places});h.write('nodes.json',{boards,places,categories:{custom:'prd_custom',other:'prd_other'}});
    for(const slot of ['home_posters','catalog_cover','case_header','business_contact']){
      const addr='/admin/pages/'+slot;await h.open(e,addr);await e.locator('.edit-layout').waitFor();
      if(slot==='home_posters'){
        await h.upload(e,0,h.files.poster1);const draft=await h.save(e);const report=await h.check(p,addr);assert.equal(report.eligible,false);assert.ok(report.issues.some(i=>i.field==='poster_asset_ids'));assert.equal(draft.live_id,null);
        await h.upload(e,0,h.files.poster2);await h.upload(e,0,h.files.poster3);
      }else if(slot==='catalog_cover'){await field(e,'封面主文案（选填）').fill('独立企业验收');await field(e,'封面次文案（选填）').fill('三板块专属目录');await h.upload(e,0,h.files.cover);}
      else if(slot==='case_header'){await field(e,'案例页标题').fill('合作案例');await field(e,'标题说明').fill('独立测试企业的案例');for(const [k,t] of [['prd_custom','定制'],['prd_other','其他']]){await field(e,'分类标识').fill(k);await field(e,'分类显示名称').fill(t);await button(e,'新增分类').click();}}
      else {await field(e,'邮箱（选填）').fill('qa-contact@example.invalid');}
      await h.save(e);await h.publish(p,addr);
    }
    await h.open(h.V,'/catalog');await h.V.getByText('三板块专属目录',{exact:true}).waitFor();assert.deepEqual(await h.V.locator('.board-tabs button').allTextContents(),['护肤','彩妆','香氛']);return '独立空库通过 UI 配置 3 板块、独立海报/封面/服务/联系与案例筛选；1 张海报草稿被阻止发布，3 张后确认成功';
  });
}
async function audit(){
  await h.runCase('PRD-02',async()=>{const first=h.read('sample-before.json');assert.deepEqual(await publicSummary(h.S,h.sample),first);const second=await publicSummary(h.V,h.base);assert.deepEqual(second.names,['护肤','彩妆','香氛']);assert.equal(second.posters.length,3);await h.open(h.V,'/contact');await h.V.getByText('专属打样服务',{exact:true}).waitFor();await button(h.V,'合作咨询').click();await h.V.getByRole('dialog').waitFor();const qr=h.V.locator('.h5-dialog img.qr-image');assert.equal(await qr.count(),1,'second tenant QR was not released');await qr.evaluate(i=>i.decode());assert.ok(!(await h.V.locator('body').innerText()).includes('微肽'));return '同一构建在两个本机独立企业库：新企业3板块/3海报/自有服务与码，样例企业的板块、海报与首案例未变。非云端或异机部署';});
}
try{
 if(stage==='setup')await setup();
 if(stage==='catalog')await(await import('./prd-catalog.e2e.mjs')).runCatalog(h);
 if(stage==='public')await(await import('./prd-public.e2e.mjs')).runPublic(h);
 if(stage==='revisions'){await h.roles();await(await import('./prd-revisions.e2e.mjs')).runRevisions(h);}
 if(stage==='products'||stage==='governance'){
   h.require(h.places?.a&&h.places?.b&&h.places?.c,'需要成功的一次性企业目录配置');h.A=await h.newPage('A');await h.roles();
   if(stage==='products')await(await import('./prd-products.e2e.mjs')).runProducts(h);else await(await import('./prd-governance.e2e.mjs')).runGovernance(h);
 }
 if(stage==='item-wizards'){
   h.E=await h.newPage('E');await(await import('./prd-item-wizards.e2e.mjs')).runItemWizards(h);
 }
 if(stage==='audit')await audit();
 if(h.results.some(r=>r.status==='FAIL'))process.exitCode=1;
}catch(e){console.error('Stage interrupted before completion:',e.name,String(e.message).replace(/(fill\()[^)]*/g,'$1[private]').slice(0,400));process.exitCode=2;}
finally{await h.browser.close();console.log('Terminal case records:',h.results.length, 'browser',h.version);}
