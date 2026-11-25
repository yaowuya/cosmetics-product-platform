<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { acceptResponse, CATALOG_KEY, PRODUCT_PAGE_SIZE, children, inputText, prefs, queryFor, refreshVisibleItems, remember, selectBoard, type BoardView } from '../browse.ts';
import { publicGet } from '../public-api.ts';
import { message, type Body, type Catalog, type CatalogNode, type Page, type PublicItem, type PublicPage } from '../../../shared/contracts.ts';
import { boardIconPaths } from '../../../shared/board-icons.ts';
import PageContent from '../views/PageContent.vue';
import ProductView from '../views/ProductView.vue';
import ShowcaseNav from '../views/ShowcaseNav.vue';

const cover=ref<Body>({}), nodes=ref<CatalogNode[]>([]), counts=ref<Record<string,number>>({});
const board=ref(''), view=reactive<BoardView>({category:'',fine:'',q:'',left:0,right:0});
const boards=computed(()=>children(nodes.value,null)), categories=computed(()=>children(nodes.value,board.value));
const fineChoices=computed(()=>view.category?children(nodes.value,view.category):[]);
const left=ref<HTMLElement|null>(null), right=ref<HTMLElement|null>(null);
const entries=ref<PublicItem[]>([]), total=ref(0), page=ref(1), busy=ref(false), boot=ref(true), error=ref(''), bootError=ref('');
const history=prefs(CATALOG_KEY,{board:'',boards:{} as Record<string,BoardView>});
let generation=0, debounce:ReturnType<typeof setTimeout>|undefined, controller:AbortController|undefined;
let activated=false, refreshing=false;
function store(){if(board.value){history.board=board.value;history.boards[board.value]={...view};remember(CATALOG_KEY,history);}}
function rememberScroll(){
 if(left.value?.isConnected)view.left=left.value.scrollTop;
 if(right.value?.isConnected)view.right=right.value.scrollTop;
 store();
}
async function list(append=false,restore=false){
 clearTimeout(debounce); const run=++generation;controller?.abort();controller=new AbortController();
 const desired=append?page.value+1:1, offset=restore?view.right:0;
 if(!append){entries.value=[];total.value=0;page.value=1;}
 if(!board.value){busy.value=false;return;}
 busy.value=true;error.value='';
 try{const response=await publicGet<Page<PublicItem>>(queryFor(board.value,view.fine||view.category||board.value,view.q,desired),controller.signal);
  if(!response||!acceptResponse(run,generation))return;
  entries.value=append?[...entries.value,...response.items]:response.items;total.value=response.total;page.value=desired;
  if(!append){await nextTick();if(right.value&&acceptResponse(run,generation))right.value.scrollTop=offset;}
 }catch(cause){if(run===generation)error.value=message(cause);}finally{if(run===generation)busy.value=false;}
}
async function changeBoard(id:string,initial=false){
 if(!initial)store();board.value=id;Object.assign(view,selectBoard(nodes.value,id,history.boards[id]));
 const l=view.left, pending=list(false,true);
 await nextTick();if(left.value&&board.value===id)left.value.scrollTop=l;
 await pending;if(board.value===id)store();
}
async function load(){boot.value=true;bootError.value='';try{
 const [meta,tree]=await Promise.all([publicGet<PublicPage>('/api/public/pages/catalog'),publicGet<Catalog>('/api/public/catalog')]);
 cover.value=meta?.body??{};nodes.value=tree?.nodes??[];counts.value=tree?.counts??{};
 const selected=boards.value.find(row=>row.id===history.board)??boards.value[0];boot.value=false;
 if(selected)await changeBoard(selected.id,true);
 }catch(cause){bootError.value=message(cause);}finally{boot.value=false;}}

