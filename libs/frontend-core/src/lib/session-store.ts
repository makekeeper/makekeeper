import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  AuthResult,
  AuthStatus,
  ScopeAccess,
  ScopeInfo,
  UserPublic,
} from '@makekeeper/plugin-contract';
import {
  apiJson,
  getStoredScopeId,
  getStoredToken,
  getStoredDeviceToken,
  setStoredScopeId,
  setStoredSessionKey,
  setStoredToken,
  setStoredDeviceToken,
} from './api';
import { reconnectRealtime } from './realtime';

// Session state of the multiuser overlay. When the plugin is disabled the
// bootstrap probe 404s, `multiuserEnabled` stays false and the whole app
// behaves exactly as before the overlay existed.
export const useSessionStore = defineStore('session', () => {
  const multiuserEnabled = ref(false);
  const hasUsers = ref(false);
  const configOk = ref(true);
  const registrationAllowed = ref(true);
  const user = ref<UserPublic | null>(null);
  const scopes = ref<ScopeInfo[]>([]);
  const activeScopeId = ref<string | null>(getStoredScopeId());
  const bootstrapped = ref(false);

  const isAuthenticated = computed(() => user.value !== null);
  const isAdmin = computed(() => user.value?.isAdmin === true);

  const activeScope = computed<ScopeInfo | null>(() => {
    if (!user.value) return null;
    const wanted = activeScopeId.value ?? user.value.id;
    return scopes.value.find((scope) => scope.scopeId === wanted) ?? null;
  });

  const activeScopeAccess = computed<ScopeAccess | null>(
    () => activeScope.value?.accessLevel ?? null,
  );

  // Bootstrap probe. 404 ⇒ multiuser off; otherwise adopt the status payload.
  // Also self-heals a stale persisted scope (grant revoked, owner deleted).
  // Deduped while in flight: main.ts and the router's initial-navigation guard
  // both request it at startup and must share one probe.
  let inFlightBootstrap: Promise<void> | null = null;
  const bootstrap = (): Promise<void> => {
    inFlightBootstrap ??= runBootstrap().finally(() => {
      inFlightBootstrap = null;
    });
    return inFlightBootstrap;
  };

  const runBootstrap = async (): Promise<void> => {
    try {
      // localStorage (via api.ts) is the single source of truth for the token —
      // no mirrored ref to keep in sync. A PAIRED PHONE presents its device
      // token here for the same reason it presents it everywhere else (#199):
      // the backend resolves both shapes, and without this the phone is
      // authenticated for every API call yet reads as anonymous in this store,
      // so the router bounces it to /login the moment pairing succeeds.
      const token = getStoredToken() ?? getStoredDeviceToken();
      const response = await fetch('/api/auth/status', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        // Only a definitive answer toggles the overlay. 404 ⇒ plugin disabled.
        // 401 ⇒ enabled, but our token is invalid. Anything else (5xx from a
        // restarting backend or a proxy) is transient: leave the flag as-is so
        // a later probe decides — flipping a single-user instance "on" here
        // would wedge it behind a /login that has no backend to answer it.
        if (response.status === 404) {
          multiuserEnabled.value = false;
        } else if (response.status === 401) {
          multiuserEnabled.value = true;
          clearSession();
        }
        return;
      }
      const status: AuthStatus = await response.json();
      multiuserEnabled.value = true;
      hasUsers.value = status.hasUsers;
      configOk.value = status.configOk;
      registrationAllowed.value = status.registrationAllowed;
      user.value = status.user;
      scopes.value = status.scopes;
      if (status.user === null && token) {
        // Token expired or invalid — drop it so the guard sends us to /login.
        clearSession();
      }
      if (
        activeScopeId.value &&
        !status.scopes.some((scope) => scope.scopeId === activeScopeId.value)
      ) {
        activeScopeId.value = null;
        setStoredScopeId(null);
      }
    } catch {
      // Backend unreachable — leave the overlay off; the app degrades to the
      // same state as any other failed bootstrap fetch.
      multiuserEnabled.value = false;
    } finally {
      bootstrapped.value = true;
    }
  };

  const login = async (username: string, password: string): Promise<void> => {
    const result = await apiJson<AuthResult>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      public: true,
    });
    adoptAuth(result);
    await bootstrap();
  };

  const register = async (
    username: string,
    password: string,
    displayName?: string,
  ): Promise<void> => {
    const result = await apiJson<AuthResult>('/api/auth/register', {
      method: 'POST',
      body: { username, password, displayName: displayName || undefined },
      public: true,
    });
    adoptAuth(result);
    await bootstrap();
  };

  const logout = (): void => {
    // Best-effort server-side revoke of this session's DEK re-arm token (#63),
    // fired before clearSession() nulls the token/session key so the request
    // still carries them. Fire-and-forget: logout must never block on it.
    if (getStoredToken()) {
      void apiJson('/auth/logout', { method: 'POST' }).catch(() => undefined);
    }
    clearSession();
  };

  // Full reload on purpose: dozens of views hold component-local fetched
  // state; a guaranteed purge beats chasing every cache when the visible data
  // universe changes.
  const switchScope = (scopeId: string): void => {
    const own = user.value?.id === scopeId;
    activeScopeId.value = own ? null : scopeId;
    setStoredScopeId(own ? null : scopeId);
    window.location.assign('/');
  };

  const clearSession = (): void => {
    user.value = null;
    scopes.value = [];
    activeScopeId.value = null;
    setStoredToken(null);
    // A revoked device must stop presenting its credential too, or the phone
    // re-offers a dead token on every request and never reaches pairing (#199).
    setStoredDeviceToken(null);
    setStoredScopeId(null);
    // Forget the DEK re-arm key too, so it can never re-arm a stale session (#63).
    setStoredSessionKey(null);
    // Drop the authenticated socket — a lingering connection would keep
    // receiving the old user's scoped events.
    reconnectRealtime();
  };

  const adoptAuth = (result: AuthResult): void => {
    user.value = result.user;
    setStoredToken(result.token);
    // Persist the session key that re-arms this user's encryption key after a
    // server restart (#63). Absent when secret isolation is unavailable.
    setStoredSessionKey(result.sessionKey ?? null);
    reconnectRealtime();
  };

  return {
    multiuserEnabled,
    hasUsers,
    configOk,
    registrationAllowed,
    user,
    scopes,
    activeScopeId,
    activeScope,
    activeScopeAccess,
    bootstrapped,
    isAuthenticated,
    isAdmin,
    bootstrap,
    login,
    register,
    logout,
    switchScope,
    clearSession,
  };
});
