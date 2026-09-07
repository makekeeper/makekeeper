import type { LocationQueryRaw, RouteLocationRaw } from 'vue-router';
import type { SectionNavItem } from '@makekeeper/frontend-core';
import {
  Download,
  CalendarClock,
  Rocket,
  Server,
  Info,
  Radio,
} from '@lucide/vue';

// The section picker shared by the two pages that show it (#342).
//
// "About" reads as the first section of the update page, but it is a route of
// its own: everything else there is instance administration behind
// `meta.adminOnly`, while About is the one surface every user must be able to
// reach — it is where the product's route back to us lives. One list, two
// hosts, so the two never drift into looking like different pages.
export const UPDATE_SECTIONS = [
  'version',
  'auto',
  'update',
  'install',
  'counting',
] as const;
// `…Key`, not `UpdateSection`: the page also imports a COMPONENT called
// `UpdateSection`, and Vue's SFC compiler rejects two imports sharing a local
// name outright ("different imports aliased to same local name").
export type UpdateSectionKey = (typeof UPDATE_SECTIONS)[number];
export const DEFAULT_UPDATE_SECTION: UpdateSectionKey = 'version';

export type UpdatesNavKey = 'about' | UpdateSectionKey;

export const isUpdateSection = (value: string): value is UpdateSectionKey =>
  UPDATE_SECTIONS.some((candidate) => candidate === value);

/**
 * Where one section lives.
 *
 * The default section drops the query key, so the update page has exactly one
 * address — the same rule the page applied to itself before the split.
 *
 * Any OTHER query the page is carrying rides along: switching section is a move
 * within the page, not a reset of it, and silently dropping a sibling parameter
 * is how a filter or a deep link stops surviving a click on the section list.
 */
export function updateSectionRoute(
  section: UpdateSectionKey,
  carried: LocationQueryRaw = {},
): RouteLocationRaw {
  const query: LocationQueryRaw = { ...carried };
  delete query['section'];
  if (section !== DEFAULT_UPDATE_SECTION) query['section'] = section;
  return { name: 'settings-updates', query };
}

export interface UpdatesNavOptions {
  /** Resolved by the caller — a lib never reaches for the global i18n (§5.5). */
  t: (key: string) => string;
  /** Drives the "an update is waiting" chip, legible from any section. */
  updateAvailable: boolean;
  /**
   * Whether the admin-only sections belong in the list at all. False for a
   * non-admin reading About in multi-user mode: their links would bounce off
   * the route guard, and a picker whose rows refuse to open is worse than a
   * picker with one row.
   */
  includeAdminSections: boolean;
  /** The page's current query, so switching section preserves its siblings. */
  query?: LocationQueryRaw;
}

export function buildUpdatesNav({
  t,
  updateAvailable,
  includeAdminSections,
  query = {},
}: UpdatesNavOptions): SectionNavItem<UpdatesNavKey>[] {
  const about: SectionNavItem<UpdatesNavKey> = {
    key: 'about',
    label: t('settings.about.section.title'),
    description: t('settings.about.section.description'),
    to: { name: 'settings-about' },
    icon: Info,
  };
  if (!includeAdminSections) return [about];

  return [
    about,
    {
      key: 'version',
      label: t('settings.updates.sections.version.title'),
      description: t('settings.updates.sections.version.description'),
      to: updateSectionRoute('version', query),
      icon: Download,
      // The one fact this page exists to surface has to be legible from any
      // section — including the diagnostics an admin opened it at.
      badge: updateAvailable ? 1 : 0,
      badgeLabel: updateAvailable
        ? t('settings.updates.sections.attention')
        : undefined,
    },
    {
      key: 'auto',
      label: t('settings.updates.sections.auto.title'),
      description: t('settings.updates.sections.auto.description'),
      to: updateSectionRoute('auto', query),
      icon: CalendarClock,
    },
    {
      key: 'update',
      label: t('settings.updates.sections.update.title'),
      description: t('settings.updates.sections.update.description'),
      to: updateSectionRoute('update', query),
      icon: Rocket,
    },
    {
      key: 'install',
      label: t('settings.updates.sections.install.title'),
      description: t('settings.updates.sections.install.description'),
      to: updateSectionRoute('install', query),
      icon: Server,
    },
    // Last, and admin territory like its neighbours: whether this instance
    // reports that it is running is a decision about the installation (#343).
    {
      key: 'counting',
      label: t('settings.updates.sections.counting.title'),
      description: t('settings.updates.sections.counting.description'),
      to: updateSectionRoute('counting', query),
      icon: Radio,
    },
  ];
}
