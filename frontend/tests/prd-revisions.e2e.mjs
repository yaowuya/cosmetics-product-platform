import assert from 'node:assert/strict';
import {button,field} from './prd-harness.mjs';

/** Scope row actions to the fixture item rather than relying on its default page. */
async function findCaseRow(h,page,item){
  await h.open(page,'/admin/cases');
  const search=field(page,'搜索案例');
  await search.fill(item.draft.product_name);
  await search.press('Enter');
  return page.getByRole('row').filter({has:page.locator(`button[data-item-id="${item.id}"]`)});
}

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
    // A bookmarked preview is not enough: the editor must reach the current revision from the list.
    const row=await findCaseRow(h,page,updated);
    const preview=row.getByRole('link',{name:'H5 预览',exact:true});
    const response=await h.observe(page,'GET',addr,()=>preview.click());
    assert.equal(new URL(response.url()).searchParams.get('revision'),updated.revision);
    await page.frameLocator('iframe[title="当前保存草稿的 H5 私有预览"]').getByText('仅草稿的新文字',{exact:true}).waitFor();
    return `过期修订 ${item.revision} 返回 409 且不渲染，非法目标无预览请求，从列表可预览当前修订 ${updated.revision}`;
  });
  if(item){const row=await findCaseRow(h,h.E,item);await h.observe(h.E,'DELETE',`/api/admin/items/${item.id}/draft`,()=>button(row,'删除草稿').click(),204);}
}