/** Keep the current cards and scroll visible while a cached tab checks published changes. */
async function refresh(){
 if(boot.value||busy.value||refreshing)return;
 refreshing=true;
 const run=++generation, request=new AbortController();controller?.abort();controller=request;
 try{
  const coverRequest=publicGet<PublicPage>('/api/public/pages/catalog',request.signal).then(meta=>{
   if(meta&&acceptResponse(run,generation))cover.value=meta.body;
  }).catch(()=>{/* A cover failure does not prevent checking directory and product changes. */});
  const [tree]=await Promise.all([publicGet<Catalog>('/api/public/catalog',request.signal),coverRequest]);
  if(!tree||!acceptResponse(run,generation))return;
  const availableBoards=children(tree.nodes,null);
  const id=(availableBoards.find(row=>row.id===board.value)??availableBoards[0])?.id??'';
  const selection=selectBoard(tree.nodes,id,id===board.value?view:history.boards[id]);
  const same=id===board.value&&selection.category===view.category&&selection.fine===view.fine;
  const pages=same?page.value:1;
  const result=id?await refreshVisibleItems(pages*PRODUCT_PAGE_SIZE,
   (position,size)=>publicGet<Page<PublicItem>>(queryFor(id,selection.fine||selection.category||id,selection.q,position,size),request.signal),
   ()=>acceptResponse(run,generation)):{items:[],total:0};
  if(!result||!acceptResponse(run,generation))return;
  nodes.value=tree.nodes;counts.value=tree.counts;
  entries.value=result.items;total.value=result.total;
  page.value=Math.max(1,Math.min(pages,Math.ceil(result.total/PRODUCT_PAGE_SIZE)));
  bootError.value='';error.value='';
  if(!same){
   board.value=id;Object.assign(view,selection,{right:0});store();
   await nextTick();
   if(!acceptResponse(run,generation))return;
   if(left.value)left.value.scrollTop=selection.left;
   if(right.value)right.value.scrollTop=0;
  }
 }catch{/* The currently visible data can still be used if the background check fails. */}
 finally{refreshing=false;}
}
function selectCategory(id:string){view.category=id;view.fine='';view.q='';view.right=0;store();void list();}
function selectFine(id:string){view.fine=id;view.right=0;store();void list();}
function search(value:string){++generation;controller?.abort();clearTimeout(debounce);view.q=value;view.right=0;store();error.value='';busy.value=true;entries.value=[];debounce=setTimeout(()=>void list(),160);}
onMounted(load);
onActivated(()=>{
 if(activated){
  if(left.value)left.value.scrollTop=view.left;
  if(right.value)right.value.scrollTop=view.right;
  void refresh();
 }
 activated=true;
});
onBeforeUnmount(()=>{store();++generation;clearTimeout(debounce);controller?.abort();});
</script>
<template>
 <div class="mobile-page"><main class="mobile-main catalog-page" aria-label="产品目录">
  <PageContent section="catalog" :body="cover" />
  <div v-if="bootError" class="h5-empty" role="alert">{{bootError}} <component :is="'button'" type="button" class="h5-soft" @click="load">重试</component></div>
  <template v-else><div class="catalog-tools"><label class="h5-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg><input type="search" :value="view.q" aria-label="搜索产品或配方编号" placeholder="搜索产品 / 编号" @input="search(inputText($event))"><component :is="'button'" v-if="view.q" type="button" aria-label="清空搜索" @click.prevent="search('')">×</component></label>
  <nav v-if="boards.length" class="board-tabs" aria-label="业务板块"><component :is="'button'" v-for="n in boards" :key="n.id" :aria-pressed="board===n.id" type="button" @click="changeBoard(n.id)"><img v-if="n.icon_url" :src="n.icon_url" alt=""><svg v-else class="board-mark" viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d,index) in (boardIconPaths(n.name).length?boardIconPaths(n.name):['M4 9h16v11H4zM8 9V5h8v4m-4 4v3'])" :key="index" :d="d"/></svg><span>{{n.name}}</span></component></nav></div>
  <p v-if="boot" class="h5-empty" role="status">正在加载目录…</p><p v-else-if="!boards.length" class="h5-empty">暂无已发布的产品目录</p>
  <div v-else class="catalog-body"><aside v-if="categories.length" ref="left" class="category-rail" aria-label="产品分类" @scroll="rememberScroll"><component :is="'button'" v-for="n in categories" :key="n.id" type="button" :aria-pressed="view.category===n.id" @click="selectCategory(n.id)"><span>{{n.name}}</span></component></aside>
  <section ref="right" class="catalog-results" aria-label="产品列表" @scroll="rememberScroll">
    <div v-if="view.q.trim()" class="filter-row"><span role="status">{{busy?'搜索中…':`找到 ${total} 款`}}</span><component :is="'button'" class="h5-soft" type="button" @click="search('')">清空</component></div>
    <div v-else class="filter-row"><div class="fine-filters"><component :is="'button'" type="button" :aria-pressed="!view.fine" @click="selectFine('')">全部</component><component :is="'button'" v-for="f in fineChoices" :key="f.id" type="button" :aria-pressed="view.fine===f.id" @click="selectFine(f.id)">{{f.name}}</component></div><span class="category-total">{{counts[view.category||board]??0}} 款</span></div>
    <div v-if="error" class="h5-empty" role="alert">{{error}} <component :is="'button'" class="h5-soft" type="button" @click="list()">重试</component></div>
    <template v-else><ProductView v-for="entry in entries" :key="entry.id" :item="entry" mode="card"/><p v-if="busy" class="h5-empty" role="status">正在加载产品…</p><div v-else-if="!entries.length" class="h5-empty"><strong>{{view.q?'没有找到相关产品':'该分类暂无展示产品'}}</strong><component :is="'button'" v-if="view.q" type="button" class="h5-soft" @click="search('')">重新查找</component></div><component :is="'button'" v-else-if="entries.length<total" type="button" class="h5-more" @click="list(true)">加载更多</component></template>
  </section></div></template>
 </main><ShowcaseNav current="catalog"/></div>
</template>
