<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Button,
  Disclosure,
  SecretInput,
  SegmentedControl,
  Spinner,
  secretPatch,
  useConfirm,
  useToastStore,
  type SecretAction,
} from '@makekeeper/frontend-core';
import { Rocket, Terminal, Copy, BookOpen } from '@lucide/vue';
import {
  DEPLOY_HOOK_METHODS,
  type DeployHookMethod,
  type InstallMethod,
} from '@makekeeper/plugin-contract';
import SectionShell from './SectionShell.vue';
import { useUpdateStore } from './update-store';
import { UPDATE_COMMANDS } from './update-commands';
import {
  DEPLOY_HOOK_RECIPES,
  DEPLOY_HOOK_SOURCES,
  deployHookSourceFor,
  type DeployHookSource,
} from './deploy-hook-recipes';

// Actually updating the instance (#267): the deploy hook that does it for you
// (#101), where that hook comes from (#108), and the commands to do it by hand.
// One task told two ways — "let the hook do it" / "do it by hand" — so they
// share a pane rather than competing for the page.
//
// The pane is one action and two references (#272), and they no longer share a
// plane. The hook form is what an admin comes here to do, so it is open, first
// and never folds. The rest — which screen of which manager the hook is copied
// from, and the shell commands for doing the update by hand — is read once
// during setup: it lives in a single fold at the bottom, closed, with a link in
// the section's action row for the one visit that needs it.
//
// This is not the fold #267 removed. That one hid half of an 815-line scroll
// from an admin who had no way of knowing what was behind it; this one is
// below everything it could displace and is announced at the top.
const { t } = useI18n();
const toast = useToastStore();
const confirm = useConfirm();
const store = useUpdateStore();

// Hook form state. The URL and token are write-only on the backend, so each
// field carries its own stored/replace/remove intent and shows what is stored
// as a shielded redacted preview rather than as an empty box (#270).
const hookUrl = ref('');
const hookToken = ref('');
const urlAction = ref<SecretAction>('keep');
const tokenAction = ref<SecretAction>('keep');
const hookMethod = ref<DeployHookMethod>('POST');
const savingHook = ref(false);

// Adopt the stored method once the hook state arrives (the form renders before
// the fetch resolves).
watch(
  () => store.deployHook?.method,
  (method) => {
    if (method) hookMethod.value = method;
  },
);

const methodOptions = computed(() =>
  DEPLOY_HOOK_METHODS.map((value) => ({ value, label: value })),
);

// The detected install method (#100) is only a setup hint — it pre-labels the
// hook card ("looks like Dokploy"), it never selects or triggers anything.
const detectedMethod = computed<InstallMethod | null>(() => {
  const method = store.installInfo?.method;
  if (!method || method === 'unknown' || method === 'dev') return null;
  return method;
});

const hookHint = computed(() => {
  const method = detectedMethod.value;
  if (!method) return null;
  return t('settings.updates.hook.detected', {
    method: t(`settings.updates.install.methods.${method}`),
  });
});

const guideMethod = computed<InstallMethod>(
  () => store.installInfo?.method ?? 'unknown',
);

const guideCommands = computed<readonly string[]>(
  () => UPDATE_COMMANDS[guideMethod.value],
);

// "Where do I get this hook?" (#108). The form asks for a URL, a token and a
// method that only exist inside the admin's manager — detection can point at the
// right manager, but the copy-it-from-here steps have to be spelled out.
//
// The tab follows the detected method until the admin picks another: a wrong
// guess (or `unknown`) must never lock them out of the other recipes.
const sourceOverride = ref<DeployHookSource | null>(null);

const hookSource = computed<DeployHookSource>({
  get: () => sourceOverride.value ?? deployHookSourceFor(detectedMethod.value),
  set: (source) => {
    sourceOverride.value = source;
  },
});

const sourceLabel = (source: DeployHookSource): string =>
  source === 'other'
    ? t('settings.updates.hook.source.otherLabel')
    : t(`settings.updates.install.methods.${source}`);

const sourceOptions = computed(() =>
  DEPLOY_HOOK_SOURCES.map((value) => ({ value, label: sourceLabel(value) })),
);

const sourceExpects = (source: DeployHookSource): string => {
  const recipe = DEPLOY_HOOK_RECIPES[source];
  return t('settings.updates.hook.source.expects', {
    method: recipe.method,
    token: t(
      recipe.needsToken
        ? 'settings.updates.hook.source.withToken'
        : 'settings.updates.hook.source.withoutToken',
    ),
  });
};

