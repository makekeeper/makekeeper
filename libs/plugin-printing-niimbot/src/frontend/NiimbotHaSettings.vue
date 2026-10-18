<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  Button,
  Modal,
  Select,
  Spinner,
  Switch,
  apiFetch,
  onReactivated,
  usePluginsStore,
  useSessionStore,
  useToastStore,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import { Save } from '@lucide/vue';

import {
  isNiimbotHaTargetKind,
  type NiimbotHaPreviewResult,
  type NiimbotHaPrinter,
  type NiimbotHaPrinters,
  type NiimbotHaTargetKind,
} from '../ha-contract';

// Bodies arrive as `unknown`; these are the only places that decide what they
// were. A screen that assigns a parsed body straight into a typed ref is a
// screen that renders `undefined` the first time the shape moves (§5.1).
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asPrinters = (value: unknown): NiimbotHaPrinters => {
  const bridge = isRecord(value) ? value['bridge'] : null;
  const rows = isRecord(value) ? value['printers'] : null;
  const kind = isRecord(value) ? value['kind'] : null;
  return {
    bridge: bridge === 'ok' || bridge === 'unconfigured' ? bridge : 'absent',
    kind: isNiimbotHaTargetKind(kind) ? kind : 'device',
    printers: Array.isArray(rows)
      ? rows
          .filter((row): row is NiimbotHaPrinter => {
            if (!isRecord(row)) return false;
            return (
              typeof row['id'] === 'string' && typeof row['name'] === 'string'
            );
          })
          .map((row) => ({ id: row.id, name: row.name }))
      : [],
    filtered:
      isRecord(value) && value['filtered'] === false ? false : undefined,
  };
};

const asPreview = (value: unknown): NiimbotHaPreviewResult => {
  if (isRecord(value) && value['ok'] === true) {
    const image = value['image'];
    return {
      ok: true,
      // Only a data URI is ever rendered: the string came from a household
      // server, and an http(s) one would send this screen fetching from it.
      image:
        typeof image === 'string' && image.startsWith('data:image/')
          ? image
          : undefined,
    };
  }
  const errorKey = isRecord(value) ? value['errorKey'] : null;
  const stage = isRecord(value) ? value['stage'] : null;
  return {
    ok: false,
    stage: stage === 'render' ? 'render' : 'device',
    errorKey:
      typeof errorKey === 'string'
        ? errorKey
        : 'printingNiimbot.ha.errors.noBridge',
  };
};

// The other way to the same printer: through the household's Home Assistant,
// from the server (#364).
//
// This half of the panel is INSTANCE administration, unlike the Bluetooth half
// above it — the server prints, so the printer is the instance's and one admin
// chooses it for everyone. A non-admin therefore gets a sentence instead of a
// form: a form whose save would 403, pre-filled with the instance's printer,
// would be a lie twice over. What that person actually needs to know is
// answered where it matters — the print dialog either offers the row or does
// not.
//
// Nothing here reaches into the `homeassistant` plugin's API: this screen asks
// its OWN plugin for the printer list, and that plugin resolves the Home
// Assistant capability on the server (§5.10).

const { t } = useI18n();
const toast = useToastStore();
const session = useSessionStore();
const plugins = usePluginsStore();

const loading = ref(true);
const saving = ref(false);
const previewing = ref(false);
const targetId = ref('');
const targetKind = ref<NiimbotHaTargetKind>('device');
const soleTarget = ref(false);
const sendSize = ref(true);
const printers = ref<NiimbotHaPrinters | null>(null);
// The dry run's answer, shown in a dialog the person closes themselves.
//
// It is a dialog and not a line on the page because the outcome of pressing a
// button is a MOMENT, and the answer has to be where the eyes already are: a
// toast had gone before it was read, and a panel above the button it belongs
// to read as part of the form rather than as the answer to the press.
const preview = ref<NiimbotHaPreviewResult | null>(null);

// Disabling the Home Assistant plugin removes its functionality everywhere,
// this screen included; the link to its settings is only offered while it is
// there to link to.
const haEnabled = computed(() => plugins.isEnabled('homeassistant'));
const mayAdminister = computed(
  () => !session.multiuserEnabled || session.isAdmin,
);
const configurable = computed(
  () =>
    haEnabled.value && mayAdminister.value && printers.value?.bridge === 'ok',
);

// The single printer a device list leaves nothing to choose between.
//
// Only for DEVICES: an entity list is a list of a printer's parts, and the one
// part that prints is not something this screen can pick for anybody.
const sole = computed(() =>
  printers.value?.kind === 'device' && printers.value.printers.length === 1
    ? printers.value.printers[0]
    : null,
);

// Letting Home Assistant resolve the printer itself. Offered ONLY where this
// screen genuinely cannot name one — an instance whose device registry it
// could not read — because everywhere else naming the printer is both possible
// and better: an explicit target is what hass-niimbot answers without
// guessing.
const offerSoleTarget = computed(() => printers.value?.kind === 'entity');

