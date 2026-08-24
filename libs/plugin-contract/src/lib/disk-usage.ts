// What is using the disk (#120).
//
// Since #113 the backend keeps the ORIGINAL of every uploaded image from every
// surface, plus up to three derivatives — where three of those four surfaces
// used to downscale on the client and hand the server a ~300 KB copy. Growth is
// therefore several-fold and unbounded, on a product that is routinely
// self-hosted on a small VPS. Before deciding what (if anything) ages out, an
// admin needs to see where the bytes actually are; this report is that view, and
// deliberately nothing more — it recommends nothing and deletes nothing.

export interface DiskUsageBucket {
  bytes: number;
  files: number;
}

// What one plugin's uploads occupy, split the way the two costs differ: an
// original cannot be recovered, a derivative can be rebuilt from it at any
// time. Only the crossing answers the question an admin actually has — "how
// much of this is chat originals" — which either axis alone leaves unanswered.
export interface DiskUsageByOwner {
  // The plugin that declared the upload, or null for rows written before the
  // declaration existed and not attributable from their id columns. Reported
  // as undetermined rather than folded into somebody else's total.
  pluginId: string | null;
  originals: DiskUsageBucket;
  derivatives: DiskUsageBucket;
}

// Rows grouped by the scope that owns them. `scopeId` is null for rows that
// predate the multiuser overlay (or exist without it) — kept as its own group
// rather than folded into a total, because "nobody owns these yet" is exactly
// what an admin wants to notice.
export interface DiskUsageByScope extends DiskUsageBucket {
  scopeId: string | null;
}

// Outcome of sweeping the files no record claims. The only cleanup that needs
// no retention policy: an unreferenced file is reachable by nothing, whereas an
// original cannot be recovered once gone.
export interface DiskCleanupResult {
  deleted: DiskUsageBucket;
  // Left alone as too young to judge. A file written seconds before the sweep
  // may simply be an upload whose row is not committed yet — deleting that
  // would destroy live data, so recency wins over tidiness.
  skippedRecent: number;
  // Could not be removed (permissions, a vanished parent). Reported rather than
  // swallowed, so a sweep that frees nothing says why.
  failed: number;
}

// A subtree a plugin declared as its own, with what it currently occupies.
export interface DiskReservedArea extends DiskUsageBucket {
  path: string;
  pluginId: string;
}

// How a file (or a whole directory, rolled up) relates to the app.
//   claimed  — an attachment record points at it; never deletable here
//   orphan   — the attachment store wrote it, no record claims it
//   unowned  — nobody wrote it that we know of; deletable by explicit choice
//   reserved — inside a subtree a plugin declared; never deletable here
//   mixed    — a directory whose contents disagree
export type DiskEntryKind =
  | 'claimed'
  | 'orphan'
  | 'unowned'
  | 'reserved'
  | 'mixed';

// One row of the storage browser: a file, or a directory rolled up to what it
// contains. Directory rollups are what keep the view usable — a month of
// uploads is one line, not four thousand.
export interface DiskBrowseEntry extends DiskUsageBucket {
  name: string;
  // Root-relative, POSIX-separated.
  path: string;
  isDirectory: boolean;
  kind: DiskEntryKind;
  // Set when `kind` is 'reserved': which plugin declared the subtree.
  reservedBy?: string;
  // Files only.
  modifiedAt?: string;
  // Bytes that a deletion of this row would actually free: claimed and reserved
  // contents are excluded, so a directory row is honest about the part of it
  // that would survive.
  deletableBytes: number;
  deletableFiles: number;
}

export interface DiskBrowseResult {
  // The directory being listed, root-relative ('' is the uploads root itself).
  path: string;
  // Null at the root.
  parentPath: string | null;
  entries: DiskBrowseEntry[];
  // Set when the level held more entries than one screen may carry and the
  // list below was cut. Reported rather than silent: a truncated list that
  // looks complete turns "select everything here" into a claim the UI cannot
  // keep.
  truncated: boolean;
}

// What a deletion actually did. Every count is reported rather than folded into
// a single number: "deleted 3, kept 2 claimed, 1 reserved" is a different story
// from "deleted 3", and the admin needs the difference.
export interface DiskDeleteResult {
  deleted: DiskUsageBucket;
  skippedClaimed: number;
  skippedReserved: number;
  skippedRecent: number;
  missing: number;
  failed: number;
}

export interface DiskUsageReport {
  // Absolute uploads root, so the number can be checked against `du` by hand.
  root: string;
  // Everything under the root, whether or not a row claims it.
  total: DiskUsageBucket;
  originals: DiskUsageBucket;
  derivatives: DiskUsageBucket;
  // On disk, claimed by no row. A derivative can always be regenerated; these
  // are what a cleanup would take first, which is why they are counted apart.
  unreferenced: DiskUsageBucket;
  // The same bytes split by what a sweep would actually do. Reported separately
  // because the totals differ: offering one number and deleting another is how
  // "free 2.5 MiB" becomes "deleted 0 files" and the button stops being trusted.
  unreferencedPurgeable: DiskUsageBucket;
  unreferencedRecent: DiskUsageBucket;
  // Subtrees another plugin declared as its own (UploadsReservationService) —
  // the phone-bridge's tunnel client, for instance. Counted, labelled by owner,
  // and never deletable from here: the owning plugin manages them.
  reserved: DiskUsageBucket;
  reservedAreas: DiskReservedArea[];
  // Under the root, written by neither the attachment store nor a declared
  // owner. Junk accumulates here too (a half-downloaded file, last release's
  // binary), so it is deletable — but only by explicit selection, never by the
  // one-click sweep, which sticks to files the store itself wrote.
  unowned: DiskUsageBucket;
  // How long a file must sit unclaimed before a sweep may take it, so the UI
  // can state the rule instead of hardcoding a number that could drift.
  orphanGraceHours: number;
  // Rows whose file is gone from disk. Not a disk cost — a consistency signal,
  // and the reason `total` can be smaller than originals + derivatives suggests.
  missingFiles: number;
  // Largest first; a plugin that stores nothing is absent rather than a zero.
  byOwner: DiskUsageByOwner[];
  byScope: DiskUsageByScope[];
  generatedAt: string;
}
