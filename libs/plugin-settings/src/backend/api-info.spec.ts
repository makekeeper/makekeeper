import { afterEach, describe, expect, it } from 'vitest';
import { AppConfigService } from '@makekeeper/backend-core';
import type {
  AgentRegistryService,
  PluginRegistryService,
  PrismaService,
} from '@makekeeper/backend-core';
import { SettingsService } from './settings.service';

// The API tab (#282) exists to hand out a base URL a script can use. The two
// ways that URL can be reached — an operator's PUBLIC_BASE_URL and the
// (forwarded) request headers — are reported as distinct sources, because an
// owner debugging a URL that "works in the browser but not in curl" needs to
// know which of the two answered.

describe('SettingsService.getApiInfo', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  // Only AppConfigService takes part; the other collaborators belong to the
  // agent-tools half of the service and are never touched here.
  const service = (): SettingsService =>
    new SettingsService(
      undefined as unknown as PrismaService,
      undefined as unknown as AgentRegistryService,
      undefined as unknown as PluginRegistryService,
      new AppConfigService(),
    );

  const req = (headers: Record<string, string | string[] | undefined>) => ({
    headers,
  });

  it('reports the operator override as the source, over the browser', () => {
    process.env.PUBLIC_BASE_URL = 'https://mk.example.com/';
    const info = service().getApiInfo(
      req({ host: 'lan.local' }),
      'http://box.lan:8080',
    );
    expect(info.baseUrl).toBe('https://mk.example.com');
    expect(info.baseUrlSource).toBe('override');
  });

  // The browser is the only party that knows the address intact, port included
  // — the headers reach us through hops that drop it.
  it("prefers the caller's own origin over the request headers", () => {
    delete process.env.PUBLIC_BASE_URL;
    const info = service().getApiInfo(
      req({ 'x-forwarded-host': 'box.lan', host: 'localhost:3000' }),
      'http://box.lan:8080',
    );
    expect(info.baseUrl).toBe('http://box.lan:8080');
    expect(info.baseUrlSource).toBe('client');
  });

  it('ignores an origin that is not one, rather than echoing it back', () => {
    delete process.env.PUBLIC_BASE_URL;
    const info = service().getApiInfo(req({ host: 'lan.local' }), 'nonsense');
    expect(info.baseUrl).toBe('http://lan.local');
    expect(info.baseUrlSource).toBe('request');
  });

  it('falls back to the forwarded request headers and says so', () => {
    delete process.env.PUBLIC_BASE_URL;
    const info = service().getApiInfo(
      req({
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'mk.example.org',
        host: 'localhost:3000',
      }),
    );
    expect(info.baseUrl).toBe('https://mk.example.org');
    expect(info.baseUrlSource).toBe('request');
  });

  it('reports the configured token lifetime', () => {
    delete process.env.PUBLIC_BASE_URL;
    process.env.JWT_TTL = '12h';
    expect(
      service().getApiInfo(req({ host: 'lan.local' })).tokenTtlSeconds,
    ).toBe(12 * 3600);
  });

  it('reports the seven-day default when JWT_TTL is unset', () => {
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.JWT_TTL;
    expect(
      service().getApiInfo(req({ host: 'lan.local' })).tokenTtlSeconds,
    ).toBe(7 * 24 * 3600);
  });
});
