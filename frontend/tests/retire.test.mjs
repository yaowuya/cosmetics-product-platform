import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canDelete, canArchive, nodePath, affectedCaseLabel } from '../admin/src/editor.ts';

test('下架和归档前可以区分同品牌的不同案例及未命名草稿',()=>{
 const entries=[{id:'17',brand_name:'同一品牌',product_name:'清润乳'},{id:'18',brand_name:'同一品牌',product_name:'舒缓霜'}];
 assert.deepEqual(entries.map(affectedCaseLabel),['同一品牌 · 清润乳（#17）','同一品牌 · 舒缓霜（#18）']);
 assert.equal(affectedCaseLabel({id:'19',product_name:'清润乳'}),'清润乳（#19）');
 assert.equal(affectedCaseLabel({id:'20',brand_name:'同一品牌',product_name:null}),'同一品牌 · 未命名案例（#20）');
 assert.equal(affectedCaseLabel({id:'21'}),'未命名案例（#21）');
});

test('归档和删除按历史分别判断，而不是只看线上指针',()=>{
  assert.equal(canDelete({draft:{},has_history:false,live_id:null,archived_at:null}),true);
  assert.equal(canDelete({draft:{},has_history:true,live_id:null,archived_at:null}),false);
  assert.equal(canArchive({has_history:true,live_id:null,archived_at:null}),true);
  assert.equal(canArchive({has_history:true,live_id:'1',archived_at:null}),false);
});
test('分类列显示完整路径，不把节点号当名称',()=>{
 const nodes=[{id:'1',name:'护肤'},{id:'2',name:'清洁',parent_id:'1'},{id:'3',name:'洁面',parent_id:'2'}];
 assert.equal(nodePath(nodes,'3'),'护肤 › 清洁 › 洁面');
});
