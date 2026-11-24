<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { message, rows, withQuery, type CatalogNode } from '../../../shared/contracts.ts';
import { boardIconPaths } from '../../../shared/board-icons.ts';
import { draftImage, moveWithinParent, useEditor } from '../editor.ts';
import { h5Path } from '../visitor.ts';
import { request } from '../session.ts';
import History from '../panels/History.vue';
import Release from '../panels/Release.vue';

const {item,body,pending,busy,error,note,conflict,dirty,accept,load,save,choose}=useEditor();
const route=useRoute();
const name=ref(''), tab=ref(route.query.tab==='release'?'release':route.query.tab==='history'?'history':'edit');
const expanded=ref(new Set<string>()), editing=ref(''), addingParent=ref<string|null>(null);
const all=computed(()=>rows(body.value.nodes).map(row=>row as unknown as CatalogNode));
const byId=computed(()=>new Map(all.value.map(node=>[node.id,node])));
const previewSource=ref<'draft'|'live'>('draft');
const preview=computed(()=>previewSource.value==='live'?(item.value?.live_id?h5Path('/catalog'):''):item.value?.draft?h5Path(withQuery('/preview',{id:item.value.id,revision:item.value.revision})):'');
const childrenOf=(id:string|null)=>all.value.filter(node=>(node.parent_id||null)===id).sort((a,b)=>a.sort_order-b.sort_order);
const view=computed(()=>{
  const ordered:{node:CatalogNode;depth:number;hasChildren:boolean}[]=[];
  function walk(id:string|null,depth:number){
    if(depth>2)return;
    for(const node of childrenOf(id)){
      ordered.push({node,depth,hasChildren:childrenOf(node.id).length>0});
      if(expanded.value.has(node.id))walk(node.id,depth+1);
    }
  }
  walk(null,0);
  return ordered;
});
const levels={board:'业务板块',category:'分类',subcategory:'细分类'};
function toggle(id:string){const next=new Set(expanded.value);if(next.has(id))next.delete(id);else next.add(id);expanded.value=next;}
function startAdd(parentId:string){addingParent.value=parentId;name.value='';if(parentId){const next=new Set(expanded.value);next.add(parentId);expanded.value=next;}}
function shift(id:string,step:-1|1){body.value.nodes=moveWithinParent(all.value,id,step);}

