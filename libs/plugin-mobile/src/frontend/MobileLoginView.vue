<script setup lang="ts">
import { useRouter } from 'vue-router';
import {
  apiJson,
  Button,
  PluginSlot,
  setStoredDeviceToken,
  usePluginsStore,
  useSessionStore,
  useToastStore,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import { ScanLine } from '@lucide/vue';
import {
  MOBILE_PAIR_PATH,
  MOBILE_ROOT_PATH,
  type DevicePairingResult,
  type MobileAuthSlotCtx,
} from '@makekeeper/plugin-contract';

// The phone's password wall (#207) — the FALLBACK way back in, offered when
// scanning the desktop's QR is not possible.
//
// Not a style exercise: the desktop login page is a centred card sized for a
// mouse, and a phone thrown to it comes back signed in to the DESKTOP app,
// which is precisely what the installed PWA did on its first launch. This
// screen lives inside the mobile shell, so signing in lands the person back on
// the phone surface they opened.
//
// The FORM is not here. Passwords belong to whichever plugin owns them
// (multiuser), which fills the `mobile.auth.password` slot; this plugin owns
// the screen and what a fresh sign-in is worth on a phone — see below. With
// multi-user mode off nobody contributes, and the route guard has already sent
// the visitor to pairing rather than to an empty screen.

const router = useRouter();
const session = useSessionStore();
const toast = useToastStore();
const { t } = useI18n();

// A session is not enough for a phone. The JWT the sign-in just minted expires
// in hours, and the next launch of the installed app would ask for the password
// again — the very symptom this ticket is about. So the phone spends its fresh
// credential on the durable one immediately: a device token, the same thing
// pairing hands out, which survives restarts and outlives the session.
const claimDeviceToken = async (): Promise<void> => {
  const result = await apiJson<DevicePairingResult>('/api/devices/self', {
    method: 'POST',
    body: { name: t('mobile.pair.defaultName') },
  });
  // Its own storage slot, not the session's (#199).
  setStoredDeviceToken(result.token);
};

const onAuthenticated: MobileAuthSlotCtx['onAuthenticated'] = () => {
  void (async () => {
    try {
      await claimDeviceToken();
    } catch {
      // Signed in either way, so the person is not stopped here — but say it
      // plainly rather than let the app quietly forget them again in an hour.
      toast.error(t('mobile.login.deviceTokenFailed'));
    }
    // Re-resolve who we are now that we hold a credential: the shell's tab bar
    // is built from a plugin set that was fetched while we were anonymous.
    await session.bootstrap();
    await usePluginsStore().fetchPlugins();
    await router.replace(MOBILE_ROOT_PATH);
  })();
};
</script>

<template>
  <div class="p-4 space-y-5">
    <!-- Titled by the shell's header, like every screen here. -->
    <PluginSlot name="mobile.auth.password" :ctx="{ onAuthenticated }" />

    <Button
      variant="secondary"
      block
      :icon-left="ScanLine"
      :to="MOBILE_PAIR_PATH"
    >
      {{ $t('mobile.login.scanInstead') }}
    </Button>
  </div>
</template>
