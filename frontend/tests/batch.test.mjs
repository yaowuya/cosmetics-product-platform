import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeAttempts, toConfirm, matchesReceipt } from '../admin/src/batch.ts';

test('批量只确认仍在勾选且修订一致的合格款',()=>{
 const checks=[{id:'1',revision:'4',eligible:true},{id:'2',revision:'1',eligible:false},{id:'3',revision:'3',eligible:true}];
 assert.deepEqual(toConfirm(checks,[{id:'1',revision:'4'},{id:'2',revision:'1'},{id:'3',revision:'2'}]).map(r=>r.id),['1']);
});
test('待核单数据格式受限，回执与原键、原修订和对象对应',()=>{
 const a={id:'1',revision:'4',kind:'product',key:'one-key'};
 assert.deepEqual(decodeAttempts(JSON.stringify([a,{not:'valid'}])),[a]);
 assert.deepEqual(decodeAttempts('{}'),[]);
 const row={target_id:'1',target_kind:'product',request_key:'one-key',details:{source_revision:'4',receipt:{id:'1',request_key:'one-key',release_id:'8',seq:1,revision:'5'}}};
 assert.equal(matchesReceipt(a,row)?.release_id,'8');assert.equal(matchesReceipt({...a,revision:'1'},row),null);
});
