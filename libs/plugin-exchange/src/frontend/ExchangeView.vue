<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { ArrowLeftRight, DatabaseBackup, FileDown } from '@lucide/vue';
import {
  Badge,
  Button,
  PageHeader,
  Select,
  Spinner,
  Switch,
  apiErrorMessage,
  resolveObjectRefRoute,
  useSessionStore,
  useToastStore,
} from '@makekeeper/frontend-core';
import type {
  ExchangeOptionValues,
  PluginSettingField,
} from '@makekeeper/plugin-contract';
import type {
  ExchangeImportPreview,
  ExchangeImportResult,
} from '../exchange-types';
import { discardImport, executeImport, inspectArchive } from './exchange-data';
import ExportModal from './ExportModal.vue';

// The exchange page: the import wizard (upload → choose sections/options →
// result) and the admin-only full-backup card. Entity exports live on their
// object pages (contributed "Export…" actions) — this page never lists other
// plugins' entities.

const { t } = useI18n();
const toast = useToastStore();
const session = useSessionStore();
const router = useRouter();

const canBackup = computed(() => !session.multiuserEnabled || session.isAdmin);
const backupOpen = ref(false);

// ── Import wizard state ─────────────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null);
const inspecting = ref(false);
const preview = ref<ExchangeImportPreview | null>(null);
const selected = ref<Set<string>>(new Set());
const optionValues = ref<Record<string, ExchangeOptionValues>>({});
const importing = ref(false);
const result = ref<ExchangeImportResult | null>(null);
// Section labels survive past the preview (cleared on success) so the result
// list can name sections instead of echoing raw keys.
const sectionLabels = ref<Record<string, string>>({});

const resultRoute = computed(() =>
  result.value?.rootRef ? resolveObjectRefRoute(result.value.rootRef) : null,
);

async function onFileChange(event: Event): Promise<void> {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
  const file = input.files[0];
  input.value = '';
  inspecting.value = true;
  result.value = null;
  try {
    preview.value = await inspectArchive(file);
    selected.value = new Set(
      preview.value.sections.filter((s) => s.available).map((s) => s.key),
    );
    optionValues.value = {};
  } catch (err) {
    toast.error(apiErrorMessage(err, t('exchange.import.inspectFailed')));
  } finally {
    inspecting.value = false;
  }
}

function toggleSection(key: string, on: boolean): void {
  if (!preview.value) return;
  const next = new Set(selected.value);
  const byKey = new Map(preview.value.sections.map((s) => [s.key, s]));
  if (on) {
    next.add(key);
    for (const dep of byKey.get(key)?.dependsOn ?? []) {
      if (byKey.get(dep)?.available) next.add(dep);
    }
  } else {
    next.delete(key);
    for (const section of preview.value.sections) {
      if (section.dependsOn?.includes(key)) next.delete(section.key);
    }
  }
  for (const section of preview.value.sections) {
    if (section.isRoot && section.available) next.add(section.key);
  }
  selected.value = next;
}

function setOption(
  sectionKey: string,
  field: PluginSettingField,
  value: string | number | boolean,
): void {
  optionValues.value = {
    ...optionValues.value,
    [sectionKey]: { ...optionValues.value[sectionKey], [field.key]: value },
  };
}

function optionValue(
  sectionKey: string,
  field: PluginSettingField,
): string | number | boolean | undefined {
  return optionValues.value[sectionKey]?.[field.key];
}

function onOptionInput(
  sectionKey: string,
  field: PluginSettingField,
  event: Event,
): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  setOption(
    sectionKey,
    field,
    field.type === 'number' ? Number(target.value) : target.value,
  );
}

function selectOptions(
  field: PluginSettingField,
): { value: string; label: string }[] {
  return (field.options ?? []).map((o) => ({
    value: o.value,
    label: t(o.labelKey),
  }));
}

async function cancelImport(): Promise<void> {
  if (preview.value) {
    await discardImport(preview.value.token).catch(() => undefined);
  }
  preview.value = null;
  result.value = null;
}

async function runImport(): Promise<void> {
  if (!preview.value) return;
  importing.value = true;
  sectionLabels.value = Object.fromEntries(
    preview.value.sections.flatMap((s) =>
      s.labelKey ? [[s.key, s.labelKey]] : [],
    ),
  );
  try {
    result.value = await executeImport(
      preview.value.token,
      [...selected.value],
      optionValues.value,
    );
    preview.value = null;
    toast.success(t('exchange.import.done'));
  } catch (err) {
    toast.error(apiErrorMessage(err, t('exchange.import.failed')));
  } finally {
    importing.value = false;
  }
}

