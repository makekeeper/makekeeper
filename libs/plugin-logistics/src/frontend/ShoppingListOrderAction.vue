<script setup lang="ts">
// "Create order" action on the project shopping list, contributed by
// logistics into the projects plugin (#58): hands the deficit off to the
// order form, which parses ?items= and pre-fills the lines; ?projectId=
// links the order back to the project. Exists only while logistics is enabled.
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Truck } from '@lucide/vue';

const props = defineProps<{
  projectId: string;
  items: { componentId: string; quantity: number }[];
}>();

const router = useRouter();
const { t } = useI18n();

const createOrder = (): void => {
  router.push({
    path: '/logistics/new',
    query: {
      items: JSON.stringify(props.items),
      projectId: props.projectId,
    },
  });
};
</script>

<template>
  <button
    type="button"
    class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 text-xxs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
    @click="createOrder"
  >
    <Truck class="w-3.5 h-3.5" />
    {{ t('projectDetail.shopping.order') }}
  </button>
</template>
