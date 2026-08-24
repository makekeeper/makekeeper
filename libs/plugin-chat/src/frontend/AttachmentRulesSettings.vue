<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  Button,
  Spinner,
  TagInput,
  apiFetch,
  useToastStore,
} from '@makekeeper/frontend-core';
import {
  DEFAULT_ATTACHMENT_RULES,
  normaliseAttachmentRuleList,
  type AttachmentRules,
} from '@makekeeper/plugin-contract';
import { useI18n } from 'vue-i18n';
import { RotateCcw, Save } from '@lucide/vue';

// What may be attached to a chat message (#112) — the second group of the AI
// Assistant settings, beside the connections.
//
// Ownership mirrors the connections deliberately: the rules that apply are
// those of whoever owns the ACTIVE connection, because that is who pays for
// whatever the model is fed. This panel edits one ruleset — the instance one
// for an admin / single-user install, the caller's own otherwise — and an
// empty personal ruleset simply means "inherit".
const props = defineProps<{ personal: boolean }>();

const { t } = useI18n();
const toast = useToastStore();

const loading = ref(true);
const saving = ref(false);
// Null while the owner stores nothing — the inherited case, which the UI must
// be able to distinguish from "stored, but empty".
const stored = ref<AttachmentRules | null>(null);
const draft = ref<AttachmentRules>({ ...DEFAULT_ATTACHMENT_RULES });

const apiBase = computed<string>(() =>
  props.personal
    ? '/api/chat/attachment-settings/personal'
    : '/api/chat/attachment-settings',
);

const inherited = computed<boolean>(() => stored.value === null);

// Megabytes in the form, bytes on the wire: nobody wants to type 20971520.
const maxNonImageMb = computed<number>({
  get: () => round1(draft.value.maxNonImageBytes / (1024 * 1024)),
  set: (value) => {
    draft.value.maxNonImageBytes = Math.round(value * 1024 * 1024);
  },
});

const maxReadKb = computed<number>({
  get: () => round1(draft.value.maxReadBytes / 1024),
  set: (value) => {
    draft.value.maxReadBytes = Math.round(value * 1024);
  },
});

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// A mime entry keeps its slash and wildcard; an extension is a bare token. One
// normaliser per list so a value typed as ".GCODE" or " Image/* " still lands
// in the shape the matcher expects.
const normaliseMime = (raw: string): string | null =>
  normaliseAttachmentRuleList([raw])[0] ?? null;

const normaliseExtension = (raw: string): string | null => {
  const value = normaliseAttachmentRuleList([raw])[0];
  // A slash means the user typed a mime type into the extensions field.
  return value && !value.includes('/') ? value : null;
};

const load = async (): Promise<void> => {
  loading.value = true;
  const response = await apiFetch(apiBase.value).catch(() => null);
  if (response?.ok) {
    const payload: {
      rules: AttachmentRules | null;
      defaults: AttachmentRules;
    } = await response.json();
    stored.value = payload.rules;
    draft.value = { ...(payload.rules ?? payload.defaults) };
  } else {
    toast.error(t('chat.attachmentSettings.loadError'));
  }
  loading.value = false;
};

const save = async (): Promise<void> => {
  saving.value = true;
  const response = await apiFetch(apiBase.value, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft.value),
  }).catch(() => null);
  saving.value = false;
  if (!response?.ok) {
    toast.error(t('chat.attachmentSettings.saveError'));
    return;
  }
  // The PUT echoes the SANITISED ruleset — the form must show what was really
  // stored (a clamped limit, a de-duplicated list), not what was typed.
  const saved: AttachmentRules = await response.json();
  stored.value = saved;
  draft.value = { ...saved };
  toast.success(t('chat.attachmentSettings.saved'));
};

// Dropping the row is how an owner goes back to the inherited ruleset — the
// same "deselect to inherit" gesture the connection list uses.
const reset = async (): Promise<void> => {
  saving.value = true;
  const response = await apiFetch(apiBase.value, { method: 'DELETE' }).catch(
    () => null,
  );
  saving.value = false;
  if (!response?.ok) {
    toast.error(t('chat.attachmentSettings.saveError'));
    return;
  }
  stored.value = null;
  draft.value = { ...DEFAULT_ATTACHMENT_RULES };
  toast.success(t('chat.attachmentSettings.reset'));
};

