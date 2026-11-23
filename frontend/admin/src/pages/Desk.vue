<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { message, text, withQuery, type AuditRow, type Item, type Page } from '../../../shared/contracts.ts';
import { draftImage, slots } from '../editor.ts';
import { account, request } from '../session.ts';

const props=withDefaults(defineProps<{mode?:'desk'|'release'|'history'}>(),{mode:'desk'});
const list=ref<Item[]>([]), events=ref<AuditRow[]>([]), count=ref(0), error=ref(''), loading=ref(false), filter=ref('all'), query=ref('');
const destinations=[['首页','长图轮播与海报顺序','/pages/home_posters'],['产品目录','业务板块、分类和产品资料','/directory'],['品牌案例','品牌、产品与合作亮点','/cases'],['联系我们','上传二维码和联系方式','/pages/business_contact']];
const names=Object.fromEntries([...slots,['directory','板块与分类']]);
function name(row:Item){const body=row.draft??row.live??{};return row.config_slot?names[row.config_slot]:text(body.name??body.product_name,'未命名草稿');}
function photo(row:Item){const body=row.draft??row.live??{}, posters=body.poster_asset_ids;const id=body.thumbnail_asset_id??body.cover_asset_id??body.image_asset_id??body.background_asset_id??body.qr_asset_id??(Array.isArray(posters)?posters[0]:undefined);return draftImage(row,id,{});}
function heroPhoto(row:Item){const body=row.draft??row.live??{};return draftImage(row,body.cover_asset_id??body.thumbnail_asset_id,{});}
function link(row:Item, action?:string){const path=row.config_slot?(row.config_slot==='directory'?'/directory':`/pages/${row.config_slot}`):`/${row.kind==='product'?'products':'cases'}/${row.id}`;return action?`${path}?tab=${action}`:path;}
const highlighted=computed(()=>list.value.find(row=>row.kind==='product'&&row.draft)??list.value.find(row=>row.kind==='product'));
const shown=computed(()=>list.value.filter(row=>{
 const content=[name(row),row.kind==='product'?'产品资料':row.kind==='case'?'品牌案例':names[row.config_slot??''],text((row.draft??row.live)?.formula_no)].join(' ').toLowerCase();
 return content.includes(query.value.trim().toLowerCase()) && (filter.value==='all'||(filter.value==='draft'?row.draft:filter.value==='live'?row.live_id:!row.live_id)) && (props.mode!=='history'||row.has_history) && (props.mode!=='release'||Boolean(row.draft));
}));
const pageTitle=computed(()=>props.mode==='history'?'版本与下架':props.mode==='release'?'发布检查':'内容工作台');
const actions:Record<string,string>={publish:'发布',unlist:'下架',archive:'归档',restore:'恢复草稿',delete_draft:'删除草稿',account_updated:'调整账号',account_created:'开通账号'};

