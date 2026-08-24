// Cross-plugin capability and event contracts (#58).
//
// A *capability* is a typed service surface one plugin OFFERS to the rest of
// the app; an *event* is a fire-and-forget domain notification one plugin
// EMITS and others may listen to. Both are mediated by backend-core registries
// (`CapabilityRegistryService`, `PluginEventBusService`) that hide the
// implementation while the owning/listening plugin is disabled — so a consumer
// never imports another plugin's code, only these shared contracts. The
// capability id string is the contract: the registry stores implementations
// untyped, and this file is the single place binding an id to its interface.

import type { RealtimeRequestContext } from './realtime';
import type { PhoneBridgeMessage } from './phone-bridge';
import type { ExternalDomainEventType } from './external/external-events';

// ── Capabilities ────────────────────────────────────────────────────────────

// Parking of `.mkx` sections that belong to an EXTERNAL plugin which is not
// installed (#138). Offered by the `external` plugin, consumed by `exchange`:
// the two must not import each other (§5.10), and exchange must keep working
// unchanged when the external host is absent — `null` then means "no external
// plugins exist here", and such a section is skipped exactly as before.
export const EXTERNAL_DEFERRED_EXCHANGE_CAPABILITY =
  'external.deferred-exchange';

export interface ExternalDeferredExchangeCapability {
  // Is this section key one an external plugin would own?
  ownerOfSection(sectionKey: string): string | null;
  // Park an unimportable block until its plugin registers.
  deferBlock(
    pluginId: string,
    blob: Uint8Array,
    targetScopeId: string | null,
  ): Promise<void>;
}

// Publishing a public domain event to external subscribers (#189/#191).
// Offered by the `external` plugin, consumed by the data owners (inventory,
// logistics, projects) at the exact point where the fact became final —
// always an explicit act, never a bridge from the internal bus. `null`
// (external host absent or disabled) means nobody can be listening, so the
// emitter simply skips the call. Only catalogue names may travel here: the
// input type is the catalogue union, not `string`, so an internal name
// cannot leak outward by typo.
export const EXTERNAL_EVENTS_PUBLISH_CAPABILITY = 'external.events.publish';

export interface ExternalDomainEventInput {
  type: ExternalDomainEventType;
  // Internal scope id the fact happened in; absent for scopeless facts
  // (which then reach instance subscribers only).
  scopeId?: string | null;
  // Canonical mk:// ORef of the affected entity.
  ref?: string;
  // Names of the changed fields — never values (`*.changed` events only).
  changed?: string[];
}

export interface ExternalEventsPublishCapability {
  publishDomainEvent(input: ExternalDomainEventInput): Promise<void>;
}

// One-shot, session-less vision completion offered by the chat plugin (consumed
// by the logistics screenshot-import and by inventory recognition). Each entry
// of `imageUrls` is a "/api/uploads/:id" URL; resolves the active LLM provider
// like a normal chat turn and returns the raw text reply, or null when no
// provider is configured.
//
// The id carries `-v2` because the shape changed in #215: one photograph is
// often not enough to identify a part, so the call takes a SET of frames. The
// version is in the name because the registry has no version field of its own —
// a consumer still asking for the v1 id resolves to null, i.e. "the feature
// doesn't exist" (§5.10), which is the honest answer to a signature it can no
// longer satisfy. Anything sending one image passes a one-element array.
//
// A hyphen, not a second dot: an external plugin names capabilities it consumes
// in its manifest, and `CAPABILITY_ID_RE` allows exactly one dot — a `.v2` would
// have made this id unnameable there.
export const VISION_COMPLETION_CAPABILITY = 'chat.vision-completion-v2';

export interface VisionCompletionCapability {
  runVisionCompletion(
    systemPrompt: string,
    userText: string,
    imageUrls: string[],
    locale?: string,
  ): Promise<string | null>;
}

