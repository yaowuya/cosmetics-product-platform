<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { text, type PublicItem } from '../../../shared/contracts.ts';
import { copyText, goBack } from '../platform.ts';
const props=defineProps<{item:PublicItem;mode:'card'|'detail';preview?:boolean}>();
const display=computed(()=>text(props.item.body.name,'未命名产品'));
const code=computed(()=>text(props.item.body.formula_no));
const photo=computed(()=>text(props.item.body.cover_asset_url));
const long=computed(()=>text(props.item.body.detail_asset_url));
const thumbnail = computed(() => props.preview ? '' : text(props.item.body.cover_thumbnail_url));
const failedThumbnail = ref('');
const cardPhoto = computed(() => thumbnail.value && thumbnail.value !== failedThumbnail.value ? thumbnail.value : photo.value);
const detailSlot = ref<HTMLElement | null>(null);
const readyLong = ref('');
const observesViewport = typeof IntersectionObserver === 'function';
const copyFallback=ref(false), notice=ref('');
const details=[['benefit','功效'],['ingredients','核心成分'],['highlights','产品亮点']];
async function copy(){if(await copyText(code.value)){notice.value='配方编号已复制';}else copyFallback.value=true;}

watch(thumbnail, () => { failedThumbnail.value = ''; });

/** Only retry the current thumbnail, and allow the original request to fail without a loop. */
function useOriginal(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  if (image.isConnected && image.getAttribute('src') === thumbnail.value) failedThumbnail.value = thumbnail.value;
}

// Observe the actual page viewport. The one-pixel target remains measurable before the image exists.
watch([detailSlot, long], ([target, src], _previous, onCleanup) => {
  if (props.preview || !observesViewport || !target || !src) return;
  const observer = new IntersectionObserver(entries => {
    if (target !== detailSlot.value || src !== long.value || !entries[0]?.isIntersecting) return;
    readyLong.value = src;
    observer.disconnect();
  }, { rootMargin: '160px 0px' });
  observer.observe(target);
  onCleanup(() => observer.disconnect());
}, { flush: 'post' });
</script>
<template>
 <component :is="preview?'div':'a'" v-if="mode==='card'" class="product-card" :href="preview?undefined:`/products?id=${item.id}`"><img v-if="cardPhoto" :key="cardPhoto" class="product-thumb" :src="cardPhoto" alt="" loading="lazy" @error="useOriginal"><span v-else class="product-thumb no-image" aria-hidden="true"></span><div class="product-copy"><strong>{{display}}</strong><p>{{text(item.body.short_benefit)}}</p></div></component>
 <article v-else class="detail-view">
  <header class="detail-header"><component :is="'button'" v-if="!preview" class="mobile-icon" type="button" aria-label="返回产品目录" @click="goBack('/catalog')">‹</component><span v-else class="detail-spacer"></span><span>产品详情</span><span class="detail-spacer"></span></header>
  <img v-if="photo" :src="photo" :alt="display" class="detail-photo">
  <section class="detail-info"><span class="detail-label">产品名称</span><h1>{{display}}</h1><dl class="detail-fields"><div v-for="[key,label] in details" :key="key"><dt>{{label}}</dt><dd>{{text(item.body[key],'—')}}</dd></div><div><dt>配方编号</dt><dd><strong>{{code||'—'}}</strong><component :is="'button'" v-if="code" type="button" class="h5-soft" @click="copy">复制</component></dd></div><div><dt>是否生产过</dt><dd><span class="h5-pill">{{text(item.body.production_status,'待确认')}}</span></dd></div></dl></section>
  <div v-if="long" ref="detailSlot" class="detail-long-slot">
    <img v-if="preview || !observesViewport || readyLong === long" :src="long" :alt="`${display} · 产品详情长图`"
      class="detail-long" :loading="!preview && !observesViewport ? 'lazy' : undefined" decoding="async">
  </div>
  <p v-if="notice" class="h5-note" role="status">{{notice}}</p><div v-if="copyFallback" class="h5-overlay" role="dialog" aria-modal="true" aria-label="复制配方编号" @click.self="copyFallback=false"><section class="h5-dialog"><h2>复制内容</h2><p>可长按选择配方编号。</p><textarea :value="code" readonly aria-label="待复制的配方编号"></textarea><component :is="'button'" type="button" class="h5-soft" @click="copyFallback=false">完成</component></section></div>
 </article>
</template>

<style scoped>
.detail-long-slot { min-height: 1px; }
</style>
