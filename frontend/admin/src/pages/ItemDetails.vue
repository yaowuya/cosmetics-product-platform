<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { message, rows, text, withQuery, type Body, type CatalogNode, type Item, type Page, type Version } from '../../../shared/contracts.ts';
import { draftImage, nodePath } from '../editor.ts';
import { request } from '../session.ts';
import { basicFields, caseBasicFields, caseDetails, caseExtraFields, caseMedia, detailFields, productDetailAssets, productMedia } from './item-fields.ts';

/** Read-only list dialog for one item ID: show its saved draft, or its actual release snapshot if there is no draft. */
const props=defineProps<{id:string;nodes:readonly CatalogNode[]}>();
const emit=defineEmits<{close:[]}>();
type Snapshot={item:Item;version:Version|null};
const snapshot=shallowRef<Snapshot|null>(null);
const loading=ref(false), error=ref(''), categoryName=ref(''), linkedName=ref('');
const failedAssets=ref(new Set<string>()), caseLabelError=ref(false);
let viewing=true;
const item=computed(()=>snapshot.value?.item);
const version=computed(()=>snapshot.value?.version);
const body=computed(()=>item.value?.draft??version.value?.body??null);
const product=computed(()=>item.value?.kind==='product');
const fields=computed(()=>product.value?basicFields:[...caseBasicFields,...caseExtraFields]);
const fieldsLong=computed(()=>product.value?detailFields:caseDetails);
const positions=computed(()=>version.value?.place_ids??item.value?.place_ids??[]);
const sourceLabel=computed(()=>{
  const state=item.value?.archived_at?'已归档 · ':'';
  const source=item.value?.draft?'已保存草稿':item.value?.live_id?'线上版本':'历史版本';
  return state+source;
});
const revisionLabel=computed(()=>version.value?`版本 ${version.value.seq}`:`修订 ${item.value?.revision??''}`);
const media = computed(() => {
  const slots = (product.value ? productMedia : caseMedia).map(({key,label}) => ({key,label,url:imageUrl(body.value?.[key])}));
  if (!product.value) return slots;
  const detail = productDetailAssets(body.value);
  return [...slots, ...detail.map((id, index) => ({key:`detail-${index}`,label:`详情竖图 ${index+1}`,url:imageUrl(id)}))];
});

function imageUrl(value:unknown){
  const current=item.value;
  if(!current||typeof value!=='string'||!/^\d+$/.test(value))return '';
  // The viewer is private even when the release was once public or its placements are now disabled.
  if(version.value)return withQuery(`/api/admin/media/${value}`,{item_id:current.id,seq:version.value.seq});
  return current.draft?draftImage(current,value,{}):'';
}

/** Only the latest release can be live; after unlisting it remains discoverable through history. */
async function readVersion(current:Item):Promise<Version|null>{
  if(current.draft||!(current.live_id||current.has_history))return null;
  const page=await request<Page<Version>>(withQuery(`/api/admin/items/${current.id}/versions`,{page_size:1}));
  const latest=page.items[0];
  return latest&&(!current.live_id||latest.release_id===current.live_id)?latest:null;
}

/** Resolve display names without replacing saved references or updating a newer or closed dialog. */
function resolveCaseLabels(data:Body, source:Snapshot){
  const key=text(data.category_key), id=text(data.related_product_id);
  const stillCurrent=()=>viewing&&snapshot.value===source;
  const unavailable=()=>{if(stillCurrent())caseLabelError.value=true;};
  if(key)void request<Item>('/api/admin/config/case_header').then(header=>{
    if(!stillCurrent())return;
    const filter=rows((header.live??header.draft)?.filters).find(row=>row.key===key);
    categoryName.value=text(filter?.label);
  }).catch(unavailable);
  if(/^\d+$/.test(id))void request<Item>(`/api/admin/items/${id}`).then(linked=>{
    if(stillCurrent())linkedName.value=text((linked.draft??linked.live)?.name);
  }).catch(unavailable);
}

/** Reload the item and its source together so retry never reuses an outdated draft image URL. */
async function load(){
  if(loading.value)return;
  loading.value=true;
  snapshot.value=null;
  error.value='';
  failedAssets.value.clear();
  caseLabelError.value=false;
  categoryName.value=linkedName.value='';
  try{
    const current=await request<Item>(`/api/admin/items/${props.id}`);
    if(!viewing)return;
    const release=await readVersion(current);
    if(!viewing)return;
    if(!current.draft&&(current.live_id||current.has_history)&&!release){
      error.value='版本资料已变化，请重试加载。';
      return;
    }
    const next={item:current,version:release};
    snapshot.value=next;
    if(current.kind==='case'&&body.value)resolveCaseLabels(body.value,next);
  }catch(cause){if(viewing)error.value=message(cause);}
  finally{if(viewing)loading.value=false;}
}
onMounted(load);
onBeforeUnmount(()=>{viewing=false;});
</script>

