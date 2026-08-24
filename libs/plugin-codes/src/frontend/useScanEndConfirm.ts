import { useI18n } from 'vue-i18n';
import { useConfirm } from '@makekeeper/frontend-core';
import { useScanSessionStore } from './scan-session';

// Ending a contextual session throws away a paired phone the user may be
// mid-shelf with, and BOTH triggers (the header button and the contextual one)
// are a single careless click away from it — so the warning lives in one place
// instead of being copied into each. A plain global scan ends itself after one
// code, so there is nothing to confirm and this resolves true straight away.
export function useScanEndConfirm(): () => Promise<boolean> {
  const { t } = useI18n();
  const confirm = useConfirm();
  const session = useScanSessionStore();

  return async (): Promise<boolean> => {
    const request = session.request;
    if (!request) return true;
    return confirm({
      message: t('codes.scan.endConfirm', { context: request.contextLabel }),
      confirmLabel: t('codes.scan.finish'),
      tone: 'danger',
    });
  };
}
