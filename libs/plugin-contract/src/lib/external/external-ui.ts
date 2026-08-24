// External plugin contract — the server-driven component vocabulary (#132).
//
// An external plugin never ships frontend code. For content the core asks the
// plugin to "render screen X" and receives a tree of nodes from this fixed
// vocabulary; the core renders it with its own frontend-core primitives, so
// the design system, dark/light theming, a11y and i18n rules hold by
// construction. Every visible text is an i18n reference (key + params) into
// the plugin's registered bundles — never a literal. Entity references are
// canonical ORefs rendered as in-app links.
//
// Evolution rule (decision #9): adding a node type or an optional field is a
// minor contract bump; renaming/removing is a major. A node whose `type` the
// core does not know is SKIPPED (with a plugin-card notice), never an error —
// so a plugin built for contract 1.2 degrades gracefully on a 1.1 core.

// A localized text: resolved via the plugin's i18n bundles at render time.
export interface UiText {
  key: string;
  params?: Record<string, string | number>;
}

// An action reference: posted back to the plugin when the user triggers it.
// `action` names a handler inside the plugin; `params` are echoed verbatim.
export interface UiAction {
  action: string;
  params?: Record<string, string | number | boolean>;
}

export type UiTone = 'neutral' | 'success' | 'warning' | 'danger' | 'brand';

// ── Nodes ───────────────────────────────────────────────────────────────────

export interface UiTextNode {
  type: 'text';
  text: UiText;
  variant?: 'body' | 'muted' | 'heading';
}

export interface UiBadgeNode {
  type: 'badge';
  text: UiText;
  tone?: UiTone;
}

export interface UiStatNode {
  type: 'stat';
  label: UiText;
  value: string;
  unit?: UiText;
  icon?: string;
}

export interface UiCalloutNode {
  type: 'callout';
  text: UiText;
  tone?: UiTone;
}

export interface UiDividerNode {
  type: 'divider';
}

export interface UiButtonNode {
  type: 'button';
  label: UiText;
  onClick: UiAction;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: string;
  // Renders the shared confirm dialog before posting the action.
  confirm?: UiText;
}

// A key→value listing (detail views).
export interface UiDetailNode {
  type: 'detail';
  rows: Array<{
    label: UiText;
    value: string | UiText;
    // Rendered as an in-app link when present (canonical mk:// reference).
    ref?: string;
  }>;
}

export interface UiTableColumn {
  key: string;
  label: UiText;
  align?: 'left' | 'right';
  // The header becomes a sort control (contract 1.9). Who does the sorting
  // follows who does the paging: the core sorts the rows it holds, and a
  // plugin-paged table gets a re-render with the sort as render params —
  // sorting one page of a million rows would sort the wrong thing.
  sortable?: boolean;
}

export interface UiTableCell {
  text?: string | UiText;
  badge?: { text: UiText; tone?: UiTone };
  ref?: string;
}

// Paging the PLUGIN owns (contract 1.8).
//
// `filterable`/`pageSize` hand every row to the core, which is right for a
// hundred and wrong for a hundred thousand: the rows would cross the proxy and
// land in a browser to be thrown away. With `paging` the plugin returns one
// page and the core asks for the next by re-rendering the screen with the page
// number as a render param — the plugin decides what a page is and where it
// comes from.
export interface UiPaging {
  // Zero-based page currently rendered.
  page: number;
  pageSize: number;
  // Total rows when the plugin can say cheaply. Absent ⇒ unknown, and `next`
  // is driven by `hasMore` alone — counting ten million rows to render one
  // page is exactly the cost this mode exists to avoid.
  total?: number;
  hasMore?: boolean;
  // Render param carrying the page number. Defaults to `page`.
  pageParam?: string;
  // The sort the returned page was produced with, so the header can show it
  // (contract 1.9). The core sends the next one back through `sortParam` /
  // `directionParam`, defaulting to `sort` and `direction`.
  sort?: { key: string; direction: 'asc' | 'desc' };
  sortParam?: string;
  directionParam?: string;
}

