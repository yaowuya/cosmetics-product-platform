<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElCascader, ElTabs, ElTabPane } from 'element-plus';
import 'element-plus/es/components/cascader/style/css';
import 'element-plus/es/components/tabs/style/css';
import { rows, type Body, type CatalogNode, type Item, type Page, text, withQuery } from '../../../shared/contracts.ts';
import { draftImage, useEditor } from '../editor.ts';
import { h5Path } from '../visitor.ts';
import { request } from '../session.ts';
import { useRoute, useRouter } from 'vue-router';
import History from '../panels/History.vue';
import Release from '../panels/Release.vue';

const props=defineProps<{id:string;kind?:'product'|'case';history?:boolean;embedded?:boolean}>();
const emit=defineEmits<{saved:[item:Item];cancel:[]}>();
const router=useRouter(), route=useRoute();
const {item,body,places,pending,busy,error,note,conflict,dirty,accept,load,save,choose}=useEditor();
const routeTab=props.history?'history':route.query.tab;
const tab=ref(props.embedded?'edit':routeTab==='history'||routeTab==='release'?routeTab:'edit');
const sidebar=ref<'card'|'detail'>('detail'),nodes=ref<CatalogNode[]>([]),related=ref<Item[]>([]),categories=ref<Body[]>([]);
const kind=computed(()=>item.value?.kind??props.kind??'product');
const collection=computed(()=>kind.value==='case'?'cases':'products');
const readonly=computed(()=>Boolean(item.value?.archived_at));
const yes=computed(()=>kind.value==='product');
const newItem=computed(()=>props.id==='new');
const compact=computed(()=>props.embedded&&newItem.value&&yes.value);
const locked=computed(()=>readonly.value||(compact.value&&busy.value));
const productPane=ref('basic');
const basicFields=[{key:'name',label:'产品名称'},{key:'english_name',label:'英文名称（选填）'},{key:'formula_no',label:'配方编号'}];
const detailFields=[{key:'benefit',label:'功效'},{key:'ingredients',label:'核心成分'},{key:'highlights',label:'产品亮点'}];
const caseFields=[{key:'brand_name',label:'品牌名称'},{key:'product_name',label:'案例产品名称'},{key:'case_no',label:'案例编号（选填）'},{key:'series',label:'系列（选填）'},{key:'highlight',label:'案例亮点',large:true},{key:'description',label:'案例说明（选填）',large:true}];
const productMedia=[
  {key:'cover_asset_id',label:'产品封面图',hint:'用于产品列表和详情页顶部，建议 16:9。'},
  {key:'detail_asset_id',label:'产品详情长图',hint:'展示在详情页文字下方。'},
];
const media=computed<{key:string;label:string;hint?:string}[]>(()=>yes.value?productMedia:[{key:'image_asset_id',label:'案例图片'}]);
// Reuse the same fields in the full editor and in the compact, tabbed create form.
const paneAttrs=(name:string,label:string)=>compact.value?{name,label}:{};
const placeProps={multiple:true,checkStrictly:true,emitPath:false};
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
async function store(){
  if(busy.value||readonly.value)return;
  const saved=await save(collection.value);
  if(!saved)return;
  if(props.embedded){emit('saved',saved);return;}
  if(newItem.value)await router.replace(`/${collection.value}/${saved.id}`);
}
function canDismiss(){return !busy.value&&(!dirty.value||globalThis.confirm('放弃未保存的产品草稿？'));}
function cancel(){if(canDismiss())emit('cancel');}
defineExpose({canDismiss});
async function refresh(){if(!newItem.value)await load(itemPath.value);}
async function reset(){if(!dirty.value||globalThis.confirm('确定丢弃工作副本并重新加载？'))await refresh();}
onMounted(async()=>{await refresh();await options();});
</script>

