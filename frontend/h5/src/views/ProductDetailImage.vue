<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{ src: string; alt: string; preview?: boolean }>();
const slot = ref<HTMLElement | null>(null);
const requested = ref(false);
const settled = ref(false);
const nativeLazy = typeof IntersectionObserver !== 'function';
let observer: IntersectionObserver | undefined;

/** Observe this image's position without fetching its original until it approaches the viewport. */
onMounted(() => {
  if (props.preview || nativeLazy || !slot.value) return;
  observer = new IntersectionObserver(entries => {
    if (!entries[0]?.isIntersecting) return;
    requested.value = true;
    observer?.disconnect();
  }, { rootMargin: '160px 0px' });
  observer.observe(slot.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="slot" class="detail-long-slot" :class="{ 'detail-long-pending': !preview && !settled }">
    <img v-if="preview || nativeLazy || requested" :src="src" :alt="alt" class="detail-long"
      :loading="!preview && nativeLazy ? 'lazy' : undefined" decoding="async" @load="settled = true" @error="settled = true">
  </div>
</template>

<style scoped>
/* Until the original dimensions are known, keep successive observers from sharing one position. */
.detail-long-pending { min-height: 100vh; min-height: 100svh; }
</style>
