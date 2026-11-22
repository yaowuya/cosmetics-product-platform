import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moveWithinParent } from '../admin/src/editor.ts';

test('目录排序只调整同一父节点的兄弟，不改变 ID 或其他板块的顺序',()=>{
 const nodes=[{id:'a',parent_id:'p',sort_order:0},{id:'b',parent_id:'p',sort_order:1},{id:'c',parent_id:'q',sort_order:0}];
 const moved=moveWithinParent(nodes,'b',-1);
 assert.deepEqual(moved.map(n=>[n.id,n.parent_id,n.sort_order]),[['a','p',1],['b','p',0],['c','q',0]]);
 assert.equal(nodes[1].sort_order,1);assert.equal(moveWithinParent(nodes,'a',-1),nodes);
});
