<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

const props = defineProps<{ sources: unknown; preview?: boolean }>();
const rotationDelay = 4000;
const tracker = ref<HTMLElement | null>(null);
const index = ref(0);
const held = ref(false);
const reading = ref(false);
const hidden = ref(false);
const reduced = ref(false);
const elapsed = ref(false);
const generation = ref(0);
const requested = reactive(new Set<number>());
const loaded = reactive(new Set<number>());
const failed = reactive(new Set<string>());
let timer: ReturnType<typeof setTimeout> | undefined;
let scrollTarget: number | undefined;

const posters = computed(() => {
  const values = Array.isArray(props.sources) ? props.sources : [];
  return values.flatMap((src, position) => typeof src === 'string' && src && !failed.has(src) ? [{ src, position }] : []);
});
const current = computed(() => posters.value[index.value]);
const nextIndex = computed(() => (index.value + 1) % posters.value.length);
const following = computed(() => posters.value[nextIndex.value]);
const canRotate = computed(() => posters.value.length > 1 && (props.preview || loaded.has(current.value?.position))
  && !held.value && !reading.value && !hidden.value && !reduced.value);
const nextReady = computed(() => props.preview || loaded.has(following.value?.position));

/** Keep requested images mounted so an automatic or manual return can reuse the decoded original. */
function requestPosters() {
  const active = current.value;
  if (!active || props.preview) return;
  // The current slide is requested immediately, including a slide selected during the first download.
  requested.add(active.position);
  // Prefetch only after the selected image has loaded and decoded.
  if (posters.value.length > 1 && loaded.has(active.position)) requested.add(following.value.position);
}

function selectSlide(to: number) {
  index.value = to;
  reading.value = (tracker.value?.children[to]?.scrollTop ?? 0) > 2;
}

function scrollSlide(to: number, immediate = false) {
  const track = tracker.value;
  if (!track?.clientWidth) return;
  selectSlide(to);
  const left = to * track.clientWidth;
  scrollTarget = Math.abs(track.scrollLeft - left) > 2 ? to : undefined;
  track.scrollTo({ left, behavior: reduced.value || immediate ? 'instant' : 'smooth' });
}

function scrolled() {
  const track = tracker.value;
  if (!track?.clientWidth) return;
  const to = Math.round(track.scrollLeft / track.clientWidth);
  if (Math.abs(track.scrollLeft - to * track.clientWidth) > 2) return;
  // Programmatic jumps can cross another snapped position before arriving at the selected slide.
  if (scrollTarget !== undefined && to !== scrollTarget) return;
  scrollTarget = undefined;
  selectSlide(to);
}

/** Wait for decoding as well as download before a slide is eligible for automatic entry. */
async function onImageLoad(position: number, src: string, event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  try {
    await image.decode?.();
    if (image.isConnected) loaded.add(position);
  } catch {
    onImageError(src, image);
  }
}

/** Keep the visible slide selected when a different image fails, even if its index moves. */
function onImageError(src: string, image: HTMLImageElement) {
  if (!image.isConnected || failed.has(src)) return;
  const active = current.value?.position;
  failed.add(src);
  const retained = posters.value.findIndex(poster => poster.position === active);
  const last = Math.max(0, posters.value.length - 1);
  selectSlide(retained === -1 ? Math.min(index.value, last) : retained);
  void nextTick(() => scrollSlide(index.value, true));
}

/** Reset request and event identity together on retry or when a new publication is shown. */
function reset() {
  generation.value++;
  requested.clear();
  loaded.clear();
  failed.clear();
  scrollTarget = undefined;
  index.value = 0;
  reading.value = false;
  requestPosters();
  void nextTick(() => scrollSlide(0, true));
}

function hold() {
  scrollTarget = undefined;
  held.value = true;
}

function wheel(event: WheelEvent) {
  if (event.deltaX || event.shiftKey) scrollTarget = undefined;
}

function release() { held.value = false; }
function checkVisibility() { hidden.value = document.hidden; }

/** Restart the idle interval when the slide or a pause condition changes. */
function schedule() {
  clearTimeout(timer);
  elapsed.value = false;
  if (canRotate.value) timer = setTimeout(() => { elapsed.value = true; }, rotationDelay);
}

watch([posters, current, () => loaded.size], requestPosters, { immediate: true });
watch(() => props.sources, reset);
watch([current, following, canRotate], schedule);
watch([elapsed, nextReady], ([idle, ready]) => {
  if (idle && ready && canRotate.value) scrollSlide(nextIndex.value);
});

onMounted(() => {
  checkVisibility();
  reduced.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.addEventListener('visibilitychange', checkVisibility);
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  schedule();
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  document.removeEventListener('visibilitychange', checkVisibility);
  window.removeEventListener('pointerup', release);
  window.removeEventListener('pointercancel', release);
});
</script>

<template>
  <section class="company-page" aria-label="首页">
    <div v-if="posters.length" ref="tracker" class="poster-track" role="region" aria-label="首页长图轮播"
      @scroll="scrolled" @pointerdown="hold" @wheel="wheel" @focusin="held = true" @focusout="release">
      <article v-for="(poster, i) in posters" :key="`${generation}:${poster.position}`" class="poster-slide"
        @scroll="i === index && (reading = ($event.currentTarget as HTMLElement).scrollTop > 2)">
        <img v-if="preview || requested.has(poster.position)" :src="poster.src" :alt="`企业产品海报，第 ${i + 1} 张`"
          :fetchpriority="!preview && i === 0 ? 'high' : undefined" draggable="false" decoding="async"
          @load="onImageLoad(poster.position, poster.src, $event)"
          @error="onImageError(poster.src, $event.currentTarget as HTMLImageElement)">
      </article>
    </div>
    <p v-else-if="failed.size === 0 || preview" class="h5-empty">暂无展示海报</p>
    <div v-else class="h5-empty" role="alert">
      海报加载失败 <component :is="'button'" class="h5-soft" type="button" @click="reset">重试</component>
    </div>
    <nav v-if="posters.length > 1" class="poster-dots" aria-label="海报翻页">
      <component :is="'button'" v-for="(poster, i) in posters" :key="poster.position" :aria-label="`查看第 ${i + 1} 张海报`"
        :aria-current="i === index ? 'true' : undefined" type="button" @click="scrollSlide(i)"></component>
    </nav>
  </section>
</template>