// Every recipe is rendered, stacked in one grid cell, with the inactive ones
// merely invisible. Recipes differ in step count, so rendering only the chosen
// one made the panel — and everything under it — resize under the cursor of an
// admin comparing two managers. The cell is as tall as the tallest recipe and
// stays that way (§7 — "the main part must not jump").
const recipes = computed(() =>
  DEPLOY_HOOK_SOURCES.map((source) => ({
    source,
    recipe: DEPLOY_HOOK_RECIPES[source],
    expects: sourceExpects(source),
  })),
);

// The fold, and the link by the heading that opens it. Closed on arrival: an
// admin who already pasted their hook never needs what is inside.
const referenceOpen = ref(false);
const reference = ref<InstanceType<typeof Disclosure> | null>(null);

async function onOpenReference(): Promise<void> {
  referenceOpen.value = true;
  await nextTick();
  reference.value?.reveal();
}

// The whole sentence is one key: locales order "when / how it went / detail"
// differently, so the glue between the three parts belongs in the bundle, not
// here (§5.5 — the only string literals in code are i18n keys).
const lastTriggeredLabel = computed<string | null>(() => {
  const hook = store.deployHook;
  if (!hook?.lastTriggeredAt) return null;
  return t('settings.updates.hook.lastTriggered', {
    time: new Date(hook.lastTriggeredAt).toLocaleString(),
    outcome: t(`settings.updates.hook.outcomes.${hook.lastOutcome}`),
    detail:
      hook.lastStatusCode === null
        ? t('settings.updates.hook.noResponse')
        : t('settings.updates.hook.statusCode', { code: hook.lastStatusCode }),
  });
});

// This API spells "clear this" as an empty string and "keep what is stored" as
// an omitted field, so `secretPatch`'s null becomes '' on the way out. Both
// hook fields can be cleared, so an emptied box saves as a clear (#270).
function hookField(action: SecretAction, typed: string): string | undefined {
  const patch = secretPatch(action, typed, { emptyClears: true });
  return patch === null ? '' : patch;
}

function resetHookFields(): void {
  hookUrl.value = '';
  hookToken.value = '';
  urlAction.value = 'keep';
  tokenAction.value = 'keep';
}

async function onSaveHook(): Promise<void> {
  savingHook.value = true;
  try {
    const url = hookField(urlAction.value, hookUrl.value);
    const token = hookField(tokenAction.value, hookToken.value);
    const ok = await store.saveDeployHook({
      method: hookMethod.value,
      ...(url === undefined ? {} : { url }),
      ...(token === undefined ? {} : { token }),
    });
    toast[ok ? 'success' : 'error'](
      t(
        ok
          ? 'settings.updates.hook.toast.saved'
          : 'settings.updates.hook.toast.saveFailed',
      ),
    );
    if (ok) resetHookFields();
  } finally {
    savingHook.value = false;
  }
}

// Never auto-fires: a redeploy restarts the instance for everyone, so it is
// gated behind an explicit danger-tone confirmation. With no update pending the
// hook still fires — it just re-pulls the current version — and the wording says
// so rather than promising a new one.
async function onUpdateNow(): Promise<void> {
  const confirmed = await confirm({
    title: t('settings.updates.hook.confirm.title'),
    message: t(
      store.updateAvailable
        ? 'settings.updates.hook.confirm.message'
        : 'settings.updates.hook.confirm.messageRedeploy',
    ),
    confirmLabel: t('settings.updates.hook.confirm.action'),
    tone: 'danger',
  });
  if (!confirmed) return;
  const ok = await store.triggerDeployHook();
  toast[ok ? 'success' : 'error'](
    t(
      ok
        ? 'settings.updates.hook.toast.triggered'
        : 'settings.updates.hook.toast.triggerFailed',
    ),
  );
}

async function onCopyCommands(): Promise<void> {
  try {
    await navigator.clipboard.writeText(guideCommands.value.join('\n'));
    toast.success(t('settings.updates.guide.copied'));
  } catch {
    toast.error(t('settings.updates.guide.copyFailed'));
  }
}
</script>

