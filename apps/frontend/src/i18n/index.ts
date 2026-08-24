import { createI18n } from 'vue-i18n';
import { buildMessages } from '@makekeeper/frontend-core';
// Side-effect: registers every plugin (and its locale bundle) BEFORE we fold
// the plugin messages onto the core ones below.
import '../plugins/loader';
import ru from './locales/ru.json';
import en from './locales/en.json';
import {
  browserLocaleEnvironment,
  resolveInitialLocale,
} from './resolve-locale';

// Resolved before the app mounts (#211): a phone that arrived from a desktop's
// QR carries that desktop's language in the URL, and reading it any later means
// painting the first screen in the wrong one.
const savedLocale = resolveInitialLocale(browserLocaleEnvironment());

// Core app strings deep-merged with every registered plugin's own bundle.
const messages = buildMessages({ ru, en });

export const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'en',
  messages,
});
