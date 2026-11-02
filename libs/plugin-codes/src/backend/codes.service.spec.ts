import { Test } from '@nestjs/testing';
import {
  AgentRegistryService,
  AppConfigService,
  CapabilityRegistryService,
  PluginI18nService,
  PrismaService,
  RequestContextService,
} from '@makekeeper/backend-core';
import { CodesService } from './codes.service';

// Which address a printed label's QR opens (#372). It is built per request and
// never stored, so what matters is the resolver it goes through: the print
// dialog's own origin first, and — when there is none — proxy headers that no
// longer turn an inner hop's `:80` into `https://host:80`.
describe('CodesService label url', () => {
  let service: CodesService;
  const savedBaseUrl = process.env.PUBLIC_BASE_URL;

  const ref = 'mk://inventory/item/item-1';
  const stored = { id: 'label-1', code: 'IT-ABCDEF', ref };

  // The chained-proxy header bag from the issue: the outer TLS hop says https,
  // the inner http hop forwards its own port.
  const chainedProxy = {
    headers: {
      'x-forwarded-proto': 'http',
      'x-forwarded-scheme': 'https',
      'x-forwarded-host': 'mk.example.com',
      'x-forwarded-port': '80',
    },
  };

  beforeAll(() => {
    delete process.env.PUBLIC_BASE_URL;
  });
  afterAll(() => {
    if (savedBaseUrl !== undefined) process.env.PUBLIC_BASE_URL = savedBaseUrl;
  });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CodesService,
        AppConfigService,
        {
          provide: PrismaService,
          useValue: {
            label: {
              findUnique: jest.fn(() => Promise.resolve(stored)),
              create: jest.fn(),
            },
          },
        },
        { provide: CapabilityRegistryService, useValue: {} },
        { provide: AgentRegistryService, useValue: {} },
        { provide: RequestContextService, useValue: {} },
        { provide: PluginI18nService, useValue: { t: (key: string) => key } },
      ],
    }).compile();
    service = moduleRef.get(CodesService);
  });

  it("builds the QR address from the print dialog's origin", async () => {
    const label = await service.ensureLabel(
      ref,
      {
        headers: {
          'x-forwarded-scheme': 'https',
          'x-forwarded-host': 'mk.example.com',
          'x-forwarded-port': '8080',
        },
      },
      undefined,
      'https://mk.example.com',
    );
    expect(label.url).toBe('https://mk.example.com/c/IT-ABCDEF');
  });

  it('drops a forwarded :80 on https when no origin was sent', async () => {
    const label = await service.ensureLabel(ref, chainedProxy);
    expect(label.url).toBe('https://mk.example.com/c/IT-ABCDEF');
  });

  it('ignores an origin that is not an http(s) origin', async () => {
    const label = await service.ensureLabel(
      ref,
      chainedProxy,
      undefined,
      'javascript:alert(1)',
    );
    expect(label.url).toBe('https://mk.example.com/c/IT-ABCDEF');
  });
});
