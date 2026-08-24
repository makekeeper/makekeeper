import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { spawn, type ChildProcess } from 'child_process';
import { promises as fsp, existsSync, constants as fsConstants } from 'fs';
import { join, delimiter } from 'path';
import {
  AppConfigService,
  UploadsReservationService,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  TunnelMode,
  TunnelState,
  TunnelStatus,
} from '@makekeeper/plugin-contract';
import { phoneBridgeManifest } from '../manifest';
import { PhoneBridgeSettingsService } from './phone-bridge-settings.service';

// Cloudflare Quick Tunnel process manager (#77, docs/tls-public-access.md).
// Owns a single `cloudflared tunnel --url` child process, parses the assigned
// *.trycloudflare.com URL from its output, and exposes it as the public base
// URL for phone-facing capture links. Modes: off / on / auto (on-demand).

// Where a managed (auto-downloaded) binary is placed, relative to the uploads
// root (a writable location the app already owns).
//
// It shares that root with the attachment store, which is safe only because the
// store recognises its own files by their `att_` name prefix: the storage sweep
// (#120) reports anything else as somebody else's file and never deletes it.
// Keep that in mind before naming anything written here `att_*`.
const MANAGED_BIN_DIR = '_bin';
const MANAGED_BIN_SUBPATH = join(MANAGED_BIN_DIR, 'cloudflared');

// Matches the public URL cloudflared prints when a quick tunnel is ready.
const TRYCLOUDFLARE_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

// How long to wait for the URL to appear before giving up.
const START_TIMEOUT_MS = 30_000;

