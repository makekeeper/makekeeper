import {
  AgentToolDefinition,
  PermissionLevel,
  ToolArgs,
  ToolConfirmSummary,
  ToolParameterSchema,
} from './agent-types';

// A parameter as an author declares it in `defineTools`. The crucial difference
// from a raw ToolParameterSchema: there is NO `descriptionKey` here. The key is
// DERIVED from the tool + parameter name (see below), so it can never drift from
// the JSON tree it is supposed to mirror — the single most error-prone, most
// repeated line in every `*.tools.ts` file.
export interface ToolParamDef {
  type: 'string' | 'number' | 'boolean' | 'integer' | 'array';
  // Parameters are REQUIRED by default (the common case); mark the exceptions.
  optional?: boolean;
  enum?: string[];
  // Element type for an `array` parameter. Its descriptionKey is derived as
  // `<param>.items` under the same namespace. Deliberately shallow: only the
  // item `type` is expressible here — no item `enum` and no nested object
  // `properties`. A tool whose array items need either stays hand-written as a
  // raw AgentTool (they concatenate with `defineTools`' output), so reach for a
  // literal there instead of silently dropping the item schema.
  items?: { type: string };
}

// A tool as an author declares it: identity + permission + a flat param map +
// the handler (and, for mutations, a confirm-summary builder). Everything that
// was mechanical boilerplate — the `descriptionKey` strings, the
// `type: 'object'` wrapper, the `required` array — is derived by `defineTools`.
export interface ToolDef {
  name: string;
  permission: PermissionLevel;
  // Keyed by parameter name; insertion order is preserved into the JSON schema.
  params?: Record<string, ToolParamDef>;
  recognitionOrigin?: boolean;
  confirmSummary?: (
    args: ToolArgs,
  ) => Promise<ToolConfirmSummary> | ToolConfirmSummary;
  handler: (args: ToolArgs) => Promise<unknown>;
}

// Derive the AgentToolDefinition list from convention-driven ToolDefs. Every
// i18n key is DERIVED, never hand-written:
//   tool description  →  `<keyNamespace>.<tool>.description`
//   parameter         →  `<keyNamespace>.<tool>.params.<param>`
//   array item        →  `<keyNamespace>.<tool>.params.<param>.items`
// The keys still live in the plugin's `i18n/{en,ru}.json` exactly as before —
// only their re-typing at every call site goes away, which is also what makes a
// missing/renamed key catchable by a single "every derived key resolves" spec
// instead of a runtime `logger.warn`. `required` is derived from each param's
// `optional` flag. The result is a plain AgentToolDefinition[], so it composes
// with `withPlugin` and can be concatenated with any hand-written tools that
// don't fit the convention.
export function defineTools(
  keyNamespace: string,
  defs: ToolDef[],
): AgentToolDefinition[] {
  return defs.map((def): AgentToolDefinition => {
    const base = `${keyNamespace}.${def.name}`;
    const properties: Record<string, ToolParameterSchema> = {};
    const required: string[] = [];

    for (const [paramName, param] of Object.entries(def.params ?? {})) {
      const schema: ToolParameterSchema = {
        type: param.type,
        descriptionKey: `${base}.params.${paramName}`,
      };
      if (param.enum) schema.enum = param.enum;
      if (param.items) {
        schema.items = {
          type: param.items.type,
          descriptionKey: `${base}.params.${paramName}.items`,
        };
      }
      properties[paramName] = schema;
      if (!param.optional) required.push(paramName);
    }

    return {
      name: def.name,
      descriptionKey: `${base}.description`,
      permission: def.permission,
      parameters: { type: 'object', properties, required },
      ...(def.recognitionOrigin ? { recognitionOrigin: true } : {}),
      ...(def.confirmSummary ? { confirmSummary: def.confirmSummary } : {}),
      handler: def.handler,
    };
  });
}
