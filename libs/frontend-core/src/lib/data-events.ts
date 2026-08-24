import { readonly, ref, type Ref } from 'vue';

// Lightweight cross-plugin signal bumped whenever an AI agent turn completes and
// may have mutated backend data (create / update / delete via agent tools). Plugin
// views (e.g. storages) watch it and refetch, so agent-driven changes appear
// without a manual page reload. The chat store only sees the turn's final assistant
// message — never which tools ran — so this is a coarse "data may have changed"
// tick and subscribers refetch defensively.
const agentDataChangedSignal = ref(0);

export const notifyAgentDataChanged = (): void => {
  agentDataChangedSignal.value += 1;
};

export const useAgentDataChanged = (): Readonly<Ref<number>> =>
  readonly(agentDataChangedSignal);

// Which `data:changed` nudges mean "refetch what you are showing".
//
// A plugin invalidating its own SCREEN is not news about the core's data, and
// treating it as such made every open view refetch on that plugin's timer — a
// printer reporting a temperature every fifteen seconds made the inventory
// list blink. The rule lives here, next to the signal it guards, so it can be
// tested without a socket.
export const isAppWideDataChange = (payload: unknown): boolean => {
  if (typeof payload !== 'object' || payload === null) return false;
  const data = payload as { pluginIds?: unknown; screensOnly?: unknown };
  if (!Array.isArray(data.pluginIds) || data.pluginIds.length === 0)
    return false;
  return data.screensOnly !== true;
};
