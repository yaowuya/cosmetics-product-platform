<script setup lang="ts">
const props=defineProps<{current:'home'|'catalog'|'cases'|'contact'}>();
const links=[{key:'home',href:'/',label:'首页'}, {key:'catalog',href:'/catalog',label:'产品目录'}, {key:'cases',href:'/cases',label:'品牌案例'}, {key:'contact',href:'/contact',label:'联系我们'}] as const;
let switching = false;

/** Normal clicks reuse the mounted tab. Other link gestures keep browser behavior. */
function switchPage(event: MouseEvent, link: typeof links[number]) {
  if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  if (props.current === link.key || switching) return;
  switching = true;
  uni.switchTab({
    url: link.href,
    fail: () => window.location.assign(link.href),
    complete: () => { switching = false; },
  });
}
</script>
<template>
 <nav class="bottom-nav" aria-label="主导航"><a v-for="link in links" :key="link.key" :href="link.href" :class="{'mobile-current':current===link.key}" :aria-current="current===link.key?'page':undefined" @click="switchPage($event,link)"><span class="mobile-nav-icon">
 <svg v-if="link.key==='home'" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/></svg>
 <svg v-else-if="link.key==='catalog'" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
 <svg v-else-if="link.key==='cases'" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18M10 13v2h4v-2"/></svg>
 <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16v3a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2h3l2 5-3 2a14 14 0 0 0 7 7l2-3z"/></svg>
 </span><span>{{link.label}}</span></a></nav>
</template>