// "No printer" is a genuine absence — nothing chosen — so it is the primitive's
// own empty row rather than a label pretending to be a record (§5.4).
const printerOptions = computed(() => [
  { value: '', label: t('printingNiimbot.ha.printer.none'), empty: true },
  ...(printers.value?.printers ?? []).map((printer) => ({
    value: printer.id,
    label: printer.name,
  })),
]);

const load = async (): Promise<void> => {
  if (!haEnabled.value || !mayAdminister.value) {
    loading.value = false;
    return;
  }
  try {
    loading.value = true;
    const [settingsRes, printersRes] = await Promise.all([
      apiFetch('/api/printing-niimbot/ha/settings'),
      apiFetch('/api/printing-niimbot/ha/printers'),
    ]);
    if (!settingsRes.ok || !printersRes.ok) {
      toast.error(t('printingNiimbot.ha.loadFailed'));
      return;
    }
    const settings: unknown = await settingsRes.json();
    const row = isRecord(settings) ? settings : {};
    targetId.value = typeof row['targetId'] === 'string' ? row['targetId'] : '';
    targetKind.value = isNiimbotHaTargetKind(row['targetKind'])
      ? row['targetKind']
      : 'device';
    soleTarget.value = row['soleTarget'] === true;
    sendSize.value = row['sendSize'] !== false;
    printers.value = asPrinters(await printersRes.json());
    // The list decides what a newly chosen target IS. An id picked from a
    // device list is a device; the same screen falling back to entities saves
    // an entity target — the printer is the same, the spelling is not.
    if (printers.value) targetKind.value = printers.value.kind;
    // One printer and nothing chosen: choose it. There is no question to ask —
    // asking it anyway is what produced a screen that said "send to the only
    // printer" above an empty picker, and then printed nowhere.
    if (sole.value && !targetId.value) targetId.value = sole.value.id;
  } catch {
    toast.error(t('printingNiimbot.ha.loadFailed'));
  } finally {
    loading.value = false;
  }
};

// What the form holds, in the shape both the save and the dry run take.
const formBody = (): Record<string, unknown> => {
  const chosen = printers.value?.printers.find(
    (printer) => printer.id === targetId.value,
  );
  return {
    targetId: targetId.value,
    targetKind: targetKind.value,
    printerName: chosen?.name ?? '',
    // Only an instance whose printers this screen could not enumerate leaves
    // the job targetless; everywhere else it carries the id.
    soleTarget: offerSoleTarget.value ? soleTarget.value : false,
    sendSize: sendSize.value,
  };
};

const save = async (): Promise<void> => {
  try {
    saving.value = true;
    const res = await apiFetch('/api/printing-niimbot/ha/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formBody()),
    });
    if (!res.ok) {
      toast.error(t('printingNiimbot.ha.saveFailed'));
      return;
    }
    toast.success(t('printingNiimbot.ha.saved'));
  } catch {
    toast.error(t('printingNiimbot.ha.saveFailed'));
  } finally {
    saving.value = false;
  }
};

// A render, not a print: Home Assistant draws the test page and hands it back,
// so the whole chain is proven without spending a sticker — and the page it
// drew is shown, because an image is the one answer to "did this work" that
// cannot be misread.
const sendPreview = async (): Promise<void> => {
  try {
    previewing.value = true;
    preview.value = null;
    const res = await apiFetch('/api/printing-niimbot/ha/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formBody()),
    });
    preview.value = res.ok
      ? asPreview(await res.json())
      : {
          ok: false,
          stage: 'device',
          errorKey: 'printingNiimbot.ha.errors.noBridge',
        };
  } catch {
    preview.value = {
      ok: false,
      stage: 'device',
      errorKey: 'printingNiimbot.ha.errors.noBridge',
    };
  } finally {
    previewing.value = false;
  }
};

onMounted(load);
onReactivated(load);
</script>

