<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  Select,
  RichEditor,
  Button,
  Spinner,
  useConfirm,
  useToastStore,
  apiFetch,
  usePageContext,
  useUxMode,
  usePluginsStore,
  useSlotContributions,
  PluginSlot,
} from '@makekeeper/frontend-core';
import { formatObjectRef } from '@makekeeper/plugin-contract';
import { useCategoryOptions } from './shared';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  ArrowLeft,
  Save,
  Trash2,
  CheckSquare,
  Cpu,
  Truck,
  CheckCircle2,
  Circle,
} from '@lucide/vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const confirm = useConfirm();
const toast = useToastStore();
const { isFeatureVisible } = useUxMode();

// Advanced task editing (priority + dependency editors) is a simple-mode
// hidden surface. Existing dependencies still render read-only below — the
// mode never hides or drops data, only the editing entry points.
const showTaskAdvanced = computed<boolean>(() =>
  isFeatureVisible('projects.taskAdvanced'),
);
// The categories lens (#269): the quick-create picker drops together with
// inventory's own forms; the id stays '' so nothing is assigned.
const showCategories = computed<boolean>(() =>
  isFeatureVisible('inventory.categories'),
);

// Creating a catalog component inline is inventory functionality (#58): the
// entry point exists only while the inventory plugin is enabled. Linking
// already-listed BOM components is projects' own data and always works.
const pluginsStore = usePluginsStore();
const inventoryEnabled = computed(() => pluginsStore.isEnabled('inventory'));

const projectId = ref('');
const taskId = ref('');
const isEdit = ref(false);

const title = ref('');
const description = ref('');
const priority = ref<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
const dueDate = ref('');
const isCompleted = ref(false);

const taskComponents = ref<
  { componentId: string; quantity: number; name?: string; isDone?: boolean }[]
>([]);
const taskOrders = ref<
  {
    orderId: string;
    storeName?: string;
    trackingNumber?: string;
    isDone?: boolean;
  }[]
>([]);

// Whether the task already carries advanced-created dependencies — shown as a
// read-only list when the advanced editor is hidden.
const hasDependencies = computed<boolean>(
  () => taskComponents.value.length > 0 || taskOrders.value.length > 0,
);

// Select inputs
const addCompId = ref('');
const addCompQty = ref(1);

// Publish the task (and its project) as canonical ORefs for the AI chat page
// context (#16). taskId is empty while creating a new task — then only the project
// ref is reported.
const pageContextRefs = computed<string[] | null>(() => {
  const refs: string[] = [];
  if (projectId.value) {
    const projectRef = formatObjectRef({
      pluginId: 'projects',
      entityType: 'project',
      entityId: projectId.value,
    });
    if (projectRef) refs.push(projectRef);
  }
  if (taskId.value) {
    const taskRef = formatObjectRef({
      pluginId: 'projects',
      entityType: 'task',
      entityId: taskId.value,
    });
    if (taskRef) refs.push(taskRef);
  }
  return refs.length ? refs : null;
});
usePageContext(pageContextRefs);

// Lists from project context
const projectComponentsList = ref<any[]>([]);

// Inline creation states
const isCreatingComponentInline = ref(false);
const inlineCompName = ref('');
const inlineCompSku = ref('');
// The category id (#205), not free text: the API takes a relation now.
const inlineCompCategoryId = ref('');
const { categoryOptions, loadCategories } = useCategoryOptions();
const inlineCompPrice = ref(0);
const inlineCompQty = ref(0);
const inlineCompNeeded = ref(1);

const loading = ref(false);

// The delivery-dependencies editor is contributed by logistics (#58); the
// task's order links stay host state (saved through the task PATCH), edited by
// the contribution via v-model semantics.
const taskOrderContributions = useSlotContributions('projects.task-form.order');
const hasOrderEditor = computed(() => taskOrderContributions.value.length > 0);
const taskOrderCtx = computed<Record<string, unknown>>(() => ({
  projectId: projectId.value,
  modelValue: taskOrders.value,
  'onUpdate:modelValue': (
    value: {
      orderId: string;
      storeName?: string;
      trackingNumber?: string;
      isDone?: boolean;
    }[],
  ) => {
    taskOrders.value = value;
  },
  projectComponents: projectComponentsList.value.map((pc) => ({
    componentId: pc.componentId,
    name: pc.component?.name || '',
  })),
}));

