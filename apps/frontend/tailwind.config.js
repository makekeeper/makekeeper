const { join } = require('path');
const plugin = require('tailwindcss/plugin');

module.exports = {
  darkMode: 'class',
  content: [
    join(__dirname, 'index.html'),
    join(__dirname, 'src/**/*.{vue,js,ts,jsx,tsx}'),
    // Plugin views and shared UI now live in libraries — Tailwind must scan
    // them too, otherwise their utility classes get purged from the bundle.
    join(__dirname, '../../libs/**/*.{vue,js,ts,jsx,tsx}'),
  ],
  theme: {
    extend: {
      fontFamily: {
        // The app's brand type stack — surfaced as a token so views can rely on
        // `font-sans` instead of a raw family string. Names match the self-hosted
        // @fontsource-variable builds imported in main.ts.
        sans: [
          'Outfit Variable',
          'Inter Variable',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        // The same stack with the display face taken out — Inter alone. For
        // type that has to survive being PRINTED small: a label's 7 pt line is
        // about 20 dots tall on a 203 dpi thermal head, where ink spreads into
        // its neighbours, and Inter's open apertures and even stroke hold up
        // there while Outfit's geometric counters close. Not a second brand
        // face: one stack, one purpose, declared once (#359).
        label: ['Inter Variable', 'system-ui', '-apple-system', 'sans-serif'],
      },
      letterSpacing: {
        // The label's two lines of type. Tokens rather than arbitrary values
        // because the PRINT path reads the tracking back off the rendered node
        // and scales it to the printhead (`label-raster.ts`), so this is a
        // contract between the screen and the sticker, not a one-off look.
        'label-brand': '0.18em',
        'label-code': '0.06em',
      },
      fontSize: {
        // Metadata/badge size used repo-wide; previously defined only in App.vue's
        // global <style>, which made it depend on App.vue always being mounted.
        xxs: ['0.7rem', { lineHeight: '1rem' }],
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'mode-sweep': {
          '0%': { width: '0%' },
          '100%': { width: '100%' },
        },
        // Multiuser enable effect (Siri-style): the whole spectrum slowly
        // cycles over the aurora gradients, so the orb and edge glow shimmer.
        'mode-hue': {
          '0%': { filter: 'hue-rotate(0deg)' },
          '100%': { filter: 'hue-rotate(360deg)' },
        },
        // Organic breathing of the orb while the blobs swirl inside it.
        'mode-breathe': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
        },
        // The say-hello card (#369): one 3.2s cycle shared by two movements
        // that take turns — the hand waves in the first half, the shine
        // crosses the card in the second — so they never compete for the eye.
        'hello-wave': {
          '0%, 50%, 100%': { transform: 'rotate(0deg)' },
          '8%': { transform: 'rotate(16deg)' },
          '16%': { transform: 'rotate(-10deg)' },
          '24%': { transform: 'rotate(14deg)' },
          '32%': { transform: 'rotate(-6deg)' },
          '40%': { transform: 'rotate(8deg)' },
        },
        'hello-sweep': {
          '0%, 40%': { transform: 'translateX(-100%)' },
          '85%, 100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out both',
        'scale-in': 'scale-in 0.15s ease-out both',
        // Progress sweep of the multiuser mode-transition overlay; duration
        // matches TRANSITION_MS in the plugin's transition store.
        'mode-sweep': 'mode-sweep 2.4s ease-in-out both',
        // Siri-style enable effect. Blob orbits reuse the stock `spin`
        // keyframes at organic, mutually prime speeds (some reversed) so the
        // composition never visibly repeats; swirl spins the aurora conic.
        'mode-swirl': 'spin 9s linear infinite',
        'mode-orbit-1': 'spin 3.1s linear infinite',
        'mode-orbit-2': 'spin 4.3s linear infinite reverse',
        'mode-orbit-3': 'spin 5.7s linear infinite',
        'mode-orbit-4': 'spin 6.9s linear infinite reverse',
        'mode-hue': 'mode-hue 6s linear infinite',
        'mode-breathe': 'mode-breathe 2.8s ease-in-out infinite',
        // Same duration on both, or the two halves drift apart (#369).
        'hello-wave': 'hello-wave 3.2s ease-in-out infinite',
        'hello-sweep': 'hello-sweep 3.2s ease-in-out infinite',
      },
      // A waving hand pivots near the wrist, not at its centre (#369).
      transformOrigin: {
        'hello-hand': '70% 80%',
      },
      backgroundImage: {
        // The iridescent spectrum (brand → violet → fuchsia → cyan → emerald).
        // Born for the multiuser transition — the orb halo and the screen-edge
        // glow, where hue-rotate animates it through the full spectrum — and
        // now also the fill of the `ai` button variant (#212): the recognition
        // button is meant to read as the same kind of thing as the mode icon,
        // so it wears the same gradient rather than a second one of its own.
        'mode-aurora':
          'conic-gradient(from 0deg, #3b82f6, #8b5cf6, #d946ef, #22d3ee, #34d399, #3b82f6)',
        // Its washed-out counterpart for disabling: the same swirl drained to
        // slate grays — the magic fading out.
        'mode-aurora-dim':
          'conic-gradient(from 0deg, #94a3b8, #64748b, #cbd5e1, #475569, #94a3b8)',
        // The band of light that crosses the say-hello card (#369). White on a
        // light surface; on a dark one, the scheme's own brand-400, so the
        // shine follows the colour scheme rather than glaring white.
        'hello-shine':
          'linear-gradient(105deg, transparent 35%, rgb(255 255 255 / 0.55) 50%, transparent 65%)',
        'hello-shine-dark':
          'linear-gradient(105deg, transparent 35%, rgb(var(--mk-brand-400) / 0.22) 50%, transparent 65%)',
      },
      colors: {
        // Both scheme-aware ramps resolve through CSS variables (#236): the
        // active colour scheme sets `data-scheme` on <html> and themes.css
        // supplies the channels. The `<alpha-value>` slot keeps opacity
        // utilities (`bg-brand-500/30`) working; class names never change.
        // The concrete default values (the pre-#236 hexes) live in themes.css.
        dark: {
          950: 'rgb(var(--mk-dark-950) / <alpha-value>)',
          900: 'rgb(var(--mk-dark-900) / <alpha-value>)',
          800: 'rgb(var(--mk-dark-800) / <alpha-value>)',
          700: 'rgb(var(--mk-dark-700) / <alpha-value>)',
          600: 'rgb(var(--mk-dark-600) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--mk-brand-500) / <alpha-value>)',
          50: 'rgb(var(--mk-brand-50) / <alpha-value>)',
          100: 'rgb(var(--mk-brand-100) / <alpha-value>)',
          200: 'rgb(var(--mk-brand-200) / <alpha-value>)',
          300: 'rgb(var(--mk-brand-300) / <alpha-value>)',
          400: 'rgb(var(--mk-brand-400) / <alpha-value>)',
          500: 'rgb(var(--mk-brand-500) / <alpha-value>)',
          600: 'rgb(var(--mk-brand-600) / <alpha-value>)',
          700: 'rgb(var(--mk-brand-700) / <alpha-value>)',
          800: 'rgb(var(--mk-brand-800) / <alpha-value>)',
          900: 'rgb(var(--mk-brand-900) / <alpha-value>)',
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      // The overlay ladder, named once so a new floating surface picks a rung
      // instead of guessing a number. Order is the rule: a dialog covers the
      // page, a toast reports over that dialog, a confirmation must sit above
      // whatever asked for it (a confirm hidden UNDER the modal that raised it
      // is a dead end), and the offline overlay outranks everything because
      // nothing else can be acted on while it shows.
      zIndex: {
        // A pane's splitter rides on the seam and must cover the pane's own
        // edge (the chat column sits at 40), but a dialog still covers it.
        splitter: '45',
        modal: '50',
        toast: '60',
        confirm: '70',
        // Anchored popovers (Select's teleported dropdown) must win over any
        // dialog that can host their trigger — including the confirm layer.
        popover: '80',
        // A hover explanation sits above everything it can explain — including
        // the trigger of an open popover.
        tooltip: '90',
        overlay: '200',
      },
    },
  },
  plugins: [
    // `coarse:` — a touch/pen pointer, where :hover never fires. Hover-only
    // affordances (tile overlay actions) must stay visible there, or the
    // action is unreachable on a phone or tablet. Tailwind 3 has no built-in
    // pointer variant (that landed in v4), so it is registered here.
    plugin(({ addVariant }) => {
      addVariant('coarse', '@media (pointer: coarse)');
    }),
    // `paused` — hold a running animation where it is. Tailwind 3 has no
    // animation-play-state utility. Born for the say-hello card (#369): motion
    // that loops for longer than 5 s must be pausable (WCAG 2.2.2), and the
    // card stops while the pointer or the focus is on it.
    plugin(({ addUtilities }) => {
      addUtilities({ '.paused': { 'animation-play-state': 'paused' } });
    }),
  ],
};
