<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  Badge,
  Button,
  Disclosure,
  Modal,
  ObjectRefLink,
  resolveObjectRefRoute,
  useDateFormat,
  usePluginsStore,
} from '@makekeeper/frontend-core';
import type { NotificationView } from '@makekeeper/plugin-contract';
import { useNotifyStore } from './notify-store';

// The whole of one notification (#323).
//
// The list is a glance — a line of title, a line of body, a time — and a glance
// clips. What it clips is not decoration: which plugin is telling you, how many
// times it has repeated, what it points at. So the row opens, the same way a
// calendar entry does, rather than the list growing a second line for every
// fact somebody might want.
//
// Mounted OUTSIDE the bell's popover on purpose: the popover renders its
// content behind `v-if`, so a dialog opened from inside it would be destroyed
// the moment it closed — which it does, since opening this is a click away from
// the panel.
const props = defineProps<{ item: NotificationView | null }>();

const emit = defineEmits<{ (e: 'close'): void }>();

// Folded away and closed on every opening: which plugin sent it, what type it
// is, how often it repeated and when it was read are questions asked when
// something has gone wrong, not when reading a notification.
const advanced = ref(false);

watch(
  () => props.item,
  () => {
    advanced.value = false;
  },
);

const { t } = useI18n();
const router = useRouter();
const dates = useDateFormat();
const notify = useNotifyStore();
const plugins = usePluginsStore();

const title = computed<string>(() =>
  props.item ? t(props.item.titleKey, props.item.params ?? {}) : '',
);

const body = computed<string>(() =>
  props.item?.bodyKey ? t(props.item.bodyKey, props.item.params ?? {}) : '',
);

// Who is telling you. A plugin the registry no longer knows is named by its id
// — the one true thing left about it.
const source = computed<string>(() => {
  if (!props.item) return '';
  const manifest = plugins.byId[props.item.pluginId];
  return manifest ? t(manifest.nameKey) : props.item.pluginId;
});

const route = computed(() =>
  props.item?.ref ? resolveObjectRefRoute(props.item.ref) : null,
);

const importanceTone = computed<'neutral' | 'warning' | 'danger'>(() => {
  if (props.item?.importance === 'high') return 'danger';
  if (props.item?.importance === 'normal') return 'neutral';
  return 'neutral';
});

const openObject = async (): Promise<void> => {
  const target = route.value;
  const item = props.item;
  if (!target || !item) return;
  // Following it is also reading it, exactly as in the list.
  await notify.markRead(item.id);
  emit('close');
  await router.push(target);
};

const markRead = async (): Promise<void> => {
  if (props.item) await notify.markRead(props.item.id);
};

const remove = async (): Promise<void> => {
  if (!props.item) return;
  await notify.remove(props.item.id);
  emit('close');
};
</script>

<template>
  <Modal
    :model-value="item !== null"
    :title="t('notify.bell.details')"
    width="md"
    @update:model-value="emit('close')"
  >
    <div v-if="item" class="flex flex-col gap-5">
      <div class="flex flex-col gap-2">
        <p
          class="text-base font-medium text-slate-900 dark:text-white break-words"
        >
          {{ title }}
        </p>
        <p
          v-if="body"
          class="text-sm text-slate-600 dark:text-slate-300 break-words"
        >
          {{ body }}
        </p>
      </div>

      <dl class="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
        <dt class="text-slate-500 dark:text-slate-400">
          {{ t('notify.bell.arrived') }}
        </dt>
        <dd class="text-slate-900 dark:text-white">
          {{ dates.dateTime(item.createdAt) }}
        </dd>

        <template v-if="item.ref">
          <dt class="text-slate-500 dark:text-slate-400">
            {{ t('notify.bell.about') }}
          </dt>
          <dd>
            <!-- The object by its own name. A printed mk:// is protocol, not
                 information. -->
            <ObjectRefLink :ref-string="item.ref" />
          </dd>
        </template>
      </dl>

      <Disclosure
        v-model:open="advanced"
        :title="t('notify.bell.advanced')"
        content-id="notification-advanced"
        variant="inline"
      >
        <dl class="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm pt-2">
          <dt class="text-slate-500 dark:text-slate-400">
            {{ t('notify.bell.from') }}
          </dt>
          <dd class="flex flex-wrap items-center gap-2">
            <span class="text-slate-900 dark:text-white">{{ source }}</span>
            <Badge
              v-if="item.importance !== 'normal'"
              :tone="importanceTone"
              :uppercase="false"
            >
              {{ t(`notify.importance.${item.importance}`) }}
            </Badge>
          </dd>

          <template v-if="item.occurrences > 1">
            <dt class="text-slate-500 dark:text-slate-400">
              {{ t('notify.bell.repeated') }}
            </dt>
            <dd class="text-slate-900 dark:text-white">
              {{ t('notify.bell.repeats', { count: item.occurrences }) }}
            </dd>
          </template>

          <dt class="text-slate-500 dark:text-slate-400">
            {{ t('notify.bell.readAt') }}
          </dt>
          <dd class="text-slate-900 dark:text-white">
            {{
              item.readAt
                ? dates.dateTime(item.readAt)
                : t('notify.bell.unread')
            }}
          </dd>

          <dt class="text-slate-500 dark:text-slate-400">
            {{ t('notify.bell.kind') }}
          </dt>
          <dd
            class="font-mono text-xxs break-all text-slate-600 dark:text-slate-300"
          >
            {{ item.type }}
          </dd>

          <template v-if="item.ref">
            <dt class="text-slate-500 dark:text-slate-400">
              {{ t('notify.bell.reference') }}
            </dt>
            <dd
              class="font-mono text-xxs break-all text-slate-600 dark:text-slate-300"
            >
              {{ item.ref }}
            </dd>
          </template>
        </dl>
      </Disclosure>
    </div>

    <template #footer>
      <Button variant="ghost" @click="emit('close')">
        {{ t('notify.bell.close') }}
      </Button>
      <Button variant="dangerGhost" @click="remove">
        {{ t('notify.bell.remove') }}
      </Button>
      <Button v-if="item && !item.readAt" variant="secondary" @click="markRead">
        {{ t('notify.bell.markRead') }}
      </Button>
      <Button v-if="route" @click="openObject">
        {{ t('notify.bell.openObject') }}
      </Button>
    </template>
  </Modal>
</template>
