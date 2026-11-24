<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { ElDialog, ElPagination, ElTable, ElTableColumn } from 'element-plus';
import 'element-plus/es/components/dialog/style/css';
import ItemEditor from './ItemEditor.vue';
import { message, rows, text, withQuery, type CatalogNode, type Item, type Page } from '../../../shared/contracts.ts';
import { affectedCaseLabel, canArchive, canDelete, draftImage, nodePath, type AffectedCase } from '../editor.ts';
import { account, request } from '../session.ts';
import { readAttempts } from '../batch.ts';
import Batch from '../panels/Batch.vue';
import Release from '../panels/Release.vue';

const props=defineProps<{kind:'product'|'case'}>();
const product=computed(()=>props.kind==='product');
const collection=computed(()=>product.value?'products':'cases');
const title=computed(()=>product.value?'全部产品':'全部案例');
const list=ref<Item[]>([]), checked=ref<Item[]>([]), nodes=ref<CatalogNode[]>([]), selected=ref<Item|null>(null);
const batch=ref<'append'|'check'|'recover'|null>(null),creating=ref(false),loading=ref(false),error=ref(''),note=ref('');
const total=ref(0), archived=ref(0),page=ref(1),batchPanel=ref<HTMLElement|null>(null),releasePanel=ref<HTMLElement|null>(null);
const filters=reactive({q:'',state:'',has_draft:'',node_id:''});
const allSelected=computed(()=>total.value>0 && total.value===checked.value.length);
const selectedIds=computed(()=>new Set(checked.value.map(row=>row.id)));
const pendingCount=ref(0);
let generation=0;
function label(item:Item){return text(item.summary?.name??item.summary?.product_name??item.draft?.name??item.live?.name??item.draft?.product_name??item.live?.product_name,'未命名草稿');}
function photo(item:Item){const b=item.draft??item.live;return draftImage(item,b?.thumbnail_asset_id??b?.image_asset_id,{});}
function status(row:Item){return row.archived_at?'已归档':row.live_id?'已上线':row.has_history?'已下架':'从未上线';}
function address(n:number,size=20){return withQuery(`/api/admin/${collection.value}`,{...filters,page:n,page_size:size});}
function readPending(){pendingCount.value=account.value?.can_publish?readAttempts(account.value.id).length:0;}

/** Refresh only the requested filter generation, and reconcile selected rows to saved revisions. */
async function load(){
 const run=++generation;loading.value=true;error.value='';readPending();
 try{const [data,archivePage]=await Promise.all([request<Page<Item>>(address(page.value)),request<Page<Item>>(withQuery(`/api/admin/${collection.value}`,{state:'archived',page_size:1}))]);
   if(run!==generation)return;list.value=data.items;total.value=data.total;archived.value=archivePage.total;
   const fresh=new Map(data.items.map(row=>[row.id,row]));checked.value=checked.value.map(row=>fresh.get(row.id)??row);
   if(selected.value)selected.value=fresh.get(selected.value.id)??null;
 }catch(cause){if(run===generation){error.value=message(cause);list.value=[];checked.value=[];total.value=0;}}
 finally{if(run===generation)loading.value=false;}
}
async function loadNodes(){try{const directory=await request<Item>('/api/admin/config/directory');nodes.value=rows((directory.draft??directory.live)?.nodes).map(row=>row as unknown as CatalogNode);}catch{nodes.value=[];}}
function search(){page.value=1;checked.value=[];batch.value=null;selected.value=null;void load();}
function filterTo(online=false){Object.assign(filters,{q:'',state:online?'online':'',has_draft:online?'true':'',node_id:''});search();}
function mark(row:Item,on:boolean){batch.value=null;checked.value=on?[...checked.value.filter(r=>r.id!==row.id),row]:checked.value.filter(r=>r.id!==row.id);}
async function selectAll(){
 batch.value=null;if(allSelected.value){checked.value=[];return;}
 if(total.value>200){note.value='单次最多处理 200 款，请先缩小筛选范围。';return;}
 const run=generation;loading.value=true;
 try{const chosen:Item[]=[];for(let n=1;n<=Math.ceil(total.value/100);n++){const response=await request<Page<Item>>(address(n,100));if(run!==generation)return;chosen.push(...response.items);}checked.value=[...new Map(chosen.map(row=>[row.id,row])).values()];}
 catch(cause){error.value=message(cause);}finally{if(run===generation)loading.value=false;}
}
async function openBatch(mode:'append'|'check'|'recover'){batch.value=mode;selected.value=null;await nextTick();batchPanel.value?.scrollIntoView({block:'nearest'});}
async function openRelease(row:Item){selected.value=row;batch.value=null;await nextTick();releasePanel.value?.scrollIntoView({block:'nearest'});}