export interface UiTableNode {
  type: 'table';
  // Rows come from the plugin one page at a time.
  paging?: UiPaging;
  // Let the CORE filter and paginate the rows it was given (contract 1.7).
  //
  // A plugin can do both itself, and the rates example did: a filter field
  // that re-renders through the plugin, and its own cap. That costs a round
  // trip per keystroke-ish and reimplements, per plugin, something every long
  // table needs. Handing over all the rows and letting the core search them is
  // instant, consistent, and one implementation.
  //
  // Both are HINTS: a core that does not know them renders the plain table it
  // always did.
  filterable?: boolean;
  // Rows per page; absent or 0 ⇒ no pagination.
  pageSize?: number;
  columns: UiTableColumn[];
  rows: Array<{
    cells: Record<string, UiTableCell>;
    onClick?: UiAction;
    // One action ON the row, in a trailing column (contract 1.9) — the same
    // shape a list item has. Paged data needs operations, and making the whole
    // row the destructive target turns reading a table into a minefield.
    action?: {
      label: UiText;
      onClick: UiAction;
      confirm?: UiText;
      variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    };
  }>;
  empty?: UiText;
}

export interface UiListNode {
  type: 'list';
  items: Array<{
    title: string | UiText;
    subtitle?: string | UiText;
    icon?: string;
    ref?: string;
    badge?: { text: UiText; tone?: UiTone };
    onClick?: UiAction;
    // One action ON the row, rather than the row BEING an action (contract
    // 1.5). Without it a destructive action had to be the item's `onClick`,
    // which turns reading a list into a minefield.
    action?: {
      label: UiText;
      onClick: UiAction;
      // Renders the shared confirm dialog before posting.
      confirm?: UiText;
      variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    };
  }>;
  empty?: UiText;
  // Items come from the plugin one page at a time (contract 1.8).
  paging?: UiPaging;
}

export type UiFormFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'switch'
  | 'select'
  | 'date'
  // Time of day, `HH:MM`, for a schedule a person sets rather than computes
  // (contract 1.7). "Every N hours" from an unknown starting point is not a
  // schedule anyone can plan around.
  | 'time'
  // Masked input for credentials a plugin needs (an access code, an API
  // token). Added in contract 1.1 — a plugin using it on a 1.0 core has the
  // node skipped rather than rendered in clear, which is why "skip unknown"
  // is the forward-compatibility rule.
  //
  // A submitted value travels browser -> core -> plugin over the signed
  // channel, so the CORE sees it in transit. That is inherent to server-driven
  // UI; a plugin should never render a stored secret back (leave the field
  // empty and overwrite only on a non-empty submit).
  | 'password';

export interface UiFormField {
  name: string;
  // Changing this field re-renders the screen, with everything typed so far
  // handed back to the plugin (contract 1.2). Without it a settings screen
  // cannot show the fields that belong to the current choice — the user has
  // to save a half-filled form to find out what it actually wanted.
  //
  // It stays a RENDER, not an action: nothing is being mutated, and a plugin
  // should not have to invent a fake action in order to redraw itself.
  reloadOnChange?: boolean;
  type: UiFormFieldType;
  label: UiText;
  placeholderKey?: string;
  // One line of explanation, rendered under the control (contract 1.6).
  //
  // A placeholder is not an explanation: it disappears the moment someone
  // types, and it cannot hold a sentence. Without this a plugin had to put its
  // explanations in a paragraph beside the form, where they read as orphan
  // text about nothing in particular — which is exactly how it was reported.
  hintKey?: string;
  required?: boolean;
  // Preset value round-trips as entered; numbers/booleans are serialized by
  // the field type.
  value?: string | number | boolean;
  // Layout hint (contract 1.3): `half` lets two related fields share a row on
  // a wide screen — a URL and its token read as one credential, not two
  // questions. It stays a HINT: narrow screens stack regardless, and a core
  // that does not know the field renders it full width.
  width?: 'full' | 'half';
  options?: Array<{ value: string; label: UiText }>;
}

export interface UiFormNode {
  type: 'form';
  fields: UiFormField[];
  submit: { label: UiText; onSubmit: UiAction };
}

export interface UiSectionNode {
  type: 'section';
  title?: UiText;
  children: UiNode[];
}

export type UiNode =
  | UiTextNode
  | UiBadgeNode
  | UiStatNode
  | UiCalloutNode
  | UiDividerNode
  | UiButtonNode
  | UiDetailNode
  | UiTableNode
  | UiListNode
  | UiFormNode
  | UiSectionNode;

