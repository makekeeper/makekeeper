// The receiver for opt-in liveness telemetry (#343).
//
// A Cloudflare Worker in front of a D1 database, and deliberately the dumbest
// thing that could work: one route, one write, no reads, no auth, no logging.
// It cannot serve data back — the survival numbers are read with `wrangler d1
// execute` (deploy/telemetry/queries.sql), so this endpoint has nothing to leak
// even if it is compromised.
//
// What it must never do:
//   - store an IP address, or anything derived from one;
//   - keep a history of pings (see schema.sql — one row per instance);
//   - accept a field the product does not document as sent.
//
// Cloudflare terminates TLS and therefore sees the address in transit. That is
// disclosed in the consent dialog and in INSTALL.md rather than glossed over;
// we simply never write it down.
//
// Plain JavaScript on purpose: it deploys with `wrangler deploy` from this
// directory, with no build step and no dependency on the monorepo's toolchain.

const MAX_BODY_BYTES = 2048;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^[0-9A-Za-z.+-]{1,32}$/;
const SIMPLE = /^[0-9A-Za-z._-]{1,32}$/;
const PLUGIN_ID = /^[0-9a-z-]{1,40}$/;

/** Everything a ping may carry. An extra key is a rejected request, not a warning. */
function parsePing(value) {
  if (typeof value !== 'object' || value === null) return null;
  const keys = Object.keys(value).sort().join(',');
  if (keys !== 'installMethod,instanceId,locale,plugins,version') return null;

  const { instanceId, version, installMethod, plugins, locale } = value;
  if (typeof instanceId !== 'string' || !UUID.test(instanceId)) return null;
  if (typeof version !== 'string' || !VERSION.test(version)) return null;
  if (typeof installMethod !== 'string' || !SIMPLE.test(installMethod)) return null;
  if (typeof locale !== 'string' || !SIMPLE.test(locale)) return null;
  if (!Array.isArray(plugins) || plugins.length > 64) return null;
  if (!plugins.every((id) => typeof id === 'string' && PLUGIN_ID.test(id))) {
    return null;
  }

  return {
    instanceId,
    version,
    installMethod,
    locale,
    plugins: [...plugins].sort().join(','),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/v1/ping') return new Response(null, { status: 404 });
    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { allow: 'POST' } });
    }

    const body = await request.text();
    // Length first: an oversized body is refused before it is parsed.
    if (body.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

    let parsed = null;
    try {
      parsed = parsePing(JSON.parse(body));
    } catch {
      parsed = null;
    }
    if (parsed === null) return new Response(null, { status: 400 });

    // Date, not timestamp: the questions this table answers are counted in
    // days, and a time of day would say something about the sender's habits.
    const today = new Date().toISOString().slice(0, 10);

    // One statement, so a first ping and a repeat are the same code path.
    // `first_seen` is written once and never moved; everything else follows the
    // latest ping, because an instance that upgraded should read as its new
    // version rather than as the one it was installed at.
    await env.DB.prepare(
      `INSERT INTO instances (id, first_seen, last_seen, version, install_method, plugins, locale)
       VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(id) DO UPDATE SET
         last_seen = excluded.last_seen,
         version = excluded.version,
         install_method = excluded.install_method,
         plugins = excluded.plugins,
         locale = excluded.locale`,
    )
      .bind(
        parsed.instanceId,
        today,
        parsed.version,
        parsed.installMethod,
        parsed.plugins,
        parsed.locale,
      )
      .run();

    // No body: there is nothing an instance needs to hear back, and a response
    // payload is one more thing that could grow into a channel.
    return new Response(null, { status: 204 });
  },
};
