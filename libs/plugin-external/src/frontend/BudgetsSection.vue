<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Button,
  Spinner,
  apiErrorMessage,
  apiJson,
  useToastStore,
} from '@makekeeper/frontend-core';
import SectionShell from './SectionShell.vue';

// Time budgets (decision #8): how long the CORE waits on each plugin surface
// before the breaker counts a miss. Loaded when the section is opened — most
// visits to this page never come here.
const SURFACES = ['screen', 'widget', 'slot', 'ref', 'tool', 'hook'] as const;
type Surface = (typeof SURFACES)[number];
type SurfaceBudgets = Record<Surface, number>;

const { t } = useI18n();
const toast = useToastStore();

const form = ref<SurfaceBudgets | null>(null);
const defaults = ref<SurfaceBudgets | null>(null);
const saving = ref(false);

const load = async (): Promise<void> => {
  try {
    const res = await apiJson<{
      budgets: SurfaceBudgets;
      defaults: SurfaceBudgets;
    }>('/api/external/admin/budgets');
    form.value = { ...res.budgets };
    defaults.value = res.defaults;
  } catch (err: unknown) {
    toast.error(apiErrorMessage(err, t('external.errors.failed')));
  }
};

onMounted(load);

// Narrowed, not cast (§5.1): `$event.target` is typed `EventTarget | null`.
const inputValue = (event: Event): string =>
  event.target instanceof HTMLInputElement ? event.target.value : '';

const setBudget = (surface: Surface, raw: string): void => {
  if (!form.value) return;
  const value = Number.parseInt(raw, 10);
  if (Number.isFinite(value)) form.value[surface] = value;
};

const save = async (): Promise<void> => {
  if (!form.value) return;
  saving.value = true;
  try {
    const res = await apiJson<{ budgets: SurfaceBudgets }>(
      '/api/external/admin/budgets',
      { method: 'PATCH', body: form.value },
    );
    form.value = { ...res.budgets };
    toast.success(t('external.budgets.saved'));
  } catch (err: unknown) {
    toast.error(apiErrorMessage(err, t('external.errors.failed')));
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <SectionShell
    :title="t('external.budgets.title')"
    :description="t('external.budgets.hint')"
  >
    <div v-if="!form" class="flex justify-center py-12">
      <Spinner />
    </div>
    <template v-else>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label
          v-for="surface in SURFACES"
          :key="surface"
          :for="`budget-${surface}`"
          class="block text-sm text-slate-700 dark:text-slate-300"
        >
          {{ t(`external.budgets.surface.${surface}`) }}
          <input
            :id="`budget-${surface}`"
            :value="form[surface]"
            type="number"
            min="100"
            max="600000"
            step="100"
            class="glass-input mt-1 w-full rounded-xl px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            @input="setBudget(surface, inputValue($event))"
          />
          <span
            v-if="defaults"
            class="mt-0.5 block text-xxs text-slate-500 dark:text-slate-400"
          >
            {{ t('external.budgets.default', { ms: defaults[surface] }) }}
          </span>
        </label>
      </div>
      <div class="flex justify-end">
        <Button :disabled="saving" @click="save">
          <Spinner v-if="saving" class="h-4 w-4" />
          {{ t('common.save') }}
        </Button>
      </div>
    </template>
  </SectionShell>
</template>
