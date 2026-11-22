<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { message, type Item, type Receipt, type ReleaseCheck } from '../../../shared/contracts.ts';
import { ambiguous, newAttempt, publishAttempt, reconcileAttempt, type Attempt } from '../batch.ts';
import { account, request } from '../session.ts';

const props=defineProps<{item:Item;dirty?:boolean}>();
const emit=defineEmits<{changed:[]}>();
const report=ref<ReleaseCheck|null>(null),attempt=ref<Attempt|null>(null),result=ref<Receipt|null>(null);
const busy=ref(false),error=ref(''),unknown=ref(false);
const exact=computed(()=>report.value?.eligible&&report.value.id===props.item.id&&report.value.revision===props.item.revision&&!props.dirty);
watch(()=>[props.item.id,props.item.revision],()=>{report.value=null;if(!unknown.value)attempt.value=null;});
const diff=computed(()=>[...new Set([...Object.keys(props.item.live??{}),...Object.keys(props.item.draft??{})])].filter(key=>JSON.stringify(props.item.live?.[key])!==JSON.stringify(props.item.draft?.[key])));
const labels:Record<string,string>={name:'产品名称',title:'标题',benefit:'功效',ingredients:'核心成分',highlights:'产品亮点',formula_no:'配方编号',production_status:'生产状态',brand_name:'品牌名称',product_name:'案例产品名',highlight:'案例亮点',description:'说明',intro:'介绍',detail_asset_id:'产品详情长图',thumbnail_asset_id:'产品方图',cover_asset_id:'封面',short_benefit:'简短功效',place_ids:'展示位置',nodes:'板块与分类',poster_asset_ids:'首页海报',qr_asset_id:'商务二维码',image_asset_id:'案例图片',cards:'服务卡片',filters:'案例分类'};
function valueOf(value:unknown):string {
  if(value==null||value==='')return '未设置';
  if(Array.isArray(value))return value.map(row=>typeof row==='object'&&row!==null?row.name??row.title??row.label??row.id??'条目':String(row)).join('、')||'无';
  return typeof value==='boolean'?(value?'是':'否'):String(value);
}

/** Request a read-only check for this saved revision. */
async function check(){busy.value=true;error.value='';result.value=null;try{report.value=await request(`/api/admin/items/${props.item.id}/check`,'POST',{expected_revision:props.item.revision});}catch(cause){report.value=null;error.value=message(cause);}finally{busy.value=false;}}
async function verify(retry=false){
  const current=attempt.value;if(!current||busy.value||!account.value?.can_publish)return;
  busy.value=true;
  try{
    result.value=await reconcileAttempt(current,()=>retry && Boolean(account.value?.can_publish) && current.id===props.item.id && current.revision===props.item.revision && globalThis.confirm('尚未查到原回执。使用原请求号和修订重新提交？'));
    if(result.value){unknown.value=false;error.value='';emit('changed');}else error.value='尚未查到原回执。不要重复提交新请求。';
  }catch(cause){error.value=message(cause);}finally{busy.value=false;}
}
async function commit(){
  if(busy.value||!exact.value||!globalThis.confirm('确认发布当前已检查的草稿版本？'))return;
  attempt.value=newAttempt(props.item);
  busy.value=true;error.value='';const current=attempt.value;
  try{result.value=await publishAttempt(current);unknown.value=false;report.value=null;emit('changed');}
  catch(cause){unknown.value=ambiguous(cause);error.value=unknown.value?'结果暂不明确，先核对原回执。':message(cause);}
  finally{busy.value=false;}
}
</script>

<template>
 <section class="panel stack" aria-label="发布检查"><div class="section-head"><h2>发布检查</h2><span class="pill">修订 {{ item.revision }}</span></div>
  <p v-if="!item.draft" class="muted">当前没有待发布草稿。</p><p v-else-if="dirty" class="muted">先保存未提交的修改，再检查此版本。</p>
  <div v-if="diff.length && item.draft" class="release-diff"><table><caption>线上与草稿的差异</caption><thead><tr><th>字段</th><th>线上版本</th><th>待发布草稿</th></tr></thead><tbody><tr v-for="key in diff" :key="key"><th scope="row">{{labels[key]??key}}</th><td>{{valueOf(item.live?.[key])}}</td><td>{{valueOf(item.draft?.[key])}}</td></tr></tbody></table></div>
  <div v-if="error" role="alert" class="inline-error">{{ error }}</div>
  <div v-if="report" :class="report.eligible?'notice':'inline-error'" role="status"><strong>{{ report.eligible?'检查通过，可以确认发布':'草稿缺项，不能发布' }}</strong><ul v-if="report.issues.length"><li v-for="issue in report.issues" :key="`${issue.field}:${issue.reason}`">{{ labels[issue.field]??issue.field }}：{{ issue.reason }}</li></ul><small v-if="report.place_ids.length">涉及 {{ report.place_ids.length }} 个展示位置</small></div>
  <p v-if="result" class="notice" role="status">已发布版本 {{ result.seq }}，回执 {{ result.request_key }}</p>
  <div class="toolbar"><button type="button" class="btn" :disabled="busy || !account?.can_publish || !item.draft || dirty || unknown" @click="check">检查发布</button><button type="button" class="btn primary" :disabled="busy || !account?.can_publish || !exact || unknown" @click="commit()">确认发布</button><button v-if="unknown" type="button" class="btn" :disabled="busy || !account?.can_publish" @click="verify()">核对回执</button><button v-if="unknown" type="button" class="btn" :disabled="busy || !account?.can_publish || item.revision!==attempt?.revision" @click="verify(true)">使用原请求重试</button></div>
 </section>
</template>

<style scoped>
.release-diff { min-width: 0; overflow-x: auto; }
.release-diff table { width: 100%; border-collapse: collapse; table-layout: fixed; text-align: left; }
.release-diff caption { padding-bottom: 8px; color: var(--muted); text-align: left; }
.release-diff th, .release-diff td { padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; white-space: pre-line; }
.release-diff thead { background: var(--soft); }
.release-diff th:first-child { width: 24%; }
</style>
