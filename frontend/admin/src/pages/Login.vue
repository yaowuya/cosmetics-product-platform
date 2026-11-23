<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { account, changePassword, landing, signIn, signOut } from '../session.ts';
import { message } from '../../../shared/contracts.ts';

const router = useRouter();
const route = useRoute();
const login = ref(''), password = ref(''), replacement = ref(''), confirmation = ref('');
const busy = ref(false), error = ref('');
const change = computed(() => landing(account.value) === 'change-password');

/** Sign in or perform the required first password change, never bypassing the server gate. */
async function submit() {
  error.value = '';
  if (change.value && (replacement.value.length < 12 || replacement.value !== confirmation.value)) {
    error.value = replacement.value.length < 12 ? '新密码至少需要 12 个字符。' : '两次输入的新密码不一致。';
    return;
  }
  busy.value = true;
  try {
    if (change.value) await changePassword(password.value, replacement.value);
    else await signIn(login.value.trim(), password.value);
    if (!account.value?.must_change_password) {
      const next = route.query.next;
      await router.replace(typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/');
    }
  } catch (cause) { error.value = message(cause); }
  finally { busy.value = false; if (!change.value) password.value = ''; replacement.value = ''; confirmation.value = ''; }
}

/** Sign out from the temporary session and discard the password form. */
async function cancelChange() {
  try { await signOut(); password.value = ''; error.value = ''; }
  catch (cause) { error.value = message(cause); }
}
</script>

<template>
  <main class="signin-canvas">
    <section class="signin-sheet" aria-labelledby="signin-title">
      <div class="signin-brand"><svg class="brand-mark" aria-hidden="true" viewBox="0 0 36 42"><path d="M9 3h15v5H9zM12 9v9L4 31v6q0 3 4 3h17q4 0 4-3v-7l-9-12V9M9 28h16m-14 6h11M31 5v10m-4-5h8"/></svg><div><strong>企业产品图册</strong><small>企业内容工作台</small></div></div>
      <h1 id="signin-title">{{ change ? '首次登录，请修改密码' : '登录管理后台' }}</h1>
      <p class="muted">{{ change ? '修改临时密码后才能进入内容工作台。' : '使用管理员为你开通的企业账号。' }}</p>
      <form class="stack" @submit.prevent="submit">
        <label v-if="!change" class="field">登录名<input v-model="login" autocomplete="username" required maxlength="190" /></label>
        <label class="field">{{ change ? '原密码' : '密码' }}<input v-model="password" type="password" autocomplete="current-password" required maxlength="128" /></label>
        <template v-if="change">
          <label class="field">新密码<input v-model="replacement" type="password" autocomplete="new-password" minlength="12" maxlength="128" required aria-describedby="password-rule" /></label>
          <small id="password-rule" class="muted">至少 12 个字符，不能与原密码相同。</small>
          <label class="field">确认新密码<input v-model="confirmation" type="password" autocomplete="new-password" required maxlength="128" /></label>
        </template>
        <p v-if="error" role="alert" class="inline-error">{{ error }}</p>
        <button type="submit" class="btn primary" :disabled="busy">{{ busy ? '处理中…' : change ? '修改并进入工作台' : '登录' }}</button>
        <button v-if="change" type="button" class="btn" @click="cancelChange">退出当前会话</button>
      </form>
    </section>
  </main>
</template>