<template>
  <header v-if="!embedded" class="page-head"><div><RouterLink :to="`/${collection}`" class="muted">← {{ yes?'全部产品':'全部案例' }}</RouterLink><h1>{{ display }}</h1><p class="muted">{{item?.live_id?'已有线上版本':'未上线'}} <template v-if="item">· 修订 {{ item.revision }}</template> <span v-if="dirty" class="pill warn">尚未保存</span></p></div></header>
  <template v-if="!compact">
    <p v-if="note" role="status" class="notice">{{ note }}</p>
    <p v-if="error" role="alert" class="inline-error">{{ error }} <button v-if="!newItem" type="button" class="btn link" @click="reset">{{ conflict?'核对最新修订':'重试加载' }}</button></p>
    <div class="config-tabs"><nav class="seg" aria-label="内容编辑视图"><button type="button" :aria-pressed="tab==='edit'" @click="tab='edit'">内容编辑</button><button v-if="item" type="button" :aria-pressed="tab==='release'" @click="tab='release'">发布检查</button><button v-if="item" type="button" :aria-pressed="tab==='history'" @click="tab='history'">版本记录</button></nav><button v-if="!readonly" type="button" class="btn primary" :disabled="busy" @click="store">保存草稿</button></div>
  </template>
  <div v-if="tab==='edit'" :class="embedded?(compact?'compact-editor':'stack'):'edit-layout'">
    <component :is="compact?'form':'section'" :class="compact?'product-form':'panel stack'" @submit.prevent="store">
      <component :is="compact?ElTabs:'div'" v-bind="compact?{modelValue:productPane,stretch:true}:{}" :class="compact?'product-tabs':'stack'" @update:model-value="productPane=String($event)">
        <component v-if="yes" :is="compact?ElTabPane:'section'" v-bind="paneAttrs('basic','基础信息')" class="editor-pane">
          <h2 v-if="!compact">产品资料</h2>
          <p v-else class="pane-intro">填写用来识别产品的资料。简短功效会显示在 H5 产品列表中。</p>
          <div class="form-grid">
            <label v-for="f in basicFields" :key="f.key" class="field">{{ f.label }}<input :value="text(body[f.key])" :disabled="locked" @input="assign(f.key,$event)"></label>
            <label class="field">是否生产过<select aria-label="是否生产过" :value="text(body.production_status)" :disabled="locked" @change="assign('production_status',$event)"><option value="">请选择</option><option>已生产</option><option>未生产</option><option>待确认</option></select></label>
            <label class="field field-wide">简短功效<input :value="text(body.short_benefit)" :disabled="locked" @input="assign('short_benefit',$event)"></label>
          </div>
        </component>
        <component v-if="yes" :is="compact?ElTabPane:'section'" v-bind="paneAttrs('details','产品详情')" class="editor-pane">
          <p v-if="compact" class="pane-intro">这些内容会显示在 H5 产品详情页。</p>
          <label v-for="f in detailFields" :key="f.key" class="field">{{ f.label }}<textarea rows="2" :value="text(body[f.key])" :disabled="locked" @input="assign(f.key,$event)" /></label>
        </component>
        <section v-if="!yes" class="stack">
          <h2>案例信息</h2>
          <div class="form-grid"><label v-for="f in caseFields" :key="f.key" class="field" :class="{'field-wide':f.large}">{{ f.label }}<textarea v-if="f.large" :value="text(body[f.key])" :disabled="readonly" @input="assign(f.key,$event)"/><input v-else :value="text(body[f.key])" :disabled="readonly" @input="assign(f.key,$event)"></label></div>
          <div class="form-grid"><label class="field">案例分类<select :value="text(body.category_key)" :disabled="readonly" @change="assign('category_key',$event)"><option value="">不指定</option><option v-for="entry in categories" :key="text(entry.key)" :value="text(entry.key)">{{text(entry.label)}}</option></select></label><label class="field">内部关联产品<select :value="text(body.related_product_id)" :disabled="readonly" @change="assign('related_product_id',$event)"><option value="">不关联</option><option v-for="row in related" :key="row.id" :value="row.id">{{text(row.summary?.name??row.draft?.name??row.live?.name,'未命名产品')}}</option></select></label><label class="field">展示顺序<input type="number" min="0" step="1" :disabled="readonly" :value="Number(body.sort_order??0)" @input="body.sort_order=Number(($event.target as HTMLInputElement).value)"></label></div>
        </section>
        <component :is="compact?ElTabPane:'section'" v-bind="paneAttrs('media','图片与展示位置')" class="editor-pane">
          <h2 v-if="!compact">图片素材</h2>
          <div class="editor-assets">
            <div v-for="{key,label:caption,hint} in media" :key="key" class="media-field">
              <label class="asset-label" :for="`editor-file-${key}`">{{ caption }}</label>
              <small v-if="compact&&hint">{{ hint }}</small>
              <div class="media-row">
                <img v-if="draftImage(item,body[key],pending)" :src="draftImage(item,body[key],pending)" :alt="caption">
                <span v-else class="muted">未上传</span>
                <input :id="`editor-file-${key}`" type="file" accept="image/png,image/jpeg,image/webp" :disabled="readonly||busy" @change="choose($event,id=>body[key]=id)">
                <button v-if="body[key]&&!readonly" type="button" class="btn" :disabled="busy" :aria-label="`移除${caption}`" @click="clear(key)">移除</button>
              </div>
            </div>
          </div>
          <section v-if="yes" class="editor-place">
            <h2>展示位置</h2>
            <p v-if="!placeOptions.length" class="muted">目录未配置，先在「板块与分类」建立展示位置。</p>
            <template v-else>
              <p v-if="compact" class="pane-intro">选择产品出现的板块或分类，可多选。</p>
              <el-cascader v-model="places" class="place-cascader" aria-label="展示位置" :popper-class="compact?'product-place-popper':undefined" :options="placeOptions" :props="placeProps" clearable :disabled="locked" placeholder="选择展示位置" />
            </template>
          </section>
        </component>
      </component>
      <footer v-if="compact" class="product-form-footer">
        <p v-if="error" role="alert" class="inline-error">{{ error }}</p>
        <div class="product-form-actions">
          <small>可先保存草稿，发布前再补齐资料。</small>
          <div><button type="button" class="btn" :disabled="busy" @click="cancel">取消</button><button type="submit" class="btn primary" :disabled="busy">保存草稿</button></div>
        </div>
      </footer>
    </component>
    <aside v-if="!embedded" class="preview-panel stack"><div class="section-head"><h2>H5 预览</h2><span v-if="item?.draft" class="pill">保存修订 {{item.revision}}</span></div><div class="seg" aria-label="预览来源"><button type="button" :aria-pressed="previewSource==='draft'" @click="previewSource='draft'">编辑预览</button><button type="button" :aria-pressed="previewSource==='live'" :disabled="!item?.live_id" @click="previewSource='live'">线上版本</button></div><div v-if="yes && previewSource==='draft'" class="seg"><button type="button" :aria-pressed="sidebar==='card'" @click="sidebar='card'">列表卡片</button><button type="button" :aria-pressed="sidebar==='detail'" @click="sidebar='detail'">详情页</button></div><p v-if="dirty" class="muted">未保存修改不会显示在预览里。</p><iframe v-if="activePreview" :key="activePreview" :src="activePreview" :title="previewSource==='live'?'线上 H5':'当前保存草稿的 H5 私有预览'" referrerpolicy="no-referrer"></iframe><p v-else class="empty">保存草稿后可预览 H5。</p></aside>
  </div>
  <Release v-if="item&&tab==='release'" :item="item" :dirty="dirty" @changed="refresh" />
  <History v-if="item&&tab==='history'" :item="item" @restored="row=>{accept(row);tab='edit';note='历史已恢复为草稿，线上版本未改变。'}" />
