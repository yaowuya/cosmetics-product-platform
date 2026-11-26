<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { queryValue } from '../browse.ts';
import { loadPreview, previewItem, validSelection, requestMatches } from '../preview-api.ts';
import { ApiError, message, type PreviewSnapshot } from '../../../shared/contracts.ts';
import ProductView from '../views/ProductView.vue';
import CaseView from '../views/CaseView.vue';
import PageContent from '../views/PageContent.vue';

const record=ref<PreviewSnapshot|null>(null), error=ref(''),loading=ref(false),card=ref(false);
const mapped=computed(()=>record.value?previewItem(record.value):null);
const sections={home_posters:'home',catalog_cover:'catalog',directory:'directory',case_header:'cases',services:'contact',business_contact:'contact'} as const;
const section=computed(()=>sections[record.value?.config_slot as keyof typeof sections]);
const body=computed(()=>{const snap=record.value;const value=mapped.value?.body??{};return snap?.config_slot==='services'?{services:value}:snap?.config_slot==='business_contact'?{business_contact:value}:value;});
let current={id:'',revision:'',generation:0}, abort:AbortController|undefined;
/** Clear the old DOM before issuing a private request; ignore both stale successes and failures. */
async function load(){abort?.abort();record.value=null;error.value='';loading.value=false;
 const target={id:queryValue('id'),revision:queryValue('revision'),generation:current.generation+1};current=target;card.value=queryValue('mode')==='card';
 if(!validSelection(target.id,target.revision)){error.value='预览地址无效，请从后台编辑页重新打开。';return;}
 loading.value=true;abort=new AbortController();
 try{const data=await loadPreview(target.id,target.revision,abort.signal);if(requestMatches(current,target))record.value=data;}
 catch(cause){if(requestMatches(current,target))error.value=cause instanceof ApiError&&cause.status===409?'草稿已变化。请返回编辑页，核对并重新打开当前修订。':message(cause);}
 finally{if(requestMatches(current,target))loading.value=false;}}
onMounted(()=>{void load();window.addEventListener('popstate',load);});
onBeforeUnmount(()=>{current={...current,generation:current.generation+1};abort?.abort();window.removeEventListener('popstate',load);});
</script>
<template><main class="mobile-detail preview-page"><p v-if="loading" role="status" class="h5-empty">正在核对保存的修订…</p><div v-else-if="error" role="alert" class="h5-empty">{{error}}</div><template v-else-if="record&&mapped"><div class="preview-stamp">草稿预览 · 修订 {{record.revision}}</div><ProductView v-if="record.kind==='product'" :item="mapped" :mode="card?'card':'detail'" preview/><CaseView v-else-if="record.kind==='case'" :item="mapped" mode="detail" preview/><PageContent v-else-if="section" :section="section" :body="body" preview/></template></main></template>
