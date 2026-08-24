<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import {
  Select,
  Switch,
  Button,
  SecretInput,
  Spinner,
  apiFetch,
  onReactivated,
  secretPatch,
  useToastStore,
  type SecretAction,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import { Save } from '@lucide/vue';

// Admin settings surface for the logistics plugin: the parcel-tracking provider
// and its API key (instance administration — gated by settingsAdminOnly). The
// raw key never comes back from the server, so both secrets are `SecretInput`s:
// a stored one shows as shielded and redacted instead of as a blank box (#270).
//
// Neither is `removable` — this API has no "clear it" spelling, only "replace
// it", and the provider it belongs to is dropped by choosing `none` instead.

const { t } = useI18n();
const toast = useToastStore();

const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const provider = ref('none');
const authMode = ref<'apikey' | 'credentials'>('apikey');
const autoTrack = ref(false);
const intervalHours = ref(6);
const apiKey = ref('');
const hasApiKey = ref(false);
const apiKeyAction = ref<SecretAction>('keep');
const login = ref('');
const password = ref('');
const hasCredentials = ref(false);
const passwordAction = ref<SecretAction>('keep');

// Provider names are brand nouns (literals allowed, §5.5).
const providerOptions = [
  { value: 'none', label: t('logistics.settings.providerNone') },
  { value: '17track', label: '17track' },
  { value: 'aftership', label: 'AfterShip' },
  { value: 'trackingmore', label: 'TrackingMore' },
  { value: 'ship24', label: 'Ship24' },
];

// Only 17track offers a free web account; the others are API-key only.
const supportsCredentials = computed(() => provider.value === '17track');

const authModeOptions = computed(() => [
  { value: 'apikey', label: t('logistics.settings.authApiKey') },
  { value: 'credentials', label: t('logistics.settings.authCredentials') },
]);

const fetchSettings = async () => {
  try {
    loading.value = true;
    const res = await apiFetch('/api/logistics/settings');
    if (res.ok) {
      const s = await res.json();
      provider.value = s.trackingProvider;
      authMode.value = s.authMode ?? 'apikey';
      autoTrack.value = s.autoTrackEnabled;
      intervalHours.value = s.pollIntervalHours;
      hasApiKey.value = s.hasApiKey;
      hasCredentials.value = s.hasCredentials;
      login.value = s.trackingLogin ?? '';
    } else {
      toast.error(t('logistics.errors.loadFailed'));
    }
  } catch {
    toast.error(t('logistics.errors.loadFailed'));
  } finally {
    loading.value = false;
  }
};

const effectiveMode = () =>
  supportsCredentials.value ? authMode.value : 'apikey';

const save = async () => {
  try {
    saving.value = true;
    const mode = effectiveMode();
    const body: Record<string, unknown> = {
      trackingProvider: provider.value,
      authMode: mode,
      autoTrackEnabled: autoTrack.value,
      pollIntervalHours: intervalHours.value,
    };
    if (mode === 'credentials') {
      body.trackingLogin = login.value.trim();
      // Omitted unless newly typed — the server keeps what it holds.
      const typed = secretPatch(passwordAction.value, password.value, {
        trim: false,
      });
      if (typed) body.trackingPassword = typed;
    } else {
      const typed = secretPatch(apiKeyAction.value, apiKey.value);
      if (typed) body.trackingApiKey = typed;
    }

    const res = await apiFetch('/api/logistics/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const s = await res.json();
      hasApiKey.value = s.hasApiKey;
      hasCredentials.value = s.hasCredentials;
      apiKey.value = '';
      password.value = '';
      // Back to showing what is now stored, rather than the field the admin
      // just emptied by saving it.
      apiKeyAction.value = 'keep';
      passwordAction.value = 'keep';
      toast.success(t('logistics.settings.saved'));
    } else {
      toast.error(t('logistics.settings.saveFailed'));
    }
  } catch {
    toast.error(t('logistics.settings.saveFailed'));
  } finally {
    saving.value = false;
  }
};

// Validates the typed credentials against the selected provider before saving.
const testConnection = async () => {
  const mode = effectiveMode();
  const missing =
    provider.value === 'none' ||
    (mode === 'apikey' && !apiKey.value.trim()) ||
    (mode === 'credentials' && (!login.value.trim() || !password.value));
  if (missing) {
    toast.error(t('logistics.settings.testNoKey'));
    return;
  }
  try {
    testing.value = true;
    const body: Record<string, unknown> = {
      provider: provider.value,
      authMode: mode,
    };
    if (mode === 'credentials') {
      body.login = login.value.trim();
      body.password = password.value;
    } else {
      body.apiKey = apiKey.value.trim();
    }
    const res = await apiFetch('/api/logistics/settings/test-tracking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = res.ok ? await res.json() : { ok: false };
    if (result.ok) toast.success(t('logistics.settings.testOk'));
    else toast.error(t('logistics.settings.testFail'));
  } catch {
    toast.error(t('logistics.settings.testFail'));
  } finally {
    testing.value = false;
  }
};

onMounted(fetchSettings);
// Settings is a section layout and keeps its panes alive (#266), so this would
// otherwise be fetched once for the life of the page — and a provider changed
// in another tab would never show up here.
onReactivated(() => {
  void fetchSettings();
});
</script>

<template>
  <div v-if="loading" class="flex justify-center py-10">
    <Spinner :label="t('common.loading')" />
  </div>
  <div v-else class="space-y-5">
    <p class="text-xs text-slate-500 dark:text-slate-400">
      {{ t('logistics.settings.subtitle') }}
    </p>

    <div class="space-y-5">
      <div class="space-y-1.5">
        <label
          class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
          >{{ t('logistics.settings.provider') }}</label
        >
        <Select v-model="provider" :options="providerOptions" />
      </div>

      <!-- Auth mode (17track supports a free web account) -->
      <div v-if="supportsCredentials" class="space-y-1.5">
        <label
          class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
          >{{ t('logistics.settings.authMode') }}</label
        >
        <Select v-model="authMode" :options="authModeOptions" />
      </div>

      <!-- API key -->
      <div v-if="effectiveMode() === 'apikey'" class="space-y-1.5">
        <label
          for="logistics-api-key"
          class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
          >{{ t('logistics.settings.apiKey') }}</label
        >
        <SecretInput
          id="logistics-api-key"
          v-model="apiKey"
          v-model:action="apiKeyAction"
          :stored="hasApiKey"
          mono
          :placeholder="t('logistics.settings.apiKeyEmpty')"
        >
          <template #actions>
            <Button
              variant="secondary"
              :disabled="testing || provider === 'none' || !apiKey.trim()"
              @click="testConnection"
            >
              {{ t('logistics.settings.test') }}
            </Button>
          </template>
        </SecretInput>
        <p class="text-xxs text-slate-500 dark:text-slate-400 leading-relaxed">
          {{ t('logistics.settings.keyHint') }}
        </p>
      </div>

      <!-- Login / password (17track web account) -->
      <template v-else>
        <div class="space-y-1.5">
          <label
            class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
            >{{ t('logistics.settings.login') }}</label
          >
          <input
            v-model="login"
            type="email"
            autocomplete="off"
            :placeholder="t('logistics.settings.loginPlaceholder')"
            class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
          />
        </div>
        <div class="space-y-1.5">
          <label
            for="logistics-password"
            class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
            >{{ t('logistics.settings.password') }}</label
          >
          <SecretInput
            id="logistics-password"
            v-model="password"
            v-model:action="passwordAction"
            :stored="hasCredentials"
            autocomplete="new-password"
            :placeholder="t('logistics.settings.passwordEmpty')"
          >
            <template #actions>
              <Button
                variant="secondary"
                :disabled="testing || !login.trim() || !password"
                @click="testConnection"
              >
                {{ t('logistics.settings.test') }}
              </Button>
            </template>
          </SecretInput>
          <p class="text-xxs text-slate-400">
            {{ t('logistics.settings.credentialsHint') }}
          </p>
        </div>
      </template>

      <div class="flex items-center justify-between">
        <div>
          <span
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >{{ t('logistics.settings.autoTrack') }}</span
          >
          <span class="text-xxs text-slate-500">{{
            t('logistics.settings.autoTrackHint')
          }}</span>
        </div>
        <Switch
          v-model="autoTrack"
          :aria-label="t('logistics.settings.autoTrack')"
        />
      </div>

      <div class="space-y-1.5">
        <label
          class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
          >{{ t('logistics.settings.interval') }}</label
        >
        <input
          v-model.number="intervalHours"
          type="number"
          min="1"
          max="168"
          class="w-32 glass-input rounded-xl px-4 py-2.5 text-sm"
        />
      </div>
    </div>

    <div class="flex justify-end">
      <Button :icon-left="Save" :disabled="saving" @click="save">
        {{ t('logistics.settings.save') }}
      </Button>
    </div>
  </div>
</template>