</template>

<style scoped>
.config-tabs{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.config-tabs .seg{margin-bottom:15px}
.field-wide{grid-column:1/-1}
.place-cascader{width:100%}
.editor-pane,.editor-assets,.editor-place{display:grid;gap:12px;min-width:0}
.asset-label{display:block;font-weight:600;margin-bottom:4px}
.media-row input{min-width:0;flex:1}
.media-row img{flex:none}
.compact-editor,.product-form,.product-tabs{display:flex;flex:1;flex-direction:column;min-height:0;min-width:0}
.product-tabs{--el-color-primary:var(--blue);--el-text-color-primary:var(--ink)}
.product-tabs :deep(.el-tabs__header){flex:none;margin:0;padding-inline:var(--form-inset)}
.product-tabs :deep(.el-tabs__nav-wrap::after){height:1px;background:var(--line)}
.product-tabs :deep(.el-tabs__content){flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
.product-form :deep(.place-cascader .el-input__inner){border:0;background:transparent;padding:0}
:global(.product-place-popper){max-width:calc(100dvw - 24px)}
:global(.product-place-popper .el-cascader-panel){overflow-x:auto}
@media(max-width:560px){
  :global(.product-place-popper .el-cascader-menu){min-width:0;width:calc((100dvw - 32px)/3)}
  :global(.product-place-popper .el-cascader-node){padding-inline:8px}
  :global(.product-place-popper .el-cascader-node__label){padding-inline:5px}
}
.product-tabs .editor-pane{padding:18px var(--form-inset) 20px}
.product-tabs .form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.product-form .pane-intro{font-size:13px;line-height:1.5;color:var(--muted)}
.product-form .field{font-size:13px}
.product-form .field input,.product-form .field select,.product-form .field textarea{font-size:14px;line-height:1.5}
.product-form .field textarea{min-height:62px}
.product-form .editor-assets{grid-template-columns:repeat(2,minmax(0,1fr))}
.product-form .media-field{padding:12px;border:1px solid var(--line);border-radius:8px}
.product-form .media-row{border:0;min-height:48px;padding:6px 0 0;gap:6px}
.product-form .media-row .muted{font-size:12px}
.product-form .media-row input{font-size:12px;padding:4px;min-height:34px}
.product-form .media-row img{width:46px;height:38px}
.product-form .media-row .btn{padding:4px 6px;min-height:34px}
.product-form .editor-place{gap:6px}
.product-form .editor-place h2{font-size:15px}
.product-form-footer{flex:none;padding:12px var(--form-inset);border-top:1px solid var(--line);background:var(--soft)}
.product-form-footer .inline-error{margin:0 0 10px;max-height:4.5em;overflow:auto}
.product-form-actions,.product-form-actions>div{display:flex;align-items:center;gap:8px}
.product-form-actions{justify-content:space-between;flex-wrap:wrap}
.product-form-actions>div{margin-left:auto}
@media(max-width:560px){
  .product-tabs .form-grid,.product-form .editor-assets{grid-template-columns:minmax(0,1fr)}
  .product-tabs :deep(.el-tabs__item){font-size:13px;padding-inline:10px}
  .product-tabs .editor-pane{padding-block:14px}
  .product-form-actions .btn{min-height:40px}
}
</style>
