import { computed, onBeforeUnmount, ref, watchEffect, type Ref } from 'vue';

// The phone shell's screen header, as driven by a SCREEN rather than by its
// route.
//
// The shell normally reads the header off route meta, which is right for a
// screen whose title is a constant. Two things are not: a part's detail screen,
// titled by the part, and the intake view's form faces, which live at one route
// under different `?phase=` values and cannot each carry static meta.
//
// Everything a screen declares here is rendered by the same bar, at the same
// sizes, as the route-meta one — the point is one header, two ways to fill it,
// never a second header.
export interface MobileScreenChrome {
  // Shown as the screen title.
  title?: string | null;
  // The line under it, where the screen needs to say what it is for.
  subtitle?: string | null;
  // The screen this face sits inside. Names the arrow — the shell reads the
  // label off the tab that owns the path — and its absence means no arrow.
  backTo?: string;
  // How to leave, when leaving is not an ordinary navigation.
  //
  // A face pushed a history entry to get here, so leaving must POP it. Replacing
  // it with the screen behind — which is what this used to do — leaves the stack
  // holding two identical adjacent entries, and then the first back press moves
  // through history without changing anything on screen. Press again and you are
  // two screens away from where you meant to be; that is the bug this exists to
  // stop, reported as "swiping out of the form lands in Stock".
  //
  // Cleanup does NOT belong here — the swipe gesture calls no handler, so
  // anything hung off this leaks. It belongs to the phase transition, which the
  // gesture and this arrow both go through.
  back?: () => void;
}

// Module-level: exactly one phone screen is on top at a time, and the shell is
// its only reader.
const current = ref<MobileScreenChrome | null>(null);

export const mobileScreenChrome = computed<MobileScreenChrome | null>(
  () => current.value,
);

// Declare this screen's header for as long as the component lives. `source`
// returns null to fall back to the route's own meta.
export function useMobileScreenChrome(
  source: () => MobileScreenChrome | null,
): Ref<MobileScreenChrome | null> {
  watchEffect(() => {
    current.value = source();
  });
  // Left behind, the bar would title a screen that is gone.
  onBeforeUnmount(() => {
    current.value = null;
  });
  return current;
}
