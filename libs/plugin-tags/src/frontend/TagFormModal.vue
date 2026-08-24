<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Check } from '@lucide/vue';
import {
  Button,
  Modal,
  apiErrorMessage,
  apiJson,
  useToastStore,
} from '@makekeeper/frontend-core';
import TagChip from './TagChip.vue';
import { DEFAULT_CUSTOM_HEX, TAG_COLORS, isHexColor } from '../tag-colors';
import { useTagChipsStore } from './tags-data';
import { TAG_NAME_MAX, type TagDto } from '../tags-types';

// Create or edit a tag: name + a colour — a palette tone (quick-pick) or a
// custom colour from the colour picker. Owns its own API call and toasts; emits
// `saved` (with the resulting tag) so the parent list refreshes, and invalidates
// the chip cache so the new colour shows wherever the tag is displayed.
const props = defineProps<{
  modelValue: boolean;
  // Present ⇒ edit mode; absent ⇒ create.
  tag?: TagDto | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'saved', tag: TagDto): void;
}>();

const { t: $t } = useI18n();
const toast = useToastStore();
const tagChips = useTagChipsStore();

const name = ref('');
const color = ref<string>('slate');
// The colour-picker's hex value (kept separate so switching to a tone doesn't
// lose the last custom pick). Seeded from the tag when it already has a hex.
const customHex = ref<string>(DEFAULT_CUSTOM_HEX);
const saving = ref(false);

const isEdit = computed(() => Boolean(props.tag));
const isCustom = computed(() => isHexColor(color.value));

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    name.value = props.tag?.name ?? '';
    const tagColor = props.tag?.color ?? 'slate';
    color.value = tagColor;
    if (isHexColor(tagColor)) customHex.value = tagColor;
  },
);

function pickCustom(hex: string): void {
  customHex.value = hex;
  color.value = hex;
}

function close(): void {
  emit('update:modelValue', false);
}

async function save(): Promise<void> {
  const trimmed = name.value.trim();
  if (!trimmed || saving.value) return;
  saving.value = true;
  try {
    const saved = props.tag
      ? await apiJson<TagDto>(`/api/tags/${props.tag.id}`, {
          method: 'PATCH',
          body: { name: trimmed, color: color.value },
        })
      : await apiJson<TagDto>('/api/tags', {
          method: 'POST',
          body: { name: trimmed, color: color.value },
        });
    toast.success(
      $t(props.tag ? 'tags.toasts.updated' : 'tags.toasts.created'),
    );
    // The tag's colour/name may now differ everywhere it is shown — refresh the
    // chip cache so host sections reflect it without a reload.
    tagChips.invalidateAll();
    emit('saved', saved);
    close();
  } catch (err) {
    toast.error(apiErrorMessage(err, $t('tags.toasts.error')));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="$t(isEdit ? 'tags.form.editTitle' : 'tags.form.createTitle')"
    width="sm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="space-y-4" @submit.prevent="save">
      <div>
        <label
          for="tag-name"
          class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
        >
          {{ $t('tags.form.nameLabel') }}
        </label>
        <input
          id="tag-name"
          v-model="name"
          type="text"
          :maxlength="TAG_NAME_MAX"
          class="w-full glass-input rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-brand-500/10"
          :placeholder="$t('tags.form.namePlaceholder')"
        />
      </div>
      <div>
        <span
          class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
          >{{ $t('tags.form.colorLabel') }}</span
        >
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="tone in TAG_COLORS"
            :key="tone"
            type="button"
            class="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            :aria-label="$t(`tags.colors.${tone}`)"
            :aria-pressed="color === tone"
            @click="color = tone"
          >
            <TagChip :name="$t(`tags.colors.${tone}`)" :color="tone">
              <span class="inline-flex items-center gap-1">
                <Check v-if="color === tone" class="w-3 h-3" />
                {{ $t(`tags.colors.${tone}`) }}
              </span>
            </TagChip>
          </button>

          <!-- Custom colour picker: a native colour input styled as a swatch.
               The label wraps the input so the whole swatch is clickable. -->
          <label
            class="relative inline-flex items-center justify-center w-8 h-8 rounded-full cursor-pointer ring-offset-2 ring-offset-white dark:ring-offset-dark-900 focus-within:ring-2 focus-within:ring-brand-500/40"
            :class="
              isCustom
                ? 'ring-2 ring-brand-500'
                : 'ring-1 ring-slate-300 dark:ring-white/15'
            "
            :style="{
              background: isCustom
                ? customHex
                : 'conic-gradient(#ef4444,#f59e0b,#10b981,#0ea5e9,#8b5cf6,#ec4899,#ef4444)',
            }"
            :title="$t('tags.form.customColor')"
            :aria-label="$t('tags.form.customColor')"
          >
            <Check v-if="isCustom" class="w-4 h-4 text-white drop-shadow" />
            <input
              type="color"
              class="absolute inset-0 opacity-0 cursor-pointer"
              :value="customHex"
              @input="pickCustom(($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
      </div>
      <div class="pt-2">
        <TagChip
          :name="name || $t('tags.form.namePlaceholder')"
          :color="color"
        />
      </div>
    </form>
    <template #footer>
      <Button variant="secondary" @click="close">{{
        $t('tags.form.cancel')
      }}</Button>
      <Button :loading="saving" :disabled="!name.trim()" @click="save">{{
        $t('tags.form.save')
      }}</Button>
    </template>
  </Modal>
</template>
