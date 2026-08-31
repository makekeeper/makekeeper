// External (out-of-process) plugin contract — the manifest (#131/#132).
//
// A third-party plugin runs as its own container next to the core and talks to
// it over HTTP. This file is the single source of truth for the manifest the
// plugin presents at registration: the TS types, the permission grammar and a
// dependency-free validator the core runs at install time. It lives in the
// Apache-licensed contract lib so plugin authors can consume it without
// touching FSL code.
//
// Versioning (decision #9 of the epic): the contract version is independent of
// the product version. Additive changes bump the minor, breaking changes bump
// the major; the core keeps supporting the previous major during a deprecation
// window. A manifest declaring an unsupported major is rejected at install; an
// unknown single UI node from an installed plugin is skipped at render (see
// external-ui.ts).

import type { PluginUxFeature } from '../manifest';
import { PermissionLevel } from '../agent-types';

// Current contract version implemented by the core.
// 1.1 added the `password` form field; 1.2 added `reloadOnChange` and the
// `form` payload on a render request; 1.3 added the `width` layout hint on a
// form field; 1.4 added the opaque `userRef` on a call context; 1.5 added a
// per-row action on a list item; 1.6 added a field's own hint line; 1.7 added
// core-side table filtering/pagination and the `time` field; 1.8 added
// plugin-side paging for tables and lists; 1.9 added sortable columns; 1.10
// added `publicPaths` (web-reachable plugin surface, #250); 1.11 added the
// `destructive` scoped access class (#252); 1.12 added `publicHintKey`, the
// setup line shown beside a public plugin's connection address (all additive →
// minor, per §1 of the spec).
export const EXTERNAL_CONTRACT_VERSION = { major: 1, minor: 13 } as const;

// Majors the core accepts at registration. Grows to [N-1, N] whenever a new
// major ships, shrinks back when the deprecation window closes.
export const SUPPORTED_CONTRACT_MAJORS: readonly number[] = [1];

export interface ExternalContractVersion {
  major: number;
  minor: number;
}

// ── Permission grammar ──────────────────────────────────────────────────────
// Three permission classes (decisions #3/#4/#13):
//   `<pluginId>:read` / `:write` / `:destructive`
//                              — scoped surface, data owned by an internal
//                                plugin, within one scope. `destructive`
//                                (contract 1.11, #252) additionally reaches
//                                DESTRUCTIVE tools; each higher access implies
//                                the lower ones.
//   `instance:<pluginId>:read` — instance surface, cross-scope aggregates
//                                (elevated; read-only).
//   `capability:<id>`          — invoke a registered capability.

export type ExternalPermissionClass = 'scoped' | 'instance' | 'capability';

export type ExternalScopedAccess = 'read' | 'write' | 'destructive';

export interface ParsedExternalPermission {
  raw: string;
  class: ExternalPermissionClass;
  // Owning internal plugin id for scoped/instance permissions; the capability
  // id (already `<ownerPluginId>.<name>`) for capability permissions.
  target: string;
  // Only meaningful for the scoped class.
  access?: ExternalScopedAccess;
}

const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
const CAPABILITY_ID_RE = /^[a-z][a-z0-9-]{1,31}\.[a-z][a-z0-9-]{1,63}$/;
const SCREEN_KEY_RE = /^[a-z][a-z0-9-]{0,63}$/;

export const isValidExternalPluginId = (id: string): boolean =>
  PLUGIN_ID_RE.test(id);

export const isValidCapabilityId = (id: string): boolean =>
  CAPABILITY_ID_RE.test(id);

// Parses one permission string; null when it matches no known grammar.
export function parseExternalPermission(
  raw: string,
): ParsedExternalPermission | null {
  const capability = raw.match(/^capability:(.+)$/);
  if (capability) {
    return CAPABILITY_ID_RE.test(capability[1])
      ? { raw, class: 'capability', target: capability[1] }
      : null;
  }
  const instance = raw.match(/^instance:([a-z][a-z0-9-]{1,31}):read$/);
  if (instance) {
    return { raw, class: 'instance', target: instance[1] };
  }
  const scoped = raw.match(/^([a-z][a-z0-9-]{1,31}):(read|write|destructive)$/);
  if (scoped) {
    return {
      raw,
      class: 'scoped',
      target: scoped[1],
      access:
        scoped[2] === 'destructive'
          ? 'destructive'
          : scoped[2] === 'write'
            ? 'write'
            : 'read',
    };
  }
  return null;
}

