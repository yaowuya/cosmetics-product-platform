<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { message, type CatalogNode, type Item, type ReleaseCheck } from '../../../shared/contracts.ts';
import { ambiguous, newAttempt, productCaption, publishAttempt, readAttempts, toConfirm, reconcileAttempt, releaseFieldLabel, type Attempt } from '../batch.ts';
import { nodePath } from '../editor.ts';
import { account, request } from '../session.ts';

const props=defineProps<{selected:Item[];nodes:CatalogNode[];mode:'append'|'check'|'recover'}>();
const emit=defineEmits<{changed:[];pending:[]}>();
type CheckedProduct = ReleaseCheck & { label: string; reason: string };
type BatchResult = { id: string; label?: string; status: string; message?: string };
const positions=ref<string[]>([]), checks=ref<CheckedProduct[]>([]), results=ref<BatchResult[]>([]), pending=ref<Attempt[]>([]);
const captions=computed(()=>new Map(props.selected.map(item=>[item.id, productCaption(item)])));
const busy=ref(false),error=ref('');
const ownerKey=computed(()=>account.value?.can_publish ? account.value.id : '');
const confirmed=computed(()=>toConfirm(checks.value,props.selected));
const rows=computed(()=>props.selected.map(item=>({id:item.id,expected_revision:item.revision})));
const fingerprint=computed(()=>rows.value.map(row=>`${row.id}:${row.expected_revision}`).join('|'));
let active=true;
watch(fingerprint,()=>checks.value=[]);
watch(ownerKey, key=>{pending.value=key?readAttempts(key):[];checks.value=[];results.value=[];},{immediate:true});
function store(attempts:Attempt[]){
  pending.value=attempts;
  if(ownerKey.value){const key=`showcase/pending-receipts/${ownerKey.value}`;if(attempts.length)localStorage.setItem(key,JSON.stringify(attempts));else localStorage.removeItem(key);}
  emit('pending');
}
function warnLeave(event:BeforeUnloadEvent){if(busy.value){event.preventDefault();event.returnValue='';}}
onMounted(()=>{window.addEventListener('beforeunload',warnLeave);if(props.mode==='check'&&ownerKey.value&&!pending.value.length)void check();});
onBeforeRouteLeave(()=>!busy.value||globalThis.confirm('正在处理批次。离开后未发起的款项不会继续，已提交的请核对回执。'));
onBeforeUnmount(()=>{active=false;window.removeEventListener('beforeunload',warnLeave);});
function caption(id:string){return captions.value.get(id) ?? `产品 ${id}`;}

/** Append positions without leaking a draft edit into the live release. */
async function append(){
 if(!positions.value.length||!rows.value.length)return;
 if(!globalThis.confirm(`给已选 ${rows.value.length} 款产品追加展示位置？仅保存草稿。`))return;
 busy.value=true;error.value='';checks.value=[];try{const data=await request<{items:{id:string;status:string;issues:{reason:string}[]}[]}>('/api/admin/products/batch-append','POST',{items:rows.value,node_ids:positions.value});results.value=data.items.map(row=>({...row,message:row.issues.map(issue=>issue.reason).join('；')}));emit('changed');}catch(cause){error.value=message(cause);}finally{busy.value=false;}
}
/** 检查只保存当次选中产品的展示快照；过期修订或其他账号的响应不能用于发布。 */
async function check(){
 const owner=ownerKey.value, key=fingerprint.value, labels=captions.value;
 if(busy.value || !owner || !labels.size || pending.value.length)return;
 busy.value=true; error.value=''; checks.value=[]; results.value=[];
 try{
   const data=await request<{items:ReleaseCheck[]}>('/api/admin/products/batch-check','POST',{items:rows.value});
   if(!active || owner!==ownerKey.value || key!==fingerprint.value)return;
   checks.value=data.items.flatMap(row=>{
     const label=labels.get(row.id);
     const reason=row.issues.map(issue=>`${releaseFieldLabel(issue.field)}：${issue.reason}`).join('；');
     return label===undefined ? [] : [{...row,label,reason}];
   });
 }catch(cause){if(active && owner===ownerKey.value)error.value=message(cause);}finally{busy.value=false;}
}

