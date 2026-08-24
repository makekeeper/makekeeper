<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue';
import { ChevronDown, Check } from '@lucide/vue';

interface Option {
  value: any;
  label: string;
  // Hierarchy, both optional and only meaningful together. `depth` indents the
  // row so a flat list reads as the tree it came from; `parentValue` is what
  // lets the in-panel search keep a match's ancestors on screen — an indented
  // row with nothing above it looks like a top-level entry it is not.
  depth?: number;
  parentValue?: any;
  // "Nothing chosen" — the escape hatch, not a record. Rendered muted and ruled
  // off from the data below it, and shown muted in the trigger too.
  //
  // Without this the row is indistinguishable from a real entry, which is how
  // "Top level" in the category parent picker read as the NAME of a category.
  // Wording alone cannot carry that: an option list that renders an absence
  // exactly like a value is asking to be misread.
  empty?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: any;
    options: Option[];
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    triggerClass?: string;
    dropdownClass?: string;
    customTrigger?: boolean;
    align?: 'start' | 'end';
    // Identity and name for the TRIGGER, not the wrapper: a `<label for>` must
    // point at something labelable, and a listbox trigger with no accessible
    // name is unnamed to AT. Without these an `id` lands on the outer div,
    // where a label silently does nothing.
    id?: string;
    ariaLabel?: string;
    // Force the in-panel search on or off. Unset ⇒ shown for long lists.
    searchable?: boolean;
    // Combobox mode: the search field doubles as free text, and a value that
    // matches no option can still be chosen. This is what a suggestion field
    // needs — a native <datalist> is the only other way to get it, and that
    // renders a browser chrome dropdown no design system can touch.
    allowCustom?: boolean;
  }>(),
  {
    placeholder: '',
    disabled: false,
    required: false,
    triggerClass: '',
    dropdownClass: '',
    customTrigger: false,
    align: 'start',
    id: undefined,
    ariaLabel: undefined,
    searchable: undefined,
    allowCustom: false,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: any): void;
  (e: 'change', value: any): void;
  // The row under the pointer or the keyboard highlight, BEFORE it is chosen —
  // for a caller that can show what a choice would do (the header's scheme
  // picker repaints the app as the list is walked). `null` means "nothing is
  // being pointed at any more", which every close path emits: a preview that
  // outlives the panel is one nobody asked to keep.
  (e: 'highlight', option: Option | null): void;
}>();

const isOpen = ref(false);
const highlightedIndex = ref(-1);
const containerRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

const selectedOption = computed<Option | null>(() => {
  const known = props.options.find((opt) => opt.value === props.modelValue);
  if (known) return known;
  // In combobox mode the current value may be one nobody offered — it still has
  // to READ back, or the field looks empty right after the user typed into it.
  if (
    props.allowCustom &&
    typeof props.modelValue === 'string' &&
    props.modelValue !== ''
  ) {
    return { value: props.modelValue, label: props.modelValue };
  }
  return null;
});

// The panel is teleported to <body> and positioned `fixed` from the trigger's
// rect: an in-place `absolute` panel is clipped by ancestor scroll containers
// and painted over by later .glass-card siblings (backdrop-filter makes every
// card its own stacking context) — see issue #105.
// top/bottom and left/right are mutually exclusive pairs: exactly one of each
// pair is set per position pass, chosen by flip direction and `align`.
interface PanelStyle {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  width?: string;
}

const panelStyle = ref<PanelStyle>({});
const openUpward = ref(false);
const PANEL_GAP = 6;

