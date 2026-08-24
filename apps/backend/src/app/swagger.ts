import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { PluginI18nService } from '@makekeeper/backend-core';
import { API_DOCS_PATH } from '@makekeeper/plugin-contract';

// The settings UI links to the same docs (#282), so the path is contract, not a
// local constant. `SwaggerModule.setup` wants it without the leading slash.
const DOCS_PATH = API_DOCS_PATH.slice(1);
const API_VERSION = '1.0';
// OAuth2 "password" grant endpoint the Authorize dialog posts credentials to.
const TOKEN_URL = '/api/auth/token';
// The docs are a single shared surface, not a per-request response, so their
// text resolves at one fixed locale. English is the source locale of every
// bundle, so it always resolves.
const DOCS_LOCALE = 'en';
// A summary/description carrying this prefix is an i18n key to resolve; any
// other string is a sanctioned plain literal (see docs/api-docs.md). Gating on
// the marker keeps hand-written literals from spamming the missing-key logger.
const I18N_MARKER = 'i18n:';

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'patch',
  'options',
  'head',
] as const;

type Translate = (key: string) => string;

function localize(
  value: string | undefined,
  translate: Translate,
): string | undefined {
  if (value === undefined || !value.startsWith(I18N_MARKER)) return value;
  return translate(value.slice(I18N_MARKER.length));
}

// Resolves the `i18n:<key>` markers the decorators emit into English text on the
// generated document — operation summaries/descriptions and DTO property
// descriptions. Anything without the marker is left verbatim.
function localizeDocument(doc: OpenAPIObject, translate: Translate): void {
  for (const pathItem of Object.values(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      operation.summary = localize(operation.summary, translate);
      operation.description = localize(operation.description, translate);
    }
  }
  for (const schema of Object.values(doc.components?.schemas ?? {})) {
    // ReferenceObject (`$ref`) carries no `properties` — only SchemaObject does.
    if (!('properties' in schema) || !schema.properties) continue;
    for (const property of Object.values(schema.properties)) {
      if ('description' in property) {
        property.description = localize(property.description, translate);
      }
    }
  }
}

// Builds the OpenAPI document: tags/text come from the plugin registry and
// i18n, both of which are populated in onModuleInit — so this must run lazily
// (after init), not at setup time.
function buildDocument(app: INestApplication): OpenAPIObject {
  const i18n = app.get(PluginI18nService);
  const translate: Translate = (key) => i18n.t(key, undefined, DOCS_LOCALE);

  const builder = new DocumentBuilder()
    .setTitle(translate('core.apiDocs.title'))
    .setDescription(translate('core.apiDocs.description'))
    .setVersion(API_VERSION)
    // Two ways to authorize in the UI, joined OR on each secured op: paste a
    // token (bearer), or use the OAuth2 "password" form which trades
    // username/password for a token via /api/auth/token and attaches it itself.
    .addBearerAuth()
    .addOAuth2({
      type: 'oauth2',
      flows: { password: { tokenUrl: TOKEN_URL, scopes: {} } },
    });

  const document = SwaggerModule.createDocument(app, builder.build());
  localizeDocument(document, translate);
  document.tags = describeTags(collectUsedTags(document), i18n);
  return document;
}

// Collects the tag names actually referenced by operations, so we describe only
// the plugins that expose endpoints (e.g. a UI-only plugin like `uxmode` owns no
// routes and gets no empty tag group).
function collectUsedTags(doc: OpenAPIObject): Set<string> {
  const used = new Set<string>();
  for (const pathItem of Object.values(doc.paths)) {
    for (const method of HTTP_METHODS) {
      pathItem[method]?.tags?.forEach((tag) => used.add(tag));
    }
  }
  return used;
}

// Attaches each used tag's description from the plugin's own manifest i18n
// (`plugins.<id>.description`), resolved to English — skipping the description
// when no such key exists (e.g. the core `core` tag), which also avoids the
// missing-key warning `t()` would emit.
function describeTags(
  used: Set<string>,
  i18n: PluginI18nService,
): OpenAPIObject['tags'] {
  return [...used].sort().map((name) => {
    const key = `plugins.${name}.description`;
    return i18n.has(key, DOCS_LOCALE)
      ? { name, description: i18n.t(key, undefined, DOCS_LOCALE) }
      : { name };
  });
}

// Mounts interactive OpenAPI docs at /api/docs. Swagger UI is served by express
// (via SwaggerModule.setup), so it sits outside the Nest guard chain and stays
// reachable without auth — the intended "always open" behavior. The document is
// passed as a factory so it builds on first request (once the DI lifecycle has
// registered every plugin), while the routes themselves mount here at boot.
export function setupSwagger(app: INestApplication): void {
  let cached: OpenAPIObject | undefined;
  const documentFactory = (): OpenAPIObject => {
    if (!cached) cached = buildDocument(app);
    return cached;
  };
  SwaggerModule.setup(DOCS_PATH, app, documentFactory);
  Logger.log(`API docs available at /${DOCS_PATH}`, 'Swagger');
}
