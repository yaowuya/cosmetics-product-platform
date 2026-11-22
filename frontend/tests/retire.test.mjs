import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canDelete, canArchive, nodePath } from '../admin/src/editor.ts';

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
