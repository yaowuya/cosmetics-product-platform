<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ApiError, message, text, type Issue, type Item, type Receipt, type ReleaseCheck } from '../../../shared/contracts.ts';
import { ambiguous, newAttempt, publishAttempt, reconcileAttempt, releaseFieldLabel, type Attempt } from '../batch.ts';
import { account, request } from '../session.ts';

const props=defineProps<{item:Item;dirty?:boolean;direct?:boolean;title?:string}>();
const emit=defineEmits<{changed:[];cancel:[];published:[receipt:Receipt]}>();
const report=ref<ReleaseCheck|null>(null),attempt=ref<Attempt|null>(null),result=ref<Receipt|null>(null);
const busy=ref(false),error=ref(''),unknown=ref(false);
const issues=ref<Issue[]>([]),attemptOwner=ref('');
const exact=computed(()=>report.value?.eligible&&report.value.id===props.item.id&&report.value.revision===props.item.revision&&!props.dirty);
const directTitle = computed(() => props.title || text(props.item.draft?.name) || text(props.item.draft?.product_name)
  || (props.item.kind === 'case' ? '当前案例' : '当前产品'));
const canSubmit = computed(() => Boolean(account.value?.can_publish && props.item.draft && !props.dirty
  && !busy.value && !unknown.value && (props.direct || exact.value)));
const sameOwner = computed(() => !props.direct || attemptOwner.value === account.value?.id);
const mayRecover = computed(() => Boolean(sameOwner.value && account.value?.can_publish));
const canRecover = computed(() => Boolean(attempt.value && !busy.value && mayRecover.value));
watch(()=>[props.item.id,props.item.revision],()=>{report.value=null;if(!unknown.value&&!busy.value)attempt.value=null;});
const diff=computed(()=>[...new Set([...Object.keys(props.item.live??{}),...Object.keys(props.item.draft??{})])].filter(key=>JSON.stringify(props.item.live?.[key])!==JSON.stringify(props.item.draft?.[key])));
function valueOf(value:unknown):string {
  if(value==null||value==='')return '未设置';
  if(Array.isArray(value))return value.map(row=>typeof row==='object'&&row!==null?row.name??row.title??row.label??row.id??'条目':String(row)).join('、')||'无';
  return typeof value==='boolean'?(value?'是':'否'):String(value);
}

/** Request a read-only check for this saved revision. */
async function check(){busy.value=true;error.value='';result.value=null;try{report.value=await request(`/api/admin/items/${props.item.id}/check`,'POST',{expected_revision:props.item.revision});}catch(cause){report.value=null;error.value=message(cause);}finally{busy.value=false;}}

/** Keep uncertain results available for recovery while the original publisher can still act. */
function canDismiss() { return !busy.value && (!unknown.value || (props.direct && !mayRecover.value)); }
defineExpose({canDismiss});
function cancel() { if (canDismiss()) emit('cancel'); }

function showFailure(cause: unknown) {
  error.value = message(cause);
  issues.value = cause instanceof ApiError && cause.status === 422 ? cause.issues : [];
}

function complete(receipt: Receipt) {
  result.value = receipt;
  unknown.value = false;
  report.value = null;
  error.value = '';
  issues.value = [];
  if (props.direct) emit('published',receipt);
  else emit('changed');
}

/** A retry can only resend the original request for the same saved draft and publisher. */
function confirmRetry(current: Attempt) {
  if (!sameOwner.value || !account.value?.can_publish || current.id !== props.item.id || current.revision !== props.item.revision) return false;
  return props.direct || globalThis.confirm('尚未查到原回执。使用原请求号和修订重新提交？');
}

async function verify(retry=false){
  const current=attempt.value;
  if(!current||!canRecover.value)return;
  busy.value=true;
  let receipt: Receipt | null = null;
  let retried = false;
  try{
    receipt=await reconcileAttempt(current,()=>{
      retried = retry && confirmRetry(current);
      return retried;
    });
    if(!receipt)error.value='尚未查到原回执。不要重复提交新请求。';
  }catch(cause){
    // The retry checks the original receipt under lock before these business rejections.
    if(props.direct && retried && cause instanceof ApiError
      && ['draft_conflict','cannot_publish','item_not_found','request_conflict'].includes(cause.code)){
      unknown.value = false;
    }
    showFailure(cause);
  }finally{busy.value=false;}
  if(receipt)complete(receipt);
}

