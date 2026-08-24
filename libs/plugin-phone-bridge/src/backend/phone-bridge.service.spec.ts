import { Test } from '@nestjs/testing';
import {
  GoneException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  PrismaService,
  AppConfigService,
  CapabilityRegistryService,
  RealtimeService,
  RequestContextService,
} from '@makekeeper/backend-core';
import {
  PhoneBridgeKindContext,
  PhoneBridgeKindHandler,
  PhoneBridgeMessage,
  phoneBridgeKindCapability,
} from '@makekeeper/plugin-contract';
import { PhoneBridgeService } from './phone-bridge.service';
import { CfTunnelService } from './cf-tunnel.service';
import { PhoneBridgeSettingsService } from './phone-bridge-settings.service';
import {
  OWNER_COOKIE,
  readOwnerId,
  isSecureRequest,
  buildOwnerSetCookie,
} from './owner-cookie';

// Desktop-session binding + completion-expiry for the bridge handshake (#10),
// plus the kind-handler dispatch (#77).
describe('PhoneBridgeService — owner binding, expiry & dispatch', () => {
  let service: PhoneBridgeService;
  let findUnique: jest.Mock;
  let updateSession: jest.Mock;
  let getCapability: jest.Mock;
  let requestUser: { userId?: string } | undefined;

  const future = new Date(Date.now() + 60_000);
  const handler = {
    onMessage: jest.fn((_ctx: PhoneBridgeKindContext, _payload: unknown) =>
      Promise.resolve<PhoneBridgeMessage | null>(null),
    ),
    readResults: jest.fn((_token: string, _since: string | undefined) =>
      Promise.resolve({
        messages: [{ id: 'm1', createdAt: 'x', data: {} }],
        cursor: 'x',
      }),
    ),
    onGarbageCollect: jest.fn((_token: string) => Promise.resolve()),
  } satisfies PhoneBridgeKindHandler;

  const session = (
    ownerId: string | null,
    scopeOwnerId: string | null = null,
  ): Record<string, unknown> => ({
    token: 'br_1',
    kind: 'capture',
    context: JSON.stringify({ kind: 'capture' }),
    status: 'active',
    expiresAt: future,
    ownerId,
    scopeOwnerId,
  });

  beforeEach(async () => {
    findUnique = jest.fn();
    updateSession = jest.fn(() => Promise.resolve(undefined));
    getCapability = jest.fn(() => handler);
    requestUser = undefined;
    handler.readResults.mockClear();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PhoneBridgeService,
        {
          provide: PrismaService,
          useValue: {
            phoneBridgeSession: { findUnique, update: updateSession },
          },
        },
        { provide: AppConfigService, useValue: {} },
        {
          provide: CapabilityRegistryService,
          useValue: { getCapability },
        },
        { provide: CfTunnelService, useValue: {} },
        {
          provide: RequestContextService,
          useValue: { get: () => requestUser },
        },
        { provide: RealtimeService, useValue: { emitToRoom: jest.fn() } },
        { provide: PhoneBridgeSettingsService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(PhoneBridgeService);
  });

  // #243: with the overlay on, session isolation is by the authenticated user,
  // not by whoever holds an unguessable per-browser cookie.
  it('rejects another logged-in user even with the right cookie', async () => {
    findUnique.mockResolvedValue(session('owner-1', 'user-42'));
    requestUser = { userId: 'user-43' };
    await expect(service.getResults('br_1', 'owner-1')).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.retargetSession('br_1', 'owner-1', { contextLabel: 'x' }),
    ).rejects.toThrow(NotFoundException);
    expect(handler.readResults).not.toHaveBeenCalled();
  });

  it('serves the binding user their own session (cookie + identity)', async () => {
    findUnique.mockResolvedValue(session('owner-1', 'user-42'));
    requestUser = { userId: 'user-42' };
    const res = await service.getResults('br_1', 'owner-1');
    expect(res.messages).toHaveLength(1);
  });

  it('rejects a non-owner reading results as "not found"', async () => {
    findUnique.mockResolvedValue(session('owner-1'));
    await expect(service.getResults('br_1', 'someone-else')).rejects.toThrow(
      NotFoundException,
    );
    expect(handler.readResults).not.toHaveBeenCalled();
  });

  it('dispatches results to the kind handler for the owning desktop', async () => {
    findUnique.mockResolvedValue(session('owner-1'));
    const res = await service.getResults('br_1', 'owner-1');
    expect(getCapability).toHaveBeenCalledWith(
      phoneBridgeKindCapability('capture'),
    );
    expect(res.messages).toHaveLength(1);
  });

  it('leaves an unbound (null-owner) session readable by anyone', async () => {
    findUnique.mockResolvedValue(session(null));
    const res = await service.getResults('br_1', null);
    expect(res.messages).toHaveLength(1);
  });

  it('relays a message to the kind handler with the session scope owner', async () => {
    findUnique.mockResolvedValue(session('owner-1', 'user-42'));
    await service.relayMessage('br_1', {
      image: 'data:image/jpeg;base64,AAAA',
    });
    expect(handler.onMessage).toHaveBeenCalledWith(
      { token: 'br_1', scopeOwnerId: 'user-42' },
      { image: 'data:image/jpeg;base64,AAAA' },
    );
  });

  // #79: re-pointing a live session at another context, so the paired phone
  // keeps its page instead of having to re-pair.
  it('retargets a live session for its owner, keeping the kind', async () => {
    findUnique.mockResolvedValue(session('owner-1'));
    const info = await service.retargetSession('br_1', 'owner-1', {
      contextLabel: 'Cell B1',
      data: { actions: [] },
    });
    const written = updateSession.mock.calls[0][0].data as { context: string };
    expect(JSON.parse(written.context)).toEqual({
      kind: 'capture',
      contextLabel: 'Cell B1',
      data: { actions: [] },
    });
    expect(info.contextLabel).toBe('Cell B1');
  });

  it('leaves omitted fields untouched — a PATCH must not erase the actions', async () => {
    findUnique.mockResolvedValue({
      ...session('owner-1'),
      context: JSON.stringify({
        kind: 'capture',
        contextLabel: 'Cell B1',
        data: { actions: [{ key: 'place', labelKey: 'x' }] },
      }),
    });
    await service.retargetSession('br_1', 'owner-1', {
      contextLabel: 'Cell B2',
    });
    const written = updateSession.mock.calls[0][0].data as { context: string };
    expect(JSON.parse(written.context)).toEqual({
      kind: 'capture',
      contextLabel: 'Cell B2',
      data: { actions: [{ key: 'place', labelKey: 'x' }] },
    });
  });
  it('reports a still-pending session as pending, not paired', async () => {
    findUnique.mockResolvedValue({ ...session('owner-1'), status: 'pending' });
    const info = await service.retargetSession('br_1', 'owner-1', {
      contextLabel: 'Cell B1',
    });
    expect(info.status).toBe('pending');
  });
  it('rejects a context too large to park on the session row', async () => {
    findUnique.mockResolvedValue(session('owner-1'));
    await expect(
      service.retargetSession('br_1', 'owner-1', {
        data: { blob: 'x'.repeat(32 * 1024) },
      }),
    ).rejects.toThrow(PayloadTooLargeException);
    expect(updateSession).not.toHaveBeenCalled();
  });
  it('refuses to retarget for a non-owner', async () => {
    findUnique.mockResolvedValue(session('owner-1'));
    await expect(
      service.retargetSession('br_1', 'someone-else', { contextLabel: 'x' }),
    ).rejects.toThrow(NotFoundException);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('refuses to retarget a session that is already over', async () => {
    findUnique.mockResolvedValue({
      ...session('owner-1'),
      status: 'closed',
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      service.retargetSession('br_1', 'owner-1', { contextLabel: 'x' }),
    ).rejects.toThrow(GoneException);
    expect(updateSession).not.toHaveBeenCalled();
  });

  // #79 guest realtime: the phone's own token is the credential, and it names
  // exactly one room.
  it('grants a live token its own bridge room, and nothing for a dead one', async () => {
    findUnique.mockResolvedValue(session('owner-1'));
    expect(await service.resolveGuestRoom('br_1')).toBe('phone-bridge:br_1');
    findUnique.mockResolvedValue(null);
    expect(await service.resolveGuestRoom('br_nope')).toBeNull();
  });

  it('closing expires the session immediately (status + expiresAt)', async () => {
    const before = Date.now();
    await service.closeSession('br_1');
    const data = updateSession.mock.calls[0][0].data as {
      status: string;
      expiresAt: Date;
    };
    expect(data.status).toBe('closed');
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

// #93: the desktop's own origin (or https forwarded headers) lets the bridge
// skip the tunnel in auto mode when the app is already served over HTTPS.
describe('PhoneBridgeService — base URL resolution (#93)', () => {
  let create: jest.Mock;
  let ensureForCapture: jest.Mock;
  let getMode: jest.Mock;

  const build = async (): Promise<PhoneBridgeService> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PhoneBridgeService,
        {
          provide: PrismaService,
          useValue: { phoneBridgeSession: { create } },
        },
        // Real config: its origin classification + header derivation are pure.
        { provide: AppConfigService, useValue: new AppConfigService() },
        {
          provide: CapabilityRegistryService,
          useValue: { getCapability: jest.fn() },
        },
        { provide: CfTunnelService, useValue: { ensureForCapture } },
        { provide: RequestContextService, useValue: { get: () => undefined } },
        { provide: RealtimeService, useValue: { emitToRoom: jest.fn() } },
        { provide: PhoneBridgeSettingsService, useValue: { getMode } },
      ],
    }).compile();
    return moduleRef.get(PhoneBridgeService);
  };

  beforeEach(() => {
    delete process.env.PUBLIC_BASE_URL;
    create = jest.fn(() => Promise.resolve(undefined));
    ensureForCapture = jest.fn(() =>
      Promise.resolve({
        url: 'https://x.trycloudflare.com',
        freshlyStarted: true,
      }),
    );
    getMode = jest.fn(() => Promise.resolve('auto'));
  });

  const ctx = { kind: 'capture' } as const;

  it('auto mode: uses the desktop https origin and skips the tunnel', async () => {
    const service = await build();
    const res = await service.createSession(
      ctx,
      { headers: { 'x-forwarded-proto': 'http', host: 'web:80' } },
      null,
      'https://mk.example.com',
    );
    expect(res.url).toBe('https://mk.example.com/d/' + res.token);
    expect(res.warmupSeconds).toBe(0);
    expect(ensureForCapture).not.toHaveBeenCalled();
  });

  it('auto mode: honours https forwarded headers even when the browser origin is missing', async () => {
    const service = await build();
    const res = await service.createSession(
      ctx,
      {
        headers: {
          'x-forwarded-scheme': 'https',
          'x-forwarded-host': 'mk.example.com',
          host: 'web:80',
        },
      },
      null,
    );
    expect(res.url).toBe('https://mk.example.com/d/' + res.token);
    expect(ensureForCapture).not.toHaveBeenCalled();
  });

  it('auto mode: falls back to the tunnel for an http-only LAN desktop', async () => {
    const service = await build();
    const res = await service.createSession(
      ctx,
      { headers: { host: '192.168.1.10:8080' } },
      null,
      'http://192.168.1.10:8080',
    );
    expect(res.url).toBe('https://x.trycloudflare.com/d/' + res.token);
    expect(res.warmupSeconds).toBeGreaterThan(0);
    expect(ensureForCapture).toHaveBeenCalled();
  });

  it('never treats a loopback https origin as phone-reachable', async () => {
    const service = await build();
    const res = await service.createSession(
      ctx,
      { headers: { host: 'localhost:8080' } },
      null,
      'https://localhost:8080',
    );
    expect(res.url).toBe('https://x.trycloudflare.com/d/' + res.token);
    expect(ensureForCapture).toHaveBeenCalled();
  });

  it('on mode: forces the tunnel even when already on HTTPS', async () => {
    getMode.mockResolvedValue('on');
    const service = await build();
    const res = await service.createSession(
      ctx,
      { headers: { host: 'web:80' } },
      null,
      'https://mk.example.com',
    );
    expect(res.url).toBe('https://x.trycloudflare.com/d/' + res.token);
    expect(ensureForCapture).toHaveBeenCalled();
  });

  it('PUBLIC_BASE_URL always wins and skips the tunnel', async () => {
    process.env.PUBLIC_BASE_URL = 'https://fixed.example.com';
    getMode.mockResolvedValue('on');
    const service = await build();
    const res = await service.createSession(
      ctx,
      { headers: { host: 'web:80' } },
      null,
      'https://mk.example.com',
    );
    expect(res.url).toBe('https://fixed.example.com/d/' + res.token);
    expect(ensureForCapture).not.toHaveBeenCalled();
  });

  it('off mode: no tunnel, http-only LAN keeps the header URL (warning stays)', async () => {
    getMode.mockResolvedValue('off');
    ensureForCapture.mockResolvedValue({ url: null, freshlyStarted: false });
    const service = await build();
    const res = await service.createSession(
      ctx,
      { headers: { host: 'lan.local:8080' } },
      null,
      'http://lan.local:8080',
    );
    expect(res.url).toBe('http://lan.local:8080/d/' + res.token);
  });
});

describe('owner-cookie helpers', () => {
  it('reads the owner id from a multi-cookie header', () => {
    const req = {
      headers: { cookie: `theme=dark; ${OWNER_COOKIE}=abc-123; locale=en` },
    };
    expect(readOwnerId(req)).toBe('abc-123');
  });

  it('returns null when the cookie is absent', () => {
    expect(readOwnerId({ headers: { cookie: 'theme=dark' } })).toBeNull();
    expect(readOwnerId({ headers: {} })).toBeNull();
  });

  it('flags HTTPS only when x-forwarded-proto is https', () => {
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'https' } })).toBe(
      true,
    );
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'http' } })).toBe(
      false,
    );
    expect(isSecureRequest({ headers: {} })).toBe(false);
  });

  it('adds Secure to the cookie only when requested', () => {
    expect(buildOwnerSetCookie('id-1', true)).toContain('Secure');
    expect(buildOwnerSetCookie('id-1', false)).not.toContain('Secure');
    expect(buildOwnerSetCookie('id-1', true)).toContain('HttpOnly');
    expect(buildOwnerSetCookie('id-1', true)).toContain(
      'Path=/api/phone-bridge',
    );
  });
});

