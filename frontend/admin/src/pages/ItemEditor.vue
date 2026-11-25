<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { ElCascader } from 'element-plus';
import 'element-plus/es/components/cascader/style/css';
import { rows, type Body, type CatalogNode, type Item, type Page, text, withQuery } from '../../../shared/contracts.ts';
import { draftImage, useEditor } from '../editor.ts';
import { h5Path } from '../visitor.ts';
import { request } from '../session.ts';
import { useRoute, useRouter } from 'vue-router';
import History from '../panels/History.vue';
import Release from '../panels/Release.vue';
import { basicFields, caseBasicFields, caseDetails, caseExtraFields, caseMedia, detailFields, productDetailAssets, productDetailPictureLimit, productMedia } from './item-fields.ts';

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
const locked=computed(()=>readonly.value||busy.value);

const steps=computed(()=>yes.value?['基础信息','产品详情','图片与展示位置']:['基础信息','案例内容与图片']);
const step=ref(0), stepBody=ref<HTMLElement|null>(null);
const lastStep=computed(()=>step.value===steps.value.length-1);
const ready=computed(()=>newItem.value||Boolean(item.value));
const showBasic=computed(()=>!props.embedded||step.value===0);
const showDetails=computed(()=>!props.embedded||step.value===1);
const showFinal=computed(()=>!props.embedded||lastStep.value);
const media=computed<{key:string;label:string;hint?:string}[]>(()=>yes.value?productMedia:caseMedia);
const detailImages = computed(() => productDetailAssets(body.value));
const placeProps={multiple:true,checkStrictly:true,emitPath:false};
const display=computed(()=>text(body.value.name??body.value.product_name, newItem.value?(yes.value?'新增产品':'新增案例'):'未命名草稿'));
const subtitle=computed(()=>{
  if(newItem.value)return yes.value?'先填写产品名称、配方编号和生产状态。':'先填写品牌、案例产品和分类。';
  const saved=item.value?.draft??item.value?.live;
  if(!saved)return '';
  return (yes.value?[saved.name,saved.formula_no]:[saved.brand_name,saved.product_name]).map(value=>text(value)).filter(Boolean).join(' · ');
});
const previewSource=ref<'draft'|'live'>('draft');
const activePreview=computed(()=>{
  if(previewSource.value==='live') return item.value?.live_id?h5Path(withQuery(yes.value?'/products':'/cases/detail',{id:item.value.id})):'';
  return item.value?.draft?h5Path(withQuery('/preview',{id:item.value.id,revision:item.value.revision,mode:sidebar.value})):'';
});
const itemPath=computed(()=>`/api/admin/items/${props.id}`);
function assign(key:string,event:Event){body.value[key]=(event.currentTarget as HTMLInputElement|HTMLTextAreaElement).value;}
function clear(key:string){delete body.value[key];}

/** Preserve a legacy long image until the editor actually changes the gallery. */
function setDetailImages(images: string[]) {
  delete body.value.detail_asset_id;
  body.value.detail_asset_ids = images;
}
function addDetailImage(event: Event) {
  if (locked.value || detailImages.value.length >= productDetailPictureLimit) return;
  void choose(event, id => setDetailImages([...detailImages.value, id]));
}
function moveDetailImage(index: number, step: -1 | 1) {
  const next = [...detailImages.value];
  const destination = index + step;
  if (!next[destination]) return;
  [next[index], next[destination]] = [next[destination], next[index]];
  setDetailImages(next);
}
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
/** Steps only change the visible part of the working copy; they never save drafts. */
async function goToStep(index:number){
  if(busy.value||index<0||index>=steps.value.length)return;
  step.value=index;
  await nextTick();
  if(stepBody.value){stepBody.value.scrollTop=0;stepBody.value.focus();}
}
async function store(){
  // Without a loaded item, useEditor would POST instead of PUT for an edit.
  if(locked.value||!ready.value||(props.embedded&&!lastStep.value))return;
  const saved=await save(collection.value);
  if(!saved)return;
  if(props.embedded){emit('saved',saved);return;}
  if(newItem.value)await router.replace(`/${collection.value}/${saved.id}`);
}
function canDismiss(){return !busy.value&&(!dirty.value||globalThis.confirm('还有未保存的修改。确定放弃吗？'));}
function cancel(){if(canDismiss())emit('cancel');}
defineExpose({canDismiss});
async function refresh(){if(!newItem.value)await load(itemPath.value);}
async function reset(){
  if(busy.value||(dirty.value&&!globalThis.confirm('确定丢弃工作副本并重新加载？')))return;
  await refresh();
  if(props.embedded&&item.value&&!error.value)await goToStep(0);
}
onMounted(async()=>{await refresh();await options();});
</script>

