import { onActivated, onMounted, ref } from 'vue';
import { message, type Body, type PublicPage } from '../../shared/contracts.ts';
import { publicGet } from './public-api.ts';

/** Keep a tab's rendered content while verifying the current publication on return. */
export function usePublishedPage(page: 'home' | 'contact') {
  const body = ref<Body>({});
  const loading = ref(true);
  const error = ref('');
  let pending = false;

  async function load(quiet = false) {
    if (pending) return;
    pending = true;
    if (!quiet) {
      loading.value = true;
      error.value = '';
    }
    try {
      const next = (await publicGet<PublicPage>(`/api/public/pages/${page}`))?.body ?? {};
      // Keep the same poster source array when the server returns the same publication.
      if (JSON.stringify(next) !== JSON.stringify(body.value)) body.value = next;
    } catch (cause) {
      if (!quiet) error.value = message(cause);
    } finally {
      loading.value = false;
      pending = false;
    }
  }

  onMounted(() => void load());
  onActivated(() => {
    if (!loading.value) void load(!error.value);
  });
  return { body, loading, error, retry: () => load() };
}
