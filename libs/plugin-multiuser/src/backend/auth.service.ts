import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  DeviceAuthService,
  PluginI18nService,
  PrismaService,
  generateUuid,
} from '@makekeeper/backend-core';
import { AuthResult, AuthStatus, ScopeInfo } from '@makekeeper/plugin-contract';
import { AuthTokenService } from './auth-token.service';
import { KeyringSessionService } from './keyring-session.service';
import { UsersService } from './users.service';
import { BackfillService } from './backfill.service';
import { MultiuserSettingsService } from './multiuser-settings.service';
import { LoginDto, RegisterDto } from './multiuser.dto';

const BCRYPT_ROUNDS = 10;

// A valid bcrypt hash at the same cost, compared against when the username does
// not exist so a failed login takes the same time whether or not the account is
// real — closing the timing side-channel that would otherwise enumerate
// usernames (#243). Computed once at load.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  'unused-timing-equalizer',
  BCRYPT_ROUNDS,
);

// Serializes concurrent registrations so "first user becomes admin" cannot
// race into two admins. Arbitrary app-unique advisory-lock key.
const REGISTRATION_LOCK_KEY = 823471;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AuthTokenService,
    private readonly keyringSession: KeyringSessionService,
    private readonly users: UsersService,
    private readonly backfill: BackfillService,
    private readonly settings: MultiuserSettingsService,
    private readonly devices: DeviceAuthService,
    private readonly i18n: PluginI18nService,
  ) {}

  async register(dto: RegisterDto, locale?: string): Promise<AuthResult> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.$transaction(async (tx) => {
      // $executeRaw (not $queryRaw): the lock function returns `void`, which
      // the pg driver adapter cannot deserialize as a result column.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REGISTRATION_LOCK_KEY})`;
      const existing = await tx.user.findUnique({
        where: { username: dto.username },
      });
      if (existing) {
        throw new ConflictException(
          this.i18n.t('multiuser.errors.usernameTaken', undefined, locale),
        );
      }
      const count = await tx.user.count();
      // Admin setting: open self-registration. The first account (the admin
      // bootstrap right after enabling the mode) is always allowed.
      if (count > 0 && !(await this.settings.get()).allowRegistration) {
        throw new ForbiddenException(
          this.i18n.t('multiuser.errors.registrationClosed', undefined, locale),
        );
      }
      const created = await tx.user.create({
        data: {
          id: generateUuid(),
          username: dto.username,
          passwordHash,
          displayName: dto.displayName?.trim() || null,
          isAdmin: count === 0,
        },
      });
      // The very first user inherits everything created in single-user mode.
      if (count === 0) await this.backfill.claimOrphans(tx, created.id);
      return created;
    });
    // Provision the user's data-encryption key and arm it (#63); the returned
    // session key lets the client re-arm it after a server restart.
    const sessionKey = await this.keyringSession.provision(
      user.id,
      dto.password,
    );
    return {
      token: this.tokens.sign(user.id, user.tokenVersion, locale),
      user: this.users.toPublic(user),
      sessionKey,
    };
  }

  async login(dto: LoginDto, locale?: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    // Always run a bcrypt compare — against the real hash, or a dummy of equal
    // cost when the user is absent — so the response time does not reveal
    // whether the username exists (#243).
    const passwordOk = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordOk) {
      throw new UnauthorizedException(
        this.i18n.t('multiuser.errors.invalidCredentials', undefined, locale),
      );
    }
    // A blocked account cannot obtain a token — checked only after the
    // credentials pass, so it never doubles as a username probe.
    if (user.blockedAt) {
      throw new ForbiddenException(
        this.i18n.t('multiuser.errors.accountBlocked', undefined, locale),
      );
    }
    // Unwrap and arm the user's DEK from the password (#63); a legacy account
    // with no keyring yet — or one whose wrap no longer opens after an admin
    // password reset — is (re-)provisioned on this login.
    const sessionKey = await this.keyringSession.unlock(user.id, dto.password);
    return {
      token: this.tokens.sign(user.id, user.tokenVersion, locale),
      user: this.users.toPublic(user),
      sessionKey,
    };
  }

  // Logout: drop this session's DEK re-arm token so its client-held secret can
  // never re-arm the keyring after a restart (#63). The armed DEK is retained
  // in memory until the process restarts (background-job availability rule).
  // Bumping the token epoch invalidates every JWT already issued for the user,
  // so a captured Bearer token stops working the moment they log out (#241).
  // Without a per-session jti store this is logout-everywhere by design — the
  // safe direction (a stolen token dies) rather than the surprising one.
  async logout(userId: string, sessionKey?: string): Promise<void> {
    await this.keyringSession.revoke(userId, sessionKey);
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    this.users.invalidate(userId);
  }

  // Public bootstrap endpoint: works for anonymous callers (`user: null`) and
  // resolves the caller + their scopes when a valid Bearer token is present.
  async getStatus(authorizationHeader?: string): Promise<AuthStatus> {
    const hasUsers = (await this.prisma.user.count()) > 0;
    const userId = await this.resolveCaller(authorizationHeader);
    const resolved = userId ? await this.users.getById(userId) : null;
    // A blocked account reads as logged-out so the SPA bounces to /login (where
    // login also refuses) instead of showing a half-authenticated shell.
    const user = resolved?.blockedAt ? null : resolved;
    const settings = await this.settings.get();
    return {
      enabled: true,
      hasUsers,
      configOk: this.tokens.hasUsableSecret(),
      registrationAllowed: !hasUsers || settings.allowRegistration,
      user: user ? this.users.toPublic(user) : null,
      scopes: user ? await this.getScopesFor(user.id) : [],
    };
  }

  // Own scope first, then every scope shared to the user via a grant.
  async getScopesFor(userId: string): Promise<ScopeInfo[]> {
    const user = await this.users.getById(userId);
    if (!user) return [];
    const own: ScopeInfo = {
      scopeId: user.id,
      ownerName: user.displayName ?? user.username,
      accessLevel: 'OWNER',
      allowedPluginIds: null,
    };
    const grants = await this.prisma.scopeGrant.findMany({
      where: { granteeUserId: userId },
      orderBy: { createdAt: 'asc' },
    });
    // Resolve grant owners concurrently instead of one serial lookup per grant.
    const owners = await Promise.all(
      grants.map((grant) => this.users.getById(grant.ownerUserId)),
    );
    const shared: ScopeInfo[] = [];
    grants.forEach((grant, i) => {
      const owner = owners[i];
      if (!owner) return;
      shared.push({
        scopeId: grant.ownerUserId,
        ownerName: owner.displayName ?? owner.username,
        accessLevel: grant.accessLevel === 'WRITE' ? 'WRITE' : 'READ',
        allowedPluginIds: this.parsePluginIds(grant.allowedPluginIds),
      });
    });
    return [own, ...shared];
  }

  // Both credential shapes, exactly as the guard accepts them (#199). Without
  // the device half, a paired phone was authenticated for every API call but
  // read as anonymous in the SPA's session store — so every route that is not
  // explicitly public bounced it to /login.
  private async resolveCaller(
    authorizationHeader?: string,
  ): Promise<string | null> {
    if (!authorizationHeader?.startsWith('Bearer ')) return null;
    const token = authorizationHeader.slice('Bearer '.length).trim();
    if (!token) return null;
    const decoded = this.tokens.verify(token);
    if (decoded) {
      // Shared epoch-checked resolution — a stale token (post logout /
      // password reset) reads as logged-out here too (#241).
      return (await this.users.getByCurrentToken(decoded))?.id ?? null;
    }
    return (await this.devices.resolveToken(token))?.userId ?? null;
  }

  private parsePluginIds(raw: string): string[] {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : [];
    } catch {
      return [];
    }
  }
}