<template>
  <header v-if="!embedded" class="page-head"><div><RouterLink :to="`/${collection}`" class="muted">← {{ yes?'全部产品':'全部案例' }}</RouterLink><h1>{{ display }}</h1><p class="muted">{{item?.live_id?'已有线上版本':'未上线'}} <template v-if="item">· 修订 {{ item.revision }}</template> <span v-if="dirty" class="pill warn">尚未保存</span></p></div></header>
  <template v-if="!embedded">
    <p v-if="note" role="status" class="notice">{{ note }}</p>
    <p v-if="error" role="alert" class="inline-error">{{ error }} <button v-if="!newItem" type="button" class="btn link" @click="reset">{{ conflict?'核对最新修订':'重试加载' }}</button></p>
    <div class="config-tabs"><nav class="seg" aria-label="内容编辑视图"><button type="button" :aria-pressed="tab==='edit'" @click="tab='edit'">内容编辑</button><button v-if="item" type="button" :aria-pressed="tab==='release'" @click="tab='release'">发布检查</button><button v-if="item" type="button" :aria-pressed="tab==='history'" @click="tab='history'">版本记录</button></nav><button v-if="!readonly" type="button" class="btn primary" :disabled="busy||!ready" @click="store">保存草稿</button></div>
  </template>
  <div v-if="tab==='edit'" :class="embedded?'wizard-editor':'edit-layout'">
    <component :is="embedded?'form':'section'" :class="embedded?'wizard-form':'panel stack'" @submit.prevent="store">
      <div v-if="embedded" class="wizard-overview">
        <p v-if="subtitle" class="wizard-subtitle">{{ subtitle }}</p>
        <ol class="wizard-steps" aria-label="编辑步骤">
          <li v-for="(label,index) in steps" :key="label" :aria-current="step===index?'step':undefined" :class="{'step-done':index<step}">
            <span class="step-marker" aria-hidden="true">{{ index<step?'✓':index+1 }}</span><span>{{ label }}</span>
          </li>
        </ol>
      </div>
      <p v-if="embedded&&!ready" class="wizard-loading" role="status">{{ busy?'正在载入资料…':'未能载入编辑资料。' }}</p>
      <div v-else ref="stepBody" :class="embedded?'wizard-content':'stack'" :tabindex="embedded?-1:undefined" :aria-label="embedded?steps[step]:undefined" :role="embedded?'region':undefined">
        <section v-if="yes&&showBasic" class="editor-pane">
          <h2 v-if="!embedded">产品资料</h2>
          <div class="form-grid">
            <label v-for="f in basicFields" :key="f.key" class="field">{{ f.label }}<input :value="text(body[f.key])" :disabled="locked" @input="assign(f.key,$event)"></label>
            <label class="field">是否生产过<select aria-label="是否生产过" :value="text(body.production_status)" :disabled="locked" @change="assign('production_status',$event)"><option value="">请选择</option><option>已生产</option><option>未生产</option><option>待确认</option></select></label>
            <label class="field field-wide">简短功效<input :value="text(body.short_benefit)" :disabled="locked" @input="assign('short_benefit',$event)"></label>
          </div>
        </section>
        <section v-if="yes&&showDetails" class="editor-pane">
          <p v-if="embedded" class="pane-intro">这些内容会显示在 H5 产品详情页。</p>
          <label v-for="f in detailFields" :key="f.key" class="field">{{ f.label }}<textarea rows="2" :value="text(body[f.key])" :disabled="locked" @input="assign(f.key,$event)" /></label>
        </section>
        <section v-if="!yes&&showBasic" class="editor-pane">
          <h2 v-if="!embedded">案例信息</h2>
          <div class="form-grid">
            <label v-for="f in caseBasicFields" :key="f.key" class="field">{{ f.label }}<input :value="text(body[f.key])" :disabled="locked" @input="assign(f.key,$event)"></label>
            <label class="field">案例分类<select aria-label="案例分类" :value="text(body.category_key)" :disabled="locked" @change="assign('category_key',$event)"><option value="">不指定</option><option v-for="entry in categories" :key="text(entry.key)" :value="text(entry.key)">{{text(entry.label)}}</option></select></label>
            <label class="field">内部关联产品<select aria-label="内部关联产品" :value="text(body.related_product_id)" :disabled="locked" @change="assign('related_product_id',$event)"><option value="">不关联</option><option v-for="row in related" :key="row.id" :value="row.id">{{text(row.summary?.name??row.draft?.name??row.live?.name,'未命名产品')}}</option></select></label>
            <label v-for="f in caseExtraFields" :key="f.key" class="field">{{ f.label }}<input :value="text(body[f.key])" :disabled="locked" @input="assign(f.key,$event)"></label>
          </div>
        </section>
        <section v-if="showFinal" class="editor-pane">
          <div v-if="!yes" class="form-grid">
            <label v-for="f in caseDetails" :key="f.key" class="field" :class="{'field-wide':!embedded}">{{ f.label }}<textarea rows="3" :value="text(body[f.key])" :disabled="locked" @input="assign(f.key,$event)" /></label>
          </div>
          <h2 v-if="!embedded">图片素材</h2>
          <div class="editor-assets">
            <div v-for="{key,label:caption,hint} in media" :key="key" class="media-field">
              <label class="asset-label" :for="`editor-file-${key}`">{{ caption }}</label>
              <div class="media-row">
                <img v-if="draftImage(item,body[key],pending)" :class="{'catalog-image-preview':key==='thumbnail_asset_id'}" :src="draftImage(item,body[key],pending)" :alt="caption">
                <span v-else class="muted">未上传</span>
                <input :id="`editor-file-${key}`" type="file" accept="image/png,image/jpeg,image/webp" :disabled="locked" @change="choose($event,id=>body[key]=id)">
                <button v-if="body[key]&&!readonly" type="button" class="btn" :disabled="busy" :aria-label="`移除${caption}`" @click="clear(key)">移除</button>
              </div>
              <small v-if="hint">{{ hint }}</small>
            </div>
            <section v-if="yes" class="detail-assets" aria-labelledby="editor-detail-images">
              <div>
                <h3 id="editor-detail-images">详情竖图</h3>
                <small>最多 {{ productDetailPictureLimit }} 张，按下方顺序展示在详情文字之后。</small>
              </div>
              <div v-for="(id,index) in detailImages" :key="id" class="media-row detail-asset-row">
                <img v-if="draftImage(item,id,pending)" :src="draftImage(item,id,pending)" :alt="`详情竖图 ${index+1}`">
                <span class="detail-asset-number">第 {{ index+1 }} 张</span>
                <div v-if="!readonly" class="toolbar">
                  <button type="button" class="btn" :disabled="busy||index===0" :aria-label="`上移详情竖图 ${index+1}`" @click="moveDetailImage(index,-1)">上移</button>
                  <button type="button" class="btn" :disabled="busy||index===detailImages.length-1" :aria-label="`下移详情竖图 ${index+1}`" @click="moveDetailImage(index,1)">下移</button>
                  <button type="button" class="btn" :disabled="busy" :aria-label="`移除详情竖图 ${index+1}`" @click="setDetailImages(detailImages.filter((_,i)=>i!==index))">移除</button>
                </div>
              </div>
              <label v-if="!readonly&&detailImages.length<productDetailPictureLimit" class="field">添加详情竖图
                <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="locked" @change="addDetailImage">
              </label>
            </section>
            <label v-if="!yes" class="field">展示顺序<input type="number" min="0" step="1" :disabled="locked" :value="Number(body.sort_order??0)" @input="body.sort_order=Number(($event.target as HTMLInputElement).value)"></label>
          </div>
          <section v-if="yes" class="editor-place">
            <h2>展示位置</h2>
            <p v-if="!placeOptions.length" class="muted">目录未配置，先在「板块与分类」建立展示位置。</p>
            <template v-else>
              <p v-if="embedded" class="pane-intro">选择产品出现的板块或分类，可多选。</p>
              <el-cascader v-model="places" class="place-cascader" aria-label="展示位置" :popper-class="embedded?'product-place-popper':undefined" :options="placeOptions" :props="placeProps" clearable :disabled="locked" placeholder="选择展示位置" />
            </template>
          </section>
        </section>
      </div>
      <footer v-if="embedded" class="wizard-footer">
        <div v-if="error" class="inline-error" role="alert">{{ error }} <button v-if="!ready||conflict" type="button" class="btn link" :disabled="busy" @click="reset">{{ conflict?'核对最新修订':'重试加载' }}</button></div>
        <div class="wizard-actions">
          <button type="button" class="btn" :disabled="busy" @click="cancel">取消</button>
          <small v-if="ready">{{ lastStep?'保存为草稿，不会直接上线。':'切换步骤不会保存草稿。' }}</small>
          <div v-if="ready" class="wizard-nav">
            <button v-if="step>0" type="button" class="btn" :disabled="busy" @click="goToStep(step-1)">上一步</button>
            <button v-if="!lastStep" type="button" class="btn primary" :disabled="busy" @click="goToStep(step+1)">下一步</button>
            <button v-else-if="!readonly" type="submit" class="btn primary" :disabled="busy">保存</button>
          </div>
        </div>
      </footer>
    </component>
    <aside v-if="!embedded" class="preview-panel stack"><div class="section-head"><h2>H5 预览</h2><span v-if="item?.draft" class="pill">保存修订 {{item.revision}}</span></div><div class="seg" aria-label="预览来源"><button type="button" :aria-pressed="previewSource==='draft'" @click="previewSource='draft'">编辑预览</button><button type="button" :aria-pressed="previewSource==='live'" :disabled="!item?.live_id" @click="previewSource='live'">线上版本</button></div><div v-if="yes && previewSource==='draft'" class="seg"><button type="button" :aria-pressed="sidebar==='card'" @click="sidebar='card'">列表卡片</button><button type="button" :aria-pressed="sidebar==='detail'" @click="sidebar='detail'">详情页</button></div><p v-if="dirty" class="muted">未保存修改不会显示在预览里。</p><iframe v-if="activePreview" :key="activePreview" :src="activePreview" :title="previewSource==='live'?'线上 H5':'当前保存草稿的 H5 私有预览'" referrerpolicy="no-referrer"></iframe><p v-else class="empty">保存草稿后可预览 H5。</p></aside>
  </div>
  <Release v-if="!embedded&&item&&tab==='release'" :item="item" :dirty="dirty" @changed="refresh" />
  <History v-if="!embedded&&item&&tab==='history'" :item="item" @restored="row=>{accept(row);tab='edit';note='历史已恢复为草稿，线上版本未改变。'}" />
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
.wizard-editor,.wizard-form{display:flex;flex:1;flex-direction:column;min-height:0;min-width:0}
.wizard-overview{flex:none;padding:0 var(--form-inset)}
.wizard-subtitle{margin:5px 0 0;font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wizard-steps{display:flex;align-items:stretch;list-style:none;margin:14px 0 0;padding:8px 0;border-radius:8px;background:var(--soft);font-size:13px;color:var(--muted)}
.wizard-steps li{display:flex;flex:1;align-items:center;gap:7px;min-width:0;padding:2px 10px;line-height:1.35}
.wizard-steps li+li{border-left:1px solid var(--line)}
.wizard-steps li[aria-current]{color:var(--ink);font-weight:650}
.step-marker{display:grid;place-items:center;flex:none;width:22px;height:22px;border:1px solid var(--line);border-radius:50%;background:white;font-size:12px;font-weight:650}
.wizard-steps li[aria-current] .step-marker{background:var(--blue);border-color:var(--blue);color:white}
.step-done .step-marker{background:#e2eef1;color:var(--blue)}
.wizard-content,.wizard-loading{flex:1;min-height:0;padding:18px var(--form-inset) 20px}
.wizard-content{overflow:auto;overscroll-behavior:contain}
.wizard-loading{color:var(--muted)}
.wizard-content .form-grid,.wizard-content .editor-assets{grid-template-columns:repeat(2,minmax(0,1fr))}
.wizard-content .editor-assets{align-items:start}
.wizard-content .pane-intro{font-size:13px;line-height:1.5;color:var(--muted)}
.wizard-content .field,.wizard-content .asset-label{font-size:13px}
.wizard-content .field input,.wizard-content .field select,.wizard-content .field textarea{font-size:14px;line-height:1.5}
.wizard-content .field textarea{min-height:62px}
.wizard-content .media-field small{display:block;margin-top:5px}
.wizard-content .media-row{min-height:49px;padding:6px;gap:6px;border:1px solid var(--line);border-radius:8px;background:var(--soft)}
.wizard-content .media-row .muted{font-size:12px}
.wizard-content .media-row input{font-size:12px;padding:4px;min-height:34px}
.wizard-content .media-row img{width:46px;height:38px}
.wizard-content .media-row .btn{padding:4px 6px;min-height:34px}
.media-row .catalog-image-preview{width:65px;height:65px;object-fit:contain;background:#fff}
.wizard-content .media-row .catalog-image-preview{width:38px;height:38px}
.detail-assets{grid-column:1/-1;display:grid;gap:8px;min-width:0}
.detail-asset-row{flex-wrap:wrap}
.detail-asset-row img{object-fit:contain}
.detail-asset-number{font-size:13px;min-width:42px}
.wizard-content .editor-place{gap:6px}
.wizard-content .editor-place h2{font-size:15px}
.wizard-content :deep(.place-cascader .el-input__inner){border:0;background:transparent;padding:0}
:global(.product-place-popper){max-width:calc(100dvw - 24px)}
:global(.product-place-popper .el-cascader-panel){overflow-x:auto}
.wizard-footer{flex:none;padding:12px var(--form-inset);border-top:1px solid var(--line);background:var(--soft)}
.wizard-footer .inline-error{margin:0 0 10px;max-height:4.5em;overflow:auto}
.wizard-actions,.wizard-nav{display:flex;align-items:center;gap:8px}
.wizard-actions{flex-wrap:wrap}
.wizard-nav{margin-left:auto}
@media(max-width:560px){
  .wizard-content .form-grid,.wizard-content .editor-assets{grid-template-columns:minmax(0,1fr)}
  .wizard-content{padding-block:14px}
  .wizard-steps li{padding-inline:6px;gap:4px;font-size:12px}
  .wizard-steps .step-marker{width:18px;height:18px;font-size:11px}
  .wizard-actions .btn{min-height:40px}
  .wizard-actions small{order:1;flex-basis:100%}
  :global(.product-place-popper .el-cascader-menu){min-width:0;width:calc((100dvw - 32px)/3)}
  :global(.product-place-popper .el-cascader-node){padding-inline:8px}
  :global(.product-place-popper .el-cascader-node__label){padding-inline:5px}
}
</style>
