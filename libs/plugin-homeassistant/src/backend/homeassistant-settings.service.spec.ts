import {
  HomeAssistantSettingsService,
  normalizeBaseUrl,
} from './homeassistant-settings.service';

// Two properties worth a test: the token never comes back out, and "leave it
// alone" is spelled differently from "clear it" (#220) — the mistake that
// silently drops a credential when a screen saves an unrelated field.

describe('normalizeBaseUrl', () => {
  it('accepts what an admin actually pastes', () => {
    expect(normalizeBaseUrl('http://ha.local:8123')).toBe(
      'http://ha.local:8123',
    );
    expect(normalizeBaseUrl('  https://ha.example.com/  ')).toBe(
      'https://ha.example.com',
    );
    // The documentation shows `/api` paths, so half the pastes carry one.
    expect(normalizeBaseUrl('http://ha.local:8123/api')).toBe(
      'http://ha.local:8123',
    );
    // A LAN address is the normal case here, not a suspicious one.
    expect(normalizeBaseUrl('http://192.168.1.4:8123')).toBe(
      'http://192.168.1.4:8123',
    );
  });

  it('refuses what cannot be a Home Assistant address', () => {
    expect(normalizeBaseUrl('')).toBeNull();
    expect(normalizeBaseUrl('ha.local:8123')).toBeNull();
    expect(normalizeBaseUrl('ftp://ha.local')).toBeNull();
    expect(normalizeBaseUrl('file:///etc/passwd')).toBeNull();
  });
});

function harness(
  row: { baseUrl?: string | null; token?: string | null } | null,
) {
  const stored = row === null ? null : { id: 'default', ...row };
  const upsert = jest.fn().mockResolvedValue({});
  const prisma = {
    homeAssistantSettings: {
      findUnique: jest.fn().mockResolvedValue(stored),
      upsert,
    },
  };
  const secretBox = {
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) =>
      value.startsWith('enc:') ? value.slice(4) : null,
    isEncrypted: (value: string) => value.startsWith('enc:'),
  };
  const i18n = { t: (key: string) => key };
  const service = new HomeAssistantSettingsService(
    prisma as never,
    secretBox as never,
    i18n as never,
  );
  return { service, upsert };
}

describe('HomeAssistantSettingsService', () => {
  it('reads as unconfigured with no row', async () => {
    const { service } = harness(null);
    expect(await service.get()).toEqual({ baseUrl: null, hasToken: false });
    expect(service.isConfiguredSync()).toBe(false);
  });

  it('never returns the token, only that there is one', async () => {
    const { service } = harness({
      baseUrl: 'http://ha.local:8123',
      token: 'enc:secret',
    });
    const published = await service.get();
    expect(published).toEqual({
      baseUrl: 'http://ha.local:8123',
      hasToken: true,
    });
    expect(JSON.stringify(published)).not.toContain('secret');
    // The backend's own path does get it.
    expect((await service.getInternal()).token).toBe('secret');
    expect(service.isConfiguredSync()).toBe(true);
  });

  it('treats an undecryptable token as none rather than crashing', async () => {
    const { service } = harness({ baseUrl: 'http://ha.local', token: 'junk' });
    expect((await service.getInternal()).token).toBeNull();
  });

  it('keeps the stored token when the field is absent', async () => {
    const { service, upsert } = harness({
      baseUrl: 'http://ha.local:8123',
      token: 'enc:secret',
    });
    await service.update({ baseUrl: 'http://ha.local:8123' });
    expect(upsert.mock.calls[0][0].update.token).toBeUndefined();
  });

  it('clears the token when the field is empty, and re-encrypts a new one', async () => {
    const cleared = harness({ baseUrl: 'http://ha.local', token: 'enc:old' });
    await cleared.service.update({ token: '' });
    expect(cleared.upsert.mock.calls[0][0].update.token).toBeNull();

    const replaced = harness({ baseUrl: 'http://ha.local', token: 'enc:old' });
    await replaced.service.update({ token: 'fresh' });
    expect(replaced.upsert.mock.calls[0][0].update.token).toBe('enc:fresh');
  });

  it('stores the address in one form, whatever form it arrived in', async () => {
    const { service, upsert } = harness(null);
    await service.update({ baseUrl: 'http://ha.local:8123/api/' });
    expect(upsert.mock.calls[0][0].update.baseUrl).toBe('http://ha.local:8123');
  });

  it('refuses an address that is not one, instead of saving it', async () => {
    const { service, upsert } = harness(null);
    await expect(service.update({ baseUrl: 'ha.local' })).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('forgets its cache after a write, so the next read decrypts afresh', async () => {
    const { service } = harness({ baseUrl: 'http://ha.local', token: null });
    await service.get();
    await service.update({ token: 'fresh' });
    // The row the stub returns has not changed, but the service must have let
    // go of what it had: a stale cache here means a saved token that the next
    // request does not use.
    expect(service.isConfiguredSync()).toBe(false);
  });
});
