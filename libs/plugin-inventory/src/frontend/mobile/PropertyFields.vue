<script setup lang="ts">
import { computed } from 'vue';
import { Select, fieldValue } from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import { PROPERTY_VALUE_MAX, type EffectiveProperty } from '../../categories';

// The category's properties as ordinary editable fields on a phone (#206).
//
// Expanded, never folded behind a disclosure: these values reached the screen
// through two guesses — the model read the photo, then read its own description
// of it — so they must be in front of the person before they reach the
// warehouse, not one tap away from being seen.
const props = defineProps<{
  properties: EffectiveProperty[];
  values: Record<string, string>;
  // Unique per draft: two drafts on one list would otherwise share label `for`
  // targets and the second one's labels would focus the first one's inputs.
  idPrefix: string;
}>();

const emit = defineEmits<{
  (event: 'change', propertyId: string, value: string): void;
}>();

const { t } = useI18n();

const valueOf = (property: EffectiveProperty): string =>
  props.values[property.id] ?? '';

// A closed list gets the declared spellings plus a real "nothing chosen" row —
// blank is a legitimate answer for a property nobody filled in yet.
const optionsFor = (property: EffectiveProperty) => [
  { value: '', label: t('inventory.form.noValue'), empty: true },
  ...property.options.map((option) => ({ value: option, label: option })),
];

const hasProperties = computed<boolean>(() => props.properties.length > 0);
</script>

<template>
  <div v-if="hasProperties" class="space-y-3">
    <!-- Same treatment as every other section heading on this surface (see the
         placement section of the part detail) — it used to be a `text-xs bold`
         of its own. -->
    <h2 class="text-sm font-semibold">
      {{ $t('inventory.mobile.properties') }}
    </h2>
    <div v-for="property in properties" :key="property.id" class="space-y-1">
      <label
        :for="`${idPrefix}-${property.id}`"
        class="block text-sm font-medium"
      >
        {{ property.name }}
        <span v-if="property.unit" class="font-normal">
          , {{ property.unit }}
        </span>
        <span
          v-if="property.required"
          class="font-normal text-slate-500 dark:text-slate-400"
        >
          · {{ $t('inventory.form.expected') }}
        </span>
      </label>

      <Select
        v-if="property.type === 'select'"
        :id="`${idPrefix}-${property.id}`"
        :model-value="valueOf(property)"
        :options="optionsFor(property)"
        @update:model-value="emit('change', property.id, String($event))"
      />
      <input
        v-else
        :id="`${idPrefix}-${property.id}`"
        :value="valueOf(property)"
        :type="property.type === 'number' ? 'number' : 'text'"
        :inputmode="property.type === 'number' ? 'decimal' : undefined"
        :maxlength="PROPERTY_VALUE_MAX"
        class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
        @change="emit('change', property.id, fieldValue($event))"
      />
    </div>
  </div>
</template>
