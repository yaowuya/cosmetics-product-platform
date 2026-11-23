<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { object, rows, text, withQuery, type Body } from '../../../shared/contracts.ts';
import { draftImage, slots, useEditor } from '../editor.ts';
import { h5Path } from '../visitor.ts';
import Release from '../panels/Release.vue';
import History from '../panels/History.vue';
const route=useRoute(), slot=String(route.params.slot);
const state=useEditor();
const {item,body,pending,busy,error,note,conflict,dirty,accept,load,save,choose}=state;
const display=computed(()=>slots.find(entry=>entry[0]===slot)?.[1]??'页面配置');
const tab=ref(route.query.tab==='history'?'history':route.query.tab==='release'?'release':'edit'), keyInput=ref(''), labelInput=ref('');
const apiPath=`/api/admin/config/${slot}`;
const multi=computed<Body[]>(()=>slot==='home_posters'?(Array.isArray(body.value.poster_asset_ids)?body.value.poster_asset_ids.map(id=>({id:text(id)})):[]):rows(body.value.cards));
const groups=computed(()=>slot==='case_header'?rows(body.value.filters):[]);
const inputs=computed(()=>slot==='catalog_cover'?[['slogan_top','封面主文案（选填）'],['slogan_bottom','封面次文案（选填）']]:slot==='case_header'?[['title','案例页标题'],['intro','标题说明']]:slot==='services'?[['page_title','页头标题'],['intro','页头副标题'],['section_title','区块标题'],['sample_label','示例角标（选填）'],['consult_label','咨询按钮（选填）']]:slot==='business_contact'?[['title','商务联系标题'],['intro','联系说明'],['label','卡片标题（选填）'],['method','联系方式说明（选填）'],['description','卡片说明（选填）'],['note','页脚备注（选填）'],['wechat_id','微信号（选填）'],['phone','电话（选填）'],['email','邮箱（选填）']]:[]);
const singleMedia=computed(()=>slot==='catalog_cover'?['cover_asset_id','目录封面图']:slot==='case_header'?['background_asset_id','案例顶部背景']:slot==='business_contact'?['qr_asset_id','商务二维码']:null);
const previewSource=ref<'draft'|'live'>('draft');
const livePaths:Record<string,string>={home_posters:'/',catalog_cover:'/catalog',case_header:'/cases',services:'/contact',business_contact:'/contact'};
const preview=computed(()=>previewSource.value==='live'?(item.value?.live_id?h5Path(livePaths[slot]??''):''):item.value?.draft?h5Path(withQuery('/preview',{id:item.value.id,revision:item.value.revision})):'');
function set(field:string,event:Event){body.value[field]=(event.currentTarget as HTMLInputElement).value;}
function refresh(){if(slots.some(entry=>entry[0]===slot))return load(apiPath);error.value='该页面配置不存在。';}
function changeList(list:Body[]){if(slot==='home_posters')body.value.poster_asset_ids=list.map(row=>text(row.id)).filter(Boolean);else body.value.cards=list;}
/** Reorder the content authored within this fixed location only. */
function move(index:number,step:number){const list=[...multi.value];if(!list[index+step])return;[list[index],list[index+step]]=[list[index+step],list[index]];changeList(list);}
function remove(index:number){changeList(multi.value.filter((_,i)=>i!==index));}
function addImage(event:Event){void choose(event,id=>{changeList([...multi.value,slot==='home_posters'?{id}:{image_asset_id:id,title:'',description:'',eyebrow:'',headline:'',points:''}]);});}
function addTextCard(){changeList([...multi.value,{title:'',eyebrow:'',headline:'',points:''}]);}
function cardField(index:number,key:string,event:Event){setCard(index,key,(event.target as HTMLInputElement).value);}
function setCard(index:number,key:string,value:string){const list=[...multi.value];list[index]={...object(list[index]),[key]:value};changeList(list);}
function addTag(){const key=keyInput.value.trim(),label=labelInput.value.trim();if(!key||!label)return;if(groups.value.some(row=>row.key===key)){error.value='此分类标识已使用。';return;}body.value.filters=[...groups.value,{key,label}];keyInput.value='';labelInput.value='';}
async function reset(){if(!dirty.value||globalThis.confirm('丢弃当前修改并重新加载？'))await refresh();}
onMounted(refresh);
</script>
<template>
 <header class="page-head"><div><h1>{{display}}</h1><p class="muted">只更新这个展示位置。保存不会直接改变线上页面。</p></div><button class="btn primary" type="button" :disabled="busy||!item" @click="save()">保存草稿</button></header>
 <nav class="toolbar" aria-label="页面配置位置"><RouterLink v-for="[key,label] in slots" :key="key" :to="`/pages/${key}`" :class="['btn',{'current':key===slot}]">{{label}}</RouterLink></nav>
 <p v-if="note" class="notice" role="status">{{note}}</p><p v-if="error" class="inline-error" role="alert">{{error}} <button type="button" class="btn link" @click="reset">{{conflict?'核对最新修订':'重试'}}</button></p>
 <nav v-if="item" class="seg"><button v-for="[key,title] in [['edit','资料维护'],['release','发布检查'],['history','版本记录']]" :key="key" type="button" :aria-pressed="tab===key" @click="tab=key">{{title}}</button></nav>
 <div v-if="item&&tab==='edit'" class="edit-layout"><section class="panel stack"><div class="section-head"><h2>位置资料</h2><span :class="['pill',{'live':item.live_id}]">{{item.live_id?'已有线上版':'未上线'}}</span></div>
  <label v-for="[key,label] in inputs" :key="key" class="field">{{label}}<input :value="text(body[key])" @input="set(key,$event)"></label>
  <label v-if="slot==='catalog_cover'"><input v-model="body.image_has_text" type="checkbox"> 封面图已带文字，不重叠显示文案</label>
  <label v-if="singleMedia" class="field">{{singleMedia[1]}}<div class="media-row"><img v-if="draftImage(item,body[singleMedia[0]],pending)" :src="draftImage(item,body[singleMedia[0]],pending)" :alt="singleMedia[1]"><span v-else class="muted">未设置</span><input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="choose($event,id=>body[singleMedia![0]]=id)"><button v-if="body[singleMedia[0]]" type="button" class="btn" @click.prevent="delete body[singleMedia[0]]">移除</button></div></label>
  <template v-if="slot==='home_posters'"><h3>海报顺序</h3><p v-if="!multi.length" class="empty">还没有图片。</p><div v-for="(entry,index) in multi" :key="`${text(entry.id)}:${index}`" class="media-row"><img v-if="draftImage(item,entry.id,pending)" :src="draftImage(item,entry.id,pending)" alt="配置图片"><div class="toolbar"><button type="button" class="btn" :disabled="index===0" @click="move(index,-1)">上移</button><button type="button" class="btn" :disabled="index===multi.length-1" @click="move(index,1)">下移</button><button type="button" class="btn" @click="remove(index)">移除</button></div></div><label class="field">添加海报<input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="addImage"></label></template>
  <template v-if="slot==='services'"><h3>服务卡片</h3><p v-if="!multi.length" class="empty">还没有服务卡片。</p><div v-for="(entry,index) in multi" :key="index" class="media-row"><img v-if="draftImage(item,entry.image_asset_id,pending)" :src="draftImage(item,entry.image_asset_id,pending)" alt="配置图片"><div class="stack"><label class="field">眉题<input :value="text(entry.eyebrow)" @input="cardField(index,'eyebrow',$event)"></label><label class="field">主句<textarea :value="text(entry.headline)" @input="cardField(index,'headline',$event)"></textarea></label><label class="field">说明要点<textarea :value="text(entry.points)" @input="cardField(index,'points',$event)"></textarea></label><label class="field">底部名称<input :value="text(entry.title)" @input="cardField(index,'title',$event)"></label><label class="field">补充说明（选填）<input :value="text(entry.description)" @input="cardField(index,'description',$event)"></label><label class="field">配图（选填）<input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="choose($event,id=>setCard(index,'image_asset_id',id))"></label></div><div class="toolbar"><button type="button" class="btn" :disabled="index===0" @click="move(index,-1)">上移</button><button type="button" class="btn" :disabled="index===multi.length-1" @click="move(index,1)">下移</button><button type="button" class="btn" @click="remove(index)">移除</button></div></div><div class="toolbar"><button type="button" class="btn" @click="addTextCard">添加文字卡片</button><label class="field">添加带图卡片<input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="addImage"></label></div></template>
  <template v-if="slot==='case_header'"><h3>案例分类</h3><div v-for="(entry,index) in groups" :key="text(entry.key)" class="list-line"><span>{{text(entry.label)}} <small>{{text(entry.key)}}</small></span><button type="button" class="btn" @click="body.filters=groups.filter((_,i)=>i!==index)">移除</button></div><div class="toolbar"><input v-model="keyInput" aria-label="分类标识" placeholder="分类标识"><input v-model="labelInput" aria-label="分类显示名称" placeholder="显示名称"><button type="button" class="btn" @click="addTag">新增分类</button></div></template>
 </section><aside class="preview-panel stack"><h2>H5 预览</h2><div class="seg" aria-label="预览来源"><button type="button" :aria-pressed="previewSource==='draft'" @click="previewSource='draft'">编辑预览</button><button type="button" :aria-pressed="previewSource==='live'" :disabled="!item?.live_id" @click="previewSource='live'">线上版本</button></div><p v-if="dirty" class="muted">仅预览已保存的草稿。</p><iframe v-if="preview" :key="preview" :src="preview" :title="previewSource==='live'?'线上 H5':'当前页面配置的草稿预览'" referrerpolicy="no-referrer"></iframe><p v-else class="empty">先保存草稿，再预览页面。</p></aside></div>
 <Release v-if="item&&tab==='release'" :item="item" :dirty="dirty" @changed="refresh" />
 <History v-if="item&&tab==='history'" :item="item" @restored="entry=>{accept(entry);tab='edit';note='历史已恢复为草稿，线上版本未改变。'}" />
</template>
<style scoped>.current{background:#e1edf1;border-color:#adc7d1}</style>
