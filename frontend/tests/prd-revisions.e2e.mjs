import assert from 'node:assert/strict';
import {button,field} from './prd-harness.mjs';

/** Exercise two ordinary edit sessions on the same draft; the visitor never sees unconfirmed changes. */
export async function runRevisions(h){
  let item,updated,other;
  await h.runCase('WF-012',async()=>{
    const name=h.prefix+' 修订并发',priv='仅草稿的新文字',local='另一编辑的未保存输入';
    item=await h.createCase(h.E,{brand:'修订验收',name,highlight:'最初的待发布说明'});
    const route='/admin/cases/'+item.id;
    other=await h.newPage('E');await h.open(other,route);await other.getByText(name,{exact:true}).first().waitFor();
    const checked=await h.check(h.P,route);assert.equal(checked.eligible,true);assert.equal(checked.revision,item.revision);
    await h.open(h.E,route);await h.E.getByText(name,{exact:true}).first().waitFor();await field(h.E,'案例亮点').fill(priv);updated=await h.save(h.E);
    await field(other,'案例亮点').fill(local);
    const idpath=`/api/admin/items/${item.id}`;await h.observe(other,'PUT',idpath+'/draft',()=>button(other,'保存草稿').click(),409);
    await other.getByRole('alert').waitFor();assert.equal(await field(other,'案例亮点').inputValue(),local);
    await h.observe(h.P,'POST',idpath+'/publish',()=>button(h.P,'确认发布').click(),409);
    await h.observe(h.V,'GET',`/api/public/cases/${item.id}`,()=>h.open(h.V,'/cases/detail?id='+item.id),404);
    const read=await(await h.observe(h.E,'GET',idpath,()=>h.open(h.E,route))).json();assert.equal(read.draft.highlight,priv);assert.equal(read.live,null);
    return `案例 ${item.id}：另一会话保存修订 ${updated.revision} 后，旧保存和旧发布均 409；本地未保存文字保留，匿名详情 404`;
  });
  await h.runCase('WF-013',async()=>{
    h.require(item&&updated,'缺少同条目两个已保存修订');const addr=`/api/admin/items/${item.id}/preview`;const page=other??h.E;
    let start=h.events.length;await h.observe(page,'GET',addr,()=>h.open(page,`/preview?id=${item.id}&revision=${item.revision}`),409);await page.getByRole('alert').waitFor();assert.equal(await page.locator('.detail-view,.preview-stamp').count(),0);assert.ok(!h.events.slice(start).some(e=>e.path.startsWith('/api/public/')));
    start=h.events.length;await h.open(page,'/preview?id=invalid&revision=invalid');await page.getByRole('alert').waitFor();assert.ok(!h.events.slice(start).some(e=>e.path.endsWith('/preview')));
    await h.observe(page,'GET',addr,()=>h.open(page,`/preview?id=${item.id}&revision=${updated.revision}`));await page.getByText('仅草稿的新文字',{exact:true}).waitFor();
    return `过期修订 ${item.revision} 返回 409 且不渲染，非法目标无预览请求，当前修订 ${updated.revision} 可读`;
  });
  if(item){await h.open(h.E,'/admin/cases');const row=h.E.getByRole('row').filter({has:h.E.locator(`a[href="/admin/cases/${item.id}"]`)});await h.observe(h.E,'DELETE',`/api/admin/items/${item.id}/draft`,()=>button(row,'删除草稿').click(),204);}
}
