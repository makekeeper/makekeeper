<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  AnchoredPopover,
  Badge,
  useSessionStore,
} from '@makekeeper/frontend-core';
import type { ScopeInfo } from '@makekeeper/plugin-contract';
import { Check, LogOut, Share2, ShieldCheck } from '@lucide/vue';

// Header user menu: current account, scope switcher (own + shared-to-me,
// read-only scopes badged), sharing shortcut and logout. Replaces the shell's
// former static avatar circle.
const session = useSessionStore();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

const initial = computed(() => {
  const name = session.user?.displayName || session.user?.username || '?';
  return name.charAt(0).toUpperCase();
});

const activeScopeId = computed(
  () => session.activeScope?.scopeId ?? session.user?.id,
);

const isActive = (scope: ScopeInfo): boolean =>
  scope.scopeId === activeScopeId.value;

const pick = (scope: ScopeInfo): void => {
  open.value = false;
  if (!isActive(scope)) session.switchScope(scope.scopeId);
};

const logout = (): void => {
  open.value = false;
  session.logout();
  // Full reload on purpose (same rationale as switchScope): dozens of views
  // hold component-local fetched state from the signed-in session; a hard
  // navigation guarantees it is purged before the next account signs in, which
  // a router.push would not do.
  window.location.assign('/login');
};
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      :aria-label="$t('multiuser.menu.openMenu')"
      :aria-expanded="open"
      class="w-8 h-8 rounded-full bg-brand-500/15 border border-brand-500/30 flex items-center justify-center font-bold text-brand-700 dark:text-brand-300 text-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      @click="open = !open"
    >
      {{ initial }}
    </button>

    <!-- Teleported out (#274): the header caps its descendants at z-30 while
         the sidebar sits at z-40, so an in-place menu slides under the sidebar
         whenever the avatar is pushed close enough to it. -->
    <AnchoredPopover :open="open" :anchor="root" @close="open = false">
      <div class="w-72 glass-card rounded-2xl shadow-xl py-2 animate-scale-in">
        <!-- Current account -->
        <div class="px-4 py-2 border-b border-slate-100 dark:border-white/5">
          <div class="flex items-center gap-2">
            <span
              class="text-sm font-bold text-slate-900 dark:text-white truncate"
            >
              {{ session.user?.displayName || session.user?.username }}
            </span>
            <Badge v-if="session.isAdmin" tone="brand">
              <ShieldCheck class="w-3 h-3 mr-0.5 inline" />
              {{ $t('multiuser.menu.admin') }}
            </Badge>
          </div>
          <p class="text-xs text-slate-500 dark:text-slate-400 truncate">
            {{ session.user?.username }}
          </p>
        </div>

        <!-- Shell-provided extras (the header's collapsed controls, #274) sit
           above the workspaces section. The plugin knows nothing about what
           the shell puts here — it only offers the spot. -->
        <slot name="extra" />

        <!-- Scope switcher -->
        <div class="px-2 py-2 border-b border-slate-100 dark:border-white/5">
          <p
            class="px-2 pb-1 text-xxs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500"
          >
            {{ $t('multiuser.menu.scopes') }}
          </p>
          <button
            v-for="scope in session.scopes"
            :key="scope.scopeId"
            type="button"
            class="w-full flex items-center gap-2 px-2 py-2 rounded-xl text-left text-sm transition-colors hover:bg-slate-100 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            @click="pick(scope)"
          >
            <Check
              class="w-4 h-4 shrink-0"
              :class="isActive(scope) ? 'text-brand-500' : 'text-transparent'"
            />
            <span class="truncate text-slate-700 dark:text-slate-200">
              {{
                scope.accessLevel === 'OWNER'
                  ? $t('multiuser.menu.myScope')
                  : $t('multiuser.menu.sharedBy', { name: scope.ownerName })
              }}
            </span>
            <Badge
              v-if="scope.accessLevel === 'READ'"
              tone="warning"
              class="ml-auto"
            >
              {{ $t('multiuser.menu.readOnly') }}
            </Badge>
          </button>
        </div>

        <!-- Actions -->
        <div class="px-2 pt-2 space-y-0.5">
          <RouterLink
            to="/access/sharing"
            class="flex items-center gap-2 px-2 py-2 rounded-xl text-sm text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-100 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            @click="open = false"
          >
            <Share2 class="w-4 h-4" />
            {{ $t('multiuser.menu.sharing') }}
          </RouterLink>
          <button
            type="button"
            class="w-full flex items-center gap-2 px-2 py-2 rounded-xl text-left text-sm text-red-600 dark:text-red-400 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            @click="logout"
          >
            <LogOut class="w-4 h-4" />
            {{ $t('multiuser.menu.logout') }}
          </button>
        </div>
      </div>
    </AnchoredPopover>
  </div>
</template>