// The same one-shot completion without a picture (#206). A separate capability
// rather than an optional `imageUrl`, because a consumer that has no image must
// not be able to send one by accident — and because the reason this exists is
// to send the image ONCE: mobile intake describes the photo in the vision call,
// then asks about that description in text, instead of paying for the image
// tokens a second time.
export const TEXT_COMPLETION_CAPABILITY = 'chat.text-completion';

export interface TextCompletionCapability {
  runTextCompletion(
    systemPrompt: string,
    userText: string,
    locale?: string,
  ): Promise<string | null>;
}

// Order-derived component facts offered by the logistics plugin (consumed by
// inventory for its list/detail views): quantity on the way per component,
// last paid unit price per component, and the per-component order history.
export const COMPONENT_ORDER_INFO_CAPABILITY = 'logistics.component-order-info';

export interface ComponentOrderSummary {
  orderId: string;
  storeName: string;
  status: string;
  quantity: number;
  orderDate: Date;
}

export interface ComponentOrderInfoCapability {
  // Global quantity on the way per component — for inventory's per-component
  // views, where "on order" is a plain instance-wide total.
  onOrderByComponent(): Promise<Map<string, number>>;
  // Quantity on the way per (project, component), attributed to the project the
  // order was placed for (#90). Outer key projectId, inner componentId → qty.
  // Orders with no project are omitted so the bench never credits one project's
  // incoming parts to another (which the global sum above would double-count).
  onOrderByProjectComponent(): Promise<Map<string, Map<string, number>>>;
  lastPriceByComponent(): Promise<
    Map<string, { price: number; currency: string }>
  >;
  componentOrders(componentId: string): Promise<ComponentOrderSummary[]>;
}

// Count of orders still in flight (placed/shipped), offered by logistics and
// consumed by the projects bench summary (#90). Null while logistics is
// disabled ⇒ the bench simply omits the "incoming" figure.
export const LOGISTICS_INCOMING_CAPABILITY = 'logistics.incoming';

export interface LogisticsIncomingCapability {
  incomingOrderCount(): Promise<number>;
}

// Bench-relevant stock facts offered by inventory and consumed by the projects
// bench summary (#90): how many in-stock parts have no storage cell yet. Null
// while inventory is disabled ⇒ the bench omits the "not put away" figure.
export const INVENTORY_STOCK_FACTS_CAPABILITY = 'inventory.stock-facts';

export interface InventoryStockFactsCapability {
  unplacedCount(): Promise<number>;
}

// Attaching a tag to any object, offered by the tags plugin.
//
// The name is a plain tag name; the tags plugin creates it on first use and
// reuses it afterwards, so the caller never has to know whether it exists.
// Unresolvable (tags disabled or absent) means the feature does not exist:
// callers skip tagging rather than fail the write they were really doing.
//
// NOT how tag-source properties work (#205): there the tags plugin LISTENS for
// `INVENTORY_ITEM_PROPERTY_VALUES_EVENT` and decides for itself, so inventory
// never calls this. It stays because "tag this object" is a reasonable thing
// for some future caller to ask for outright.
export const TAGS_ASSIGN_CAPABILITY = 'tags.assign';

export interface TagsAssignCapability {
  assignTag(name: string, ref: string): Promise<void>;
}

// Who owns a file dropped into the chat while a given object is on screen
// (#130), offered by the plugin that owns that object's entity type.
//
// The chat used to file every upload under a project — the page's, else the
// session's — which was wrong twice over: a session's project was a stale
// anchor, and a picture taken for an inventory item was never the project's to
// begin with. So the chat asks the object's owner instead, keyed by the plugin
// id inside the ORef, and only falls back to the project scope when nobody
// claims it. A plugin that registers nothing means "no owner here", which is a
// legitimate answer, not a failure.
//
// The chat saves the bytes (it owns the upload pipeline and the attachment
// rules) and the owner adopts them, so the row that links a file to another
// plugin's record is written by that plugin — never across the seam (§5.10).
export const attachmentTargetCapability = (pluginId: string): string =>
  `attachment-target.${pluginId}`;