const updatePosition = (): void => {
  const anchor = containerRef.value;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const panel = listRef.value;
  const panelHeight = panel?.offsetHeight ?? 0;
  const spaceBelow = window.innerHeight - rect.bottom - PANEL_GAP;
  // Flip only once the rendered height is measurable; until then assume below.
  // The pre-measure pass never paints: the post-patch nextTick re-measure (and
  // the flip it decides) runs in the same task, before the browser paints.
  openUpward.value =
    panelHeight > 0 &&
    spaceBelow < panelHeight &&
    rect.top - PANEL_GAP > spaceBelow;

  const style: PanelStyle = {};
  if (openUpward.value) {
    style.bottom = `${window.innerHeight - rect.top + PANEL_GAP}px`;
  } else {
    style.top = `${rect.bottom + PANEL_GAP}px`;
  }
  if (props.align === 'end') {
    style.right = `${window.innerWidth - rect.right}px`;
  } else {
    // Keep a wider-than-trigger panel (customTrigger + min-w) inside the viewport.
    const panelWidth = panel?.offsetWidth ?? rect.width;
    const maxLeft = window.innerWidth - panelWidth - PANEL_GAP;
    style.left = `${Math.max(PANEL_GAP, Math.min(rect.left, maxLeft))}px`;
  }
  if (!props.customTrigger) {
    style.width = `${rect.width}px`;
  }
  panelStyle.value = style;
};

// A long list is unusable without one, and choosing the threshold here rather
// than at every call site means every long select in the app gets it.
const SEARCH_FROM = 8;

const query = ref('');
const searchRef = ref<HTMLInputElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);

const hasHierarchy = computed(() =>
  props.options.some((option) => option.depth),
);

// Combobox mode always needs the field — it IS the text entry. A hierarchy gets
// it unconditionally too: scrolling a tree to find one branch is the thing the
// field exists to replace.
const searchable = computed(
  () =>
    props.searchable ??
    (props.allowCustom ||
      hasHierarchy.value ||
      props.options.length >= SEARCH_FROM),
);

// How an empty option READS. The dashes say "this is not a record" in a way
// styling cannot: they survive the closed trigger, a screen reader speaking the
// option aloud, and a copy-paste. They live HERE rather than in the translations
// because a decoration every locale has to remember is one half the locales will
// forget — which is exactly what happened in logistics, where two of the four
// "none" labels carry the dashes and two do not.
const optionLabel = (option: Option): string =>
  option.empty ? `— ${option.label} —` : option.label;

const optionText = (option: Option): string =>
  String(option.label ?? option.value).toLowerCase();

const matchingOptions = computed<Option[]>(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return props.options;
  const direct = props.options.filter((option) =>
    optionText(option).includes(needle),
  );
  // A flat list filters flat. Only a hierarchy needs the ancestor pass below.
  if (!hasHierarchy.value) return direct;

  const byValue = new Map(
    props.options.map((option) => [option.value, option]),
  );
  const childrenOf = new Map<unknown, Option[]>();
  for (const option of props.options) {
    if (option.parentValue === undefined || option.parentValue === null)
      continue;
    const siblings = childrenOf.get(option.parentValue) ?? [];
    siblings.push(option);
    childrenOf.set(option.parentValue, siblings);
  }

  const keep = new Set(direct.map((option) => option.value));
  for (const option of direct) {
    // Upwards: the branch a match sits in, so its indentation means something.
    let parent = option.parentValue;
    // `keep.has` also terminates a cycle, which a corrupt tree could hand us.
    while (parent !== undefined && parent !== null && !keep.has(parent)) {
      keep.add(parent);
      parent = byValue.get(parent)?.parentValue;
    }
    // Downwards: naming a branch is how you ask for everything under it.
    const queue = [...(childrenOf.get(option.value) ?? [])];
    while (queue.length) {
      const child = queue.shift();
      if (!child || keep.has(child.value)) continue;
      keep.add(child.value);
      queue.push(...(childrenOf.get(child.value) ?? []));
    }
  }
  return props.options.filter((option) => keep.has(option.value));
});

// The typed text offered as a value of its own, unless an option already says
// exactly that — otherwise the list shows the same string twice.
const customOption = computed<Option | null>(() => {
  const typed = query.value.trim();
  if (!props.allowCustom || typed === '') return null;
  const exists = props.options.some(
    (option) =>
      String(option.label ?? option.value).toLowerCase() ===
      typed.toLowerCase(),
  );
  return exists ? null : { value: typed, label: typed };
});

