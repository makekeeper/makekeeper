import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { PRODUCT_SLUG } from '@makekeeper/plugin-contract';
import { ApiError, apiFetch } from './api';

// Writes made where the network is not (#202).
//
// A workshop basement drops connectivity constantly, and the conveyor cannot
// stop when it does. So a write is queued in IndexedDB — chosen over
// localStorage because a queued photograph is megabytes, not a string — and
// drained when the connection returns.
//
// Two rules make the drain safe, and both live on the server side of the wire:
//
//   * every operation carries a `clientOpId` minted HERE, and the server holds
//     it under a unique index — so the retry that follows a timeout records one
//     movement, not two;
//   * every stock write is a DELTA, never an absolute quantity — so a phone
//     that spent an hour offline adds what it counted instead of rolling back
//     what the desktop did meanwhile.
//
// What the queue deliberately does NOT do is pretend. A pending item is shown as
// pending, and a delta the server refuses lands in a visible "did not apply"
// state for a human to resolve — never a silent success.

const DB_NAME = `${PRODUCT_SLUG}-offline`;
const DB_VERSION = 1;
const STORE = 'queue';

export type QueuedOpState = 'pending' | 'sending' | 'failed';

export interface QueuedOp {
  // Also the idempotency key sent to the server.
  id: string;
  // Human-facing label for the queue list ("Resistor 10k", "shot 3").
  label: string;
  path: string;
  method: 'POST' | 'PATCH';
  body: Record<string, unknown>;
  state: QueuedOpState;
  // Server's (already localized) reason this op did not apply. Set only in the
  // `failed` state — the delta was rejected, not lost.
  error: string | null;
  queuedAt: number;
}

