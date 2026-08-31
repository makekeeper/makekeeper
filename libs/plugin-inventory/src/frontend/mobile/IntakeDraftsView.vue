<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Badge,
  Button,
  EmptyState,
  ImageLightbox,
  Select,
  Spinner,
  apiErrorMessage,
  apiJson,
  fieldNumber,
  fieldValue,
  previewUrl,
  type LightboxImage,
  useConfirm,
  useDateFormat,
  usePluginsStore,
  useToastStore,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import { Check, Trash2, Undo2, Sparkles, X } from '@lucide/vue';
import {
  DESCRIPTION_MAX,
  type IntakeCommitResult,
  type IntakeDraft,
} from '../../mobile-intake';
import { useDraftCategories } from './draft-categories';
import { useRecognitionAvailability } from './recognition-availability';
import PropertyFields from './PropertyFields.vue';

// The confirm half of the conveyor (#201). One component for both surfaces: the
// phone that shot the batch and the desktop where a long list is easier to work
// through — the drafts live on the server precisely so that choice exists.
//
// Nothing here writes without a human: each draft is reviewed field by field and
// committed by hand, which is why no confirmation gate is involved. What the
// model proposed is only ever a filled-in form.

interface StorageOption {
  id: string;
  name: string;
}

const { t } = useI18n();
const dates = useDateFormat();
const route = useRoute();
const toast = useToastStore();
const confirm = useConfirm();
const plugins = usePluginsStore();

// Which of the two surfaces this is. `meta` on a matched route is the merge of
// every record in the chain, so the mobile root's flag reaches its children —
// which is exactly the question here, since the phone shell owns the title bar
// and the desktop route has none.
const inMobileShell = computed<boolean>(() => route.meta.mobile === true);

const drafts = ref<IntakeDraft[]>([]);
const loading = ref(true);
const busyId = ref<string | null>(null);
const recognizingId = ref<string | null>(null);
// Shared with the camera screen and asked once per session — the same answer
// arriving late is what made the recognize control pop in after the list.
const { available: recognitionAvailable, ensure: ensureRecognition } =
  useRecognitionAvailability();
const storages = ref<StorageOption[]>([]);
const storagesEnabled = computed(() => plugins.isEnabled('storages'));
const storageOptions = computed(() => [
  { value: '', label: t('inventory.mobile.noStorage'), empty: true },
  ...storages.value.map((s) => ({ value: s.id, label: s.name })),
]);

// The last committed item, kept only in this session: the conveyor's undo is
// for the tap you just regretted, not an audit trail.
const lastCommit = ref<IntakeCommitResult | null>(null);

// The category the model chose from the tree (#206) — the picker exists so a
// person can correct that choice, and choosing changes which properties the
// draft carries.
const categories = useDraftCategories();

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    drafts.value = await apiJson<IntakeDraft[]>(
      '/api/components/intake/drafts',
    );
    await Promise.all(
      drafts.value.map((draft) => categories.ensure(draft.categoryId)),
    );
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.draftsLoadError')));
  } finally {
    loading.value = false;
  }
};

// Editing one property value. Sent as the whole map, because that is what the
// draft stores — a partial map would read as "these are all the values".
const patchProperty = async (
  draft: IntakeDraft,
  propertyId: string,
  value: string,
): Promise<void> => {
  const next = { ...draft.propertyValues };
  if (value.trim() === '') delete next[propertyId];
  else next[propertyId] = value;
  await patch(draft, { propertyValues: next });
};

// Changing the category throws the old category's values away — they are keyed
// by property ids the new category does not have. The server does the same on
// its side; doing it here too keeps the screen from showing values for fields
// it no longer displays.
const patchCategory = async (
  draft: IntakeDraft,
  categoryId: string,
): Promise<void> => {
  await categories.ensure(categoryId || null);
  await patch(draft, {
    categoryId: categoryId || null,
    propertyValues: {},
  });
};

// Refreshed when the tab comes back into view, not on a timer: a batch changes
// because THIS person did something — drained a queue, recognized a shot — and
// polling a screen that is usually idle would be noise.
const refreshOnReturn = (): void => {
  if (document.visibilityState === 'visible') void load();
};

onMounted(async () => {
  await load();
  window.addEventListener('focus', refreshOnReturn);
  document.addEventListener('visibilitychange', refreshOnReturn);
  await ensureRecognition();
  if (storagesEnabled.value) {
    try {
      storages.value = await apiJson<StorageOption[]>('/api/storages');
    } catch {
      // The placement picker just stays empty.
    }
  }
  // A failure here leaves the picker offering only "no category"; the drafts
  // are still committable.
  await categories.load();
});

