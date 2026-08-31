<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { KeyRound, Radar } from '@lucide/vue';
import {
  Badge,
  Button,
  CopyField,
  EmptyState,
  Modal,
  SegmentedControl,
  Spinner,
  apiErrorMessage,
  apiJson,
  copyText,
  useDateFormat,
  useToastStore,
} from '@makekeeper/frontend-core';
import { useExternalAdmin, type Candidate } from './external-admin';
import SectionShell from './SectionShell.vue';
import PluginCard from './PluginCard.vue';

// Letting a container in — all three steps of it: pair the container that
// announces itself (or hand a headless one an install token), then consent to
// what it asks for. The approval used to sit in the plugin list and the token
// among the credentials, each a section away from the errand that needs it.
const { t } = useI18n();
const dates = useDateFormat();
const toast = useToastStore();
const admin = useExternalAdmin();

// Code being typed, per candidate — one field open at a time is enough.
const codeFor = ref<Record<string, string>>({});

const setCode = (candidate: Candidate, value: string): void => {
  codeFor.value = { ...codeFor.value, [candidate.id]: value };
};

// `$event.target` is typed `EventTarget | null`; narrowed rather than cast
// (§5.1), which also makes the handler safe on a re-targeted event.
const inputValue = (event: Event): string =>
  event.target instanceof HTMLInputElement ? event.target.value : '';

const pair = async (candidate: Candidate): Promise<void> => {
  // Cleared only on success: a refused code stays in the field, or one wrong
  // digit costs the whole code — and it expires while it is retyped.
  const paired = await admin.pairCandidate(
    candidate,
    codeFor.value[candidate.id] ?? '',
  );
  if (paired) setCode(candidate, '');
};

// The install token: the second way in, for a container that cannot be paired
// by hand. It installs a PLUGIN — which is why it belongs here and not among
// the connection tokens outside clients authenticate with. Shown exactly once.
const installOpen = ref(false);
const installValue = ref('');

const generateInstallToken = async (): Promise<void> => {
  try {
    const res = await apiJson<{ token: string }>(
      '/api/external/admin/install-token',
      { method: 'POST' },
    );
    installValue.value = res.token;
    installOpen.value = true;
  } catch (err: unknown) {
    toast.error(apiErrorMessage(err, t('external.errors.failed')));
  }
};

// The row itself copies (CopyField) — this only acknowledges it.
const onTokenCopied = (): void => {
  toast.success(t('external.installToken.copied'));
};

// The footer button is the "I have it" exit: same copy, then the window goes.
const copyInstallToken = async (): Promise<void> => {
  await copyText(installValue.value);
  onTokenCopied();
  installOpen.value = false;
};
</script>

