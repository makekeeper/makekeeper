import type { Prisma } from '@prisma/client';
import { ModelWhereFragment } from '@makekeeper/plugin-contract';

// How each protected Prisma model is confined.
// - `binding: 'scope'` (default): the row belongs to the ACTIVE scope — shared
//   data, visible to grantees within their grant.
// - `binding: 'user'`: the row belongs to its CREATOR regardless of the active
//   scope — private data (chats and their attachments). Content is never
//   shared; only scope access is (the user's requirement).
// - `binding: 'conditional'`: the row belongs to whatever its PARENT belongs to,
//   and falls back to its creator only when it has no parent at all. The parents
//   are the ones already declared in `parents`, so the ownership rule cannot
//   drift from the in-scope check the policy performs on the same FKs.
//   It exists for `Attachment` (#125): a file dropped into a project IS the
//   project's, a photo IS its component's, and only a file with nothing to
//   belong to stays with the person who uploaded it. Note what does NOT confer
//   ownership — a chat or phone-bridge session is a conversation and a
//   transport, not a thing a file becomes part of, so `sessionId` and
//   `bridgeSessionId` are not parents. That is why a picture sent in a chat
//   while a project is open is a project file (chat.service stamps its
//   `projectId` for exactly that reason), while the same picture sent with no
//   project open is private.
// Kinds:
// - `direct`: the model carries its own `scopeId` column (holds the owning
//   user's id in both bindings — a scope id IS a user id).
// - `child`: reachable only through a parent; reads are confined via a
//   relation filter, and creates must prove the referenced parents are inside
//   the active scope (the policy re-queries each parent THROUGH itself, so
//   grant restrictions apply to the check too).
export type ScopeBinding = 'scope' | 'user' | 'conditional';

// A flat foreign key the policy proves points at an in-scope row on create.
export interface ScopedParentRef {
  model: Prisma.ModelName;
  foreignKeyField: string;
}

// A model the policy confines to a scope — either directly (own `scopeId`) or
// through a parent relation.
export type ScopedModelRule =
  | {
      kind: 'direct';
      binding?: Exclude<ScopeBinding, 'conditional'>;
      // Scope-bearing FKs the model carries directly. Optional/nullable — the
      // policy checks each only when the create supplies it. Verifying these
      // stops a caller from stamping their own scopeId onto a row that points
      // at another scope's parent (which a relation read would then leak).
      parents?: ScopedParentRef[];
    }
  | {
      kind: 'direct';
      binding: 'conditional';
      // Required, unlike the arm above: these ARE the ownership rule. A
      // conditional model with no parents would be user-bound forever, which is
      // just `binding: 'user'` written the long way.
      parents: ScopedParentRef[];
    }
  | {
      kind: 'child';
      binding?: Exclude<ScopeBinding, 'conditional'>;
      scopeWhere: (ownerId: string) => ModelWhereFragment;
      // Flat FK fields the repo's services use for creation (no nested
      // writes exist — the policy fails loud if it meets one).
      parents: ScopedParentRef[];
    };

// The conditional arm on its own, for the policy code that only makes sense for
// it. Derived rather than declared so the two cannot drift.
export type ConditionalScopedModelRule = Extract<
  ScopedModelRule,
  { binding: 'conditional' }
>;

// A model the policy deliberately does NOT confine: system/infrastructure or
// instance-level configuration that holds no per-scope user data. `reason` is
// mandatory so the classification is a written decision rather than an
// oversight — and the fail-closed spec additionally proves such a model holds
// no foreign key INTO a scoped model (which would make its rows per-scope data
// and this classification a cross-user leak).
export interface UnscopedModelRule {
  kind: 'unscoped';
  reason: string;
}

// Every Prisma model resolves to exactly one of these.
export type ModelScopeRule = ScopedModelRule | UnscopedModelRule;