export interface AttachmentTargetCapability {
  // The object's display name when it can own files; null when the ref names
  // nothing this plugin files pictures for, or nothing the caller may read.
  // Asked before a file is even sent, to state where it will land.
  describeAttachmentTarget(ref: string): Promise<{ name: string } | null>;
  // Adopt already-stored uploads ("/api/uploads/:id") for that object.
  adoptAttachments(ref: string, urls: readonly string[]): Promise<void>;
}

// Realtime handshake auth offered by the multiuser plugin (consumed by the
// backend-core RealtimeGateway, which cannot import plugin code). While
// multiuser is disabled the capability resolves to null and the gateway
// accepts anonymous connections — mirroring MultiuserGuard's pass-through.
// Registered by `multiuser`; consumed by `exchange` to validate the target of
// an admin per-scope export. Unresolvable (overlay absent/disabled) means no
// scope directory exists — the consumer skips validation.
export const SCOPE_DIRECTORY_CAPABILITY = 'multiuser.scope-directory';

export interface ScopeDirectoryCapability {
  scopeExists(scopeId: string): Promise<boolean>;
}

export const REALTIME_AUTH_CAPABILITY = 'multiuser.realtime-auth';

export interface RealtimeAuthCapability {
  // User id for a valid, current token, null for any invalid/expired/revoked
  // token. Revocation (logout, password reset) bumps a per-user epoch checked
  // against the live row, so it is async (a DB read) — a captured token cannot
  // open a new socket once its epoch is stale (#241).
  verifyToken(token: string): Promise<string | null>;
  // Whether the user may receive events of the given scope (own id, or an
  // active grant on someone else's scope).
  canAccessScope(userId: string, scopeId: string): Promise<boolean>;
  // Full request context for an inbound socket command — the WS analogue of
  // MultiuserGuard's per-request setup (scope access, effective plugin set,
  // resource constraints). Returns null to reject (unknown/deleted user); a
  // stale scope falls back to the user's own, mirroring the guard.
  resolveContext(
    userId: string,
    scopeId: string | undefined,
    locale: string | undefined,
  ): Promise<RealtimeRequestContext | null>;
}

// Guest realtime credential (#79). A device that holds a capability token but
// no user account — the paired phone, whose only credential is its unguessable
// bridge session token — needs push too, otherwise it can only learn about
// desktop-side changes by polling. Registered by the plugin that issues such
// tokens (phone-bridge); resolved by the realtime gateway during the handshake.
//
// Deliberately minimal: a guest socket gets NO user, NO scope, and exactly the
// one room this returns — it can neither subscribe elsewhere nor issue commands.
export const REALTIME_GUEST_AUTH_CAPABILITY = 'realtime.guest-auth';

export interface RealtimeGuestAuthCapability {
  // The single room this credential may join, or null when it names no live
  // session (expired, closed, unknown).
  resolveGuestRoom(credential: string): Promise<string | null>;
}

// Per-kind inbound-message handler a consumer plugin registers so the
// phone-bridge plugin can process what a phone relays for that kind and read
// results back for the desktop poll (#77). The capability id is
// `phone-bridge.kind.<kind>` — build it with `phoneBridgeKindCapability(kind)`.
// Registered by the consumer (e.g. `capture`); resolved by the bridge per
// inbound message / poll. Unresolvable (consumer disabled) ⇒ the bridge drops
// the relay, so disabling the consumer removes exactly its surface.
export const phoneBridgeKindCapability = (kind: string): string =>
  `phone-bridge.kind.${kind}`;

export interface PhoneBridgeKindContext {
  token: string;
  // The owning multiuser user, so a write made outside the phone's request
  // scope (the anonymous relay) can be stamped for the desktop's scoped read.
  // Null when the multiuser overlay is off.
  scopeOwnerId: string | null;
}