<template>
  <SectionShell
    :title="t('external.sections.connect.title')"
    :description="t('external.sections.connect.description')"
  >
    <template #actions>
      <!-- Pairing first: it is the path an admin sitting in front of the UI
           should take. The install token has its own card below, where there
           is room to say what it is for. -->
      <Button v-if="!admin.pairing.value.open" @click="admin.openPairing()">
        <Radar class="h-4 w-4" aria-hidden="true" />
        {{
          admin.pairing.value.knocking > 0
            ? t('external.discovery.openKnocking', {
                count: admin.pairing.value.knocking,
              })
            : t('external.discovery.open')
        }}
      </Button>
      <Button v-else variant="secondary" @click="admin.closePairing()">
        {{ t('external.discovery.close') }}
      </Button>
    </template>

    <!-- Installs that already paired and are now asking for their permissions.
         First: it is a question addressed to the admin, and questions come
         before instruments. -->
    <div v-if="admin.awaitingApproval.value.length > 0" class="grid gap-4">
      <PluginCard
        v-for="p in admin.awaitingApproval.value"
        :key="p.pluginId"
        :plugin="p"
      />
    </div>

    <!-- Something is trying to connect while the window is shut: say so, or
         the admin stares at an empty screen while a container retries in the
         background (#147). -->
    <p
      v-if="!admin.pairing.value.open && admin.pairing.value.knocking > 0"
      class="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
    >
      {{
        t('external.discovery.knocking', {
          count: admin.pairing.value.knocking,
        })
      }}
    </p>

    <!-- With the window shut there is nothing to list: a container cannot
         announce, so the section says what to do instead of showing an empty
         list. The ignored list stays reachable, since ignoring is reversible. -->
    <EmptyState
      v-if="
        !admin.pairing.value.open && admin.candidateFilter.value === 'waiting'
      "
      :icon="Radar"
      :title="t('external.discovery.closedTitle')"
      :description="t('external.discovery.closedHint')"
    >
      <template #action>
        <Button variant="secondary" @click="admin.setFilter('ignored')">
          {{ t('external.discovery.filterIgnored') }}
        </Button>
      </template>
    </EmptyState>

    <div
      v-else
      class="rounded-2xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-500/30 dark:bg-brand-500/10"
    >
      <h3 class="text-sm font-semibold text-slate-900 dark:text-white">
        {{ t('external.discovery.title') }}
      </h3>
      <!-- Only while the window is actually open: this panel is also how the
           ignored list is reached with pairing shut, and there the hint
           describes a state the admin is not in. -->
      <p
        v-if="admin.pairing.value.open"
        class="mt-1 text-xs text-slate-600 dark:text-slate-300"
      >
        {{ t('external.discovery.openHint') }}
      </p>
      <p
        v-if="admin.pairing.value.openUntil"
        class="mt-1 text-xs text-slate-500 dark:text-slate-400"
      >
        {{
          t('external.discovery.openUntil', {
            at: dates.time(admin.pairing.value.openUntil),
          })
        }}
      </p>

      <!-- Ignoring is reversible, so the ignored list must be reachable. -->
      <div class="mt-3">
        <SegmentedControl
          :model-value="admin.candidateFilter.value"
          :aria-label="t('external.discovery.title')"
          size="sm"
          :options="[
            { value: 'waiting', label: t('external.discovery.filterWaiting') },
            { value: 'ignored', label: t('external.discovery.filterIgnored') },
          ]"
          @update:model-value="(v: 'waiting' | 'ignored') => admin.setFilter(v)"
        />
      </div>

      <!-- An open window with nothing in it is a WAIT, not an empty state:
           containers announce every ~20s, so something may well arrive in a
           moment. The spinner says "listening" instead of "nothing here" —
           but only for the waiting list; an empty ignore list is just empty. -->
      <div
        v-if="
          admin.candidates.value.length === 0 &&
          admin.candidateFilter.value === 'waiting'
        "
        class="mt-3 flex items-center gap-3"
      >
        <Spinner />
        <p class="text-sm text-slate-600 dark:text-slate-300">
          {{ t('external.discovery.waitingHint') }}
        </p>
      </div>
      <p
        v-else-if="admin.candidates.value.length === 0"
        class="mt-3 text-sm text-slate-600 dark:text-slate-300"
      >
        {{ t('external.discovery.noneIgnored') }}
      </p>

      <article
        v-for="candidate in admin.candidates.value"
        :key="candidate.id"
        class="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/5"
      >
        <div class="flex flex-wrap items-center gap-2">
          <component
            :is="admin.iconOf(candidate.manifest)"
            class="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500"
            aria-hidden="true"
          />
          <span class="text-sm font-medium text-slate-900 dark:text-white">
            {{ admin.pluginName(candidate.manifest) }}
          </span>
          <!-- Everything on this card is the container's own claim until the
               code is typed; say so rather than presenting it as fact. -->
          <Badge tone="neutral">
            {{ t('external.discovery.selfAsserted') }}
          </Badge>
          <span class="text-xs text-slate-500 dark:text-slate-400">
            {{ candidate.pluginId }} · {{ candidate.manifest.version }} ·
            {{ candidate.baseUrl }}
            <template v-if="candidate.sourceIp">
              · {{ t('external.discovery.from', { ip: candidate.sourceIp }) }}
            </template>
          </span>
        </div>

        <p
          v-if="candidate.conflictsWithInstalled"
          class="mt-2 text-xs text-red-700 dark:text-red-400"
        >
          {{ t('external.discovery.conflict') }}
        </p>

        <!-- Permissions are shown BEFORE pairing too: an admin should know
             what this container will ask for while deciding if it is theirs. -->
        <ul
          v-if="candidate.manifest.permissions.length > 0"
          class="mt-2 space-y-1"
        >
          <li
            v-for="perm in candidate.manifest.permissions"
            :key="perm"
            class="text-xs text-slate-600 dark:text-slate-400"
          >
            {{ admin.permissionLabel(perm) }}
          </li>
        </ul>

        <!-- An ignored candidate offers only the way back, or out for good:
             pairing one would defeat the point of having ignored it. -->
        <div v-if="candidate.ignored" class="mt-3 flex flex-wrap gap-2">
          <Button
            :disabled="admin.busy.value === candidate.id"
            @click="admin.setIgnored(candidate, false)"
          >
            {{ t('external.discovery.unignore') }}
          </Button>
          <Button
            variant="ghost"
            :disabled="admin.busy.value === candidate.id"
            @click="admin.dismissCandidate(candidate)"
          >
            {{ t('external.discovery.forget') }}
          </Button>
        </div>

        <div v-else class="mt-3 flex flex-wrap items-end gap-2">
          <label class="flex flex-col gap-1" :for="`code-${candidate.id}`">
            <span
              class="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500"
            >
              {{ t('external.discovery.codeLabel') }}
            </span>
            <input
              :id="`code-${candidate.id}`"
              :value="codeFor[candidate.id] ?? ''"
              inputmode="numeric"
              autocomplete="off"
              maxlength="4"
              class="glass-input w-56 rounded-xl px-3 py-2 text-center font-mono text-lg tracking-widest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              @input="setCode(candidate, inputValue($event))"
              @keyup.enter="pair(candidate)"
            />
          </label>
          <Button
            :disabled="
              admin.busy.value === candidate.id ||
              !(codeFor[candidate.id] ?? '').trim()
            "
            @click="pair(candidate)"
          >
            {{ t('external.discovery.pairAction') }}
          </Button>
          <!-- Ignore, not dismiss: a deleted card returns on the container's
               next announce, seconds later. -->
          <Button
            variant="ghost"
            :disabled="admin.busy.value === candidate.id"
            @click="admin.setIgnored(candidate, true)"
          >
            {{ t('external.discovery.ignore') }}
          </Button>
        </div>
      </article>
    </div>

    <!-- The second way in. A generate button on its own says nothing about
         what the token installs or what to do with it — the card is the
         explanation, and the button is its last line. -->
    <div
      class="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/5"
    >
      <h3
        class="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"
      >
        <KeyRound
          class="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
          aria-hidden="true"
        />
        {{ t('external.installToken.title') }}
      </h3>
      <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">
        {{ t('external.installToken.purpose') }}
      </p>
      <ol
        class="mt-3 list-decimal space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-300"
      >
        <li>{{ t('external.installToken.step1') }}</li>
        <li>{{ t('external.installToken.step2') }}</li>
        <li>{{ t('external.installToken.step3') }}</li>
      </ol>
      <div class="mt-4">
        <Button variant="secondary" @click="generateInstallToken">
          <KeyRound class="h-4 w-4" aria-hidden="true" />
          {{ t('external.installToken.generate') }}
        </Button>
      </div>
    </div>

    <!-- One-time install token -->
    <Modal v-model="installOpen" :title="t('external.installToken.title')">
      <p class="text-sm text-slate-600 dark:text-slate-300">
        {{ t('external.installToken.hint') }}
      </p>
      <CopyField
        class="mt-3"
        :value="installValue"
        :aria-label="t('external.installToken.title')"
        @copied="onTokenCopied"
      />
      <div class="mt-4 flex justify-end">
        <Button @click="copyInstallToken">
          {{ t('external.installToken.copyAndClose') }}
        </Button>
      </div>
    </Modal>
  </SectionShell>
</template>