// A grant expansion is what the update diff policy (#133) holds for admin
// confirmation. `a` covers `b` when every permission of `b` is present in `a`.
export const permissionSetCovers = (
  granted: readonly string[],
  requested: readonly string[],
): boolean => requested.every((p) => granted.includes(p));

// ── Manifest building blocks ────────────────────────────────────────────────

// Placement of an external screen in the app's navigation. Mirrors the shape
// of the internal PluginNavItem but references a declared `screen` key instead
// of a router path — the core synthesizes the route itself.
export interface ExternalNavItem {
  screen: string;
  titleKey: string;
  icon: string;
  section?: 'main' | 'system';
  advanced?: boolean;
  // The `uxFeatures` key this entry's simple-mode visibility follows (#269) —
  // same contract as the internal `PluginNavItem.uxFeatureKey`, so the user's
  // per-feature toggle can bring an `advanced` entry back.
  uxFeatureKey?: string;
  // Tab of an existing hub (same silent-drop semantics as internal tabs).
  hub?: string;
  order?: number;
}

export interface ExternalDashboardWidget {
  key: string;
  screen: string;
  titleKey: string;
  icon: string;
  size?: 'stat' | 'panel' | 'full';
  order?: number;
  advanced?: boolean;
}

// A slot contribution rendered inside another plugin's screen (budgeted and
// silently dropped on miss — decision #8).
export interface ExternalSlotContribution {
  slot: string;
  screen: string;
  order?: number;
  // Names the contribution where its place no longer does — today the app
  // header's overflow menu (#277). An i18n key in the plugin's own bundle,
  // namespaced at bootstrap like every other key; absent, the host falls back
  // to the plugin's display name.
  labelKey?: string;
}

export interface ExternalToolParameter {
  type: 'string' | 'number' | 'boolean';
  descriptionKey: string;
  enum?: string[];
}

// Agent-tool declaration. Execution is proxied to the plugin container; the
// confirmation gate of a non-READ external tool can never be relaxed to
// auto-run (decision #7).
export interface ExternalToolDecl {
  name: string;
  descriptionKey: string;
  permission: PermissionLevel;
  parameters: {
    properties: Record<string, ExternalToolParameter>;
    required?: string[];
  };
}

export interface ExternalCapabilityDecl {
  // Must be prefixed with the declaring plugin's own id: `<pluginId>.<name>`.
  id: string;
  // Author's own contract version string for consumers; opaque to the core.
  version: string;
}

// Which entity types of this plugin can be referenced as
// `mk://<pluginId>/<entityType>/<id>`; resolution is proxied to the plugin.
export interface ExternalObjectRefDecl {
  entityType: string;
  // Screen that renders the entity; the core maps `refToRoute` to it, passing
  // the entity id as a screen param.
  screen: string;
}

export type ExternalScopeModel = 'instance' | 'per-scope';

