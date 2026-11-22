import { shallowRef } from 'vue';
import { ApiError, type SessionAccount } from '../../shared/contracts.ts';
import { adminRequest, type AdminMethod } from './api.ts';

export const account = shallowRef<SessionAccount | null>(null);
let initialized = false;
let pending: Promise<void> | undefined;

/** First-change accounts never reach content, even if their capability flags are set. */
export function landing(value: Pick<SessionAccount, 'must_change_password'> | null): 'login' | 'change-password' | 'desk' {
  return !value ? 'login' : value.must_change_password ? 'change-password' : 'desk';
}

/** Reload authority from the server; browsers retain only the Secure HttpOnly session cookie. */
export async function refreshSession(): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    try { account.value = await adminRequest<SessionAccount>('/api/admin/me', 'GET') ?? null; }
    catch (error) {
      // The change response is the only source of the first-login token. A reload at that state must sign in again.
      if (!(error instanceof ApiError) || ![401, 403].includes(error.status)) throw error;
      if (error.status === 401 || !account.value?.must_change_password) account.value = null;
    } finally { initialized = true; }
  })();
  try { await pending; } finally { pending = undefined; }
}

/** Restore session once per page load, not on every router navigation. */
export async function ensureSession(): Promise<void> {
  if (!initialized) await refreshSession();
}

/** Use a real anonymous anti-forgery challenge to open a session. */
export async function signIn(login: string, password: string): Promise<void> {
  const challenge = await adminRequest<{csrf_token: string}>('/api/admin/login', 'GET');
  account.value = await adminRequest<SessionAccount>('/api/admin/login', 'POST', { body: {login,password}, csrfToken: challenge?.csrf_token }) ?? null;
  initialized = true;
}

/** First change rotates the session and obtains the server's current permissions. */
export async function changePassword(old_password: string, new_password: string): Promise<void> {
  account.value = await request<SessionAccount>('/api/admin/change-password', 'POST', {old_password, new_password});
}

/** Invalidate the current session on the server, then clear local capability state. */
export async function signOut(): Promise<void> {
  const id=account.value?.id;
  await request('/api/admin/logout', 'POST');
  account.value = null;
  if(id) { try { localStorage.removeItem(`showcase/pending-receipts/${id}`); } catch { /* storage can be disabled */ } }
}

/** Bind writes to the current CSRF token. Never retry a failed write automatically. */
export async function request<T>(path: string, method: AdminMethod = 'GET', body?: unknown): Promise<T> {
  try { return await adminRequest<T>(path, method, { body, csrfToken: account.value?.csrf_token }) as T; }
  catch (error) {
    if (error instanceof ApiError && error.status === 401) account.value = null;
    if (error instanceof ApiError && error.status === 403 && !account.value?.must_change_password) await refreshSession().catch(() => {});
    throw error;
  }
}
