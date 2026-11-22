import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {editableBody,draftImage} from '../admin/src/editor.ts';

test('首次草稿、线上版与编辑缓存不共享对象',()=>{
 const item={live:{name:'线上',parts:['保湿']},draft:null}; const edit=editableBody(item);edit.parts.push('调整');
 assert.deepEqual(item.live.parts,['保湿']); assert.deepEqual(editableBody({...item,draft:{}}),{});
});
test('素材地址不隐式公开：保存稿走带条目和修订的私有路径',()=>{
 assert.equal(draftImage({id:'7',revision:'3',draft:{},live_id:null},'6',{}),'/api/admin/media/6?item_id=7&revision=3');
 assert.equal(draftImage(null,'6',{'6':'/api/admin/media/6'}),'/api/admin/media/6');
 assert.equal(draftImage(null,'https://unrelated.invalid',{}),'');
});
