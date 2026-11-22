<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { queryValue } from '../browse.ts';
import { publicGet } from '../public-api.ts';
import { message, type PublicItem } from '../../../shared/contracts.ts';
import ProductView from '../views/ProductView.vue';
const item=ref<PublicItem|null>(null),error=ref('');
async function load(){error.value='';const id=queryValue('id');if(!/^[1-9]\d{0,18}$/.test(id)){error.value='内容不存在';return;}
 try{item.value=await publicGet<PublicItem>(`/api/public/products/${id}`)??null;}catch(cause){error.value=message(cause);}}
onMounted(load);
</script>
<template><main class="mobile-detail"><ProductView v-if="item" :item="item" mode="detail"/><div v-else class="h5-empty" :role="error?'alert':'status'">{{error||'正在加载产品…'}} <a v-if="error" href="/catalog" class="h5-soft">返回产品目录</a></div></main></template>
