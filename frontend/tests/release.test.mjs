import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {ApiError} from '../shared/contracts.ts';
import {ambiguous,newAttempt,toConfirm} from '../admin/src/batch.ts';

test('校验的是条目和修订，不会让后来的修改沿用旧结论',()=>{
 const checked={id:'9',revision:'2',eligible:true};
 assert.deepEqual(toConfirm([checked],[{id:'9',revision:'3'}]),[]);
 assert.deepEqual(toConfirm([checked],[{id:'8',revision:'2'}]),[]);
 const first=newAttempt({id:'9',revision:'2',kind:'product'});assert.equal(first.id,'9');
 assert.notEqual(newAttempt({id:'9',revision:'2',kind:'product'}).key,first.key);
});
test('丢失回执与明确的拒绝不同',()=>{
 assert.equal(ambiguous(new TypeError('network')),true);
 assert.equal(ambiguous(new ApiError(409,'conflict','草稿已变化')),false);
});

test('单条与批量重试先查原回执，只在未查到且人工确认后写入',async t=>{
 const {reconcileAttempt}=await import('../admin/src/batch.ts');
 const {account}=await import('../admin/src/session.ts');
 const attempt={id:'9',kind:'product',revision:'2',key:'original-key'};
 const receipt={id:'9',revision:'3',release_id:'11',seq:1,request_key:attempt.key};
 const log=[],saved=account.value;let found=true;
 account.value={id:'3',csrf_token:'unit-test-token',can_publish:true};t.after(()=>{account.value=saved;});
 t.mock.method(globalThis,'fetch',async(url,init)=>{
   log.push(init.method);
   if(init.method==='GET'){
     assert.equal(new URL(url,'https://unit.invalid').searchParams.get('request_key'),attempt.key);
     return Response.json({items:found?[{target_id:'9',target_kind:'product',request_key:attempt.key,details:{source_revision:'2',receipt}}]:[]});
   }
   assert.equal(url,'/api/admin/items/9/publish');assert.deepEqual(JSON.parse(init.body),{expected_revision:'2',request_key:attempt.key});
   return Response.json(receipt);
 });
 assert.deepEqual(await reconcileAttempt(attempt,()=>assert.fail('已有回执不应再问发布')),receipt);
 found=false;assert.equal(await reconcileAttempt(attempt,()=>false),null);
 assert.deepEqual(await reconcileAttempt(attempt,()=>true),receipt);
 assert.deepEqual(log,['GET','GET','GET','POST']);
});
