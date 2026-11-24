<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElCascader } from 'element-plus';
import 'element-plus/es/components/cascader/style/css';
import { message, rows, type Body, type CatalogNode, type Item, type Page, text, withQuery } from '../../../shared/contracts.ts';
import { draftImage, useEditor } from '../editor.ts';
import { h5Path } from '../visitor.ts';
import { request } from '../session.ts';
import { useRoute, useRouter } from 'vue-router';
import History from '../panels/History.vue';
import Release from '../panels/Release.vue';

const props=defineProps<{id:string;kind?:'product'|'case';history?:boolean;embedded?:boolean}>();
const emit=defineEmits<{saved:[item:Item]}>();
const router=useRouter(), route=useRoute();
const {item,body,places,pending,busy,error,note,conflict,dirty,accept,load,save,choose}=useEditor();
const tab=ref(props.history||route.query.tab==='history'?'history':route.query.tab==='release'?'release':'edit'), sidebar=ref<'card'|'detail'>('detail'),nodes=ref<CatalogNode[]>([]),related=ref<Item[]>([]),categories=ref<Body[]>([]);
const kind=computed(()=>item.value?.kind??props.kind??'product');
const collection=computed(()=>kind.value==='case'?'cases':'products');
const readonly=computed(()=>Boolean(item.value?.archived_at));
const yes=computed(()=>kind.value==='product');
const newItem=computed(()=>props.id==='new');
const productFields=[{key:'name',label:'产品名称'},{key:'english_name',label:'英文名称（选填）'},{key:'formula_no',label:'配方编号'},{key:'short_benefit',label:'简短功效'},{key:'benefit',label:'功效',large:true},{key:'ingredients',label:'核心成分',large:true},{key:'highlights',label:'产品亮点',large:true}];
const caseFields=[{key:'brand_name',label:'品牌名称'},{key:'product_name',label:'案例产品名称'},{key:'case_no',label:'案例编号（选填）'},{key:'series',label:'系列（选填）'},{key:'highlight',label:'案例亮点',large:true},{key:'description',label:'案例说明（选填）',large:true}];
const media=computed(()=>yes.value?[['thumbnail_asset_id','产品方图'],['cover_asset_id','产品封面图'],['detail_asset_id','产品详情长图']]:[['image_asset_id','案例图片']]);
const display=computed(()=>text(body.value.name??body.value.product_name, newItem.value?(yes.value?'新增产品':'新增案例'):'未命名草稿'));
const previewSource=ref<'draft'|'live'>('draft');
const activePreview=computed(()=>{
  if(previewSource.value==='live') return item.value?.live_id?h5Path(withQuery(yes.value?'/products':'/cases/detail',{id:item.value.id})):'';
  return item.value?.draft?h5Path(withQuery('/preview',{id:item.value.id,revision:item.value.revision,mode:sidebar.value})):'';
});
const itemPath=computed(()=>`/api/admin/items/${props.id}`);
function assign(key:string,event:Event){body.value[key]=(event.currentTarget as HTMLInputElement|HTMLTextAreaElement).value;}
function clear(key:string){delete body.value[key];}
const placeOptions=computed(()=>{
  function build(parent:string|null):{value:string;label:string;children?:{value:string;label:string}[]}[]{
    return nodes.value.filter(node=>(node.parent_id||null)===parent&&node.enabled!==false).sort((a,b)=>a.sort_order-b.sort_order).map(node=>{
      const children=build(node.id);
      return children.length?{value:node.id,label:node.name,children}:{value:node.id,label:node.name};
    });
  }
  return build(null);
});

/** Load fixed choices from current directory, independent of the working copy. */
async function options(){
  try{if(yes.value){const dir=await request<Item>('/api/admin/config/directory');nodes.value=rows((dir.live??dir.draft)?.nodes).map(row=>row as unknown as CatalogNode);}else{
    const [products, header]=await Promise.all([request<Page<Item>>('/api/admin/products?page_size=100'),request<Item>('/api/admin/config/case_header')]);
    related.value=products.items;categories.value=rows((header.live??header.draft)?.filters);
  }}catch{/* Editor remains usable when optional relations are not configured. */}
}
async function store(){const saved=await save(collection.value);if(!saved)return;if(props.embedded){emit('saved',saved);return;}if(newItem.value)await router.replace(`/${collection.value}/${saved.id}`);}
async function refresh(){if(!newItem.value)await load(itemPath.value);}
async function reset(){if(!dirty.value||globalThis.confirm('确定丢弃工作副本并重新加载？'))await refresh();}
onMounted(async()=>{await refresh();await options();});
</script>