/** Get the stable ID from backend first, then add it to the working copy. */
async function add(){
  if(!name.value.trim()||!item.value||addingParent.value===null)return;
  const parentNode=addingParent.value?byId.value.get(addingParent.value):undefined;
  if(parentNode?.level==='subcategory')return;
  busy.value=true;error.value='';
  try{
    const result=await request<{id:string}>('/api/admin/directory/nodes','POST',{});
    const level=parentNode?.level==='board'?'category':parentNode?.level==='category'?'subcategory':'board';
    body.value.nodes=[...all.value,{id:result.id,parent_id:addingParent.value||null,level,name:name.value.trim(),enabled:true,sort_order:childrenOf(addingParent.value||null).length}];
    if(addingParent.value){const next=new Set(expanded.value);next.add(addingParent.value);expanded.value=next;}
    name.value='';addingParent.value=null;
  }catch(cause){error.value=message(cause);}finally{busy.value=false;}
}
function refresh(){return load('/api/admin/config/directory');}
async function reset(){if(!dirty.value||globalThis.confirm('确定丢弃本地修改并重新加载？'))await refresh();}
onMounted(refresh);
</script>
<template>
 <header class="page-head"><div><h1>板块与分类</h1><p class="muted">默认收起。点开后查看，需要修改时再编辑。只有业务板块使用图标。</p></div></header>
 <p v-if="note" class="notice" role="status">{{note}}</p><p v-if="error" class="inline-error" role="alert">{{error}} <button type="button" class="btn link" @click="reset">{{conflict?'重新核对':'重试'}}</button></p>
 <div v-if="item" class="config-tabs"><nav class="seg"><button v-for="[key,label] in [['edit','目录树'],['release','发布检查'],['history','版本记录']]" :key="key" type="button" :aria-pressed="tab===key" @click="tab=key">{{label}}</button></nav><button class="btn primary" type="button" :disabled="busy" @click="save()">保存草稿</button></div>
 <div v-if="tab==='edit'&&item" class="edit-layout"><section class="panel stack"><div class="section-head"><h2>目录结构</h2><button type="button" class="btn" @click="startAdd('')">新增板块</button></div>
  <form v-if="addingParent===''" class="panel stack" @submit.prevent="add"><label class="field">板块名称<input v-model.trim="name" required></label><div class="toolbar"><button type="submit" class="btn primary" :disabled="busy">添加到草稿</button><button type="button" class="btn" @click="addingParent=null">取消</button></div></form>
  <p v-if="!all.length" class="empty">还没有配置目录。先添加一个业务板块。</p>
  <div v-for="{node,depth,hasChildren} in view" :key="node.id" class="tree-row" :style="{paddingLeft:`${depth*18}px`}">
   <button v-if="hasChildren" type="button" class="btn link tree-toggle" :aria-expanded="expanded.has(node.id)" @click="toggle(node.id)">{{expanded.has(node.id)?'收起':'展开'}}</button><span v-else class="tree-gap"></span>
   <div class="tree-main">
    <template v-if="editing===node.id"><label class="field"><span class="muted">{{levels[node.level]}}</span><input v-model="node.name" :aria-label="`${levels[node.level]}名称`"></label><label><input v-model="node.enabled" type="checkbox">启用</label></template>
    <template v-else><strong>{{node.name}}</strong><span class="muted">{{levels[node.level]}}</span></template>
    <svg v-if="node.level==='board'&&!draftImage(item,node.icon_asset_id,pending)" class="board-mark" viewBox="0 0 24 24" aria-hidden="true"><path v-for="(d,index) in boardIconPaths(node.name)" :key="index" :d="d" /></svg>
    <img v-else-if="node.level==='board'" :src="draftImage(item,node.icon_asset_id,pending)" class="detail-image" alt="板块图标">
   </div>
   <div class="toolbar">
    <button type="button" class="btn link" @click="editing=editing===node.id?'':node.id">{{editing===node.id?'完成':'编辑'}}</button>
    <template v-if="editing===node.id"><button type="button" class="btn link" @click="shift(node.id,-1)">上移</button><button type="button" class="btn link" @click="shift(node.id,1)">下移</button>
     <label v-if="node.level==='board'" class="btn">更换图标<input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="choose($event,id=>node.icon_asset_id=id)"></label>
     <button v-if="node.level==='board'&&node.icon_asset_id" type="button" class="btn link" @click="delete node.icon_asset_id">恢复原型图标</button>
    </template>
    <button v-if="node.level!=='subcategory'" type="button" class="btn link" @click="startAdd(node.id)">新增</button>
   </div>
   <form v-if="addingParent===node.id" class="tree-add" @submit.prevent="add"><input v-model.trim="name" :aria-label="`在${node.name}下新增`" placeholder="名称" required><button type="submit" class="btn primary" :disabled="busy">添加</button><button type="button" class="btn" @click="addingParent=null">取消</button></form>
  </div>
 </section><aside class="preview-panel stack"><h2>H5 目录预览</h2><div class="seg" aria-label="预览来源"><button type="button" :aria-pressed="previewSource==='draft'" @click="previewSource='draft'">编辑预览</button><button type="button" :aria-pressed="previewSource==='live'" :disabled="!item?.live_id" @click="previewSource='live'">线上版本</button></div><iframe v-if="preview" :key="preview" :src="preview" :title="previewSource==='live'?'线上 H5':'已保存目录草稿预览'" referrerpolicy="no-referrer"></iframe><p v-else class="empty">保存目录草稿后可在此预览。</p></aside></div>
 <Release v-if="item&&tab==='release'" :item="item" :dirty="dirty" @changed="refresh" />
 <History v-if="item&&tab==='history'" :item="item" @restored="row=>{accept(row);tab='edit';note='目录历史已恢复为草稿。'}" />
</template>
<style scoped>
.config-tabs{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.config-tabs .seg{margin-bottom:15px}
.tree-row{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}
.tree-main{display:flex;align-items:center;gap:8px;min-width:0}.tree-main strong{font-weight:600}
.tree-toggle{min-width:44px}.tree-gap{width:44px}
.tree-add{grid-column:2 / -1;display:flex;gap:8px;align-items:center}.tree-add input{flex:1}
.board-mark{width:22px;height:22px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
label.btn{position:relative;overflow:hidden}label.btn input{position:absolute;inset:0;opacity:0;cursor:pointer}
</style>
