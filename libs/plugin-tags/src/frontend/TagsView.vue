<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  Tags,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  ChevronRight,
} from '@lucide/vue';
import {
  Button,
  EmptyState,
  PageHeader,
  Spinner,
  apiErrorMessage,
  apiJson,
  resolveObjectRefRoute,
  setPageContextRefs,
  useConfirm,
  useToastStore,
} from '@makekeeper/frontend-core';
import { formatObjectRef } from '@makekeeper/plugin-contract';
import TagChip from './TagChip.vue';
import TagFormModal from './TagFormModal.vue';
import { useTagChipsStore } from './tags-data';
import type { TagDto, TaggedObjectDto } from '../tags-types';

// The /tags page (#60). Route-driven: with no `?tag`, a grid of the whole
// vocabulary (create/edit/delete); with `?tag=<id>`, the objects that tag is
// attached to, each linked via the shared ORef→route resolver.
const route = useRoute();
const router = useRouter();
const { t: $t } = useI18n();
const toast = useToastStore();
const confirm = useConfirm();
const tagChips = useTagChipsStore();

const tags = ref<TagDto[]>([]);
const loadingTags = ref(false);
const objects = ref<TaggedObjectDto[]>([]);
const loadingObjects = ref(false);
const formOpen = ref(false);
const editing = ref<TagDto | null>(null);

const selectedTagId = computed<string | null>(() => {
  const q = route.query.tag;
  return typeof q === 'string' && q ? q : null;
});
const selectedTag = computed(() =>
  tags.value.find((t) => t.id === selectedTagId.value),
);

async function loadTags(): Promise<void> {
  loadingTags.value = true;
  try {
    tags.value = await apiJson<TagDto[]>('/api/tags');
  } catch (err) {
    toast.error(apiErrorMessage(err, $t('tags.page.loadError')));
  } finally {
    loadingTags.value = false;
  }
}

async function loadObjects(tagId: string): Promise<void> {
  loadingObjects.value = true;
  try {
    objects.value = await apiJson<TaggedObjectDto[]>(
      `/api/tags/${tagId}/objects`,
    );
  } catch (err) {
    objects.value = [];
    toast.error(apiErrorMessage(err, $t('tags.page.loadError')));
  } finally {
    loadingObjects.value = false;
  }
}

watch(
  selectedTagId,
  (id) => {
    if (id) {
      void loadObjects(id);
      const ref = formatObjectRef({
        pluginId: 'tags',
        entityType: 'tag',
        entityId: id,
      });
      setPageContextRefs(ref ? [ref] : null);
    } else {
      objects.value = [];
      setPageContextRefs(null);
    }
  },
  { immediate: true },
);

onUnmounted(() => setPageContextRefs(null));

function openCreate(): void {
  editing.value = null;
  formOpen.value = true;
}

function openEdit(tag: TagDto): void {
  editing.value = tag;
  formOpen.value = true;
}

function onSaved(): void {
  void loadTags();
}

async function removeTag(tag: TagDto): Promise<void> {
  const ok = await confirm({
    message: $t('tags.confirmDelete', {
      name: tag.name,
      count: tag.usageCount,
    }),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await apiJson(`/api/tags/${tag.id}`, { method: 'DELETE' });
    toast.success($t('tags.toasts.deleted'));
    // Remove the tag's chips from host sections without a reload.
    tagChips.invalidateAll();
    if (selectedTagId.value === tag.id) router.replace({ path: '/tags' });
    await loadTags();
  } catch (err) {
    toast.error(apiErrorMessage(err, $t('tags.toasts.error')));
  }
}

void loadTags();
</script>

<template>
  <!-- The app shell's <main> already pads pages (p-6 md:p-8); like every other
       view, the root is a bare full-width stack. -->
  <div class="space-y-6">
    <!-- Tag detail: objects behind one tag -->
    <template v-if="selectedTagId">
      <RouterLink
        to="/tags"
        class="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-brand-500 transition-colors"
      >
        <ArrowLeft class="w-4 h-4" />
        {{ $t('tags.page.backToAll') }}
      </RouterLink>
      <PageHeader
        :icon="Tags"
        :title="$t('tags.page.objectsFor', { name: selectedTag?.name ?? '' })"
      />
      <div v-if="loadingObjects" class="flex justify-center py-12">
        <Spinner />
      </div>
      <EmptyState
        v-else-if="objects.length === 0"
        :icon="Tags"
        :title="$t('tags.page.objectsEmpty')"
      />
      <ul v-else class="space-y-2">
        <li v-for="obj in objects" :key="obj.ref">
          <component
            :is="resolveObjectRefRoute(obj.ref) ? RouterLink : 'div'"
            :to="resolveObjectRefRoute(obj.ref) ?? undefined"
            class="glass-card rounded-2xl px-4 py-3 flex items-center justify-between gap-3 transition-colors"
            :class="
              resolveObjectRefRoute(obj.ref)
                ? 'hover:border-brand-400/50 cursor-pointer'
                : ''
            "
          >
            <div class="min-w-0">
              <p
                class="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate"
              >
                {{ obj.displayName ?? $t('tags.page.unavailableObject') }}
              </p>
              <p
                v-if="obj.breadcrumb"
                class="text-xs text-slate-400 dark:text-slate-500 truncate"
              >
                {{ obj.breadcrumb }}
              </p>
            </div>
            <ChevronRight
              v-if="resolveObjectRefRoute(obj.ref)"
              class="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0"
            />
          </component>
        </li>
      </ul>
    </template>

    <!-- Vocabulary: all tags -->
    <template v-else>
      <PageHeader
        :icon="Tags"
        :title="$t('tags.page.title')"
        :subtitle="$t('tags.page.subtitle')"
      >
        <template #actions>
          <Button :icon-left="Plus" @click="openCreate">{{
            $t('tags.page.createButton')
          }}</Button>
        </template>
      </PageHeader>
      <div v-if="loadingTags" class="flex justify-center py-12">
        <Spinner />
      </div>
      <EmptyState
        v-else-if="tags.length === 0"
        :icon="Tags"
        :title="$t('tags.page.empty')"
        :description="$t('tags.page.emptyDesc')"
      >
        <template #action>
          <Button :icon-left="Plus" @click="openCreate">{{
            $t('tags.page.createButton')
          }}</Button>
        </template>
      </EmptyState>
      <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="tag in tags"
          :key="tag.id"
          class="glass-card rounded-2xl px-4 py-3 flex items-center justify-between gap-2"
        >
          <RouterLink
            :to="{ path: '/tags', query: { tag: tag.id } }"
            class="flex items-center gap-2 min-w-0"
          >
            <TagChip :name="tag.name" :color="tag.color" />
            <span class="text-xs text-slate-400 dark:text-slate-500 shrink-0">{{
              $t('tags.page.usageCount', { count: tag.usageCount })
            }}</span>
          </RouterLink>
          <div class="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="$t('tags.form.editTitle')"
              :title="$t('tags.form.editTitle')"
              :icon-left="Pencil"
              @click="openEdit(tag)"
            />
            <Button
              variant="dangerGhost"
              size="icon-sm"
              :aria-label="$t('tags.page.deleteTag')"
              :title="$t('tags.page.deleteTag')"
              :icon-left="Trash2"
              @click="removeTag(tag)"
            />
          </div>
        </div>
      </div>
    </template>

    <TagFormModal v-model="formOpen" :tag="editing" @saved="onSaved" />
  </div>
</template>
