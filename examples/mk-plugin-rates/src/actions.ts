import { commands, refresh as refreshCmd, toast } from '@makekeeper/plugin-sdk';
import type { UiActionResult } from '@makekeeper/plugin-contract';
import { applySchedule, refresh } from './rates.ts';
import {
  normalizeCode,
  normalizeTime,
  saveState,
  type State,
} from './state.ts';

// The only place anything is mutated. Two actions, both about the schedule the
// admin now owns instead of the container's environment.
export const handleAction = async (
  state: State,
  action: string,
  form: Record<string, string | number | boolean> | undefined,
): Promise<UiActionResult> => {
  if (action === 'saveSchedule') {
    const base = normalizeCode(String(form?.['base'] ?? state.schedule.base));
    const rebased = base !== state.schedule.base;
    state.schedule = {
      autoRefresh: form?.['autoRefresh'] === true,
      // Bounds live in state.ts: a screen is not the place to decide what
      // "25:74" means.
      dailyAt: normalizeTime(String(form?.['dailyAt'] ?? state.schedule.dailyAt)),
      base,
    };
    // Every cached number is quoted against the OLD base, so a new base makes
    // the cache wrong rather than stale. Drop it and fetch again.
    if (rebased) {
      state.history = {};
      state.latest = null;
      await refresh(state);
    }
    await saveState(state);
    // Re-arm now rather than at the next tick — an interval that was a week
    // long would otherwise ignore the change for a week.
    applySchedule();
    return commands(refreshCmd({ tone: 'success', key: 'saved' }));
  }

  if (action === 'refreshNow') {
    // Independent of the schedule, and of whether automatic updates are on at
    // all: someone pressing this wants the number now.
    await refresh(state);
    return state.lastError
      ? commands(toast('error', 'refreshFailed'))
      : commands(refreshCmd({ tone: 'success', key: 'refreshed' }));
  }

  return commands();
};
