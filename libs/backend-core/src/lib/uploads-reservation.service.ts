import { Injectable, Logger } from '@nestjs/common';

// Who owns what inside the uploads root (#120).
//
// The root is a writable directory the APP owns, not one the attachment store
// owns: the phone-bridge keeps its downloaded cloudflared binary in `_bin/`,
// and the next plugin needing a scratch area will do the same. The storage
// admin page offers unclaimed files for deletion, so "somebody else put this
// here on purpose" has to be a declaration in code rather than a guess —
// otherwise the cleanup either deletes a live dependency or, if it plays safe
// with a blanket exclusion, hides real junk behind it.
//
// A plugin declares its area once, in `onModuleInit()`:
//   this.reservations.reserve('phone-bridge', '_bin');
// Reserved subtrees are labelled in the report and never offered for deletion.
// Everything else unclaimed is honestly unowned — and deletable.

export interface UploadsReservation {
  pluginId: string;
  // Root-relative, POSIX-separated, no leading or trailing slash.
  path: string;
}

@Injectable()
export class UploadsReservationService {
  private readonly logger = new Logger(UploadsReservationService.name);
  private readonly reservations = new Map<string, UploadsReservation>();

  reserve(pluginId: string, path: string): void {
    const normalized = normalize(path);
    if (!normalized) {
      this.logger.warn(
        `Ignoring empty uploads reservation from plugin "${pluginId}".`,
      );
      return;
    }
    const existing = this.reservations.get(normalized);
    if (existing && existing.pluginId !== pluginId) {
      // Two owners for one subtree is a bug in one of them; keep the first and
      // say so rather than letting the second silently take over.
      this.logger.warn(
        `Uploads path "${normalized}" is already reserved by "${existing.pluginId}"; ignoring "${pluginId}".`,
      );
      return;
    }
    this.reservations.set(normalized, { pluginId, path: normalized });
  }

  list(): UploadsReservation[] {
    return [...this.reservations.values()].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
  }

  // Which plugin reserved the subtree this path sits in, if any. Matches the
  // reserved path itself and anything beneath it — a reservation covers a
  // subtree, not a single name.
  ownerOf(relativePath: string): string | null {
    const target = normalize(relativePath);
    if (!target) return null;
    for (const { pluginId, path } of this.reservations.values()) {
      if (target === path || target.startsWith(`${path}/`)) return pluginId;
    }
    return null;
  }
}

function normalize(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}
