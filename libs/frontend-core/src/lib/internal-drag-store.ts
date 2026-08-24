import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AttachmentDescriptor } from '@makekeeper/plugin-contract';

// In-app drag session for already-uploaded attachments (#109). Dragging a
// stored file cannot rely on DataTransfer flavours to be recognised by
// internal drop targets: for images the tile deliberately writes NOTHING to
// the drag data store (any author data would evict the browser's native
// payload — the file promise that saves a real file when the drag ends on the
// desktop), and for non-images the only flavour is Chromium's `DownloadURL`.
// Source and targets live in one SPA, so the handshake happens here instead:
// the source publishes the dragged file on dragstart, drop targets consume it,
// and the source reads back on dragend whether anyone did (to e.g. show a
// "drag-out unsupported" notice only when the drag went outside the app).
//
// What travels IS the shared attachment descriptor — `sizeBytes` and
// `mimeType` ride along so a drop target can judge the file against the
// attachment rules (#112) before accepting it, with no round trip.
export type InternalDragFile = AttachmentDescriptor;

// A session that outlives its drag would make the NEXT external file drop look
// internal — the dropzone would silently ignore a real upload. `dragend` on the
// source normally closes it, but it never fires if the source element unmounted
// mid-drag (the tile's file was deleted, the tab was switched). Two safety nets
// below cover that: window-level dragend/drop, and a hard age cap.
const DRAG_SESSION_TTL_MS = 120_000;

export const useInternalDragStore = defineStore('internalDrag', () => {
  const session = ref<{ file: InternalDragFile; startedAt: number } | null>(
    null,
  );
  const consumed = ref(false);

  const reset = (): void => {
    session.value = null;
    consumed.value = false;
    detachSafetyNet();
  };

  // Bubble phase, not capture: a drop target's own handler runs first and gets
  // to consume the session before this net wipes it. The `consumed` flag is
  // deliberately NOT cleared here — the source's own dragend still has to read
  // it back; the next `start()` resets it.
  const onWindowDragEnd = (): void => {
    session.value = null;
    detachSafetyNet();
  };
  const attachSafetyNet = (): void => {
    if (typeof window === 'undefined') return;
    window.addEventListener('dragend', onWindowDragEnd);
    window.addEventListener('drop', onWindowDragEnd);
  };
  const detachSafetyNet = (): void => {
    if (typeof window === 'undefined') return;
    window.removeEventListener('dragend', onWindowDragEnd);
    window.removeEventListener('drop', onWindowDragEnd);
  };

  const start = (file: InternalDragFile): void => {
    session.value = { file, startedAt: Date.now() };
    consumed.value = false;
    attachSafetyNet();
  };

  // The file of the live session, or null when there is none / it went stale.
  const peek = (): InternalDragFile | null => {
    const active = session.value;
    if (!active) return null;
    if (Date.now() - active.startedAt > DRAG_SESSION_TTL_MS) {
      reset();
      return null;
    }
    return active.file;
  };

  // Is a drag currently in flight? Drop targets use this to tell an internal
  // drag from an external one (which must upload).
  const isActive = (): boolean => peek() !== null;

  // Claim the dragged file from a drop target; null when the drag is not an
  // internal one (external files, links, plain text).
  const consume = (): InternalDragFile | null => {
    const file = peek();
    if (file) consumed.value = true;
    return file;
  };

  // Close the session (dragend on the source). Reports whether any internal
  // target consumed the drag before the state resets.
  const end = (): { wasConsumed: boolean } => {
    const wasConsumed = consumed.value;
    reset();
    return { wasConsumed };
  };

  return { start, peek, isActive, consume, end };
});
