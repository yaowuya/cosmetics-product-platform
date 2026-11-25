<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { text, type PublicItem } from '../../../shared/contracts.ts';
import { copyText, goBack } from '../platform.ts';
import ProductDetailImage from './ProductDetailImage.vue';
const props=defineProps<{item:PublicItem;mode:'card'|'detail';preview?:boolean}>();
const display=computed(()=>text(props.item.body.name,'未命名产品'));
const code=computed(()=>text(props.item.body.formula_no));
const photo=computed(()=>text(props.item.body.cover_asset_url));
const longImages = computed(() => {
  const urls = props.item.body.detail_asset_urls;
  const originals = Array.isArray(urls) ? urls : [props.item.body.detail_asset_url];
  return originals.map(url => text(url)).filter(Boolean);
});
const square = computed(() => {
  const published = props.preview ? '' : text(props.item.body.catalog_image_url);
  if (published) return published;
  const legacy = text(props.item.body.thumbnail_asset_url);
  // Older API responses can alias the detail cover under the thumbnail field.
  return legacy === photo.value ? '' : legacy;
});
const thumbnail = computed(() => {
  const src = text(props.item.body.cover_thumbnail_url);
  // Older backends derived this same field from the wide cover, without an explicit catalog image.
  return !props.preview && square.value && square.value === props.item.body.catalog_image_url
    && src === `${square.value}/thumbnail` ? src : '';
});
const failedImages = ref<string[]>([]);
const cardPhoto = computed(() => [thumbnail.value, square.value].find(src => src && !failedImages.value.includes(src)) ?? '');
const copyFallback=ref(false), notice=ref('');
const details=[['benefit','功效'],['ingredients','核心成分'],['highlights','产品亮点']];
async function copy(){if(await copyText(code.value)){notice.value='配方编号已复制';}else copyFallback.value=true;}

watch([thumbnail, square], () => { failedImages.value = []; });

/** Fall back from a derivative to its own original, then show the card placeholder. */
function onCardImageError(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  if (image.isConnected && image.getAttribute('src') === cardPhoto.value) failedImages.value.push(cardPhoto.value);
}
</script>
<template>
 <component :is="preview?'div':'a'" v-if="mode==='card'" class="product-card" :href="preview?undefined:`/products?id=${item.id}`"><img v-if="cardPhoto" :key="cardPhoto" class="product-thumb" :src="cardPhoto" alt="" loading="lazy" @error="onCardImageError"><span v-else class="product-thumb no-image" aria-hidden="true"></span><div class="product-copy"><strong>{{display}}</strong><p>{{text(item.body.short_benefit)}}</p></div></component>
 <article v-else class="detail-view">
  <header class="detail-header"><component :is="'button'" v-if="!preview" class="mobile-icon" type="button" aria-label="返回产品目录" @click="goBack('/catalog')">‹</component><span v-else class="detail-spacer"></span><span>产品详情</span><span class="detail-spacer"></span></header>
  <img v-if="photo" :src="photo" :alt="display" class="detail-photo">
  <section class="detail-info"><span class="detail-label">产品名称</span><h1>{{display}}</h1><dl class="detail-fields"><div v-for="[key,label] in details" :key="key"><dt>{{label}}</dt><dd>{{text(item.body[key],'—')}}</dd></div><div><dt>配方编号</dt><dd><strong>{{code||'—'}}</strong><component :is="'button'" v-if="code" type="button" class="h5-soft" @click="copy">复制</component></dd></div><div><dt>是否生产过</dt><dd><span class="h5-pill">{{text(item.body.production_status,'待确认')}}</span></dd></div></dl></section>
  <ProductDetailImage v-for="(src, index) in longImages" :key="`${index}:${src}`" :src="src" :preview="preview"
    :alt="`${display} · 产品详情长图${longImages.length > 1 ? ` ${index + 1}` : ''}`"/>
  <p v-if="notice" class="h5-note" role="status">{{notice}}</p><div v-if="copyFallback" class="h5-overlay" role="dialog" aria-modal="true" aria-label="复制配方编号" @click.self="copyFallback=false"><section class="h5-dialog"><h2>复制内容</h2><p>可长按选择配方编号。</p><textarea :value="code" readonly aria-label="待复制的配方编号"></textarea><component :is="'button'" type="button" class="h5-soft" @click="copyFallback=false">完成</component></section></div>
 </article>
</template>

<style scoped>
img.product-thumb { object-fit: contain; background: #fff; }
</style>