export interface PhoneBridgeKindHandler {
  // Process one relayed payload; return the message the phone should echo back
  // (e.g. a saved-photo ref for a thumbnail), or null when nothing to echo.
  onMessage(
    ctx: PhoneBridgeKindContext,
    payload: unknown,
  ): Promise<PhoneBridgeMessage | null>;
  // Messages newer than the cursor, for the desktop poll.
  readResults(
    token: string,
    since: string | undefined,
  ): Promise<{ messages: PhoneBridgeMessage[]; cursor: string }>;
  // Called when the bridge garbage-collects a dead session, so the consumer can
  // drop any transient data it stored under the token (e.g. unclaimed uploads).
  onGarbageCollect?(token: string): Promise<void>;
}

// Bridge-session validation offered by the phone-bridge plugin (#74, consumed by
// `codes`). A phone holds an unguessable session token (the issue #10 capability
// model); a consumer that must expose a `@Public()` phone-facing endpoint can
// require that token and check it here, so the endpoint is usable only from
// within a live bridge session instead of by any anonymous caller. Registered by
// phone-bridge; `null` (bridge disabled/absent) means no live session can exist,
// so the consumer denies — fail closed.
export const PHONE_BRIDGE_SESSION_CAPABILITY = 'phone-bridge.session';

export interface PhoneBridgeSessionCapability {
  // True when the token names a currently-open (pending/active, unexpired)
  // bridge session — the same liveness check the phone routes apply.
  isActiveSession(token: string): Promise<boolean>;
}

// The Cloudflare tunnel, offered by the phone-bridge plugin to whoever needs a
// phone-reachable address. The MOBILE plugin consumes it: on an instance with no
// permanent HTTPS the tunnel is the only way a phone can reach the surface at
// all. Resolved per call — `null` (phone-bridge disabled or absent) means there
// is no tunnel to be had, so the mobile side degrades rather than guesses.
//
// phone-bridge does not learn that the mobile plugin exists; it publishes a
// capability, as it already does for session liveness and realtime guest auth.
export const PHONE_BRIDGE_TUNNEL_CAPABILITY = 'phone-bridge.tunnel';

export interface PhoneBridgeTunnelCapability {
  // Configured to run at all (mode is not `off`) and the binary is present.
  tunnelUsable(): Promise<boolean>;
  // The live tunnel URL, or null when nothing is running right now.
  currentTunnelUrl(): Promise<string | null>;
  // Bring a tunnel up if the mode allows it. `freshlyStarted` matters to the
  // caller: a tunnel that has just come up is not reachable yet — its DNS name
  // takes seconds to propagate — so whoever is about to show a QR has to hold it
  // for a warm-up, exactly as the bridge's own QR does.
  ensureTunnel(): Promise<{ url: string | null; freshlyStarted: boolean }>;
  // Report that the tunnel is being used right now. Its idle timer only counts
  // bridge sessions, so anything else riding it has to keep it alive or the
  // tunnel stops under a person who is still working.
  touch(): void;
}

// Raw-code resolution for the universal scanner (#74). A scanned string that is
// neither a canonical ORef nor one of our own short label codes (e.g. a
// manufacturer barcode / SKU printed on the part) is handed to whichever plugin
// can map it to an object. The `codes` plugin resolves this capability per scan
// and treats `null` (unregistered or owner disabled) as "no mapping" — so the
// feature degrades cleanly when the resolving plugin (e.g. inventory) is off.
// Registered by the resolving plugin (inventory maps SKU → component ORef).
export const CODES_RAW_RESOLVE_CAPABILITY = 'codes.raw-resolve';

export interface CodesRawResolveCapability {
  // Map a raw scanned string to a canonical ORef, or null when unknown.
  resolveRawCode(value: string): Promise<string | null>;
}

// ── Events ──────────────────────────────────────────────────────────────────