// Exhaustive over EVERY Prisma model. The `Record<Prisma.ModelName, …>`
// annotation makes a new model a **compile error** here (`nx build` fails) until
// it is classified — replacing the previous failure mode where an unmapped model
// silently fell through the access policy as cross-user-readable (CLAUDE.md
// §5.8). Missing a model is TS2741; a misspelled/removed model is an excess-key
// error. A model with no per-scope data is classified `unscoped` with a reason;
// anything holding user/scope data is `direct` or `child`.
export const SCOPE_MODEL_MAP: Record<Prisma.ModelName, ModelScopeRule> = {
  Project: {
    kind: 'direct',
    parents: [{ model: 'ProjectGroup', foreignKeyField: 'groupId' }],
  },
  ProjectGroup: {
    kind: 'direct',
    parents: [{ model: 'ProjectGroup', foreignKeyField: 'parentId' }],
  },
  Component: {
    kind: 'direct',
    parents: [
      { model: 'Storage', foreignKeyField: 'storageId' },
      { model: 'ItemCategory', foreignKeyField: 'categoryId' },
    ],
  },
  ItemCategory: {
    kind: 'direct',
    parents: [{ model: 'ItemCategory', foreignKeyField: 'parentId' }],
  },
  CategoryProperty: {
    kind: 'child',
    scopeWhere: (scopeId) => ({ category: { scopeId } }),
    parents: [{ model: 'ItemCategory', foreignKeyField: 'categoryId' }],
  },
  ComponentPropertyValue: {
    kind: 'child',
    scopeWhere: (scopeId) => ({ component: { scopeId } }),
    parents: [
      { model: 'Component', foreignKeyField: 'componentId' },
      { model: 'CategoryProperty', foreignKeyField: 'propertyId' },
    ],
  },
  Order: {
    kind: 'direct',
    parents: [
      { model: 'Supplier', foreignKeyField: 'supplierId' },
      { model: 'Project', foreignKeyField: 'projectId' },
      { model: 'Storage', foreignKeyField: 'storageId' },
    ],
  },
  Supplier: { kind: 'direct' },
  Storage: { kind: 'direct' },
  StockMovement: { kind: 'direct' },
  // Chats (and the files attached to them) are personal: bound to the user,
  // not to whatever scope they are browsing. A session names no project at all
  // since #130 — the project is a property of the turn, so the in-scope proof
  // moved down to AIChatMessage/AIUsageEvent with it.
  AIChatSession: { kind: 'direct', binding: 'user' },
  // A file belongs to the thing it was filed under — its project, its component
  // — and only a file with no such parent belongs to whoever uploaded it (#125).
  // `sessionId`/`bridgeSessionId` are deliberately absent from `parents`: a
  // conversation is not something a file becomes part of.
  Attachment: {
    kind: 'direct',
    binding: 'conditional',
    parents: [
      { model: 'Project', foreignKeyField: 'projectId' },
      { model: 'Component', foreignKeyField: 'componentId' },
      // A frame of an intake draft is the draft's, exactly as a photo is its
      // item's (#216) — the draft is a thing the picture becomes part of, which
      // is why it is here and a chat session is not.
      { model: 'InventoryIntakeDraft', foreignKeyField: 'intakeDraftId' },
    ],
  },
  Task: {
    kind: 'child',
    scopeWhere: (scopeId) => ({ project: { scopeId } }),
    parents: [{ model: 'Project', foreignKeyField: 'projectId' }],
  },
  ProjectComponent: {
    kind: 'child',
    scopeWhere: (scopeId) => ({ project: { scopeId } }),
    parents: [
      { model: 'Project', foreignKeyField: 'projectId' },
      { model: 'Component', foreignKeyField: 'componentId' },
    ],
  },
  OrderComponent: {
    kind: 'child',
    scopeWhere: (scopeId) => ({ order: { scopeId } }),
    parents: [
      { model: 'Order', foreignKeyField: 'orderId' },
      { model: 'Component', foreignKeyField: 'componentId' },
    ],
  },
  TrackingEvent: {
    kind: 'child',
    scopeWhere: (scopeId) => ({ order: { scopeId } }),
    parents: [{ model: 'Order', foreignKeyField: 'orderId' }],
  },
  ReturnRequest: {
    kind: 'child',
    scopeWhere: (scopeId) => ({ order: { scopeId } }),
    parents: [{ model: 'Order', foreignKeyField: 'orderId' }],
  },
  TaskComponent: {
    kind: 'child',
    scopeWhere: (scopeId) => ({ task: { project: { scopeId } } }),
    parents: [
      { model: 'Task', foreignKeyField: 'taskId' },
      { model: 'Component', foreignKeyField: 'componentId' },
    ],
  },
  TaskOrderDependency: {
    kind: 'child',
    scopeWhere: (scopeId) => ({ task: { project: { scopeId } } }),
    parents: [
      { model: 'Task', foreignKeyField: 'taskId' },
      { model: 'Order', foreignKeyField: 'orderId' },
    ],
  },
  // The message is where a turn's project scope is recorded (#130), so its
  // `projectId` is a parent to prove: a turn cannot be stamped with a project
  // the caller cannot see, which is what would make one user's spend and
  // history show up in another's project.
  AIChatMessage: {
    kind: 'child',
    binding: 'user',
    scopeWhere: (userId) => ({ session: { scopeId: userId } }),
    parents: [
      { model: 'AIChatSession', foreignKeyField: 'sessionId' },
      { model: 'Project', foreignKeyField: 'projectId' },
    ],
  },
  // Daily statistics rollups (ticket #56). Scoped by the DATA's own scope, not by
  // user: each row's scopeId is the owning scope stamped by the aggregation job
  // from the source metric's scope, and reads are confined to the active scope
  // (`binding: 'scope'`). So a grantee who joins a shared scope immediately sees
  // that scope's statistics — the multiuser overlay is not mixed into stats
  // scoping. User-owned metrics (e.g. chat, whose raw data is user-bound) carry
  // scopeId = the owning user id, which equals the active scope in that user's
  // own space.
  StatsDaily: { kind: 'direct' },
  // Project activity log (ticket #54): shared project data. Its projectId must
  // point at an in-scope project on create (the mutation that logs it already
  // runs against that project).
  ActivityEvent: {
    kind: 'direct',
    parents: [{ model: 'Project', foreignKeyField: 'projectId' }],
  },
  // LLM usage telemetry (ticket #55): private per user, like chat itself. Its
  // project stamp (#130) is the same claim the message makes and is proven the
  // same way.
  AIUsageEvent: {
    kind: 'direct',
    binding: 'user',
    parents: [{ model: 'Project', foreignKeyField: 'projectId' }],
  },
  // Daily stock-level snapshot (ticket #56 §4.4): scope-shared inventory data.
  StockSnapshot: { kind: 'direct' },
  // Universal tags (#60): the tag vocabulary and its links are scope-shared
  // data. `Tag` carries its own scopeId. A `TagLink` also carries its own
  // scopeId ('direct') — its target is an opaque ORef, not a typed FK, so the
  // relation-filter 'child' pattern doesn't apply; its Tag parent must be
  // in-scope on create, and the link's scope is proven to match the target's at
  // assign time by resolving the ORef through the owning plugin's scoped resolver.
  Tag: { kind: 'direct' },
  TagLink: {
    kind: 'direct',
    parents: [{ model: 'Tag', foreignKeyField: 'tagId' }],
  },
  // Fields whose value becomes a tag on creation (#205). Same shape and same
  // reason as TagLink: the row names its target by opaque ORef, so there is no
  // typed FK to make it a 'child' of and no `parents` to declare.
  TagSource: { kind: 'direct' },
  // Universal labels (#74): a short code ↔ ORef mapping, scope-shared like the
  // tag vocabulary. Carries its own scopeId; its target is an opaque ORef, so
  // 'direct' (no typed-FK 'child' relation applies).
  Label: { kind: 'direct' },

  // ── Unscoped: system / infrastructure & instance-level config ───────────────
  // These hold no per-scope user data, so the access policy passes them through.
  // Each MUST hold no foreign key into a scoped model (enforced by the spec).
  User: { kind: 'unscoped', reason: 'identity table; a scope id IS a user id' },
  // Intake drafts (#201) carry their own scopeId and point at a Storage, so the
  // policy proves that parent is in scope on create — otherwise a draft could
  // be stamped into one scope while pointing at another's shelf.
  InventoryIntakeDraft: {
    kind: 'direct',
    parents: [{ model: 'Storage', foreignKeyField: 'storageId' }],
  },
  MobileSettings: {
    kind: 'unscoped',
    reason: 'instance configuration: where the mobile surface is published',
  },
  PairedDevice: {
    kind: 'unscoped',
    reason:
      'credential table (#199): a device is bound to a user, not to a data scope',
  },
  DevicePairingCode: {
    kind: 'unscoped',
    reason: 'short-lived credential (#199); never holds per-scope data',
  },
  ScopeGrant: {
    kind: 'unscoped',
    reason:
      'the overlay owns access grants and manages their visibility itself',
  },
  MultiuserSettings: {
    kind: 'unscoped',
    reason: 'instance-level overlay config',
  },
  UserPluginConfig: {
    kind: 'unscoped',
    reason: 'per-user plugin set; keyed by userId, gated by the overlay itself',
  },
  UserKeyring: {
    kind: 'unscoped',
    reason: 'per-user encryption keyring; managed by the keyring service (#63)',
  },
  KeySession: {
    kind: 'unscoped',
    reason:
      'per-user session key material; managed by the keyring service (#63)',
  },
  SecretAccessLog: {
    kind: 'unscoped',
    reason: 'security audit log; instance-level, admin-read only (#63)',
  },
  PluginConfig: {
    kind: 'unscoped',
    reason: 'instance-level plugin enable/config',
  },
  AgentToolConfig: {
    kind: 'unscoped',
    reason: 'instance-level per-tool confirmation policy',
  },
  AIProviderConfig: {
    kind: 'unscoped',
    reason: 'AI provider connection config; instance/personal, not scope data',
  },
  ChatAttachmentSettings: {
    kind: 'unscoped',
    reason:
      'chat attachment ruleset; owned per connection owner like AIProviderConfig, not scope data (#112)',
  },
  LogisticsSettings: {
    kind: 'unscoped',
    reason: 'singleton logistics plugin settings',
  },
  PhoneBridgeSession: {
    kind: 'unscoped',
    reason:
      'ephemeral phone↔desktop pairing; short-lived, not scope data (#77)',
  },
  PhoneBridgeSettings: {
    kind: 'unscoped',
    reason: 'singleton phone-bridge plugin settings',
  },
  UpdateCheckSettings: {
    kind: 'unscoped',
    reason: 'singleton instance update-checker settings',
  },
  // External plugins (#131/#133): instance-administration rows, admin-only
  // surfaces. ExternalPlugin.scopeId is the plugin's own scope BINDING (which
  // scope an `instance`-model plugin belongs to), not a data-space marker —
  // the scoped-CRUD isolation of external callers happens at token level.
  ExternalPlugin: {
    kind: 'unscoped',
    reason: 'instance administration: registered external plugins',
  },
  ExternalInstallToken: {
    kind: 'unscoped',
    reason: 'instance administration: one-time install tokens',
  },
  ExternalAccessToken: {
    kind: 'unscoped',
    reason: 'instance administration: tokens issued to external plugins',
  },
  // Connection tokens (#249) are user-bound credentials, but the rows are
  // instance administration like every External* model: the admin surface
  // filters them by the issuing user itself, and verification happens before
  // any request context exists to scope by.
  ExternalConnectionToken: {
    kind: 'unscoped',
    reason: 'instance administration: mkt_ connection tokens',
  },
  // The outbox's eventScopeId marks which scope an event HAPPENED in (relayed
  // to the plugin), not the data space of the delivery row: the record is
  // instance-level plumbing an admin sees, and the worker draining it runs
  // with no user context at all.
  ExternalEventDelivery: {
    kind: 'unscoped',
    reason: 'instance administration: webhook delivery outbox',
  },
  // targetScopeId records which scope an archive was imported into, not the
  // data space of the deferred block itself (same reasoning as the outbox).
  ExternalDeferredBlob: {
    kind: 'unscoped',
    reason: 'instance administration: deferred exchange blocks',
  },
  ExternalCandidate: {
    kind: 'unscoped',
    reason: 'instance administration: plugins awaiting pairing',
  },
  ExternalSettings: {
    kind: 'unscoped',
    reason: 'instance administration: core-side host configuration (budgets)',
  },
};

