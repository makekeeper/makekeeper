import { apiFetch, apiJson } from '@makekeeper/frontend-core';
import type { ScheduleInput, ScheduleView } from '@makekeeper/plugin-contract';

// The scheduler's own HTTP surface, in one place, so no view hand-rolls a URL.
export async function listSchedules(): Promise<ScheduleView[]> {
  return apiJson<ScheduleView[]>('/api/schedules');
}

export async function createSchedule(
  input: ScheduleInput,
): Promise<ScheduleView> {
  const body =
    input.trigger.kind === 'absolute'
      ? {
          hookId: input.hookId,
          title: input.title,
          triggerKind: 'absolute',
          rrule: input.trigger.rrule,
          timezone: input.trigger.timezone,
          ref: input.ref,
          params: input.params,
          personal: input.personal,
        }
      : {
          hookId: input.hookId,
          title: input.title,
          triggerKind: 'relative',
          ref: input.trigger.ref,
          refField: input.trigger.field,
          offsetMinutes: input.trigger.offsetMinutes,
          params: input.params,
          personal: input.personal,
        };
  return apiJson<ScheduleView>('/api/schedules', {
    method: 'POST',
    body,
  });
}

// One schedule, for the dialog that shows what an entry actually is (#322):
// its whole text, who set it, when it last ran.
export async function fetchSchedule(id: string): Promise<ScheduleView> {
  return apiJson<ScheduleView>(`/api/schedules/${id}`);
}

export async function cancelSchedule(id: string): Promise<void> {
  await apiFetch(`/api/schedules/${id}`, { method: 'DELETE' });
}
