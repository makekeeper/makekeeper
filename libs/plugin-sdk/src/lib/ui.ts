import type {
  UiAction,
  UiCommand,
  UiFormField,
  UiNode,
  UiScreen,
  UiText,
  UiTableColumn,
  UiTableCell,
  UiPaging,
  UiTone,
} from '@makekeeper/plugin-contract';

// Screen builders (#139). Thin on purpose: their value is that every text slot
// takes an i18n REFERENCE, so the natural way to write a screen is also the
// compliant one — a plugin author (or their agent) cannot accidentally ship a
// hardcoded literal, because these signatures do not accept one.

export const text = (key: string, params?: UiText['params']): UiText => ({
  key,
  ...(params ? { params } : {}),
});

export const screen = (
  titleKey: string,
  children: UiNode[],
  opts?: { refs?: string[]; titleParams?: UiText['params'] },
): UiScreen => ({
  title: text(titleKey, opts?.titleParams),
  children,
  ...(opts?.refs ? { refs: opts.refs } : {}),
});

export const paragraph = (
  key: string,
  opts?: { params?: UiText['params']; variant?: 'body' | 'muted' | 'heading' },
): UiNode => ({
  type: 'text',
  text: text(key, opts?.params),
  ...(opts?.variant ? { variant: opts.variant } : {}),
});

export const heading = (key: string, params?: UiText['params']): UiNode =>
  paragraph(key, { params, variant: 'heading' });

export const badge = (key: string, tone?: UiTone): UiNode => ({
  type: 'badge',
  text: text(key),
  ...(tone ? { tone } : {}),
});

export const stat = (
  labelKey: string,
  value: string,
  opts?: { unitKey?: string; icon?: string },
): UiNode => ({
  type: 'stat',
  label: text(labelKey),
  value,
  ...(opts?.unitKey ? { unit: text(opts.unitKey) } : {}),
  ...(opts?.icon ? { icon: opts.icon } : {}),
});

// `params` is how a callout reports a MEASUREMENT — how many entities were
// found, which host refused the connection — without the plugin assembling a
// sentence, which would be a literal by another name.
export const callout = (
  key: string,
  tone?: UiTone,
  params?: UiText['params'],
): UiNode => ({
  type: 'callout',
  text: text(key, params),
  ...(tone ? { tone } : {}),
});

export const divider = (): UiNode => ({ type: 'divider' });

export const button = (
  labelKey: string,
  onClick: UiAction,
  opts?: {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    confirmKey?: string;
    icon?: string;
  },
): UiNode => ({
  type: 'button',
  label: text(labelKey),
  onClick,
  ...(opts?.variant ? { variant: opts.variant } : {}),
  ...(opts?.confirmKey ? { confirm: text(opts.confirmKey) } : {}),
  ...(opts?.icon ? { icon: opts.icon } : {}),
});

// `value` takes DATA as a plain string, or an i18n reference when the value is
// one of ours (a state name, a unit-bearing number). Handing a bare key here
// used to render the key itself — "stateIdle" where a person expects "Idle".
export const detail = (
  rows: Array<{ labelKey: string; value: string | UiText; ref?: string }>,
): UiNode => ({
  type: 'detail',
  rows: rows.map((r) => ({
    label: text(r.labelKey),
    value: r.value,
    ...(r.ref ? { ref: r.ref } : {}),
  })),
});

export const table = (input: {
  columns: Array<{
    key: string;
    labelKey: string;
    align?: 'left' | 'right';
    // Contract 1.9: the header sorts. The core sorts rows it holds; a
    // plugin-paged table is asked to re-render sorted.
    sortable?: boolean;
  }>;
  rows: Array<{
    cells: Record<string, UiTableCell>;
    onClick?: UiAction;
    action?: {
      label: UiText;
      onClick: UiAction;
      confirm?: UiText;
      variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    };
  }>;
  emptyKey?: string;
  // Contract 1.7: hand over every row and let the CORE search and page it.
  filterable?: boolean;
  pageSize?: number;
  // Contract 1.8/1.9: the PLUGIN pages (and sorts) its own data instead.
  paging?: UiPaging;
}): UiNode => ({
  type: 'table',
  ...(input.filterable ? { filterable: true } : {}),
  ...(input.pageSize ? { pageSize: input.pageSize } : {}),
  ...(input.paging ? { paging: input.paging } : {}),
  columns: input.columns.map<UiTableColumn>((c) => ({
    key: c.key,
    label: text(c.labelKey),
    ...(c.align ? { align: c.align } : {}),
    ...(c.sortable ? { sortable: true } : {}),
  })),
  rows: input.rows,
  ...(input.emptyKey ? { empty: text(input.emptyKey) } : {}),
});

// `title`/`subtitle` take DATA as a plain string or an i18n reference when the
// text is the plugin's own — the same rule as `detail`, and the same trap
// avoided: a bare key handed to a string slot renders as the key.
export const list = (input: {
  items: Array<{
    title: string | UiText;
    subtitle?: string | UiText;
    ref?: string;
    icon?: string;
    badge?: { text: UiText; tone?: UiTone };
    onClick?: UiAction;
    action?: {
      label: UiText;
      onClick: UiAction;
      confirm?: UiText;
      variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    };
  }>;
  emptyKey?: string;
  // Contract 1.8: the plugin returns one page and the core asks for the next.
  paging?: UiPaging;
}): UiNode => ({
  type: 'list',
  items: input.items,
  ...(input.paging ? { paging: input.paging } : {}),
  ...(input.emptyKey ? { empty: text(input.emptyKey) } : {}),
});

export const form = (input: {
  fields: Array<Omit<UiFormField, 'label'> & { labelKey: string }>;
  submitKey: string;
  onSubmit: UiAction;
}): UiNode => ({
  type: 'form',
  fields: input.fields.map<UiFormField>(({ labelKey, ...field }) => ({
    ...field,
    label: text(labelKey),
  })),
  submit: { label: text(input.submitKey), onSubmit: input.onSubmit },
});

export const section = (children: UiNode[], titleKey?: string): UiNode => ({
  type: 'section',
  ...(titleKey ? { title: text(titleKey) } : {}),
  children,
});

// ── Action results ──────────────────────────────────────────────────────────

export const toast = (
  tone: 'success' | 'error',
  key: string,
  params?: UiText['params'],
): UiCommand => ({ command: 'toast', tone, text: text(key, params) });

export const refresh = (opts?: {
  tone: 'success' | 'error';
  key: string;
  params?: UiText['params'];
}): UiCommand => ({
  command: 'refresh',
  ...(opts
    ? { toast: { tone: opts.tone, text: text(opts.key, opts.params) } }
    : {}),
});

export const navigate = (target: {
  screen?: string;
  params?: Record<string, string>;
  ref?: string;
}): UiCommand => ({ command: 'navigate', ...target });

export const commands = (...list: UiCommand[]) => ({ commands: list });