/** In the dialog the operator already confirmed the action; the server checks the saved revision. */
async function commit(){
  if(!canSubmit.value||(!props.direct&&!globalThis.confirm('确认发布当前已检查的草稿版本？')))return;
  const current=newAttempt(props.item);
  attempt.value=current;
  attemptOwner.value=account.value?.id ?? '';
  busy.value=true;error.value='';issues.value=[];
  let receipt: Receipt | undefined;
  try{receipt=await publishAttempt(current);}
  catch(cause){
    unknown.value=ambiguous(cause);
    if(unknown.value)error.value='结果暂不明确，先核对原回执。';
    else showFailure(cause);
  }
  finally{busy.value=false;}
  if(receipt)complete(receipt);
}
</script>

<template>
 <section :class="direct ? 'stack' : 'panel stack'" :aria-label="direct ? '确认发布' : '发布检查'">
  <template v-if="direct">
   <p>确认发布「{{ directTitle }}」的当前草稿？</p>
   <small class="muted">草稿修订 {{ item.revision }}</small>
  </template>
  <template v-else>
   <div class="section-head"><h2>发布检查</h2><span class="pill">修订 {{ item.revision }}</span></div>
   <p v-if="!item.draft" class="muted">当前没有待发布草稿。</p><p v-else-if="dirty" class="muted">先保存未提交的修改，再检查此版本。</p>
   <div v-if="diff.length && item.draft" class="release-diff"><table><caption>线上与草稿的差异</caption><thead><tr><th>字段</th><th>线上版本</th><th>待发布草稿</th></tr></thead><tbody><tr v-for="key in diff" :key="key"><th scope="row">{{releaseFieldLabel(key)}}</th><td>{{valueOf(item.live?.[key])}}</td><td>{{valueOf(item.draft?.[key])}}</td></tr></tbody></table></div>
  </template>
  <div v-if="error" role="alert" class="inline-error">
   {{ error }}
   <ul v-if="direct && issues.length"><li v-for="issue in issues" :key="`${issue.field}:${issue.reason}`">{{ releaseFieldLabel(issue.field) }}：{{ issue.reason }}</li></ul>
   <p v-if="direct && unknown && !mayRecover">发布结果待核对，请联系有发布权限的同事。</p>
  </div>
  <div v-if="!direct && report" :class="report.eligible?'notice':'inline-error'" role="status"><strong>{{ report.eligible?'检查通过，可以确认发布':'草稿缺项，不能发布' }}</strong><ul v-if="report.issues.length"><li v-for="issue in report.issues" :key="`${issue.field}:${issue.reason}`">{{ releaseFieldLabel(issue.field) }}：{{ issue.reason }}</li></ul><small v-if="report.place_ids.length">涉及 {{ report.place_ids.length }} 个展示位置</small></div>
  <p v-if="result" class="notice" role="status">已发布版本 {{ result.seq }}，回执 {{ result.request_key }}</p>
  <div class="toolbar" :class="{'direct-release-actions':direct}">
   <button v-if="direct" type="button" class="btn" :disabled="!canDismiss()" @click="cancel">取消</button>
   <button v-else type="button" class="btn" :disabled="busy || !account?.can_publish || !item.draft || dirty || unknown" @click="check">检查发布</button>
   <button type="button" class="btn primary" :disabled="!canSubmit" @click="commit">确认发布</button>
   <button v-if="unknown" type="button" class="btn" :disabled="!canRecover" @click="verify()">核对回执</button>
   <button v-if="unknown" type="button" class="btn" :disabled="!canRecover || item.revision!==attempt?.revision" @click="verify(true)">使用原请求重试</button>
  </div>
 </section>
</template>

<style scoped>
.release-diff { min-width: 0; overflow-x: auto; }
.release-diff table { width: 100%; border-collapse: collapse; table-layout: fixed; text-align: left; }
.release-diff caption { padding-bottom: 8px; color: var(--muted); text-align: left; }
.release-diff th, .release-diff td { padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; white-space: pre-line; }
.release-diff thead { background: var(--soft); }
.release-diff th:first-child { width: 24%; }
.direct-release-actions { justify-content: flex-end; }
</style>
