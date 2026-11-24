<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { message, text, withQuery, type Item, type Page, type Version } from '../../../shared/contracts.ts';
import { account, request } from '../session.ts';
import { restoreConfirmation } from '../editor.ts';

const props=defineProps<{item:Item}>();
const emit=defineEmits<{restored:[item:Item]}>();
const versions=ref<Version[]>([]), selected=ref<Version|null>(null), busy=ref(false), error=ref(''), note=ref('');
const page=ref(1),total=ref(0);
const selectedImage=computed(()=>{const version=selected.value;if(!version)return '';const id=text(version.body.cover_asset_id??version.body.thumbnail_asset_id??version.body.image_asset_id??version.body.qr_asset_id);return id?`/api/admin/media/${id}?item_id=${props.item.id}&seq=${version.seq}`:'';});
async function load(){busy.value=true;error.value='';try{const data=await request<Page<Version>>(withQuery(`/api/admin/items/${props.item.id}/versions`,{page:page.value,page_size:10}));versions.value=data.items;total.value=data.total;}catch(cause){error.value=message(cause);}finally{busy.value=false;}}
/** Restore a snapshot as a new draft. Publication always requires a separate confirmation. */
async function restore(version:Version){
  const reviewed=props.item;
  const overwrite=Boolean(reviewed.draft);
  if(!globalThis.confirm(`确定把「${text((reviewed.draft??reviewed.live)?.name??(reviewed.draft??reviewed.live)?.product_name,`条目 ${reviewed.id}`)}」版本 ${version.seq} 恢复为草稿？${overwrite?'将覆盖当前草稿。':''}线上版本不变。`))return;
  const payload=restoreConfirmation(reviewed,overwrite);if(!payload)return;
  busy.value=true;error.value='';note.value='';
  try{const item=await request<Item>(`/api/admin/items/${reviewed.id}/versions/${version.seq}/restore`,'POST',payload);note.value='已恢复为草稿，线上版本未改变。';emit('restored',item);}
  catch(cause){error.value=message(cause);}finally{busy.value=false;}
}
onMounted(load);
</script>

<template>
  <section class="panel stack" aria-label="历史版本"><div class="section-head"><h2>版本记录</h2><button type="button" class="btn" @click="load">刷新</button></div>
  <p v-if="note" class="notice" role="status">{{ note }}</p><p v-if="error" role="alert" class="inline-error">{{ error }}</p><p v-if="!versions.length" class="empty">{{busy?'正在加载版本…':'还没有已发布版本。'}}</p>
  <div v-for="version in versions" :key="version.release_id" class="list-line"><button type="button" class="btn link" @click="selected=version">查看版本 {{ version.seq }}</button><span class="muted">{{ version.created_at }} · 操作者 {{ version.actor_id }}</span><button type="button" class="btn" :disabled="!account?.can_edit||busy||Boolean(item.archived_at)" @click="restore(version)">恢复为草稿</button></div>
  <div v-if="selected" class="panel stack"><h3>版本 {{ selected.seq }} 的内容</h3><strong>{{ text(selected.body.name??selected.body.product_name??selected.body.title,'页面配置') }}</strong><small>来源修订 {{ selected.source_revision }}，展示位置 {{ selected.place_ids.length }}</small><img v-if="selectedImage" :src="selectedImage" class="detail-image" alt="当前历史版本的私有图片"/><p v-if="text(selected.body.benefit??selected.body.description)" class="muted">{{ text(selected.body.benefit??selected.body.description) }}</p></div>
  <div v-if="total>10" class="toolbar"><button type="button" class="btn" :disabled="page===1" @click="page--;load()">上一页</button><span>第 {{page}} 页</span><button type="button" class="btn" :disabled="page*10>=total" @click="page++;load()">下一页</button></div>
  </section>
</template>