// Runtime lookup by a plain model name (the access policy holds `ctx.model` as a
// `string`). A `Map` keeps this cast-free — indexing the exhaustively-typed
// object with an arbitrary string is not assignable under strict mode.
const MODEL_SCOPE_RULES: ReadonlyMap<string, ModelScopeRule> = new Map(
  Object.entries(SCOPE_MODEL_MAP),
);

// Resolve a model's scope rule. Returns `undefined` only for a name that is not
// a Prisma model at all (the map is exhaustive over real models); the policy
// treats both `undefined` and `kind: 'unscoped'` as pass-through.
export function resolveModelScopeRule(
  model: string,
): ModelScopeRule | undefined {
  return MODEL_SCOPE_RULES.get(model);
}

// The single list of direct-scoped models (those carrying their own `scopeId`
// column). Consumers — orphan backfill, the fail-closed coverage check — derive
// from this so a new direct-scoped model is handled in one place instead of
// several hand-synced lists. Child and unscoped models carry no scopeId, so they
// are excluded.
export const DIRECT_SCOPED_MODELS: readonly string[] = Object.entries(
  SCOPE_MODEL_MAP,
)
  .filter(([, rule]) => rule.kind === 'direct')
  .map(([model]) => model);

// Direct-scoped models that belong to the SHARED scope (not user-private, e.g.
// chats/attachments). These are the aggregates the admin directory counts per
// user — derived here so a new plugin's model appears without editing that view.
export const SCOPE_SHARED_DIRECT_MODELS: readonly string[] = Object.entries(
  SCOPE_MODEL_MAP,
)
  .filter(([, rule]) => rule.kind === 'direct' && rule.binding !== 'user')
  .map(([model]) => model);
