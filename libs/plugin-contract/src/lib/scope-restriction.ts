// Contract for plugin-announced data-level scope restrictions (multi-user
// mode). A plugin that can meaningfully narrow a shared scope (e.g. "share
// only project X", "share only storage subtree Y") announces HOW via a
// descriptor: what the restrictable resource is, how to list the candidate
// items for the sharing UI, and how a selection translates into Prisma
// where-fragments per model. The multiuser overlay consumes descriptors
// generically — plugins never depend on the overlay, only on this contract.

// One pickable item in the sharing UI (e.g. a project title, a storage name).
export interface RestrictableResourceOption {
  id: string;
  label: string;
}

// A plain Prisma where-fragment for one model. Deliberately opaque: the
// enforcement layer merges it under AND without interpreting its shape.
export type ModelWhereFragment = Record<string, unknown>;

// Prisma model name (e.g. "Task") → the where-fragment that confines that
// model to the selected resources.
export type ModelConstraintMap = Record<string, ModelWhereFragment>;

// What a plugin registers to make one of its resource types restrictable.
export interface ScopeRestrictionDescriptor {
  // The announcing plugin.
  pluginId: string;
  // Stable key of the resource type within the plugin (e.g. "project").
  resourceKey: string;
  // i18n key for the sharing-UI section title.
  labelKey: string;
  // Candidate items inside the OWNER's scope, for the sharing-UI pick list.
  listOptions(ownerScopeId: string): Promise<RestrictableResourceOption[]>;
  // Translate the owner's selection into per-model where-fragments. Async on
  // purpose: some plugins expand the selection first (e.g. storage subtrees).
  buildModelConstraints(
    ownerScopeId: string,
    selectedIds: string[],
  ): Promise<ModelConstraintMap>;
}
