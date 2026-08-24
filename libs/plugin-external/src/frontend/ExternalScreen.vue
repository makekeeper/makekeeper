<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import {
  Button,
  PageHeader,
  Spinner,
  resolveObjectRefRoute,
  useRealtime,
  useToastStore,
} from '@makekeeper/frontend-core';
import {
  DATA_CHANGED_EVENT,
  type DataChangedRealtimePayload,
  type UiAction,
  type UiNode,
  type UiScreen,
} from '@makekeeper/plugin-contract';
import {
  externalI18nKey,
  type ExternalRenderFailureCode,
} from '../external-types';
import { renderExternalScreen, runExternalAction } from './external-data';
import UiNodes from './UiNodes.vue';

// Host for ONE external screen (#134). Three responsibilities: fetch the tree,
// own the form state across re-renders, and turn a miss into the right
// degradation for this surface.
//
// `surface` drives the degradation contract (decision #8):
//   screen — the user navigated here: skeleton, then a NAMED error card;
//   widget/slot — a guest on someone else's page: on a miss it renders
//   nothing at all, exactly like a contribution from a disabled plugin.

const props = withDefaults(
  defineProps<{
    pluginId: string;
    screen: string;
    // Static params (a widget/slot host passes context here); route params are
    // merged on top for a routed screen.
    params?: Record<string, string>;
    surface?: 'screen' | 'widget' | 'slot';
    // Routed screens render their own PageHeader from the returned title.
    withHeader?: boolean;
  }>(),
  {
    params: () => ({}),
    surface: 'screen',
    withHeader: false,
  },
);

const emit = defineEmits<{ (e: 'empty', value: boolean): void }>();

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const toast = useToastStore();

const loading = ref(true);
// `tree`, not `screen`: the prop of that name is the screen KEY we render.
const tree = ref<UiScreen | null>(null);
const failure = ref<ExternalRenderFailureCode | null>(null);
// An action or a redraw is in flight. The tree stays on screen — replacing it
// with a spinner would throw away what the user is reading and typing — but
// every control that could start a second round trip is disabled.
const busy = ref(false);
const formValues = ref<Record<string, string | number | boolean>>({});

