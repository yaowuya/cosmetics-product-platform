import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {restoreConfirmation} from '../admin/src/editor.ts';

test('历史恢复使用实际审阅的修订，有工作稿才确认覆盖，不生成发布请求',()=>{
 assert.deepEqual(restoreConfirmation({revision:'12',draft:{}},true),{expected_revision:'12',confirm_overwrite:true});
 assert.equal(restoreConfirmation({revision:'12',draft:{}},false),null);
 assert.deepEqual(restoreConfirmation({revision:'3',draft:null},false),{expected_revision:'3',confirm_overwrite:false});
});
