import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  PluginRegistryService,
  PrismaService,
  SecretBoxService,
  generateUuid,
} from '@makekeeper/backend-core';
import {
  ExternalPluginManifest,
  validateExternalManifest,
} from '@makekeeper/plugin-contract';
import { ExternalTokensService } from './external-tokens.service';
import { readStoredManifest } from './persisted';

// Auto-discovery of running plugin containers (#144).
//
// The trust model, stated once because everything here follows from it:
// DISCOVERY IS CONVENIENCE, NOT SECURITY. Announcing is anonymous, so
// everything a candidate says about itself is self-asserted. What makes a
// candidate trustworthy is the admin typing the PAIRING CODE that the
// container printed to its own log — proof they can read that container's
// output, i.e. that it is theirs. Without that step the admin would be
// confirming a row of text, and a rogue container could call itself `backup`,
// ask for `instance:*:read` and hope for a distracted click.
//
// Two further precautions:
//   * announces are only accepted while a PAIRING WINDOW is open, so no
//     standing unauthenticated surface exists;
//   * the issued secret is handed only to a claimant presenting the same
//     per-process announce key, so a different process cannot collect it.

const PAIRING_WINDOW_MS = 15 * 60 * 1000;
const CANDIDATE_TTL_MS = 20 * 60 * 1000;
// Bounded queue and per-source cap: an open window must not be floodable into
// a wall of look-alike cards.
const MAX_CANDIDATES = 20;
const MAX_PER_SOURCE = 5;
// How far back "something is knocking" looks. A container retries every ~20s,
// so a couple of minutes is plenty to notice one and short enough to forget a
// container that went away.
const KNOCK_HORIZON_MS = 3 * 60 * 1000;
// How many refused announces are held while the window is shut. Same bound as
// the candidate table: a doorbell, not a guest list.
const MAX_WAITING = MAX_CANDIDATES;

const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export type AnnounceResult =
  | { status: 'waiting' }
  | { error: 'pairing-closed' | 'invalid-manifest' | 'id-taken' | 'too-many' };

export type ClaimResult =
  | { status: 'waiting' }
  | { status: 'paired'; pluginSecret: string }
  | { error: 'unknown' };

export interface CandidateView {
  id: string;
  pluginId: string;
  baseUrl: string;
  sourceIp: string | null;
  manifest: ExternalPluginManifest;
  createdAt: string;
  expiresAt: string;
  ignored: boolean;
  // The same id is already registered: pairing this one would be a takeover,
  // so the UI shows it as a conflict instead of a normal candidate.
  conflictsWithInstalled: boolean;
}

@Injectable()
export class ExternalDiscoveryService {
  private readonly logger = new Logger(ExternalDiscoveryService.name);

  // In memory on purpose: a core restart CLOSES the window. That is the safe
  // default — an admin who walked away does not leave the door open — and it
  // keeps the state honest for a single-instance deployment, which is what
  // self-hosting is.
  private pairingOpenUntil = 0;
  // Announces refused because the window was shut, as timestamps. Kept in
  // memory and pruned to a short horizon: the point is to tell an admin
  // staring at an empty screen that something IS knocking, not to keep a
  // history. Only a COUNT is ever surfaced — a refused announce is
  // unauthenticated, so nothing it supplied may reach an admin's screen.
  private knocks: number[] = [];

