<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { message, text, type CatalogNode, type Item, type ReleaseCheck } from '../../../shared/contracts.ts';
import { ambiguous, newAttempt, publishAttempt, readAttempts, toConfirm, reconcileAttempt, type Attempt } from '../batch.ts';
import { nodePath } from '../editor.ts';
import { account, request } from '../session.ts';

const props=defineProps<{selected:Item[];nodes:CatalogNode[];mode:'append'|'check'|'recover'}>();
const emit=defineEmits<{changed:[];pending:[]}>();
const positions=ref<string[]>([]), checks=ref<ReleaseCheck[]>([]), results=ref<{id:string;status:string;message?:string}[]>([]), pending=ref<Attempt[]>([]);
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
function name(id:string){const item=props.selected.find(item=>item.id===id);return text(item?.summary?.name??item?.draft?.name??item?.live?.name,`产品 ${id}`);}

/** Append positions without leaking a draft edit into the live release. */
async function append(){
 if(!positions.value.length||!rows.value.length)return;
 if(!globalThis.confirm(`给已选 ${rows.value.length} 款产品追加展示位置？仅保存草稿。`))return;
 busy.value=true;error.value='';checks.value=[];try{const data=await request<{items:{id:string;status:string;issues:{reason:string}[]}[]}>('/api/admin/products/batch-append','POST',{items:rows.value,node_ids:positions.value});results.value=data.items.map(row=>({...row,message:row.issues.map(issue=>issue.reason).join('；')}));emit('changed');}catch(cause){error.value=message(cause);}finally{busy.value=false;}
}
async function check(){
 const key=fingerprint.value;busy.value=true;error.value='';results.value=[];
 try{const data=await request<{items:ReleaseCheck[]}>('/api/admin/products/batch-check','POST',{items:rows.value});if(key===fingerprint.value)checks.value=data.items;}
 catch(cause){error.value=message(cause);}finally{busy.value=false;}
}

/** Stop on unknown outcomes: unstarted products are not silently submitted or resumed. */
async function publish(){
 const queue=confirmed.value.map(row=>newAttempt({id:row.id,revision:row.revision,kind:'product'}));
 if(!queue.length||pending.value.length||!globalThis.confirm(`确认逐款发布 ${queue.length} 款已经检查通过的产品？`))return;
 busy.value=true;error.value='';results.value=[];
 const publisher=ownerKey.value;
 try{for(const [index,attempt] of queue.entries()){
   if(!active || ownerKey.value!==publisher || !publisher)break;
   store([...pending.value,attempt]);
   try{const receipt=await publishAttempt(attempt);if(ownerKey.value===publisher)store(pending.value.filter(row=>row.key!==attempt.key));results.value.push({id:attempt.id,status:'已发布',message:`版本 ${receipt.seq}`});}
   catch(cause){if(ambiguous(cause)){results.value.push({id:attempt.id,status:'待核对',message:'该请求可能已提交；请先核对原回执。'});for(const unused of queue.slice(index+1))results.value.push({id:unused.id,status:'未发起'});break;}if(ownerKey.value===publisher)store(pending.value.filter(row=>row.key!==attempt.key));results.value.push({id:attempt.id,status:'未发布',message:message(cause)});}
 }}finally{checks.value=[];busy.value=false;if(active)emit('changed');}
}
async function verify(attempt:Attempt,retry=false){
 busy.value=true;error.value='';const owner=ownerKey.value;try{const receipt=await reconcileAttempt(attempt,()=>retry&&active&&Boolean(owner)&&ownerKey.value===owner&&globalThis.confirm('没有查到原回执。使用相同的请求号和修订手动重试？'));
 if(!active||!owner||ownerKey.value!==owner)return;
 if(receipt){store(pending.value.filter(row=>row.key!==attempt.key));results.value.push({id:attempt.id,status:'已发布',message:`版本 ${receipt.seq}`});emit('changed');}else error.value='尚未查到原回执；仍是待核对结果。';
 }catch(cause){error.value=message(cause);}finally{busy.value=false;}
}
const statusText:Record<string,string>={changed:'草稿已更新',unchanged:'位置已存在',conflict:'修订冲突',invalid:'无效位置'};
</script>

<template>
<section class="panel stack" aria-label="批量操作"><div class="section-head"><h2>批量操作</h2><span class="pill">已选 {{ selected.length }} 款</span></div>
 <p v-if="error" class="inline-error" role="alert">{{error}}</p>
 <details v-if="mode==='append'" open><summary>追加展示位置（仅保存草稿）</summary><div class="stack"><label v-for="node in nodes.filter(row=>row.enabled!==false)" :key="node.id"><input v-model="positions" type="checkbox" :value="node.id"> {{nodePath(nodes,node.id)}}</label><button type="button" class="btn" :disabled="busy||!positions.length||!selected.length" @click="append">追加展示位置</button></div></details>
 <div v-if="account?.can_publish" class="toolbar"><button type="button" class="btn" :disabled="busy||!selected.length||Boolean(pending.length)" @click="check">批量发布检查</button><button v-if="checks.length" type="button" class="btn primary" :disabled="busy||!confirmed.length||Boolean(pending.length)" @click="publish">发布这 {{ confirmed.length }} 款</button></div>
 <div v-for="row in checks" :key="row.id" class="list-line"><strong>{{name(row.id)}}</strong><span>{{ row.eligible?'可发布':row.issues.map(issue=>issue.reason).join('；') }}</span></div>
 <div v-for="result in results" :key="`${result.id}:${result.status}`" class="list-line"><strong>{{name(result.id)}}</strong><span>{{statusText[result.status]??result.status}} {{result.message}}</span></div>
 <div v-for="attempt in pending" :key="attempt.key" class="notice toolbar"><strong>{{name(attempt.id)}} · 待核对</strong><button type="button" class="btn" :disabled="busy||!account?.can_publish" @click="verify(attempt)">核对回执</button><button type="button" class="btn" :disabled="busy||!account?.can_publish" @click="verify(attempt,true)">使用原请求重试</button></div>
</section>
</template>
