<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';
import { previewUrl } from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import { FileIcon, Download } from '@lucide/vue';
import { formatFileSize, useLocaleDate } from './shared';
import ProjectFileActions from './ProjectFileActions.vue';
import type { ProjectFile, ProjectFilesView } from './project-files';

// The project's files, drawn either way (#116).
//
// Extracted from ProjectDetailView when the list view arrived: the same five
// interactions — open, drag out, pin as cover, download, delete — would
// otherwise exist twice in a 1900-line file, and the second copy is exactly
// where a fix stops being applied to both.
//
// Presentational on purpose. It owns no data and performs no action: every
// gesture leaves as an event, so upload, drop, deletion and the viewer keep
// living in one place.

defineProps<{
  files: ProjectFile[];
  view: ProjectFilesView;
  // A file ORef deep-link marks its target (#112).
  highlightedFileId: string | null;
}>();

const emit = defineEmits<{
  (e: 'open', file: ProjectFile): void;
  (e: 'download', file: ProjectFile): void;
  (e: 'remove', id: string): void;
  (e: 'toggle-cover', file: ProjectFile): void;
  (e: 'dragstart', payload: { event: DragEvent; file: ProjectFile }): void;
  (e: 'dragend'): void;
  // The parent scrolls a deep-linked card into view, so it needs the element.
  (
    e: 'register-card',
    payload: { id: string; el: Element | ComponentPublicInstance | null },
  ): void;
}>();

const { t } = useI18n();
const localeDate = useLocaleDate();

// The size and the day a file landed are this component's own columns, so it
// formats them itself rather than borrowing a formatter from whoever renders it.
const formatSize = (bytes: number): string => formatFileSize(bytes);
const formatAdded = (iso: string): string => localeDate(iso) ?? '';

// An unnamed upload still needs something to be called — in the row and in the
// button that opens it.
const displayName = (file: ProjectFile): string =>
  file.filename || t('projectDetail.files.unnamed');

// The alt text is not the display name: "File" describes a row, not a picture.
// An unnamed image is a project photo, which is what the lightbox says too.
const imageAlt = (file: ProjectFile): string =>
  file.filename || t('projectDetail.photos.alt');
const openLabel = (file: ProjectFile): string =>
  t('projectDetail.lightbox.open', { name: displayName(file) });
</script>

