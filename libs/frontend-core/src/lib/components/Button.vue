<script setup lang="ts">
import { computed, type Component } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { Loader } from '@lucide/vue';

// The single button primitive. Encapsulates the app's canonical primary /
// secondary / danger styling so the ~dozen hand-classed button variants across
// plugins converge on one look, one radius and one focus treatment.
// `overlay` / `overlayScrim` are the chrome of a full-bleed media surface (the
// #117 lightbox): always-dark backdrop, so they are the one pair that does NOT
// carry a `dark:` counterpart — there is no light variant of a photo viewer.
// `overlayScrim` differs by bringing its own scrim, for a control that sits on
// top of the picture rather than beside it, where a bare white glyph would
// vanish against a light photo.
// `dangerGhost` is destructive-but-quiet: the same transparent box as `ghost`
// until you reach it, then red. `danger` carries a permanent red tint and a
// border, which is right for a lone Delete on a detail panel and far too loud
// for a row of per-item actions — there it shouts over the row it belongs to.
// `ai` is reserved for an action that CALLS A MODEL. It wears the SAME aurora
// the multiuser mode icon wears (`bg-mode-aurora`, white glyph, soft lift) —
// deliberately not a second treatment invented for this button: "the iridescent
// one" is already the app's word for a capability that is more than an ordinary
// control, and two dialects of it would only blur that.
// `link` is the quietest of all: no box at all, ever — brand-coloured text that
// underlines on approach. For a control that READS as a link because it takes
// you somewhere (a fold, a section) while having to be a `button` to do it.
// `ghost` still owns "a button that waits its turn"; `link` owns "not a button
// at all", which is why it keeps no hover fill to fall back on.
type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'dangerGhost'
  | 'ghost'
  | 'link'
  | 'ai'
  | 'overlay'
  | 'overlayScrim';
// `icon` is square padding for an icon-only button — the text sizes leave a
// lopsided box once the label is gone. `icon-sm` is its list-row counterpart:
// a 44px target next to a `sm` text button reads as a mistake, and the pattern
// hand-rolled across InventoryView/LogisticsView is exactly this size.
type ButtonSize = 'sm' | 'md' | 'icon' | 'icon-sm';

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    loading?: boolean;
    // Like `loading`, but the button stays clickable: for a long-lived
    // background state the button itself ends (a live phone-bridge session whose
    // trigger doubles as "Done"), where disabling would trap the user.
    busy?: boolean;
    block?: boolean;
    // Fully round instead of the standard `rounded-xl`. For an icon-only
    // control floating over content, where the pill reads as its own affordance.
    pill?: boolean;
    iconLeft?: Component;
    iconRight?: Component;
    // Required for icon-only buttons (empty default slot) so AT has a name.
    ariaLabel?: string;
    // Renders a `RouterLink` wearing the button's clothes. A control that
    // NAVIGATES is a link — it must be middle-clickable, openable in a new tab
    // and announced as a link — but it should not therefore be hand-classed to
    // imitate this component, which is how the look drifts. One prop keeps the
    // semantics honest and the styling in one place.
    to?: RouteLocationRaw;
    // The same idea for an address OUTSIDE the SPA's router — the Swagger docs
    // at `/api/docs`, a release page. `to` cannot express it (vue-router would
    // try to match a route and refuse), and hand-classing an `<a>` to look like
    // this component is how the look drifts. Opens in a new tab: leaving the
    // app is a departure, not a navigation. Ignored when `to` is given.
    href?: string;
  }>(),
  {
    variant: 'primary',
    size: 'md',
    type: 'button',
    disabled: false,
    loading: false,
    busy: false,
    block: false,
    pill: false,
    iconLeft: undefined,
    iconRight: undefined,
    ariaLabel: undefined,
    to: undefined,
    href: undefined,
  },
);

