import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptResponse, children, queryFor, refreshVisibleItems, selectBoard, inputText } from '../h5/src/browse.ts';

test('H5 搜索兼容 uni-input 与原生 DOM 事件，并保留手动删空',()=>{
  assert.equal(inputText({detail:{value:'CL-001'},currentTarget:{}}),'CL-001');
  assert.equal(inputText({detail:{value:''},target:{value:'原来'}}),'');
  assert.equal(inputText({target:{value:'案例'}}),'案例');
});

test('切换板块时恢复仍有效的分类、细筛与关键词，失效选择回退到首项', () => {
  const nodes = [
    {id:'1',level:'board',name:'甲',sort_order:0},{id:'2',level:'board',name:'乙',sort_order:1},
    {id:'3',level:'category',parent_id:'1',name:'一',sort_order:0},
    {id:'4',level:'subcategory',parent_id:'3',name:'细',sort_order:0},
    {id:'5',level:'category',parent_id:'2',name:'二',sort_order:0},
  ];
  const saved={category:'3',fine:'4',q:'编号',left:8,right:26};
  assert.deepEqual(selectBoard(nodes,'1',saved),saved);
  assert.equal(selectBoard(nodes,'2',saved).category,'5');
  assert.equal(selectBoard(nodes,'2',saved).fine,'');
  assert.deepEqual(children(nodes,'3').map(n=>n.id),['4']);
});
test('有关键词时查整个板块，无关键词才用细筛节点；过期响应不提交',()=>{
  const url=new URL(queryFor('1','3','配方'), 'https://example.invalid');
  assert.equal(url.searchParams.get('board_id'),'1');assert.equal(url.searchParams.get('node_id'),null);
  assert.equal(new URL(queryFor('1','3',''),url).searchParams.get('node_id'),'3');
  assert.equal(acceptResponse(1,2),false);
});

test('切回列表时按 API 上限刷新已展示的内容，过期后停止请求',async()=>{
  const items=Array.from({length:150},(_,index)=>({id:String(index+1),body:{}}));
  const calls=[];
  const readPage=async(page,size)=>{
    calls.push([page,size]);
    return {items:items.slice((page-1)*size,page*size),total:items.length,page,page_size:size};
  };

  const current=await refreshVisibleItems(120,readPage,()=>true);
  assert.deepEqual(calls,[[1,100],[2,100]]);
  assert.deepEqual(current,{items:items.slice(0,120),total:150});

  calls.length=0;
  const expired=await refreshVisibleItems(120,readPage,()=>calls.length===0);
  assert.equal(expired,undefined);
  assert.deepEqual(calls,[[1,100]]);
});