// What the panel shows. Everything else in this component — keyboard
// navigation, highlight, scroll — works off this list, not the full one, or
// the arrow keys would walk through rows nobody can see.
const visibleOptions = computed<Option[]>(() =>
  customOption.value
    ? [customOption.value, ...matchingOptions.value]
    : matchingOptions.value,
);

// A divider under the empty row, but only when there is data below it to
// separate from — a rule under the last line of a list looks like a bug.
const showsEmptyDivider = computed<boolean>(
  () =>
    visibleOptions.value.some((option) => option.empty) &&
    visibleOptions.value.some((option) => !option.empty),
);

// Typing rebuilds the list under the highlight; without this the marker keeps a
// row index that now means something else, and Enter chooses a surprise.
watch(query, () => {
  if (isOpen.value) highlightedIndex.value = 0;
});

// One source for `highlight`, rather than an emit at each of the pointer,
// keyboard and close paths — the closed panel must report `null` however it
// closed (Escape, outside click, focus leaving, or a row being chosen).
watch([highlightedIndex, isOpen], ([index, open]) => {
  const highlighted =
    open && index >= 0 ? visibleOptions.value[index] : undefined;
  emit('highlight', highlighted ?? null);
});

const toggleDropdown = () => {
  if (props.disabled) return;
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    query.value = '';
    const idx = props.options.findIndex(
      (opt) => opt.value === props.modelValue,
    );
    highlightedIndex.value = idx >= 0 ? idx : 0;
    updatePosition();
    nextTick(() => {
      updatePosition();
      // Combobox mode puts the caret straight in the field: the panel opened to
      // be typed into. Everywhere else the TRIGGER keeps focus (see the note by
      // `onFocusOut`) and forwards its keys to the search box.
      if (props.allowCustom) searchRef.value?.focus();
      else triggerRef.value?.focus();
      scrollToHighlighted();
    });
  }
};

const closeDropdown = () => {
  isOpen.value = false;
  highlightedIndex.value = -1;
};

const selectOption = (option: Option) => {
  emit('update:modelValue', option.value);
  emit('change', option.value);
  closeDropdown();
};

const handleKeydown = (e: KeyboardEvent) => {
  if (props.disabled) return;

  if (e.key === 'Escape') {
    closeDropdown();
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    if (!isOpen.value) {
      toggleDropdown();
    } else {
      highlightedIndex.value =
        (highlightedIndex.value + 1) % Math.max(1, visibleOptions.value.length);
      scrollToHighlighted();
    }
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    if (!isOpen.value) {
      toggleDropdown();
    } else {
      highlightedIndex.value =
        (highlightedIndex.value - 1 + visibleOptions.value.length) %
        Math.max(1, visibleOptions.value.length);
      scrollToHighlighted();
    }
    e.preventDefault();
  } else if (e.key === 'Enter' || (e.key === ' ' && !isTypingInSearch(e))) {
    if (!isOpen.value) {
      toggleDropdown();
    } else if (
      highlightedIndex.value >= 0 &&
      highlightedIndex.value < visibleOptions.value.length
    ) {
      selectOption(visibleOptions.value[highlightedIndex.value]);
    }
    e.preventDefault();
  }
};

const scrollToHighlighted = () => {
  nextTick(() => {
    if (!listRef.value) return;
    const items =
      listRef.value.querySelectorAll<HTMLElement>('[role="option"]');
    const activeItem = items[highlightedIndex.value];
    if (activeItem) {
      const list = listRef.value;
      const listHeight = list.clientHeight;
      const itemTop = activeItem.offsetTop;
      const itemHeight = activeItem.clientHeight;

      if (itemTop < list.scrollTop) {
        list.scrollTop = itemTop;
      } else if (itemTop + itemHeight > list.scrollTop + listHeight) {
        list.scrollTop = itemTop + itemHeight - listHeight;
      }
    }
  });
};