// Emitted by logistics wherever an order flow changes physical stock (receive,
// reversal on edit/delete, return). The inventory plugin listens and applies
// the delta to its `Component`/`StockMovement` ledger; while inventory is
// disabled the event goes unhandled and stock is simply not tracked (disable
// removes the owner's functionality, never blocks the emitter's flow).
export const LOGISTICS_STOCK_ADJUST_EVENT = 'logistics.stock.adjust';

// Emitted by projects when a BOM link with reserved stock is removed. The
// inventory plugin listens and releases the reservation back to free stock;
// while inventory is disabled nothing tracks stock, so nothing happens.
export const PROJECTS_COMPONENT_UNLINKED_EVENT = 'projects.component.unlinked';

// Emitted by whoever removes a SCOPE — the multiuser overlay deleting a user,
// which is what a scope is. Anything holding per-scope data listens and drops
// it; the external-plugins host relays it to third-party containers, which is
// the only way their storage can ever be told (the core cannot reach into it).
//
// Emitted AFTER the deleting transaction commits, so a rollback can never tell
// a listener to destroy data that still exists. That leaves a crash window in
// which the announcement is lost; closing it needs the outbox row written in
// the same transaction, which the inter-plugin bus cannot yet carry — see #189.
export const CORE_SCOPE_DELETED_EVENT = 'core.scope-deleted';

// Emitted by inventory once a newly created item's category-property values are
// stored (#205). Inventory announces WHAT the item was filled in with — with
// inheritance along the category chain already resolved, which only it can do —
// and takes no interest in who cares. The tags plugin listens and turns the
// values of the properties IT has marked as tag sources into tags; with tags
// disabled the bus skips the listener and nothing happens.
//
// Deliberately not named `inventory.item.created`: that string already belongs
// to the external event catalogue (`external/external-events.ts`), a separate
// vocabulary aimed at third-party containers, and reusing it here would read as
// one event when it is two.
export const INVENTORY_ITEM_PROPERTY_VALUES_EVENT =
  'inventory.item.property-values-set';

export interface InventoryItemPropertyValuesEvent {
  // Canonical ORef of the item the values belong to.
  itemRef: string;
  // One entry per property that actually holds a value; `propertyRef` is the
  // property's own canonical ORef, which is how a listener names it without
  // knowing anything about inventory's tables.
  values: Array<{ propertyRef: string; value: string }>;
}

export interface CoreScopeDeletedEvent {
  scopeId: string;
}

export interface ProjectsComponentUnlinkedEvent {
  projectId: string;
  // Resolved by the emitter for the ledger note.
  projectTitle: string;
  componentId: string;
  reservedQty: number;
}

// ── Contextual scan actions (#79) ─────────────────────────────────────────
// A host that mounts codes' contextual scan button (via `manifest.codes.scan`)
// declares WHAT a scanned code may do in that context. The declaration travels
// to the phone as the session's bootstrap `data`, so the confirmation happens
// where the user is — at the shelf — instead of on the desktop they are not
// looking at. The phone only picks an action; the desktop applies it (the phone
// carries no user credential, only the session token).

export interface PhoneBridgeScanAction {
  // Stable key echoed back with the scanned value; the host dispatches on it.
  key: string;
  // i18n key for the phone's confirm button, resolved in the phone's own locale.
  labelKey: string;
  // Interpolation params for `labelKey` (e.g. the cell address).
  labelParams?: Record<string, string | number>;
  // ORef entityTypes this action accepts. The phone compares them against the
  // preview's resolved ref and disables the action for anything else, so a
  // mis-scan is caught before it is relayed. Omitted = any resolvable object.
  entityTypes?: string[];
}

// The `data` a scan session carries to the phone surface.
export interface PhoneBridgeScanSessionData {
  actions: PhoneBridgeScanAction[];
}

// Narrow through a partial-unknown view, never through the target type itself:
// asserting to `PhoneBridgeScanAction` would make the checks tautological (§5.1).
// Mirrors the `isScanPayload`/`isScanMessage` guards in the codes plugin.
const isScanAction = (value: unknown): value is PhoneBridgeScanAction =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { key?: unknown }).key === 'string' &&
  typeof (value as { labelKey?: unknown }).labelKey === 'string';

