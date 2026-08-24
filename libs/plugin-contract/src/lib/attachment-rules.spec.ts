import {
  DEFAULT_ATTACHMENT_RULES,
  attachmentExtension,
  checkAttachment,
  isAttachmentFormatAllowed,
  isPictureAttachment,
  normaliseAttachmentRuleList,
  PICTURE_ATTACHMENT_WHERE,
  type AttachmentRules,
} from './attachment-rules';

const rules: AttachmentRules = DEFAULT_ATTACHMENT_RULES;

describe('attachment rules', () => {
  it('admits a text file by its mime mask', () => {
    expect(
      isAttachmentFormatAllowed(
        { filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 10 },
        rules,
      ),
    ).toBe(true);
  });

  // The reason extensions exist at all: the Files tab stores maker formats as
  // octet-stream because the browser reports no type for them.
  it('admits a gcode stored as octet-stream by its extension', () => {
    expect(
      isAttachmentFormatAllowed(
        {
          filename: 'bracket.gcode',
          mimeType: 'application/octet-stream',
          sizeBytes: 10,
        },
        rules,
      ),
    ).toBe(true);
  });

  it('refuses an unlisted format', () => {
    const verdict = checkAttachment(
      {
        filename: 'archive.zip',
        mimeType: 'application/zip',
        sizeBytes: 10,
      },
      rules,
    );
    expect(verdict).toEqual({
      reason: 'format',
      filename: 'archive.zip',
      mimeType: 'application/zip',
    });
  });

  it('ignores mime parameters when matching', () => {
    expect(
      isAttachmentFormatAllowed(
        {
          filename: 'data.csv',
          mimeType: 'text/csv; charset=utf-8',
          sizeBytes: 10,
        },
        rules,
      ),
    ).toBe(true);
  });

  it('caps a non-image by size', () => {
    const verdict = checkAttachment(
      {
        filename: 'huge.log',
        mimeType: 'text/plain',
        sizeBytes: rules.maxNonImageBytes + 1,
      },
      rules,
    );
    expect(verdict).toEqual({
      reason: 'size',
      filename: 'huge.log',
      sizeBytes: rules.maxNonImageBytes + 1,
      maxBytes: rules.maxNonImageBytes,
    });
  });

  // Vision reads the `lg` rendition (#113), so an original's weight never
  // reaches a provider — capping images would only block the user.
  it('exempts images from the size cap', () => {
    expect(
      checkAttachment(
        {
          filename: 'photo.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: rules.maxNonImageBytes * 3,
          isImage: true,
        },
        rules,
      ),
    ).toBeNull();
  });

  // The probe overrides the declared type: a HEIC passes `image/*` but holds
  // no pixels we can render and no text we can read, so it is a plain file —
  // and therefore subject to the non-image size cap.
  it('treats a failed decode probe as a non-image', () => {
    const candidate = {
      filename: 'photo.heic',
      mimeType: 'image/heic',
      sizeBytes: rules.maxNonImageBytes + 1,
      isImage: false,
    };
    expect(isPictureAttachment(candidate)).toBe(false);
    expect(checkAttachment(candidate, rules)?.reason).toBe('size');
  });

  it('falls back to the mime prefix when nothing was probed', () => {
    expect(
      isPictureAttachment({
        filename: 'photo.png',
        mimeType: 'image/png',
        sizeBytes: 1,
      }),
    ).toBe(true);
  });

  // #122: the JS rule's answer, arm by arm — the table the query fragment below
  // has to reproduce in SQL.
  it('answers the picture question by probe first, declared mime second', () => {
    const picture = (
      mimeType: string,
      isImage?: boolean | null,
    ): {
      filename: string;
      mimeType: string;
      sizeBytes: number;
      isImage?: boolean | null;
    } => ({
      filename: 'f',
      mimeType,
      sizeBytes: 1,
      isImage,
    });

    // The probe decided, so the mime does not get a vote either way.
    expect(isPictureAttachment(picture('application/octet-stream', true))).toBe(
      true,
    );
    expect(isPictureAttachment(picture('image/heic', false))).toBe(false);
    // Predates the probe (#113): the declared mime decides, case-insensitively.
    expect(isPictureAttachment(picture('image/jpeg', null))).toBe(true);
    expect(isPictureAttachment(picture('IMAGE/PNG', null))).toBe(true);
    expect(isPictureAttachment(picture('model/stl', null))).toBe(false);
    expect(isPictureAttachment(picture('image/png'))).toBe(true);
  });

  // The same question in the query dialect. Pinned literally rather than
  // evaluated: an interpreter would only be a third hand-written copy of the
  // rule, and it is the exact SQL spelling that went wrong in #122
  // (`isImage: { not: false }` matched nothing where `isImage` was NULL).
  // Editing the fragment must mean re-deriving it against the table above.
  it('mirrors that table in the query fragment', () => {
    expect(PICTURE_ATTACHMENT_WHERE).toEqual({
      OR: [
        // isImage = true → a picture, mime unread, exactly as above.
        { isImage: true },
        // isImage IS NULL → fall back to the mime; `insensitive` because the JS
        // rule lowercases first and SQL `LIKE` would not.
        {
          isImage: null,
          mimeType: { startsWith: 'image/', mode: 'insensitive' },
        },
        // No third arm: isImage = false matches neither, so a row the probe
        // rejected is never painted in an <img>.
      ],
    });
  });

  it('reads an extension case-insensitively', () => {
    expect(attachmentExtension('Model.GCODE')).toBe('gcode');
    expect(attachmentExtension('noext')).toBe('');
    expect(attachmentExtension(null)).toBe('');
  });

  it('normalises a user-edited list', () => {
    expect(
      normaliseAttachmentRuleList(['.GCODE', ' stl ', 'stl', '', 'Txt']),
    ).toEqual(['gcode', 'stl', 'txt']);
  });
});
