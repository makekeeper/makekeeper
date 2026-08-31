<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowRight } from '@lucide/vue';
import { apiJson } from '../api';
import { resolveObjectRefRoute } from '../registry';

// An `mk://` reference, rendered as what it points AT (#323).
//
// A reference printed verbatim is protocol, not information: nobody reads
// `mk://projects/project/demo_pr_lamp` and learns which project it is. The core
// resolves it to the object's own name through the registry of resolvers each
// plugin registers, and this renders a link when the object has a page.
//
// Degrades in the only two ways it can: an object that is gone (or not this
// caller's to see) shows its name as plain text, and a plugin with no route for
// that type shows the name without a link.
const props = defineProps<{
  refString: string;
  // Shown while nothing better is known, and if the lookup fails: usually the
  // title the caller is already displaying.
  fallback?: string;
}>();

const { t } = useI18n();

interface ResolvedRef {
  ref: string;
  exists: boolean;
  displayName: string;
  breadcrumb?: string;
}

// Never the ref itself. A caller with no better name still must not be handed
// `mk://…` to read (§5.9) — not on the first frame, and not when the lookup
// fails. The stand-in says only what is certainly true, that something is
// linked here: a name is missing, which is not the same as the object being
// unknown or gone, and it reads correctly both as a link's label and as the
// plain text the no-route branch renders.
const placeholder = (): string => props.fallback ?? t('common.linkedObject');

const name = ref<string>(placeholder());
const breadcrumb = ref<string>('');
const route = ref(resolveObjectRefRoute(props.refString));

const load = async (): Promise<void> => {
  route.value = resolveObjectRefRoute(props.refString);
  name.value = placeholder();
  breadcrumb.value = '';
  try {
    const resolved = await apiJson<ResolvedRef>(
      `/api/refs/resolve?ref=${encodeURIComponent(props.refString)}`,
    );
    // `displayName` falls back to the ref itself server-side, which is worse
    // than the caller's own fallback — so it is only taken when it says
    // something.
    if (resolved.displayName && resolved.displayName !== props.refString) {
      name.value = resolved.displayName;
    }
    breadcrumb.value = resolved.breadcrumb ?? '';
  } catch {
    // Keep the fallback: a name that failed to load is not a reason to print
    // protocol at somebody.
  }
};

onMounted(load);
watch(() => props.refString, load);
</script>

<template>
  <RouterLink
    v-if="route"
    :to="route"
    class="inline-flex items-baseline gap-1 text-sm text-brand-600 dark:text-brand-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
  >
    <span class="break-words">{{ name }}</span>
    <!-- An arrow, not `ExternalLink`: the box-with-an-arrow-out means "leaves
         the app / opens a tab", and this goes to a route inside it. -->
    <ArrowRight class="w-3 h-3 shrink-0 self-center" aria-hidden="true" />
    <span v-if="breadcrumb" class="text-xs text-slate-500 dark:text-slate-400">
      {{ breadcrumb }}
    </span>
  </RouterLink>
  <span v-else class="text-sm text-slate-600 dark:text-slate-300 break-words">
    {{ name }}
    <span v-if="breadcrumb" class="text-xs text-slate-500 dark:text-slate-400">
      {{ breadcrumb }}
    </span>
  </span>
</template>
