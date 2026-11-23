<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { message, rows, withQuery, type CatalogNode } from '../../../shared/contracts.ts';
import { draftImage, moveWithinParent, useEditor } from '../editor.ts';
import { h5Path } from '../visitor.ts';
import { request } from '../session.ts';
import History from '../panels/History.vue';
import Release from '../panels/Release.vue';

const {item,body,pending,busy,error,note,conflict,dirty,accept,load,save,choose}=useEditor();
const route=useRoute();
const adding=ref(false),parent=ref(''),name=ref(''),tab=ref(route.query.tab==='release'?'release':route.query.tab==='history'?'history':'edit');
const all=computed(()=>rows(body.value.nodes).map(row=>row as unknown as CatalogNode));
const byId=computed(()=>new Map(all.value.map(node=>[node.id,node])));
const selectedParent=computed(()=>byId.value.get(parent.value));
const previewSource=ref<'draft'|'live'>('draft');
const preview=computed(()=>previewSource.value==='live'?(item.value?.live_id?h5Path('/catalog'):''):item.value?.draft?h5Path(withQuery('/preview',{id:item.value.id,revision:item.value.revision})):'');
const view=computed(()=>{
  const children=(id:string|null)=>all.value.filter(n=>(n.parent_id||null)===id).sort((a,b)=>a.sort_order-b.sort_order);
  const ordered:{node:CatalogNode;depth:number}[]=[];
  function walk(id:string|null,depth:number){if(depth>2)return;for(const node of children(id)){ordered.push({node,depth});walk(node.id,depth+1);}}
  walk(null,0);return ordered;
});
const levels={board:'业务板块',category:'分类',subcategory:'细分类'};
function shift(id:string,step:-1|1){body.value.nodes=moveWithinParent(all.value,id,step);}

/** Get the stable ID from backend first, then add it to the working copy. */
async function add(){
  if(!name.value.trim()||!item.value)return;
  if(selectedParent.value?.level==='subcategory')return;
  busy.value=true;error.value='';
  try{const result=await request<{id:string}>('/api/admin/directory/nodes','POST',{});const level=selectedParent.value?.level==='board'?'category':selectedParent.value?.level==='category'?'subcategory':'board';
    body.value.nodes=[...all.value,{id:result.id,parent_id:parent.value||null,level,name:name.value.trim(),enabled:true,sort_order:all.value.filter(node=>(node.parent_id??'')===parent.value).length}];
    name.value='';parent.value='';adding.value=false;
  }catch(cause){error.value=message(cause);}finally{busy.value=false;}
}
function refresh(){return load('/api/admin/config/directory');}
async function reset(){if(!dirty.value||globalThis.confirm('确定丢弃本地修改并重新加载？'))await refresh();}
onMounted(refresh);
</script>
<template>
 <header class="page-head"><div><h1>板块与分类</h1><p class="muted">维护业务板块、分类和细分类。停用只影响展示，不删除对应产品。</p></div><button type="button" class="btn primary" :disabled="busy||!item" @click="save()">保存草稿</button></header>
 <p v-if="note" class="notice" role="status">{{note}}</p><p v-if="error" class="inline-error" role="alert">{{error}} <button type="button" class="btn link" @click="reset">{{conflict?'重新核对':'重试'}}</button></p>
 <nav v-if="item" class="seg"><button v-for="[key,label] in [['edit','目录树'],['release','发布检查'],['history','版本记录']]" :key="key" type="button" :aria-pressed="tab===key" @click="tab=key">{{label}}</button></nav>
 <div v-if="tab==='edit'&&item" class="edit-layout"><section class="panel stack"><div class="section-head"><h2>目录结构</h2><button type="button" class="btn" @click="adding=!adding">＋ 新增节点</button></div>
  <form v-if="adding" class="panel stack" @submit.prevent="add"><label class="field">节点名称<input v-model.trim="name" required></label><label class="field">所在位置<select v-model="parent"><option value="">根目录（新建业务板块）</option><option v-for="entry in view.filter(row=>row.depth<2)" :key="entry.node.id" :value="entry.node.id">{{ ['','　'][entry.depth] }}{{entry.node.name}}</option></select></label><div class="toolbar"><button type="submit" class="btn primary" :disabled="busy">添加到草稿</button><button type="button" class="btn" @click="adding=false">取消</button></div></form>
  <p v-if="!view.length" class="empty">还没有配置目录。先添加一个业务板块。</p>
  <div v-for="{node,depth} in view" :key="node.id" :style="{paddingLeft:`${depth*17}px`}" class="tree-row"><label class="field"><span class="muted">{{levels[node.level]}}</span><input v-model="node.name" :aria-label="`${levels[node.level]}名称`"></label><label><input v-model="node.enabled" type="checkbox">启用</label><div class="toolbar"><button type="button" class="btn link" @click="shift(node.id,-1)">上移</button><button type="button" class="btn link" @click="shift(node.id,1)">下移</button><details><summary>图标</summary><img v-if="draftImage(item,node.icon_asset_id,pending)" :src="draftImage(item,node.icon_asset_id,pending)" class="detail-image" alt="节点图标"><label>更换图标<input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="choose($event,id=>node.icon_asset_id=id)"></label><button v-if="node.icon_asset_id" type="button" class="btn" @click="delete node.icon_asset_id">移除</button></details></div></div>
 </section><aside class="preview-panel stack"><h2>H5 目录预览</h2><div class="seg" aria-label="预览来源"><button type="button" :aria-pressed="previewSource==='draft'" @click="previewSource='draft'">编辑预览</button><button type="button" :aria-pressed="previewSource==='live'" :disabled="!item?.live_id" @click="previewSource='live'">线上版本</button></div><iframe v-if="preview" :key="preview" :src="preview" :title="previewSource==='live'?'线上 H5':'已保存目录草稿预览'" referrerpolicy="no-referrer"></iframe><p v-else class="empty">保存目录草稿后可在此预览。</p></aside></div>
 <Release v-if="item&&tab==='release'" :item="item" :dirty="dirty" @changed="refresh" />
 <History v-if="item&&tab==='history'" :item="item" @restored="row=>{accept(row);tab='edit';note='目录历史已恢复为草稿。'}" />
</template>