function openResult(): void {
  if (resultRoute.value) void router.push(resultRoute.value);
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="t('exchange.page.title')"
      :subtitle="t('exchange.page.subtitle')"
      :icon="ArrowLeftRight"
    />

    <!-- Import -->
    <section class="glass-card rounded-2xl p-5 space-y-4">
      <div class="flex items-center gap-2">
        <FileDown class="h-5 w-5 text-brand-500" />
        <h2 class="text-base font-semibold text-slate-800 dark:text-slate-100">
          {{ t('exchange.import.title') }}
        </h2>
      </div>

      <div v-if="!preview && !result" class="space-y-3">
        <p class="text-sm text-slate-500 dark:text-slate-400">
          {{ t('exchange.import.hint') }}
        </p>
        <input
          ref="fileInput"
          type="file"
          accept=".mkx,application/zip"
          class="hidden"
          :aria-label="t('exchange.import.pickFile')"
          @change="onFileChange"
        />
        <Button :disabled="inspecting" @click="fileInput?.click()">
          <Spinner v-if="inspecting" size="sm" />
          {{ t('exchange.import.pickFile') }}
        </Button>
      </div>

      <div v-else-if="preview" class="space-y-4">
        <p class="text-sm text-slate-500 dark:text-slate-400">
          {{
            t('exchange.import.previewHint', {
              date: new Date(preview.exportedAt).toLocaleString(),
            })
          }}
        </p>
        <ul class="space-y-2">
          <li
            v-for="section in preview.sections"
            :key="section.key"
            class="rounded-xl border border-slate-200 px-3 py-2 dark:border-white/10"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div
                  class="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100"
                >
                  {{ section.labelKey ? t(section.labelKey) : section.key }}
                  <Badge tone="neutral">
                    {{ section.count }}
                  </Badge>
                </div>
                <div
                  v-for="warning in section.warningKeys"
                  :key="warning"
                  class="text-xxs text-amber-600 dark:text-amber-400"
                >
                  <!-- The missing-external-plugin warning names the plugin, so
                       the admin knows exactly what to install (#138). -->
                  {{ t(warning, { plugin: section.pluginId ?? '' }) }}
                </div>
              </div>
              <Switch
                :model-value="selected.has(section.key)"
                :disabled="!section.available || section.isRoot"
                :aria-label="
                  section.labelKey ? t(section.labelKey) : section.key
                "
                @update:model-value="toggleSection(section.key, $event)"
              />
            </div>
            <div
              v-if="section.importOptions?.length && selected.has(section.key)"
              class="mt-2 space-y-2 border-t border-slate-100 pt-2 dark:border-white/5"
            >
              <div
                v-for="field in section.importOptions"
                :key="field.key"
                class="flex items-center justify-between gap-3"
              >
                <label
                  :for="`opt-${section.key}-${field.key}`"
                  class="text-xxs text-slate-500 dark:text-slate-400"
                >
                  {{ t(field.labelKey) }}
                </label>
                <Select
                  v-if="field.type === 'select'"
                  :model-value="
                    optionValue(section.key, field) ?? field.options?.[0]?.value
                  "
                  :options="selectOptions(field)"
                  class="w-56"
                  @update:model-value="setOption(section.key, field, $event)"
                />
                <Switch
                  v-else-if="field.type === 'boolean'"
                  :model-value="optionValue(section.key, field) === true"
                  :aria-label="t(field.labelKey)"
                  @update:model-value="setOption(section.key, field, $event)"
                />
                <input
                  v-else
                  :id="`opt-${section.key}-${field.key}`"
                  :type="field.type === 'number' ? 'number' : 'text'"
                  :value="optionValue(section.key, field) ?? ''"
                  class="glass-input w-56 rounded-xl px-3 py-1.5 text-sm"
                  @input="onOptionInput(section.key, field, $event)"
                />
              </div>
            </div>
          </li>
        </ul>
        <div class="flex justify-end gap-2">
          <Button variant="secondary" @click="cancelImport">
            {{ t('common.cancel') }}
          </Button>
          <Button :disabled="importing" @click="runImport">
            <Spinner v-if="importing" size="sm" />
            {{ t('exchange.import.run') }}
          </Button>
        </div>
      </div>

      <div v-else-if="result" class="space-y-3">
        <p class="text-sm font-medium text-emerald-600 dark:text-emerald-400">
          {{ t('exchange.import.resultTitle') }}
        </p>
        <ul class="space-y-1">
          <li
            v-for="section in result.sections"
            :key="section.key"
            class="text-sm text-slate-600 dark:text-slate-300"
          >
            {{
              sectionLabels[section.key]
                ? t(sectionLabels[section.key])
                : section.key
            }}
            —
            {{ t('exchange.import.createdCount', { count: section.created }) }}
          </li>
        </ul>
        <div class="flex gap-2">
          <Button v-if="resultRoute" @click="openResult">
            {{ t('exchange.import.openResult') }}
          </Button>
          <Button variant="secondary" @click="result = null">
            {{ t('exchange.import.again') }}
          </Button>
        </div>
      </div>
    </section>

    <!-- Full backup (admin / single-user) -->
    <section v-if="canBackup" class="glass-card rounded-2xl p-5 space-y-3">
      <div class="flex items-center gap-2">
        <DatabaseBackup class="h-5 w-5 text-brand-500" />
        <h2 class="text-base font-semibold text-slate-800 dark:text-slate-100">
          {{ t('exchange.backup.title') }}
        </h2>
      </div>
      <p class="text-sm text-slate-500 dark:text-slate-400">
        {{ t('exchange.backup.hint') }}
      </p>
      <Button @click="backupOpen = true">
        {{ t('exchange.backup.export') }}
      </Button>
      <ExportModal v-model="backupOpen" root-type="instance" />
    </section>

    <!-- Where entity exports live -->
    <p class="text-xxs text-slate-400 dark:text-slate-500">
      {{ t('exchange.page.entityHint') }}
    </p>
  </div>
</template>
