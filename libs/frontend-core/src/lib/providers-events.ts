import { readonly, ref, type Ref } from 'vue';

// Lightweight cross-plugin signal. The chat plugin's provider-settings screen
// bumps this whenever the AI provider configuration changes (add / edit /
// delete / set-default); the app shell watches it to refresh the assistant
// connection status without the two having to import each other.
const providersChangedSignal = ref(0);

export const notifyProvidersChanged = (): void => {
  providersChangedSignal.value += 1;
};

export const useProvidersChanged = (): Readonly<Ref<number>> =>
  readonly(providersChangedSignal);
