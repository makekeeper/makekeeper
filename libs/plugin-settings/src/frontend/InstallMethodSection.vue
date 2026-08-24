<script setup lang="ts">
import { computed } from 'vue';
import { Badge, Spinner } from '@makekeeper/frontend-core';
import SectionShell from './SectionShell.vue';
import { useUpdateStore } from './update-store';

// Install-method diagnostics (#100). Its own section (#267): an admin here is
// debugging a wrong install method, and used to reach it past everything else
// the page had to say.
const store = useUpdateStore();

// A `guessed` method means the deployment didn't stamp MK_INSTALL_METHOD — worth
// flagging, since that is the one thing an admin can fix to make it exact.
const confidenceTone = computed<'success' | 'neutral' | 'warning'>(() => {
  const confidence = store.installInfo?.confidence;
  if (confidence === 'declared') return 'success';
  if (confidence === 'guessed') return 'warning';
  return 'neutral';
});
</script>

<template>
  <SectionShell
    :title="$t('settings.updates.sections.install.title')"
    :description="$t('settings.updates.sections.install.description')"
  >
    <!-- Same definite-state flag every sibling pane waits on (#106): a heading
         over blank space reads as a page that has nothing to say. -->
    <div v-if="!store.installInfoResolved" class="flex justify-center py-6">
      <Spinner />
    </div>

    <div v-else-if="store.installInfo" class="glass-card rounded-2xl p-6">
      <dl class="grid gap-3 sm:grid-cols-3">
        <div>
          <dt
            class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {{ $t('settings.updates.install.method') }}
          </dt>
          <dd class="mt-1 text-sm text-slate-900 dark:text-slate-100">
            {{
              $t(`settings.updates.install.methods.${store.installInfo.method}`)
            }}
          </dd>
        </div>
        <div>
          <dt
            class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {{ $t('settings.updates.install.environment') }}
          </dt>
          <dd class="mt-1 text-sm text-slate-900 dark:text-slate-100">
            {{
              store.installInfo.container
                ? $t('settings.updates.install.container')
                : $t('settings.updates.install.host')
            }}
          </dd>
        </div>
        <div>
          <dt
            class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {{ $t('settings.updates.install.confidence') }}
          </dt>
          <dd class="mt-1">
            <Badge :tone="confidenceTone" :uppercase="false">
              {{
                $t(
                  `settings.updates.install.confidences.${store.installInfo.confidence}`,
                )
              }}
            </Badge>
          </dd>
        </div>
      </dl>
    </div>

    <!-- `forbidden` renders nothing here: the diagnostics panel is admin-only
         detail, and its absence is a definite state — only a real load failure
         earns the error line (#106). -->
    <p
      v-else-if="store.installInfoStatus === 'error'"
      class="glass-card rounded-2xl p-6 text-sm text-slate-500 dark:text-slate-400"
    >
      {{ $t('settings.updates.install.loadError') }}
    </p>
  </SectionShell>
</template>
