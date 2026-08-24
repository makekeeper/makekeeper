import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { RequestContextService } from '@makekeeper/backend-core';
import {
  ExternalPubService,
  createExternalPubPipe,
} from '@makekeeper/plugin-external/backend';
import { MobileOriginService } from '@makekeeper/plugin-mobile/backend';
import { AppModule } from './app/app.module';
import { setupSwagger } from './app/swagger';

async function bootstrap() {
  // Disable Nest's built-in body parser (100 KB limit) — otherwise it runs
  // BEFORE our larger json() below and 413s any base64 image (chat attachments,
  // logistics screenshot import) long before the 12 MB limit applies.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  // Behind the shipped reverse proxy (the frontend nginx, plus any platform
  // edge proxy) the client IP arrives in X-Forwarded-For. Trust a BOUNDED
  // number of proxy hops so Express derives `req.ip` from the entry our own
  // proxy appended — not from a client-spoofable leftmost value — which the
  // login throttle keys on (#237). Defaults to 1 (the single nginx in the
  // shipped compose); a deployment with an extra edge proxy sets
  // TRUST_PROXY_HOPS. A low default errs toward over-counting, never a bypass.
  const parsedHops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '', 10);
  const trustProxyHops =
    Number.isInteger(parsedHops) && parsedHops >= 0 ? parsedHops : 1;
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);
  // Public-path byte pipe (#250): /api/external/pub/* streams raw to plugin
  // containers. Mounted BEFORE the body parsers on purpose — a piped request
  // is never deserialized (no parse-DoS surface, SSE flows untouched), so
  // nothing downstream may buffer or parse it.
  app.use(createExternalPubPipe(app.get(ExternalPubService)));
  // Larger bodies so requests can carry a base64 attachment — chat images,
  // screenshot import, and project file uploads (3D models, archives, code).
  // Kept in step with nginx's client_max_body_size (.devcontainer/nginx.conf).
  app.use(json({ limit: '64mb' }));
  app.use(urlencoded({ extended: true, limit: '64mb' }));
  // Every request runs inside an AsyncLocalStorage frame so the (optional)
  // multiuser overlay can attach user/scope context without threading it
  // through every signature. Plain `app.use` on purpose: it avoids the
  // Express 5 wildcard route-matching quirks of MiddlewareConsumer.
  const requestContext = app.get(RequestContextService);
  app.use((_req: unknown, _res: unknown, next: () => void) =>
    requestContext.run({}, next),
  );
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  // CORS exists for exactly one case: the mobile surface published on its own
  // host (#204). Resolved PER REQUEST, not once at boot — the address is now
  // also settable in the UI, and a value read at startup would leave that
  // setting silently half-working until a restart. With nothing configured the
  // callback allows nothing and the API stays same-origin, as it always was.
  const mobileOrigins = app.get(MobileOriginService);
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, false);
      void mobileOrigins
        .resolveConfigured()
        .then((configured) => callback(null, configured === origin))
        .catch(() => callback(null, false));
    },
    // The mobile page authenticates with a Bearer token, but attachments ride
    // the session cookie, and a cookie only crosses origins on a credentialed
    // request.
    credentials: true,
    // The rotated DEK re-arm key (#243) rides back on a response header; a
    // cross-origin mobile client can only read it if it is exposed here.
    exposedHeaders: ['x-session-key'],
  });
  // Interactive OpenAPI docs at /api/docs — routes are mounted here (before
  // init/listen so they aren't shadowed by Nest's not-found handler); the
  // document itself is built lazily on first request, by which point plugin
  // modules have registered their manifests/i18n in onModuleInit.
  setupSwagger(app);
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