/** 仅在真正发起时分配并登记请求号；结果不明时保留原号，后续合格行保持「未发起」。 */
async function publishOne(check:ReleaseCheck, result:BatchResult, owner:string):Promise<boolean>{
 const attempt=newAttempt({id:check.id, revision:check.revision, kind:'product'});
 store([...pending.value,attempt]);
 result.status='发布中';
 try{
   const receipt=await publishAttempt(attempt);
   if(ownerKey.value!==owner)return false;
   result.status='已发布'; result.message=`版本 ${receipt.seq}`;
 }catch(cause){
   if(ownerKey.value!==owner)return false;
   if(ambiguous(cause)){
     result.status='待核对'; result.message='该请求可能已提交；请先核对原回执。'; return false;
   }
   result.status='未发布'; result.message=message(cause);
 }
 store(pending.value.filter(row=>row.key!==attempt.key));
 return true;
}

/** 一份结果覆盖本次选择，只有通过原修订校验的行进入发布队列。 */
async function publish(){
 const publisher=ownerKey.value;
 const queue=new Map(confirmed.value.map(row=>[row.id,row]));
 if(busy.value || !publisher || !queue.size || pending.value.length || !globalThis.confirm(`确认逐款发布 ${queue.size} 款已经检查通过的产品？`))return;
 busy.value=true; error.value='';
 results.value=checks.value.filter(row=>captions.value.has(row.id)).map(row=>({
   id:row.id, label:row.label, status:queue.has(row.id)?'未发起':'已跳过', message:row.reason,
 }));
 checks.value=[];
 try{
   for(const result of results.value){
     if(!active || ownerKey.value!==publisher)break;
     const checked=queue.get(result.id);
     if(checked && !await publishOne(checked,result,publisher))break;
   }
 }finally{busy.value=false;if(active && ownerKey.value===publisher)emit('changed');}
}
function pendingResult(attempt:Attempt){return results.value.find(row=>row.id===attempt.id && row.status==='待核对');}
async function verify(attempt:Attempt,retry=false){
 const owner=ownerKey.value;
 if(busy.value || !owner)return;
 busy.value=true;error.value='';
 try{
   const receipt=await reconcileAttempt(attempt,()=>retry&&active&&ownerKey.value===owner&&globalThis.confirm('没有查到原回执。使用相同的请求号和修订手动重试？'));
   if(!active || ownerKey.value!==owner)return;
   if(!receipt){error.value='尚未查到原回执；仍是待核对结果。';return;}
   store(pending.value.filter(row=>row.key!==attempt.key));
   const result=pendingResult(attempt), released={status:'已发布',message:`版本 ${receipt.seq}`};
   if(result)Object.assign(result,released);
   else results.value.push({id:attempt.id,label:caption(attempt.id),...released});
   emit('changed');
 }catch(cause){if(active && ownerKey.value===owner)error.value=message(cause);}finally{busy.value=false;}
}
const statusText:Record<string,string>={changed:'草稿已更新',unchanged:'位置已存在',conflict:'修订冲突',invalid:'无效位置'};
</script>

<template>
<section class="panel stack" aria-label="批量操作"><div class="section-head"><h2>批量操作</h2><span class="pill">已选 {{ selected.length }} 款</span></div>
 <p v-if="error" class="inline-error" role="alert">{{error}}</p>
 <details v-if="mode==='append'" open><summary>追加展示位置（仅保存草稿）</summary><div class="stack"><label v-for="node in nodes.filter(row=>row.enabled!==false)" :key="node.id"><input v-model="positions" type="checkbox" :value="node.id"> {{nodePath(nodes,node.id)}}</label><button type="button" class="btn" :disabled="busy||!positions.length||!selected.length" @click="append">追加展示位置</button></div></details>
 <div v-if="account?.can_publish" class="toolbar"><button type="button" class="btn" :disabled="busy||!selected.length||Boolean(pending.length)" @click="check">批量发布检查</button><button v-if="checks.length" type="button" class="btn primary" :disabled="busy||!confirmed.length||Boolean(pending.length)" @click="publish">发布这 {{ confirmed.length }} 款</button></div>
 <div v-for="row in checks" :key="row.id" class="list-line"><strong>{{row.label}}</strong><span>{{ row.eligible?'可发布':row.reason }}</span></div>
 <div v-for="result in results" :key="`${result.id}:${result.status}`" class="list-line"><strong>{{result.label ?? caption(result.id)}}</strong><span>{{statusText[result.status]??result.status}} {{result.message}}</span></div>
 <div v-for="attempt in pending" :key="attempt.key" class="notice toolbar"><strong>{{pendingResult(attempt)?.label ?? caption(attempt.id)}} · 待核对</strong><button type="button" class="btn" :disabled="busy||!account?.can_publish" @click="verify(attempt)">核对回执</button><button type="button" class="btn" :disabled="busy||!account?.can_publish" @click="verify(attempt,true)">使用原请求重试</button></div>
</section>
</template>
