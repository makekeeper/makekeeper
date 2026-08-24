<script setup lang="ts">
import { computed } from 'vue';
import { ShieldCheck, Trash2 } from '@lucide/vue';
import Button from './Button.vue';
import type { SecretAction } from '../secret-field';

// The one input for a value the server stores but never returns — a deploy-hook
// URL and token, a tracking API key, a provider key, a saved password.
//
// The field it replaces was, everywhere, an ordinary empty box: identical
// whether a value was stored or none ever had been, so an admin reopening the
// page read their saved settings as lost (#270). Three plugins had each patched
// that over differently — a placeholder swap, a muted hint line, a masked row —
// which is the drift this primitive ends.
//
// A stored value is therefore never rendered as an empty box. It is shown as
// itself: a shielded, read-only field carrying a redacted `preview` (or dots
// when the server offers none), with the actions that can change it beside it.
// Keeping a real `<input>` in every state is what lets the caller's `<label
// for>` stay attached — a mask built from a `<div>`, as the chat panel had it,
// silently unlabels the field for assistive tech and reflows the row when the
// admin switches between states.
//
// `action` is a required model rather than internal state: the caller cannot
// build its payload without it (`secretPatch`), and #220 established that
// "blank means keep" alone leaves a stored secret impossible to drop.
const props = withDefaults(
  defineProps<{
    // What the admin has typed. Meaningful only while replacing.
    modelValue: string;
    // The admin's intent for the stored value. Reset to `keep` after a save.
    action: SecretAction;
    // Whether the server currently holds a value for this field.
    stored: boolean;
    // Redacted stand-in for the stored value, when the backend can offer one
    // safely (`https://deploy.example.com/…`). Dots are used without it.
    preview?: string | null;
    // Offer dropping the stored value. Only for fields whose owner can work
    // without one — a required credential must be replaced, not emptied (#220).
    removable?: boolean;
    // Associates the caller's `<label for>`. Required for that reason whenever
    // a visible label exists.
    id?: string;
    // The editing input's type. The masked state is always plain text: it shows
    // dots or a redacted preview, never a value a password field could leak.
    type?: 'password' | 'text' | 'url';
    placeholder?: string;
    autocomplete?: string;
    // Render the value in the mono stack (API keys, tokens read as characters).
    mono?: boolean;
    disabled?: boolean;
  }>(),
  {
    preview: null,
    removable: false,
    id: undefined,
    type: 'password',
    placeholder: undefined,
    autocomplete: 'off',
    mono: false,
    disabled: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:action': [action: SecretAction];
}>();

// The mode is a pure function of the props — deliberately. An earlier version
// kept an internal "the box is open" flag and watchers that inferred the intent
// from the box's content; the watcher and the caller then raced over `action`
// every time a save reset the form, and the field would announce a removal the
// admin never staged. A fully controlled component cannot fight its caller.
//
// Nothing stored means nothing to keep or drop, whatever the caller's `action`
// says while its form is still loading — the field is simply editable.
type SecretMode = 'masked' | 'removing' | 'editing';

const mode = computed<SecretMode>(() => {
  if (!props.stored) return 'editing';
  if (props.action === 'remove') return 'removing';
  return props.action === 'keep' ? 'masked' : 'editing';
});

const readOnly = computed<boolean>(() => mode.value !== 'editing');

// Dots stand in for a value with no safe preview. They are decoration, not a
// value: the accessible name comes from the caller's label and the caption.
const maskedValue = computed<string>(() => props.preview ?? '••••••••');

// What saving an EMPTY open box will do. This is stated up front rather than
// enforced through `action` gymnastics: `secretPatch` reads `replace` + empty
// as "clear it" where the caller allows clearing (`emptyClears`), and as "no
// change" where it does not — silently keeping the stored value while
// reporting a successful save is the bug this field exists to end (#270).
const emptyOutcomeKey = computed<string | null>(() => {
  if (mode.value !== 'editing' || !props.stored) return null;
  if (props.modelValue.trim() !== '') return null;
  return props.removable
    ? 'common.secret.emptyRemoves'
    : 'common.secret.keepsSaved';
});

// Which glyph the box wears, if any — and ONLY a box that is not being typed
// into wears one. The glyph describes a settled value: the shield for one that
// is staying, the trash for one already struck through and on its way out. An
// open box is where the admin is working, and a red trash greeting them the
// instant they press "Change" reads as "this deletes" when what they pressed
// was "edit". What saving an empty box will do is the caption's job.
const staged = computed<'keep' | 'remove' | null>(() => {
  if (!readOnly.value) return null;
  return props.action === 'remove' ? 'remove' : 'keep';
});

const captionKey = computed<string | null>(() => {
  if (mode.value === 'masked') return 'common.secret.stored';
  if (mode.value === 'removing') return 'common.secret.willBeRemoved';
  return emptyOutcomeKey.value;
});

// The caption warning that an empty box clears the value is a warning, not an
// error and not a staged removal — amber, where the struck-through row is red.
const captionTone = computed<'danger' | 'warn' | 'muted'>(() => {
  if (mode.value === 'removing') return 'danger';
  if (emptyOutcomeKey.value === 'common.secret.emptyRemoves') return 'warn';
  return 'muted';
});

function onInput(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  emit('update:modelValue', target.value);
  // Typing is the intent to replace. On a fresh field the caller's initial
  // `keep` would otherwise make `secretPatch` drop what was typed.
  if (props.action !== 'replace') emit('update:action', 'replace');
}

// Each action clears whatever was typed: an abandoned half-typed secret must
// never survive into a payload built from a different intent.
function choose(action: SecretAction): void {
  emit('update:action', action);
  emit('update:modelValue', '');
}
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex gap-2">
      <div class="relative min-w-0 flex-1">
        <!-- The glyph follows the intent, not the readonly-ness: an emptied box
             staged for removal keeps its red trash while it is still a box. -->
        <component
          :is="staged === 'remove' ? Trash2 : ShieldCheck"
          v-if="staged"
          class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
          :class="
            staged === 'remove'
              ? 'text-red-500 dark:text-red-400'
              : 'text-emerald-500 dark:text-emerald-400'
          "
          aria-hidden="true"
        />
        <input
          :id="id"
          :value="readOnly ? maskedValue : modelValue"
          :type="readOnly ? 'text' : type"
          :readonly="readOnly"
          :disabled="disabled"
          :placeholder="readOnly ? undefined : placeholder"
          :autocomplete="autocomplete"
          class="glass-input w-full rounded-xl py-2.5 text-sm"
          :class="[
            staged ? 'pl-10 pr-4' : 'px-4',
            mono ? 'font-mono' : '',
            mode === 'removing'
              ? 'text-slate-400 line-through dark:text-slate-500'
              : '',
            readOnly ? 'text-slate-600 dark:text-slate-300' : '',
          ]"
          @input="onInput"
        />
      </div>

      <Button
        v-if="mode === 'masked'"
        variant="secondary"
        :disabled="disabled"
        @click="choose('replace')"
      >
        {{ $t('common.secret.change') }}
      </Button>
      <Button
        v-if="mode === 'masked' && removable"
        variant="dangerGhost"
        size="icon"
        :aria-label="$t('common.secret.remove')"
        :icon-left="Trash2"
        :disabled="disabled"
        @click="choose('remove')"
      />
      <Button
        v-if="mode === 'removing'"
        variant="secondary"
        :disabled="disabled"
        @click="choose('keep')"
      >
        {{ $t('common.secret.keep') }}
      </Button>

      <!-- A caller's own control for the same field (logistics tests the key it
           is holding) — beside the input rather than under it. -->
      <slot name="actions" />
    </div>

    <!-- The caption states what saving will do; the undo sits beside it rather
         than replacing it, because the state that most needs explaining — an
         emptied box — is exactly the one where undo must stay reachable. -->
    <div
      v-if="captionKey || (stored && mode === 'editing')"
      class="flex flex-wrap items-baseline gap-x-2 gap-y-1"
    >
      <p
        v-if="captionKey"
        class="text-xxs leading-relaxed"
        :class="{
          'text-red-600 dark:text-red-400': captionTone === 'danger',
          'text-amber-600 dark:text-amber-400': captionTone === 'warn',
          'text-slate-500 dark:text-slate-400': captionTone === 'muted',
        }"
      >
        {{ $t(captionKey) }}
      </p>
      <button
        v-if="stored && mode === 'editing'"
        type="button"
        class="rounded text-xxs font-medium text-brand-600 underline decoration-dotted underline-offset-2 hover:decoration-solid focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-400"
        @click="choose('keep')"
      >
        {{ $t('common.secret.keep') }}
      </button>
    </div>
  </div>
</template>
