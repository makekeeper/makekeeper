import {
  AgentTool,
  PermissionLevel,
  withPlugin,
  NOTIFY_SCHEDULE_HOOK,
} from '@makekeeper/plugin-contract';
import { RequestContextService } from '@makekeeper/backend-core';
import { AgendaService } from './agenda.service';
import { ScheduleRefused, ScheduleService } from './schedule.service';

// What the product's own agent may do with time (#309).
//
// Note what is NOT here: a free-form "send this person a message" tool. Prose
// written by the model and delivered to a human would walk straight around the
// i18n keys every other notification goes through — so the agent may schedule a
// reminder, and the reminder says what the plugin's own strings say.
export const getScheduleTools = (
  schedule: ScheduleService,
  agenda: AgendaService,
  context: RequestContextService,
): AgentTool[] =>
  withPlugin('schedule', 'plugins.schedule.name', [
    // ── READ ────────────────────────────────────────────────────────────────

    {
      name: 'list_agenda',
      descriptionKey: 'schedule.agentTools.list_agenda.description',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            descriptionKey: 'schedule.agentTools.list_agenda.params.from',
          },
          to: {
            type: 'string',
            descriptionKey: 'schedule.agentTools.list_agenda.params.to',
          },
        },
        required: [],
      },
      handler: async (args) => {
        const from = args.from ? new Date(String(args.from)) : new Date();
        const to = args.to
          ? new Date(String(args.to))
          : new Date(from.getTime() + 7 * 24 * 60 * 60_000);
        return agenda.itemsInRange(from, to);
      },
    },

    {
      name: 'list_reminders',
      descriptionKey: 'schedule.agentTools.list_reminders.description',
      permission: PermissionLevel.READ,
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => schedule.list(),
    },

    // ── WRITE ───────────────────────────────────────────────────────────────

    {
      name: 'create_reminder',
      descriptionKey: 'schedule.agentTools.create_reminder.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            descriptionKey: 'schedule.agentTools.create_reminder.params.title',
          },
          rrule: {
            type: 'string',
            descriptionKey: 'schedule.agentTools.create_reminder.params.rrule',
          },
          timezone: {
            type: 'string',
            descriptionKey:
              'schedule.agentTools.create_reminder.params.timezone',
          },
          ref: {
            type: 'string',
            descriptionKey: 'schedule.agentTools.create_reminder.params.ref',
          },
          personal: {
            type: 'boolean',
            descriptionKey:
              'schedule.agentTools.create_reminder.params.personal',
          },
        },
        required: ['title', 'rrule'],
      },
      handler: async (args) => {
        try {
          return await schedule.create({
            hookId: NOTIFY_SCHEDULE_HOOK,
            title: String(args.title),
            trigger: {
              kind: 'absolute',
              rrule: String(args.rrule),
              // The model has no way of knowing where the person is sitting,
              // and asking it to name a zone got "UTC" — the only one it can
              // name without guessing, and wrong for everyone not in it. The
              // caller's browser reported its zone with the request; the
              // parameter is now an override, not an obligation.
              timezone:
                args.timezone === undefined
                  ? (context.get()?.timezone ?? 'UTC')
                  : String(args.timezone),
            },
            // The reminder says what the plugin's own strings say; the only
            // thing the model contributes is the title, which is the person's
            // own words repeated back.
            params: {
              type: 'schedule.reminder',
              titleKey: 'schedule.reminder.title',
              bodyKey: 'schedule.reminder.body',
              title: String(args.title),
            },
            ref: args.ref === undefined ? undefined : String(args.ref),
            // A model that was told "remind me" and said nothing about who
            // else should see it meant the caller. Defaulting the other way
            // published private reminders to everyone in the workspace.
            personal: args.personal !== false,
          });
        } catch (err) {
          // The refusal's key is returned rather than thrown so the model can
          // say what went wrong instead of losing the turn.
          if (err instanceof ScheduleRefused) {
            return { error: err.reasonKey };
          }
          throw err;
        }
      },
    },

    {
      name: 'reschedule_reminder',
      descriptionKey: 'schedule.agentTools.reschedule_reminder.description',
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            descriptionKey: 'schedule.agentTools.reschedule_reminder.params.id',
          },
          minutes: {
            type: 'number',
            descriptionKey:
              'schedule.agentTools.reschedule_reminder.params.minutes',
          },
        },
        required: ['id', 'minutes'],
      },
      handler: async (args) => ({
        ok: await schedule.snooze(String(args.id), Number(args.minutes)),
      }),
    },

    {
      name: 'cancel_reminder',
      descriptionKey: 'schedule.agentTools.cancel_reminder.description',
      // WRITE, not DESTRUCTIVE: cancelling a reminder removes an intention, not
      // a record of anything that happened.
      permission: PermissionLevel.WRITE,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            descriptionKey: 'schedule.agentTools.cancel_reminder.params.id',
          },
        },
        required: ['id'],
      },
      handler: async (args) => ({
        ok: await schedule.cancel(String(args.id)),
      }),
    },
  ]);
