// What may be attached to a chat message (#112), and the verdict machinery both
// tiers share. The frontend rejects at drop time so the user learns instantly
// why a file bounced; `sendMessage` re-validates because the ruleset belongs to
// the owner of the ACTIVE connection, which can change between attaching and
// sending. One matcher, so the two answers can never drift apart.
//
// The list is deliberately DECLARATIVE — it matches what a file claims to be
// (mime + extension), not what its bytes turn out to hold. "May this be
// attached" is the user's decision; "is this actually a picture" is a fact
// probed on ingest (`Attachment.isImage`, #113) and answered elsewhere. Keeping
// them separate is why an `image/heic` upload can pass an `image/*` mask and
// still be treated as a plain file everywhere downstream.
//
// Extensions are load-bearing, not a convenience: a file picked through the
// Files tab arrives with an empty `File.type`, so `.gcode`/`.scad`/`.ino` land
// in storage as `application/octet-stream`. A mime-only list would reject
// exactly the text formats this feature exists for.

export interface AttachmentRules {
  // Mime masks (`text/*`) and exact mime types (`application/json`).
  mimeTypes: string[];
  // Lowercase, dot-less filename extensions.
  extensions: string[];
  // Cap for non-images only. Images are exempt: what reaches the model is the
  // `lg` rendition (#113), so an original's weight costs no tokens.
  maxNonImageBytes: number;
  // How much text `read_attachment` hands the model in one call.
  maxReadBytes: number;
}

export const DEFAULT_ATTACHMENT_MIME_TYPES: readonly string[] = [
  'image/*',
  'text/*',
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/toml',
  'application/csv',
];

export const DEFAULT_ATTACHMENT_EXTENSIONS: readonly string[] = [
  // data & configuration
  'txt',
  'md',
  'csv',
  'tsv',
  'json',
  'xml',
  'yml',
  'yaml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'log',
  // fabrication / textual CAD. `stl` is admitted although it may be binary:
  // the list admits, the UTF-8 decode rejects with an honest verdict.
  'gcode',
  'gco',
  'nc',
  'scad',
  'stl',
  'obj',
  'svg',
  // firmware sketches & scripts
  'ino',
  'py',
  'js',
  'ts',
  'c',
  'h',
  'cpp',
  'sh',
  'sql',
];

export const DEFAULT_MAX_NON_IMAGE_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MAX_READ_BYTES = 64 * 1024;

// Guard rails for the two numbers, so a typo in the settings form cannot
// disable the protection or blow a turn's context. Declared here because two
// tiers must agree on them: the DTO rejects an out-of-range value at the edge,
// the service clamps whatever survives (an older client, an import). Split
// bounds would let the DTO accept what the service silently rewrites.
export const MIN_ATTACHMENT_LIMIT_BYTES = 1024;
export const MAX_MAX_NON_IMAGE_BYTES = 512 * 1024 * 1024;
export const MAX_MAX_READ_BYTES = 4 * 1024 * 1024;

export const DEFAULT_ATTACHMENT_RULES: AttachmentRules = {
  mimeTypes: [...DEFAULT_ATTACHMENT_MIME_TYPES],
  extensions: [...DEFAULT_ATTACHMENT_EXTENSIONS],
  maxNonImageBytes: DEFAULT_MAX_NON_IMAGE_BYTES,
  maxReadBytes: DEFAULT_MAX_READ_BYTES,
};

// Why a candidate was refused. The i18n key that voices each reason lives with
// the surface that shows it; the verdict itself carries only the facts needed
// to fill that message in.
export type AttachmentRejection =
  | { reason: 'format'; filename: string; mimeType: string }
  | {
      reason: 'size';
      filename: string;
      sizeBytes: number;
      maxBytes: number;
    };

// The verdict is "the rejection, or nothing". An `{ allowed: boolean }` wrapper
// would read no better and narrows badly: the backend compiles without
// `strictNullChecks`, where a boolean discriminant does not narrow a union at
// all, while `reason` — a string literal — narrows in every config.

