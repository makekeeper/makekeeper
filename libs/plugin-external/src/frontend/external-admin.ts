import {
  computed,
  inject,
  provide,
  ref,
  type Component,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from 'vue';
import { useI18n } from 'vue-i18n';
import {
  apiErrorMessage,
  apiJson,
  resolvePluginIcon,
  useConfirm,
  useToastStore,
  type BadgeTone,
} from '@makekeeper/frontend-core';
import {
  parseExternalPermission,
  type ExternalPluginManifest,
} from '@makekeeper/plugin-contract';
import { refreshExternalPlugins } from './external-bootstrap';

// Everything the external-plugins admin sections share (#262). The page is
// four sections now, and three of them speak about the same two lists — the
// installed plugins and the containers knocking at the door. The state and the
// calls live here once, provided by the view and injected by each section,
// rather than threaded through four layers of props.

// A container that announced itself and is waiting to be paired (#144).
// Everything in `manifest` is what IT claims — the pairing code is what makes
// the claim credible, so the UI labels it as such rather than presenting it
// like installed metadata.
export interface Candidate {
  id: string;
  pluginId: string;
  baseUrl: string;
  sourceIp: string | null;
  manifest: ExternalPluginManifest;
  expiresAt: string;
  ignored: boolean;
  conflictsWithInstalled: boolean;
}

export interface AdminPlugin {
  pluginId: string;
  status: 'pending' | 'active' | 'disabled' | 'error';
  baseUrl: string;
  version: string;
  contract: { major: number; minor: number };
  manifest: ExternalPluginManifest;
  grants: string[];
  assistantEnabled: boolean;
  errorCode: string | null;
  pending: {
    manifest: ExternalPluginManifest;
    baseUrl: string;
    version: string;
    reasons: Array<{ code: string; detail: string }>;
  } | null;
}

export interface PairingState {
  open: boolean;
  openUntil: string | null;
  // How many containers announced themselves recently while the window was
  // shut. A bare count on purpose: an announce is unauthenticated, so nothing
  // it supplied may be shown here (#147).
  knocking: number;
}

export type CandidateFilter = 'waiting' | 'ignored';

export interface ExternalAdminContext {
  loading: Ref<boolean>;
  plugins: Ref<AdminPlugin[]>;
  // The plugin id an action is currently in flight for.
  busy: Ref<string | null>;
  pairing: Ref<PairingState>;
  candidates: Ref<Candidate[]>;
  candidateFilter: Ref<CandidateFilter>;
  // Installs waiting for a first approval — the Connect section's job.
  awaitingApproval: ComputedRef<AdminPlugin[]>;
  // Everything already let in, whatever state it is in now.
  connected: ComputedRef<AdminPlugin[]>;
  // Connected plugins with a permission-expanding update parked for consent.
  pendingUpdates: ComputedRef<number>;

  load: () => Promise<void>;
  loadDiscovery: () => Promise<void>;
  setFilter: (value: CandidateFilter) => Promise<void>;
  openPairing: () => Promise<void>;
  closePairing: () => Promise<void>;
  // `false` when the code was refused — the caller keeps it in the field.
  pairCandidate: (candidate: Candidate, code: string) => Promise<boolean>;
  setIgnored: (candidate: Candidate, ignored: boolean) => Promise<void>;
  dismissCandidate: (candidate: Candidate) => Promise<void>;
  approve: (plugin: AdminPlugin) => Promise<void>;
  reject: (plugin: AdminPlugin) => Promise<void>;
  setEnabled: (plugin: AdminPlugin, enabled: boolean) => Promise<void>;
  setAssistant: (plugin: AdminPlugin, enabled: boolean) => Promise<void>;
  uninstall: (plugin: AdminPlugin, purge: boolean) => Promise<void>;

  // Presentation helpers shared by the candidate cards and the plugin cards.
  iconOf: (manifest: ExternalPluginManifest) => Component;
  pluginName: (manifest: ExternalPluginManifest) => string;
  manifestText: (
    manifest: ExternalPluginManifest,
    key: string,
  ) => string | null;
  permissionLabel: (raw: string) => string;
  isElevated: (raw: string) => boolean;
  statusTone: (status: AdminPlugin['status']) => BadgeTone;
}

const EXTERNAL_ADMIN: InjectionKey<ExternalAdminContext> =
  Symbol('external-admin');

const createExternalAdmin = (): ExternalAdminContext => {
  const { t, locale } = useI18n();
  const toast = useToastStore();
  const confirm = useConfirm();

  const loading = ref(true);
  const plugins = ref<AdminPlugin[]>([]);
  const busy = ref<string | null>(null);

  const pairing = ref<PairingState>({
    open: false,
    openUntil: null,
    knocking: 0,
  });
  const candidates = ref<Candidate[]>([]);
  // Which list the admin is looking at. Ignoring is reversible, so the ignored
  // ones must be reachable — otherwise a mis-click is permanent.
  const candidateFilter = ref<CandidateFilter>('waiting');

  const load = async (): Promise<void> => {
    try {
      plugins.value = await apiJson<AdminPlugin[]>(
        '/api/external/admin/plugins',
      );
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, t('external.errors.failed')));
    } finally {
      loading.value = false;
    }
  };

  const loadDiscovery = async (): Promise<void> => {
    try {
      pairing.value = await apiJson<PairingState>(
        '/api/external/admin/pairing',
      );
      // The ignored list stays reachable even with the window shut: undoing a
      // mis-click should not require reopening pairing first.
      candidates.value =
        pairing.value.open || candidateFilter.value === 'ignored'
          ? await apiJson<Candidate[]>(
              `/api/external/admin/candidates?ignored=${candidateFilter.value === 'ignored'}`,
            )
          : [];
    } catch {
      // A closed window and a failed poll look the same to the user, and
      // neither is worth a toast on a background refresh.
      candidates.value = [];
    }
  };

  const setFilter = async (value: CandidateFilter): Promise<void> => {
    candidateFilter.value = value;
    await loadDiscovery();
  };

  const openPairing = async (): Promise<void> => {
    try {
      await apiJson('/api/external/admin/pairing', { method: 'POST' });
      toast.success(t('external.discovery.pairingOpened'));
      await loadDiscovery();
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, t('external.errors.failed')));
    }
  };

  const closePairing = async (): Promise<void> => {
    await apiJson('/api/external/admin/pairing', { method: 'DELETE' });
    toast.success(t('external.discovery.pairingClosed'));
    await loadDiscovery();
  };

  // Reports whether the code was accepted: a rejected one must stay in the
  // field. Wiping it on every attempt makes a single mistyped digit cost the
  // whole four-digit code, and the container's code expires while you retype.
  const pairCandidate = async (
    candidate: Candidate,
    code: string,
  ): Promise<boolean> => {
    if (code.trim() === '') return false;
    busy.value = candidate.id;
    try {
      await apiJson(`/api/external/admin/candidates/${candidate.id}/pair`, {
        method: 'POST',
        body: { code: code.trim() },
      });
      toast.success(t('external.discovery.paired'));
      await Promise.all([load(), loadDiscovery()]);
      return true;
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, t('external.errors.badPairingCode')));
      return false;
    } finally {
      busy.value = null;
    }
  };

  const setIgnored = async (
    candidate: Candidate,
    ignored: boolean,
  ): Promise<void> => {
    busy.value = candidate.id;
    try {
      await apiJson(`/api/external/admin/candidates/${candidate.id}/ignore`, {
        method: ignored ? 'POST' : 'DELETE',
      });
      toast.success(
        t(
          ignored
            ? 'external.discovery.ignored'
            : 'external.discovery.unignored',
        ),
      );
      await loadDiscovery();
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, t('external.errors.failed')));
    } finally {
      busy.value = null;
    }
  };

  const dismissCandidate = async (candidate: Candidate): Promise<void> => {
    await apiJson(`/api/external/admin/candidates/${candidate.id}`, {
      method: 'DELETE',
    });
    toast.success(t('external.discovery.dismissed'));
    await loadDiscovery();
  };

  const act = async (
    pluginId: string,
    fn: () => Promise<void>,
    successKey: string,
  ): Promise<void> => {
    busy.value = pluginId;
    try {
      await fn();
      toast.success(t(successKey));
      await load();
      // The plugin's own menu entries, widgets and routes follow the decision
      // immediately (#150). The core broadcasts the same change to every other
      // client; this call is what makes the ACTING tab not wait for its own
      // socket round-trip — and what keeps it working with the socket down.
      await refreshExternalPlugins();
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, t('external.errors.failed')));
    } finally {
      busy.value = null;
    }
  };

  // The external plugin's own display name: resolved from ITS manifest bundles
  // (current locale, falling back to en) — external i18n never merges into the
  // app bundle, so `t()` cannot see it.
  const manifestText = (
    m: ExternalPluginManifest,
    key: string,
  ): string | null => {
    const resolve = (tree: unknown): string | null => {
      let node: unknown = tree;
      for (const part of key.split('.')) {
        if (typeof node !== 'object' || node === null) return null;
        node = (node as Record<string, unknown>)[part];
      }
      return typeof node === 'string' ? node : null;
    };
    return resolve(m.i18n[locale.value]) ?? resolve(m.i18n['en']);
  };

  const pluginName = (m: ExternalPluginManifest): string =>
    manifestText(m, m.nameKey) ?? m.pluginId;

  const approve = (p: AdminPlugin): Promise<void> =>
    act(
      p.pluginId,
      async () => {
        await apiJson(`/api/external/admin/plugins/${p.pluginId}/approve`, {
          method: 'POST',
        });
      },
      p.status === 'pending'
        ? 'external.toast.approved'
        : 'external.toast.updateApproved',
    );

  const reject = async (p: AdminPlugin): Promise<void> => {
    if (p.status === 'pending') {
      const ok = await confirm({
        message: t('external.confirm.reject', { name: pluginName(p.manifest) }),
        tone: 'danger',
      });
      if (!ok) return;
    }
    await act(
      p.pluginId,
      async () => {
        await apiJson(`/api/external/admin/plugins/${p.pluginId}/reject`, {
          method: 'POST',
        });
      },
      p.status === 'pending'
        ? 'external.toast.rejected'
        : 'external.toast.updateRejected',
    );
  };

  const setEnabled = (p: AdminPlugin, enabled: boolean): Promise<void> =>
    act(
      p.pluginId,
      async () => {
        await apiJson(`/api/external/admin/plugins/${p.pluginId}/enabled`, {
          method: 'PATCH',
          body: { enabled },
        });
      },
      enabled ? 'external.toast.enabled' : 'external.toast.disabled',
    );

  // Assistant consent is a SEPARATE decision from installing the plugin (#137):
  // letting a third-party container converse with a model that can read the
  // user's data is its own risk, so it gets its own switch, default off.
  const setAssistant = (p: AdminPlugin, enabled: boolean): Promise<void> =>
    act(
      p.pluginId,
      async () => {
        await apiJson(`/api/external/admin/plugins/${p.pluginId}/assistant`, {
          method: 'PATCH',
          body: { enabled },
        });
      },
      enabled ? 'external.toast.assistantOn' : 'external.toast.assistantOff',
    );

  const uninstall = (p: AdminPlugin, purge: boolean): Promise<void> =>
    act(
      p.pluginId,
      async () => {
        const res = await apiJson<{ purgeFailed: boolean }>(
          `/api/external/admin/plugins/${p.pluginId}`,
          { method: 'DELETE', body: { purge } },
        );
        if (res.purgeFailed) toast.error(t('external.errors.purgeFailed'));
      },
      'external.toast.uninstalled',
    );

  const permissionLabel = (raw: string): string => {
    const parsed = parseExternalPermission(raw);
    if (!parsed) return raw;
    if (parsed.class === 'scoped') {
      return t('external.permission.scoped', {
        target: parsed.target,
        access: parsed.access ?? 'read',
      });
    }
    if (parsed.class === 'instance') {
      return t('external.permission.instance', { target: parsed.target });
    }
    return t('external.permission.capability', { target: parsed.target });
  };

  // Instance-wide reads and the destructive access class (#252) both deserve
  // the warning badge on the consent card: one crosses scopes, the other
  // deletes data.
  const isElevated = (raw: string): boolean => {
    const parsed = parseExternalPermission(raw);
    return parsed?.class === 'instance' || parsed?.access === 'destructive';
  };

  // Typed as the Badge's own union, not a hand-written one: `emerald`, `amber`
  // and `red` are the COLOURS behind the tones, not tone names, and passing them
  // looked up nothing — every status badge rendered with no colour classes at
  // all. A local union let that compile.
  const statusTone = (status: AdminPlugin['status']): BadgeTone =>
    status === 'active'
      ? 'success'
      : status === 'pending'
        ? 'warning'
        : status === 'error'
          ? 'danger'
          : 'neutral';

  return {
    loading,
    plugins,
    busy,
    pairing,
    candidates,
    candidateFilter,
    awaitingApproval: computed(() =>
      plugins.value.filter((p) => p.status === 'pending'),
    ),
    connected: computed(() =>
      plugins.value.filter((p) => p.status !== 'pending'),
    ),
    pendingUpdates: computed(
      () =>
        plugins.value.filter(
          (p) => p.status !== 'pending' && p.pending !== null,
        ).length,
    ),
    load,
    loadDiscovery,
    setFilter,
    openPairing,
    closePairing,
    pairCandidate,
    setIgnored,
    dismissCandidate,
    approve,
    reject,
    setEnabled,
    setAssistant,
    uninstall,
    iconOf: (manifest: ExternalPluginManifest): Component =>
      // The plugin's own icon, the one it shows in the sidebar. A list of
      // plugins where every row starts with the same word ("Plugin", "Plugin",
      // "Plugin") is read by shape long before it is read by name.
      resolvePluginIcon(manifest.icon),
    pluginName,
    manifestText,
    permissionLabel,
    isElevated,
    statusTone,
  };
};

export const provideExternalAdmin = (): ExternalAdminContext => {
  const context = createExternalAdmin();
  provide(EXTERNAL_ADMIN, context);
  return context;
};

export const useExternalAdmin = (): ExternalAdminContext => {
  const context = inject(EXTERNAL_ADMIN);
  // A section rendered outside the view that provides this is a wiring bug,
  // not a user-facing failure — but the message is still a key (§5.5).
  if (!context) throw new Error('external.errors.contextMissing');
  return context;
};
