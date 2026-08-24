// Shared payload shapes for the tags plugin (#60) — declared once so the NestJS
// controller and the Vue frontend agree on the wire format (CLAUDE.md backend
// quality bar: shared payloads live in a shared types module).

// Hard cap on a tag name, enforced identically on every create/rename path:
// the DTO (@MaxLength), the service (i18n-keyed error for the agent/picker
// paths that bypass the DTO), and the form inputs (`maxlength`).
export const TAG_NAME_MAX = 48;

// A tag as returned to the UI. `ref` is the tag's own canonical ORef
// (mk://tags/tag/<id>), so it flows through the ObjectRef link machinery like
// any other entity. `usageCount` is how many objects currently carry the tag.
// `color` is either a palette tone (see TAG_COLORS) or a user-picked "#rrggbb"
// hex — the chip renders each accordingly.
export interface TagDto {
  id: string;
  name: string;
  color: string;
  usageCount: number;
  ref: string;
}

// One object a tag is attached to, resolved for display. `displayName`/
// `breadcrumb` are null when the owning plugin is disabled (the object exists
// but can't be resolved right now); links to unresolvable objects are omitted by
// the UI. Rows whose target no longer exists are pruned server-side, never returned.
export interface TaggedObjectDto {
  ref: string;
  displayName: string | null;
  breadcrumb: string | null;
}

// Batch response for chips: tags keyed by the object ORef they are attached to.
export type TagsForRefsResult = Record<string, TagDto[]>;
