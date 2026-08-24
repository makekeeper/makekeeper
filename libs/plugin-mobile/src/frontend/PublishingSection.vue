<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  Button,
  Spinner,
  apiJson,
  apiErrorMessage,
  useToastStore,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import type { MobileSettingsPublic } from '@makekeeper/plugin-contract';

// Where phones reach this instance — instance administration, so the panel
// around it renders this section for admins only (#261). Installability is
// deliberately NOT administered here (#210): a home-screen shortcut is the phone
// owner's business, so the surface offers it and states what the address is
// worth, instead of an admin toggle hiding the feature from the person who
// wanted it.

const { t } = useI18n();
const toast = useToastStore();

const settings = ref<MobileSettingsPublic | null>(null);
const loading = ref(true);
const saving = ref(false);
const origin = ref('');

// The environment wins, and the field says so rather than pretending to own a
// value it cannot change.
const originLocked = computed<boolean>(
  () => settings.value?.originEnvOverride !== null,
);

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    const loaded = await apiJson<MobileSettingsPublic>('/api/mobile/settings');
    settings.value = loaded;
    origin.value = loaded.originEnvOverride ?? loaded.customOrigin ?? '';
  } catch (err) {
    toast.error(apiErrorMessage(err, t('mobile.settings.saveError')));
  } finally {
    loading.value = false;
  }
};

onMounted(load);

const patch = async (body: Record<string, unknown>): Promise<void> => {
  saving.value = true;
  try {
    settings.value = await apiJson<MobileSettingsPublic>(
      '/api/mobile/settings',
      { method: 'PATCH', body },
    );
    toast.success(t('mobile.settings.saved'));
  } catch (err) {
    toast.error(apiErrorMessage(err, t('mobile.settings.saveError')));
    // The server refused; show what it actually holds rather than the value the
    // switch optimistically moved to.
    await load();
  } finally {
    saving.value = false;
  }
};

const saveOrigin = (): Promise<void> =>
  patch({ customOrigin: origin.value.trim() });
</script>

<template>
  <div class="space-y-4">
    <div>
      <h3 class="text-sm font-bold text-slate-900 dark:text-white">
        {{ $t('mobile.settings.title') }}
      </h3>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ $t('mobile.settings.description') }}
      </p>
    </div>

    <Spinner v-if="loading" />

    <template v-else-if="settings">
      <!-- Where the surface is published -->
      <section class="space-y-2">
        <label for="mobile-origin" class="block text-sm font-semibold">
          {{ $t('mobile.settings.origin.label') }}
        </label>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('mobile.settings.origin.help') }}
        </p>
        <div class="flex gap-2">
          <input
            id="mobile-origin"
            v-model="origin"
            type="url"
            inputmode="url"
            maxlength="255"
            :readonly="originLocked"
            :placeholder="$t('mobile.settings.origin.placeholder')"
            class="flex-1 glass-input rounded-xl px-4 py-2.5 text-sm"
            :class="originLocked ? 'opacity-60 cursor-not-allowed' : ''"
          />
          <Button
            v-if="!originLocked"
            variant="secondary"
            :loading="saving"
            @click="saveOrigin"
          >
            {{ $t('common.save') }}
          </Button>
        </div>
        <p
          v-if="originLocked"
          class="text-xs text-slate-500 dark:text-slate-400"
        >
          {{ $t('mobile.settings.origin.envOverride') }}
        </p>
      </section>

      <!-- Read-only, for the operator who wonders where this one lives -->
      <section class="space-y-1">
        <p class="text-sm font-semibold">
          {{ $t('mobile.settings.cookieDomain.label') }}
        </p>
        <p class="text-sm font-mono text-slate-600 dark:text-slate-300">
          {{
            settings.sessionCookieDomain ??
            $t('mobile.settings.cookieDomain.unset')
          }}
        </p>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('mobile.settings.cookieDomain.help') }}
        </p>
      </section>
    </template>
  </div>
</template>