<template>
  <section
    class="space-y-4 rounded-2xl border border-slate-200 p-4 dark:border-white/10"
  >
    <div>
      <h5 class="text-sm font-semibold text-slate-900 dark:text-white">
        {{ $t('printingNiimbot.ha.title') }}
      </h5>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ $t('printingNiimbot.ha.description') }}
      </p>
    </div>

    <div v-if="loading" class="flex justify-center py-4">
      <Spinner />
    </div>

    <p
      v-else-if="!mayAdminister"
      class="text-xs text-slate-500 dark:text-slate-400"
    >
      {{ $t('printingNiimbot.ha.adminOnlyNote') }}
    </p>

    <div v-else-if="!haEnabled" class="space-y-2">
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ $t('printingNiimbot.ha.noBridge') }}
      </p>
    </div>

    <div v-else-if="printers?.bridge !== 'ok'" class="space-y-2">
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{
          printers?.bridge === 'unconfigured'
            ? $t('printingNiimbot.ha.unconfigured')
            : $t('printingNiimbot.ha.noBridge')
        }}
      </p>
      <Button
        variant="link"
        size="sm"
        :to="{ path: '/settings', query: { section: 'homeassistant' } }"
      >
        {{ $t('printingNiimbot.ha.openConnection') }}
      </Button>
    </div>

    <template v-else>
      <!-- Where the list named exactly one printer there is no question to
           ask: it is stated, not offered. Asking anyway is what produced a
           screen whose switch said "the only printer" above an empty picker. -->
      <div v-if="sole" class="space-y-1">
        <p class="text-sm font-semibold">
          {{ $t('printingNiimbot.ha.printer.label') }}
        </p>
        <p class="text-sm text-slate-700 dark:text-slate-200">
          {{ sole.name }}
        </p>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('printingNiimbot.ha.printer.only') }}
        </p>
      </div>

      <template v-else>
        <!-- The escape hatch, and only where it is the honest answer: an
             instance whose printers could not be enumerated. Everywhere else
             the job carries an explicit target, which is what Home Assistant
             answers without guessing. -->
        <div
          v-if="offerSoleTarget"
          class="flex items-start justify-between gap-3"
        >
          <div>
            <label for="niimbot-ha-sole" class="block text-sm font-semibold">
              {{ $t('printingNiimbot.ha.soleTarget.label') }}
            </label>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              {{ $t('printingNiimbot.ha.soleTarget.help') }}
            </p>
          </div>
          <Switch
            id="niimbot-ha-sole"
            v-model="soleTarget"
            :aria-label="$t('printingNiimbot.ha.soleTarget.label')"
          />
        </div>

        <!-- Hidden, not disabled, while Home Assistant is picking: a greyed
             "— No printer —" under a switch that says the printer is chosen
             reads as a misconfiguration. -->
        <div v-if="!(offerSoleTarget && soleTarget)" class="space-y-2">
          <label for="niimbot-ha-printer" class="block text-sm font-semibold">
            {{ $t('printingNiimbot.ha.printer.label') }}
          </label>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('printingNiimbot.ha.printer.help') }}
          </p>
          <Select
            id="niimbot-ha-printer"
            v-model="targetId"
            :options="printerOptions"
            searchable
            :aria-label="$t('printingNiimbot.ha.printer.label')"
          />
          <p
            v-if="printers.printers.length === 0"
            class="text-xs text-amber-700 dark:text-amber-300"
          >
            {{ $t('printingNiimbot.ha.printer.empty') }}
          </p>
          <p
            v-else-if="printers.kind === 'entity'"
            class="text-xs text-amber-700 dark:text-amber-300"
          >
            {{
              printers.filtered === false
                ? $t('printingNiimbot.ha.printer.unfiltered')
                : $t('printingNiimbot.ha.printer.entities')
            }}
          </p>
        </div>
      </template>

      <div class="flex items-start justify-between gap-3">
        <div>
          <label for="niimbot-ha-size" class="block text-sm font-semibold">
            {{ $t('printingNiimbot.ha.sendSize.label') }}
          </label>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('printingNiimbot.ha.sendSize.help') }}
          </p>
        </div>
        <Switch
          id="niimbot-ha-size"
          v-model="sendSize"
          :aria-label="$t('printingNiimbot.ha.sendSize.label')"
        />
      </div>

      <div class="flex justify-end gap-2">
        <Button
          variant="secondary"
          :loading="previewing"
          :disabled="!configurable"
          @click="sendPreview"
        >
          {{ $t('printingNiimbot.ha.preview') }}
        </Button>
        <Button :loading="saving" :icon-left="Save" @click="save">
          {{ $t('common.save') }}
        </Button>
      </div>
    </template>
  </section>

  <!-- The answer to the press: one outcome, said plainly, with the page Home
       Assistant drew underneath it when it sent one back. Dismissed by the
       person, so it cannot be missed. -->
  <Modal
    :model-value="preview !== null"
    :title="$t('printingNiimbot.ha.preview')"
    width="sm"
    @update:model-value="preview = null"
  >
    <div v-if="preview" class="space-y-3">
      <p
        class="text-sm font-semibold"
        :class="
          preview.ok
            ? 'text-emerald-700 dark:text-emerald-300'
            : 'text-red-700 dark:text-red-300'
        "
      >
        {{
          preview.ok
            ? $t('printingNiimbot.ha.previewOk')
            : preview.stage === 'render'
              ? $t('printingNiimbot.ha.previewFailedRender')
              : $t('printingNiimbot.ha.previewFailedDevice')
        }}
      </p>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{
          preview.ok
            ? $t('printingNiimbot.ha.previewNotPrinted')
            : $t(preview.errorKey ?? 'printingNiimbot.ha.errors.noBridge')
        }}
      </p>
      <img
        v-if="preview.ok && preview.image"
        :src="preview.image"
        :alt="$t('printingNiimbot.ha.previewAlt')"
        class="w-full rounded-lg border border-slate-200 bg-white dark:border-white/10"
      />
    </div>

    <template #footer>
      <Button variant="secondary" @click="preview = null">
        {{ $t('common.close') }}
      </Button>
    </template>
  </Modal>
</template>
