<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import {
  Select,
  RichEditor,
  Button,
  Spinner,
  useConfirm,
  useToastStore,
  useUxMode,
  apiFetch,
} from '@makekeeper/frontend-core';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowLeft, Save, Trash2, FolderGit } from '@lucide/vue';
import {
  BUCKET_CANONICAL_STATUS,
  BUCKET_LABEL_KEY,
  CURRENCY_OPTIONS,
  PROJECT_STATUS_BUCKETS,
  isProjectStatus,
  isProjectStatusBucket,
  statusBucket,
  type ProjectStatus,
} from './shared';
import { useProjectGroupsStore } from './project-groups-store';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const confirm = useConfirm();
const toast = useToastStore();

const isEdit = ref(false);
const projectId = ref('');

const title = ref('');
const description = ref('');
const status = ref<ProjectStatus>('IDEA');
const startDate = ref('');
const dueDate = ref('');
const budgetPlanned = ref<number | null>(null);
const budgetCurrency = ref('USD');
// Empty until the project (or the group list) answers. It is never a "nothing
// chosen" state: a project always has a group, so the picker carries no
// `empty: true` row — the value is simply not known yet.
const groupId = ref('');
const loading = ref(false);

// The same lenses the list/detail views hold (#269): with full statuses hidden
// the form offers the 3 coarse buckets, and with budget planning hidden the
// budget fields disappear. Display lenses only — values loaded from the API are
// preserved on save whether or not their field is on screen.
const { isFeatureVisible } = useUxMode();
const fullStatuses = computed<boolean>(() =>
  isFeatureVisible('projects.fullStatuses'),
);
const budgetVisible = computed<boolean>(() =>
  isFeatureVisible('projects.budgetPlanning'),
);
// Project groups (#289). Hidden in simple mode — and the hidden field KEEPS the
// project's loaded group: `groupId` is only ever sent when it holds a value, so
// editing in simple mode cannot silently re-file a project into General.
const groupsVisible = computed<boolean>(() =>
  isFeatureVisible('projects.groups'),
);
const groupsStore = useProjectGroupsStore();

const statusOptions = computed(() => [
  { value: 'IDEA', label: t('projects.status.idea') },
  { value: 'PLANNING', label: t('projects.status.planning') },
  { value: 'IN_PROGRESS', label: t('projects.status.inProgress') },
  { value: 'TESTING', label: t('projects.status.testing') },
  { value: 'COMPLETED', label: t('projects.status.completed') },
]);

const bucketOptions = computed(() =>
  PROJECT_STATUS_BUCKETS.map((bucket) => ({
    value: bucket,
    label: t(BUCKET_LABEL_KEY[bucket]),
  })),
);

// Bucket-grain model over the same `status` ref. Selecting the bucket the
// status already sits in keeps the raw status (TESTING stays TESTING inside
// "Doing"); a cross-bucket pick writes the bucket's canonical status — the
// exact rule the board applies on a drop (#53).
const statusAsBucket = computed<string>({
  get: () => statusBucket(status.value),
  set: (bucket) => {
    if (!isProjectStatusBucket(bucket)) return;
    if (statusBucket(status.value) === bucket) return;
    status.value = BUCKET_CANONICAL_STATUS[bucket];
  },
});

const fetchProjectDetails = async () => {
  if (!projectId.value) return;
  try {
    loading.value = true;
    const response = await apiFetch(`/api/projects/${projectId.value}`);
    if (response.ok) {
      const data = await response.json();
      title.value = data.title;
      description.value = data.description || '';
      if (isProjectStatus(data.status)) status.value = data.status;
      startDate.value = data.startDate ? data.startDate.slice(0, 10) : '';
      dueDate.value = data.dueDate ? data.dueDate.slice(0, 10) : '';
      budgetPlanned.value = data.budgetPlanned;
      budgetCurrency.value = data.budgetCurrency || 'USD';
      groupId.value = data.groupId ?? '';
    }
  } catch {
    toast.error(t('projects.toasts.loadFailed'));
  } finally {
    loading.value = false;
  }
};

const handleSave = async () => {
  if (!title.value.trim()) return;

  // v-model.number yields '' for an empty field despite the number typing, so
  // treat blank/nullish as "no budget" rather than coercing it to 0.
  const rawBudget = budgetPlanned.value;
  const parsedBudget =
    rawBudget === null ||
    rawBudget === undefined ||
    String(rawBudget).trim() === ''
      ? null
      : Number(rawBudget);

  const payload = {
    title: title.value.trim(),
    description: description.value.trim(),
    status: status.value,
    startDate: startDate.value ? new Date(startDate.value).toISOString() : null,
    dueDate: dueDate.value ? new Date(dueDate.value).toISOString() : null,
    budgetPlanned: parsedBudget,
    budgetCurrency: budgetCurrency.value,
    // Omitted rather than blanked when unknown: on create the server files the
    // project in the scope's General group, and on edit an absent field leaves
    // the project where it is.
    ...(groupId.value ? { groupId: groupId.value } : {}),
  };

  try {
    const url = isEdit.value
      ? `/api/projects/${projectId.value}`
      : '/api/projects';
    const method = isEdit.value ? 'PATCH' : 'POST';

    const response = await apiFetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      if (isEdit.value) {
        router.push(`/projects/${projectId.value}`);
      } else {
        const newProj = await response.json();
        router.push(`/projects/${newProj.id}`);
      }
    } else {
      toast.error(t('projects.toasts.saveFailed'));
    }
  } catch {
    toast.error(t('projects.toasts.saveFailed'));
  }
};

