import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const requireModule=createRequire(import.meta.url);
const project=fileURLToPath(new URL('../../',import.meta.url));
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const field=(page,name)=>page.getByLabel(name,{exact:true});
export {button,field};

/** Bind all role-bearing browser actions to a marked disposable loopback site, never the business instance. */
export async function createHarness(stage,directory) {
  const box=fs.realpathSync(directory), parent=fs.realpathSync(path.join(project,'.local/showcase'));
  assert.equal(path.dirname(box),parent);assert.match(path.basename(box),/^prd-selftest\.[A-Za-z0-9]+$/);
  const read=name=>JSON.parse(fs.readFileSync(path.join(box,name),'utf8'));
  const write=(name,value)=>{const dest=path.join(box,name);fs.writeFileSync(dest+'.tmp',JSON.stringify(value,null,2));fs.renameSync(dest+'.tmp',dest);};
  const meta=read('fixture.json'),base='https://127.0.0.1:5155',sample='https://localhost:5143';
  assert.equal(meta.origin,base);assert.equal(meta.runId,path.basename(box));
  const {chromium}=requireModule(process.env.PLAYWRIGHT_MODULE||'playwright');
  const browser=await chromium.launch({channel:'chrome'});const events=[],dialogs=[],errors=[],results=[];
  const safeOrigin=u=>u.origin===base||u.origin===sample,runId=Date.now().toString(36), logname=`network-${stage}-${runId}.ndjson`;
  const notices=new WeakMap();
  async function pageFor(actor,mobile=false){
    const context=await browser.newContext({ignoreHTTPSErrors:true,locale:'zh-CN',colorScheme:'light',deviceScaleFactor:1,viewport:mobile?{width:390,height:844}:{width:1440,height:900}});
    const page=await context.newPage();page.setDefaultTimeout(6500);page.setDefaultNavigationTimeout(12000);notices.set(page,true);
    page.on('dialog',async d=>{dialogs.push({actor,text:d.message()});await(notices.get(page)===false?d.dismiss():d.accept());});
    context.on('response',r=>{const u=new URL(r.url());if(safeOrigin(u)&&u.pathname.startsWith('/api/')){const e={actor,method:r.request().method(),path:u.pathname,status:r.status()};events.push(e);fs.appendFileSync(path.join(box,logname),JSON.stringify(e)+'\n');}});
    page.on('pageerror',e=>errors.push({actor,message:e.name+': '+e.message.slice(0,140)}));return page;
  }
  const probe=await pageFor('readiness');
  try {
    const reply=await probe.goto(base+'/health/ready');assert.equal(reply.status(),200);assert.equal(await reply.headerValue('x-showcase-qa-run'),meta.runId);assert.equal((await reply.json()).status,'ready');
  }catch(e){await browser.close();throw e;}
  await probe.context().close();
  const pub=stage==='public';const actors=pub?{}:read('private.json').actors;
  const h={browser,base,sample,box,files:meta.files,prefix:'QA'+meta.runId.split('.').at(-1).toUpperCase(),events,dialogs,errors,results,logname,version:browser.version(),logins:Object.fromEntries(Object.entries(actors).map(([role,a])=>[role,a.login])),
    setConfirm(page,accept){notices.set(page,accept);},write,read,
    block(reason){throw Object.assign(new Error(reason),{blocked:true});},require(condition,reason){if(!condition)this.block(reason);}
  };
  h.require=h.require.bind(h);
  function redact(text){let s=String(text).replace(/\x1B\[[0-9;]*m/g,'');for(const a of Object.values(actors))for(const v of [a.temporary,a.password])if(v)s=s.split(v).join('[private]');return s.slice(0,1050);}
  h.runCase=async(id,fn)=>{
    assert.match(id,/^[A-Za-z0-9_-]+$/);const from=events.length,start=new Date().toISOString(),count=errors.length;
    let status='PASS',detail='Recorded assertions passed';try {detail=(await fn())??detail;}catch(e){status=e.blocked?'BLOCKED':'FAIL';detail=redact(e);}
    if(status==='PASS'&&errors.length>count){status='FAIL';detail=`浏览器出现未处理错误：${redact(errors[count].message)}`;}
    results.push({id,status,detail:typeof detail==='string'?detail:JSON.stringify(detail),start,end:new Date().toISOString(),network:logname,eventStart:from,eventEnd:events.length,pageErrors:errors.slice(count)});
    write(`cases-${stage}-${runId}.json`,results);console.log(`${status} ${id} ${String(detail).replace(/\s+/g,' ').slice(0,380)}`);return status==='PASS';
  };
  h.open=async(page,route)=>{const dest=new URL(route,base);assert.equal(dest.origin,base);const res=await page.goto(dest.href);assert.equal(new URL(page.url()).origin,base);return res;};
  h.observe=async(page,method,pattern,act,expected)=>{
    const expectedOrigin=stage==='public'&&method==='GET'?sample:base;
    const [res]=await Promise.all([page.waitForResponse(r=>{const u=new URL(r.url());return u.origin===expectedOrigin&&r.request().method()===method&&(typeof pattern==='string'?u.pathname===pattern:pattern.test(u.pathname));},{timeout:11000}),act()]);
    if(!notices.has(page)){const e={actor:'S',method,path:new URL(res.url()).pathname,status:res.status()};events.push(e);fs.appendFileSync(path.join(box,logname),JSON.stringify(e)+'\n');}
    assert.ok(expected==null?res.ok():res.status()===expected,`${method} ${new URL(res.url()).pathname}: ${res.status()} (expected ${expected??'2xx'})`);return res;
  };
  async function login(page,role){const a=actors[role];assert.ok(a);const mark=path.join(box,'rotated-'+role);await h.open(page,'/admin/');assert.equal(new URL(page.url()).origin,base);await field(page,'登录名').fill(a.login);await field(page,'密码').fill(fs.existsSync(mark)?a.password:a.temporary);await h.observe(page,'POST','/api/admin/login',()=>button(page,'登录').click());
    if(!fs.existsSync(mark)) {await field(page,'原密码').fill(a.temporary);await field(page,'新密码').fill(a.password);await field(page,'确认新密码').fill(a.password);await h.observe(page,'POST','/api/admin/change-password',()=>button(page,'修改并进入工作台').click());fs.writeFileSync(mark,'changed');}
    await page.waitForURL(base+'/admin/');await page.locator('.sheet h1').waitFor();}
  h.newPage=async(role)=>{const page=await pageFor(role,role.startsWith('V'));if(actors[role])await login(page,role);return page;};
  h.S=await pageFor('S',true);h.V=await pageFor('V',true);h.V2=await pageFor('V2',true);
  h.roles=async()=>{h.E=await h.newPage('E');h.P=await h.newPage('P');};
  h.catalogPublisher=async()=>{
    const role='catalog'+runId;const random=()=>globalThis.crypto.randomUUID();const a={login:'prd-'+role,temporary:random(),password:random()};actors[role]=a;
    const page=h.A=await h.newPage('A');await h.open(page,'/admin/accounts');await button(page,'开通账号').click();await field(page,'登录名').fill(a.login);await field(page,'临时密码').fill(a.temporary);await field(page,'内容编辑').check();await field(page,'发布').check();await h.observe(page,'POST','/api/admin/accounts',()=>button(page,'确认开通').click(),201);return h.newPage(role);
  };
  h.firstAccounts=async()=>{h.A=await h.newPage('A');await h.open(h.A,'/admin/accounts');await h.A.getByText(actors.A.login,{exact:true}).waitFor();for(const role of ['E','P']){const a=actors[role];if(await h.A.getByText(a.login,{exact:true}).count())continue;await button(h.A,'开通账号').click();await field(h.A,'登录名').fill(a.login);await field(h.A,'临时密码').fill(a.temporary);await field(h.A,'内容编辑').check();if(role==='P')await field(h.A,'发布').check();await h.observe(h.A,'POST','/api/admin/accounts',()=>button(h.A,'确认开通').click(),201);await h.A.getByText(a.login,{exact:true}).waitFor();}await h.roles();};
  h.upload=async(page,index,file)=>{assert.ok(file&&path.dirname(fs.realpathSync(file))===fs.realpathSync(path.join(box,'assets')));const result=await h.observe(page,'POST','/api/admin/media',()=>page.locator('input[type=file]').nth(index).setInputFiles(file),201);await page.waitForFunction(()=>!document.querySelector('input[type=file]:disabled'));return result.json();};
  h.save=async page=>(await h.observe(page,'PUT',/\/draft$/,()=>button(page,'保存草稿').first().click())).json();
  h.check=async(page,address)=>{await h.open(page,address);const tab=page.locator('nav.seg');await button(tab,'发布检查').click();return (await h.observe(page,'POST',/\/check$/,()=>button(page,'检查发布').click())).json();};
  h.publish=async(page,address)=>{const r=await h.check(page,address);assert.ok(r.eligible,JSON.stringify(r.issues));return (await h.observe(page,'POST',`/api/admin/items/${r.id}/publish`,()=>button(page,'确认发布').click())).json();};
  h.publishRow=async(page,collection,id)=>{assert.ok(['products','cases'].includes(collection));await h.open(page,`/admin/${collection}`);const row=page.locator('.el-table__row').filter({has:page.locator(`a[href="/admin/${collection}/${id}"]`)});await button(row,'发布检查').click();const panel=page.locator('section[aria-label="发布检查"]');const report=await(await h.observe(page,'POST',`/api/admin/items/${id}/check`,()=>button(panel,'检查发布').click())).json();assert.equal(report.eligible,true,JSON.stringify(report.issues));return (await h.observe(page,'POST',`/api/admin/items/${id}/publish`,()=>button(panel,'确认发布').click())).json();};
  h.createProduct=async(page,o)=>{
    await h.open(page,'/admin/products');
    const dialog=page.getByRole('dialog',{name:'新增产品',exact:true});
    const next=()=>button(dialog,'下一步').click();
    const directory=await(await h.observe(page,'GET','/api/admin/config/directory',()=>button(page,'新增产品').click())).json();
    for(const [key,value] of [['产品名称',o.name],['英文名称（选填）',o.english??'Lab '+o.code],['配方编号',o.code],['简短功效',o.short??'本轮测试短功效']]) await field(dialog,key).fill(value);
    await field(dialog,'是否生产过').selectOption('待确认');
    await next();
    for(const [key,value] of [['功效',o.benefit??'本轮功效说明'],['核心成分','测试成分'],['产品亮点','测试亮点']]) await field(dialog,key).fill(value);
    await next();
    assert.equal(await dialog.locator('input[type=file]').count(),2);
    await h.upload(page,0,h.files.cover);
    if(!o.omitLong) await h.upload(page,1,h.files.long);
    const ids=new Map((directory.live??directory.draft)?.nodes?.map(node=>[node.id,node])??[]);
    if(o.places?.length){
      await dialog.locator('.place-cascader').click();
      for(const id of o.places){
        const chain=[];
        for(let node=ids.get(id);node;node=ids.get(node.parent_id)) chain.unshift(node);
        assert.ok(chain.length,`找不到展示位置 ${id}`);
        for(const [depth,node] of chain.entries()){
          const row=page.locator('.el-cascader-menu').nth(depth).locator('.el-cascader-node')
            .filter({has:page.getByText(node.name,{exact:true})});
          await row.locator(depth===chain.length-1?'label.el-checkbox':'.el-cascader-node__label').click();
        }
      }
      await dialog.getByRole('heading',{name:'展示位置',exact:true}).click();
    }
    const save=button(dialog.locator('footer'),'保存');
    const response=await h.observe(page,'POST','/api/admin/products',()=>save.click(),201);
    assert.ok(!('thumbnail_asset_id' in response.request().postDataJSON().body));
    await dialog.waitFor({state:'hidden'});
    assert.equal(page.url(),`${base}/admin/products`);
    return response.json();
  };
  h.createCase=async(page,o)=>{
    await h.open(page,'/admin/cases');
    await button(page,'新增案例').click();
    const dialog=page.getByRole('dialog',{name:'新增案例',exact:true});
    await field(dialog,'品牌名称').fill(o.brand);
    await field(dialog,'案例产品名称').fill(o.name);
    if(o.related)await dialog.getByRole('combobox',{name:'内部关联产品',exact:true}).selectOption(String(o.related));
    if(o.category)await dialog.getByRole('combobox',{name:'案例分类',exact:true}).selectOption(o.category);
    await button(dialog,'下一步').click();
    await field(dialog,'案例亮点').fill(o.highlight??'本轮案例亮点');
    if(o.description)await field(dialog,'案例说明（选填）').fill(o.description);
    await h.upload(page,0,h.files.square);
    const item=await(await h.observe(page,'POST','/api/admin/cases',()=>button(dialog,'保存').click(),201)).json();
    await dialog.waitFor({state:'hidden'});
    assert.equal(page.url(),`${base}/admin/cases`);
    return item;
  };
  if(fs.existsSync(path.join(box,'nodes.json')))Object.assign(h,read('nodes.json'));
  return h;
}
