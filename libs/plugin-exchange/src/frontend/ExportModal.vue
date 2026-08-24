<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Button,
  Modal,
  Spinner,
  Switch,
  useToastStore,
  apiErrorMessage,
} from '@makekeeper/frontend-core';
import type { ExchangeCatalogSection } from '../exchange-types';
import { downloadExport, getCatalog } from './exchange-data';

// Section-picker dialog for one export root. Used by the in-context "Export…"
// slot actions (project / storage pages) and by the exchange page's backup
// card (instance root, adds the include-secrets toggle).

const props = defineProps<{
  modelValue: boolean;
  rootType: string;
  rootId?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const { t } = useI18n();
const toast = useToastStore();

const sections = ref<ExchangeCatalogSection[]>([]);
const selected = ref<Set<string>>(new Set());
const includeSecrets = ref(false);
const loading = ref(false);
const exporting = ref(false);

const isInstance = computed(() => props.rootType === 'instance');
const visibleSections = computed(() =>
  sections.value.filter(
    (s) => !s.sensitive || (isInstance.value && includeSecrets.value),
  ),
);
const hasSensitive = computed(() => sections.value.some((s) => s.sensitive));

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    loading.value = true;
    try {
      const catalog = await getCatalog();
      sections.value = catalog.sectionsByRoot[props.rootType] ?? [];
      selected.value = new Set(
        sections.value
          .filter((s) => (s.isRoot || s.defaultSelected) && !s.sensitive)
          .map((s) => s.key),
      );
    } catch (err) {
      toast.error(apiErrorMessage(err, t('exchange.page.loadFailed')));
      emit('update:modelValue', false);
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

// Selecting a section pulls its hard dependencies in; deselecting one drops
// the sections that require it — mirrors the backend's dependency rule.
function toggle(section: ExchangeCatalogSection, on: boolean): void {
  const next = new Set(selected.value);
  if (on) {
    next.add(section.key);
    for (const dep of section.dependsOn) next.add(dep);
  } else {
    next.delete(section.key);
    for (const other of sections.value) {
      if (other.dependsOn.includes(section.key)) next.delete(other.key);
    }
  }
  for (const s of sections.value) if (s.isRoot) next.add(s.key);
  selected.value = next;
}

watch(includeSecrets, (on) => {
  if (!on) {
    const next = new Set(selected.value);
    for (const s of sections.value) if (s.sensitive) next.delete(s.key);
    selected.value = next;
  }
});

async function runExport(): Promise<void> {
  exporting.value = true;
  try {
    await downloadExport({
      rootType: props.rootType,
      rootId: props.rootId,
      sections: [...selected.value],
      includeSecrets: includeSecrets.value,
    });
    toast.success(t('exchange.export.done'));
    emit('update:modelValue', false);
  } catch (err) {
    toast.error(apiErrorMessage(err, t('exchange.export.failed')));
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="t('exchange.export.title')"
    width="lg"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="loading" class="flex justify-center py-8">
      <Spinner />
    </div>
    <div v-else class="space-y-4">
      <p class="text-sm text-slate-500 dark:text-slate-400">
        {{ t('exchange.export.hint') }}
      </p>
      <ul class="space-y-2">
        <li
          v-for="section in visibleSections"
          :key="section.key"
          class="flex items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 dark:border-white/10"
        >
          <div class="min-w-0">
            <div class="text-sm font-medium text-slate-800 dark:text-slate-100">
              {{ t(section.labelKey) }}
            </div>
            <div
              v-if="section.descriptionKey"
              class="text-xxs text-slate-500 dark:text-slate-400"
            >
              {{ t(section.descriptionKey) }}
            </div>
          </div>
          <Switch
            :model-value="selected.has(section.key)"
            :disabled="section.isRoot"
            :aria-label="t(section.labelKey)"
            @update:model-value="toggle(section, $event)"
          />
        </li>
      </ul>
      <div
        v-if="isInstance && hasSensitive"
        class="flex items-start justify-between gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 dark:border-amber-400/30 dark:bg-amber-400/10"
      >
        <div>
          <div class="text-sm font-medium text-amber-800 dark:text-amber-200">
            {{ t('exchange.export.includeSecrets') }}
          </div>
          <div class="text-xxs text-amber-700 dark:text-amber-300">
            {{ t('exchange.export.secretsWarning') }}
          </div>
        </div>
        <Switch
          v-model="includeSecrets"
          :aria-label="t('exchange.export.includeSecrets')"
        />
      </div>
      <div class="flex justify-end gap-2">
        <Button variant="secondary" @click="emit('update:modelValue', false)">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="exporting" @click="runExport">
          <Spinner v-if="exporting" size="sm" />
          {{ t('exchange.export.download') }}
        </Button>
      </div>
    </div>
  </Modal>
</template>
