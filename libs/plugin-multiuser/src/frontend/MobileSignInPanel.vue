<script setup lang="ts">
// The phone's sign-in form (#207), contributed into the mobile plugin's
// `mobile.auth.password` slot. Passwords are this plugin's business and phones
// are the mobile plugin's: the host owns the screen and what happens after a
// successful sign-in (trading the session for a device token), this owns the
// two fields and the call. Neither imports the other, and in single-user mode
// there is no contribution — so the screen has nothing to render, which is
// exactly right where no password exists.
//
// Sign-in only, no register tab: a phone is where an existing person gets back
// in, not where an instance gets its first account.
import { Button, useSessionStore } from '@makekeeper/frontend-core';
import { LogIn } from '@lucide/vue';
import type { MobileAuthSlotCtx } from '@makekeeper/plugin-contract';
import { useCredentialsForm } from './credentials-form';

// The props ARE the host's slot ctx — typed against the contract rather than
// re-spelled here, so the two cannot drift.
const props = defineProps<MobileAuthSlotCtx>();

const session = useSessionStore();
const { username, password, error, busy, attempt } = useCredentialsForm(
  'multiuser.mobileSignIn.failed',
);

const submit = async (): Promise<void> => {
  await attempt(async () => {
    await session.login(username.value, password.value);
    props.onAuthenticated();
  });
};
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <div class="space-y-1">
      <label
        for="mu-mobile-username"
        class="block text-sm font-medium text-slate-700 dark:text-slate-300"
      >
        {{ $t('multiuser.mobileSignIn.username') }}
      </label>
      <!-- `text-base`, not the desktop's `text-sm`: iOS Safari zooms the whole
           page into a field with a smaller font, and the zoom does not come
           back. -->
      <input
        id="mu-mobile-username"
        v-model="username"
        type="text"
        autocomplete="username"
        required
        minlength="3"
        class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
      />
    </div>

    <div class="space-y-1">
      <label
        for="mu-mobile-password"
        class="block text-sm font-medium text-slate-700 dark:text-slate-300"
      >
        {{ $t('multiuser.mobileSignIn.password') }}
      </label>
      <input
        id="mu-mobile-password"
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
        class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
      />
    </div>

    <p v-if="error" class="text-sm text-red-600 dark:text-red-400">
      {{ error }}
    </p>

    <Button type="submit" block :loading="busy" :icon-left="LogIn">
      {{ $t('multiuser.mobileSignIn.action') }}
    </Button>
  </form>
</template>
