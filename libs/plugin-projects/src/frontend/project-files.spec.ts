import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isProjectFilesView,
  readStoredFilesView,
  storeFilesView,
} from './project-files';

describe('project files view preference (#116)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to the grid', () => {
    expect(readStoredFilesView()).toBe('grid');
  });

  it('remembers the last choice across visits', () => {
    storeFilesView('list');
    expect(readStoredFilesView()).toBe('list');
  });

  // A value from storage is input like any other: a stale or hand-edited entry
  // must not put the tab into a view that does not exist.
  it('ignores a stored value that is not a view', () => {
    localStorage.setItem('projects:filesView', 'gallery');
    expect(readStoredFilesView()).toBe('grid');
    expect(isProjectFilesView('gallery')).toBe(false);
  });

  // Private mode and blocked storage throw on access; a lost preference is not
  // a reason to break the tab.
  it('survives storage being unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });

    expect(readStoredFilesView()).toBe('grid');
    expect(() => storeFilesView('list')).not.toThrow();
  });
});
