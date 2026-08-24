// Shared payload shapes of the multi-user overlay — declared here because both
// the backend (controllers/services) and the frontend (session store, views)
// touch them, and CLAUDE.md requires shared payloads to live in a shared lib.

// Access level of a scope grant. The implicit third state — being the scope's
// owner — is represented separately (see `ScopeAccessLevel` vs `ScopeAccess`).
export type ScopeAccessLevel = 'READ' | 'WRITE';

// Access the current user has to a scope: their own, or via a grant.
export type ScopeAccess = ScopeAccessLevel | 'OWNER';

export interface UserPublic {
  id: string;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
}

// One scope the current user can switch to (their own comes first).
export interface ScopeInfo {
  // The scope id — equal to the owning user's id.
  scopeId: string;
  ownerName: string;
  accessLevel: ScopeAccess;
  // Plugins visible inside this scope; null means "no plugin restriction"
  // (own scope, where only the user's own plugin set applies).
  allowedPluginIds: string[] | null;
}

// Response of the public `GET /api/auth/status`. The endpoint 404s when the
// multiuser plugin is disabled, so `enabled` is always true when it answers.
export interface AuthStatus {
  enabled: true;
  // false until the first user registers — drives the register-first UX.
  hasUsers: boolean;
  // false when the server is missing a usable JWT secret (login impossible).
  configOk: boolean;
  // Open self-registration (admin setting). The very first account (admin
  // bootstrap) is always allowed regardless.
  registrationAllowed: boolean;
  // The authenticated caller, when the request carried a valid token.
  user: UserPublic | null;
  // Scopes available to the caller (own + shared to them). Empty when anonymous.
  scopes: ScopeInfo[];
}

// Response of `POST /api/auth/login` and `/register`: the issued token plus the
// authenticated user. Consumed by the frontend session store.
export interface AuthResult {
  token: string;
  user: UserPublic;
  // The client-held session key that re-arms the user's encryption key (DEK)
  // after a server restart without re-entering the password (#63). Opaque
  // `<sessionId>:<secret>` — stored next to the token and sent back as the
  // `x-session-key` header. Absent when secret isolation is unavailable.
  sessionKey?: string;
}

// One row of the caller's personal plugin set (GET /api/multiuser/my-plugins).
export interface MyPluginState {
  pluginId: string;
  isEnabled: boolean;
}

// The multiuser overlay's own admin-editable settings.
export interface MultiuserSettingsPublic {
  allowRegistration: boolean;
}

// Who besides the owner may use an AI connection's credentials. A personal
// connection may be opened to guests working in the owner's workspace; an
// instance connection may be opened to every user by the admin.
export type ProviderSharedWith = 'none' | 'workspace-guests' | 'everyone';

// Per-plugin resource selections of one grant:
// pluginId → resourceKey → selected resource ids.
export type GrantResourceRestrictions = Record<
  string,
  Record<string, string[]>
>;

// A grant as the owner manages it in the sharing UI.
export interface GrantPublic {
  id: string;
  grantee: UserPublic;
  accessLevel: ScopeAccessLevel;
  allowedPluginIds: string[];
  resourceRestrictions: GrantResourceRestrictions;
}

// One restriction section of the sharing UI, resolved for the owner's scope:
// the announced descriptor plus its currently listable options.
export interface RestrictionUiDescriptor {
  pluginId: string;
  resourceKey: string;
  labelKey: string;
  options: { id: string; label: string }[];
}

// Row of the admin users table: identity plus summary counts. Counts are
// computed per user's scope by the backend (admin never sees the data itself).
export interface AdminUserSummary extends UserPublic {
  createdAt: string;
  // True while an admin has blocked the account (login refused, sessions
  // rejected). Drives the row badge and the block/unblock action label.
  isBlocked: boolean;
  counts: {
    // Row count per scope-shared model, keyed by model name and derived from
    // the scoped-model registry — a new plugin's data appears automatically,
    // and no specific plugin's nouns are baked into this shared contract.
    models: Record<string, number>;
    grantsGiven: number;
    grantsReceived: number;
  };
}
