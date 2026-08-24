import { createHmac } from 'node:crypto';

// The opaque user reference a plugin sees (#156).
//
// HMAC over the user id with a salt that belongs to ONE plugin, truncated to
// something a person can eyeball in a log. Three properties matter, and each
// is a deliberate cost:
//
//   * stable — the same person is the same string forever, so a plugin can
//     store data under it (which is why the salt is never rotated);
//   * per-plugin — two plugins holding refs for the same person cannot tell
//     that they do, so installing one plugin does not leak into another;
//   * one-way — a ref never yields a user id, a name or an email, so a
//     third-party container learns that someone is the same someone and
//     nothing else about them.
//
// It is NOT an authorization input: what a caller may do is decided by the
// core from the delegated token, never by a plugin comparing refs.
export const deriveUserRef = (salt: string, userId: string): string =>
  createHmac('sha256', salt).update(userId).digest('base64url').slice(0, 22);

// The opaque scope reference a plugin sees (decision #5: "an opaque, stable
// scopeId"). Same construction and the same three properties as the user ref
// above — stable, per-plugin, one-way — because a scope id IS a user id in the
// multiuser overlay, and handing it out raw would leak exactly what the user
// ref exists to hide. The `scope\0` prefix domain-separates the two HMACs so
// a plugin holding both refs for the same person still cannot match them.
export const deriveScopeRef = (salt: string, scopeId: string): string =>
  createHmac('sha256', salt)
    .update(`scope\0${scopeId}`)
    .digest('base64url')
    .slice(0, 22);

// Who the caller is, for the purpose of the reference above.
//
// A single-user instance has no user ids — the multiuser overlay is what
// introduces them — but it does have exactly ONE person, and a plugin that
// separates "mine" from "everyone's" must work there too. Without this,
// per-person plugins were dead on the default deployment: no user id meant no
// reference, and every screen fell back to "signed out, nothing to show".
//
// The distinction that matters is not "is there a user id" but "is there a
// PERSON at the other end". A background job has a context and no person, and
// must never be handed one, or a plugin will attribute a scheduled action to
// whoever last happened to trigger something.
export const SINGLE_USER_ID = 'mk:single-user';

export const callerUserId = (
  ctx: { userId?: string; systemBypassReason?: string } | undefined,
): string | null => {
  if (!ctx) return null;
  if (ctx.userId) return ctx.userId;
  // Trusted internal work (exports, rollups, admin cross-user reads) is not a
  // person even when it runs inside a request.
  if (ctx.systemBypassReason) return null;
  return SINGLE_USER_ID;
};
