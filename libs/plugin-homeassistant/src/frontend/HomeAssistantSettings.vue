<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
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
import type {
  HomeAssistantSettingsPublic,
  HomeAssistantTestResult,
} from '../settings-contract';

// What arrives over HTTP is `unknown` until something checks it, and the
// checks live here rather than in a cast: a screen that trusts a body it did
// not look at is a screen that renders `undefined` the first time the shape
// moves (§5.1).
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asSettings = (value: unknown): HomeAssistantSettingsPublic => ({
  baseUrl:
    isRecord(value) && typeof value['baseUrl'] === 'string'
      ? value['baseUrl']
      : null,
  hasToken: isRecord(value) && value['hasToken'] === true,
});

const asTestResult = (value: unknown): HomeAssistantTestResult => {
  if (isRecord(value) && value['ok'] === true) {
    return {
      ok: true,
      version: typeof value['version'] === 'string' ? value['version'] : '',
      entityCount:
        typeof value['entityCount'] === 'number' ? value['entityCount'] : 0,
    };
  }
  const errorKey = isRecord(value) ? value['errorKey'] : null;
  return {
    ok: false,
    errorKey:
      typeof errorKey === 'string'
        ? errorKey
        : 'homeassistant.errors.unreachable',
  };
};

// The gateway's whole surface: where Home Assistant is, and the token to speak
// to it (#364). Instance administration — the manifest's `settingsAdminOnly`
// keeps it out of a non-admin's Settings, and the routes behind it are
// `@AdminOnly()`.
//
// The token never comes back from the server, so it is a `SecretInput`: a
// stored one reads as shielded rather than as an empty box an admin would take
// for lost settings (#270). It is not `removable` — dropping the token means
// dropping the connection, which is what emptying the address does.
//
// The check reports the version that answered and how many entities the token
// may read, because "connected" and "connected but blind" are different
// problems and a token with no permissions is the common second one. It
// deliberately says nothing about printers: this plugin is a transport, and
// what can be done through it is the consumer's question (the Niimbot
// printer's settings answer it).

const { t } = useI18n();
const toast = useToastStore();

const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const baseUrl = ref('');
const token = ref('');
const hasToken = ref(false);
const tokenAction = ref<SecretAction>('keep');
const result = ref<HomeAssistantTestResult | null>(null);

const fetchSettings = async (): Promise<void> => {
  try {
    loading.value = true;
    const res = await apiFetch('/api/homeassistant/settings');
    if (!res.ok) {
      toast.error(t('homeassistant.settings.saveFailed'));
      return;
    }
    const settings = asSettings(await res.json());
    baseUrl.value = settings.baseUrl ?? '';
    hasToken.value = settings.hasToken;
  } catch {
    toast.error(t('homeassistant.settings.saveFailed'));
  } finally {
    loading.value = false;
  }
};

// Both fields travel with the same "empty means keep" spelling the backend
// expects for a secret; the address is an ordinary value and goes as typed.
const body = (): Record<string, unknown> => {
  const patch: Record<string, unknown> = { baseUrl: baseUrl.value.trim() };
  const secret = secretPatch(tokenAction.value, token.value, { trim: true });
  if (secret !== undefined) patch.token = secret;
  return patch;
};

const save = async (): Promise<void> => {
  try {
    saving.value = true;
    const res = await apiFetch('/api/homeassistant/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body()),
    });
    if (!res.ok) {
      toast.error(t('homeassistant.settings.saveFailed'));
      return;
    }
    const settings = asSettings(await res.json());
    hasToken.value = settings.hasToken;
    baseUrl.value = settings.baseUrl ?? '';
    token.value = '';
    tokenAction.value = 'keep';
    toast.success(t('homeassistant.settings.saved'));
  } catch {
    toast.error(t('homeassistant.settings.saveFailed'));
  } finally {
    saving.value = false;
  }
};

// Tests what is ON SCREEN, not what is stored: a button that reports on the
// previous token right after someone pasted a new one answers the wrong
// question. A blank token still means "keep", so the saved one is used.
const check = async (): Promise<void> => {
  try {
    testing.value = true;
    result.value = null;
    const res = await apiFetch('/api/homeassistant/settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body()),
    });
    result.value = res.ok
      ? asTestResult(await res.json())
      : { ok: false, errorKey: 'homeassistant.errors.unreachable' };
  } catch {
    result.value = { ok: false, errorKey: 'homeassistant.errors.unreachable' };
  } finally {
    testing.value = false;
  }
};

onMounted(fetchSettings);
// Settings keeps its panes alive, so a reopened section would otherwise show
// whatever was loaded the first time.
onReactivated(fetchSettings);
</script>

<template>
  <div class="space-y-4">
    <div>
      <h3 class="text-sm font-bold text-slate-900 dark:text-white">
        {{ $t('homeassistant.settings.title') }}
      </h3>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ $t('homeassistant.settings.description') }}
      </p>
    </div>

    <div v-if="loading" class="flex justify-center py-6">
      <Spinner />
    </div>

    <template v-else>
      <section class="space-y-2">
        <label for="ha-base-url" class="block text-sm font-semibold">
          {{ $t('homeassistant.settings.baseUrl.label') }}
        </label>
        <input
          id="ha-base-url"
          v-model="baseUrl"
          type="url"
          autocomplete="off"
          :placeholder="$t('homeassistant.settings.baseUrl.placeholder')"
          class="glass-input w-full rounded-xl px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
        />
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('homeassistant.settings.baseUrl.help') }}
        </p>
      </section>

      <section class="space-y-2">
        <label for="ha-token" class="block text-sm font-semibold">
          {{ $t('homeassistant.settings.token.label') }}
        </label>
        <SecretInput
          id="ha-token"
          v-model="token"
          v-model:action="tokenAction"
          :stored="hasToken"
          mono
        >
          <template #actions>
            <Button
              variant="secondary"
              size="sm"
              :loading="testing"
              @click="check"
            >
              {{ $t('homeassistant.settings.check') }}
            </Button>
          </template>
        </SecretInput>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('homeassistant.settings.token.help') }}
        </p>
      </section>

      <p
        v-if="result"
        class="rounded-xl p-3 text-xs"
        :class="
          result.ok
            ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200'
            : 'bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-200'
        "
      >
        <template v-if="result.ok">
          {{
            result.entityCount === 0
              ? $t('homeassistant.settings.checkNoEntities', {
                  version: result.version,
                })
              : $t('homeassistant.settings.checkOk', {
                  version: result.version,
                  count: result.entityCount,
                })
          }}
        </template>
        <template v-else>
          {{ $t(result.errorKey) }}
        </template>
      </p>

      <div class="flex justify-end">
        <Button :loading="saving" :icon-left="Save" @click="save">
          {{ $t('common.save') }}
        </Button>
      </div>
    </template>
  </div>
</template>
