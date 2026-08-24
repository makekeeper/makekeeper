<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown, RefreshCw, Trash2 } from '@lucide/vue';
import {
  Badge,
  Button,
  CopyField,
  Switch,
  useToastStore,
} from '@makekeeper/frontend-core';
import { useExternalAdmin, type AdminPlugin } from './external-admin';
import ExternalScreen from './ExternalScreen.vue';

// One installed (or pending) external plugin, as a card: the strip carries
// name, status and the controls that are safe without reading anything; the
// body carries the address, the permissions, the assistant consent and the
// plugin's own settings screen.
const props = defineProps<{ plugin: AdminPlugin }>();
const emit = defineEmits<{ (e: 'uninstall', plugin: AdminPlugin): void }>();

const { t } = useI18n();
const toast = useToastStore();
const admin = useExternalAdmin();

// A card that needs a DECISION opens itself — you cannot consent to
// permissions you cannot see, so a pending install and a parked update are
// never hidden behind a chevron.
const needsDecision = computed<boolean>(
  () => props.plugin.status === 'pending' || props.plugin.pending !== null,
);

// Collapsed is the default: an admin looking at the list is usually after one
// plugin, and full cards of permissions and consent turn that into a scroll.
const expanded = ref(false);
const isOpen = computed<boolean>(() => needsDecision.value || expanded.value);

const toggleCard = (): void => {
  if (needsDecision.value) return;
  expanded.value = !expanded.value;
};

// The plugin's settings screen is rendered by its own container, so opening it
// is a network round trip — collapsed until asked for.
const settingsOpen = ref(false);
const settingsScreen = computed<string | null>(() =>
  props.plugin.status === 'active'
    ? (props.plugin.manifest.settingsScreen ?? null)
    : null,
);

// The address a client outside the browser is pointed at. A public plugin is
// served under the instance's own origin (the nginx `/plugins/` face), so the
// origin the admin is looking at IS the address — no backend round-trip and
// no guess about which of several hostnames the instance answers on.
const publicUrl = computed<string | null>(() =>
  props.plugin.status === 'active' &&
  (props.plugin.manifest.publicPaths ?? []).length > 0
    ? `${window.location.origin}/plugins/${props.plugin.pluginId}`
    : null,
);

const publicHint = computed<string | null>(() =>
  props.plugin.manifest.publicHintKey
    ? admin.manifestText(
        props.plugin.manifest,
        props.plugin.manifest.publicHintKey,
      )
    : null,
);

const busy = computed<boolean>(
  () => admin.busy.value === props.plugin.pluginId,
);

const onAddressCopied = (): void => {
  toast.success(t('external.card.addressCopied'));
};
</script>