<template>
  <SectionShell
    :title="$t('settings.updates.sections.update.title')"
    :description="$t('settings.updates.sections.update.description')"
  >
    <template #actions>
      <!-- Announces the fold from the top of the pane — the reference sits at
           the bottom and nothing else on screen would say it exists. It rides
           the section's action row, quietly, rather than crowding the heading:
           it is a control, and this is where this page keeps its controls.
           It points at the fold (`aria-controls`) but claims no `aria-expanded`:
           it only ever opens, and a control that announces "expanded" while
           pressing it collapses nothing is lying about being a toggle. The
           fold's own heading is the toggle; this is the way there. -->
      <Button
        variant="link"
        size="sm"
        :icon-left="BookOpen"
        aria-controls="updates-reference"
        @click="onOpenReference"
      >
        {{ $t('settings.updates.reference.link') }}
      </Button>

      <!-- Primary only while an update is actually pending; otherwise this is
           a plain re-deploy of the current version, not the page's main call
           to action. -->
      <Button
        v-if="store.deployHook?.hasUrl"
        :variant="store.updateAvailable ? 'primary' : 'secondary'"
        :icon-left="Rocket"
        :loading="store.triggering"
        @click="onUpdateNow"
      >
        {{
          store.updateAvailable
            ? $t('settings.updates.hook.updateNow')
            : $t('settings.updates.hook.redeploy')
        }}
      </Button>
    </template>

    <!-- One-click update via the admin's own deploy hook (#101) -->
    <div class="glass-card rounded-2xl p-6 space-y-4">
      <div class="min-w-0">
        <p class="font-medium text-slate-900 dark:text-slate-100">
          {{ $t('settings.updates.hook.title') }}
        </p>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {{ $t('settings.updates.hook.hint') }}
        </p>
      </div>

      <p
        v-if="hookHint"
        class="rounded-xl border border-brand-500/20 bg-brand-500/5 p-3 text-sm text-brand-700 dark:text-brand-300"
      >
        {{ hookHint }}
      </p>

      <div v-if="!store.deployHookResolved" class="flex justify-center py-6">
        <Spinner />
      </div>

      <!-- Not permitted is its own state, not an error in disguise (#106). -->
      <p
        v-else-if="store.deployHookStatus === 'forbidden'"
        class="text-sm text-slate-500 dark:text-slate-400"
      >
        {{ $t('settings.updates.hook.notPermitted') }}
      </p>

      <p
        v-else-if="store.deployHookStatus === 'error'"
        class="text-sm text-slate-500 dark:text-slate-400"
      >
        {{ $t('settings.updates.hook.loadError') }}
      </p>

      <template v-else>
        <p
          v-if="!store.deployHook?.hasUrl"
          class="text-sm text-slate-500 dark:text-slate-400"
        >
          {{ $t('settings.updates.hook.notConfigured') }}
        </p>
        <!-- The stored URL used to be announced here, a card away from the
             field it describes; the field carries its own preview now (#270). -->
        <p
          v-if="lastTriggeredLabel"
          class="text-sm text-slate-500 dark:text-slate-400"
        >
          {{ lastTriggeredLabel }}
        </p>

        <div
          class="grid gap-4 border-t border-slate-200 pt-4 dark:border-slate-700"
        >
          <div>
            <label
              for="deploy-hook-url"
              class="block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              {{ $t('settings.updates.hook.url') }}
            </label>
            <div class="mt-1">
              <!-- Removable: this API clears a field with an empty string, so
                   emptying the box is a real instruction and is honoured as
                   one. "Remove hook" below is the coarse both-at-once action. -->
              <SecretInput
                id="deploy-hook-url"
                v-model="hookUrl"
                v-model:action="urlAction"
                :stored="!!store.deployHook?.hasUrl"
                :preview="store.deployHook?.urlPreview"
                removable
                type="url"
                :placeholder="$t('settings.updates.hook.urlPlaceholder')"
              />
            </div>
            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {{ $t('settings.updates.hook.urlHint') }}
            </p>
          </div>

          <div>
            <label
              for="deploy-hook-token"
              class="block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              {{ $t('settings.updates.hook.token') }}
            </label>
            <!-- Removable: a manager whose token rides in the URL path
                 (Dokploy) needs the token dropped, not replaced. -->
            <div class="mt-1">
              <SecretInput
                id="deploy-hook-token"
                v-model="hookToken"
                v-model:action="tokenAction"
                :stored="!!store.deployHook?.hasToken"
                removable
                mono
                autocomplete="new-password"
                :placeholder="$t('settings.updates.hook.tokenPlaceholder')"
              />
            </div>
          </div>

          <div>
            <p class="text-sm font-medium text-slate-700 dark:text-slate-300">
              {{ $t('settings.updates.hook.method') }}
            </p>
            <div class="mt-1 max-w-xs">
              <SegmentedControl
                v-model="hookMethod"
                :options="methodOptions"
                :aria-label="$t('settings.updates.hook.method')"
                size="lg"
                full-width
              />
            </div>
            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {{ $t('settings.updates.hook.methodHint') }}
            </p>
          </div>

          <!-- One action: the fields say what will happen (replace, keep,
               clear), so a separate "remove the hook" button only competed
               with them — clearing the URL field is the removal. -->
          <div class="flex flex-wrap items-center gap-3">
            <Button :loading="savingHook" @click="onSaveHook">
              {{ $t('settings.updates.hook.save') }}
            </Button>
          </div>
        </div>
      </template>
    </div>

    <!-- Everything that is read rather than done (#272). Last on the pane, so
         opening it moves nothing above it. -->
    <Disclosure
      ref="reference"
      v-model:open="referenceOpen"
      content-id="updates-reference"
      :title="$t('settings.updates.reference.title')"
      :description="$t('settings.updates.reference.description')"
    >
      <!-- Where the pasted hook comes from (#108): the manager's own UI is the
           only place these values exist, and the app cannot read them from
           inside the container (#97). The `SegmentedControl` picks a value, not
           a pane — it is a recipe chooser, not a second fold. -->
      <div class="space-y-4">
        <div class="min-w-0">
          <p class="font-medium text-slate-900 dark:text-slate-100">
            {{ $t('settings.updates.hook.source.title') }}
          </p>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {{ $t('settings.updates.hook.source.hint') }}
          </p>
        </div>

        <SegmentedControl
          v-model="hookSource"
          :options="sourceOptions"
          :aria-label="$t('settings.updates.hook.source.manager')"
        />

        <div class="grid">
          <div
            v-for="entry in recipes"
            :key="entry.source"
            class="col-start-1 row-start-1 space-y-4"
            :class="entry.source === hookSource ? '' : 'invisible'"
          >
            <ol
              class="list-decimal space-y-2 pl-5 text-sm text-slate-700 marker:text-slate-400 dark:text-slate-300 dark:marker:text-slate-500"
            >
              <li v-for="step in entry.recipe.steps" :key="step">
                {{ $t(step) }}
              </li>
            </ol>

            <div v-if="entry.recipe.urlTemplate" class="space-y-1">
              <p class="text-xs text-slate-500 dark:text-slate-400">
                {{ $t('settings.updates.hook.source.urlTemplate') }}
              </p>
              <div
                class="overflow-x-auto rounded-xl bg-slate-900 p-3 dark:bg-black/40"
              >
                <code class="font-mono text-xs text-slate-100">{{
                  entry.recipe.urlTemplate
                }}</code>
              </div>
            </div>

            <p class="text-sm text-slate-500 dark:text-slate-400">
              {{ entry.expects }}
            </p>
          </div>
        </div>
      </div>

      <!-- The same job by hand (#101). Still the only path that works when the
           version check is unreachable — which is why it is one scroll and one
           click away rather than a page elsewhere. -->
      <div
        class="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-700"
      >
        <div class="min-w-0">
          <p class="font-medium text-slate-900 dark:text-slate-100">
            {{ $t('settings.updates.guide.title') }}
          </p>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {{ $t('settings.updates.guide.hint') }}
          </p>
        </div>

        <!-- The guide falls back to `unknown` while install info is in flight,
           which would show "method unknown" and then flip — render only once
           the panel resolved (the store's definite-state flag, #106). -->
        <div v-if="!store.installInfoResolved" class="flex justify-center py-6">
          <Spinner />
        </div>

        <div v-else class="space-y-4">
          <p class="text-sm text-slate-700 dark:text-slate-300">
            {{ $t(`settings.updates.guide.notes.${guideMethod}`) }}
          </p>

          <div v-if="guideCommands.length" class="space-y-2">
            <div class="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                :icon-left="Copy"
                @click="onCopyCommands"
              >
                {{ $t('settings.updates.guide.copy') }}
              </Button>
            </div>
            <div
              class="overflow-x-auto rounded-xl bg-slate-900 p-4 dark:bg-black/40"
            >
              <pre
                class="font-mono text-xs leading-relaxed text-slate-100"
              ><code v-for="command in guideCommands" :key="command" class="block"><Terminal class="mr-2 inline-block w-3 h-3 text-slate-400" aria-hidden="true" />{{ command }}</code></pre>
            </div>
          </div>

          <!-- Lives with the commands, not on the page at large: the one-click
             path carries the same warning inside its confirmation dialog, and
             a banner that is always on screen stops being read. -->
          <p
            class="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
          >
            {{ $t('settings.updates.guide.backupWarning') }}
          </p>
        </div>
      </div>
    </Disclosure>
  </SectionShell>
</template>
