import assert from 'node:assert/strict';
import {button,field} from './prd-harness.mjs';

/** Build a known 3:1 category by normal UI operations rather than guessing sample-product assignments. */
export async function runCatalog(h){
  await h.runCase('PRD-12',async()=>{
    h.require(h.boards?.c,'缺少独立企业板块');const writer=await h.catalogPublisher(),v=h.V;
    const key=h.prefix+'-分类回位',single='单款细分',others='其他细分';
    await h.open(writer,'/admin/directory');await button(writer,'＋ 新增节点').waitFor();
    async function node(name,parent){await button(writer,'＋ 新增节点').click();await field(writer,'节点名称').fill(name);await writer.getByRole('combobox',{name:'所在位置',exact:true}).selectOption(parent);return(await(await h.observe(writer,'POST','/api/admin/directory/nodes',()=>button(writer,'添加到草稿').click(),201)).json()).id;}
    const cat=await node(key,h.boards.c),fine=await node(single,cat),rest=await node(others,cat);
    for(let i=0;i<6;i++)await node(key+'-空'+i,h.boards.c);
    await h.save(writer);await h.publish(writer,'/admin/directory');const items=[];
    for(let i=0;i<3;i++){const item=await h.createProduct(writer,{name:key+'-产品'+i,code:key+'-PF'+i,places:[i?rest:fine]});await h.publish(writer,`/admin/products/${item.id}`);items.push(item);}
    await v.setViewportSize({width:360,height:520});const meta=await(await h.observe(v,'GET','/api/public/catalog',()=>h.open(v,'/catalog'))).json();assert.equal(meta.counts[cat],3);assert.equal(meta.counts[fine],1);
    async function list(board,nodeId,q,act){const [response]=await Promise.all([v.waitForResponse(r=>{const u=new URL(r.url());return r.request().method()==='GET'&&u.origin===h.base&&u.pathname==='/api/public/products'&&u.searchParams.get('board_id')===board&&(nodeId===undefined||u.searchParams.get('node_id')===nodeId)&&u.searchParams.get('q')===(q||null);}),act()]);assert.equal(response.status(),200);return response.json();}
    await button(v.locator('.board-tabs'),'香氛').click();await button(v.locator('.category-rail'),key).waitFor();
    const initial=await list(h.boards.c,cat,null,()=>button(v.locator('.category-rail'),key).click());assert.equal(initial.total,3);
    const one=await list(h.boards.c,fine,null,()=>button(v.locator('.fine-filters'),single).click());assert.deepEqual(one.items.map(x=>x.id),[items[0].id]);
    const card=v.locator('.product-card');await v.waitForFunction(()=>document.querySelectorAll('.product-card').length===1);assert.match(await v.locator('.category-total').innerText(),/^\s*3\s*款\s*$/);
    const rail=v.locator('.category-rail');await rail.hover();await v.mouse.wheel(0,3000);await v.waitForFunction(()=>document.querySelector('.category-rail')?.scrollTop>5);const old=await rail.evaluate(x=>x.scrollTop);
    await card.click();await v.getByRole('heading',{name:items[0].draft.name,exact:true}).waitFor();await button(v,'返回产品目录').click();await button(v.locator('.fine-filters'),single).waitFor();await v.waitForFunction(()=>document.querySelectorAll('.product-card').length===1);
    assert.equal(await button(v.locator('.fine-filters'),single).getAttribute('aria-pressed'),'true');assert.equal(await card.locator('strong').innerText(),items[0].draft.name);assert.ok(Math.abs(await rail.evaluate(x=>x.scrollTop)-old)<=1,'详情返回后分类栏滚动位置丢失');
    const search=v.locator('.h5-search input');const found=await list(h.boards.c,null,items[1].draft.formula_no,()=>search.fill(items[1].draft.formula_no));assert.deepEqual(found.items.map(x=>x.id),[items[1].id]);assert.equal(await v.locator('.fine-filters:visible').count(),0);
    await list(h.boards.c,fine,null,()=>button(v,'清空搜索').click());await v.getByText(items[0].draft.name,{exact:true}).waitFor();assert.equal(await button(v.locator('.fine-filters'),single).getAttribute('aria-pressed'),'true');assert.equal(await card.count(),1);assert.match(await v.locator('.category-total').innerText(),/3\s*款/);
    return `实际创建三款，细类1款；分类总数3，返回保持同款与左栏 ${old}px，跨细类搜编号后清空恢复原筛选`;
  });
}
