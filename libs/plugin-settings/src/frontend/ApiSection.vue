<script setup lang="ts">
import { computed, onDeactivated, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RouteLocationRaw } from 'vue-router';
import { BookOpen, Eye, EyeOff, Blocks, ExternalLink } from '@lucide/vue';
import {
  API_DOCS_PATH,
  API_LOGIN_PATH,
  type ApiInfo,
} from '@makekeeper/plugin-contract';
import {
  Button,
  CopyField,
  Spinner,
  apiJson,
  getStoredToken,
  useResource,
  usePluginsStore,
  useSessionStore,
} from '@makekeeper/frontend-core';

// Settings → General → API (#282). The instance has a full REST API and
// interactive docs and said so nowhere: the address, the docs and the token
// were three things you had to read the source to learn — while the one token
// the UI DID show (the external-plugin install token) is a different family
// entirely and does not authenticate an API call. One section answers all of
// it. The frame (heading, description, card) belongs to the host page, exactly
// as it does for a plugin's own settings panel.
const { t } = useI18n();
const session = useSessionStore();
const plugins = usePluginsStore();

// The install token this section disowns lives in the Connect section of the
// External plugins page (#262), which is not that page's default — landing on
// the page and then hunting for the token is the same confusion one step later.
// A path, not a route name: the destination belongs to another plugin, and a
// name it may not have registered would make the link throw rather than
// degrade (§5.10 — no cross-plugin import either way). The section key is that
// page's own query value; if it is ever renamed the link degrades to the page
// default rather than breaking, which is why a raw path is tolerable here.
const EXTERNAL_CONNECT_ROUTE = {
  path: '/settings/external',
  query: { section: 'connect' },
} satisfies RouteLocationRaw;

// The page sends the address it is itself open on. The browser is the only
// party that knows it intact — scheme, host AND port — while every hop in
// between can drop a piece of it (nginx's `$host` drops the port). The server
// still outranks it with an explicit PUBLIC_BASE_URL, and falls back to the
// forwarded headers when no origin arrives; it answers with which of the three
// it used, so the page can say so.
const info = useResource<ApiInfo>(
  (signal) =>
    apiJson<ApiInfo>(
      `/api/settings/api-info?origin=${encodeURIComponent(window.location.origin)}`,
      { signal },
    ),
  { errorFallback: () => t('settings.api.loadFailed') },
);

// Only the address itself comes from the endpoint. Everything else on this
// screen — the token, its facts, which token is which — is known to the
// browser alone, so a failed request costs the address and nothing more.
const details = computed<ApiInfo | null>(() => info.data.value ?? null);

const docsUrl = computed<string>(() =>
  details.value ? `${details.value.baseUrl}${API_DOCS_PATH}` : '',
);

// The login call an owner pastes into a terminal, with THIS instance's address
// already in it — a curl with a placeholder host is a curl that gets run
// verbatim and fails. Assembled here rather than held whole in the locale
// files: everything but the two placeholders is a technical identifier, and a
// JSON body inside a message string would collide with the interpolation
// syntax. The credentials are the only words in it, so they are the only keys.
const loginCommand = computed<string>(() => {
  if (!details.value) return '';
  const body = JSON.stringify({
    username: t('settings.api.obtain.usernamePlaceholder'),
    password: t('settings.api.obtain.passwordPlaceholder'),
  });
  return `curl -X POST ${details.value.baseUrl}${API_LOGIN_PATH} -H 'Content-Type: application/json' -d '${body}'`;
});

// Lifetime as one legible value. Sub-day TTLs are an explicit JWT_TTL choice,
// so they are worth reporting exactly rather than rounding to "0 days".
const lifetime = computed<string>(() => {
  const seconds = details.value?.tokenTtlSeconds ?? 0;
  return seconds % 86400 === 0
    ? t('settings.api.token.lifetimeDays', { days: seconds / 86400 })
    : t('settings.api.token.lifetimeHours', {
        hours: Math.round(seconds / 3600),
      });
});

// Never rendered unasked: the token is on screen only after the owner presses
// for it, so it does not ride along into a screenshot or a shared screen. The
// page is kept alive between sections, so leaving it re-hides the value —
// otherwise one press would keep the token on screen for the whole session.
const revealed = ref(false);
onDeactivated(() => (revealed.value = false));

const token = computed<string | null>(() => getStoredToken());
</script>

