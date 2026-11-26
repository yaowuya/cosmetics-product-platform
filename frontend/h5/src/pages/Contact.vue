<script setup lang="ts">
import { usePublishedPage } from '../use-published-page.ts';
import PageContent from '../views/PageContent.vue';
import ShowcaseNav from '../views/ShowcaseNav.vue';
const {body,loading,error,retry}=usePublishedPage('contact');
</script>
<template><div class="mobile-page"><main class="mobile-main"><p v-if="loading" class="h5-empty" role="status">正在加载…</p><div v-else-if="error" class="h5-empty" role="alert">{{error}} <component :is="'button'" class="h5-soft" type="button" @click="retry">重试</component></div><PageContent v-else section="contact" :body="body"/></main><ShowcaseNav current="contact"/></div></template>
