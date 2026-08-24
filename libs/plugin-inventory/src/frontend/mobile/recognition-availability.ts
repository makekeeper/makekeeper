import { ref, type Ref } from 'vue';
import { apiJson } from '@makekeeper/frontend-core';

// Whether this instance can call a model at all — asked ONCE per session.
//
// It used to be asked on every mount of the intake screen, and the answer
// arrived a round trip after the interface did: the recognize button appeared a
// beat late and shoved the button row sideways every single time the tab was
// opened. The fact does not change while the app is open (it is a provider
// being configured, in settings, on another surface), so re-asking bought
// nothing and cost a visible jump.
//
// Two screens want it — the camera and the batch list — which is the other
// reason it lives here rather than in either of them: one question, one answer,
// one place that knows how to ask.
const available = ref(false);

// The in-flight (or finished) question. Its presence is what makes this
// answered-once rather than answered-per-mount, and awaiting the SAME promise is
// what keeps two screens mounting together from asking twice.
let asked: Promise<void> | null = null;

// Resolves as soon as the answer is known; instant on every call after the
// first. Never rejects — an instance that cannot answer promises nothing, and
// the surface falls back to manual entry.
export function useRecognitionAvailability(): {
  available: Ref<boolean>;
  ensure: () => Promise<void>;
} {
  const ensure = (): Promise<void> => {
    asked ??= apiJson<{ available: boolean }>(
      '/api/components/intake/recognition',
    )
      .then((answer) => {
        available.value = answer.available;
      })
      .catch(() => {
        // Unknown means "do not promise it": the button stays hidden and manual
        // entry carries the flow. Not cached as a failure — the next mount may
        // well be after the provider was configured.
        asked = null;
      });
    return asked;
  };
  return { available, ensure };
}