/** The desk summarizes real records only. Its shortcuts resolve to the same item-based editors. */
async function load(){
 loading.value=true;error.value='';
 try{
  const audit=await request<Page<AuditRow>>('/api/admin/audit?page_size=2');events.value=audit.items;
  if(!account.value?.can_edit){list.value=[];return;}
  const [products,cases,...configs]=await Promise.all([request<Page<Item>>('/api/admin/products?page_size=100'),request<Page<Item>>('/api/admin/cases?page_size=100'),...Object.keys(names).map(key=>request<Item>(`/api/admin/config/${key}`))] as const);
  count.value=products.total;list.value=[...products.items.slice(0,1),...configs,...cases.items,...products.items.slice(1)];
 }catch(cause){list.value=[];events.value=[];error.value=message(cause);}finally{loading.value=false;}
}
onMounted(load);
</script>
<template>
 <header class="page-head"><div><h1>{{pageTitle}}</h1><p class="muted">{{mode==='desk'?'从一条产品资料开始，核对编辑、发布人与访客各自看到的内容。':mode==='release'?'选择已保存的草稿，核对缺项与影响位置后再发布。':'选择有发布记录的条目，核对历史、下架影响或恢复草稿。'}}</p></div></header>
 <section v-if="mode==='desk'" :class="['desk-hero',{'has-picture':highlighted&&heroPhoto(highlighted)}]"><div class="hero-copy"><span class="pill" :class="{warn:highlighted?.draft}">{{!account?.can_edit&&account?.can_manage?'企业管理员':highlighted?.draft?'待处理草稿':'产品资料'}}</span><h2>{{!account?.can_edit&&account?.can_manage?'管理本企业的运营账号':highlighted?.draft?'核对产品草稿，再交给发布人':'维护企业的展示内容'}}</h2><p>{{!account?.can_edit&&account?.can_manage?'授予或收回同事的权限，不改变已经发布的内容。':highlighted?`${name(highlighted)} · ${highlighted.draft?'有待核对的修改':'没有待发布草稿'}。${highlighted.live_id?'访客仍看到已发布版本。':'当前不对外展示。'}`:'从产品列表或展示页开始，保存草稿后再检查发布。'}}</p><div class="toolbar"><RouterLink v-if="account?.can_edit" class="btn primary" to="/products">查看全部产品</RouterLink><RouterLink v-if="highlighted" class="btn" :to="link(highlighted)">编辑{{text((highlighted.draft??highlighted.live)?.formula_no,'产品')}}</RouterLink><RouterLink v-if="!account?.can_edit&&account?.can_manage" class="btn primary" to="/accounts">前往账号管理</RouterLink></div></div><img v-if="highlighted&&heroPhoto(highlighted)" :src="heroPhoto(highlighted)" alt="当前产品图片"></section>
 <p v-if="error" class="inline-error" role="alert">{{error}} <button class="btn link" @click="load">重试</button></p>
 <div :class="{'desk-columns':mode==='desk'&&account?.can_edit}"><section v-if="account?.can_edit" class="panel"><div class="section-head"><h2>{{mode==='desk'?'常用内容':'选择条目'}}</h2><RouterLink to="/products">全部产品（{{count}}） →</RouterLink></div><div class="toolbar"><input v-model="query" type="search" aria-label="搜索内容或页面名称" placeholder="搜索内容或页面名称"><select v-model="filter" aria-label="筛选内容"><option value="all">全部内容</option><option value="draft">有草稿</option><option value="live">已上线</option><option value="off">未上线 / 已下架</option></select></div><table class="desk-table"><thead><tr><th>资料</th><th>公开状态</th><th>草稿</th></tr></thead><tbody><tr v-for="row in shown" :key="row.id"><td><div class="desk-item"><img v-if="photo(row)" :src="photo(row)" alt=""><span v-else class="desk-placeholder" aria-hidden="true">◇</span><div><RouterLink :to="link(row,mode==='desk'?undefined:mode)">{{name(row)}}</RouterLink><small>{{row.kind==='product'?'产品资料':row.kind==='case'?'品牌案例':'展示内容'}}<template v-if="(row.draft??row.live)?.formula_no"> · {{text((row.draft??row.live)?.formula_no)}}</template></small></div></div></td><td><span :class="['pill',{'live':row.live_id}]">{{row.live_id?'已上线':row.has_history?'已下架':'从未上线'}}</span></td><td><span v-if="row.draft" class="pill warn">有草稿</span><span v-else>—</span></td></tr></tbody></table><p v-if="!shown.length" class="empty">{{loading?'正在加载内容…':'没有符合条件的内容。'}}</p></section>
 <aside v-if="mode==='desk'" class="stack"><section v-if="account?.can_edit" class="panel desk-links"><div class="section-head"><h2>按展示页维护</h2><small>固定四页</small></div><RouterLink v-for="[title,desc,to] in destinations" :key="to" :to="to"><div><strong>{{title}}</strong><small>{{desc}}</small></div><span aria-hidden="true">→</span></RouterLink></section>
 <section class="panel"><div class="section-head"><h2>{{account?.can_edit?'最近内容操作':'最近账号操作'}}</h2></div><div v-for="event in events" :key="event.id" class="desk-event"><strong>{{actions[event.action]??event.action}} · {{event.target_id}}</strong><small>操作者 {{event.actor_id}}　{{event.occurred_at.replace('T',' ').slice(5,16)}}</small></div><p v-if="!events.length" class="empty">{{loading?'正在加载…':'没有可见的操作记录。'}}</p></section></aside></div>
</template>
<style scoped>
.desk-hero{display:grid;background:#ecf3f5;border-radius:9px;overflow:hidden;min-height:185px;margin-bottom:22px}.desk-hero.has-picture{grid-template-columns:minmax(0,1fr) 34%}.hero-copy{align-self:center;padding:22px 26px}.hero-copy h2{font-size:25px;margin:7px 0}.hero-copy>p{color:#425f69;margin-bottom:14px}.desk-hero>img{width:100%;height:190px;align-self:stretch;object-fit:cover}.desk-columns{display:grid;grid-template-columns:minmax(0,1.52fr) minmax(255px,.9fr);gap:18px;align-items:start}.desk-links{background:var(--soft)}.desk-links>a{display:flex;justify-content:space-between;align-items:center;padding:12px 0;color:var(--ink)}.desk-links>a+a,.desk-event+.desk-event{border-top:1px solid var(--line)}.desk-links small,.desk-item small,.desk-event small{display:block;margin-top:3px}.desk-event{padding:9px 0}.desk-table{border-collapse:collapse;width:100%}.desk-table td,.desk-table th{text-align:left;border-bottom:1px solid var(--line);padding:10px 0}.desk-table th{font-size:13px;font-weight:500;color:var(--muted)}.desk-table td:not(:first-child){white-space:nowrap}.desk-item{display:flex;align-items:center;gap:11px}.desk-item img,.desk-placeholder{width:49px;height:49px;object-fit:cover;border-radius:5px;flex:none}.desk-placeholder{display:grid;place-items:center;background:#e8f1f3;color:var(--blue)}.desk-item a,.desk-links strong{font-weight:600}@media(max-width:850px){.desk-columns{grid-template-columns:1fr}}@media(max-width:700px){.hero-copy{padding:15px}.hero-copy h2{font-size:20px}.desk-item img,.desk-placeholder{width:37px;height:37px}.desk-hero.has-picture{grid-template-columns:minmax(0,1fr) 25%}}
</style>