export const UI_NODE_TYPES: readonly string[] = [
  'text',
  'badge',
  'stat',
  'callout',
  'divider',
  'button',
  'detail',
  'table',
  'list',
  'form',
  'section',
];

// A rendered screen: title + node tree. `refs` optionally publishes the ORefs
// the screen is "about" (feeds PageContext, same as internal views).
export interface UiScreen {
  title: UiText;
  children: UiNode[];
  refs?: string[];
}

// ── Commands ────────────────────────────────────────────────────────────────
// An action response is either a fresh screen or a command the core executes
// with its own surfaces (toast/confirm/navigation — §5.3: never the browser's).

export interface UiToastCommand {
  command: 'toast';
  tone: 'success' | 'error';
  text: UiText;
}

export interface UiNavigateCommand {
  command: 'navigate';
  // Either another screen of the same plugin (+ optional params) or an ORef
  // resolved through the standard refToRoute path.
  screen?: string;
  params?: Record<string, string>;
  ref?: string;
}

// Re-render the current screen (e.g. after a successful mutation).
export interface UiRefreshCommand {
  command: 'refresh';
  toast?: { tone: 'success' | 'error'; text: UiText };
}

export type UiCommand = UiToastCommand | UiNavigateCommand | UiRefreshCommand;

export type UiActionResult = { screen: UiScreen } | { commands: UiCommand[] };

// ── Sanitizing ──────────────────────────────────────────────────────────────
// The render path runs every tree through this walk: structurally invalid or
// unknown-typed nodes are dropped (collected for the plugin-card notice), the
// rest render. Skip-don't-fail is the contract's forward-compatibility rule.

export interface UiTreeSanitizeResult {
  nodes: UiNode[];
  dropped: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isUiText = (v: unknown): v is UiText =>
  isRecord(v) && typeof v['key'] === 'string' && v['key'].length > 0;

// Per-type structural checks — deliberately shallow: they guarantee the
// renderer can destructure safely, not full semantic validity.
const nodeShapeOk = (node: Record<string, unknown>): boolean => {
  switch (node['type']) {
    case 'text':
    case 'badge':
    case 'callout':
      return isUiText(node['text']);
    case 'stat':
      return isUiText(node['label']) && typeof node['value'] === 'string';
    case 'divider':
      return true;
    case 'button':
      return (
        isUiText(node['label']) &&
        isRecord(node['onClick']) &&
        typeof (node['onClick'] as Record<string, unknown>)['action'] ===
          'string'
      );
    case 'detail':
      return Array.isArray(node['rows']);
    case 'table':
      return Array.isArray(node['columns']) && Array.isArray(node['rows']);
    case 'list':
      return Array.isArray(node['items']);
    case 'form':
      return (
        Array.isArray(node['fields']) &&
        isRecord(node['submit']) &&
        isUiText((node['submit'] as Record<string, unknown>)['label'])
      );
    case 'section':
      return Array.isArray(node['children']);
    default:
      return false;
  }
};

export function sanitizeUiNodes(value: unknown): UiTreeSanitizeResult {
  const dropped: string[] = [];
  const walk = (nodes: unknown): UiNode[] => {
    if (!Array.isArray(nodes)) return [];
    const kept: UiNode[] = [];
    for (const raw of nodes) {
      if (!isRecord(raw) || typeof raw['type'] !== 'string') {
        dropped.push('(malformed)');
        continue;
      }
      if (!UI_NODE_TYPES.includes(raw['type']) || !nodeShapeOk(raw)) {
        dropped.push(raw['type']);
        continue;
      }
      if (raw['type'] === 'section') {
        kept.push({
          ...(raw as unknown as UiSectionNode),
          children: walk(raw['children']),
        });
      } else {
        kept.push(raw as unknown as UiNode);
      }
    }
    return kept;
  };
  return { nodes: walk(value), dropped };
}

export function sanitizeUiScreen(
  value: unknown,
): { screen: UiScreen; dropped: string[] } | null {
  if (!isRecord(value) || !isUiText(value['title'])) return null;
  const { nodes, dropped } = sanitizeUiNodes(value['children']);
  const refs = Array.isArray(value['refs'])
    ? value['refs'].filter((r): r is string => typeof r === 'string')
    : undefined;
  return { screen: { title: value['title'], children: nodes, refs }, dropped };
}
