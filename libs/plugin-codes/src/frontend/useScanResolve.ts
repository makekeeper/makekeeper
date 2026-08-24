import { ref, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  apiFetch,
  resolveObjectRefRoute,
  useToastStore,
} from '@makekeeper/frontend-core';

// Shared desktop-side resolution for a decoded scan value (#74): ask the backend
// to turn the raw string (our QR deep-link, our short code, a bare ORef, or a
// foreign barcode/SKU) into a canonical object ref, then navigate to it via the
// owning plugin's `refToRoute`. A miss toasts rather than navigating.
export function useScanResolve(): {
  resolving: Ref<boolean>;
  resolveRef: (value: string) => Promise<string | null>;
  resolveAndGo: (value: string) => Promise<void>;
} {
  const router = useRouter();
  const toast = useToastStore();
  const { t } = useI18n();
  const resolving = ref(false);

  // Resolution only — codes stays the single owner of "raw string → ORef", so a
  // host acting on a scan (#79) never has to call this endpoint itself: it
  // receives the canonical ref through the slot's `onScan`.
  const resolveRef = async (value: string): Promise<string | null> => {
    try {
      const res = await apiFetch('/api/codes/scan/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data: { ref?: string | null } = res.ok
        ? await res.json()
        : { ref: null };
      return data.ref ?? null;
    } catch {
      toast.error(t('codes.scan.lookupError'));
      return null;
    }
  };

  const resolveAndGo = async (value: string): Promise<void> => {
    if (resolving.value) return;
    resolving.value = true;
    try {
      const ref = await resolveRef(value);
      const route = ref ? resolveObjectRefRoute(ref) : null;
      if (route) {
        router.push(route);
      } else {
        toast.error(t('codes.scan.notFound', { code: value }));
      }
    } catch {
      toast.error(t('codes.scan.lookupError'));
    } finally {
      resolving.value = false;
    }
  };

  return { resolving, resolveRef, resolveAndGo };
}