export interface AttachmentCandidate {
  filename: string | null;
  mimeType: string;
  sizeBytes: number;
  // Whether the bytes decode as an image (`Attachment.isImage`). Undefined
  // before the file is stored — the frontend gate only knows what the browser
  // claims, and errs toward the mime prefix.
  isImage?: boolean | null;
}

// One stored attachment, as every tier that merely SHOWS it needs it: the URL
// to fetch it by, plus enough to render a chip and answer the picture question
// without opening the file.
//
// Declared once because the same five fields travel the whole way — the drag
// handshake, the project-files picker, the session history payload and the
// composer's own metadata map all carried private copies before, and a copy
// that drifts turns into a non-image requested as a picture (which serves the
// original, i.e. downloads the whole file to paint a broken icon).
//
// `isImage` narrows to a plain boolean here: a descriptor describes something
// already stored, so the probe (#113) has run and "unknown" is not a state it
// can be in — unlike `AttachmentCandidate`, which also covers a file the
// browser has merely been handed.
export interface AttachmentDescriptor extends AttachmentCandidate {
  url: string;
  isImage: boolean;
}

// What a history says about ONE attachment URL it references (#127).
//
// A descriptor list built from the rows that resolved is not an answer: a URL
// with no descriptor is indistinguishable on the client from "metadata has not
// arrived yet", so a deleted attachment kept rendering as a live download link
// — and the browser saved the 404's JSON body as a file. The list is therefore
// TOTAL over the URLs a history references, and each entry says which of the
// two states it is in.
//
// `missing` keeps the filename when the row outlived its bytes, so the bubble
// can still name what is gone; nothing else is reported, because nothing else
// is known to be true of a file that is not there.
export type AttachmentPresence =
  | ({ status: 'available' } & AttachmentDescriptor)
  | { status: 'missing'; url: string; filename: string | null };

export function isAvailableAttachment(
  presence: AttachmentPresence,
): presence is { status: 'available' } & AttachmentDescriptor {
  return presence.status === 'available';
}

