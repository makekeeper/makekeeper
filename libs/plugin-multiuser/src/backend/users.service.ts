import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '@makekeeper/backend-core';
import { UserPublic } from '@makekeeper/plugin-contract';
import { tokenEpochMatches, type VerifiedToken } from './auth-token.service';

const CACHE_TTL_MS = 30_000;

// User lookups for the request hot path (the guard resolves the JWT subject on
// every request), backed by a short-TTL cache so auth does not add a DB
// round-trip per request.
@Injectable()
export class UsersService {
  private readonly cache = new Map<string, { user: User; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string): Promise<User | null> {
    const cached = this.cache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.user;
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (user) {
      this.cache.set(id, { user, expiresAt: Date.now() + CACHE_TTL_MS });
    } else {
      this.cache.delete(id);
    }
    return user;
  }

  // The user a decoded JWT is CURRENTLY good for: the row exists and the token
  // epoch still matches it (#241). The one resolver behind the HTTP guard, the
  // socket handshake and the auth-status endpoint, so the epoch rule cannot
  // drift between them. Null for a deleted user or a stale (revoked) token.
  async getByCurrentToken(decoded: VerifiedToken): Promise<User | null> {
    const user = await this.getById(decoded.userId);
    return user && tokenEpochMatches(user, decoded) ? user : null;
  }

  invalidate(id?: string): void {
    if (id) this.cache.delete(id);
    else this.cache.clear();
  }

  toPublic(user: User): UserPublic {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
    };
  }
}
