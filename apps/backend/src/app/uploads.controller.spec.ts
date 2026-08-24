import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import type { Response } from 'express';
import { UploadsController, inlineDisposition } from './uploads.controller';

// Minimal response double: the controller only ever sets headers on it.
const makeRes = (): Response & { headers: Record<string, string> } => {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response & { headers: Record<string, string> };
};

const makeController = (attachments: Record<string, unknown>) =>
  new UploadsController(
    attachments as never,
    {
      t: (key: string) => key,
    } as never,
  );

describe('UploadsController.serve', () => {
  // Scope enforcement lives in the Prisma layer: `Attachment` is a scoped model,
  // so for a caller from another user's scope the scoped client hides the row and
  // `resolveFile` reads back null. The controller's contract is that this becomes
  // a 404 — an out-of-scope file must never stream, and must not be
  // distinguishable from a non-existent one.
  it('404s when the attachment does not resolve for this caller', async () => {
    const stream = jest.fn();
    const attachments = {
      resolveFile: jest.fn().mockResolvedValue(null),
      stream,
    };
    const controller = makeController(attachments);

    await expect(
      controller.serve('att_foreign', makeRes()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(stream).not.toHaveBeenCalled();
  });

  // Preview variants (#113).
  const original = {
    path: '/uploads/att_1.jpg',
    mimeType: 'image/jpeg',
    filename: 'photo.jpg',
  };

  it('serves the original and caches it immutably when no variant is asked for', async () => {
    const attachments = {
      resolveFile: jest.fn().mockResolvedValue(original),
      resolveVariantFile: jest.fn(),
      stream: jest.fn(() => Readable.from([])),
    };
    const res = makeRes();

    await makeController(attachments).serve('att_1', res);

    expect(attachments.resolveVariantFile).not.toHaveBeenCalled();
    expect(res.headers['Cache-Control']).toContain('immutable');
  });

  it('caches a real derivative immutably', async () => {
    const attachments = {
      resolveVariantFile: jest.fn().mockResolvedValue({
        path: '/uploads/att_1.sm.webp',
        mimeType: 'image/webp',
        filename: 'att_1.webp',
        derived: true,
      }),
      stream: jest.fn(() => Readable.from([])),
    };
    const res = makeRes();

    await makeController(attachments).serve('att_1', res, 'sm');

    expect(attachments.resolveVariantFile).toHaveBeenCalledWith('att_1', 'sm');
    expect(res.headers['Cache-Control']).toContain('immutable');
  });

  it('caches a fallback only briefly', async () => {
    // The trap this guards: an `immutable` fallback would pin the full-size
    // original under the preview URL for a year, so a derivative generated
    // later would never be fetched — permanently defeating previews.
    const attachments = {
      resolveVariantFile: jest
        .fn()
        .mockResolvedValue({ ...original, derived: false }),
      stream: jest.fn(() => Readable.from([])),
    };
    const res = makeRes();

    await makeController(attachments).serve('att_1', res, 'sm');

    expect(res.headers['Cache-Control']).not.toContain('immutable');
    expect(res.headers['Cache-Control']).toContain('max-age=300');
  });

  it('rejects an unknown variant loudly instead of serving originals in silence', async () => {
    const attachments = {
      resolveVariantFile: jest.fn(),
      resolveFile: jest.fn(),
      stream: jest.fn(),
    };

    await expect(
      makeController(attachments).serve('att_1', makeRes(), 'huge'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(attachments.resolveVariantFile).not.toHaveBeenCalled();
    expect(attachments.resolveFile).not.toHaveBeenCalled();
  });
});

describe('inlineDisposition', () => {
  it('keeps a plain ASCII filename in both forms', () => {
    expect(inlineDisposition('board.stl', 'att_1')).toBe(
      `inline; filename="board.stl"; filename*=UTF-8''board.stl`,
    );
  });

  it('percent-encodes non-Latin names and sanitises the quoted fallback', () => {
    const value = inlineDisposition('фото.png', 'att_1');
    expect(value).toContain(`filename*=UTF-8''%D1%84%D0%BE%D1%82%D0%BE.png`);
    // The quoted fallback must stay ASCII-only and non-empty.
    expect(value).toMatch(/filename="[\x20-\x7e]+"/);
  });

  it('falls back to the attachment id when sanitising empties the name', () => {
    expect(inlineDisposition('фото', 'att_1')).toContain('filename="att_1"');
  });

  it('neutralises quote/backslash/semicolon injection in the quoted form', () => {
    const value = inlineDisposition('a";b\\c.txt', 'att_1');
    expect(value).toContain('filename="a__b_c.txt"');
  });
});
