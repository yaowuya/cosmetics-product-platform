<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElPagination, ElTable, ElTableColumn } from 'element-plus';
import { message, withQuery, type Account, type AuditRow, type Page } from '../../../shared/contracts.ts';
import { account, request } from '../session.ts';

const tab = ref<'accounts'|'audit'>(account.value?.can_manage ? 'accounts' : 'audit');
const users = ref<Account[]>([]), events = ref<AuditRow[]>([]), total = ref(0), page = ref(1);
const busy = ref(false), error = ref(''), creating = ref(false), notice = ref('');
const form = reactive({login:'',password:'',can_edit:false,can_publish:false,can_manage:false});
const filter = reactive({actor_id:'',target_id:'',target_kind:''});
const editing = ref<Account | null>(null);
const manage = computed(() => Boolean(account.value?.can_manage));

/** Read only records permitted by the backend's split governance/content audit scopes. */
async function load() {
  busy.value = true; error.value = '';
  try {
    if (tab.value === 'accounts' && manage.value) {
      const data = await request<Page<Account>>(withQuery('/api/admin/accounts',{page:page.value,page_size:20}));
      users.value=data.items; total.value=data.total;
    } else {
      const data=await request<Page<AuditRow>>(withQuery('/api/admin/audit',{...filter,page:page.value,page_size:20}));
      events.value=data.items; total.value=data.total;
    }
  } catch (cause){ error.value=message(cause); users.value=[]; events.value=[]; total.value=0; }
  finally { busy.value=false; }
}
function choose(value:'accounts'|'audit'){tab.value=value;page.value=1;void load();}

/** Creating an account and changes of authority require the real manager API. */
async function create() {
  error.value=''; busy.value=true;
  try {
    await request('/api/admin/accounts','POST',{...form,login:form.login.trim(),can_publish:form.can_edit&&form.can_publish});
    creating.value=false; notice.value='账号已开通，首次登录需修改临时密码。';
    Object.assign(form,{login:'',password:'',can_edit:false,can_publish:false,can_manage:false});
    await load();
  } catch(cause){error.value=message(cause);} finally { busy.value=false; form.password=''; }
}
async function patch() {
  if (!editing.value) return;
  const row=editing.value; busy.value=true; error.value='';
  try {
    await request(`/api/admin/accounts/${row.id}`,'PATCH',{enabled:row.enabled,can_edit:row.can_edit,can_publish:row.can_edit&&row.can_publish,can_manage:row.can_manage});
    editing.value=null; notice.value='已保存账号状态与权限。'; await load();
  } catch(cause){error.value=message(cause);} finally { busy.value=false; }
}
onMounted(load);
</script>

<template>
  <header class="page-head"><div><h1>账号与操作记录</h1><p class="muted">管理启停与权限，按操作者和条目追查关键动作。</p></div><button v-if="manage && tab==='accounts'" class="btn primary" @click="creating=true;editing=null">开通账号</button></header>
  <div class="seg"><button v-if="manage" :aria-pressed="tab==='accounts'" @click="choose('accounts')">企业账号</button><button :aria-pressed="tab==='audit'" @click="choose('audit')">操作记录</button></div>
  <p v-if="notice" role="status" class="notice">{{ notice }}</p><p v-if="error" role="alert" class="inline-error">{{ error }} <button class="btn link" @click="load">重试</button></p>
  <form v-if="creating && manage" class="panel stack" @submit.prevent="create"><h2>开通企业账号</h2><div class="form-grid"><label class="field">登录名<input v-model="form.login" required maxlength="190"></label><label class="field">临时密码<input v-model="form.password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label></div><div class="toolbar"><label><input v-model="form.can_edit" type="checkbox">内容编辑</label><label><input v-model="form.can_publish" :disabled="!form.can_edit" type="checkbox">发布</label><label><input v-model="form.can_manage" type="checkbox">账号治理</label></div><div class="toolbar"><button class="btn primary" :disabled="busy">确认开通</button><button type="button" class="btn" @click="creating=false;form.password=''">取消</button></div></form>
  <form v-if="editing && manage" class="panel stack" @submit.prevent="patch"><h2>调整 {{ editing.login }} 的权限</h2><div class="toolbar"><label><input v-model="editing.enabled" type="checkbox">启用</label><label><input v-model="editing.can_edit" type="checkbox">内容编辑</label><label><input v-model="editing.can_publish" :disabled="!editing.can_edit" type="checkbox">发布</label><label><input v-model="editing.can_manage" type="checkbox">账号治理</label></div><div class="toolbar"><button class="btn primary" :disabled="busy">保存权限</button><button class="btn" type="button" @click="editing=null">取消</button></div></form>
  <section v-if="tab==='accounts' && manage" class="panel table-frame"><el-table :data="users" row-key="id" :empty-text="busy?'正在加载…':'还没有账号'">
    <el-table-column prop="login" label="登录名" min-width="150"/>
    <el-table-column label="状态" min-width="108"><template #default="{row}"><span class="pill">{{ row.enabled?'已启用':'已停用' }}</span></template></el-table-column>
    <el-table-column label="权限" min-width="220"><template #default="{row}">{{ [row.can_edit&&'内容编辑',row.can_publish&&'发布',row.can_manage&&'账号治理'].filter(Boolean).join(' · ') || '无' }}</template></el-table-column>
    <el-table-column label="操作" width="110"><template #default="{row}"><button class="btn link" @click="editing={...row};creating=false">调整权限</button></template></el-table-column>
  </el-table></section>
  <section v-else class="panel table-frame"><form class="toolbar" @submit.prevent="page=1;load()"><label>操作者 <input v-model.trim="filter.actor_id" inputmode="numeric"></label><label>对象编号 <input v-model.trim="filter.target_id" inputmode="numeric"></label><label>对象类型 <select v-model="filter.target_kind"><option value="">全部</option><option value="account">账号</option><option value="product">产品</option><option value="case">案例</option><option value="config">页面配置</option></select></label><button class="btn">查询</button></form><el-table :data="events" row-key="id" :empty-text="busy?'正在加载…':'没有可见的操作记录'"><el-table-column prop="occurred_at" label="时间" min-width="200"/><el-table-column prop="actor_id" label="操作者" min-width="110"/><el-table-column prop="action" label="动作" min-width="155"/><el-table-column label="对象" min-width="155"><template #default="{row}">{{ row.target_kind }} · {{ row.target_id }}</template></el-table-column></el-table></section>
  <div class="pagination"><el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="total, prev, pager, next" @current-change="load" /></div>
</template>