// What a killed tab leaves behind. An op caught mid-flight was possibly received
// by the server and possibly not — and that ambiguity is exactly what the
// idempotency key resolves, so the safe answer is to send it again rather than
// to drop it. Exported (and pure) because it is the rule that decides whether
// "killed mid-drain" loses work or double-counts it.
export function recoverQueue(stored: QueuedOp[]): QueuedOp[] {
  return [...stored]
    .map((op) =>
      op.state === 'sending' ? { ...op, state: 'pending' as const } : op,
    )
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// The server's already-localized error text, when it sent one. A type guard
// rather than a cast (§5.1): this is an unknown payload off the wire.
const hasMessage = (value: unknown): value is { message: string } =>
  typeof value === 'object' &&
  value !== null &&
  'message' in value &&
  typeof (value as { message: unknown }).message === 'string';

const extractMessage = (payload: unknown): string | null =>
  hasMessage(payload) ? payload.message : null;

// A crypto-strength id: it is the idempotency key, so a collision would silently
// drop somebody's stock movement.
const mintOpId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const useOfflineQueue = defineStore('offline-queue', () => {
  const ops = ref<QueuedOp[]>([]);
  const draining = ref(false);

  const pendingCount = computed(
    () => ops.value.filter((op) => op.state !== 'failed').length,
  );
  const failed = computed(() =>
    ops.value.filter((op) => op.state === 'failed'),
  );

  const load = async (): Promise<void> => {
    try {
      const stored = await withStore<QueuedOp[]>('readonly', (store) =>
        store.getAll(),
      );
      ops.value = recoverQueue(stored);
    } catch {
      // No IndexedDB (private mode, ancient browser): the queue is simply not
      // available, and callers fall back to sending directly.
      ops.value = [];
    }
  };

  const persist = async (op: QueuedOp): Promise<void> => {
    await withStore('readwrite', (store) => store.put({ ...op }));
  };

  const forget = async (id: string): Promise<void> => {
    await withStore('readwrite', (store) => store.delete(id));
    ops.value = ops.value.filter((op) => op.id !== id);
  };

  // Queue one write. Returns its id, which is also the `clientOpId` the server
  // will deduplicate on.
  const enqueue = async (
    input: Pick<QueuedOp, 'label' | 'path' | 'method'> & {
      body: Record<string, unknown>;
    },
  ): Promise<string> => {
    const op: QueuedOp = {
      id: mintOpId(),
      state: 'pending',
      error: null,
      queuedAt: Date.now(),
      ...input,
    };
    ops.value.push(op);
    await persist(op);
    return op.id;
  };

  // Returns false when the drain should stop (the network went away again) —
  // rather than throwing, which would need a message, and the only allowed
  // string literals are i18n keys (§5.5).
  const send = async (op: QueuedOp): Promise<boolean> => {
    op.state = 'sending';
    await persist(op);
    const response = await apiFetch(op.path, {
      method: op.method,
      body: { ...op.body, clientOpId: op.id },
    });
    if (response.ok) {
      await forget(op.id);
      return true;
    }
    // 4xx is a verdict: this delta will never apply, however many times we try
    // (the part is gone, the count would go negative). Show it and stop. 5xx and
    // network failures are weather — leave it pending for the next drain.
    if (response.status >= 400 && response.status < 500) {
      const payload: unknown = await response.json().catch(() => undefined);
      op.state = 'failed';
      op.error = extractMessage(payload);
      await persist(op);
      return true;
    }
    op.state = 'pending';
    await persist(op);
    return false;
  };

  // Send everything pending, oldest first. Order matters: two deltas against one
  // part must land in the order they were counted.
  const drain = async (): Promise<void> => {
    if (draining.value) return;
    draining.value = true;
    try {
      for (const op of [...ops.value]) {
        if (op.state !== 'pending') continue;
        // Stop at the first sign the network is gone again; the rest stays
        // queued, in order, for the next attempt.
        if (!(await send(op))) break;
      }
    } finally {
      draining.value = false;
    }
  };

  // THE entry point for a write that must survive a bad connection. Callers do
  // not write the online/offline fork themselves — that fork was copied into
  // four screens before this existed, and every copy is a chance to forget the
  // idempotency key.
  //
  // Online, the request goes straight out, carrying the same key it would have
  // carried from the queue: an online request can time out and be retried too,
  // and the server must recognize the retry either way. A refusal (4xx) is the
  // caller's to show — it is a verdict about what they just did, not weather.
  // Only an unreachable network falls back to the queue.
  // Returns the outcome AND the key the write went out under. The key is not
  // bookkeeping: a caller may need to talk about that write afterwards — the
  // intake camera drops a frame by naming the shot that produced it, which is
  // the only address it has for a photograph that never left the phone.
  const submit = async (
    input: Pick<QueuedOp, 'label' | 'path' | 'method'> & {
      body: Record<string, unknown>;
    },
  ): Promise<{ state: 'sent' | 'queued'; id: string }> => {
    const id = mintOpId();
    if (navigator.onLine) {
      try {
        const response = await apiFetch(input.path, {
          method: input.method,
          body: { ...input.body, clientOpId: id },
        });
        if (response.ok) return { state: 'sent', id };
        if (response.status >= 400 && response.status < 500) {
          const payload: unknown = await response.json().catch(() => undefined);
          throw new ApiError(
            response.status,
            payload,
            extractMessage(payload) ?? '',
          );
        }
      } catch (err) {
        // A refusal is final; anything else is the connection, which is what
        // the queue is for.
        if (err instanceof ApiError) throw err;
      }
    }
    const op: QueuedOp = {
      ...input,
      id,
      state: 'pending',
      error: null,
      queuedAt: Date.now(),
    };
    ops.value.push(op);
    await persist(op);
    return { state: 'queued', id };
  };

  // Give up on an operation the server refused. The human has seen it; keeping
  // it forever would only make the queue a graveyard.
  const discard = (id: string): Promise<void> => forget(id);

  return {
    ops,
    draining,
    pendingCount,
    failed,
    load,
    enqueue,
    submit,
    drain,
    discard,
  };
});