// Push one field back to the server as it is edited. The draft is the record of
// work in progress, so an edit that only lived in this tab would defeat it.
onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshOnReturn);
  document.removeEventListener('visibilitychange', refreshOnReturn);
});

// Asked for, one shot at a time. Most parts on a shelf are named faster by the
// person holding them than by a model, and every automatic call would have spent
// their money to find that out.
const recognize = async (draft: IntakeDraft): Promise<void> => {
  if (recognizingId.value) return;
  recognizingId.value = draft.id;
  try {
    const updated = await apiJson<IntakeDraft>(
      `/api/components/intake/drafts/${draft.id}/recognize`,
      { method: 'POST' },
    );
    Object.assign(draft, updated);
    // The answer may have landed the draft in a category this screen has not
    // asked about yet; its fields appear as soon as the set arrives.
    await categories.ensure(updated.categoryId);
    if (updated.status === 'failed') {
      toast.error(t('inventory.mobile.recognizeError'));
    }
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.recognizeError')));
  } finally {
    recognizingId.value = null;
  }
};

const patch = async (
  draft: IntakeDraft,
  changes: Partial<IntakeDraft>,
): Promise<void> => {
  // Applied at once so the field does not snap back while the request is in
  // flight, then replaced by what the server actually stored.
  Object.assign(draft, changes);
  try {
    const saved = await apiJson<IntakeDraft>(
      `/api/components/intake/drafts/${draft.id}`,
      { method: 'PATCH', body: changes },
    );
    // The server is the authority on what a draft holds: a value that does not
    // fit its property's type — or an option that is not one of the declared
    // spellings — is dropped there, and the field has to go blank here rather
    // than show a value the commit will not carry.
    Object.assign(draft, saved);
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.saveError')));
  }
};

const commit = async (draft: IntakeDraft): Promise<void> => {
  if (busyId.value) return;
  busyId.value = draft.id;
  try {
    const result = await apiJson<IntakeCommitResult>(
      `/api/components/intake/drafts/${draft.id}/commit`,
      { method: 'POST', body: {} },
    );
    lastCommit.value = result;
    drafts.value = drafts.value.filter((d) => d.id !== draft.id);
    toast.success(t('inventory.mobile.committed'));
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.saveError')));
  } finally {
    busyId.value = null;
  }
};

// Undo differs by what the commit did: a fresh card is deleted outright, while a
// receipt into an existing part is subtracted back out — deleting that one would
// destroy stock that was never ours to remove.
const undoLast = async (): Promise<void> => {
  const last = lastCommit.value;
  if (!last) return;
  try {
    if (last.created) {
      await apiJson(`/api/components/${last.componentId}`, {
        method: 'DELETE',
      });
    } else {
      await apiJson(`/api/components/${last.componentId}/adjust`, {
        method: 'PATCH',
        body: { amount: -last.quantity, type: 'ADJUSTMENT' },
      });
    }
    lastCommit.value = null;
    toast.success(t('inventory.mobile.undone'));
    await load();
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.undoError')));
  }
};

const discard = async (draft: IntakeDraft): Promise<void> => {
  const confirmed = await confirm({
    message: t('inventory.mobile.discardConfirm'),
    tone: 'danger',
  });
  if (!confirmed) return;
  try {
    await apiJson('/api/components/intake/drafts/discard', {
      method: 'POST',
      body: { ids: [draft.id] },
    });
    drafts.value = drafts.value.filter((d) => d.id !== draft.id);
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.saveError')));
  }
};

const discardAll = async (): Promise<void> => {
  const confirmed = await confirm({
    message: t('inventory.mobile.discardAllConfirm', {
      count: drafts.value.length,
    }),
    tone: 'danger',
  });
  if (!confirmed) return;
  try {
    await apiJson('/api/components/intake/drafts/discard', {
      method: 'POST',
      body: { ids: drafts.value.map((d) => d.id) },
    });
    drafts.value = [];
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.saveError')));
  }
};

// Enlarging a frame belongs HERE rather than on the camera screen: this is where
// the decision is made — is that blurred angle worth sending to the model, is
// this even the right part — and 80 pixels is not enough to make it. The strip
// on the camera is a tally of what has been shot; this one is evidence.
//
// One viewer for the whole list, keyed by the frame's url: two drafts can be
// open on one screen and only one picture is ever enlarged.
const lightboxUrl = ref<string | null>(null);
const lightboxImages = computed<LightboxImage[]>(() =>
  drafts.value.flatMap((draft) =>
    draft.imageUrls.map((url) => ({ id: url, url, filename: null })),
  ),
);