const variantClass = computed<string>(() => {
  const map = {
    primary:
      'bg-brand-600 hover:bg-brand-700 text-white shadow-lg shadow-brand-600/10 focus-visible:ring-brand-500/40',
    secondary:
      'bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-slate-200 focus-visible:ring-brand-500/40',
    danger:
      'bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20 focus-visible:ring-red-500/40',
    dangerGhost:
      'bg-transparent hover:bg-red-500/10 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 focus-visible:ring-red-500/40',
    ghost:
      'bg-transparent hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-slate-300 focus-visible:ring-brand-500/40',
    link: 'bg-transparent text-brand-600 hover:text-brand-700 hover:underline underline-offset-4 dark:text-brand-400 dark:hover:text-brand-300 focus-visible:ring-brand-500/40',
    // The transparent 2px contour is optical, not decorative: a saturated
    // multicolour tile reads LARGER than the muted flat ones beside it at the
    // same measurements. `bg-clip-padding` is what makes the border genuinely
    // empty — without it the background paints under the border by default and
    // the aurora simply runs to the edge as before, contour or no contour.
    ai: 'bg-mode-aurora bg-clip-padding border-2 border-transparent text-white shadow-md focus-visible:ring-fuchsia-500/40',
    overlay:
      'bg-transparent hover:bg-white/10 text-white/80 hover:text-white focus-visible:ring-white/60',
    overlayScrim:
      'bg-black/40 hover:bg-black/60 text-white focus-visible:ring-white/60',
  } satisfies Record<ButtonVariant, string>;
  return map[props.variant];
});

const sizeClass = computed<string>(() => {
  const map = {
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2.5 text-sm gap-2',
    // 44 px square at the default icon size — the minimum comfortable touch
    // target, which matters most for exactly the controls that lose their label.
    icon: 'p-3',
    // Deliberately under the touch minimum: a dense list row cannot spare 44px
    // per action, and every use of it sits beside a whole row that is itself
    // the primary tap target.
    'icon-sm': 'p-2',
  } satisfies Record<ButtonSize, string>;
  return map[props.size];
});

const iconSizeClass = computed<string>(() => {
  const map = {
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    icon: 'w-5 h-5',
    'icon-sm': 'w-4 h-4',
  } satisfies Record<ButtonSize, string>;
  return map[props.size];
});

const isDisabled = computed<boolean>(() => props.disabled || props.loading);

// A disabled link is not a thing the browser has, so a link asked to be
// disabled falls back to a real (disabled) button rather than pretending.
const rendersLink = computed<boolean>(
  () => props.to !== undefined && !isDisabled.value,
);

// Same rule for the external address: disabled means it must not be a link.
const rendersAnchor = computed<boolean>(
  () => props.to === undefined && props.href !== undefined && !isDisabled.value,
);

const tag = computed<typeof RouterLink | 'a' | 'button'>(() => {
  if (rendersLink.value) return RouterLink;
  return rendersAnchor.value ? 'a' : 'button';
});

// Only the attributes the chosen tag actually owns (#284). Binding the other
// branches' attributes to `undefined` is NOT the same as omitting them: on the
// `RouterLink` branch an `href` of `undefined` still arrives as a fall-through
// attribute and ERASES the href the router had just computed, leaving an anchor
// that neither navigates nor reads as a link — the browser paints the I-beam
// over a hrefless `<a>`, so the button read as prose too. One object per tag
// keeps that impossible.
const tagAttrs = computed<Record<string, unknown>>(() => {
  if (rendersLink.value) return { to: props.to };
  if (rendersAnchor.value) {
    // Leaving the app is a departure, not a navigation — and the opener stays
    // detached.
    return { href: props.href, target: '_blank', rel: 'noopener noreferrer' };
  }
  return { type: props.type, disabled: isDisabled.value };
});

// (The base class below states `cursor-pointer` for the same reason it states
// the rest of the look: Tailwind's preflight hands the pointer to `button`
// alone, leaving both link branches to the user agent. `select-none` is that
// idea applied to the label — a control's text is not a passage to
// drag-select.)

// Either flag shows the spinner; only `loading` also blocks interaction.
const showsSpinner = computed<boolean>(() => props.loading || props.busy);
</script>

<template>
  <component
    :is="tag"
    v-bind="tagAttrs"
    :aria-label="ariaLabel"
    :aria-busy="showsSpinner"
    class="inline-flex cursor-pointer select-none items-center justify-center font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
    :class="[
      variantClass,
      sizeClass,
      pill ? 'rounded-full' : 'rounded-xl',
      block ? 'w-full' : '',
    ]"
  >
    <Loader
      v-if="showsSpinner"
      class="animate-spin shrink-0"
      :class="iconSizeClass"
    />
    <component
      :is="iconLeft"
      v-else-if="iconLeft"
      class="shrink-0"
      :class="iconSizeClass"
    />
    <slot />
    <component
      :is="iconRight"
      v-if="iconRight && !loading"
      class="shrink-0"
      :class="iconSizeClass"
    />
  </component>
</template>
