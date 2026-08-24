import {
  registerPlugin,
  useUxMode,
  type PluginContribution,
} from '@makekeeper/frontend-core';
import { tagsManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import TagsView from './TagsView.vue';
import TagChipsSlot from './TagChipsSlot.vue';
import TagFilterSlot from './TagFilterSlot.vue';
import HeaderTagSearch from './HeaderTagSearch.vue';
import TagSourceField from './TagSourceField.vue';
import TagSourceBadge from './TagSourceBadge.vue';

// Every woven-in tag surface follows ONE feature key (#269): hiding "tags
// everywhere" hides the chips, the filters and the header search together —
// half-hidden tag UI (a filter with no chips to explain it) reads as a bug.
// Evaluated lazily inside the host's computed, after pinia is live.
const everywhere = (): boolean =>
  useUxMode().isFeatureVisible('tags.everywhere');

registerPlugin({
  id: tagsManifest.id,
  nameKey: tagsManifest.nameKey,
  navigation: tagsManifest.navigation,
  uxFeatures: tagsManifest.uxFeatures,
  messages: { en, ru },
  routes: [{ path: '/tags', name: 'tags', component: TagsView }],
  // A tag is a referenceable object: mk://tags/tag/<id> links to its page.
  refToRoute: (ref) =>
    ref.entityType === 'tag'
      ? { path: '/tags', query: { tag: ref.entityId } }
      : null,
  // Tag UI injected into other plugins' views (#60). Chips + editor go into
  // detail/edit metas and (compact) into list rows/cards; the filter goes into
  // list filter bars; the search box into the app header. Each renders only
  // while tags is enabled — hosts pass the object's ORef and degrade cleanly.
  contributions: (
    [
      { slot: 'app.header.search', component: HeaderTagSearch },
      { slot: 'projects.detail.meta', component: TagChipsSlot },
      { slot: 'projects.card.badges', component: TagChipsSlot },
      { slot: 'projects.list.filters', component: TagFilterSlot },
      { slot: 'inventory.row.badges', component: TagChipsSlot },
      { slot: 'inventory.list.filters', component: TagFilterSlot },
      { slot: 'inventory.form.meta', component: TagChipsSlot },
      { slot: 'storages.list.filters', component: TagFilterSlot },
      { slot: 'storages.detail.meta', component: TagChipsSlot },
      { slot: 'storages.cell.meta', component: TagChipsSlot },
      { slot: 'logistics.order-form.meta', component: TagChipsSlot },
      // "This field's value becomes a tag" (#205). The host owns the field and
      // knows nothing about tags; these two are the entire feature on its side —
      // the switch inside the host's own property form (saved with it, discarded
      // on cancel) and a read-only marker on the property row.
      { slot: 'inventory.category-property.form', component: TagSourceField },
      { slot: 'inventory.category-property.badges', component: TagSourceBadge },
    ] satisfies PluginContribution[]
  ).map((c) => ({
    ...c,
    visible: everywhere,
  })),
});