<template>
  <article
    class="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/5"
  >
    <div class="flex flex-wrap items-center gap-3">
      <!-- The whole strip is the disclosure: name, status and the controls
           that do not need details to be safe. A plugin awaiting a
           decision has no chevron — it is already open and stays so. -->
      <button
        v-if="!needsDecision"
        type="button"
        class="flex min-w-0 items-center gap-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        :aria-expanded="isOpen"
        :aria-controls="`external-card-${plugin.pluginId}`"
        @click="toggleCard"
      >
        <ChevronDown
          class="h-4 w-4 shrink-0 text-slate-400 transition-transform dark:text-slate-500"
          :class="isOpen ? 'rotate-180' : ''"
          aria-hidden="true"
        />
        <component
          :is="admin.iconOf(plugin.manifest)"
          class="h-4 w-4 shrink-0 text-brand-500"
          aria-hidden="true"
        />
        <span
          class="truncate text-base font-semibold text-slate-900 dark:text-white"
        >
          {{ admin.pluginName(plugin.manifest) }}
        </span>
      </button>
      <h3
        v-else
        class="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white"
      >
        <component
          :is="admin.iconOf(plugin.manifest)"
          class="h-4 w-4 shrink-0 text-brand-500"
          aria-hidden="true"
        />
        {{ admin.pluginName(plugin.manifest) }}
      </h3>
      <Badge :tone="admin.statusTone(plugin.status)">
        {{ t(`external.status.${plugin.status}`) }}
      </Badge>
      <!-- Joining the assistant is a SEPARATE consent, default off (#137),
           and an admin who does not know that reads "the assistant cannot
           see my plugin" as a broken plugin. Said on the strip, where the
           question is asked. -->
      <Badge
        v-if="
          plugin.status === 'active' && (plugin.manifest.tools ?? []).length > 0
        "
        :tone="plugin.assistantEnabled ? 'brand' : 'neutral'"
      >
        {{
          t(
            plugin.assistantEnabled
              ? 'external.card.assistantOn'
              : 'external.card.assistantOff',
          )
        }}
      </Badge>
      <span v-if="isOpen" class="text-xs text-slate-500 dark:text-slate-400">
        {{ t('external.card.version') }} {{ plugin.version }} ·
        {{ t('external.card.contract') }} {{ plugin.contract.major }}.{{
          plugin.contract.minor
        }}
        ·
        {{ t(`external.scopeModel.${plugin.manifest.scopeModel}`) }}
      </span>
      <div class="ml-auto flex items-center gap-2">
        <template v-if="plugin.status === 'pending'">
          <Button :disabled="busy" @click="admin.approve(plugin)">
            {{ t('external.actions.approve') }}
          </Button>
          <Button
            variant="danger"
            :disabled="busy"
            @click="admin.reject(plugin)"
          >
            {{ t('external.actions.reject') }}
          </Button>
        </template>
        <template v-else>
          <Switch
            :model-value="plugin.status === 'active'"
            :disabled="busy"
            :aria-label="
              t(
                plugin.status === 'active'
                  ? 'external.actions.disable'
                  : 'external.actions.enable',
              )
            "
            @update:model-value="(v: boolean) => admin.setEnabled(plugin, v)"
          />
          <Button
            size="icon-sm"
            variant="dangerGhost"
            :disabled="busy"
            :aria-label="t('external.actions.uninstall')"
            @click="emit('uninstall', plugin)"
          >
            <Trash2 class="h-4 w-4" aria-hidden="true" />
          </Button>
        </template>
      </div>
    </div>

    <div v-if="isOpen" :id="`external-card-${plugin.pluginId}`">
      <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {{ t('external.card.baseUrl') }}: {{ plugin.baseUrl }}
      </p>

      <!-- A plugin with a public surface is something an outside client is
           configured with; the address, and the plugin's own one-liner on
           what to do with it, belong where the admin is already standing. -->
      <div v-if="publicUrl" class="mt-3">
        <h4
          class="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500"
        >
          {{ t('external.card.publicUrl') }}
        </h4>
        <CopyField
          class="mt-1"
          :value="publicUrl"
          :aria-label="t('external.card.publicUrl')"
          @copied="onAddressCopied"
        />
        <p
          v-if="publicHint"
          class="mt-1 text-xs text-slate-600 dark:text-slate-300"
        >
          {{ publicHint }}
        </p>
      </div>

      <!-- Permissions: requested (pending install) or granted (installed). -->
      <div class="mt-3">
        <h4
          class="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500"
        >
          {{ t('external.card.permissions') }}
        </h4>
        <ul
          v-if="
            (plugin.status === 'pending'
              ? plugin.manifest.permissions
              : plugin.grants
            ).length > 0
          "
          class="mt-1 space-y-1"
        >
          <li
            v-for="perm in plugin.status === 'pending'
              ? plugin.manifest.permissions
              : plugin.grants"
            :key="perm"
            class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"
          >
            <Badge v-if="admin.isElevated(perm)" tone="warning">
              {{ admin.permissionLabel(perm) }}
            </Badge>
            <span v-else>{{ admin.permissionLabel(perm) }}</span>
          </li>
        </ul>
        <p v-else class="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {{ t('external.card.noPermissions') }}
        </p>
      </div>

      <!-- Assistant consent, offered only for a plugin that declares tools
           AND is running. A switch reading "on" under a disabled plugin
           describes a permission nothing can use: the tools are
           unregistered the moment the plugin goes off. -->
      <div
        v-if="
          plugin.status === 'active' && (plugin.manifest.tools ?? []).length > 0
        "
        class="mt-4 flex flex-wrap items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5"
      >
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-slate-900 dark:text-white">
            {{ t('external.card.assistant') }}
          </p>
          <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {{ t('external.card.assistantHint') }}
          </p>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {{ t('external.card.assistantTools') }}:
            {{
              (plugin.manifest.tools ?? []).map((tool) => tool.name).join(', ')
            }}
          </p>
        </div>
        <Switch
          :model-value="plugin.assistantEnabled"
          :disabled="busy"
          :aria-label="t('external.card.assistant')"
          @update:model-value="(v: boolean) => admin.setAssistant(plugin, v)"
        />
      </div>

      <!-- What a disabled plugin has instead of its settings: nothing to
           configure and nothing pretending to be configured. -->
      <p
        v-if="plugin.status === 'disabled'"
        class="mt-4 rounded-xl border border-slate-200 p-4 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400"
      >
        {{ t('external.card.disabledNoSettings') }}
      </p>

      <!-- The plugin's own settings screen, rendered by its container and
           expanded on demand. Only an ACTIVE plugin gets one: a disabled or
           pending container is not asked to render anything. -->
      <div
        v-if="settingsScreen"
        class="mt-4 rounded-xl border border-slate-200 dark:border-white/10"
      >
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-sm font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-white"
          :aria-expanded="settingsOpen"
          :aria-controls="`external-settings-${plugin.pluginId}`"
          @click="settingsOpen = !settingsOpen"
        >
          <ChevronDown
            class="h-4 w-4 transition-transform"
            :class="settingsOpen ? 'rotate-180' : ''"
            aria-hidden="true"
          />
          {{ t('external.card.settings') }}
        </button>
        <div
          v-if="settingsOpen"
          :id="`external-settings-${plugin.pluginId}`"
          class="border-t border-slate-200 p-4 dark:border-white/10"
        >
          <ExternalScreen
            :plugin-id="plugin.pluginId"
            :screen="settingsScreen"
            surface="screen"
          />
        </div>
      </div>

      <!-- A parked permission-expanding update awaiting consent. -->
      <div
        v-if="plugin.pending"
        class="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10"
      >
        <div class="flex flex-wrap items-center gap-2">
          <RefreshCw
            class="h-4 w-4 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <p class="text-sm font-medium text-amber-800 dark:text-amber-300">
            {{ t('external.card.pendingUpdate') }} ({{
              plugin.pending.version
            }})
          </p>
          <div class="ml-auto flex gap-2">
            <Button :disabled="busy" @click="admin.approve(plugin)">
              {{ t('external.actions.approveUpdate') }}
            </Button>
            <Button
              variant="secondary"
              :disabled="busy"
              @click="admin.reject(plugin)"
            >
              {{ t('external.actions.rejectUpdate') }}
            </Button>
          </div>
        </div>
        <h4
          class="mt-2 text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400"
        >
          {{ t('external.card.requested') }}
        </h4>
        <ul class="mt-1 space-y-1">
          <li
            v-for="reason in plugin.pending.reasons"
            :key="reason.code + reason.detail"
            class="text-sm text-amber-800 dark:text-amber-300"
          >
            {{ admin.permissionLabel(reason.detail) }}
          </li>
        </ul>
      </div>
    </div>
  </article>
</template>
