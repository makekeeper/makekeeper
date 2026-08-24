import { mobileOriginVerdict } from './mobile-origin';

describe('mobileOriginVerdict', () => {
  it('accepts a stable https origin', () => {
    expect(mobileOriginVerdict('makekeeper.example.com', true)).toBe('ok');
  });

  it('flags a quick-tunnel host even over https', () => {
    // The TLS is fine, the NAME is not — it is gone next boot. Since #210 that
    // is a warning the phone shows next to the install button, not a refusal.
    expect(mobileOriginVerdict('brave-fox-runs.trycloudflare.com', true)).toBe(
      'ephemeral-host',
    );
  });

  it('rejects a plain-http LAN address', () => {
    expect(mobileOriginVerdict('192.168.1.10:8080', false)).toBe('insecure');
  });

  it('accepts loopback over http — browsers treat it as a secure context', () => {
    expect(mobileOriginVerdict('localhost:4200', false)).toBe('ok');
    expect(mobileOriginVerdict('127.0.0.1:4200', false)).toBe('ok');
    expect(mobileOriginVerdict('[::1]:4200', false)).toBe('ok');
  });

  it('ignores host case and port when matching the ephemeral namespace', () => {
    expect(mobileOriginVerdict('Brave-Fox.TryCloudflare.com:443', true)).toBe(
      'ephemeral-host',
    );
  });
});