// Session data arrives over the public phone route, so it is untrusted JSON:
// narrow it rather than assuming the desktop wrote it (§5.1).
export const isPhoneBridgeScanSessionData = (
  value: unknown,
): value is PhoneBridgeScanSessionData =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { actions?: unknown }).actions) &&
  (value as { actions: unknown[] }).actions.every(isScanAction);

// Called once per confirmed scan (a session relays many — #79 batch mode). The
// codes plugin has already resolved the raw string to a canonical ORef (`null`
// when nothing matches), so the host never has to resolve codes itself.
// `actionKey` is null when the phone had no action to offer. One named type: the
// same signature travels through the slot ctx, the trigger and the session store.
export type ScanResultHandler = (
  ref: string | null,
  actionKey: string | null,
  rawValue: string,
) => void;

// The ctx a host passes to the slot it declared in `manifest.codes.scan.slot`.
// The host never imports the codes plugin: it only describes the offered
// actions and receives the chosen one back.
export interface ScanContextSlotCtx {
  actions?: PhoneBridgeScanAction[];
  // Canonical ORef of the object this scan is FOR (the storage cell). It is how
  // a trigger recognises the running session as its own after the view was
  // unmounted and rebuilt — component identity does not survive navigation, an
  // object's path does. Also matched by the status indicator.
  originRef?: string;
  onScan?: ScanResultHandler;
  // Label shown on the phone for the session as a whole, already i18n-resolved.
  contextLabel?: string;
}

// ── Storage cell action slot (#79) ────────────────────────────────────────
// `storages.cell.actions` — rendered by storages for the currently open grid
// cell. Plugins that own what LIVES in a cell (inventory owns a component's
// placement) contribute their actions here; storages never writes another
// plugin's models, and the slot is simply empty when no such plugin is enabled.
export interface StorageCellActionsSlotCtx {
  storageId: string;
  // 0-indexed grid coordinates, as persisted on the placed entity.
  row: number;
  col: number;
  // Human-readable cell address ("B1"), for labels shown to the user.
  cellAddress: string;
  // Canonical ORef of the cell (the storage ref with a "#B1" fragment).
  cellRef: string;
  // Contributors call this after they changed what is in the cell, so the host
  // reloads its listing.
  onChanged: () => void;
}

// ── Phone sign-in slot (#207) ─────────────────────────────────────────────
// `mobile.auth.password` — rendered by the mobile plugin on the phone's own
// sign-in screen, filled by whichever plugin owns passwords (multiuser). The
// phone shell owns the SURFACE (a screen inside the shell, reached without a
// credential) and knows nothing about how a person is authenticated; the auth
// owner owns the FORM and knows nothing about phones or device tokens.
//
// This is why the screen is empty of its own accord in single-user mode, where
// there are no passwords: no contributor, no form — not a gate the host has to
// remember to write.
export interface MobileAuthSlotCtx {
  // Called once the visitor is authenticated. The host takes it from there —
  // on a phone that means trading the fresh session for a device token that
  // outlives it, which is the mobile plugin's business, not the auth owner's.
  onAuthenticated: () => void;
}

// ── App-header slots (#277) ───────────────────────────────────────────────
// What a contribution into one of the app header's slots may declare about
// itself. The header collapses controls it cannot fit into the avatar menu
// (#274), where a control needs a name it did not need in the row; `labelKey`
// is that name — an i18n key in the CONTRIBUTOR's own bundle, resolved by the
// shell (bundles are merged globally, external ones namespaced at bootstrap).
// Undeclared, the shell falls back to the plugin's registry name key. Nothing
// else is declarable: rank belongs to the slot, order within it to the
// contribution's existing `order`, and a compact form is discovered from the
// rendered markup (`data-compact-drop`), not declared.
export interface HeaderItemMeta {
  labelKey: string;
}