const fetchProjectContext = async () => {
  try {
    const response = await apiFetch(`/api/projects/${projectId.value}`);
    if (response.ok) {
      const data = await response.json();
      projectComponentsList.value = data.components || [];
    }
  } catch {
    toast.error(t('projects.toasts.loadFailed'));
  }
};

const fetchTaskDetails = async () => {
  if (!isEdit.value) return;
  try {
    loading.value = true;
    const response = await apiFetch(
      `/api/projects/${projectId.value}/tasks/${taskId.value}`,
    );
    if (response.ok) {
      const data = await response.json();
      title.value = data.title;
      description.value = data.description || '';
      priority.value = data.priority;
      dueDate.value = data.dueDate ? data.dueDate.slice(0, 10) : '';
      isCompleted.value = data.isCompleted;

      taskComponents.value = (data.components || []).map((tc: any) => ({
        componentId: tc.componentId,
        quantity: tc.quantity,
        name: tc.component?.name,
        isDone: tc.isDone ?? false,
      }));

      taskOrders.value = (data.orders || []).map((tod: any) => ({
        orderId: tod.orderId,
        storeName: tod.order?.storeName,
        trackingNumber: tod.order?.trackingNumber,
        isDone: tod.isDone ?? false,
      }));
    }
  } catch {
    toast.error(t('projects.toasts.loadFailed'));
  } finally {
    loading.value = false;
  }
};

const handleAddTaskComponent = () => {
  if (!addCompId.value) return;
  const existing = taskComponents.value.find(
    (tc) => tc.componentId === addCompId.value,
  );
  const matched = projectComponentsList.value.find(
    (pc) => pc.componentId === addCompId.value,
  );

  if (existing) {
    existing.quantity += addCompQty.value;
  } else {
    taskComponents.value.push({
      componentId: addCompId.value,
      quantity: addCompQty.value,
      name: matched?.component?.name || t('taskForm.defaultComponentName'),
      isDone: false,
    });
  }
  addCompId.value = '';
  addCompQty.value = 1;
};

const handleRemoveTaskComponent = (index: number) => {
  taskComponents.value.splice(index, 1);
};

const handleCreateComponentInline = async () => {
  // Only the name is required by the backend now; the rest is optional.
  if (!inlineCompName.value.trim()) return;

  try {
    const res = await apiFetch('/api/components', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: inlineCompName.value.trim(),
        sku: inlineCompSku.value.trim(),
        categoryId: inlineCompCategoryId.value || null,
        quantity: inlineCompQty.value,
        minQuantity: 1,
        price: inlineCompPrice.value,
      }),
    });

    if (res.ok) {
      const newComp = await res.json();

      await apiFetch(`/api/projects/${projectId.value}/components`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          componentId: newComp.id,
          neededQty: inlineCompNeeded.value,
        }),
      });

      await fetchProjectContext();

      taskComponents.value.push({
        componentId: newComp.id,
        quantity: inlineCompNeeded.value,
        name: newComp.name,
      });

      inlineCompName.value = '';
      inlineCompSku.value = '';
      inlineCompCategoryId.value = '';
      inlineCompPrice.value = 0;
      inlineCompQty.value = 0;
      inlineCompNeeded.value = 1;
      isCreatingComponentInline.value = false;
    }
  } catch {
    toast.error(t('projects.toasts.componentLinkFailed'));
  }
};