@Injectable()
export class CfTunnelService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CfTunnelService.name);

  private child: ChildProcess | null = null;
  private state: TunnelState = 'stopped';
  private url: string | null = null;
  private message: string | null = null;
  // A single in-flight start, so concurrent capture sessions share one launch.
  private starting: Promise<string | null> | null = null;
  // Epoch ms of the tunnel's last use — the idle TTL is measured from here.
  private lastUsedAt = 0;

  constructor(
    private readonly config: AppConfigService,
    private readonly settings: PhoneBridgeSettingsService,
    private readonly reservations: UploadsReservationService,
  ) {}

  // Declare our corner of the uploads root so the storage admin page labels it
  // instead of offering the tunnel client up as an unowned file (#120).
  onModuleInit(): void {
    this.reservations.reserve(phoneBridgeManifest.id, MANAGED_BIN_DIR);
  }

  onModuleDestroy(): void {
    this.killChild();
  }

  async getStatus(): Promise<TunnelStatus> {
    const mode = await this.settings.getMode();
    const binaryPath = await this.resolveBinaryPath();
    const binaryPresent = this.binaryExists(binaryPath);
    // Reflect "off" as disabled regardless of any stale process state.
    const state: TunnelState = mode === 'off' ? 'disabled' : this.state;
    return {
      mode,
      state,
      url: this.url ?? undefined,
      message: this.message ?? undefined,
      binaryPresent,
      binaryPath,
      managedBinaryPresent: existsSync(this.managedBinaryPath()),
    };
  }

  // Apply a newly-saved mode: `on` starts eagerly, `off` stops, `auto` is
  // on-demand (no proactive start, but a running tunnel is left up).
  async applyMode(mode: TunnelMode): Promise<void> {
    if (mode === 'off') {
      this.stop();
      return;
    }
    if (mode === 'on') {
      await this.ensureRunning().catch((err) =>
        this.logger.warn(`Tunnel start failed: ${getErrorMessage(err)}`),
      );
    }
  }

  // Return a public base URL for a capture session, honoring the mode:
  // off → null (caller falls back to request headers); on/auto → ensure a
  // tunnel is up and return its URL. `freshlyStarted` is true when this call
  // launched the tunnel (so the caller can warm up DNS before showing the QR).
  async ensureForCapture(): Promise<{
    url: string | null;
    freshlyStarted: boolean;
  }> {
    const mode = await this.settings.getMode();
    if (mode === 'off') return { url: null, freshlyStarted: false };
    const wasRunning = this.state === 'running' && this.url !== null;
    const url = await this.ensureRunning();
    this.lastUsedAt = Date.now();
    return { url, freshlyStarted: url !== null && !wasRunning };
  }

  // In `auto` mode, stop the tunnel once it has been idle (no capture activity)
  // for the configured TTL, measured from its last use. Called by the capture
  // sweep. Never stops in `on` mode. Any current activity refreshes the clock.
  // "Somebody is using the address this tunnel carries." The idle sweep below
  // only knows about BRIDGE sessions, so anything else riding the tunnel — a
  // paired phone running the mobile app (#198) — has to say so, or the tunnel
  // decides it is idle and stops under a person who is mid-shelf.
  markUsed(): void {
    this.lastUsedAt = Date.now();
  }

  async stopIfIdle(activeSessions: number): Promise<void> {
    if (activeSessions > 0) {
      this.lastUsedAt = Date.now();
      return;
    }
    const mode = await this.settings.getMode();
    if (mode !== 'auto' || this.state !== 'running') return;
    const ttlMs = (await this.settings.getIdleTtlMinutes()) * 60_000;
    if (Date.now() - this.lastUsedAt >= ttlMs) {
      this.logger.log(
        `Auto tunnel idle for ${Math.round(
          (Date.now() - this.lastUsedAt) / 1000,
        )}s (TTL reached) — stopping.`,
      );
      this.stop();
    }
  }

  // Explicit operator control from the settings panel.
  async startManual(): Promise<TunnelStatus> {
    const mode = await this.settings.getMode();
    if (mode === 'off') {
      throw new BadRequestException('tunnel_mode_off');
    }
    await this.ensureRunning();
    return this.getStatus();
  }

  async stopManual(): Promise<TunnelStatus> {
    this.stop();
    return this.getStatus();
  }

  private async ensureRunning(): Promise<string | null> {
    if (this.state === 'running' && this.url) return this.url;
    if (this.starting) return this.starting;
    this.starting = this.spawnTunnel().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async spawnTunnel(): Promise<string | null> {
    const binaryPath = await this.resolveBinaryPath();
    if (!this.binaryExists(binaryPath)) {
      this.state = 'error';
      this.message = 'binary_not_found';
      this.logger.error(
        `cloudflared not found at "${binaryPath}". Set a path or download it in settings.`,
      );
      return null;
    }

    this.killChild();
    this.state = 'starting';
    this.url = null;
    this.message = null;

    // Target the public web entry (nginx), which serves the SPA and proxies
    // /api — so /d/:token resolves to index.html, not an API 404.
    const port = this.config.getWebPort();
    const args = [
      'tunnel',
      '--no-autoupdate',
      '--url',
      `http://localhost:${port}`,
    ];
    this.logger.log(`Starting tunnel: ${binaryPath} ${args.join(' ')}`);

    const child = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;

    return new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      const timer = setTimeout(() => {
        if (this.url) return finish(this.url);
        this.state = 'error';
        this.message = 'start_timeout';
        this.logger.error('Timed out waiting for tunnel URL.');
        this.killChild();
        finish(null);
      }, START_TIMEOUT_MS);

      const onData = (buf: Buffer): void => {
        const text = buf.toString();
        const match = TRYCLOUDFLARE_RE.exec(text);
        if (match && !this.url) {
          this.url = match[0];
          this.state = 'running';
          this.message = null;
          this.lastUsedAt = Date.now();
          this.logger.log(`Tunnel ready: ${this.url}`);
          finish(this.url);
        }
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);

      child.on('error', (err) => {
        this.state = 'error';
        this.message = getErrorMessage(err);
        this.logger.error(`Tunnel process error: ${this.message}`);
        finish(null);
      });

      child.on('exit', (code) => {
        // Only meaningful if we were running/starting this very child.
        if (this.child === child) {
          this.child = null;
          if (this.state !== 'error') this.state = 'stopped';
          this.url = null;
          this.logger.log(`Tunnel process exited (code ${code ?? 'null'}).`);
        }
        finish(this.url);
      });
    });
  }

  private stop(): void {
    this.killChild();
    this.state = 'stopped';
    this.url = null;
    this.message = null;
  }

  private killChild(): void {
    if (this.child) {
      const child = this.child;
      this.child = null;
      child.removeAllListeners();
      try {
        child.kill('SIGTERM');
      } catch (err) {
        this.logger.warn(`Failed to kill tunnel: ${getErrorMessage(err)}`);
      }
    }
  }

  // Precedence: configured override → managed (downloaded) binary → PATH lookup
  // → the bare name "cloudflared" (last resort, may fail at spawn).
  private async resolveBinaryPath(): Promise<string> {
    const override = (await this.settings.getBinaryPath())?.trim();
    if (override) return override;

    const managed = this.managedBinaryPath();
    if (this.binaryExists(managed)) return managed;

    const onPath = this.findOnPath('cloudflared');
    return onPath ?? 'cloudflared';
  }

  // Absolute path of the auto-downloaded (managed) binary.
  private managedBinaryPath(): string {
    return join(this.config.getUploadsRoot(), MANAGED_BIN_SUBPATH);
  }

  private binaryExists(path: string): boolean {
    // A bare command name (no separator) can only be resolved via PATH.
    if (!path.includes('/')) return this.findOnPath(path) !== null;
    return existsSync(path);
  }

  private findOnPath(name: string): string | null {
    const paths = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
    for (const dir of paths) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  // Download the official cloudflared release for this Linux server to the
  // managed path and mark it executable. Returns the resolved status.
  async downloadBinary(): Promise<TunnelStatus> {
    if (process.platform !== 'linux') {
      // darwin ships as a .tgz and windows as .exe — out of scope for the
      // auto-download; the operator sets an explicit path instead.
      throw new BadRequestException('download_unsupported_platform');
    }
    const archMap: Record<string, string> = {
      x64: 'amd64',
      arm64: 'arm64',
      arm: 'arm',
    };
    const asset = archMap[process.arch];
    if (!asset) throw new BadRequestException('download_unsupported_arch');

    const src = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${asset}`;
    const dest = this.managedBinaryPath();

    this.logger.log(`Downloading cloudflared from ${src}`);
    try {
      const res = await fetch(src, { redirect: 'follow' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching cloudflared`);
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      await fsp.mkdir(join(this.config.getUploadsRoot(), '_bin'), {
        recursive: true,
      });
      await fsp.writeFile(dest, bytes);
      await fsp.chmod(
        dest,
        fsConstants.S_IRWXU | fsConstants.S_IRGRP | fsConstants.S_IXGRP,
      );
      this.logger.log(`cloudflared downloaded to ${dest}`);
    } catch (err) {
      this.message = getErrorMessage(err);
      this.logger.error(`cloudflared download failed: ${this.message}`);
      throw new BadRequestException('download_failed');
    }
    return this.getStatus();
  }

  // Remove the auto-downloaded (managed) binary. Idempotent — a missing file is
  // not an error. A tunnel already running off it keeps running (Linux holds the
  // inode); it just can't be re-launched until re-downloaded or a path is set.
  async deleteBinary(): Promise<TunnelStatus> {
    const managed = this.managedBinaryPath();
    try {
      await fsp.rm(managed, { force: true });
      this.logger.log(`Deleted managed cloudflared at ${managed}`);
    } catch (err) {
      this.message = getErrorMessage(err);
      this.logger.error(`cloudflared delete failed: ${this.message}`);
      throw new BadRequestException('delete_failed');
    }
    return this.getStatus();
  }
}