const handleDelete = async () => {
  const ok = await confirm({
    message: t('projectForm.deleteConfirm'),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    const response = await apiFetch(`/api/projects/${projectId.value}`, {
      method: 'DELETE',
    });
    if (response.ok) {
      router.push('/projects');
    }
  } catch {
    toast.error(t('projects.toasts.deleteFailed'));
  }
};

onMounted(async () => {
  if (route.params.id) {
    isEdit.value = true;
    projectId.value = route.params.id as string;
    fetchProjectDetails();
  }
  if (!groupsVisible.value) return;
  await groupsStore.ensureLoaded();
  // A new project starts in General; an existing one keeps what it loaded.
  if (!isEdit.value && !groupId.value) {
    groupId.value = groupsStore.defaultGroup?.id ?? '';
  }
});
</script>

<template>
  <div class="w-full space-y-6 animate-fade-in pb-12">
    <!-- Header Back Navigation -->
    <div class="flex items-center justify-between">
      <button
        @click="
          isEdit
            ? router.push(`/projects/${projectId}`)
            : router.push('/projects')
        "
        class="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        <ArrowLeft class="w-4 h-4" />
        {{ $t('projectForm.back') }}
      </button>

      <Button
        v-if="isEdit"
        variant="danger"
        size="sm"
        :icon-left="Trash2"
        @click="handleDelete"
      >
        {{ $t('projectForm.deleteProject') }}
      </Button>
    </div>

    <!-- Main Card Form -->
    <div
      class="glass-card rounded-2xl p-6 md:p-8 space-y-6 border border-slate-200/60 dark:border-white/10 shadow-xl"
    >
      <div
        class="flex items-center gap-3 pb-4 border-b border-slate-200 dark:border-white/5"
      >
        <div
          class="p-2.5 bg-brand-500/10 text-brand-600 dark:text-brand-400 rounded-xl"
        >
          <FolderGit class="w-6 h-6" />
        </div>
        <div>
          <h2 class="text-lg font-bold text-slate-900 dark:text-white">
            {{
              isEdit
                ? $t('projectForm.editTitle')
                : $t('projectForm.createTitle')
            }}
          </h2>
          <p class="text-xs text-slate-500">
            {{ $t('projectForm.subtitle') }}
          </p>
        </div>
      </div>

      <div v-if="loading" class="flex justify-center items-center py-12">
        <Spinner size="sm" />
      </div>

      <form v-else @submit.prevent="handleSave" class="space-y-6">
        <!-- Project Title -->
        <div class="space-y-1.5">
          <label
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >{{ $t('projectForm.titleLabel') }}</label
          >
          <input
            v-model="title"
            type="text"
            :placeholder="$t('projectForm.titlePlaceholder')"
            class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
            required
          />
        </div>

        <!-- Project Status -->
        <div class="space-y-1.5">
          <label
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >{{ $t('projectForm.statusLabel') }}</label
          >
          <Select
            v-if="fullStatuses"
            v-model="status"
            :options="statusOptions"
          />
          <Select v-else v-model="statusAsBucket" :options="bucketOptions" />
        </div>

        <!-- Project group: required, and never a "nothing chosen" picker —
             every project sits in exactly one group (#289). -->
        <div v-if="groupsVisible" class="space-y-1.5">
          <label
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >{{ $t('projects.groups.field') }}</label
          >
          <Select
            v-model="groupId"
            :options="groupsStore.options"
            :aria-label="$t('projects.groups.field')"
          />
        </div>

        <!-- Start & Due dates -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="space-y-1.5">
            <label
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
              >{{ $t('projectForm.startDateLabel') }}</label
            >
            <input
              v-model="startDate"
              type="date"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
            />
          </div>
          <div class="space-y-1.5">
            <label
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
              >{{ $t('projectForm.dueDateLabel') }}</label
            >
            <input
              v-model="dueDate"
              type="date"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
            />
          </div>
        </div>

        <!-- Project Budget (hidden with budget planning; loaded values are
             still sent on save, so a hidden budget is never wiped) -->
        <div v-if="budgetVisible" class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="space-y-1.5">
            <label
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
              >{{ $t('projectForm.budgetLabel') }}</label
            >
            <input
              v-model.number="budgetPlanned"
              type="number"
              step="0.01"
              :placeholder="$t('projectForm.budgetPlaceholder')"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
            />
          </div>

          <div class="space-y-1.5">
            <label
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
              >{{ $t('projectForm.currencyLabel') }}</label
            >
            <Select v-model="budgetCurrency" :options="CURRENCY_OPTIONS" />
          </div>
        </div>

        <!-- Project Description (WYSIWYG) -->
        <div class="space-y-1.5">
          <label
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >{{ $t('projectForm.descriptionLabel') }}</label
          >
          <RichEditor
            v-model="description"
            :placeholder="$t('projectForm.descriptionPlaceholder')"
          />
        </div>

        <!-- Action Footer -->
        <div
          class="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-white/5"
        >
          <Button
            variant="secondary"
            @click="
              isEdit
                ? router.push(`/projects/${projectId}`)
                : router.push('/projects')
            "
          >
            {{ $t('projectForm.cancel') }}
          </Button>
          <Button type="submit" :icon-left="Save">
            {{ $t('projectForm.save') }}
          </Button>
        </div>
      </form>
    </div>
  </div>
</template>
