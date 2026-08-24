// Shapes the category/property surface shares between its backend and its
// frontend (#205). Same reasoning as `mobile-intake.ts`: they live at the plugin
// root rather than in plugin-contract, because nothing outside inventory speaks
// them — this is inventory talking to itself.

// What a property holds. `select` carries a closed list of allowed values, which
// is what makes it safe to project into the global tag vocabulary.
export const CATEGORY_PROPERTY_TYPES = ['text', 'number', 'select'] as const;
export type CategoryPropertyType = (typeof CATEGORY_PROPERTY_TYPES)[number];

export function isCategoryPropertyType(
  value: unknown,
): value is CategoryPropertyType {
  return (
    typeof value === 'string' &&
    (CATEGORY_PROPERTY_TYPES as readonly string[]).includes(value)
  );
}

// ORef entity type of a single category property. A property is referenceable
// so that OTHER plugins can name one — the tags plugin marks a property as a
// tag source and stores nothing but this ref, which is what keeps inventory
// free of a column about tags (#205).
export const CATEGORY_PROPERTY_ENTITY = 'category-property';

export const CATEGORY_NAME_MAX = 64;
export const PROPERTY_NAME_MAX = 64;
export const PROPERTY_UNIT_MAX = 16;
export const PROPERTY_OPTION_MAX = 64;
export const PROPERTY_VALUE_MAX = 512;
// A property id as it travels in a `{ propertyId: value }` map. Ids are uuids;
// the cap is what keeps an arbitrary key out of the map, not a size estimate.
export const PROPERTY_ID_MAX = 64;
// More values than any category has properties — a payload above this is not a
// card being filled in, it is something else entirely.
export const MAX_PROPERTY_VALUES = 200;
// A depth cap, not a design statement: it stops a pathological tree from making
// every effective-property read walk hundreds of rows.
export const CATEGORY_MAX_DEPTH = 16;

// How a name is compared, everywhere it is compared: category names against
// each other, property names along an inheritance chain, and a guessed value
// against the spellings a `select` allows. One rule, because two spellings of
// "case-insensitive" is how a value the picker offers gets rejected on save.
export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export interface CategoryPropertyDto {
  id: string;
  categoryId: string;
  name: string;
  type: CategoryPropertyType;
  unit: string | null;
  required: boolean;
  options: string[];
  order: number;
}

export interface ItemCategoryDto {
  id: string;
  name: string;
  parentId: string | null;
  inheritProperties: boolean;
  order: number;
  properties: CategoryPropertyDto[];
}

// A property as it applies to an item: the definition plus where it came from,
// so the form can say "inherited from Electronics" instead of leaving the person
// wondering why a field they cannot find in this category is on the card.
export interface EffectiveProperty extends CategoryPropertyDto {
  inherited: boolean;
  ownerCategoryName: string;
}

// One item's value. `value` is null when nothing has been filled in — a
// `required` property with a null value marks the card incomplete and nothing
// more (§ soft-required).
export interface ComponentPropertyValueDto {
  propertyId: string;
  name: string;
  type: CategoryPropertyType;
  unit: string | null;
  value: string | number | null;
}

// What a write sends: property id -> value. `null` clears the value.
export type PropertyValueInput = Record<string, string | number | null>;

// Does this value fit the property it claims to fill? `undefined` = no, reject
// it; `null` = clear the value; anything else is the value to store.
//
// It lives here, next to the shapes, rather than inside the service, because two
// callers now apply the same rule at different moments: the write path coerces
// what a form or a tool sent, and mobile intake (#206) coerces what a model
// guessed BEFORE the item exists, so the phone shows only values that would
// actually survive being saved. One rule, or the two drift and the draft
// promises a value the save then drops.
export function coercePropertyValue(
  property: Pick<CategoryPropertyDto, 'type' | 'options'>,
  raw: string | number | null,
): string | number | null | undefined {
  if (raw === null) return null;
  if (property.type === 'number') {
    const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const text = String(raw).trim();
  if (text === '') return null;
  // Longer than a property value is meant to be — a paragraph pasted into a
  // "Package" field, or a model that answered with an essay. Rejected rather
  // than truncated: half a sentence stored as fact is worse than a blank.
  if (text.length > PROPERTY_VALUE_MAX) return undefined;
  if (property.type === 'select' && property.options.length) {
    const match = property.options.find(
      (option) => normalizeName(option) === normalizeName(text),
    );
    return match ?? undefined;
  }
  return text;
}
