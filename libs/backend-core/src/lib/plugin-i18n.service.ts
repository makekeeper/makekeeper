import { Injectable, Logger } from '@nestjs/common';
import {
  AgentTool,
  PluginLocaleMessages,
  ResolvedAgentTool,
  ResolvedToolParameterSchema,
  ToolParameterSchema,
} from '@makekeeper/plugin-contract';

type LocaleTree = Record<string, unknown>;
type InterpolationParams = Record<string, string | number>;

// The locale every lookup falls back to when the requested one is unknown or
// missing a key — mirrors the frontend's `fallbackLocale: 'en'`.
export const DEFAULT_LOCALE = 'en';

// Deep-merges a plugin locale tree onto the accumulator so several plugins can
// each contribute keys under shared sections. Leaf values from later bundles
// win. Mirrors `buildMessages`/`deepMerge` on the frontend so a key resolves to
// the same string on both sides.
function deepMerge(base: LocaleTree, incoming: LocaleTree): LocaleTree {
  for (const [key, value] of Object.entries(incoming)) {
    const existing = base[key];
    if (
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      base[key] = deepMerge(existing as LocaleTree, value as LocaleTree);
    } else {
      base[key] = value;
    }
  }
  return base;
}

// Walks a dotted key path (`chat.prompt.system`) through a locale tree and
// returns the leaf string, or undefined if the path is missing or not a string.
function lookup(tree: LocaleTree | undefined, key: string): string | undefined {
  if (!tree) return undefined;
  let node: unknown = tree;
  for (const segment of key.split('.')) {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      node = (node as LocaleTree)[segment];
    } else {
      return undefined;
    }
  }
  return typeof node === 'string' ? node : undefined;
}

// Replaces `{name}` placeholders with params, matching vue-i18n's default named
// interpolation so backend and frontend render the same template identically.
function interpolate(template: string, params?: InterpolationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

// Server-side i18n resolver. Plugins register their own `{ en, ru }` bundles at
// module init (the same JSON the frontend ships), and the backend resolves keys
// to the caller's locale for text that is assembled server-side and never
// passes through the frontend's `t()` — chiefly LLM prompts and agent-tool
// descriptions.
@Injectable()
export class PluginI18nService {
  private readonly logger = new Logger(PluginI18nService.name);
  private readonly messages: Record<string, LocaleTree> = {};

  registerBundle(bundle: PluginLocaleMessages): void {
    for (const [locale, tree] of Object.entries(bundle)) {
      this.messages[locale] = deepMerge(
        this.messages[locale] ?? {},
        tree as LocaleTree,
      );
    }
  }

  // Resolves a requested locale to one we actually have a bundle for, else the
  // default — so an unknown `Accept-Language` never yields raw keys.
  private pickLocale(locale?: string): string {
    return locale && this.messages[locale] ? locale : DEFAULT_LOCALE;
  }

  t(key: string, params?: InterpolationParams, locale?: string): string {
    const raw =
      lookup(this.messages[this.pickLocale(locale)], key) ??
      lookup(this.messages[DEFAULT_LOCALE], key);
    if (raw === undefined) {
      this.logger.warn(`Missing i18n key "${key}"`);
      return key;
    }
    return interpolate(raw, params);
  }

  // Whether a key resolves — for callers that build text conditionally and must
  // not trip the missing-key warning `t()` emits on a miss.
  has(key: string, locale?: string): boolean {
    return (
      lookup(this.messages[this.pickLocale(locale)], key) !== undefined ||
      lookup(this.messages[DEFAULT_LOCALE], key) !== undefined
    );
  }

  // Projects a registered tool for an LLM request, resolving its description and
  // every parameter description to the caller's locale.
  resolveTool(tool: AgentTool, locale?: string): ResolvedAgentTool {
    return {
      name: tool.name,
      description: this.t(tool.descriptionKey, undefined, locale),
      parameters: {
        type: 'object',
        properties: this.resolveProperties(tool.parameters.properties, locale),
        required: tool.parameters.required,
      },
    };
  }

  private resolveProperties(
    properties: Record<string, ToolParameterSchema>,
    locale?: string,
  ): Record<string, ResolvedToolParameterSchema> {
    const resolved: Record<string, ResolvedToolParameterSchema> = {};
    for (const [name, schema] of Object.entries(properties)) {
      resolved[name] = this.resolveParam(schema, locale);
    }
    return resolved;
  }

  private resolveParam(
    schema: ToolParameterSchema,
    locale?: string,
  ): ResolvedToolParameterSchema {
    const resolved: ResolvedToolParameterSchema = {
      type: schema.type,
      description: this.t(schema.descriptionKey, undefined, locale),
    };
    if (schema.enum) resolved.enum = schema.enum;
    if (schema.items) resolved.items = this.resolveParam(schema.items, locale);
    return resolved;
  }
}
