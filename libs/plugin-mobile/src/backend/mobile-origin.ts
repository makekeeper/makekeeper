// Whether the address the phone is currently talking to is one an installed PWA
// can live at (#198).
//
// An installed app is bound to its origin: the manifest, the service worker, its
// cache and its stored session all belong to one host. The quick Cloudflare
// tunnel hands out a fresh random `*.trycloudflare.com` name on every start and
// tears it down on idle, so an icon installed from it is dead within the hour.
// That is a WARNING, not a veto (#210) — the surface says what the address is
// and lets the person decide. A plain-http origin is different in kind: it is
// not a secure context, so the browser refuses the service worker (and the
// camera) regardless of what we offer.

import type { MobileOriginVerdict } from '@makekeeper/plugin-contract';

// Hosts handed out by `cloudflared tunnel --url` (the quick tunnel). Not a
// judgement about Cloudflare — a NAMED tunnel on an operator's own domain is a
// perfectly good origin; it is this one throwaway namespace that is ephemeral.
const EPHEMERAL_HOST_SUFFIX = '.trycloudflare.com';

// Secure contexts by definition, whatever the scheme (browsers exempt loopback).
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function hostname(host: string): string {
  // Strip the port; an IPv6 literal keeps its brackets, which is what the
  // loopback list matches on.
  return host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : (host.split(':')[0] ?? '');
}

// True for a host that will not exist after the next tunnel restart.
export function isEphemeralHost(host: string): boolean {
  return hostname(host).toLowerCase().endsWith(EPHEMERAL_HOST_SUFFIX);
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.includes(hostname(host).toLowerCase());
}

export function mobileOriginVerdict(
  host: string,
  secure: boolean,
): MobileOriginVerdict {
  if (isEphemeralHost(host)) return 'ephemeral-host';
  if (!secure && !isLoopbackHost(host)) return 'insecure';
  return 'ok';
}