export interface ExternalPluginManifest {
  contract: ExternalContractVersion;
  pluginId: string;
  // Author's plugin version — an opaque display string, not semver-enforced.
  version: string;
  nameKey: string;
  descriptionKey?: string;
  icon: string;
  scopeModel: ExternalScopeModel;
  permissions: string[];
  // locale → message tree. `en` is mandatory and must cover every key the
  // manifest references; other locales fall back to en (decision #14).
  i18n: Record<string, Record<string, unknown>>;
  // Screen keys the plugin can render; every nav/widget/settings reference
  // must point at one of these.
  screens: string[];
  nav?: ExternalNavItem[];
  widgets?: ExternalDashboardWidget[];
  slots?: ExternalSlotContribution[];
  // Screen rendered as this plugin's settings surface.
  settingsScreen?: string;
  tools?: ExternalToolDecl[];
  capabilities?: ExternalCapabilityDecl[];
  objectRefs?: ExternalObjectRefDecl[];
  // Event types the plugin subscribes to (delivered as signed webhooks).
  events?: string[];
  // Participates in .mkx export/import via the streamed blob hooks.
  exchange?: boolean;
  // Declares the optional self-purge hook offered at uninstall.
  purgeHook?: boolean;
  uxFeatures?: PluginUxFeature[];
  // Path prefixes of the plugin's own HTTP surface the core may expose to the
  // web, relative to the plugin root, without a leading slash (contract 1.10,
  // #250). `''` declares the WHOLE surface public. The instance proxies
  // `/plugins/<pluginId>/<subpath>` to the plugin for declared subpaths only;
  // everything else 404s. The signed `/mk/*` surface can never be declared.
  publicPaths?: string[];
  // One short line telling an admin what to do with the plugin's public
  // address (contract 1.12) — an i18n key into this manifest's own bundles.
  // The core shows it beside the address on the plugin card, so a plugin whose
  // whole point is an endpoint (mk-plugin-mcp) needs no settings screen to say
  // how to connect. Ignored when the plugin declares no `publicPaths`: there
  // is no address to explain.
  publicHintKey?: string;
  // Declares the plugin as a DELIVERY CHANNEL for notifications (contract 1.13,
  // #312). Deliberately its own field rather than an ordinary capability: it is
  // the one thing an external plugin can be granted that hands it rendered TEXT
  // and a person's contact, where every other surface deals in refs and field
  // names. The admin has to see that plainly when they approve it, and the core
  // shows this label beside it.
  deliveryChannel?: ExternalDeliveryChannel;
}

export interface ExternalDeliveryChannel {
  // Shown in the notification matrix as the column heading. An i18n key into
  // this manifest's own bundles.
  labelKey: string;
}

// The capability id the core relays channel calls to. Fixed rather than
// declared, so a plugin cannot register one channel under another's name: the
// plugin id IS the channel id.
export const externalChannelCapabilityId = (pluginId: string): string =>
  `${pluginId}.notify-channel`;

// The two methods a channel plugin answers on that capability.
export const EXTERNAL_CHANNEL_METHODS = {
  isLinked: 'isLinked',
  deliver: 'deliver',
} as const;

// Whether a declared public-path set covers one requested subpath (already
// stripped of the leading slash and the query string). Lives here so the core
// proxy and plugin-side routing share one covering rule.
export const publicPathCovers = (
  declared: readonly string[],
  subpath: string,
): boolean =>
  declared.some(
    (p) => p === '' || subpath === p || subpath.startsWith(`${p}/`),
  );

// ── Validation ──────────────────────────────────────────────────────────────
// Dependency-free structural validator the core runs at registration. Errors
// are machine-readable codes with a JSON-path-ish location — the admin UI maps
// codes to i18n messages; the codes themselves are technical identifiers.

export interface ExternalManifestError {
  code: string;
  path: string;
  detail?: string;
}

