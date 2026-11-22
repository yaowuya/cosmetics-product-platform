<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { publicGet } from '../public-api.ts';
import { message, type Body, type PublicPage } from '../../../shared/contracts.ts';
import PageContent from '../views/PageContent.vue';
import ShowcaseNav from '../views/ShowcaseNav.vue';
const body=ref<Body>({}),loading=ref(true),error=ref('');
async function load(){loading.value=true;error.value='';try{body.value=(await publicGet<PublicPage>('/api/public/pages/contact'))?.body??{};}catch(cause){error.value=message(cause);}finally{loading.value=false;}}
onMounted(load);
</script>
<template><div class="mobile-page"><main class="mobile-main"><p v-if="loading" class="h5-empty" role="status">正在加载…</p><div v-else-if="error" class="h5-empty" role="alert">{{error}} <component :is="'button'" class="h5-soft" type="button" @click="load">重试</component></div><PageContent v-else section="contact" :body="body"/></main><ShowcaseNav current="contact"/></div></template>
