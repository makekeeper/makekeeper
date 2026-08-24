<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { BrandMark, Button, useSessionStore } from '@makekeeper/frontend-core';
import { LogIn, UserPlus } from '@lucide/vue';
import { useCredentialsForm } from './credentials-form';

// Bare full-screen page (meta.fullscreen) — the shell renders no sidebar here.
// Register-first UX: on a fresh enable (no users yet) the register tab opens
// with a hint that the first account becomes the administrator.
const route = useRoute();
const router = useRouter();
const session = useSessionStore();

type Tab = 'login' | 'register';

// The fields, the busy flag and the failure line are the same on the phone's
// sign-in screen — one composable owns all three (see credentials-form.ts).
const { username, password, error, busy, attempt } = useCredentialsForm(
  'multiuser.login.genericError',
);
const displayName = ref('');

// Register tab exists only while self-registration is open (the very first
// account — the admin bootstrap — is always allowed).
const canRegister = computed(
  () => !session.hasUsers || session.registrationAllowed,
);

// Active tab is route-driven (§5.3) — lives in route.query.tab, not a local
// ref — so a deep link / back-forward restores it. Defaults to register-first
// on a fresh install; clamped to login when registration is closed.
const tab = computed<Tab>(() => {
  if (!canRegister.value) return 'login';
  const q = route.query.tab;
  if (q === 'login' || q === 'register') return q;
  return session.hasUsers ? 'login' : 'register';
});

const showFirstAdminHint = computed(
  () => tab.value === 'register' && !session.hasUsers,
);

const switchTab = (next: Tab): void => {
  error.value = '';
  router.replace({ query: { ...route.query, tab: next } });
};

const submit = async (): Promise<void> => {
  await attempt(async () => {
    if (tab.value === 'login') {
      await session.login(username.value, password.value);
    } else {
      await session.register(
        username.value,
        password.value,
        displayName.value.trim() || undefined,
      );
    }
    router.push('/');
  });
};
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-md glass-card rounded-2xl p-8 space-y-6">
      <div class="flex items-center gap-3">
        <!-- The app signs itself here with the same lockup the sidebar wears
             (#260) — this is the first screen of the product, not a page about
             users, so it carries the brand mark rather than a people icon. -->
        <BrandMark size="lg" />
        <div>
          <h1 class="text-lg font-bold text-slate-900 dark:text-white">
            {{ $t('multiuser.login.title') }}
          </h1>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('multiuser.login.subtitle') }}
          </p>
        </div>
      </div>

      <!-- Tabs -->
      <div
        v-if="canRegister"
        class="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-white/5"
        role="tablist"
      >
        <button
          v-for="option in ['login', 'register'] as const"
          :key="option"
          type="button"
          role="tab"
          :aria-selected="tab === option"
          class="px-3 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          :class="
            tab === option
              ? 'bg-white dark:bg-dark-800 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          "
          @click="switchTab(option)"
        >
          {{ $t(`multiuser.login.tab.${option}`) }}
        </button>
      </div>

      <p
        v-if="showFirstAdminHint"
        class="text-xs rounded-xl px-4 py-3 bg-brand-500/10 text-brand-700 dark:text-brand-300"
      >
        {{ $t('multiuser.login.firstAdminHint') }}
      </p>
      <p
        v-if="!session.configOk"
        class="text-xs rounded-xl px-4 py-3 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      >
        {{ $t('multiuser.login.configWarning') }}
      </p>

      <form class="space-y-4" @submit.prevent="submit">
        <div class="space-y-1.5">
          <label
            for="mu-username"
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
          >
            {{ $t('multiuser.login.username') }}
          </label>
          <input
            id="mu-username"
            v-model="username"
            type="text"
            autocomplete="username"
            required
            minlength="3"
            class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
          />
        </div>

        <div class="space-y-1.5">
          <label
            for="mu-password"
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
          >
            {{ $t('multiuser.login.password') }}
          </label>
          <input
            id="mu-password"
            v-model="password"
            type="password"
            :autocomplete="
              tab === 'login' ? 'current-password' : 'new-password'
            "
            required
            :minlength="tab === 'register' ? 8 : undefined"
            class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
          />
          <p
            v-if="tab === 'register'"
            class="text-xxs text-slate-500 dark:text-slate-400"
          >
            {{ $t('multiuser.login.passwordHint') }}
          </p>
        </div>

        <div v-if="tab === 'register'" class="space-y-1.5">
          <label
            for="mu-display-name"
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
          >
            {{ $t('multiuser.login.displayName') }}
          </label>
          <input
            id="mu-display-name"
            v-model="displayName"
            type="text"
            autocomplete="name"
            class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
          />
        </div>

        <p v-if="error" class="text-xs text-red-600 dark:text-red-400">
          {{ error }}
        </p>

        <Button
          type="submit"
          block
          :loading="busy"
          :icon-left="tab === 'login' ? LogIn : UserPlus"
        >
          {{
            tab === 'login'
              ? $t('multiuser.login.signIn')
              : $t('multiuser.login.signUp')
          }}
        </Button>
      </form>
    </div>
  </div>
</template>