// One tab stop, and it is the BUTTON. The wrapper used to be focusable too, so
// tabbing away moved focus from the container to the trigger inside it and the
// control appeared to grab focus back and reopen instead of closing.
//
// (A comment above the root element would make this component a FRAGMENT —
// two root nodes — which quietly breaks anything that reaches for its root
// element. That is why this text lives here.)
//
// Rows are keyed by position as well as value: the option list comes from a
// caller, a repeated value is therefore possible, and duplicate keys make Vue
// reuse and duplicate DOM in ways that look like the data is wrong.
//
// A space typed into the search field is a space, not "choose this one".
const isTypingInSearch = (e: KeyboardEvent): boolean =>
  e.target instanceof HTMLInputElement;

// Focus left the control entirely — not merely moved between its trigger and
// its (teleported) panel.
const onFocusOut = (e: FocusEvent): void => {
  const next = e.relatedTarget;
  if (!(next instanceof Node)) {
    // Focus went nowhere in particular (a click on the page background); the
    // outside-click handler owns that case.
    return;
  }
  if (containerRef.value?.contains(next) || listRef.value?.contains(next)) {
    return;
  }
  closeDropdown();
};

const handleClickOutside = (e: MouseEvent) => {
  const target = e.target;
  if (!(target instanceof Node)) return;
  // The panel lives under <body>, outside containerRef — treat it as inside.
  if (containerRef.value?.contains(target) || listRef.value?.contains(target)) {
    return;
  }
  closeDropdown();
};

const detachPositionListeners = (): void => {
  window.removeEventListener('scroll', updatePosition, true);
  window.removeEventListener('resize', updatePosition);
};

// Capture-phase scroll catches scrolling ancestors (overflow-y-auto lists),
// which never bubble a scroll event to window.
watch(isOpen, (open) => {
  if (open) {
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    // Teleport anchors keep the order components MOUNTED in, not the order
    // surfaces OPENED in — so a panel opened from inside another popover (a
    // Select inside the avatar menu, #274) would render UNDER it, both being
    // z-popover. Recency decides instead: the panel physically moves to the
    // end of <body> on open. Vue unmounts it by reference, so the move is
    // invisible to the teleport's bookkeeping.
    void nextTick(() => {
      if (listRef.value) document.body.appendChild(listRef.value);
    });
  } else {
    detachPositionListeners();
  }
});

// Options arriving async while the panel is open change its height — the flip
// decision and clamp must follow the new size, not the one measured on open.
watch(
  () => props.options,
  () => {
    if (isOpen.value) updatePosition();
  },
  { flush: 'post' },
);

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  detachPositionListeners();
});
</script>