<template>
  <!-- Tiles: the picture is the content, everything else is hover chrome -->
  <div
    v-if="view === 'grid'"
    class="grid flex-1 content-start grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
  >
    <div
      v-for="file in files"
      :key="file.id"
      :ref="(el) => emit('register-card', { id: file.id, el })"
      class="group relative aspect-square rounded-xl overflow-hidden glass-card border transition-shadow"
      :class="
        highlightedFileId === file.id
          ? 'border-brand-500 ring-2 ring-brand-500/60'
          : 'border-slate-200 dark:border-white/5'
      "
    >
      <!-- A tile both drags (to the chat composer / the desktop) and opens the
           viewer, so the click is on a real button: the image keeps
           `draggable`, the button gives it a name, a focus ring and keyboard
           reach. -->
      <button
        v-if="file.isImage"
        type="button"
        class="block h-full w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
        :aria-label="openLabel(file)"
        @click="emit('open', file)"
      >
        <img
          :src="previewUrl(file.url, 'sm')"
          :alt="imageAlt(file)"
          loading="lazy"
          draggable="true"
          class="w-full h-full object-cover active:cursor-grabbing"
          @dragstart="emit('dragstart', { event: $event, file })"
          @dragend="emit('dragend')"
        />
      </button>

      <!-- Any other file → a card (drag-out via DownloadURL where the browser
           supports it). The download is spelled out here rather than left to
           the hover chrome: with no picture to look at, it is the point of the
           tile. -->
      <div
        v-else
        :title="file.filename || ''"
        draggable="true"
        class="w-full h-full flex flex-col items-center justify-center gap-2 p-3 text-center cursor-grab active:cursor-grabbing"
        @dragstart="emit('dragstart', { event: $event, file })"
        @dragend="emit('dragend')"
      >
        <FileIcon class="w-9 h-9 text-slate-400 dark:text-slate-500" />
        <span
          class="text-xxs font-medium text-slate-700 dark:text-slate-300 line-clamp-2 break-all"
          >{{ displayName(file) }}</span
        >
        <span class="text-xxs text-slate-400">{{
          formatSize(file.sizeBytes)
        }}</span>
        <a
          :href="file.url"
          :download="file.filename || file.id"
          draggable="false"
          class="flex items-center gap-1 text-xxs font-semibold text-brand-600 dark:text-brand-400 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          @click.prevent="emit('download', file)"
        >
          <Download class="w-3 h-3" />
          {{ $t('projectDetail.files.download') }}
        </a>
      </div>

      <ProjectFileActions
        :file="file"
        variant="overlay"
        @download="emit('download', $event)"
        @remove="emit('remove', $event)"
        @toggle-cover="emit('toggle-cover', $event)"
      />
    </div>
  </div>

  <!-- List: the metadata is the content. For a build log full of models, gcode
       and datasheets, the name, size and date are what identifies a file — in
       the grid they hide behind a hover title. A real table, so the columns are
       announced with their cells rather than read as a decorative header strip;
       below `sm` the metadata columns fold into the name cell. -->
  <div v-else class="flex-1">
    <table class="w-full">
      <caption class="sr-only">
        {{
          $t('projectDetail.photos.title')
        }}
      </caption>
      <thead class="hidden sm:table-header-group">
        <tr
          class="text-xxs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500"
        >
          <th scope="col" class="w-10 px-3 pb-2">
            <span class="sr-only">{{ $t('projectDetail.files.preview') }}</span>
          </th>
          <th scope="col" class="px-3 pb-2 text-left font-bold">
            {{ $t('projectDetail.files.name') }}
          </th>
          <th scope="col" class="w-24 px-3 pb-2 text-left font-bold">
            {{ $t('projectDetail.files.type') }}
          </th>
          <th scope="col" class="w-20 px-3 pb-2 text-right font-bold">
            {{ $t('projectDetail.files.size') }}
          </th>
          <th scope="col" class="w-28 px-3 pb-2 text-right font-bold">
            {{ $t('projectDetail.files.added') }}
          </th>
          <th scope="col" class="w-24 px-3 pb-2">
            <span class="sr-only">{{ $t('projectDetail.files.actions') }}</span>
          </th>
        </tr>
      </thead>

      <!-- Separators are per-row, not `divide-y` on the tbody: `divide-*`
           colours its children through `& > :not([hidden]) ~ :not([hidden])`,
           which outranks the single class of `border-l-brand-500` and repaints
           the deep-link accent in the separator's own grey. The transparent
           left border on every other row keeps the 2px accent from shifting
           the row it marks. -->
      <tbody>
        <tr
          v-for="(file, index) in files"
          :key="file.id"
          :ref="(el) => emit('register-card', { id: file.id, el })"
          class="border-l-2 transition-colors"
          :class="[
            index > 0
              ? 'border-t border-t-slate-100 dark:border-t-white/5'
              : '',
            highlightedFileId === file.id
              ? 'border-l-brand-500 bg-brand-500/5 dark:bg-brand-500/10'
              : 'border-l-transparent hover:bg-slate-50 dark:hover:bg-white/[0.03]',
          ]"
        >
          <!-- The `xs` rendition (192 px) exists for exactly this row and is
               generated eagerly on upload (#113) — no backend work needed. -->
          <td class="w-10 px-3 py-2">
            <button
              v-if="file.isImage"
              type="button"
              class="block h-10 w-10 overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              :aria-label="openLabel(file)"
              @click="emit('open', file)"
            >
              <img
                :src="previewUrl(file.url, 'xs')"
                :alt="imageAlt(file)"
                loading="lazy"
                draggable="true"
                class="h-full w-full object-cover active:cursor-grabbing"
                @dragstart="emit('dragstart', { event: $event, file })"
                @dragend="emit('dragend')"
              />
            </button>
            <span
              v-else
              draggable="true"
              class="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 cursor-grab active:cursor-grabbing dark:bg-white/5"
              @dragstart="emit('dragstart', { event: $event, file })"
              @dragend="emit('dragend')"
            >
              <FileIcon class="h-5 w-5 text-slate-400 dark:text-slate-500" />
            </span>
          </td>

          <td class="max-w-0 px-3 py-2">
            <p
              class="truncate text-sm text-slate-800 dark:text-slate-100"
              :title="file.filename || ''"
            >
              {{ displayName(file) }}
            </p>
            <!-- Below the name on a narrow screen, where the columns collapse -->
            <p class="text-xxs text-slate-400 sm:hidden">
              {{ formatSize(file.sizeBytes) }} ·
              {{ formatAdded(file.createdAt) }}
            </p>
          </td>

          <!-- The ellipsis lives on an inner block, not on the cell: `w-24` is
               only a suggestion in an auto table and `overflow: hidden` does
               not shrink a cell's min-content, so a truncating <td> still
               widens the table for a type like
               `application/vnd.openxmlformats-…-officedocument`. -->
          <td
            class="hidden w-24 px-3 py-2 text-xs text-slate-500 sm:table-cell dark:text-slate-400"
            :title="file.mimeType"
          >
            <span class="block w-24 truncate">{{ file.mimeType }}</span>
          </td>
          <td
            class="hidden w-20 px-3 py-2 text-right text-xs tabular-nums text-slate-500 sm:table-cell dark:text-slate-400"
          >
            {{ formatSize(file.sizeBytes) }}
          </td>
          <td
            class="hidden w-28 px-3 py-2 text-right text-xs text-slate-500 sm:table-cell dark:text-slate-400"
          >
            {{ formatAdded(file.createdAt) }}
          </td>

          <!-- Actions: always visible here. A row has no picture to keep clean,
               and hover-only controls are unreachable on a touch screen. -->
          <td class="w-24 px-3 py-2">
            <div class="flex items-center justify-end gap-1">
              <ProjectFileActions
                :file="file"
                variant="inline"
                @download="emit('download', $event)"
                @remove="emit('remove', $event)"
                @toggle-cover="emit('toggle-cover', $event)"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
