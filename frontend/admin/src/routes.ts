import { createRouter, createWebHistory } from 'vue-router';
import { account, ensureSession, landing } from './session.ts';

/** PC routes preserve the /admin/ mount and never proxy private state to H5 public pages. */
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {path:'/login',name:'login',component:()=>import('./pages/Login.vue')},
    {path:'/',name:'desk',component:()=>import('./pages/Desk.vue')},
    {path:'/release',component:()=>import('./pages/Desk.vue'),props:{mode:'release'},meta:{publish:true}},
    {path:'/history',component:()=>import('./pages/Desk.vue'),props:{mode:'history'},meta:{edit:true}},
    {path:'/pages',redirect:'/pages/home_posters'},
    {path:'/pages/:slot',component:()=>import('./pages/Configuration.vue'),meta:{edit:true}},
    {path:'/directory',component:()=>import('./pages/Directory.vue'),meta:{edit:true}},
    {path:'/products',component:()=>import('./pages/Items.vue'),props:{kind:'product'},meta:{edit:true}},
    {path:'/cases',component:()=>import('./pages/Items.vue'),props:{kind:'case'},meta:{edit:true}},
    {path:'/products/:id',component:()=>import('./pages/ItemEditor.vue'),props:route=>({id:route.params.id,kind:'product'}),meta:{edit:true}},
    {path:'/cases/:id',component:()=>import('./pages/ItemEditor.vue'),props:route=>({id:route.params.id,kind:'case'}),meta:{edit:true}},
    {path:'/items/:id/history',component:()=>import('./pages/ItemEditor.vue'),props:route=>({id:route.params.id,history:true}),meta:{edit:true}},
    {path:'/accounts',component:()=>import('./pages/Governance.vue'),meta:{audit:true}},
    {path:'/:pathMatch(.*)*',redirect:'/'},
  ],
});

router.beforeEach(async to=>{
  await ensureSession().catch(()=>{});
  const home=landing(account.value);
  if(home!=='desk' && to.name!=='login') return {name:'login',query:{next:to.fullPath}};
  if(home==='desk' && to.name==='login') return {name:'desk'};
  if(to.meta.publish && !account.value?.can_publish) return {name:'desk'};
  if(to.meta.edit && !account.value?.can_edit) return {name:'desk'};
  if(to.meta.audit && !account.value?.can_edit && !account.value?.can_manage) return {name:'desk'};
});
