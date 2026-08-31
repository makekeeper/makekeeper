import {
  formatObjectRef,
  parseObjectRef,
  type CalendarItem,
  type CalendarSourceCapability,
} from '@makekeeper/plugin-contract';
import type { PrismaService } from '@makekeeper/backend-core';

// What this plugin puts on the calendar (#310): task deadlines and a project's
// own dates. Nothing is copied anywhere — the calendar asks, these rows answer,
// so moving a due date IS moving what the calendar shows, and there is no
// second copy to drift from `Task.dueDate` the way a mirrored table would.
export function createProjectsCalendarSource(
  prisma: PrismaService,
): CalendarSourceCapability {
  return {
    async itemsInRange(from, to) {
      const window = { gte: new Date(from), lte: new Date(to) };
      const [tasks, projects] = await Promise.all([
        prisma.task.findMany({
          where: { dueDate: window },
          select: {
            id: true,
            title: true,
            dueDate: true,
            isCompleted: true,
          },
        }),
        prisma.project.findMany({
          where: { OR: [{ dueDate: window }, { startDate: window }] },
          select: {
            id: true,
            title: true,
            dueDate: true,
            startDate: true,
            completedAt: true,
          },
        }),
      ]);

      const items: CalendarItem[] = [];
      for (const task of tasks) {
        if (!task.dueDate) continue;
        items.push({
          ref: formatObjectRef({
            pluginId: 'projects',
            entityType: 'task',
            entityId: task.id,
          }),
          kindKey: 'projects.calendar.taskDue',
          title: task.title,
          field: 'dueDate',
          at: task.dueDate.toISOString(),
          // Done is rendered quietly rather than hidden: a week you finished is
          // still a week that happened.
          done: task.isCompleted,
        });
      }
      for (const project of projects) {
        const ref = formatObjectRef({
          pluginId: 'projects',
          entityType: 'project',
          entityId: project.id,
        });
        if (project.startDate && within(project.startDate, window)) {
          items.push({
            ref,
            kindKey: 'projects.calendar.projectStart',
            title: project.title,
            field: 'startDate',
            at: project.startDate.toISOString(),
            done: project.completedAt !== null,
          });
        }
        if (project.dueDate && within(project.dueDate, window)) {
          items.push({
            ref,
            kindKey: 'projects.calendar.projectDue',
            title: project.title,
            field: 'dueDate',
            at: project.dueDate.toISOString(),
            done: project.completedAt !== null,
          });
        }
      }
      return items;
    },

    // The question a relative reminder asks on every tick. Null covers all
    // three ways there is nothing to fire on — gone, empty, or not the caller's
    // to see — and the scheduler treats them identically, which is why a
    // deleted task simply stops reminding anybody.
    async dateOf(ref, field) {
      const parsed = parseObjectRef(ref);
      if (!parsed || parsed.pluginId !== 'projects') return null;
      if (parsed.entityType === 'task') {
        if (field !== 'dueDate') return null;
        const task = await prisma.task.findFirst({
          where: { id: parsed.entityId },
          select: { dueDate: true },
        });
        return task?.dueDate?.toISOString() ?? null;
      }
      if (parsed.entityType === 'project') {
        if (field !== 'dueDate' && field !== 'startDate') return null;
        const project = await prisma.project.findFirst({
          where: { id: parsed.entityId },
          select: { dueDate: true, startDate: true },
        });
        const value =
          field === 'dueDate' ? project?.dueDate : project?.startDate;
        return value?.toISOString() ?? null;
      }
      return null;
    },
  };
}

const within = (date: Date, window: { gte: Date; lte: Date }): boolean =>
  date >= window.gte && date <= window.lte;
