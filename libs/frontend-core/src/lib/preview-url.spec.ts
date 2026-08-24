import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PREWARM_MAX_ATTACHMENTS } from '@makekeeper/plugin-contract';
import { previewUrl, prewarmPreviews } from './preview-url';

const apiFetch = vi.hoisted(() => vi.fn(() => Promise.resolve(new Response())));
vi.mock('./api', () => ({ apiFetch }));

describe('previewUrl', () => {
  it('selects a rendition of a stored attachment', () => {
    expect(previewUrl('/api/uploads/att_1', 'sm')).toBe(
      '/api/uploads/att_1?variant=sm',
    );
  });

  it('leaves a data URL untouched', () => {
    // The composer renders a locally picked image before it is uploaded; a
    // query string appended to a data URL would break the preview outright.
    const dataUrl = 'data:image/png;base64,AAAA';
    expect(previewUrl(dataUrl, 'xs')).toBe(dataUrl);
  });

  it('leaves an unrelated URL untouched', () => {
    expect(previewUrl('https://example.com/logo.png', 'xs')).toBe(
      'https://example.com/logo.png',
    );
  });

  it('does not double up on a URL that already carries a variant', () => {
    expect(previewUrl('/api/uploads/att_1?variant=xs', 'sm')).toBe(
      '/api/uploads/att_1?variant=xs',
    );
  });
});

describe('prewarmPreviews (#128)', () => {
  const ids = (count: number): string[] =>
    Array.from({ length: count }, (_, i) => `att_${i}`);

  beforeEach(() => {
    apiFetch.mockClear();
  });

  it('asks the server to warm the given renditions', () => {
    prewarmPreviews(['att_1', 'att_2'], 'lg');

    expect(apiFetch).toHaveBeenCalledWith('/api/uploads/prewarm', {
      method: 'POST',
      body: { ids: ['att_1', 'att_2'], variant: 'lg' },
    });
  });

  // The cap is the server's contract too: over it the request is rejected
  // whole, so a large gallery must lose the tail rather than the batch.
  it('caps a batch and reports only the ids it sent', () => {
    const sent = prewarmPreviews(ids(PREWARM_MAX_ATTACHMENTS + 5), 'lg');

    expect(sent).toHaveLength(PREWARM_MAX_ATTACHMENTS);
    expect(sent).toEqual(ids(PREWARM_MAX_ATTACHMENTS));
  });

  it('says nothing to the server when there is nothing to warm', () => {
    expect(prewarmPreviews([], 'lg')).toEqual([]);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  // Nothing on screen depends on the answer: a failed prewarm only means the
  // first click pays the resize it always did.
  it('swallows a failed request rather than rejecting into the caller', () => {
    apiFetch.mockReturnValueOnce(Promise.reject(new Error('offline')));

    expect(() => prewarmPreviews(['att_1'], 'lg')).not.toThrow();
  });
});