<template>
  <div class="item-viewer">
    <div class="viewer-content" role="region" aria-label="条目资料" tabindex="0">
      <p v-if="loading" role="status" class="muted viewer-status">正在载入资料…</p>
      <p v-else-if="error" class="inline-error" role="alert">{{ error }} <button type="button" class="btn link" @click="load">重试加载</button></p>
      <p v-else-if="!body" class="empty">没有可查看的已保存资料。</p>
      <template v-else>
        <div class="viewer-meta"><span class="pill">{{ sourceLabel }}</span><span>{{ revisionLabel }}</span></div>
        <section class="viewer-section">
          <h2>基础信息</h2>
          <dl class="viewer-facts">
            <div v-for="field in fields" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ text(body[field.key])||'—' }}</dd></div>
            <template v-if="product">
              <div><dt>是否生产过</dt><dd>{{ text(body.production_status)||'—' }}</dd></div>
              <div class="viewer-wide"><dt>简短功效</dt><dd>{{ text(body.short_benefit)||'—' }}</dd></div>
            </template>
            <template v-else>
              <div><dt>案例分类</dt><dd>{{ categoryName||text(body.category_key)||'不指定' }}</dd></div>
              <div><dt>内部关联产品</dt><dd>{{ linkedName||(body.related_product_id?`#${text(body.related_product_id)}`:'不关联') }}</dd></div>
              <div><dt>展示顺序</dt><dd>{{ body.sort_order??0 }}</dd></div>
            </template>
          </dl>
          <p v-if="caseLabelError" class="muted" role="status">部分名称无法加载，已显示保存的引用。</p>
        </section>
        <section class="viewer-section">
          <h2>{{ product?'产品详情':'案例内容' }}</h2>
          <dl class="viewer-facts">
            <div v-for="field in fieldsLong" :key="field.key" class="viewer-wide"><dt>{{ field.label }}</dt><dd>{{ text(body[field.key])||'—' }}</dd></div>
          </dl>
        </section>
        <section class="viewer-section">
          <h2>图片素材</h2>
          <div v-if="failedAssets.size" class="inline-error" role="alert">
            <span>图片无法加载</span> <button type="button" class="btn link" @click="load">重试加载</button>
          </div>
          <div class="viewer-assets">
            <figure v-for="asset in media" :key="asset.key">
              <figcaption>{{ asset.label }}</figcaption>
              <img v-if="asset.url&&!failedAssets.has(asset.key)" :src="asset.url" :alt="asset.label" loading="lazy"
                   @error="!loading&&failedAssets.add(asset.key)">
              <p v-else class="muted">{{ asset.url?'无法显示':'未上传' }}</p>
            </figure>
          </div>
        </section>
        <section v-if="product" class="viewer-section">
          <h2>展示位置</h2>
          <ul v-if="positions.length" class="viewer-positions"><li v-for="id in positions" :key="id" class="pill">{{ nodePath(nodes,id) }}</li></ul>
          <p v-else class="muted">未设置</p>
        </section>
      </template>
    </div>
    <footer class="viewer-footer"><span class="muted">仅供查看</span><button type="button" class="btn" @click="emit('close')">关闭</button></footer>
  </div>
</template>

<style scoped>
.item-viewer{display:flex;flex:1;min-height:0;flex-direction:column}
.viewer-content{flex:1;min-height:0;overflow:auto;padding:16px var(--form-inset);overscroll-behavior:contain}
.viewer-content:focus-visible{outline-offset:-2px}
.viewer-status{margin:8px 0}
.viewer-meta,.viewer-footer{display:flex;align-items:center;gap:9px;font-size:13px}
.viewer-meta{margin-bottom:16px;color:var(--muted)}
.viewer-section+.viewer-section{border-top:1px solid var(--line);margin-top:16px;padding-top:16px}
.viewer-section h2{font-size:15px;margin:0 0 10px}
.viewer-facts,.viewer-assets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;margin:0}
.viewer-facts dt,.viewer-assets figcaption{color:var(--muted);font-size:12px;margin-bottom:4px}
.viewer-facts dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.viewer-wide{grid-column:1/-1}
.viewer-assets figure{margin:0}
.viewer-assets img{display:block;max-width:100%;max-height:190px;object-fit:contain;border-radius:6px}
.viewer-positions{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:0;padding:0}
.viewer-positions .pill{white-space:normal;overflow-wrap:anywhere}
.viewer-footer{justify-content:space-between;flex:none;border-top:1px solid var(--line);padding:10px var(--form-inset)}
@media(max-width:480px){.viewer-facts,.viewer-assets{grid-template-columns:minmax(0,1fr)}}
</style>
