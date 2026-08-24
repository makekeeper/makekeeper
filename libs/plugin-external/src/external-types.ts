// Shapes shared by this plugin's backend and frontend (§7: a payload both
// sides touch is declared once). The SHELL projection is what the SPA needs to
// mount external plugins before — and regardless of whether — their containers
// answer: nav, widgets, slot targets, screens, i18n. It is served from the
// manifest cached at install, so a dead plugin still renders its sidebar entry
// (decision #4).

import type {
  ExternalDashboardWidget,
  ExternalNavItem,
  ExternalObjectRefDecl,
  ExternalPluginManifest,
  ExternalSlotContribution,
  PluginUxFeature,
  UiActionResult,
  UiScreen,
} from '@makekeeper/plugin-contract';

export interface ExternalShellPlugin {
  pluginId: string;
  nameKey: string;
  icon: string;
  version: string;
  screens: string[];
  nav: ExternalNavItem[];
  widgets: ExternalDashboardWidget[];
  slots: ExternalSlotContribution[];
  settingsScreen?: string;
  objectRefs: ExternalObjectRefDecl[];
  uxFeatures: PluginUxFeature[];
  // The plugin's own locale bundles, merged into the app's i18n under the
  // `ext.<pluginId>` namespace so an external bundle can never shadow a core
  // or internal-plugin key.
  i18n: ExternalPluginManifest['i18n'];
}

// Render/action responses as the SPA receives them: the success payload plus
// the discriminated failure the per-surface degradation keys on.
export type ExternalRenderFailureCode =
  | 'unavailable'
  | 'timeout'
  // The container answered and rejected our signature: it is running, it is
  // reachable, and it does not hold the secret this installation was issued.
  // That happens when a container loses its state — a dropped volume, a
  // rebuilt stack — and it has exactly one cure (pair it again), so it is
  // worth telling apart from "something went wrong".
  | 'unauthorized'
  | 'error';

export type ExternalRenderPayload =
  | { ok: true; screen: UiScreen }
  | { ok: false; failure: ExternalRenderFailureCode };

export type ExternalActionPayload =
  | ({ ok: true } & UiActionResult)
  | { ok: false; failure: ExternalRenderFailureCode };

// Access ceiling of an `mkt_` connection token (#249): the hard upper bound on
// the permission LEVEL any call authenticated by that token may reach — a
// clamp on top of whatever the acting user could otherwise do. Chosen at
// issuance and immutable; changing a token's reach means issuing a new one.
export const EXTERNAL_TOKEN_CEILINGS = [
  'read-only',
  'read-write',
  'destructive',
] as const;

export type ExternalTokenCeiling = (typeof EXTERNAL_TOKEN_CEILINGS)[number];

export const isExternalTokenCeiling = (
  value: string,
): value is ExternalTokenCeiling =>
  (EXTERNAL_TOKEN_CEILINGS as readonly string[]).includes(value);

// Settings-page projection of a connection token (§7: a payload both sides
// touch is declared once). Never carries the token value — that exists once,
// in the issuing response.
export interface ExternalConnectionTokenView {
  id: string;
  label: string;
  ceiling: ExternalTokenCeiling;
  createdAt: string;
}

// The i18n namespace an external plugin's keys live under in the app bundle.
export const externalI18nNamespace = (pluginId: string): string =>
  `ext.${pluginId}`;

export const externalI18nKey = (pluginId: string, key: string): string =>
  `${externalI18nNamespace(pluginId)}.${key}`;
