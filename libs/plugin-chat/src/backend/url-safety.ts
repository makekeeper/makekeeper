import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// SSRF guard for the untrusted personal connection-test path. A self-registered
// user must not be able to make the server probe its own internal network or a
// cloud metadata endpoint. Admin/instance tests and internal status probes are
// trusted (a self-hosted Ollama on localhost is a legitimate admin target), so
// this is applied ONLY to the personal route.
//
// Not applied elsewhere: the same private ranges are valid for admins.

// IPv4 ranges that must never be reachable from a user-supplied probe.
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    return true; // unparseable → treat as unsafe
  }
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 169 && b === 254) return true; // link-local 169.254/16 (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  if (addr === '::1' || addr === '::') return true; // loopback / unspecified
  if (addr.startsWith('fe80')) return true; // link-local fe80::/10
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // ULA fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d) — classify the embedded IPv4.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true; // not an IP literal → unsafe
}

// Returns true when the URL is safe to probe from the server: an http(s) URL
// whose host is a public address (or a hostname that resolves only to public
// addresses). DNS is resolved so a hostname pointing at an internal IP (or a
// rebinding attempt) is caught, not just literal IPs.
export async function isPubliclyRoutableUrl(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (isIP(host)) return !isPrivateAddress(host);

  try {
    const resolved = await lookup(host, { all: true });
    if (resolved.length === 0) return false;
    return resolved.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false; // unresolvable → unsafe
  }
}
