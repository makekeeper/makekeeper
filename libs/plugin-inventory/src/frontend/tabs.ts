import type { PageTabItem } from '@makekeeper/frontend-core';

// The inventory page's own tabs (#205): the items themselves, and the category
// vocabulary that gives them their properties. One array, imported by both
// screens — two copies would let a third tab appear on one and not the other.
export const INVENTORY_TABS: PageTabItem[] = [
  { path: '/inventory', titleKey: 'inventory.page.title', icon: 'Wrench' },
  {
    path: '/inventory/categories',
    titleKey: 'inventory.categories.tab',
    icon: 'FolderTree',
  },
];
