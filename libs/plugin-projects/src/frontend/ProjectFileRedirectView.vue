<script setup lang="ts">
// Landing for a `mk://projects/file/<id>` link (#112). The ORef names the
// attachment, not the project it sits in, and `refToRoute` is synchronous — so
// the link points here and the lookup happens on arrival, then the view
// replaces itself with the project's Files tab.
//
// An attachment with no project (a phone photo, a chat with no project) has
// nowhere to land: it says so instead of bouncing to a broken route.
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiFetch, EmptyState, Spinner } from '@makekeeper/frontend-core';
import { FileQuestion } from '@lucide/vue';

const route = useRoute();
const router = useRouter();

type Phase = 'resolving' | 'unavailable';
const phase = ref<Phase>('resolving');

onMounted(async () => {
  const id = String(route.params.attachmentId ?? '');
  try {
    const res = await apiFetch(`/api/projects/files/${encodeURIComponent(id)}`);
    const data: { projectId?: string | null } = res.ok
      ? await res.json()
      : { projectId: null };
    if (data?.projectId) {
      router.replace({
        path: `/projects/${data.projectId}`,
        query: { tab: 'files', file: id },
      });
      return;
    }
  } catch {
    // fall through to the unavailable panel
  }
  phase.value = 'unavailable';
});
</script>

<template>
  <div class="p-6">
    <EmptyState
      v-if="phase === 'unavailable'"
      :icon="FileQuestion"
      :title="$t('projects.fileLink.unavailableTitle')"
      :description="$t('projects.fileLink.unavailableText')"
    />
    <div v-else class="flex justify-center py-12">
      <Spinner :label="$t('common.loading')" />
    </div>
  </div>
</template>