<template>
  <div v-if="info.loading.value" class="flex justify-center py-6">
    <Spinner />
  </div>

  <!-- One card, four subjects: address, token, how to get one, and which token
       is which. The rules between them do the separating a stack of cards used
       to — this is a section of a page now, not a page. The first and last
       sections drop their outer padding so the card's own padding is not
       doubled at either end, whichever sections happen to render. -->
  <div
    v-else
    class="divide-y divide-slate-200 dark:divide-white/10 [&>section:first-child]:pt-0 [&>section:last-child]:pb-0"
  >
    <section class="space-y-3 py-6">
      <h3 class="text-sm font-semibold text-slate-900 dark:text-white">
        {{ $t('settings.api.endpoint.title') }}
      </h3>
      <p class="text-xs text-slate-600 dark:text-slate-300">
        {{ $t('settings.api.endpoint.description') }}
      </p>
      <template v-if="details">
        <CopyField
          :value="details.baseUrl"
          :aria-label="$t('settings.api.endpoint.copyLabel')"
        />
        <!-- Where the address came from, as a plain fact: behind a proxy the
             origin the browser used and the one the server publishes can
             differ, and only the latter works in a script. -->
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t(`settings.api.endpoint.source.${details.baseUrlSource}`) }}
        </p>
        <div class="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            :href="docsUrl"
            :icon-left="BookOpen"
            :icon-right="ExternalLink"
          >
            {{ $t('settings.api.endpoint.openDocs') }}
          </Button>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('settings.api.endpoint.docsHint') }}
          </p>
        </div>
      </template>
      <p v-else class="text-sm text-slate-500 dark:text-slate-400">
        {{ info.error.value ?? $t('settings.api.loadFailed') }}
      </p>
    </section>

    <section class="space-y-3 py-6">
      <h3 class="text-sm font-semibold text-slate-900 dark:text-white">
        {{ $t('settings.api.token.title') }}
      </h3>
      <p class="text-xs text-slate-600 dark:text-slate-300">
        {{ $t('settings.api.token.description') }}
      </p>

      <!-- With the multi-user overlay off nothing authenticates a call, so a
           token would be a thing to look for that does not exist. -->
      <p
        v-if="!session.multiuserEnabled"
        class="text-sm text-slate-600 dark:text-slate-300"
      >
        {{ $t('settings.api.token.noAuth') }}
      </p>

      <template v-else>
        <Button
          v-if="!revealed"
          variant="secondary"
          size="sm"
          :icon-left="Eye"
          @click="revealed = true"
        >
          {{ $t('settings.api.token.reveal') }}
        </Button>
        <template v-else-if="token">
          <CopyField
            :value="token"
            :aria-label="$t('settings.api.token.copyLabel')"
          />
          <Button
            variant="ghost"
            size="sm"
            :icon-left="EyeOff"
            @click="revealed = false"
          >
            {{ $t('settings.api.token.hide') }}
          </Button>
        </template>
        <p v-else class="text-sm text-slate-500 dark:text-slate-400">
          {{ $t('settings.api.token.missing') }}
        </p>

        <ul
          class="list-disc space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-300"
        >
          <li>{{ $t('settings.api.token.facts.lifetime', { lifetime }) }}</li>
          <li>{{ $t('settings.api.token.facts.revocation') }}</li>
          <!-- The hour-costing one: a session token carries no #63 session key,
               so an external client cannot re-arm the DEK after a backend
               restart and secret-reading endpoints go partly dark. -->
          <li>{{ $t('settings.api.token.facts.sessionKey') }}</li>
        </ul>
      </template>
    </section>

    <section v-if="session.multiuserEnabled" class="space-y-3 py-6">
      <h3 class="text-sm font-semibold text-slate-900 dark:text-white">
        {{ $t('settings.api.obtain.title') }}
      </h3>
      <p class="text-xs text-slate-600 dark:text-slate-300">
        {{ $t('settings.api.obtain.description') }}
      </p>
      <!-- Three routes to one value, enumerated by the list rather than by the
           words: the "or" between them and the colon before the command are
           framing, and framing is the component's job (§5.4). -->
      <ol
        class="list-decimal space-y-3 pl-5 text-xs text-slate-600 dark:text-slate-300"
      >
        <li>{{ $t('settings.api.obtain.here') }}</li>
        <li v-if="details" class="space-y-2">
          <p>{{ $t('settings.api.obtain.curl') }}</p>
          <CopyField
            :value="loginCommand"
            :aria-label="$t('settings.api.obtain.copyCommandLabel')"
          />
        </li>
        <li>{{ $t('settings.api.obtain.swagger') }}</li>
      </ol>
    </section>

    <!-- The confusion that motivated the ticket — but only where the other
         family of tokens actually exists (§5.10: gated on the store, no
         cross-plugin import). -->
    <section v-if="plugins.isEnabled('external')" class="space-y-3 pt-6">
      <h3 class="text-sm font-semibold text-slate-900 dark:text-white">
        {{ $t('settings.api.otherTokens.title') }}
      </h3>
      <p class="text-xs text-slate-600 dark:text-slate-300">
        {{ $t('settings.api.otherTokens.description') }}
      </p>
      <Button
        variant="secondary"
        size="sm"
        :icon-left="Blocks"
        :to="EXTERNAL_CONNECT_ROUTE"
      >
        {{ $t('settings.api.otherTokens.open') }}
      </Button>
    </section>
  </div>
</template>
