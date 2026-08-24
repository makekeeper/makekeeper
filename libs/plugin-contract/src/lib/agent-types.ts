export enum PermissionLevel {
  READ = 'READ',
  WRITE = 'WRITE',
  DESTRUCTIVE = 'DESTRUCTIVE',
}

export type ToolArgs = Record<string, unknown>;

// One line of a batch mutation's itemized preview (#72): the concrete row about
// to be written, already resolved to a human name. `qty` is a preformatted
// display string (e.g. "×70") so the card can verify "70, not 7" before commit.
export interface ToolConfirmLine {
  text: string;
  qty?: string;
}

// A human-readable summary for the confirmation card. `key` is an i18n template
// owned by the tool's plugin (e.g. "Delete component «{name}»?"); `params` carry
// the call's ids already resolved to real names, so the frontend renders a clear
// localized sentence instead of the raw method name + JSON args. `lines` is an
// optional itemized preview for batch writes (an order's components, a stock
// receipt) — the exact rows the call will persist, so a photo-recognised batch
// is verified line by line, not trusted as a single "12 items" count (#72).
export interface ToolConfirmSummary {
  key: string;
  params?: Record<string, string>;
  lines?: ToolConfirmLine[];
}

export interface ToolParameterSchema {
  type: string;
  // i18n key for the parameter description. Resolved to the user's locale
  // server-side before the JSON schema is handed to the LLM — never a literal.
  descriptionKey: string;
  enum?: string[];
  items?: ToolParameterSchema;
}

export interface AgentTool {
  name: string;
  // i18n key for the tool description. Resolved to the user's locale on the
  // backend (for the LLM prompt) and on the frontend (`$t`, for the agent
  // capabilities UI) — the tool never carries a user-facing literal.
  descriptionKey: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameterSchema>;
    required?: string[];
  };
  permission: PermissionLevel;
  // Marks a tool whose input is inherently recognition-derived (e.g. an order
  // parsed from a photo). Such a mutation is forced onto the confirmation gate
  // regardless of its stored policy — provenance, not tool identity, drives the
  // gate (#72). A vision-capable turn does the same dynamically at runtime for
  // ordinary WRITE tools; this flag covers tools that carry the image directly.
  recognitionOrigin?: boolean;
  // Plugin ownership — declared on the tool itself so the registry can group
  // tools by plugin without a hardcoded plugin→tool map anywhere.
  pluginId: string;
  // i18n key for the owning plugin's display label (resolved on the frontend).
  pluginLabelKey: string;
  handler: (args: ToolArgs) => Promise<unknown>;
  // Marks a tool PROXIED to an out-of-process third-party plugin (#137). Such
  // a tool's confirmation gate can never be relaxed to auto-run: an internal
  // tool's AUTO setting rests on the code having passed review, and that
  // basis does not exist for a third-party container. The flag lives on the
  // tool (not looked up per call) so every consumer — settings projection,
  // gate evaluation, audit — reads the same fact.
  external?: boolean;
  // The owning plugin's icon name. Internal plugins are looked up in the
  // plugin registry; an EXTERNAL plugin is not in that registry at all, so it
  // carries its icon here — otherwise every third-party group in the agent
  // capabilities list showed the same fallback box.
  pluginIcon?: string;
  // Optional: builds the confirmation-card summary, resolving ids to human names
  // via the plugin's own service. Invoked only when a CONFIRM/DESTRUCTIVE call is
  // queued for the user. Falls back to name + args when absent or on failure.
  confirmSummary?: (
    args: ToolArgs,
  ) => Promise<ToolConfirmSummary> | ToolConfirmSummary;
}

export type ConfirmationPolicy = 'AUTO' | 'CONFIRM';

// The confirmation policy a tool is seeded with when no admin override exists:
// every mutating tool (WRITE + DESTRUCTIVE) gates on the end user before it
// runs; only READ auto-runs. Admins can later relax a specific tool to AUTO
// from the settings UI. Single source of truth so the seed default never drifts
// between the registry and the settings projection.
export function defaultConfirmationPolicy(
  permission: PermissionLevel,
): ConfirmationPolicy {
  return permission === PermissionLevel.READ ? 'AUTO' : 'CONFIRM';
}

// Whether a mutating call carries recognition provenance (#72): a WRITE/
// DESTRUCTIVE whose data came from recognition — a recognition-origin tool
// (image in), or a vision turn the model is acting on. Single source of truth so
// the confirmation gate (`requiresConfirmation`) and the card's "verify what was
// recognised" hint can never derive it two different ways. A READ never has
// mutation provenance, whatever its input.
export function hasRecognitionProvenance(input: {
  permission: PermissionLevel;
  recognitionOrigin?: boolean;
  visionTurn?: boolean;
}): boolean {
  const mutates =
    input.permission === PermissionLevel.WRITE ||
    input.permission === PermissionLevel.DESTRUCTIVE;
  return (
    mutates && (input.recognitionOrigin === true || input.visionTurn === true)
  );
}

// Whether a proposed tool call must pause for end-user confirmation (#72).
// Provenance, not just the static tool tier, drives the gate: a mutation whose
// data originates from recognition — a recognition-origin tool (image in), or a
// vision turn the model is acting on — confirms even when an admin relaxed it to
// AUTO, so a misread ("7 → 70") can't write silently. DESTRUCTIVE always
// confirms; a manual, image-free WRITE follows its stored policy.
export function requiresConfirmation(input: {
  policy: ConfirmationPolicy;
  permission: PermissionLevel;
  recognitionOrigin?: boolean;
  visionTurn?: boolean;
}): boolean {
  if (input.permission === PermissionLevel.DESTRUCTIVE) return true;
  if (input.policy === 'CONFIRM') return true;
  return hasRecognitionProvenance(input);
}

// Public projection of a tool sent to the frontend: the code-defined shape
// (minus handler/plugin fields) merged with its per-tool DB configuration. The
// frontend resolves `descriptionKey` with `$t()` at render time.
export type AgentToolPublic = Pick<
  AgentTool,
  'name' | 'descriptionKey' | 'permission' | 'parameters'
> & {
  isEnabled: boolean;
  confirmationPolicy: ConfirmationPolicy;
  // Proxied to a third-party plugin: the settings UI hides the auto-run
  // option and the backend refuses to store one (#137).
  external?: boolean;
};

// A tool projected for a concrete LLM request: every i18n key already resolved
// to a localized string. Produced by the backend i18n resolver from an
// `AgentTool` + the caller's locale, then handed to the provider SDK.
export interface ResolvedToolParameterSchema {
  type: string;
  description: string;
  enum?: string[];
  items?: ResolvedToolParameterSchema;
}

export interface ResolvedAgentTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ResolvedToolParameterSchema>;
    required?: string[];
  };
}

export interface AgentToolGroup {
  pluginId: string;
  // i18n key — the frontend resolves it with `t()`; never a raw literal.
  pluginLabelKey: string;
  icon: string;
  tools: AgentToolPublic[];
}

// Definition of a tool as a plugin author writes it — without the plugin
// ownership fields, which `withPlugin` stamps on at registration time.
export type AgentToolDefinition = Omit<
  AgentTool,
  'pluginId' | 'pluginLabelKey'
>;

// Stamps a plugin's identity onto its tool definitions so each plugin declares
// its `pluginId`/`pluginLabelKey` exactly once, at the registration site.
export function withPlugin(
  pluginId: string,
  pluginLabelKey: string,
  tools: AgentToolDefinition[],
): AgentTool[] {
  return tools.map((tool) => ({ ...tool, pluginId, pluginLabelKey }));
}