/** Show affected cases before sending a confirmed lifecycle operation. Cancellation never writes. */
async function retire(row:Item, action:'unlist'|'archive'|'delete'){
 error.value='';note.value='';try{
  if(action==='delete'){
    if(!globalThis.confirm(`确定删除「${label(row)}」的未发布草稿？此操作不可撤销。`))return;
    await request(`/api/admin/items/${row.id}/draft`,'DELETE',{expected_revision:row.revision,confirmed:true});note.value='草稿已删除。';
  }else{
    const impact=await request<{case_ids:string[];cases:AffectedCase[]}>(`/api/admin/items/${row.id}/impact`);
    const related=impact.cases.length ? `\n关联案例（${impact.cases.length}）：\n${impact.cases.map(affectedCaseLabel).join('\n')}\n案例不会随之改变。` : '';
    if(!globalThis.confirm(`确定${action==='unlist'?'下架':'归档'}「${label(row)}」？${related}\n历史和记录将保留。`))return;
    await request(`/api/admin/items/${row.id}/${action}`,'POST',{expected_revision:row.revision,confirmed:true,case_ids:impact.case_ids});note.value=action==='unlist'?'已下架，公开端不再展示。':'已归档，历史记录保留。';
  }
  selected.value=null;checked.value=checked.value.filter(entry=>entry.id!==row.id);await load();
 }catch(cause){error.value=message(cause);}
}
function created(){creating.value=false;note.value='草稿已保存，仍在当前列表。';void load();}
onMounted(()=>{void load();if(product.value)void loadNodes();});
</script>