<template>
 <header v-if="!embedded" class="page-head"><div><RouterLink :to="`/${collection}`" class="muted">← {{ yes?'全部产品':'全部案例' }}</RouterLink><h1>{{ display }}</h1><p class="muted">{{item?.live_id?'已有线上版本':'未上线'}} <template v-if="item">· 修订 {{ item.revision }}</template> <span v-if="dirty" class="pill warn">尚未保存</span></p></div></header>
 <p v-if="note" role="status" class="notice">{{ note }}</p><p v-if="error" role="alert" class="inline-error">{{error}} <button v-if="!newItem" type="button" class="btn link" @click="reset">{{conflict?'核对最新修订':'重试加载'}}</button></p>
 <div class="config-tabs"><nav class="seg" aria-label="内容编辑视图"><button type="button" :aria-pressed="tab==='edit'" @click="tab='edit'">内容编辑</button><button v-if="item" type="button" :aria-pressed="tab==='release'" @click="tab='release'">发布检查</button><button v-if="item" type="button" :aria-pressed="tab==='history'" @click="tab='history'">版本记录</button></nav><button v-if="!readonly" type="button" class="btn primary" :disabled="busy" @click="store">保存草稿</button></div>
 <div v-if="tab==='edit'" :class="embedded?'stack':'edit-layout'">
  <section class="panel stack"><h2>{{ yes?'产品资料':'案例信息' }}</h2>
   <div class="form-grid"><label v-for="f in yes?productFields:caseFields" :key="f.key" class="field" :style="f.large?{gridColumn:'1 / -1'}:{}">{{f.label}}<textarea v-if="f.large" :value="text(body[f.key])" :disabled="readonly" @input="assign(f.key,$event)"/><input v-else :value="text(body[f.key])" :disabled="readonly" @input="assign(f.key,$event)"></label></div>
   <label v-if="yes" class="field">是否生产过<select :value="text(body.production_status)" :disabled="readonly" @change="assign('production_status',$event)"><option value="">请选择</option><option>已生产</option><option>未生产</option><option>待确认</option></select></label>
   <div v-else class="form-grid"><label class="field">案例分类<select :value="text(body.category_key)" :disabled="readonly" @change="assign('category_key',$event)"><option value="">不指定</option><option v-for="entry in categories" :key="text(entry.key)" :value="text(entry.key)">{{text(entry.label)}}</option></select></label><label class="field">内部关联产品<select :value="text(body.related_product_id)" :disabled="readonly" @change="assign('related_product_id',$event)"><option value="">不关联</option><option v-for="row in related" :key="row.id" :value="row.id">{{text(row.summary?.name??row.draft?.name??row.live?.name,'未命名产品')}}</option></select></label><label class="field">展示顺序<input type="number" min="0" step="1" :disabled="readonly" :value="Number(body.sort_order??0)" @input="body.sort_order=Number(($event.target as HTMLInputElement).value)"></label></div>
   <h2>图片素材</h2><label v-for="[key,title] in media" :key="key" class="field media-field"><span>{{title}}</span><div class="media-row"><img v-if="draftImage(item,body[key],pending)" :src="draftImage(item,body[key],pending)" :alt="title"><span v-else class="muted">未上传</span><input type="file" accept="image/png,image/jpeg,image/webp" :disabled="readonly||busy" @change="choose($event,id=>body[key]=id)"><button v-if="body[key]&&!readonly" type="button" class="btn" @click.prevent="clear(key)">移除</button></div></label>
   <template v-if="yes"><h2>展示位置</h2><p v-if="!nodes.length" class="muted">目录未配置，先在「板块与分类」建立展示位置。</p><el-cascader v-else v-model="places" class="place-cascader" :options="placeOptions" :props="{multiple:true,checkStrictly:true,emitPath:false}" clearable :disabled="readonly" placeholder="选择展示位置" /></template>
  </section>
  <aside v-if="!embedded" class="preview-panel stack"><div class="section-head"><h2>H5 预览</h2><span v-if="item?.draft" class="pill">保存修订 {{item.revision}}</span></div><div class="seg" aria-label="预览来源"><button type="button" :aria-pressed="previewSource==='draft'" @click="previewSource='draft'">编辑预览</button><button type="button" :aria-pressed="previewSource==='live'" :disabled="!item?.live_id" @click="previewSource='live'">线上版本</button></div><div v-if="yes && previewSource==='draft'" class="seg"><button type="button" :aria-pressed="sidebar==='card'" @click="sidebar='card'">列表卡片</button><button type="button" :aria-pressed="sidebar==='detail'" @click="sidebar='detail'">详情页</button></div><p v-if="dirty" class="muted">未保存修改不会显示在预览里。</p><iframe v-if="activePreview" :key="activePreview" :src="activePreview" :title="previewSource==='live'?'线上 H5':'当前保存草稿的 H5 私有预览'" referrerpolicy="no-referrer"></iframe><p v-else class="empty">保存草稿后可预览 H5。</p></aside>
 </div>
 <Release v-if="item&&tab==='release'" :item="item" :dirty="dirty" @changed="refresh" />
 <History v-if="item&&tab==='history'" :item="item" @restored="row=>{accept(row);tab='edit';note='历史已恢复为草稿，线上版本未改变。'}" />
</template>
<style scoped>.config-tabs{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.config-tabs .seg{margin-bottom:15px}.place-cascader{width:100%}</style>
