// Shared order-status presentation for the logistics frontend (#58): one badge
// palette consumed by the list view and the project-detail Logistics tab, so
// the colours never drift between surfaces. Labels stay per-view (they need the
// component's `t()`); only the colour map is shared.
export const ORDER_STATUS_COLORS: Record<string, string> = {
  CART: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/25',
  ORDERED:
    'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
  SHIPPED:
    'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/25',
  DELIVERED:
    'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
};

// Badge classes for a status, falling back to the CART palette for any
// unrecognised value.
export function orderStatusColor(status: string): string {
  return ORDER_STATUS_COLORS[status] ?? ORDER_STATUS_COLORS.CART;
}
