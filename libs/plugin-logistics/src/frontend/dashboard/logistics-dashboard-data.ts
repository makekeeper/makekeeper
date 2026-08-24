import { apiJson } from '@makekeeper/frontend-core';

// The slice of GET /api/logistics/orders the dashboard widgets consume.
export interface DashboardOrderSummary {
  id: string;
  storeName: string;
  status: string;
  orderDate: string;
  estimatedDelivery: string | null;
  supplierName: string | null;
  itemsCount: number;
  totalCost: number;
  currency: string;
}

// Orders that are actually on their way: placed or shipped. CART is a draft
// and DELIVERED is done — neither is an expected delivery.
const INCOMING_STATUSES = ['ORDERED', 'SHIPPED'];

// The logistics widgets mount together on the dashboard; deduplicate their
// concurrent fetches into one request. The slot clears when the request
// settles, so a later remount fetches fresh data.
let inflight: Promise<DashboardOrderSummary[]> | null = null;

export function fetchAllOrders(): Promise<DashboardOrderSummary[]> {
  if (!inflight) {
    inflight = apiJson<DashboardOrderSummary[]>(
      '/api/logistics/orders',
    ).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export async function fetchIncomingOrders(): Promise<DashboardOrderSummary[]> {
  const orders = await fetchAllOrders();
  return orders.filter((o) => INCOMING_STATUSES.includes(o.status));
}