// A form submits WHAT IT SHOWS, not only what was touched.
//
// The bag used to start empty and collect changes, so a field the plugin had
// filled in — a suggested value, a value read back from storage — submitted as
// absent, and the plugin's own "keep what I had" fallback quietly discarded
// it. Seeding from the rendered tree makes the visible form and the submitted
// form the same thing. The plugin is the authority on every redraw: it
// receives the current values and decides what to echo back.
const seedFormValues = (
  nodes: UiNode[],
  previous: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> => {
  const seeded: Record<string, string | number | boolean> = {};
  const walk = (list: UiNode[]): void => {
    for (const node of list) {
      if (node.type === 'form') {
        for (const field of node.fields) {
          // A password is never rendered back — by design, so a plugin CANNOT
          // echo it. What the user typed therefore survives a redraw here, or
          // picking a value elsewhere on the screen would silently empty it.
          // Untouched, it seeds empty, which is the "keep the stored secret"
          // submission.
          seeded[field.name] =
            field.type === 'password'
              ? (previous[field.name] ?? '')
              : (field.value ?? '');
        }
      } else if (node.type === 'section') {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return seeded;
};

// Has the user touched anything since this tree arrived? A plugin's own
// invalidation must not wipe half-typed input, so a dirty screen keeps what it
// has and picks the change up on its next render.
const dirty = ref(false);

const adoptTree = (screen: UiScreen): void => {
  tree.value = screen;
  formValues.value = seedFormValues(screen.children, formValues.value);
  dirty.value = false;
};

const title = (): string =>
  tree.value
    ? t(
        externalI18nKey(props.pluginId, tree.value.title.key),
        tree.value.title.params ?? {},
      )
    : '';

// A re-render requested by a `reloadOnChange` field carries what the user has
// typed so far; a first load carries nothing.
const load = async (withForm = false): Promise<void> => {
  loading.value = true;
  if (withForm) busy.value = true;
  failure.value = null;
  const params: Record<string, string> = { ...props.params };
  // A routed external screen gets its route params (e.g. an entity id from an
  // ORef link) without the plugin needing to know about vue-router.
  for (const [key, value] of Object.entries(route.params)) {
    if (typeof value === 'string') params[key] = value;
  }
  const res = await renderExternalScreen(
    props.pluginId,
    props.screen,
    params,
    props.surface,
    withForm ? formValues.value : undefined,
  );
  if (res.ok) {
    adoptTree(res.screen);
    failure.value = null;
  } else {
    tree.value = null;
    failure.value = res.failure;
  }
  loading.value = false;
  busy.value = false;
  emit('empty', !res.ok);
};

watch(
  () => [props.pluginId, props.screen, route.fullPath],
  () => {
    void load();
  },
  { immediate: true },
);

const onField = (name: string, value: string | number | boolean): void => {
  formValues.value = { ...formValues.value, [name]: value };
  dirty.value = true;
};

// The plugin says its screen is stale (`POST /api/external/notify-changed`),
// the core relays it into this scope's room, and this is the half that was
// missing: without it a plugin could announce a change all it liked and the
// open screen sat there until someone reloaded the page. Which is exactly how
// it looked after linking a Telegram chat.
useRealtime().on(DATA_CHANGED_EVENT, (payload) => {
  const ids = (payload as DataChangedRealtimePayload | undefined)?.pluginIds;
  if (!Array.isArray(ids) || !ids.includes(props.pluginId)) return;
  if (busy.value || dirty.value) return;
  void load();
});

const onAction = async (
  action: UiAction,
  form?: Record<string, string | number | boolean>,
): Promise<void> => {
  if (busy.value) return;
  busy.value = true;
  const res = await runExternalAction(
    props.pluginId,
    props.screen,
    action.action,
    action.params ?? {},
    form,
  ).finally(() => {
    busy.value = false;
  });
  if (res.ok === false) {
    toast.error(t('external.render.actionFailed'));
    return;
  }
  if ('screen' in res && res.screen) {
    adoptTree(res.screen);
    return;
  }
  if (!('commands' in res)) return;
  for (const command of res.commands) {
    if (command.command === 'toast') {
      const message = t(
        externalI18nKey(props.pluginId, command.text.key),
        command.text.params ?? {},
      );
      if (command.tone === 'success') toast.success(message);
      else toast.error(message);
    } else if (command.command === 'refresh') {
      if (command.toast) {
        const message = t(
          externalI18nKey(props.pluginId, command.toast.text.key),
          command.toast.text.params ?? {},
        );
        if (command.toast.tone === 'success') toast.success(message);
        else toast.error(message);
      }
      await load();
    } else if (command.command === 'navigate') {
      const target = command.ref
        ? resolveObjectRefRoute(command.ref)
        : command.screen
          ? {
              path: `/x/${props.pluginId}/${command.screen}`,
              query: command.params,
            }
          : null;
      if (target) await router.push(target);
    }
  }
};
</script>

<template>
  <!-- Guest surfaces vanish silently on a miss; only the plugin's own screen
       explains itself. -->
  <div v-if="surface !== 'screen' && (failure || (loading && !tree))" />

  <div v-else class="space-y-4">
    <PageHeader v-if="withHeader && tree" :title="title()" />

    <div v-if="loading && !tree" class="flex justify-center py-12">
      <Spinner />
    </div>

    <div
      v-else-if="failure"
      class="rounded-2xl border border-slate-200 bg-white p-6 text-center dark:border-white/10 dark:bg-white/5"
    >
      <p class="text-sm text-slate-600 dark:text-slate-300">
        {{
          t(
            failure === 'timeout'
              ? 'external.render.timeout'
              : failure === 'unavailable'
                ? 'external.render.unavailable'
                : failure === 'unauthorized'
                  ? 'external.render.unauthorized'
                  : 'external.render.failed',
            { plugin: pluginId },
          )
        }}
      </p>
      <Button class="mt-3" variant="secondary" @click="() => load()">
        {{ t('external.render.retry') }}
      </Button>
    </div>

    <UiNodes
      v-else-if="tree"
      :plugin-id="pluginId"
      :nodes="tree.children"
      :form-values="formValues"
      :busy="busy"
      @action="onAction"
      @params="onParams"
      @field="onField"
      @reload="load(true)"
    />
  </div>
</template>