<template>
  <div
    ref="containerRef"
    class="relative select-none outline-none"
    tabindex="-1"
    @keydown="handleKeydown"
    @focusout="onFocusOut"
  >
    <!-- Select Trigger -->
    <button
      ref="triggerRef"
      :id="id"
      type="button"
      :disabled="disabled"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      @click="toggleDropdown"
      :class="[
        customTrigger
          ? 'flex items-center justify-between text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none'
          : 'w-full flex items-center justify-between text-left glass-input rounded-xl px-4 py-2.5 text-sm transition-all focus:outline-none focus:ring-3 focus:ring-brand-500/10 disabled:opacity-50 disabled:cursor-not-allowed',
        triggerClass,
        isOpen && !customTrigger
          ? 'border-brand-500/50 ring-3 ring-brand-500/15'
          : '',
      ]"
    >
      <!-- The trigger's CONTENT is overridable (the panel, keyboard handling
           and positioning are not): an icon-only control still needs this
           component's teleported panel and roving highlight, and forking one
           is how the header ends up with a dropdown that clips (#105). -->
      <slot name="trigger" :selected="selectedOption" :open="isOpen">
        <span
          class="truncate"
          :class="
            selectedOption && !selectedOption.empty
              ? 'text-slate-900 dark:text-slate-100'
              : 'text-slate-400 dark:text-slate-500'
          "
        >
          {{
            selectedOption
              ? optionLabel(selectedOption)
              : placeholder || $t('common.select')
          }}
        </span>
        <ChevronDown
          class="w-4 h-4 text-slate-400 dark:text-slate-500 transition-transform duration-200 shrink-0 ml-2"
          :class="{ 'rotate-180 text-brand-500': isOpen }"
        />
      </slot>
    </button>

    <!-- Select Dropdown List — teleported so no ancestor stacking context or
         scroll container can cover or clip it (issue #105) -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition ease-out duration-100"
        enter-from-class="transform opacity-0 scale-95"
        enter-to-class="transform opacity-100 scale-100"
        leave-active-class="transition ease-in duration-75"
        leave-from-class="transform opacity-100 scale-100"
        leave-to-class="transform opacity-0 scale-95"
      >
        <div
          v-if="isOpen"
          ref="listRef"
          class="fixed z-popover max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-dark-900/95 backdrop-blur-md p-1 shadow-lg shadow-black/5 dark:shadow-black/20 focus:outline-none"
          :class="[openUpward ? 'origin-bottom' : 'origin-top', dropdownClass]"
          :style="panelStyle"
          role="listbox"
        >
          <div
            v-if="searchable"
            class="sticky top-0 z-10 -m-1 mb-1 bg-white/95 p-1 dark:bg-dark-900/95"
          >
            <input
              ref="searchRef"
              v-model="query"
              type="text"
              class="glass-input w-full rounded-lg px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              :placeholder="$t('common.search')"
              :aria-label="$t('common.search')"
              @keydown.stop="handleKeydown"
            />
          </div>
          <p
            v-if="visibleOptions.length === 0"
            class="px-3 py-2 text-sm text-slate-500 dark:text-slate-400"
          >
            {{ $t('common.nothingFound') }}
          </p>
          <div
            v-for="(option, idx) in visibleOptions"
            :key="`${option.value}-${idx}`"
            role="option"
            :aria-selected="option.value === modelValue"
            @click="selectOption(option)"
            @mouseenter="highlightedIndex = idx"
            :style="
              option.depth
                ? { paddingLeft: `${0.75 + option.depth * 1}rem` }
                : undefined
            "
            class="flex items-center justify-between rounded-lg px-3 py-2 text-sm cursor-pointer select-none transition-colors"
            :class="[
              option.empty
                ? 'text-slate-500 dark:text-slate-400'
                : option.value === modelValue
                  ? 'bg-slate-100 dark:bg-white/5 font-semibold text-slate-900 dark:text-slate-100'
                  : 'text-slate-700 dark:text-slate-400',
              option.empty && showsEmptyDivider
                ? 'mb-1 rounded-b-none border-b border-slate-200 dark:border-white/10'
                : '',
              highlightedIndex === idx && option.value !== modelValue
                ? 'bg-slate-50 dark:bg-white/[0.02] text-slate-900 dark:text-slate-100'
                : '',
            ]"
          >
            <!-- A row may show more than its label (a colour swatch, a status
                 dot); the selected/highlighted styling, the check and the
                 "new" badge below stay the component's business. -->
            <slot
              name="option"
              :option="option"
              :selected="option.value === modelValue"
            >
              <span class="truncate">{{ optionLabel(option) }}</span>
            </slot>
            <!-- The typed value is a row like any other, but it has to say that
                 it is NEW, or it reads as an existing entry that was there all
                 along. -->
            <span
              v-if="customOption && idx === 0"
              class="shrink-0 ml-2 text-xxs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400"
            >
              {{ $t('common.addNew') }}
            </span>
            <Check
              v-if="option.value === modelValue"
              class="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0 ml-2"
            />
          </div>
          <div
            v-if="options.length === 0"
            class="text-xs text-slate-400 dark:text-slate-500 py-3 text-center"
          >
            {{ $t('common.noOptions') }}
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
