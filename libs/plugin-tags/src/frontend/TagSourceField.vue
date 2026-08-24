<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Switch,
  getErrorMessage,
  useToastStore,
} from '@makekeeper/frontend-core';
import type { SlotFieldCommit } from '@makekeeper/plugin-contract';
import { isTaggableValueKind } from '../value-kinds';
import { useTagSourcesStore, useTagSourceFor } from './tag-sources-data';

// "The value of this field also becomes a tag" (#205), contributed into a
// host's own create/edit form for that field.
//
// The host owns the field and knows nothing about tags: it has no column for
// this, no switch of its own and no check for whether this plugin is enabled.
// Disabling tags removes the contribution, which removes the feature.
//
// The hard part a form poses is that a field being CREATED has no ref yet, so
// there is nothing to key the marking by while the switch is being flipped. The
// answer is `onReady`: this component hands the host a function, the host calls
// it with the field's ref once the field is saved, and only then does anything
// get written. Cancel the form and it is never called — so the switch inherits
// the host's Save/Cancel semantics without either side knowing the other's
// storage.
const props = defineProps<{
  fieldRef: string | null;
  valueKind: string;
  onReady?: (commit: SlotFieldCommit) => void;
}>();

const { t: $t } = useI18n();
const toast = useToastStore();
const store = useTagSourcesStore();

// Editing an existing field starts from its stored state; creating one starts
// off. `loaded` keeps the switch from flashing off before the answer arrives.
const fieldRef = toRef(props, 'fieldRef');
const { isSource: stored, loaded } = useTagSourceFor(fieldRef);

const model = ref(false);
watch(
  [stored, loaded],
  ([value, isLoaded]) => {
    if (isLoaded) model.value = value;
  },
  { immediate: true },
);

// A kind that would make a useless tag is not offered at all — a control that
// can only ever say no is worse than no control. This is the tags plugin's
// judgement about tags, which is why the host does not make it.
const supported = computed(() => isTaggableValueKind(props.valueKind));

// Run by the host once the field exists. Writes only when the answer differs
// from what is stored, so cancelling out of a form that changed nothing is
// silent, and re-saving an unrelated field never touches this.
//
// Never throws: the host has already saved its field, and this plugin's problem
// cannot be allowed to undo that.
const commit: SlotFieldCommit = async (savedRef: string): Promise<void> => {
  // A field whose kind stopped being taggable (switched to a number mid-form)
  // must not keep a marking nothing will ever act on.
  const next = supported.value && model.value;
  // A field the host just created is not marked yet, whatever this component
  // last read; an existing one is whatever is stored for it.
  const current = savedRef === props.fieldRef ? stored.value : false;
  if (next === current) return;
  try {
    await store.setSource(savedRef, next);
  } catch (err) {
    toast.error(getErrorMessage(err));
  }
};

// The modal is `v-if`, so this fires once per open and the host resets its
// registry each time — no accumulation across opens.
onMounted(() => props.onReady?.(commit));
</script>

<template>
  <div v-if="supported" class="flex items-start gap-3">
    <Switch id="tag-source-switch" v-model="model" />
    <label for="tag-source-switch" class="cursor-pointer">
      <span class="block text-sm font-medium">
        {{ $t('tags.sources.label') }}
      </span>
      <span class="block text-xxs text-slate-500 dark:text-slate-400">
        {{ $t('tags.sources.hint') }}
      </span>
    </label>
  </div>
</template>
