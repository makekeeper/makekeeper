import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  useInternalDragStore,
  type InternalDragFile,
} from './internal-drag-store';

const FILE: InternalDragFile = {
  url: '/api/uploads/att_1',
  mimeType: 'image/png',
  filename: 'photo.png',
  isImage: true,
};

describe('useInternalDragStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a consumed drag back to the source', () => {
    const store = useInternalDragStore();
    store.start(FILE);
    expect(store.consume()).toEqual(FILE);
    expect(store.end()).toEqual({ wasConsumed: true });
  });

  it('reports an unconsumed drag (it left the app)', () => {
    const store = useInternalDragStore();
    store.start(FILE);
    expect(store.end()).toEqual({ wasConsumed: false });
  });

  it('yields nothing when no drag is in flight', () => {
    const store = useInternalDragStore();
    expect(store.isActive()).toBe(false);
    expect(store.consume()).toBeNull();
  });

  it('clears the session on end so a later drop reads as external', () => {
    const store = useInternalDragStore();
    store.start(FILE);
    store.end();
    expect(store.isActive()).toBe(false);
    expect(store.peek()).toBeNull();
  });

  // The failure this guards: a source unmounted mid-drag never fires dragend,
  // and the stale session would make the NEXT external file drop look internal
  // — the dropzone would silently skip a real upload.
  it('does not let a session outlive its drag: window drop closes it', () => {
    const store = useInternalDragStore();
    store.start(FILE);
    window.dispatchEvent(new Event('drop'));
    expect(store.isActive()).toBe(false);
  });

  it('does not let a session outlive its drag: it expires by age', () => {
    vi.useFakeTimers();
    const store = useInternalDragStore();
    store.start(FILE);
    vi.advanceTimersByTime(120_001);
    expect(store.isActive()).toBe(false);
    expect(store.consume()).toBeNull();
  });
});