export type ExternalManifestResult =
  | { ok: true; manifest: ExternalPluginManifest }
  | { ok: false; errors: ExternalManifestError[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0;

// Every i18n key referenced by a manifest must resolve inside the mandatory
// `en` bundle. Dotted keys traverse the message tree.
const bundleHasKey = (
  bundle: Record<string, unknown>,
  key: string,
): boolean => {
  let node: unknown = bundle;
  for (const part of key.split('.')) {
    if (!isRecord(node)) return false;
    node = node[part];
  }
  return typeof node === 'string';
};

export function validateExternalManifest(
  value: unknown,
): ExternalManifestResult {
  const errors: ExternalManifestError[] = [];
  const err = (code: string, path: string, detail?: string): void => {
    errors.push({ code, path, detail });
  };

  if (!isRecord(value)) {
    return { ok: false, errors: [{ code: 'not-object', path: '$' }] };
  }

  // Contract version — checked first so an unsupported major yields exactly
  // one clear rejection instead of a wall of shape errors.
  const contract = value['contract'];
  if (
    !isRecord(contract) ||
    typeof contract['major'] !== 'number' ||
    typeof contract['minor'] !== 'number'
  ) {
    err('contract-missing', '$.contract');
    return { ok: false, errors };
  }
  if (!SUPPORTED_CONTRACT_MAJORS.includes(contract['major'])) {
    err('contract-unsupported', '$.contract.major', String(contract['major']));
    return { ok: false, errors };
  }

  if (
    !isNonEmptyString(value['pluginId']) ||
    !PLUGIN_ID_RE.test(value['pluginId'])
  ) {
    err('plugin-id-invalid', '$.pluginId');
  }
  if (!isNonEmptyString(value['version'])) err('version-missing', '$.version');
  if (!isNonEmptyString(value['nameKey'])) err('name-key-missing', '$.nameKey');
  if (!isNonEmptyString(value['icon'])) err('icon-missing', '$.icon');

  const scopeModel = value['scopeModel'];
  if (scopeModel !== 'instance' && scopeModel !== 'per-scope') {
    err('scope-model-invalid', '$.scopeModel');
  }

  // i18n: en bundle is mandatory.
  const i18n = value['i18n'];
  const en =
    isRecord(i18n) && isRecord(i18n['en'])
      ? (i18n['en'] as Record<string, unknown>)
      : null;
  if (!en) err('i18n-en-missing', '$.i18n.en');

  // Collect every referenced i18n key for the en-completeness check, and every
  // `uxFeatureKey` a nav entry points at, for the declared-feature check (#269).
  const navUxFeatureKeys: Array<{ key: string; path: string }> = [];
  const usedKeys: Array<{ key: string; path: string }> = [];
  const useKey = (key: unknown, path: string): void => {
    if (isNonEmptyString(key)) usedKeys.push({ key, path });
    else err('i18n-key-missing', path);
  };
  useKey(value['nameKey'], '$.nameKey');
  if (value['descriptionKey'] !== undefined) {
    useKey(value['descriptionKey'], '$.descriptionKey');
  }
  if (value['publicHintKey'] !== undefined) {
    useKey(value['publicHintKey'], '$.publicHintKey');
  }

  // Permissions.
  const channel = value['deliveryChannel'];
  if (channel !== undefined) {
    if (typeof channel !== 'object' || channel === null) {
      err('delivery-channel-invalid', '$.deliveryChannel');
    } else if (
      typeof (channel as { labelKey?: unknown }).labelKey !== 'string'
    ) {
      err('delivery-channel-label-invalid', '$.deliveryChannel.labelKey');
    }
  }

  const permissions = value['permissions'];
  if (!Array.isArray(permissions)) {
    err('permissions-invalid', '$.permissions');
  } else {
    permissions.forEach((p, i) => {
      if (!isNonEmptyString(p) || parseExternalPermission(p) === null) {
        err('permission-invalid', `$.permissions[${i}]`, String(p));
      }
    });
    if (new Set(permissions).size !== permissions.length) {
      err('permissions-duplicate', '$.permissions');
    }
  }

  // Screens.
  const screens = Array.isArray(value['screens'])
    ? value['screens'].filter(isNonEmptyString)
    : [];
  if (
    !Array.isArray(value['screens']) ||
    screens.length !== (value['screens'] as unknown[]).length
  ) {
    err('screens-invalid', '$.screens');
  }
  screens.forEach((s, i) => {
    if (!SCREEN_KEY_RE.test(s)) err('screen-key-invalid', `$.screens[${i}]`, s);
  });
  const screenSet = new Set(screens);
  const useScreen = (screen: unknown, path: string): void => {
    if (!isNonEmptyString(screen) || !screenSet.has(screen)) {
      err('screen-unknown', path, String(screen));
    }
  };

  // Nav.
  if (value['nav'] !== undefined) {
    if (!Array.isArray(value['nav'])) err('nav-invalid', '$.nav');
    else {
      value['nav'].forEach((item, i) => {
        if (!isRecord(item)) return err('nav-item-invalid', `$.nav[${i}]`);
        useScreen(item['screen'], `$.nav[${i}].screen`);
        useKey(item['titleKey'], `$.nav[${i}].titleKey`);
        if (!isNonEmptyString(item['icon']))
          err('icon-missing', `$.nav[${i}].icon`);
        // #269: an `advanced` entry must name the feature its toggle lives
        // under, or it hides with nothing in the settings UI to bring it back.
        if (item['advanced'] === true) {
          if (!isNonEmptyString(item['uxFeatureKey'])) {
            err('nav-ux-feature-key-missing', `$.nav[${i}].uxFeatureKey`);
          } else {
            navUxFeatureKeys.push({
              key: item['uxFeatureKey'],
              path: `$.nav[${i}].uxFeatureKey`,
            });
          }
        }
      });
    }
  }

  // Widgets.
  if (value['widgets'] !== undefined) {
    if (!Array.isArray(value['widgets'])) err('widgets-invalid', '$.widgets');
    else {
      value['widgets'].forEach((w, i) => {
        if (!isRecord(w)) return err('widget-invalid', `$.widgets[${i}]`);
        useScreen(w['screen'], `$.widgets[${i}].screen`);
        useKey(w['titleKey'], `$.widgets[${i}].titleKey`);
        if (!isNonEmptyString(w['key']))
          err('key-missing', `$.widgets[${i}].key`);
      });
    }
  }

  // Slot contributions.
  if (value['slots'] !== undefined) {
    if (!Array.isArray(value['slots'])) err('slots-invalid', '$.slots');
    else {
      value['slots'].forEach((s, i) => {
        if (!isRecord(s)) return err('slot-invalid', `$.slots[${i}]`);
        if (!isNonEmptyString(s['slot']))
          err('slot-name-missing', `$.slots[${i}].slot`);
        useScreen(s['screen'], `$.slots[${i}].screen`);
        // Optional, but when present it must be a real key of the en bundle —
        // the same rule every other referenced key follows.
        if (s['labelKey'] !== undefined)
          useKey(s['labelKey'], `$.slots[${i}].labelKey`);
      });
    }
  }

  if (value['settingsScreen'] !== undefined) {
    useScreen(value['settingsScreen'], '$.settingsScreen');
  }

  // Tools.
  if (value['tools'] !== undefined) {
    if (!Array.isArray(value['tools'])) err('tools-invalid', '$.tools');
    else {
      value['tools'].forEach((t, i) => {
        if (!isRecord(t)) return err('tool-invalid', `$.tools[${i}]`);
        if (!isNonEmptyString(t['name']))
          err('tool-name-missing', `$.tools[${i}].name`);
        useKey(t['descriptionKey'], `$.tools[${i}].descriptionKey`);
        const perm = t['permission'];
        if (
          perm !== PermissionLevel.READ &&
          perm !== PermissionLevel.WRITE &&
          perm !== PermissionLevel.DESTRUCTIVE
        ) {
          err('tool-permission-invalid', `$.tools[${i}].permission`);
        }
        const params = t['parameters'];
        if (!isRecord(params) || !isRecord(params['properties'])) {
          err('tool-parameters-invalid', `$.tools[${i}].parameters`);
        } else {
          for (const [pName, p] of Object.entries(params['properties'])) {
            if (!isRecord(p)) {
              err(
                'tool-parameter-invalid',
                `$.tools[${i}].parameters.${pName}`,
              );
              continue;
            }
            useKey(
              p['descriptionKey'],
              `$.tools[${i}].parameters.${pName}.descriptionKey`,
            );
            if (
              p['type'] !== 'string' &&
              p['type'] !== 'number' &&
              p['type'] !== 'boolean'
            ) {
              err(
                'tool-parameter-type-invalid',
                `$.tools[${i}].parameters.${pName}.type`,
              );
            }
          }
        }
      });
    }
  }

  // Capabilities offered — the id must carry the plugin's own prefix
  // (decision #13; the core additionally re-checks at registration).
  if (value['capabilities'] !== undefined) {
    if (!Array.isArray(value['capabilities']))
      err('capabilities-invalid', '$.capabilities');
    else {
      value['capabilities'].forEach((c, i) => {
        if (!isRecord(c))
          return err('capability-invalid', `$.capabilities[${i}]`);
        const id = c['id'];
        if (!isNonEmptyString(id) || !CAPABILITY_ID_RE.test(id)) {
          err('capability-id-invalid', `$.capabilities[${i}].id`, String(id));
        } else if (
          isNonEmptyString(value['pluginId']) &&
          !id.startsWith(`${value['pluginId']}.`)
        ) {
          err('capability-foreign-prefix', `$.capabilities[${i}].id`, id);
        }
        if (!isNonEmptyString(c['version'])) {
          err('capability-version-missing', `$.capabilities[${i}].version`);
        }
      });
    }
  }

  // Object-ref declarations.
  if (value['objectRefs'] !== undefined) {
    if (!Array.isArray(value['objectRefs']))
      err('object-refs-invalid', '$.objectRefs');
    else {
      value['objectRefs'].forEach((r, i) => {
        if (!isRecord(r))
          return err('object-ref-invalid', `$.objectRefs[${i}]`);
        if (!isNonEmptyString(r['entityType'])) {
          err('entity-type-missing', `$.objectRefs[${i}].entityType`);
        }
        useScreen(r['screen'], `$.objectRefs[${i}].screen`);
      });
    }
  }

  // Public paths (contract 1.10, #250). Segmented relative prefixes: no
  // leading slash, no trailing slash, every segment starts alphanumeric (which
  // also rules out `..`). The reserved signed surface `mk/*` is rejected here
  // rather than silently skipped at proxy time, so a typo surfaces at install.
  if (value['publicPaths'] !== undefined) {
    if (!Array.isArray(value['publicPaths'])) {
      err('public-paths-invalid', '$.publicPaths');
    } else {
      const PUBLIC_PATH_RE =
        /^$|^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;
      value['publicPaths'].forEach((p, i) => {
        if (typeof p !== 'string' || !PUBLIC_PATH_RE.test(p)) {
          err('public-path-invalid', `$.publicPaths[${i}]`, String(p));
        } else if (p === 'mk' || p.startsWith('mk/')) {
          err('public-path-reserved', `$.publicPaths[${i}]`, p);
        }
      });
    }
  }

  // Events / flags.
  if (value['events'] !== undefined) {
    if (
      !Array.isArray(value['events']) ||
      !value['events'].every(isNonEmptyString)
    ) {
      err('events-invalid', '$.events');
    }
  }
  const declaredUxKeys = new Set<string>();
  if (value['uxFeatures'] !== undefined) {
    if (!Array.isArray(value['uxFeatures']))
      err('ux-features-invalid', '$.uxFeatures');
    else {
      value['uxFeatures'].forEach((f, i) => {
        if (!isRecord(f) || !isNonEmptyString(f['key'])) {
          return err('ux-feature-invalid', `$.uxFeatures[${i}]`);
        }
        declaredUxKeys.add(f['key']);
        useKey(f['labelKey'], `$.uxFeatures[${i}].labelKey`);
        if (
          f['defaultAdvanced'] !== undefined &&
          typeof f['defaultAdvanced'] !== 'boolean'
        ) {
          err('ux-feature-invalid', `$.uxFeatures[${i}].defaultAdvanced`);
        }
      });
    }
  }
  // Every keyed nav entry must point at a feature this manifest declares —
  // otherwise its settings toggle does not exist and the entry is hard-hidden.
  for (const { key, path } of navUxFeatureKeys) {
    if (!declaredUxKeys.has(key)) err('nav-ux-feature-unknown', path, key);
  }

  // en-completeness: every referenced key must resolve in the en bundle.
  if (en) {
    for (const { key, path } of usedKeys) {
      if (!bundleHasKey(en, key)) err('i18n-key-unresolved', path, key);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: value as unknown as ExternalPluginManifest };
}