// Drop one frame off a draft. No confirmation: a frame is not a record, and the
// batch is where a bad one is supposed to be weeded out.
//
// The draft SURVIVES its last frame — somebody may have typed a name into it,
// and losing that to a dropped photograph is the worse trade. Discarding the
// draft itself is the button next to Commit.
const dropFrame = async (draft: IntakeDraft, url: string): Promise<void> => {
  try {
    const updated = await apiJson<IntakeDraft>(
      `/api/components/intake/drafts/${draft.id}/photos/discard`,
      { method: 'POST', body: { imageUrls: [url] } },
    );
    Object.assign(draft, updated);
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.saveError')));
  }
};

// Age is the honest thing to show for data nothing deletes on its own (#120).
const age = (draft: IntakeDraft): string => dates.dateTime(draft.createdAt);
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- One component, two surfaces (#201), and only one of them already has a
         title bar: inside the phone shell the back-arrow header carries the
         title, so repeating it here cost a row on the smaller screen. On the
         desktop route there is no such bar and the heading is the only one. -->
    <header class="flex items-center justify-between gap-3">
      <div v-if="!inMobileShell">
        <h1 class="text-lg font-bold">{{ $t('inventory.mobile.drafts') }}</h1>
        <p class="text-sm text-slate-500 dark:text-slate-400">
          {{ $t('inventory.mobile.draftsSubtitle') }}
        </p>
      </div>
      <!-- Title AND subtitle come from the shell's header on the phone; the
           desktop route has no such bar, so there they stay. The row itself
           remains either way — it is what holds Undo. -->
      <div v-else></div>
      <Button
        v-if="lastCommit"
        variant="secondary"
        size="sm"
        :icon-left="Undo2"
        @click="undoLast"
      >
        {{ $t('inventory.mobile.undo') }}
      </Button>
    </header>

    <Spinner v-if="loading" />

    <EmptyState
      v-else-if="drafts.length === 0"
      :title="$t('inventory.mobile.draftsEmpty')"
    />

    <template v-else>
      <ul class="space-y-3">
        <li
          v-for="draft in drafts"
          :key="draft.id"
          class="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-800 p-3 space-y-3"
        >
          <!-- Status and when it was shot lead the card, above the frames: it is
               the caption for the pictures below it, and a caption belongs on
               top of what it names — under the strip it read as a footnote to
               whatever field came next. -->
          <div class="min-w-0 space-y-1">
            <Badge v-if="draft.status === 'recognizing'" tone="brand">
              {{ $t('inventory.mobile.recognizing') }}
            </Badge>
            <Badge v-else-if="draft.status === 'failed'" tone="warning">
              {{ $t('inventory.mobile.recognizeFailed') }}
            </Badge>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              {{ $t('inventory.mobile.shotAt', { when: age(draft) }) }}
            </p>
          </div>

          <!-- Every frame of the draft (#216), not just the first: the count
               here and the count on the recognize button are the same number,
               so "this will send three images" is visible before the press.

               A row of its OWN, scrolling inside the card. Five thumbnails do
               not fit beside a column of text on a phone, and the strip must be
               free to shrink: `shrink-0` on this container held it at its full
               content width, which pushed the whole page sideways — and killed
               the very `overflow-x-auto` meant to prevent it, since nothing was
               left to constrain. The thumbnails carry `shrink-0` instead, so
               they keep their size while the strip scrolls. -->
          <ul
            v-if="draft.imageUrls.length > 0"
            class="flex gap-1.5 overflow-x-auto"
          >
            <li
              v-for="(frame, index) in draft.imageUrls"
              :key="frame"
              class="relative shrink-0"
            >
              <button
                type="button"
                :aria-label="$t('common.photos.open')"
                class="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
                @click="lightboxUrl = frame"
              >
                <img
                  :src="previewUrl(frame, 'xs')"
                  :alt="
                    $t('inventory.mobile.frameAlt', {
                      index: index + 1,
                      total: draft.imageUrls.length,
                    })
                  "
                  class="w-20 h-20 rounded-xl object-cover"
                />
              </button>
              <!-- `overlayScrim` is the primitive for a control sitting ON a
                   picture (§5.4) — a bare white glyph vanishes against a light
                   photograph. -->
              <Button
                variant="overlayScrim"
                size="icon-sm"
                pill
                class="absolute -right-2 -top-2"
                :icon-left="X"
                :aria-label="$t('inventory.mobile.dropFrame')"
                @click="dropFrame(draft, frame)"
              />
            </li>
          </ul>

          <div class="space-y-1">
            <label
              :for="`draft-name-${draft.id}`"
              class="block text-sm font-medium"
            >
              {{ $t('inventory.mobile.name') }}
            </label>
            <input
              :id="`draft-name-${draft.id}`"
              :value="draft.name ?? ''"
              type="text"
              maxlength="200"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
              @change="patch(draft, { name: fieldValue($event) })"
            />
          </div>

          <!-- `min-w-0` on both cells, not decoration: a grid item's default
               `min-width: auto` is its content's minimum, and an <input> brings
               its own (~20 characters). Two of those refuse to fit a narrow
               phone and widen the card instead of narrowing the fields — the
               same way the frame strip did. -->
          <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0 space-y-1">
              <label
                :for="`draft-qty-${draft.id}`"
                class="block text-sm font-medium"
              >
                {{ $t('inventory.mobile.quantity') }}
              </label>
              <input
                :id="`draft-qty-${draft.id}`"
                :value="draft.quantity"
                type="number"
                min="1"
                inputmode="numeric"
                class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
                @change="patch(draft, { quantity: fieldNumber($event) })"
              />
            </div>
            <div class="min-w-0 space-y-1">
              <label
                :for="`draft-sku-${draft.id}`"
                class="block text-sm font-medium"
              >
                {{ $t('inventory.mobile.sku') }}
              </label>
              <input
                :id="`draft-sku-${draft.id}`"
                :value="draft.sku ?? ''"
                type="text"
                maxlength="120"
                class="w-full glass-input rounded-xl px-4 py-2.5 text-base font-mono"
                @change="patch(draft, { sku: fieldValue($event) })"
              />
            </div>
          </div>

          <div class="space-y-1">
            <label
              :for="`draft-category-${draft.id}`"
              class="block text-sm font-medium"
            >
              {{ $t('inventory.mobile.category') }}
            </label>
            <Select
              :id="`draft-category-${draft.id}`"
              :model-value="draft.categoryId ?? ''"
              :options="categories.options.value"
              @update:model-value="patchCategory(draft, String($event))"
            />
          </div>

          <!-- What the model saw, in its own words. Editable, because it is
               what the second call read to guess the values below, and because
               it becomes the item's description on commit. -->
          <div class="space-y-1">
            <label
              :for="`draft-desc-${draft.id}`"
              class="block text-sm font-medium"
            >
              {{ $t('inventory.mobile.description') }}
            </label>
            <textarea
              :id="`draft-desc-${draft.id}`"
              :value="draft.description ?? ''"
              rows="3"
              :maxlength="DESCRIPTION_MAX"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
              @change="patch(draft, { description: fieldValue($event) })"
            ></textarea>
          </div>

          <PropertyFields
            :properties="categories.of(draft.categoryId)"
            :values="draft.propertyValues"
            :id-prefix="`draft-${draft.id}`"
            @change="
              (propertyId, value) => patchProperty(draft, propertyId, value)
            "
          />

          <div v-if="storagesEnabled" class="space-y-1">
            <label
              :for="`draft-storage-${draft.id}`"
              class="block text-sm font-medium"
            >
              {{ $t('inventory.mobile.storage') }}
            </label>
            <Select
              :id="`draft-storage-${draft.id}`"
              :model-value="draft.storageId ?? ''"
              :options="storageOptions"
              @update:model-value="patch(draft, { storageId: $event })"
            />
          </div>

          <div class="flex gap-2">
            <!-- The frame count is ON the button: every one of them goes to the
                 model, and that is what the press costs. The BARE number, next
                 to the icon — the word spelled out pushed this row past a phone
                 screen, and beside a wand the count needs no sentence. The
                 sentence stays in the label, which is what a screen reader
                 reads: on its own, "3" says nothing. -->
            <Button
              v-if="recognitionAvailable && draft.imageUrls.length > 0"
              variant="ai"
              :icon-left="Sparkles"
              :loading="recognizingId === draft.id"
              :aria-label="
                $t('inventory.mobile.recognizeFramesLabel', {
                  count: draft.imageUrls.length,
                })
              "
              :title="
                $t('inventory.mobile.recognizeFramesLabel', {
                  count: draft.imageUrls.length,
                })
              "
              @click="recognize(draft)"
            >
              {{ draft.imageUrls.length }}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              :icon-left="Trash2"
              :aria-label="$t('inventory.mobile.discard')"
              @click="discard(draft)"
            />
            <Button
              variant="primary"
              block
              :icon-left="Check"
              :loading="busyId === draft.id"
              :disabled="(draft.name ?? '').trim() === ''"
              @click="commit(draft)"
            >
              {{ $t('inventory.mobile.commit') }}
            </Button>
          </div>
        </li>
      </ul>

      <Button variant="secondary" block :icon-left="Trash2" @click="discardAll">
        {{ $t('inventory.mobile.discardAll', { count: drafts.length }) }}
      </Button>
    </template>

    <!-- Tap a frame to enlarge it: deciding whether an angle is worth keeping —
         or whether this is the part you thought it was — needs more than 80px. -->
    <ImageLightbox v-model:open-id="lightboxUrl" :images="lightboxImages" />
  </div>
</template>
