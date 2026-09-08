import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, provide, ref } from 'vue';
import { i18n } from '../i18n';
import HeaderOverflowBadge from './HeaderOverflowBadge.vue';
import { HEADER_OVERFLOW } from './header-overflow';
import {
  useDialogPresence,
  usePreferencesStore,
} from '@makekeeper/frontend-core';
import type { HeaderOverflowContext } from './header-overflow';

// The one-time lesson about where the header's controls went is spendable
// exactly once per profile (#351): it must not be spent on a screen the reader
// is not looking at, i.e. while a dialog covers the page.
const collapsedCount = ref(0);

const context = {
  register: () => undefined,
  unregister: () => undefined,
  isCollapsed: () => false,
  isCompact: () => false,
  attachPanel: () => undefined,
  detachPanel: () => undefined,
  panelBody: ref<HTMLElement | null>(null),
  collapsedCount,
} satisfies HeaderOverflowContext;

// One pinia per test, created in `beforeEach`, so the stores a test drives are
// the ones the component reads.
let pinia = createPinia();

// A stand-in for any dialog: presence is announced by mounting one, exactly as
// `Modal` and `ImageLightbox` do, so the test exercises the real seam.
const Dialog = defineComponent({
  setup() {
    useDialogPresence(() => true);
    return () => h('div');
  },
});

// Everything mounted by a test is torn down after it: these components teleport
// into <body>, and a wrapper left mounted would both leak its popover into the
// next test's reading of the document and crash on a body cleared under it.
const mounted: { unmount: () => void }[] = [];

const openDialog = () => {
  const wrapper = mount(Dialog);
  mounted.push(wrapper);
  return wrapper;
};

// Provided through a host component rather than the mount option: `provide()`
// takes the `InjectionKey` as it is typed, where the option's record wants a
// plain symbol and would need the key cast to reach it.
const Host = defineComponent({
  setup() {
    provide(HEADER_OVERFLOW, context);
    return () => h(HeaderOverflowBadge);
  },
});

const mountBadge = () => {
  const wrapper = mount(Host, { global: { plugins: [pinia, i18n] } });
  mounted.push(wrapper);
  return wrapper;
};

// The coachmark is the popover's only content, and the popover teleports to
// <body> — so "is it on screen" is asked of the document, not the wrapper.
const coachmarkShown = (): boolean =>
  document.body.textContent?.includes(i18n.global.t('header.overflowHint')) ===
  true;

describe('HeaderOverflowBadge', () => {
  beforeEach(() => {
    localStorage.clear();
    collapsedCount.value = 0;
    pinia = createPinia();
    setActivePinia(pinia);
    vi.useFakeTimers();
  });

  afterEach(() => {
    while (mounted.length > 0) mounted.pop()?.unmount();
    vi.useRealTimers();
  });

  it('teaches once on the first collapse', async () => {
    mountBadge();
    collapsedCount.value = 1;
    await nextTick();

    expect(coachmarkShown()).toBe(true);
    expect(usePreferencesStore().headerOverflowCoached).toBe(true);
  });

  it('does not teach — or spend the lesson — while a dialog is open', async () => {
    mountBadge();
    openDialog();
    collapsedCount.value = 1;
    await nextTick();

    expect(coachmarkShown()).toBe(false);
    expect(usePreferencesStore().headerOverflowCoached).toBe(false);
  });

  // The #351 repro exactly: the header collapses behind a dialog and is still
  // collapsed when it closes, so the count's rising edge never comes round
  // again. Waiting for one would defer the lesson until the window happened to
  // be widened and renarrowed — which for most readers is never.
  it('teaches as soon as the dialog closes, with the header still collapsed', async () => {
    mountBadge();
    const dialog = openDialog();
    collapsedCount.value = 1;
    await nextTick();
    expect(coachmarkShown()).toBe(false);

    dialog.unmount();
    await nextTick();

    expect(coachmarkShown()).toBe(true);
    expect(usePreferencesStore().headerOverflowCoached).toBe(true);
  });

  it('teaches on a later collapse when the header reopened meanwhile', async () => {
    mountBadge();
    const dialog = openDialog();
    collapsedCount.value = 1;
    await nextTick();

    collapsedCount.value = 0;
    await nextTick();
    dialog.unmount();
    await nextTick();
    expect(coachmarkShown()).toBe(false);

    collapsedCount.value = 2;
    await nextTick();

    expect(coachmarkShown()).toBe(true);
    expect(usePreferencesStore().headerOverflowCoached).toBe(true);
  });

  // The flag is written when the coachmark goes on screen, which is not yet
  // the moment it was read. A dialog opening on top of it takes the reader's
  // attention away after a glimpse, so the lesson goes back with it.
  it('gives the lesson back when a dialog cuts the coachmark short', async () => {
    mountBadge();
    collapsedCount.value = 1;
    await nextTick();
    expect(coachmarkShown()).toBe(true);
    expect(usePreferencesStore().headerOverflowCoached).toBe(true);

    const dialog = openDialog();
    await nextTick();

    expect(coachmarkShown()).toBe(false);
    expect(usePreferencesStore().headerOverflowCoached).toBe(false);

    dialog.unmount();
    await nextTick();

    expect(coachmarkShown()).toBe(true);
    expect(usePreferencesStore().headerOverflowCoached).toBe(true);
  });
});
