<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { object, rows, text, type Body } from '../../../shared/contracts.ts';
import { copyText, phoneHref } from '../platform.ts';

const props=defineProps<{section:'home'|'catalog'|'cases'|'contact'|'directory'; body:Body}>();
const tracker=ref<HTMLElement|null>(null),index=ref(0),held=ref(false),reading=ref(false),hidden=ref(false),failed=ref<string[]>([]);
const posters=computed(()=> (Array.isArray(props.body.poster_asset_urls)?props.body.poster_asset_urls:[]).filter((src):src is string=>typeof src==='string'&&!failed.value.includes(src)));
const reduced=ref(false);let timer:ReturnType<typeof setInterval>|undefined;
function scrollSlide(to:number){const el=tracker.value;if(!el||!el.clientWidth)return;index.value=to;el.scrollTo({left:to*el.clientWidth,behavior:reduced.value?'instant':'smooth'});reading.value=(el.children[to]?.scrollTop??0)>2;}
function scrolled(){const el=tracker.value;if(!el||!el.clientWidth)return;index.value=Math.round(el.scrollLeft/el.clientWidth);reading.value=(el.children[index.value]?.scrollTop??0)>2;}
function drop(src:string){if(!failed.value.includes(src))failed.value=[...failed.value,src];void nextTick(()=>scrollSlide(Math.min(index.value,Math.max(0,posters.value.length-1))));}
function release(){held.value=false;}
function visibility(){hidden.value=document.hidden;}
function schedule(){clearInterval(timer);if(props.section==='home'&&posters.value.length>1&&!held.value&&!reading.value&&!hidden.value&&!reduced.value){timer=setInterval(()=>scrollSlide((index.value+1)%posters.value.length),4000);}}
watch([()=>posters.value.length,held,reading,hidden,reduced],schedule);
watch(()=>props.body,()=>{failed.value=[];index.value=0;reading.value=false;});
const services=computed(()=>object(props.body.services)), contact=computed(()=>object(props.body.business_contact));
const cards=computed(()=>rows(services.value.cards));
const contactAvailable=computed(()=>['qr_asset_url','wechat_id','phone','email'].some(key=>Boolean(text(contact.value[key]))));
const dialog=ref<'contact'|'image'|null>(null), zoom=ref(''), fallback=ref(''),notice=ref('');
let trigger:HTMLElement|null=null;
function open(kind:'contact'|'image',image=''){trigger=document.activeElement as HTMLElement;dialog.value=kind;zoom.value=image;fallback.value='';void nextTick(()=>document.querySelector<HTMLButtonElement>('.h5-overlay .dialog-close')?.focus());}
function close(){dialog.value=null;zoom.value='';fallback.value='';trigger?.focus();}
function keys(event:KeyboardEvent){if(event.key==='Escape'&&dialog.value)close();}
async function copy(value:string){if(await copyText(value))notice.value='已复制微信号';else fallback.value=value;}
onMounted(()=>{hidden.value=document.hidden;reduced.value=window.matchMedia('(prefers-reduced-motion: reduce)').matches;document.addEventListener('visibilitychange',visibility);window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);window.addEventListener('keydown',keys);schedule();});
onBeforeUnmount(()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pointerup',release);window.removeEventListener('pointercancel',release);window.removeEventListener('keydown',keys);});
</script>
<template>
 <section v-if="section==='home'" class="company-page" aria-label="首页">
   <div v-if="posters.length" ref="tracker" class="poster-track" role="region" aria-label="首页长图轮播" @scroll="scrolled" @pointerdown="held=true" @focusin="held=true" @focusout="release">
     <article v-for="(src,i) in posters" :key="`${src}:${i}`" class="poster-slide" @scroll="i===index && (reading=($event.currentTarget as HTMLElement).scrollTop>2)"><img :src="src" :alt="`企业产品海报，第 ${i+1} 张`" draggable="false" decoding="async" @error="drop(src)"></article>
   </div>
   <p v-else class="h5-empty">暂无展示海报</p><nav v-if="posters.length>1" class="poster-dots" aria-label="海报翻页"><component :is="'button'" v-for="(_,i) in posters" :key="i" :aria-label="`查看第 ${i+1} 张海报`" :aria-current="i===index?'true':undefined" type="button" @click="scrollSlide(i)"></component></nav>
 </section>
 <div v-else-if="section==='catalog' && (body.cover_asset_url||body.slogan_top||body.slogan_bottom)" class="catalog-cover"><img v-if="body.cover_asset_url" :src="text(body.cover_asset_url)" alt="产品目录封面"><div v-if="!body.image_has_text" class="catalog-cover-copy"><p>{{text(body.slogan_top)}}</p><strong>{{text(body.slogan_bottom)}}</strong></div></div>
 <header v-else-if="section==='cases'" class="cases-hero"><img v-if="body.background_asset_url" :src="text(body.background_asset_url)" alt=""><div><h1>{{text(body.title,'品牌案例')}}</h1><p v-if="body.intro">{{text(body.intro)}}</p></div></header>
 <section v-else-if="section==='directory'" class="directory-preview"><h2>产品目录</h2><p v-if="!rows(body.nodes).length" class="h5-empty">暂无目录</p><div v-for="node in rows(body.nodes)" :key="text(node.id)" :style="{paddingLeft:node.level==='board'?'0':node.level==='category'?'16px':'32px'}"><strong>{{text(node.name,'未命名')}}</strong><small v-if="node.enabled===false"> · 已停用</small></div></section>
 <section v-else-if="section==='contact'" class="contact-page"><header class="contact-header"><div><h1>服务与合作</h1><p v-if="services.intro">{{text(services.intro)}}</p></div><component :is="'button'" v-if="contactAvailable" class="h5-soft" type="button" @click="open('contact')">合作咨询</component></header>
  <div class="contact-content"><h2>我们能为你做什么</h2><div v-if="cards.length" class="service-list"><article v-for="(card,i) in cards" :key="i"><component :is="'button'" v-if="card.image_asset_url" type="button" @click="open('image',text(card.image_asset_url))"><img :src="text(card.image_asset_url)" :alt="text(card.title,'服务图片')" loading="lazy"></component><h3 v-if="card.title">{{text(card.title)}}</h3><p v-if="card.description">{{text(card.description)}}</p></article></div><p v-else class="h5-empty">暂无服务卡片</p>
  <section class="contact-business"><h2>{{text(contact.title,'商务联系')}}</h2><p v-if="contact.intro">{{text(contact.intro)}}</p><div v-if="contactAvailable" class="contact-card"><img v-if="contact.qr_asset_url" :src="text(contact.qr_asset_url)" alt="商务联系二维码" @click="open('contact')"><component :is="'button'" type="button" class="h5-soft" @click="open('contact')">{{contact.qr_asset_url?'查看二维码':'查看联系方式'}}</component></div><p v-else class="h5-empty">暂无公开联系方式</p></section></div>
  <div v-if="dialog" class="h5-overlay" role="dialog" aria-modal="true" :aria-label="dialog==='image'?'图片预览':'商务联系'" @click.self="close"><section class="h5-dialog"><div class="h5-section-head"><h2>{{dialog==='image'?'图片预览':text(contact.title,'商务联系')}}</h2><component :is="'button'" type="button" class="mobile-icon dialog-close" aria-label="关闭弹层" @click="close">×</component></div>
  <img v-if="dialog==='image'" :src="zoom" alt="放大的服务图片" class="zoom-image"><template v-else><img v-if="contact.qr_asset_url" class="qr-image" :src="text(contact.qr_asset_url)" alt="长按保存商务二维码"><a v-if="contact.qr_asset_url" class="h5-soft" :href="text(contact.qr_asset_url)" download="contact-code">保存二维码</a><p v-if="contact.wechat_id">微信号：{{text(contact.wechat_id)}} <component :is="'button'" type="button" class="h5-soft" @click="copy(text(contact.wechat_id))">复制</component></p><p v-if="contact.phone">电话：<a :href="phoneHref(text(contact.phone))">{{text(contact.phone)}}</a></p><p v-if="contact.email">邮箱：<a :href="`mailto:${text(contact.email)}`">{{text(contact.email)}}</a></p><input v-if="fallback" :value="fallback" readonly aria-label="手动复制微信号"><p v-if="notice" role="status">{{notice}}</p></template></section></div>
 </section>
</template>
