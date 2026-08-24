<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Bold,
  Italic,
  Heading3,
  List,
  ListOrdered,
  Link as LinkIcon,
  Eraser,
  Code,
} from '@lucide/vue';

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
}>();

const emit = defineEmits(['update:modelValue']);

const { t } = useI18n();
const editorRef = ref<HTMLDivElement | null>(null);

const execCommand = (command: string, value: string = '') => {
  document.execCommand(command, false, value);
  emitUpdate();
};

const createLink = () => {
  const url = prompt(t('common.enterUrl'), 'https://');
  if (url) {
    execCommand('createLink', url);
  }
};

const formatCode = () => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  const selectedText = range.toString();

  if (selectedText) {
    const codeElement = document.createElement('code');
    codeElement.className =
      'bg-slate-200 dark:bg-white/10 px-1.5 py-0.5 rounded font-mono text-xs text-brand-600 dark:text-brand-400';
    codeElement.innerText = selectedText;

    range.deleteContents();
    range.insertNode(codeElement);

    emitUpdate();
  }
};

const emitUpdate = () => {
  if (editorRef.value) {
    const html = editorRef.value.innerHTML;
    if (html === '<br>' || html === '<div><br></div>' || html === '') {
      emit('update:modelValue', '');
    } else {
      emit('update:modelValue', html);
    }
  }
};

const handleInput = () => {
  emitUpdate();
};

watch(
  () => props.modelValue,
  (newVal) => {
    if (editorRef.value && editorRef.value.innerHTML !== newVal) {
      editorRef.value.innerHTML = newVal || '';
    }
  },
);

onMounted(() => {
  if (editorRef.value) {
    editorRef.value.innerHTML = props.modelValue || '';
  }
});
</script>

<template>
  <div
    class="border border-slate-300 dark:border-white/10 rounded-xl overflow-hidden bg-white/40 dark:bg-dark-900/40 backdrop-blur-md focus-within:border-brand-500 transition-colors"
  >
    <!-- Toolbar -->
    <div
      class="flex flex-wrap gap-1 p-2 bg-slate-100/60 dark:bg-white/[0.02] border-b border-slate-200 dark:border-white/5 select-none"
    >
      <button
        type="button"
        @click="execCommand('bold')"
        class="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/5 transition-colors"
        :title="$t('common.bold')"
      >
        <Bold class="w-4 h-4" />
      </button>
      <button
        type="button"
        @click="execCommand('italic')"
        class="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/5 transition-colors"
        :title="$t('common.italic')"
      >
        <Italic class="w-4 h-4" />
      </button>
      <button
        type="button"
        @click="execCommand('formatBlock', '<h3>')"
        class="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/5 transition-colors"
        :title="$t('common.heading')"
      >
        <Heading3 class="w-4 h-4" />
      </button>
      <button
        type="button"
        @click="execCommand('insertUnorderedList')"
        class="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/5 transition-colors"
        :title="$t('common.bulletList')"
      >
        <List class="w-4 h-4" />
      </button>
      <button
        type="button"
        @click="execCommand('insertOrderedList')"
        class="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/5 transition-colors"
        :title="$t('common.orderedList')"
      >
        <ListOrdered class="w-4 h-4" />
      </button>
      <button
        type="button"
        @click="formatCode"
        class="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/5 transition-colors"
        :title="$t('common.code')"
      >
        <Code class="w-4 h-4" />
      </button>
      <button
        type="button"
        @click="createLink"
        class="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/5 transition-colors"
        :title="$t('common.insertLink')"
      >
        <LinkIcon class="w-4 h-4" />
      </button>
      <button
        type="button"
        @click="execCommand('removeFormat')"
        class="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/5 transition-colors ml-auto"
        :title="$t('common.clearFormat')"
      >
        <Eraser class="w-4 h-4" />
      </button>
    </div>

    <!-- Editable content area -->
    <div
      ref="editorRef"
      contenteditable="true"
      @input="handleInput"
      class="p-4 min-h-[120px] max-h-[300px] overflow-y-auto outline-none text-sm text-slate-800 dark:text-slate-200 prose prose-sm dark:prose-invert max-w-none focus:outline-none"
      :placeholder="placeholder"
    ></div>
  </div>
</template>

<style>
/* Style editable component placeholder when empty */
[contenteditable='true']:empty:before {
  content: attr(placeholder);
  color: #94a3b8;
  pointer-events: none;
  display: block;
}
.dark [contenteditable='true']:empty:before {
  color: #475569;
}

/* Custom styling inside editor */
.prose h3 {
  font-size: 1.1rem;
  font-weight: 700;
  margin-top: 0.75rem;
  margin-bottom: 0.5rem;
}
.prose ul {
  list-style-type: disc;
  padding-left: 1.25rem;
  margin-bottom: 0.5rem;
}
.prose ol {
  list-style-type: decimal;
  padding-left: 1.25rem;
  margin-bottom: 0.5rem;
}
.prose a {
  /* Accent-role colour — follows the active colour scheme (#236). The
     fallback triplet is the default brand-500, for hosts without themes.css
     (standalone SDK consumers). */
  color: rgb(var(--mk-brand-500, 59 130 246));
  text-decoration: underline;
}
</style>