const handleSave = async () => {
  if (!title.value.trim()) return;

  try {
    let activeTaskId = taskId.value;

    if (!isEdit.value) {
      const createRes = await apiFetch(
        `/api/projects/${projectId.value}/tasks`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.value.trim() }),
        },
      );
      if (createRes.ok) {
        const newTask = await createRes.json();
        activeTaskId = newTask.id;
      } else {
        toast.error(t('taskForm.createTaskError'));
        return;
      }
    }

    const patchRes = await apiFetch(
      `/api/projects/${projectId.value}/tasks/${activeTaskId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.value.trim(),
          description: description.value.trim(),
          priority: priority.value,
          dueDate: dueDate.value ? new Date(dueDate.value).toISOString() : null,
          isCompleted: isCompleted.value,
          componentIds: taskComponents.value.map((tc) => ({
            id: tc.componentId,
            quantity: tc.quantity,
            isDone: tc.isDone ?? false,
          })),
          orderIds: taskOrders.value.map((to) => ({
            id: to.orderId,
            isDone: to.isDone ?? false,
          })),
        }),
      },
    );

    if (patchRes.ok) {
      router.push(`/projects/${projectId.value}`);
    } else {
      toast.error(t('projects.toasts.saveFailed'));
    }
  } catch {
    toast.error(t('projects.toasts.saveFailed'));
  }
};

const handleDelete = async () => {
  const ok = await confirm({
    message: t('taskForm.deleteTaskConfirm'),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    const response = await apiFetch(
      `/api/projects/${projectId.value}/tasks/${taskId.value}`,
      {
        method: 'DELETE',
      },
    );
    if (response.ok) {
      router.push(`/projects/${projectId.value}`);
    }
  } catch {
    toast.error(t('projects.toasts.deleteFailed'));
  }
};

onMounted(async () => {
  projectId.value = route.params.projectId as string;
  if (route.params.taskId && route.params.taskId !== 'new') {
    isEdit.value = true;
    taskId.value = route.params.taskId as string;
  }
  await fetchProjectContext();
  await fetchTaskDetails();
  void loadCategories();
});
</script>

<template>
  <div class="w-full space-y-6 animate-fade-in pb-12">
    <!-- Header Back Navigation -->
    <div class="flex items-center justify-between">
      <button
        @click="router.push(`/projects/${projectId}`)"
        class="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        <ArrowLeft class="w-4 h-4" />
        {{ $t('taskForm.back') }}
      </button>

      <Button
        v-if="isEdit"
        variant="danger"
        size="sm"
        :icon-left="Trash2"
        @click="handleDelete"
      >
        {{ $t('taskForm.deleteBtn') }}
      </Button>
    </div>

    <!-- Main Card Form -->
    <div
      class="glass-card rounded-2xl p-6 md:p-8 space-y-8 border border-slate-200/60 dark:border-white/10 shadow-xl"
    >
      <div
        class="flex items-center gap-3 pb-4 border-b border-slate-200 dark:border-white/5"
      >
        <div
          class="p-2.5 bg-brand-500/10 text-brand-600 dark:text-brand-400 rounded-xl"
        >
          <CheckSquare class="w-6 h-6" />
        </div>
        <div>
          <h2 class="text-lg font-bold text-slate-900 dark:text-white">
            {{ isEdit ? $t('taskForm.editTitle') : $t('taskForm.createTitle') }}
          </h2>
          <p class="text-xs text-slate-500">
            {{ $t('taskForm.subtitle') }}
          </p>
        </div>
      </div>

      <div v-if="loading" class="flex justify-center items-center py-12">
        <Spinner size="sm" />
      </div>

      <form v-else @submit.prevent="handleSave" class="space-y-8">
        <!-- Grid fields -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="md:col-span-2 space-y-1.5">
            <label
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
              >{{ $t('taskForm.nameLabel') }}</label
            >
            <input
              v-model="title"
              type="text"
              :placeholder="$t('taskForm.namePlaceholder')"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
              required
            />
          </div>

          <div v-if="showTaskAdvanced" class="space-y-1.5">
            <label
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
              >{{ $t('taskForm.priorityLabel') }}</label
            >
            <Select
              v-model="priority"
              :options="[
                { value: 'LOW', label: t('projects.priority.low') },
                { value: 'MEDIUM', label: t('projects.priority.medium') },
                { value: 'HIGH', label: t('projects.priority.high') },
              ]"
            />
          </div>

          <div class="space-y-1.5">
            <label
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
              >{{ $t('taskForm.dueDateLabel') }}</label
            >
            <input
              v-model="dueDate"
              type="date"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
            />
          </div>
        </div>

        <!-- Checkbox status -->
        <div class="flex items-center gap-2">
          <input
            v-model="isCompleted"
            type="checkbox"
            id="isCompletedCheck"
            class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-transparent border-slate-300 dark:border-white/10"
          />
          <label
            for="isCompletedCheck"
            class="text-sm font-semibold text-slate-800 dark:text-slate-200 select-none cursor-pointer"
          >
            {{ $t('taskForm.isCompletedLabel') }}
          </label>
        </div>

        <!-- Description WYSIWYG -->
        <div class="space-y-1.5">
          <label
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >{{ $t('taskForm.descriptionLabel') }}</label
          >
          <RichEditor
            v-model="description"
            :placeholder="$t('taskForm.descriptionPlaceholder')"
          />
        </div>

        <!-- Existing dependencies, read-only, when the advanced editor is
             hidden: advanced-created data keeps a representation (no edit/add/
             remove controls). -->
        <div
          v-if="!showTaskAdvanced && hasDependencies"
          class="space-y-3 pt-6 border-t border-slate-200 dark:border-white/5"
        >
          <h3 class="text-sm font-bold text-slate-900 dark:text-white">
            {{ $t('taskForm.dependenciesReadOnly') }}
          </h3>
          <div class="space-y-2">
            <div
              v-for="(tc, index) in taskComponents"
              :key="'c' + index"
              class="flex items-center gap-2.5 p-2.5 rounded-xl border text-xs bg-slate-50 dark:bg-white/[0.02] border-slate-200/60 dark:border-white/5"
            >
              <Cpu
                class="w-4 h-4 text-brand-500 dark:text-brand-400 shrink-0"
              />
              <span
                class="font-semibold text-slate-800 dark:text-slate-200 truncate"
                >{{ tc.name }}</span
              >
              <span
                class="text-xxs text-slate-500 dark:text-slate-400 shrink-0 ml-auto"
                >{{ $t('taskForm.quantityPcs', { qty: tc.quantity }) }}</span
              >
            </div>
            <div
              v-for="(to, index) in taskOrders"
              :key="'o' + index"
              class="flex items-center gap-2.5 p-2.5 rounded-xl border text-xs bg-slate-50 dark:bg-white/[0.02] border-slate-200/60 dark:border-white/5"
            >
              <Truck
                class="w-4 h-4 text-brand-500 dark:text-brand-400 shrink-0"
              />
              <span
                class="font-semibold text-slate-800 dark:text-slate-200 truncate"
                >{{ to.storeName }}</span
              >
              <span
                class="text-xxs text-slate-500 dark:text-slate-400 shrink-0 ml-auto"
                >{{
                  $t('taskForm.trackingLabel', {
                    tracking: to.trackingNumber || $t('taskForm.noTracking'),
                  })
                }}</span
              >
            </div>
          </div>
        </div>

        <!-- Sub-sections: Dependencies Grid -->
        <div
          v-if="showTaskAdvanced"
          class="grid grid-cols-1 gap-8 pt-6 border-t border-slate-200 dark:border-white/5"
          :class="hasOrderEditor ? 'md:grid-cols-2' : ''"
        >
          <!-- 1. Component Dependencies -->
          <div class="space-y-4">
            <h3
              class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2"
            >
              <Cpu class="w-4 h-4 text-brand-500" />
              {{ $t('taskForm.neededComponentsTitle') }}
            </h3>

            <!-- List linked components -->
            <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
              <div
                v-for="(tc, index) in taskComponents"
                :key="index"
                class="flex items-center gap-2.5 p-2.5 rounded-xl border text-xs transition-all duration-200"
                :class="
                  tc.isDone
                    ? 'bg-emerald-50 dark:bg-emerald-500/8 border-emerald-200 dark:border-emerald-500/20'
                    : 'bg-slate-50 dark:bg-white/[0.02] border-slate-200/60 dark:border-white/5'
                "
              >
                <!-- Done toggle -->
                <button
                  type="button"
                  @click="tc.isDone = !tc.isDone"
                  class="shrink-0 transition-colors duration-150"
                  :title="
                    tc.isDone
                      ? $t('taskForm.markMissing')
                      : $t('taskForm.markAvailable')
                  "
                >
                  <CheckCircle2
                    v-if="tc.isDone"
                    class="w-4 h-4 text-emerald-500"
                  />
                  <Circle
                    v-else
                    class="w-4 h-4 text-slate-400 dark:text-slate-500"
                  />
                </button>
                <div class="flex-1 min-w-0">
                  <span
                    class="font-semibold block truncate transition-all duration-150"
                    :class="
                      tc.isDone
                        ? 'text-emerald-700 dark:text-emerald-400 line-through decoration-emerald-400/60'
                        : 'text-slate-800 dark:text-slate-200'
                    "
                    >{{ tc.name }}</span
                  >
                  <span
                    class="text-xxs"
                    :class="
                      tc.isDone
                        ? 'text-emerald-600/70 dark:text-emerald-500/60'
                        : 'text-slate-500'
                    "
                    >{{
                      $t('taskForm.quantityPcs', { qty: tc.quantity })
                    }}</span
                  >
                </div>
                <button
                  type="button"
                  @click="handleRemoveTaskComponent(index)"
                  class="p-1 text-slate-400 hover:text-red-500 rounded transition-all shrink-0"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
              <div
                v-if="taskComponents.length === 0"
                class="text-xs text-slate-500 py-4 text-center"
              >
                {{ $t('taskForm.noLinkedComponents') }}
              </div>
            </div>

            <!-- Link/Create Component Inline Form -->
            <div v-if="!isCreatingComponentInline" class="space-y-2">
              <div class="flex gap-2">
                <Select
                  v-model="addCompId"
                  :options="
                    projectComponentsList.map((pc) => ({
                      value: pc.componentId,
                      label: t('taskForm.componentOptionReserve', {
                        name: pc.component?.name || '',
                        reserved: pc.reservedQty,
                        needed: pc.neededQty,
                      }),
                    }))
                  "
                  :placeholder="$t('taskForm.selectPlaceholder')"
                  class="flex-1"
                />
                <input
                  v-model.number="addCompQty"
                  type="number"
                  min="1"
                  class="w-16 text-center bg-white dark:bg-dark-900 border border-slate-300 dark:border-white/10 rounded-xl px-2 py-2 text-xs"
                />
                <button
                  type="button"
                  @click="handleAddTaskComponent"
                  class="px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-all shrink-0"
                >
                  {{ $t('taskForm.linkBtn') }}
                </button>
              </div>
              <button
                v-if="inventoryEnabled"
                type="button"
                @click="isCreatingComponentInline = true"
                class="text-xxs font-bold text-brand-600 dark:text-brand-400 hover:underline"
              >
                {{ $t('taskForm.createMissingComponentBtn') }}
              </button>
            </div>

            <!-- Create component inline form -->
            <div
              v-else
              class="p-4 bg-slate-50 dark:bg-white/[0.02] rounded-xl border border-slate-200 dark:border-white/5 space-y-3.5 animate-fade-in"
            >
              <div
                class="flex justify-between items-center pb-1.5 border-b border-slate-200 dark:border-white/5"
              >
                <span
                  class="text-xxs font-bold text-slate-700 dark:text-slate-300"
                  >{{ $t('taskForm.quickCreateTitle') }}</span
                >
                <button
                  type="button"
                  @click="isCreatingComponentInline = false"
                  class="text-xxs font-bold text-slate-500 hover:underline"
                >
                  {{ $t('taskForm.cancel') }}
                </button>
              </div>
              <input
                v-model="inlineCompName"
                type="text"
                :placeholder="$t('taskForm.quickNamePlaceholder')"
                class="w-full bg-white dark:bg-dark-900 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-xs"
              />
              <Select
                v-if="showCategories"
                v-model="inlineCompCategoryId"
                :options="categoryOptions"
                :placeholder="$t('taskForm.quickCategoryPlaceholder')"
                :aria-label="$t('taskForm.quickCategoryPlaceholder')"
              />
              <div class="grid grid-cols-3 gap-2">
                <input
                  v-model.number="inlineCompPrice"
                  type="number"
                  step="0.01"
                  :placeholder="$t('taskForm.quickPricePlaceholder')"
                  class="w-full bg-white dark:bg-dark-900 border border-slate-300 dark:border-white/10 rounded-xl px-2 py-2 text-xs"
                />
                <input
                  v-model.number="inlineCompQty"
                  type="number"
                  :placeholder="$t('taskForm.quickStockPlaceholder')"
                  class="w-full bg-white dark:bg-dark-900 border border-slate-300 dark:border-white/10 rounded-xl px-2 py-2 text-xs"
                />
                <input
                  v-model.number="inlineCompNeeded"
                  type="number"
                  :placeholder="$t('taskForm.quickNeededPlaceholder')"
                  class="w-full bg-white dark:bg-dark-900 border border-slate-300 dark:border-white/10 rounded-xl px-2 py-2 text-xs"
                />
              </div>
              <button
                type="button"
                @click="handleCreateComponentInline"
                class="w-full py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-xs transition-all"
              >
                {{ $t('taskForm.quickCreateBtn') }}
              </button>
            </div>
          </div>

          <!-- 2. Logistics Dependencies — contributed by logistics (#58) -->
          <PluginSlot name="projects.task-form.order" :ctx="taskOrderCtx" />
        </div>

        <!-- Action Footer -->
        <div
          class="flex justify-end gap-3 pt-6 border-t border-slate-200 dark:border-white/5"
        >
          <Button
            variant="secondary"
            @click="router.push(`/projects/${projectId}`)"
          >
            {{ $t('taskForm.cancel') }}
          </Button>
          <Button type="submit" :icon-left="Save">
            {{ $t('taskForm.save') }}
          </Button>
        </div>
      </form>
    </div>
  </div>
</template>
