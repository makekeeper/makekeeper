<script setup lang="ts">
import { Select, Switch, Badge, Tooltip } from '@makekeeper/frontend-core';
import type {
  AgentToolConfig,
  AgentToolGroup,
  ConfirmationPolicy,
} from './agent-tools';

// One plugin's tool table — the pane of the agent-capabilities section layout
// (#265). It owns no state and mutates nothing: a row reports the value the
// admin picked and the view, which fetched the groups, applies and saves it.
defineProps<{ group: AgentToolGroup }>();

const emit = defineEmits<{
  (
    event: 'change',
    tool: AgentToolConfig,
    patch: Partial<Pick<AgentToolConfig, 'isEnabled' | 'confirmationPolicy'>>,
  ): void;
}>();

// `Select` is generic over `any` values, so what comes back out of it has to be
// narrowed before it can be a policy again.
const isPolicy = (value: unknown): value is ConfirmationPolicy =>
  value === 'AUTO' || value === 'CONFIRM';

const onPolicy = (tool: AgentToolConfig, value: unknown): void => {
  if (isPolicy(value)) emit('change', tool, { confirmationPolicy: value });
};
</script>

<template>
  <div class="glass-card rounded-2xl overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-slate-200 dark:border-white/5">
          <th
            class="text-left text-xs font-bold text-slate-500 dark:text-slate-400 px-5 py-3"
          >
            {{ $t('settings.agentCapabilities.toolName') }}
          </th>
          <th
            class="text-left text-xs font-bold text-slate-500 dark:text-slate-400 px-5 py-3 hidden md:table-cell"
          >
            {{ $t('settings.agentCapabilities.description') }}
          </th>
          <th
            class="text-center text-xs font-bold text-slate-500 dark:text-slate-400 px-5 py-3"
          >
            {{ $t('settings.agentCapabilities.permission') }}
          </th>
          <th
            class="text-center text-xs font-bold text-slate-500 dark:text-slate-400 px-5 py-3"
          >
            {{ $t('settings.agentCapabilities.policy') }}
          </th>
          <th
            class="text-center text-xs font-bold text-slate-500 dark:text-slate-400 px-5 py-3"
          >
            {{ $t('settings.agentCapabilities.enabled') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="tool in group.tools"
          :key="tool.name"
          class="border-b border-slate-100 dark:border-white/5 last:border-0 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.02]"
          :class="{ 'opacity-50': !tool.isEnabled }"
        >
          <!-- Tool Name -->
          <td class="px-5 py-3.5">
            <span
              class="font-mono text-xs text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-white/5 px-2 py-1 rounded-lg"
            >
              {{ tool.name }}
            </span>
          </td>

          <!-- Description. Clamped, with the whole thing on hover: these are
               the strings the LLM reads, and several are a paragraph of
               addressing rules the model got wrong without them (#265). One
               such row is taller than the four beside it put together, which
               turns a table meant for scanning into a wall of prose. -->
          <td class="px-5 py-3.5 hidden md:table-cell">
            <Tooltip :text="$t(tool.descriptionKey)" display="contents">
              <!-- No `block` here: `line-clamp-*` IS a display (`-webkit-box`),
                   and pairing the two lets whichever rule the stylesheet emits
                   last win — which silently un-clamps the cell. -->
              <span
                class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2"
              >
                {{ $t(tool.descriptionKey) }}
              </span>
            </Tooltip>
          </td>

          <!-- Permission Badge -->
          <td class="px-5 py-3.5 text-center">
            <Badge
              :tone="
                tool.permission === 'READ'
                  ? 'read'
                  : tool.permission === 'WRITE'
                    ? 'write'
                    : 'destructive'
              "
            >
              {{ tool.permission }}
            </Badge>
          </td>

          <!-- Policy Select -->
          <td class="px-5 py-3.5">
            <div class="mx-auto w-52">
              <Select
                :model-value="tool.confirmationPolicy"
                :aria-label="
                  $t('settings.agentCapabilities.policyAria', {
                    name: tool.name,
                  })
                "
                :disabled="
                  !tool.isEnabled ||
                  tool.permission === 'DESTRUCTIVE' ||
                  (tool.external === true && tool.permission !== 'READ')
                "
                :options="[
                  {
                    value: 'AUTO',
                    label: $t('settings.agentCapabilities.policyAuto'),
                  },
                  {
                    value: 'CONFIRM',
                    label: $t('settings.agentCapabilities.policyConfirm'),
                  },
                ]"
                @change="(value: unknown) => onPolicy(tool, value)"
              />
            </div>
          </td>

          <!-- Toggle Enable -->
          <td class="px-5 py-3.5">
            <div class="flex justify-center">
              <Switch
                :model-value="tool.isEnabled"
                :disabled="tool.permission === 'DESTRUCTIVE'"
                :aria-label="
                  $t('settings.agentCapabilities.toggleAria', {
                    name: tool.name,
                  })
                "
                @change="(v: boolean) => emit('change', tool, { isEnabled: v })"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