// The QR is the only thing that reaches a guest phone before it knows anything
// about this instance, so the desktop's language has to ride in the URL it
// encodes (#211) — the phone has no other way of learning it.
describe('PhoneBridgeService — the language in the QR', () => {
  let service: PhoneBridgeService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PhoneBridgeService,
        {
          provide: PrismaService,
          useValue: {
            phoneBridgeSession: { create: jest.fn(() => Promise.resolve({})) },
          },
        },
        {
          provide: AppConfigService,
          // An explicit public address short-circuits base-URL resolution, so
          // the spec is about the language and nothing else.
          useValue: {
            getPublicBaseUrlOverride: () => 'https://mk.example.com',
          },
        },
        {
          provide: CapabilityRegistryService,
          useValue: { getCapability: () => null },
        },
        { provide: CfTunnelService, useValue: {} },
        { provide: RequestContextService, useValue: { get: () => undefined } },
        { provide: RealtimeService, useValue: { emitToRoom: jest.fn() } },
        { provide: PhoneBridgeSettingsService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(PhoneBridgeService);
  });

  const create = (headers: Record<string, string | string[] | undefined>) =>
    service.createSession({ kind: 'capture' }, { headers }, 'owner-1');

  it('carries the caller locale', async () => {
    const { url } = await create({ 'x-locale': 'ru' });
    expect(url).toMatch(/^https:\/\/mk\.example\.com\/d\/br_.+\?lang=ru$/);
  });

  it('reads a repeated header as its first value', async () => {
    const { url } = await create({ 'x-locale': ['ru', 'en'] });
    expect(url).toContain('lang=ru');
  });

  it('leaves the URL clean when there is no usable locale', async () => {
    expect((await create({ 'x-locale': 'klingon' })).url).not.toContain('lang');
    expect((await create({})).url).not.toContain('lang');
  });
});