// Lowercase extension of a filename, without the dot; empty when it has none.
export function attachmentExtension(filename: string | null): string {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

// A rule entry matches a mime type either exactly or as a `type/*` mask.
function mimeMatches(rule: string, mimeType: string): boolean {
  const candidate = mimeType.toLowerCase().split(';')[0].trim();
  const pattern = rule.toLowerCase().trim();
  if (pattern.endsWith('/*')) {
    return candidate.startsWith(pattern.slice(0, -1));
  }
  return pattern === candidate;
}

// The picture question, answered the same way in every layer: the probe wins,
// the declared mime is the fallback for anything not yet probed.
export function isPictureAttachment(candidate: AttachmentCandidate): boolean {
  return (
    candidate.isImage ?? candidate.mimeType.toLowerCase().startsWith('image/')
  );
}

// The same question in the query dialect, for the layers that must ask it of
// rows they never load (#122). Declared HERE, beside the JS rule it mirrors,
// because the two spellings drifted once already: a hand-written
// `isImage: { not: false }` reads as "keep the nulls too" and does the
// opposite — SQL compares NULL to `false` as NULL, i.e. not a match, so every
// row that predates the probe (#113) silently vanished from the result.
//
// The null arm therefore carries the mime fallback explicitly, which is what
// makes this an exact mirror rather than an approximation:
//   isImage = true          → a picture (the probe decoded it)
//   isImage = false         → not a picture, whatever the mime claims
//   isImage IS NULL         → not probed yet; believe the declared mime
//
// `mode: 'insensitive'` because the JS rule lowercases before comparing while
// SQL `LIKE` would not, and a mime is stored verbatim as the uploader spelled
// it — without it, an `IMAGE/PNG` row would be a picture in one dialect and
// not in the other, which is the very drift this pairing exists to prevent.
//
// Structurally typed on purpose: the contract is framework-agnostic and must
// not depend on Prisma, but the fragment is a plain object a `where` accepts.
export interface PictureAttachmentWhere {
  OR: [
    { isImage: true },
    {
      isImage: null;
      mimeType: { startsWith: string; mode: 'insensitive' };
    },
  ];
}

export const PICTURE_ATTACHMENT_WHERE = {
  OR: [
    { isImage: true },
    { isImage: null, mimeType: { startsWith: 'image/', mode: 'insensitive' } },
  ],
} satisfies PictureAttachmentWhere;

// One picture of a record that owns a set of them, as its API payload carries
// it (#212). `isCover` is the RESOLVED answer — the pin when it still resolves,
// else the first picture — so no consumer re-derives the fallback.
//
// It lives HERE, in the contract, because both ends need the same shape and
// neither may import the other: the backend store produces it, a plugin's Vue
// form consumes it, and the two declaring it separately is how a payload and
// its reader drift.
export interface OwnedPhoto {
  id: string;
  url: string;
  isCover: boolean;
}

export function isAttachmentFormatAllowed(
  candidate: AttachmentCandidate,
  rules: AttachmentRules,
): boolean {
  if (rules.mimeTypes.some((rule) => mimeMatches(rule, candidate.mimeType))) {
    return true;
  }
  const ext = attachmentExtension(candidate.filename);
  if (!ext) return false;
  return rules.extensions.some((rule) => rule.toLowerCase().trim() === ext);
}

// Null when the file may be attached; otherwise why it may not.
export function checkAttachment(
  candidate: AttachmentCandidate,
  rules: AttachmentRules,
): AttachmentRejection | null {
  const filename = candidate.filename ?? '';
  if (!isAttachmentFormatAllowed(candidate, rules)) {
    return { reason: 'format', filename, mimeType: candidate.mimeType };
  }
  // The size cap is a non-image rule: vision reads the `lg` rendition (#113),
  // so an original's weight never reaches a provider.
  if (
    !isPictureAttachment(candidate) &&
    candidate.sizeBytes > rules.maxNonImageBytes
  ) {
    return {
      reason: 'size',
      filename,
      sizeBytes: candidate.sizeBytes,
      maxBytes: rules.maxNonImageBytes,
    };
  }
  return null;
}

// Byte size for humans. Lives in the contract because the same number is
// spoken by three tiers that must agree: the composer's rejection toast, the
// server's rejection message and the file chip. Unit tokens are technical
// symbols, not prose, so they stay literal (the same call the Files tab makes).
export function formatByteSize(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, exp);
  return `${exp === 0 ? value : value.toFixed(1)} ${units[exp]}`;
}

// The interpolation values a rejection message needs, already formatted.
//
// The KEY stays with the surface that shows it (see `AttachmentRejection`) —
// the composer's toast and the server's thrown error are different sentences
// in different tiers. What must not differ is the numbers inside them: both
// used to call `formatByteSize` on both sizes by hand, which is exactly the
// kind of duplication that drifts into "2.0 MB" versus "2097152".
//
// `filename` is passed in already resolved: each tier voices "unnamed file" in
// its own way (`t()` on the client, `PluginI18nService` on the server).
export function attachmentRejectionParams(
  rejection: AttachmentRejection,
  filename: string,
): Record<string, string> {
  return rejection.reason === 'format'
    ? { filename, mimeType: rejection.mimeType }
    : {
        filename,
        size: formatByteSize(rejection.sizeBytes),
        max: formatByteSize(rejection.maxBytes),
      };
}

// Normalises a user-edited list: trimmed, lowercased, de-duplicated, leading
// dots dropped so "`.gcode`" typed out of habit still means `gcode`.
export function normaliseAttachmentRuleList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim().toLowerCase().replace(/^\./, '');
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
