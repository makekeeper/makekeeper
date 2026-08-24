import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@makekeeper/frontend-core';
import {
  DEFAULT_ATTACHMENT_RULES,
  checkAttachment,
  type AttachmentCandidate,
  type AttachmentRejection,
  type AttachmentRules,
} from '@makekeeper/plugin-contract';

// The rules that govern what may be attached to a chat message (#112), as they
// apply to THIS user — the ruleset of whoever owns the active connection,
// resolved server-side.
//
// Held in a store rather than fetched per drop: the composer must answer
// instantly, and the verdict must be the same for a drop, a paste and a picked
// file. This tier is UX only — `sendMessage` re-validates, because the active
// connection can change between attaching a file and sending it.
export const useAttachmentRulesStore = defineStore('attachmentRules', () => {
  const rules = ref<AttachmentRules>({ ...DEFAULT_ATTACHMENT_RULES });
  const loaded = ref(false);

  // Best-effort: an unreachable backend leaves the built-in defaults in place,
  // which keeps the composer usable and lets the server have the final word.
  const load = async (): Promise<void> => {
    const response = await apiFetch(
      '/api/chat/attachment-settings/effective',
    ).catch(() => null);
    if (!response?.ok) return;
    const payload: AttachmentRules = await response.json();
    rules.value = payload;
    loaded.value = true;
  };

  const check = (candidate: AttachmentCandidate): AttachmentRejection | null =>
    checkAttachment(candidate, rules.value);

  return { rules, loaded, load, check };
});
