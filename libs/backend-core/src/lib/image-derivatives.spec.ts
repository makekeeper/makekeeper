import sharp from 'sharp';
import {
  PREVIEW_PROFILE,
  eagerVariants,
  PREVIEW_PROFILE_REVISION,
  WEBP_QUALITY,
  isVectorImage,
  probeImage,
  renderPreview,
  shouldGenerate,
} from './image-derivatives';

// Exercised against the real encoder, deliberately. Mocking sharp here would
// assert that we called a mock — the behaviour worth protecting (thresholds,
// EXIF rotation, alpha survival, actual output dimensions) only exists in the
// library. Fixtures are generated in-process, so no binaries live in the repo.

const jpeg = (width: number, height: number): Promise<Buffer> =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 80, b: 40 },
    },
  })
    .jpeg()
    .toBuffer();

describe('image-derivatives', () => {
  describe('probeImage', () => {
    it('reads the dimensions of a real image', async () => {
      expect(await probeImage(await jpeg(300, 200))).toEqual({
        width: 300,
        height: 200,
      });
    });

    it('returns null for bytes that are not a decodable image', async () => {
      // What an HEIC or a corrupt upload looks like to us: not a picture, so
      // the caller stores it as a plain file instead of a broken <img>.
      expect(
        await probeImage(Buffer.from('definitely not an image')),
      ).toBeNull();
    });
  });

  describe('shouldGenerate', () => {
    it('skips a source that is already no larger than the variant', () => {
      const dimensions = { width: 640, height: 480 };
      expect(shouldGenerate('sm', dimensions, 10_000)).toBe(false);
    });

    it('generates once the source exceeds the variant edge', () => {
      expect(shouldGenerate('sm', { width: 641, height: 480 }, 10_000)).toBe(
        true,
      );
    });

    it('is orientation-invariant — the long edge decides either way', () => {
      expect(shouldGenerate('sm', { width: 480, height: 641 }, 10_000)).toBe(
        true,
      );
    });

    it('re-encodes a small but heavy source for the browser variants', () => {
      const dimensions = { width: 100, height: 100 };
      expect(shouldGenerate('xs', dimensions, 2 * 1024 * 1024)).toBe(true);
    });

    it('does not re-encode a heavy source for the vision variant', () => {
      // A 2048 px frame that merely weighs a lot must reach the model as-is:
      // re-encoding would cost detail and buy nothing, since bandwidth is not
      // what a vision request pays in.
      const dimensions = { width: 2048, height: 1536 };
      expect(shouldGenerate('lg', dimensions, 8 * 1024 * 1024)).toBe(false);
    });
  });

  describe('renderPreview', () => {
    it('fits the long edge to the variant and keeps the aspect ratio', async () => {
      const out = await renderPreview(await jpeg(4032, 3024), 'sm');
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(PREVIEW_PROFILE.sm.maxEdge);
      expect(meta.height).toBe(480); // 640 × (3024 / 4032)
    });

    it('never enlarges a source smaller than the variant', async () => {
      const out = await renderPreview(await jpeg(100, 80), 'sm');
      const meta = await sharp(out).metadata();
      expect(meta.width).toBe(100);
      expect(meta.height).toBe(80);
    });

    it('applies EXIF orientation, so a portrait photo is not left on its side', async () => {
      // Orientation 6 = rotate 90°: the pixels are landscape, the picture is
      // portrait. Found in the very first iPhone upload this repo received.
      const rotated = await sharp({
        create: {
          width: 400,
          height: 200,
          channels: 3,
          background: { r: 10, g: 10, b: 10 },
        },
      })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer();

      const meta = await sharp(await renderPreview(rotated, 'sm')).metadata();
      expect(meta.width).toBeLessThan(meta.height ?? 0);
    });

    it('keeps transparency — a logo must not gain a black background', async () => {
      const transparent = await sharp({
        create: {
          width: 800,
          height: 800,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .png()
        .toBuffer();

      const meta = await sharp(
        await renderPreview(transparent, 'xs'),
      ).metadata();
      expect(meta.hasAlpha).toBe(true);
    });

    it('strips metadata, so a photo GPS tag never reaches a preview', async () => {
      const tagged = await sharp({
        create: {
          width: 900,
          height: 900,
          channels: 3,
          background: { r: 1, g: 2, b: 3 },
        },
      })
        .withExifMerge({ IFD0: { Copyright: 'somebody' } })
        .jpeg()
        .toBuffer();

      const meta = await sharp(await renderPreview(tagged, 'xs')).metadata();
      expect(meta.exif).toBeUndefined();
    });
  });

  describe('profile', () => {
    it('generates the browser renditions eagerly and the vision one on demand', () => {
      expect(eagerVariants()).toEqual(['xs', 'sm']);
      expect(PREVIEW_PROFILE.lg.eager).toBe(false);
    });

    // #115: the revision is what makes a profile change reach rows that already
    // have a rendition. Editing the shape of the bytes without bumping it
    // leaves every existing photo on the old preview, silently and forever —
    // so the two are pinned together here.
    it('pins the profile to the revision that must be bumped with it', () => {
      expect(PREVIEW_PROFILE_REVISION).toBe(1);
      expect(PREVIEW_PROFILE).toEqual({
        xs: {
          maxEdge: 192,
          eager: true,
          reencodeAboveBytes: 512 * 1024,
          extension: 'webp',
          mimeType: 'image/webp',
        },
        sm: {
          maxEdge: 640,
          eager: true,
          reencodeAboveBytes: 512 * 1024,
          extension: 'webp',
          mimeType: 'image/webp',
        },
        lg: {
          maxEdge: 2048,
          eager: false,
          reencodeAboveBytes: null,
          extension: 'webp',
          mimeType: 'image/webp',
        },
      });
      // Pinned alongside the profile, not inside it: the encoder setting shapes
      // the bytes exactly as `maxEdge` does, and a value no test looks at is a
      // value that changes without anyone bumping the revision.
      expect(WEBP_QUALITY).toBe(80);
    });

    it('treats SVG as its own preview', () => {
      expect(isVectorImage('image/svg+xml')).toBe(true);
      expect(isVectorImage('image/png')).toBe(false);
    });
  });
});
