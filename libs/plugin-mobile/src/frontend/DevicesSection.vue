<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import {
  Button,
  EmptyState,
  Spinner,
  apiErrorMessage,
  apiJson,
  onReactivated,
  useConfirm,
  useDateFormat,
  useToastStore,
} from '@makekeeper/frontend-core';
import { Smartphone, QrCode, Trash2 } from '@lucide/vue';
import { useI18n } from 'vue-i18n';
import type {
  MobileOriginInfo,
  PairedDevice,
} from '@makekeeper/plugin-contract';
import { useMobilePairingStore } from './pairing-store';

// Paired phones (#199), one section of the plugin's group in Settings → General
// (#261). "Pair a phone" opens the very same dialog instance the header's QR
// button does — one mechanism, one modal, mounted by MobilePairButton and driven
// from here through the shared store. The code is never shown as text to copy (a
// code you can paste is a code you can leak into a chat log), the dialog is on
// screen from the press, and it closes itself once the phone has taken the offer
// up — which is the cue this list refetches on.
//
// Unlike the publishing section next to it, this one is NOT administration:
// every user pairs and revokes their own phones.

const { t } = useI18n();
const dates = useDateFormat();
const toast = useToastStore();
const confirm = useConfirm();

const pairing = useMobilePairingStore();
const devices = ref<PairedDevice[]>([]);
const loading = ref(true);
// Where phones are sent (#204). Worth stating plainly on this screen: a separate
// host means the session cookie was deliberately widened to cover it, and an
// admin should know that rather than discover it.
const mobileOrigin = ref<string | null>(null);

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    devices.value = await apiJson<PairedDevice[]>('/api/devices');
  } catch (err) {
    toast.error(apiErrorMessage(err, t('mobile.devices.loadError')));
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  await load();
  try {
    mobileOrigin.value = (
      await apiJson<MobileOriginInfo>('/api/mobile/origin')
    ).mobileOrigin;
  } catch {
    // Not knowing simply means we make no claim about where phones connect.
    mobileOrigin.value = null;
  }
});

// The dialog lives in the header and closes itself the moment the phone takes
// the offer up, so this list learns about a new device from the store rather
// than from a callback of its own.
watch(() => pairing.pairedCount, load);

// Settings is a section layout and keeps its panes alive (#266), so this list
// is fetched once for the life of the page. A device revoked from the phone
// itself, or paired in another tab, would still be sitting here on the way
// back — the store watch above only sees pairings this tab performed.
onReactivated(() => {
  void load();
});

const revoke = async (device: PairedDevice): Promise<void> => {
  const confirmed = await confirm({
    message: t('mobile.devices.revokeConfirm', { name: device.name }),
    tone: 'danger',
  });
  if (!confirmed) return;
  try {
    await apiJson(`/api/devices/${device.id}`, { method: 'DELETE' });
    toast.success(t('mobile.devices.revoked', { name: device.name }));
    await load();
  } catch (err) {
    toast.error(apiErrorMessage(err, t('mobile.devices.revokeError')));
  }
};

const formatDate = (value: string | null): string =>
  value === null ? t('mobile.devices.never') : dates.dateTime(value);
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-start gap-4">
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-bold text-slate-900 dark:text-white">
          {{ $t('mobile.devices.title') }}
        </h3>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('mobile.devices.subtitle') }}
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        :icon-left="QrCode"
        @click="pairing.open()"
      >
        {{ $t('mobile.devices.pair') }}
      </Button>
    </div>

    <section
      v-if="mobileOrigin"
      class="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-800 p-4 space-y-1"
    >
      <p class="text-sm font-semibold">
        {{ $t('mobile.devices.separateOrigin', { origin: mobileOrigin }) }}
      </p>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ $t('mobile.devices.separateOriginNote') }}
      </p>
    </section>

    <Spinner v-if="loading" />

    <EmptyState
      v-else-if="devices.length === 0"
      :title="$t('mobile.devices.empty')"
      :icon="Smartphone"
    />

    <ul v-else class="space-y-2">
      <li
        v-for="device in devices"
        :key="device.id"
        class="flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-white/5 bg-white dark:bg-dark-800 p-4"
      >
        <Smartphone class="w-5 h-5 text-slate-400 shrink-0" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold truncate">{{ device.name }}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{
              $t('mobile.devices.lastSeen', {
                when: formatDate(device.lastSeenAt),
              })
            }}
          </p>
        </div>
        <Button
          variant="dangerGhost"
          size="icon-sm"
          :icon-left="Trash2"
          :aria-label="$t('mobile.devices.revoke')"
          @click="revoke(device)"
        />
      </li>
    </ul>
  </div>
</template>
