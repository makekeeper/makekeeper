import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { apiJson, buildTreeOptions } from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import type { EffectiveProperty, ItemCategoryDto } from '../../categories';

// The category vocabulary as the two intake screens need it (#206): the tree to
// pick from, and the property set each category brings with it.
//
// Both screens ask the same three questions — what may I offer, what does this
// category carry, and what happens when the pick changes — so they ask them in
// one place. Written twice, the picker drifted immediately: one screen offered
// the tree flat, the other cleared the values on a change and the other did not.
//
// The inheritance rule — walk up the chain while each step opts in — lives on
// the SERVER, and a phone screen is not the second place it gets implemented.
// So the property set is fetched per category and remembered: a batch is dozens
// of drafts drawn from a handful of categories, so the cache turns N requests
// into one per distinct category, and the vocabulary does not change while
// somebody is confirming a batch.
export interface CategoryOption {
  value: string;
  label: string;
  empty?: boolean;
  depth?: number;
  parentValue?: string | null;
}

export interface DraftCategories {
  // Every category, in tree order, behind a real "nothing chosen" row.
  options: ComputedRef<CategoryOption[]>;
  properties: Ref<Record<string, EffectiveProperty[]>>;
  // Loads the tree. A failure leaves the picker offering only "no category" —
  // the drafts are still nameable, placeable and committable without one.
  load(): Promise<void>;
  ensure(categoryId: string | null): Promise<void>;
  of(categoryId: string | null): EffectiveProperty[];
}

export function useDraftCategories(): DraftCategories {
  const { t } = useI18n();
  const categories = ref<ItemCategoryDto[]>([]);
  const properties = ref<Record<string, EffectiveProperty[]>>({});
  // Requests in flight, so two drafts of the same category asking at once ask
  // the server once.
  const pending = new Map<string, Promise<void>>();

  const options = computed<CategoryOption[]>(() => [
    { value: '', label: t('inventory.form.noCategory'), empty: true },
    ...buildTreeOptions(
      categories.value.map((entry) => ({
        value: entry.id,
        label: entry.name,
        parentValue: entry.parentId,
        order: entry.order,
      })),
    ),
  ]);

  const load = async (): Promise<void> => {
    try {
      categories.value = await apiJson<ItemCategoryDto[]>(
        '/api/item-categories',
      );
    } catch {
      categories.value = [];
    }
  };

  const ensure = async (categoryId: string | null): Promise<void> => {
    if (!categoryId || properties.value[categoryId]) return;
    const inFlight = pending.get(categoryId);
    if (inFlight) return inFlight;
    const request = apiJson<EffectiveProperty[]>(
      `/api/item-categories/${categoryId}/effective-properties`,
    )
      .then((result) => {
        properties.value = { ...properties.value, [categoryId]: result };
      })
      .catch(() => {
        // A category whose properties will not load shows no property fields.
        // The rest of the draft — name, quantity, placement — is unaffected,
        // and that is the part a person cannot work around.
        properties.value = { ...properties.value, [categoryId]: [] };
      })
      .finally(() => {
        pending.delete(categoryId);
      });
    pending.set(categoryId, request);
    return request;
  };

  const of = (categoryId: string | null): EffectiveProperty[] =>
    categoryId ? (properties.value[categoryId] ?? []) : [];

  return { options, properties, load, ensure, of };
}