// A guard, not a cast: contribution `meta` is `Record<string, unknown>`, and
// for an external plugin it genuinely arrives from manifest JSON.
export function isHeaderItemMeta(value: unknown): value is HeaderItemMeta {
  return (
    typeof value === 'object' &&
    value !== null &&
    'labelKey' in value &&
    typeof value.labelKey === 'string'
  );
}

// ── Tag slots (#60) ───────────────────────────────────────────────────────
// The tags plugin injects its UI into other plugins' views through named slots
// (docs/plugins.md §8). These interfaces are the `ctx` contract each host passes
// to `<PluginSlot>`: the host names the object being tagged by its canonical
// ORef and never imports the tags plugin. When tags is disabled the slot renders
// nothing, so hosts degrade cleanly.

// Chips (and, when `editable`, an inline add/remove editor) for ONE entity.
export interface TagChipsSlotCtx {
  // Canonical ORef of the tagged object (a storage cell carries its #fragment).
  entityRef: string;
  // Show the add-tag control and per-chip remove buttons. Read-only when absent.
  editable?: boolean;
  // Denser rendering for list rows/cards (no add control).
  compact?: boolean;
}

// A tag filter for a list view. The host stays route-driven: it owns the
// selected tag id (from `route.query.tag`) and its own filtering, and receives
// the matching entity ids to AND into its predicate. `onMatches(null)` means the
// filter is inactive (no tag chosen); a set of ids means "keep only these".
export interface TagFilterSlotCtx {
  pluginId: string;
  entityType: string;
  selectedTagId: string | null;
  onSelect: (tagId: string | null) => void;
  onMatches: (entityIds: string[] | null) => void;
}

// "The value of this field also becomes a tag" (#205), for a field the HOST
// owns. The host says nothing more than which field it is and what kind of
// value it holds; whether that kind can be a tag at all, how the marking is
// stored, and what happens on creation are entirely the tags plugin's business.
//
// The contribution persists itself against the tags plugin's API, like
// TagChipsSlot does — the host neither carries the value in its own save
// payload nor keeps a column for it.
export interface TagSourceSlotCtx {
  // Canonical ORef of the field, or null while it is still being created: a
  // field that does not exist yet cannot be named.
  fieldRef: string | null;
  // What the field holds, so tags can refuse kinds that make useless tags.
  // Free-form by design: the host names its own value kinds, and a kind tags
  // does not recognise is simply not offered. Reactive — a form where the kind
  // is still being chosen changes it under the contribution.
  valueKind: string;
  // Offered ONLY by a host rendering this inside its own create/edit form.
  //
  // This is what makes an editable contribution possible in a form for an
  // entity that does not exist yet, which is otherwise the hard case: the
  // contribution hands back a function, and the host calls it with the field's
  // ref once the field is actually saved. Cancel the form and it is never
  // called, so nothing is written — the contribution inherits the host's
  // Save/Cancel semantics without either side knowing what the other stores.
  //
  // Absent ⇒ read-only surface (a list row): show the state, do not edit it.
  onReady?: (commit: SlotFieldCommit) => void;
}

// Runs once the host's field exists. Must not throw: the host has already
// saved, and a contribution's problem cannot undo that.
export type SlotFieldCommit = (fieldRef: string) => Promise<void>;

export interface LogisticsStockAdjustEvent {
  componentId: string;
  // Signed stock delta: positive when goods arrive, negative on reversal/return.
  delta: number;
  movementType: 'PURCHASE' | 'ADJUSTMENT' | 'RETURN';
  orderId: string | null;
  // Ledger note, already resolved by the emitter's i18n (persisted verbatim).
  note: string;
  // Fill-if-empty placement: when adding stock and the component has no storage
  // yet, it inherits this destination (an already-placed component never moves).
  destinationStorageId?: string | null;
}
