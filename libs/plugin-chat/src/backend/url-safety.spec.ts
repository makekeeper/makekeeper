import { isPubliclyRoutableUrl } from './url-safety';

// IP-literal and parse cases are deterministic (no DNS). Hostname resolution is
// covered implicitly by the literal classifier these tests exercise.
describe('isPubliclyRoutableUrl', () => {
  it.each([
    'http://169.254.169.254/latest/meta-data', // cloud metadata
    'http://127.0.0.1:11434', // loopback
    'http://10.0.0.5/models', // private /8
    'http://172.16.0.1/models', // private /12
    'http://192.168.1.10/models', // private /16
    'http://100.64.0.1/models', // CGNAT
    'http://0.0.0.0', // "this host"
    'http://[::1]:11434', // IPv6 loopback literal
    'http://[fe80::1]', // IPv6 link-local literal
  ])('rejects internal target %s', async (url) => {
    expect(await isPubliclyRoutableUrl(url)).toBe(false);
  });

  it.each([
    'ftp://example.com', // non-http(s) scheme
    'file:///etc/passwd',
    'not-a-url',
    '',
  ])('rejects non-http(s) / unparseable %s', async (url) => {
    expect(await isPubliclyRoutableUrl(url)).toBe(false);
  });

  it.each([
    'http://8.8.8.8/models', // public IPv4 literal
    'https://172.15.0.1/v1', // just below the private /12
  ])('allows a public IP literal %s', async (url) => {
    expect(await isPubliclyRoutableUrl(url)).toBe(true);
  });
});