<template>
 <header class="page-head"><div><h1>{{ title }}</h1><p class="muted">{{product?'筛选并勾选产品，统一追加展示分类，或检查草稿后发布。':'按品牌名或案例产品名查找，单独维护案例资料。'}}</p></div><div class="toolbar"><button class="btn" @click="filters.state=filters.state==='archived'?'':'archived';search()">{{filters.state==='archived'?'返回日常列表':`已归档（${archived}）`}}</button><button type="button" class="btn primary" @click="creating=true">新增{{product?'产品':'案例'}}</button></div></header>
 <el-dialog v-model="creating" :title="`新增${product?'产品':'案例'}`" width="760px" append-to-body destroy-on-close><ItemEditor v-if="creating" id="new" :kind="kind" embedded @saved="created" /></el-dialog>
 <section class="panel table-frame"><div class="section-head"><h2>{{product?'产品列表':'案例列表'}}</h2><small>共 {{total}} {{product?'款':'条'}}</small></div>
 <form @submit.prevent="search"><div :class="['list-filters',{'case-list':!product}]"><label class="field">搜索{{product?'产品':'案例'}}<input v-model.trim="filters.q" :placeholder="product?'产品名称或配方编号':'品牌名或案例产品名'" type="search" @search="search" @change="search"></label>
 <label v-if="product" class="field">展示分类<select v-model="filters.node_id" @change="search"><option value="">全部分类</option><option v-for="node in nodes" :key="node.id" :value="node.id">{{nodePath(nodes,node.id)}}</option></select></label>
 <label class="field">线上状态<select v-model="filters.state" @change="search"><option value="">全部线上状态</option><option value="online">已上线</option><option value="offline">未上线 / 已下架</option><option value="archived">已归档</option></select></label><label class="field">草稿状态<select v-model="filters.has_draft" @change="search"><option value="">不限草稿状态</option><option value="true">有草稿</option><option value="false">无草稿</option></select></label></div>
 <div class="filter-foot"><small>名称与分类以已存草稿为准；没有草稿时显示最近资料。</small><div class="toolbar"><button type="submit" class="btn small">查询</button><button type="button" class="btn small" @click="filterTo(true)">线上有草稿</button><button type="button" class="btn small" @click="filterTo()">清除筛选</button></div></div></form>
 <p v-if="note" role="status" class="notice">{{note}}</p><p v-if="error" role="alert" class="inline-error">{{error}} <button class="btn link" @click="load">重试</button></p>
 <div v-if="product" class="bulk-bar"><div><label><input type="checkbox" :checked="allSelected" :disabled="loading||!total" @change="selectAll"> 选择所有当前筛选结果</label><small>筛选结果 {{total}} 款 · 已选 {{checked.length}} 款</small></div><div class="toolbar"><button type="button" class="btn small" :disabled="!checked.length" @click="openBatch('append')">批量修改</button><button type="button" class="btn primary small" :disabled="!checked.length||!account?.can_publish" @click="openBatch('check')">批量发布检查</button><button v-if="pendingCount" class="btn small" @click="openBatch('recover')">核对未确认回执（{{pendingCount}}）</button></div></div>
 <small v-if="product" class="filter-note">更改筛选会清空勾选。{{account?.can_publish?'只有确认后的合格草稿才会发布。':'当前账号不能发布，请由有发布权的同事检查后上线。'}}</small>
 <el-table :data="list" row-key="id" :empty-text="loading?'正在加载…':product?'没有符合条件的产品，请更换搜索词或清除筛选。':'没有符合条件的案例。'">
   <el-table-column v-if="product" label="选择" width="46"><template #default="{row}"><input type="checkbox" :aria-label="`选择${label(row)}`" :checked="selectedIds.has(row.id)" @change="mark(row,($event.target as HTMLInputElement).checked)"></template></el-table-column>
   <el-table-column :label="product?'产品 / 配方编号':'客户品牌 / 案例产品'" min-width="200"><template #default="{row}"><div class="item-name"><img v-if="photo(row)" :src="photo(row)" alt=""/><div><RouterLink :to="`/${collection}/${row.id}`">{{label(row)}}</RouterLink><small>{{text(row.summary?.formula_no??row.summary?.brand_name??row.draft?.formula_no??row.live?.formula_no)}}</small></div></div></template></el-table-column>
   <el-table-column v-if="product" label="展示分类" min-width="210"><template #default="{row}">{{row.place_ids.map((id:string)=>nodePath(nodes,id)).join('、')||'—'}}</template></el-table-column>
   <el-table-column label="线上状态" width="95"><template #default="{row}"><span :class="['pill',{live:row.live_id}]">{{status(row)}}</span></template></el-table-column>
   <el-table-column label="草稿状态" width="82"><template #default="{row}"><span :class="['pill',{warn:row.draft}]">{{row.draft?'有草稿':'无草稿'}}</span></template></el-table-column>
   <el-table-column label="操作" min-width="218"><template #default="{row}"><div class="actions">
     <RouterLink :to="`/${collection}/${row.id}`" class="btn small">{{row.archived_at?'查看':'编辑'}}</RouterLink>
     <button v-if="!row.archived_at" class="btn small" :disabled="!account?.can_publish||!row.draft" @click="openRelease(row)">发布检查</button>
     <button v-if="row.live_id" class="btn small" :disabled="!account?.can_publish" @click="retire(row,'unlist')">下架</button><button v-if="canArchive(row)" class="btn small" :disabled="!account?.can_publish" @click="retire(row,'archive')">归档</button>
     <button v-if="canDelete(row)" class="btn small" @click="retire(row,'delete')">删除草稿</button><RouterLink v-if="row.has_history" :to="`/items/${row.id}/history`" class="btn link small">历史版本</RouterLink>
   </div></template></el-table-column>
 </el-table><div class="pagination"><el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="total, prev, pager, next" @current-change="load" /></div></section>
 <div v-if="selected" ref="releasePanel"><Release :key="selected.id" :item="selected" @changed="load"/></div>
 <div v-if="product&&batch" ref="batchPanel"><Batch :key="batch" :mode="batch" :selected="checked" :nodes="nodes" @changed="load" @pending="readPending" /></div>
</template>
<style scoped>
.list-filters{display:grid;grid-template-columns:minmax(180px,2fr) minmax(130px,1.45fr) repeat(2,minmax(106px,1fr));gap:12px}.list-filters.case-list{grid-template-columns:2fr 1fr 1fr}.filter-foot,.bulk-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.filter-foot{margin-top:12px}.filter-foot .toolbar,.bulk-bar .toolbar{margin:0}.btn.small{min-height:29px;font-size:12px;padding:4px 9px}.bulk-bar{padding:13px 15px;background:var(--soft);border-radius:7px;margin:15px 0 4px}.bulk-bar label{font-weight:600}.bulk-bar small,.item-name small{display:block;margin-top:3px}.filter-note{display:block;margin:6px 0}.actions{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.item-name{display:flex;align-items:center;gap:10px;min-height:49px}.item-name img{width:39px;height:39px;object-fit:cover;border-radius:5px}.table-frame :deep(.el-table__cell .cell){padding-left:0;color:var(--ink);font-size:13px}.table-frame :deep(th .cell){color:var(--muted);font-weight:500}.table-frame :deep(.el-table__row td){border-color:var(--line)}@media(max-width:900px){.list-filters,.list-filters.case-list{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.list-filters .field:first-child{grid-column:1/-1}.filter-foot .toolbar{gap:5px}}
</style>
