<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { CASE_KEY, inputText, prefs, queryValue, remember } from '../browse.ts';
import { publicGet } from '../public-api.ts';
import { ApiError, message, rows, text, withQuery, type Body, type Page, type PublicItem, type PublicPage } from '../../../shared/contracts.ts';
import CaseView from '../views/CaseView.vue';
import PageContent from '../views/PageContent.vue';
import ShowcaseNav from '../views/ShowcaseNav.vue';

const detailRoute=location.pathname.replace(/\/$/,'')==='/cases/detail', detail=ref<PublicItem|null>(null);
const header=ref<Body>({}), filter=ref(''),q=ref(''),items=ref<PublicItem[]>([]),total=ref(0),page=ref(1),content=ref<HTMLElement|null>(null);
const choices=computed(()=>rows(header.value.filters)), loading=ref(true),error=ref('');
const saved=prefs(CASE_KEY,{filter:'',q:'',scroll:0});let generation=0,timer:ReturnType<typeof setTimeout>|undefined;
function persist(){if(!detailRoute)remember(CASE_KEY,{filter:filter.value,q:q.value,scroll:content.value?.scrollTop??0});}
async function list(append=false){clearTimeout(timer);const run=++generation;loading.value=true;error.value=''; const target=append?page.value+1:1;if(!append){items.value=[];page.value=1;total.value=0;}
 try{const response=await publicGet<Page<PublicItem>>(withQuery('/api/public/cases',{tag:filter.value,q:q.value.trim(),page:target,page_size:20}));if(run!==generation||!response)return;items.value=append?[...items.value,...response.items]:response.items;total.value=response.total;page.value=target;}catch(cause){if(run===generation)error.value=message(cause);}finally{if(run===generation)loading.value=false;}}
async function load(){error.value='';loading.value=true;try{if(detailRoute){const id=queryValue('id');if(!/^[1-9]\d*$/.test(id))throw new ApiError(404,'not_found','内容不存在');detail.value=await publicGet<PublicItem>(`/api/public/cases/${id}`)??null;return;}
 header.value=(await publicGet<PublicPage>('/api/public/pages/cases'))?.body??{};filter.value=choices.value.some(row=>row.key===saved.filter)?saved.filter:'';q.value=saved.q;await list();await nextTick();if(content.value)content.value.scrollTop=saved.scroll;
 }catch(cause){error.value=message(cause);}finally{loading.value=false;}}
function search(value:string){++generation;clearTimeout(timer);q.value=value;loading.value=true;items.value=[];persist();timer=setTimeout(()=>void list(),160);}
function select(value:string){filter.value=value;persist();void list();}
function reset(){q.value='';select('');}
onMounted(load);onBeforeUnmount(()=>{++generation;clearTimeout(timer);persist();});
</script>
<template>
 <div class="mobile-page"><main ref="content" class="mobile-main cases-page" @scroll="persist">
  <template v-if="detailRoute"><CaseView v-if="detail" :item="detail" mode="detail"/><div v-else class="h5-empty" :role="error?'alert':'status'">{{error||'正在加载案例…'}} <a v-if="error" href="/cases" class="h5-soft">返回品牌案例</a></div></template>
  <template v-else><PageContent section="cases" :body="header"/><div class="cases-tools"><label class="h5-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg><input :value="q" type="search" aria-label="搜索品牌、产品或功效案例" placeholder="搜索品牌、产品或功效案例" @input="search(inputText($event))"><component :is="'button'" v-if="q" type="button" aria-label="清空案例搜索" @click.prevent="reset">×</component></label>
  <nav class="case-filters" aria-label="案例分类"><component :is="'button'" type="button" :aria-pressed="!filter" @click="select('')">精选案例</component><component :is="'button'" v-for="entry in choices" :key="text(entry.key)" type="button" :aria-pressed="filter===entry.key" @click="select(text(entry.key))">{{text(entry.label)}}</component></nav></div>
  <section class="case-results"><div v-if="error" class="h5-empty" role="alert">{{error}} <component :is="'button'" type="button" class="h5-soft" @click="load">重试</component></div><template v-else><CaseView v-if="items[0]" mode="featured" :item="items[0]"/><template v-if="items.length>1"><h2 class="cases-grid-title">更多品牌案例</h2><div class="case-grid"><CaseView v-for="entry in items.slice(1)" :key="entry.id" :item="entry" mode="card"/></div></template><p v-if="loading" class="h5-empty" role="status">正在加载案例…</p><div v-else-if="!items.length" class="h5-empty"><strong>{{q?'没有找到相关案例':'暂无展示案例'}}</strong><component :is="'button'" v-if="q||filter" type="button" class="h5-soft" @click="reset">重新查找</component></div><component :is="'button'" v-else-if="items.length<total" class="h5-more" type="button" @click="list(true)">加载更多</component></template></section></template>
 </main><ShowcaseNav v-if="!detailRoute" current="cases"/></div>
</template>
