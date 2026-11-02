import { Test } from '@nestjs/testing';
import { GoneException } from '@nestjs/common';
import { encodeRasterPayload } from '@makekeeper/plugin-contract';
import {
  AppConfigService,
  PluginI18nService,
  PrismaService,
  RequestContextService,
} from '@makekeeper/backend-core';
import { PrintHandoffService } from './print-handoff.service';

// What a handoff link is worth, and for how long (#361). The three ways a token
// dies — expired, spent by a print, exhausted by attempts — are one answer to
// the caller, and the fourth case (a failed print) must NOT kill it.
describe('PrintHandoffService', () => {
  let service: PrintHandoffService;
  let findUnique: jest.Mock;
  let update: jest.Mock;
  let updateMany: jest.Mock;
  let create: jest.Mock;
  let deleteMany: jest.Mock;

  // 48 bytes per row × 2 rows: a valid, if tiny, page, in the shape it travels
  // in (the contract's own wire payload).
  const page = encodeRasterPayload(
    { widthDots: 384, heightDots: 2, rows: new Uint8Array(48 * 2) },
    1,
  );

  const row = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    token: 'tok',
    widthDots: 384,
    heightDots: 2,
    rows: Buffer.alloc(96),
    copies: 1,
    attempts: 0,
    printedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });

  beforeEach(async () => {
    findUnique = jest.fn();
    update = jest.fn(() => Promise.resolve(row()));
    updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    create = jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve(args.data),
    );
    deleteMany = jest.fn(() => Promise.resolve({ count: 0 }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrintHandoffService,
        {
          provide: PrismaService,
          useValue: {
            printHandoff: {
              findUnique,
              update,
              updateMany,
              create,
              deleteMany,
            },
          },
        },
        // The real resolver, not a stub: which address the link carries is
        // exactly what #372 got wrong, so the spec has to exercise it.
        AppConfigService,
        {
          provide: RequestContextService,
          useValue: {
            runWithoutScope: <T>(_reason: string, fn: () => Promise<T>) => fn(),
          },
        },
        { provide: PluginI18nService, useValue: { t: (key: string) => key } },
      ],
    }).compile();

    service = moduleRef.get(PrintHandoffService);
  });

  const savedBaseUrl = process.env.PUBLIC_BASE_URL;
  beforeAll(() => {
    delete process.env.PUBLIC_BASE_URL;
  });
  afterAll(() => {
    if (savedBaseUrl !== undefined) process.env.PUBLIC_BASE_URL = savedBaseUrl;
  });

  const httpsHost = { host: 'shop.example', 'x-forwarded-proto': 'https' };

  it('parks a page and returns a link carrying the locale', async () => {
    const link = await service.create(page, { headers: httpsHost }, 'ru');
    expect(link.url).toMatch(
      /^https:\/\/shop\.example\/print\/niimbot\/[\w-]+\?lang=ru$/,
    );
    expect(Date.parse(link.expiresAt)).toBeGreaterThan(Date.now());
    // The row holds the page and nothing identifying what it depicts.
    const data = create.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual([
      'copies',
      'expiresAt',
      'heightDots',
      'rows',
      'token',
      'widthDots',
    ]);
  });

  // #372: the link is opened on another device, so it carries the address the
  // posting browser actually reached, not the proxy headers' guess.
  it("builds the link from the posting browser's origin", async () => {
    const link = await service.create(
      { ...page, origin: 'https://mk.example.com' },
      {
        headers: {
          'x-forwarded-scheme': 'https',
          'x-forwarded-host': 'mk.example.com',
          'x-forwarded-port': '80',
          host: 'web:80',
        },
      },
    );
    expect(link.url).toMatch(
      /^https:\/\/mk\.example\.com\/print\/niimbot\/[\w-]+$/,
    );
  });

  it('drops a forwarded :80 on https when no origin was sent', async () => {
    const link = await service.create(page, {
      headers: {
        'x-forwarded-proto': 'http',
        'x-forwarded-scheme': 'https',
        'x-forwarded-host': 'mk.example.com',
        'x-forwarded-port': '80',
      },
    });
    expect(link.url).toMatch(
      /^https:\/\/mk\.example\.com\/print\/niimbot\/[\w-]+$/,
    );
  });

  it('refuses a page that does not match its own size', async () => {
    await expect(
      service.create(
        { ...page, rows: Buffer.alloc(10).toString('base64') },
        { headers: {} },
      ),
    ).rejects.toBeInstanceOf(GoneException);
    expect(create).not.toHaveBeenCalled();
  });

  it('serves the parked page and counts the attempt', async () => {
    findUnique.mockResolvedValue(row());
    const payload = await service.claim('tok');
    expect(payload.widthDots).toBe(384);
    expect(payload.rows).toBe(Buffer.alloc(96).toString('base64'));
    expect(update).toHaveBeenCalledWith({
      where: { token: 'tok' },
      data: { attempts: { increment: 1 } },
    });
  });

  it.each([
    ['unknown', null],
    ['expired', row({ expiresAt: new Date(Date.now() - 1) })],
    ['already printed', row({ printedAt: new Date() })],
    ['out of attempts', row({ attempts: 10 })],
  ])('refuses a token that is %s', async (_case, stored) => {
    findUnique.mockResolvedValue(stored);
    await expect(service.claim('tok')).rejects.toBeInstanceOf(GoneException);
  });

  it('spends the token on a reported print, and tolerates a second report', async () => {
    await service.markPrinted('tok');
    expect(updateMany).toHaveBeenCalledWith({
      where: { token: 'tok', printedAt: null },
      data: { printedAt: expect.any(Date) },
    });
    updateMany.mockResolvedValue({ count: 0 });
    await expect(service.markPrinted('tok')).resolves.toBeUndefined();
  });
});