  // …and WHAT knocked, so the wait after opening the window is zero.
  //
  // A refused announce used to leave only a count, so the container had to
  // come back — up to twenty seconds of an admin staring at an empty list they
  // had just opened for exactly this. The container already told us
  // everything; the window is an admin gesture, not a source of facts. It
  // still proves nothing: pairing needs the code, which is only ever held as a
  // hash.
  private waiting: Array<{
    manifest: unknown;
    baseUrl: string;
    announceKey: string;
    pairingCode: string;
    sourceIp: string | null;
    at: number;
  }> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PluginRegistryService,
    private readonly secretBox: SecretBoxService,
    private readonly tokens: ExternalTokensService,
  ) {}

  // ── Pairing window ────────────────────────────────────────────────────────

  async openPairing(): Promise<{ openUntil: string }> {
    this.pairingOpenUntil = Date.now() + PAIRING_WINDOW_MS;
    // Whoever was knocking becomes a candidate NOW, not on their next retry.
    const pending = this.waiting;
    this.waiting = [];
    for (const knock of pending) {
      if (knock.at < Date.now() - KNOCK_HORIZON_MS) continue;
      // Same path as a live announce — including every check it makes.
      await this.announce(knock);
    }
    // The count has done
    // its job.
    this.knocks = [];
    this.logger.log('plugin pairing window opened');
    return { openUntil: new Date(this.pairingOpenUntil).toISOString() };
  }

  closePairing(): void {
    this.pairingOpenUntil = 0;
  }

  pairingStatus(): {
    open: boolean;
    openUntil: string | null;
    knocking: number;
  } {
    const open = Date.now() < this.pairingOpenUntil;
    const since = Date.now() - KNOCK_HORIZON_MS;
    this.knocks = this.knocks.filter((at) => at >= since);
    return {
      open,
      openUntil: open ? new Date(this.pairingOpenUntil).toISOString() : null,
      knocking: this.knocks.length,
    };
  }

  // ── Announce (plugin → core, anonymous) ───────────────────────────────────

  // Bounded and short-lived: this is a doorbell, not a guest list.
  private remember(input: {
    manifest: unknown;
    baseUrl: string;
    announceKey: string;
    pairingCode: string;
    sourceIp: string | null;
  }): void {
    const pluginId = (input.manifest as { pluginId?: unknown })?.pluginId;
    // One entry per container: a retry loop must not fill the buffer.
    this.waiting = this.waiting.filter(
      (item) =>
        (item.manifest as { pluginId?: unknown })?.pluginId !== pluginId,
    );
    this.waiting.push({ ...input, at: Date.now() });
    if (this.waiting.length > MAX_WAITING) {
      this.waiting = this.waiting.slice(-MAX_WAITING);
    }
  }

  async announce(input: {
    manifest: unknown;
    baseUrl: string;
    announceKey: string;
    pairingCode: string;
    sourceIp: string | null;
  }): Promise<AnnounceResult> {
    if (Date.now() >= this.pairingOpenUntil) {
      // Remember that someone tried — unless the admin already said no to this
      // plugin. Without the memory the admin's screen is empty and the only
      // evidence lives in a container log they have no reason to read yet;
      // with it counting ignored containers, an unwanted one would nag for as
      // long as it runs.
      if (!(await this.isIgnored(input.manifest))) {
        this.knocks.push(Date.now());
        this.remember(input);
        this.logger.log(
          'plugin announce refused: pairing window is closed (a container is waiting to be discovered)',
        );
      }
      return { error: 'pairing-closed' };
    }

    const validated = validateExternalManifest(input.manifest);
    if (validated.ok === false) return { error: 'invalid-manifest' };
    const manifest = validated.manifest;
    if (!/^https?:\/\//.test(input.baseUrl))
      return { error: 'invalid-manifest' };

    // An id already taken by an INTERNAL plugin is refused outright; one taken
    // by an installed external plugin surfaces as a conflict for the admin to
    // judge (it may legitimately be the same plugin re-announcing after losing
    // its state), so the candidate is kept and flagged.
    if (this.registry.getPlugins().some((p) => p.id === manifest.pluginId)) {
      return { error: 'id-taken' };
    }

    await this.prune();
    const total = await this.prisma.externalCandidate.count();
    if (total >= MAX_CANDIDATES) return { error: 'too-many' };
    if (input.sourceIp) {
      const fromSource = await this.prisma.externalCandidate.count({
        where: { sourceIp: input.sourceIp },
      });
      if (fromSource >= MAX_PER_SOURCE) return { error: 'too-many' };
    }

    // An IGNORED candidate is refreshed in place, never replaced: the row is
    // what makes the refusal stick, and containers re-announce every ~20s.
    // Deleting it would bring the card back before the admin looked away.
    const ignored = await this.prisma.externalCandidate.findFirst({
      where: { pluginId: manifest.pluginId, ignoredAt: { not: null } },
    });
    if (ignored) {
      await this.prisma.externalCandidate.update({
        where: { id: ignored.id },
        data: {
          baseUrl: input.baseUrl,
          manifestJson: JSON.stringify(manifest),
          announceKeyHash: hash(input.announceKey),
          pairingCodeHash: hash(input.pairingCode),
          sourceIp: input.sourceIp,
          // Keep it alive while the container keeps announcing, or the ignore
          // would expire and the card return on its own.
          expiresAt: new Date(Date.now() + CANDIDATE_TTL_MS),
        },
      });
      return { status: 'waiting' };
    }

    // Already paired and not yet collected? Say nothing new: the container is
    // one poll away from its secret, and a fresh card would hide it.
    const unclaimed = await this.prisma.externalCandidate.findFirst({
      where: {
        pluginId: manifest.pluginId,
        announceKeyHash: hash(input.announceKey),
        pairedAt: { not: null },
      },
    });
    if (unclaimed) return { status: 'waiting' };

    // A re-announce from the same process (a restart loop, a slow admin)
    // replaces its previous card rather than adding another.
    await this.prisma.externalCandidate.deleteMany({
      where: { pluginId: manifest.pluginId, pairedAt: null },
    });

    await this.prisma.externalCandidate.create({
      data: {
        id: generateUuid(),
        pluginId: manifest.pluginId,
        baseUrl: input.baseUrl,
        manifestJson: JSON.stringify(manifest),
        announceKeyHash: hash(input.announceKey),
        pairingCodeHash: hash(input.pairingCode),
        sourceIp: input.sourceIp,
        expiresAt: new Date(Date.now() + CANDIDATE_TTL_MS),
      },
    });
    this.logger.log(
      `plugin candidate announced: ${manifest.pluginId} from ${input.sourceIp ?? 'unknown'}`,
    );
    return { status: 'waiting' };
  }

  // ── Claim (plugin → core, anonymous but key-bound) ────────────────────────

  async claim(pluginId: string, announceKey: string): Promise<ClaimResult> {
    // A PAIRED candidate wins over a newer unpaired one.
    //
    // Ordering by age alone lost a pairing: a container whose announce was
    // refused sleeps twenty seconds before retrying and does not poll in
    // between, so an admin who opened the window (which turns the refused
    // announce into a candidate) could pair it before the container came
    // back. Its next announce then created a fresher card that shadowed the
    // paired one, and the secret waiting behind it was never collected — the
    // container kept announcing forever with the installation already made.
    const keyHash = hash(announceKey);
    const candidate =
      (await this.prisma.externalCandidate.findFirst({
        where: { pluginId, announceKeyHash: keyHash, pairedAt: { not: null } },
        orderBy: { pairedAt: 'desc' },
      })) ??
      (await this.prisma.externalCandidate.findFirst({
        where: { pluginId, announceKeyHash: keyHash },
        orderBy: { createdAt: 'desc' },
      }));
    if (!candidate) return { error: 'unknown' };
    if (!candidate.pairedAt || !candidate.issuedSecretEnc) {
      return { status: 'waiting' };
    }
    const secret = this.secretBox.decrypt(candidate.issuedSecretEnc);
    if (!secret) return { error: 'unknown' };
    // One-shot: the secret is collected once and the card disappears — along
    // with any other card this container left behind while it was retrying,
    // so the admin is not looking at a candidate that is already installed.
    await this.prisma.externalCandidate.deleteMany({
      where: { pluginId, announceKeyHash: keyHash },
    });
    return { status: 'paired', pluginSecret: secret };
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  // Cheap enough at one call per refused announce (~every 20s per container).
  private async isIgnored(manifest: unknown): Promise<boolean> {
    const pluginId =
      typeof manifest === 'object' &&
      manifest !== null &&
      typeof (manifest as { pluginId?: unknown }).pluginId === 'string'
        ? (manifest as { pluginId: string }).pluginId
        : null;
    if (!pluginId) return false;
    const found = await this.prisma.externalCandidate.findFirst({
      where: { pluginId, ignoredAt: { not: null } },
      select: { id: true },
    });
    return found !== null;
  }

  async listCandidates(ignored = false): Promise<CandidateView[]> {
    await this.prune();
    const rows = await this.prisma.externalCandidate.findMany({
      where: {
        pairedAt: null,
        ignoredAt: ignored ? { not: null } : null,
      },
      orderBy: { createdAt: 'desc' },
    });
    const installed = await this.prisma.externalPlugin.findMany({
      select: { pluginId: true },
    });
    const installedIds = new Set(installed.map((p) => p.pluginId));
    const out: CandidateView[] = [];
    for (const row of rows) {
      // Candidates are validated on announce; an unreadable one is a stale
      // shape — drop the card, the container re-announces within ~20s.
      const manifest = readStoredManifest(row.manifestJson);
      if (!manifest) {
        this.logger.error(
          `stored candidate manifest unreadable: ${row.pluginId}`,
        );
        continue;
      }
      out.push({
        id: row.id,
        pluginId: row.pluginId,
        baseUrl: row.baseUrl,
        sourceIp: row.sourceIp,
        manifest,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        ignored: row.ignoredAt !== null,
        conflictsWithInstalled: installedIds.has(row.pluginId),
      });
    }
    return out;
  }

  // The moment of trust: the admin proves they can read the container's log.
  // On success the candidate becomes an ordinary PENDING registration, so the
  // permission-consent card that follows is exactly the one the token flow
  // already uses — pairing answers "is this container mine?", consent answers
  // "may it do this?", and the two stay separate questions.
  async pair(
    candidateId: string,
    code: string,
  ): Promise<{ ok: true } | { error: 'not-found' | 'bad-code' | 'id-taken' }> {
    const candidate = await this.prisma.externalCandidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate || candidate.pairedAt) return { error: 'not-found' };
    if (candidate.pairingCodeHash !== hash(code.trim())) {
      this.logger.warn(
        `wrong pairing code for candidate ${candidate.pluginId}`,
      );
      return { error: 'bad-code' };
    }
    const manifest = readStoredManifest(candidate.manifestJson);
    if (!manifest) {
      // Validated on announce, unreadable now: the card is stale. Dropping it
      // lets the container's next announce present a readable one.
      this.logger.error(
        `stored candidate manifest unreadable: ${candidate.pluginId}`,
      );
      await this.prisma.externalCandidate.delete({
        where: { id: candidate.id },
      });
      return { error: 'not-found' };
    }
    const secret = this.tokens.newPluginSecret();

    // An installation with this id already exists.
    //
    // That is not a collision to refuse — it is the ordinary way a container
    // comes home after losing its state: its volume was dropped, its host
    // moved, the stack was rebuilt. Refusing left the admin with a plugin the
    // core believed in and no container able to answer for it, and the only
    // way out was uninstalling — losing the grants, the assistant consent and
    // the plugin's own data with it.
    //
    // Typing the code IS the authorization: the same gesture that installed it
    // in the first place, on a card the UI marks as taking over an existing
    // installation. So the secret and the address are re-issued and everything
    // the admin decided is kept. A manifest that changed still goes through
    // the normal update-diff on the container's next `register`, so a plugin
    // cannot widen its permissions by re-pairing.
    const existing = await this.prisma.externalPlugin.findUnique({
      where: { pluginId: candidate.pluginId },
    });
    if (existing) {
      await this.prisma.externalPlugin.update({
        where: { pluginId: candidate.pluginId },
        data: {
          baseUrl: candidate.baseUrl,
          secretEnc: this.secretBox.encrypt(secret),
        },
      });
      await this.prisma.externalCandidate.update({
        where: { id: candidate.id },
        data: {
          pairedAt: new Date(),
          issuedSecretEnc: this.secretBox.encrypt(secret),
        },
      });
      this.logger.log(
        `external plugin re-paired (kept its grants and consent): ${candidate.pluginId}`,
      );
      return { ok: true };
    }
    await this.prisma.externalPlugin.create({
      data: {
        pluginId: manifest.pluginId,
        status: 'pending',
        baseUrl: candidate.baseUrl,
        version: manifest.version,
        contractMajor: manifest.contract.major,
        contractMinor: manifest.contract.minor,
        manifestJson: candidate.manifestJson,
        // Still nothing granted: pairing is identity, not permission.
        grantsJson: '[]',
        secretEnc: this.secretBox.encrypt(secret),
      },
    });
    await this.prisma.externalCandidate.update({
      where: { id: candidate.id },
      data: {
        pairedAt: new Date(),
        issuedSecretEnc: this.secretBox.encrypt(secret),
      },
    });
    this.logger.log(`plugin paired: ${manifest.pluginId}`);
    return { ok: true };
  }

  // Ignoring keeps the row: that is what survives the next announce. Undoing
  // it lets the container back in on its next attempt, which is seconds away.
  async setIgnored(candidateId: string, ignored: boolean): Promise<void> {
    await this.prisma.externalCandidate.updateMany({
      where: { id: candidateId },
      data: { ignoredAt: ignored ? new Date() : null },
    });
  }

  async dismiss(candidateId: string): Promise<void> {
    await this.prisma.externalCandidate.deleteMany({
      where: { id: candidateId },
    });
  }

  private async prune(): Promise<void> {
    // Ignored rows are exempt: expiring one would quietly forget the admin's
    // decision and the card would reappear on the next announce.
    await this.prisma.externalCandidate.deleteMany({
      where: { expiresAt: { lt: new Date() }, pairedAt: null, ignoredAt: null },
    });
  }
}
