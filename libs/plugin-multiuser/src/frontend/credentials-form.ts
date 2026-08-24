import { ref, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiErrorMessage } from '@makekeeper/frontend-core';

// The two screens that ask for a password — the desktop wall and the phone's
// own (#207) — differ in everything except this: the same two fields, the same
// "hold the form while the attempt is in flight", the same "any failure becomes
// one line the form can render". Shared so a fix to the error handling cannot
// land on one screen and quietly miss the other.
export interface CredentialsForm {
  username: Ref<string>;
  password: Ref<string>;
  // Empty when there is nothing to say. Already resolved to a message: the
  // fallback key is the one the caller passes in.
  error: Ref<string>;
  busy: Ref<boolean>;
  // Runs one authentication attempt. Navigation after a successful sign-in
  // belongs INSIDE the action — it is part of what may fail.
  attempt: (action: () => Promise<void>) => Promise<void>;
}

export function useCredentialsForm(
  fallbackMessageKey: string,
): CredentialsForm {
  const { t } = useI18n();
  const username = ref('');
  const password = ref('');
  const error = ref('');
  const busy = ref(false);

  const attempt = async (action: () => Promise<void>): Promise<void> => {
    error.value = '';
    busy.value = true;
    try {
      await action();
    } catch (err) {
      error.value = apiErrorMessage(err, t(fallbackMessageKey));
    } finally {
      busy.value = false;
    }
  };

  return { username, password, error, busy, attempt };
}