onMounted(load);
</script>

<template>
  <section class="space-y-4">
    <div class="flex items-start justify-between gap-4">
      <div class="space-y-1">
        <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {{ $t('chat.attachmentSettings.title') }}
        </h3>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{
            personal
              ? $t('chat.attachmentSettings.personalSubtitle')
              : $t('chat.attachmentSettings.instanceSubtitle')
          }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button
          v-if="!inherited"
          size="sm"
          variant="ghost"
          :icon-left="RotateCcw"
          :disabled="saving"
          @click="reset"
        >
          {{ $t('chat.attachmentSettings.reset') }}
        </Button>
        <Button
          size="sm"
          :icon-left="Save"
          :disabled="saving || loading"
          @click="save"
        >
          {{ $t('common.save') }}
        </Button>
      </div>
    </div>

    <div v-if="loading" class="flex justify-center py-8">
      <Spinner :label="$t('common.loading')" />
    </div>

    <div v-else class="glass-card rounded-2xl p-4 space-y-5">
      <p
        v-if="inherited"
        class="text-xs text-slate-500 dark:text-slate-400 rounded-xl bg-slate-50 dark:bg-white/5 px-3 py-2"
      >
        {{
          personal
            ? $t('chat.attachmentSettings.inheritedPersonal')
            : $t('chat.attachmentSettings.inheritedInstance')
        }}
      </p>

      <div class="space-y-2">
        <label
          for="chat-attachment-mimes"
          class="block text-xs font-medium text-slate-600 dark:text-slate-300"
        >
          {{ $t('chat.attachmentSettings.mimeTypes') }}
        </label>
        <TagInput
          v-model="draft.mimeTypes"
          input-id="chat-attachment-mimes"
          :placeholder="$t('chat.attachmentSettings.mimePlaceholder')"
          :add-label="$t('chat.attachmentSettings.add')"
          :remove-label="$t('chat.attachmentSettings.remove')"
          :normalise="normaliseMime"
          :disabled="saving"
        />
        <p class="text-xxs text-slate-400 dark:text-slate-500">
          {{ $t('chat.attachmentSettings.mimeHint') }}
        </p>
      </div>

      <div class="space-y-2">
        <label
          for="chat-attachment-extensions"
          class="block text-xs font-medium text-slate-600 dark:text-slate-300"
        >
          {{ $t('chat.attachmentSettings.extensions') }}
        </label>
        <TagInput
          v-model="draft.extensions"
          input-id="chat-attachment-extensions"
          :placeholder="$t('chat.attachmentSettings.extensionPlaceholder')"
          :add-label="$t('chat.attachmentSettings.add')"
          :remove-label="$t('chat.attachmentSettings.remove')"
          :normalise="normaliseExtension"
          :disabled="saving"
        />
        <p class="text-xxs text-slate-400 dark:text-slate-500">
          {{ $t('chat.attachmentSettings.extensionHint') }}
        </p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-2">
          <label
            for="chat-attachment-max-size"
            class="block text-xs font-medium text-slate-600 dark:text-slate-300"
          >
            {{ $t('chat.attachmentSettings.maxNonImage') }}
          </label>
          <input
            id="chat-attachment-max-size"
            v-model.number="maxNonImageMb"
            type="number"
            min="0.1"
            step="1"
            :disabled="saving"
            class="w-full glass-input rounded-xl px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          />
          <p class="text-xxs text-slate-400 dark:text-slate-500">
            {{ $t('chat.attachmentSettings.maxNonImageHint') }}
          </p>
        </div>

        <div class="space-y-2">
          <label
            for="chat-attachment-max-read"
            class="block text-xs font-medium text-slate-600 dark:text-slate-300"
          >
            {{ $t('chat.attachmentSettings.maxRead') }}
          </label>
          <input
            id="chat-attachment-max-read"
            v-model.number="maxReadKb"
            type="number"
            min="1"
            step="16"
            :disabled="saving"
            class="w-full glass-input rounded-xl px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          />
          <p class="text-xxs text-slate-400 dark:text-slate-500">
            {{ $t('chat.attachmentSettings.maxReadHint') }}
          </p>
        </div>
      </div>

      <p class="text-xxs text-slate-400 dark:text-slate-500">
        {{ $t('chat.attachmentSettings.footnote') }}
      </p>
    </div>
  </section>
</template>
