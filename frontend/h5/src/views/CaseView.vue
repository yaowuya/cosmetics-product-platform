<script setup lang="ts">
import { computed } from 'vue';
import { text, type PublicItem } from '../../../shared/contracts.ts';
import { goBack } from '../platform.ts';
const props=defineProps<{item:PublicItem;mode:'featured'|'card'|'detail';preview?:boolean}>();
const brand=computed(()=>text(props.item.body.brand_name,'品牌案例'));
const name=computed(()=>text(props.item.body.product_name));
const image=computed(()=>text(props.item.body.image_asset_url));
</script>
<template>
 <component :is="preview?'div':'a'" v-if="mode!=='detail'" :class="['case-card',{'case-featured':mode==='featured'}]" :href="preview?undefined:`/cases/detail?id=${item.id}`"><img v-if="image" :src="image" alt="" loading="lazy"><div v-else class="case-image no-image"></div><div class="case-copy"><strong>{{brand}}</strong><span>{{name}}</span><p v-if="mode==='featured'">{{text(item.body.highlight)}}</p></div></component>
 <article v-else class="detail-view"><header class="detail-header"><component :is="'button'" v-if="!preview" type="button" class="mobile-icon" aria-label="返回品牌案例" @click="goBack('/cases')">‹</component><span v-else class="detail-spacer"></span><span>案例详情</span><span class="detail-spacer"></span></header><img v-if="image" :src="image" :alt="name||brand" class="detail-photo"><section class="detail-info"><div class="detail-label">{{brand}}</div><h1>{{name||brand}}</h1><dl class="detail-fields"><div><dt>案例亮点</dt><dd>{{text(item.body.highlight,'—')}}</dd></div><div v-if="item.body.description"><dt>案例说明</dt><dd>{{text(item.body.description)}}</dd></div><div v-if="item.body.series"><dt>所属系列</dt><dd>{{text(item.body.series)}}</dd></div><div v-if="item.body.case_no"><dt>案例编号</dt><dd>{{text(item.body.case_no)}}</dd></div></dl></section></article>
</template>
