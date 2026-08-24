<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Download, Star, Trash2 } from '@lucide/vue';
import type { ProjectFile } from './project-files';

// The three things you can do to a file — pin it as the cover, download it,
// delete it — in the two skins the Files tab needs (#116).
//
// One copy on purpose: written out per rendering, the pair drifts, and the
// second copy is exactly where a fixed aria-label or a corrected click target
// stops being applied.
//
// `overlay` renders three absolutely-positioned corner controls over a tile
// (the component is multi-root, so they land as siblings inside the tile's
// `relative` box); `inline` renders them as a row of quiet icon buttons.

const props = defineProps<{
  file: ProjectFile;
  variant: 'overlay' | 'inline';
}>();

const emit = defineEmits<{
  (e: 'download', file: ProjectFile): void;
  (e: 'remove', id: string): void;
  (e: 'toggle-cover', file: ProjectFile): void;
}>();

const { t } = useI18n();

const overlay = computed<boolean>(() => props.variant === 'overlay');

const coverLabel = computed<string>(() =>
  t(
    props.file.isCover
      ? 'projectDetail.files.unpinCover'
      : 'projectDetail.files.pinCover',
  ),
);
</script>

<template>
  <button
    v-if="file.isImage"
    type="button"
    :aria-label="coverLabel"
    :title="coverLabel"
    class="p-1.5 rounded-lg focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
    :class="[
      overlay
        ? 'absolute top-1.5 left-1.5 transition-all'
        : 'transition-colors',
      overlay && file.isCover ? 'bg-amber-400 text-white' : '',
      overlay && !file.isCover
        ? 'bg-black/50 text-white opacity-0 group-hover:opacity-100 coarse:opacity-100 hover:bg-amber-500 focus-visible:opacity-100'
        : '',
      !overlay && file.isCover ? 'text-amber-500' : '',
      !overlay && !file.isCover ? 'text-slate-400 hover:text-amber-500' : '',
    ]"
    @click="emit('toggle-cover', file)"
  >
    <Star class="w-4 h-4" :class="file.isCover ? 'fill-current' : ''" />
  </button>

  <!-- A real link, so "open in new tab" / "save link as" work, but the click
       routes through apiDownload like everywhere else. draggable=false:
       dragging an anchor would drag its href as a link and evict the
       DownloadURL payload the tile/row puts on the drag. -->
  <a
    :href="file.url"
    :download="file.filename || file.id"
    draggable="false"
    :aria-label="$t('projectDetail.files.download')"
    :title="$t('projectDetail.files.download')"
    class="p-1.5 rounded-lg focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    :class="
      overlay
        ? 'absolute bottom-1.5 right-1.5 bg-black/50 text-white opacity-0 group-hover:opacity-100 coarse:opacity-100 hover:bg-brand-600 focus-visible:opacity-100 transition-all'
        : 'text-slate-400 transition-colors hover:text-brand-600 dark:hover:text-brand-400'
    "
    @click.prevent="emit('download', file)"
  >
    <Download class="w-4 h-4" />
  </a>

  <button
    type="button"
    :aria-label="$t('projectDetail.photos.delete')"
    :title="$t('projectDetail.photos.delete')"
    class="p-1.5 rounded-lg focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
    :class="
      overlay
        ? 'absolute top-1.5 right-1.5 bg-black/50 text-white opacity-0 group-hover:opacity-100 coarse:opacity-100 hover:bg-red-600 focus-visible:opacity-100 transition-all'
        : 'text-slate-400 transition-colors hover:text-red-600'
    "
    @click="emit('remove', file.id)"
  >
    <Trash2 class="w-4 h-4" />
  </button>
</template>
