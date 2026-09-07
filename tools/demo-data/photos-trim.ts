// Commons originals run to 10 MB; a demo DB does not need that. Caps every demo
// photo at 2048 px / q85 — still well above the eager preview thresholds, so the
// xs/sm renditions are regenerated from the trimmed original exactly as the
// upload path would have made them.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  eagerVariants,
  probeImage,
  renderPreview,
  shouldGenerate,
  PREVIEW_PROFILE,
} from '../../libs/backend-core/src/lib/image-derivatives';

const UPLOADS =
  process.env.UPLOADS_DIR ?? join(__dirname, '..', '..', 'uploads');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const COLUMN: Record<string, string> = {
  xs: 'previewXsPath',
  sm: 'previewSmPath',
  lg: 'previewLgPath',
};
const LIMIT = 1_500_000;

(async () => {
  const rows = await prisma.attachment.findMany({
    where: { id: { startsWith: 'att_demo_' } },
  });
  let trimmed = 0;
  for (const a of rows) {
    if (a.sizeBytes <= LIMIT) continue;
    const abs = join(UPLOADS, a.storagePath);
    const out = await sharp(await readFile(abs))
      .rotate()
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    await writeFile(abs, out);
    const previews: Record<string, string | null> = {
      previewXsPath: null,
      previewSmPath: null,
      previewLgPath: null,
    };
    const dims = await probeImage(out);
    if (dims) {
      for (const v of eagerVariants()) {
        if (!shouldGenerate(v, dims, out.length)) continue;
        const rel = join(
          dirname(a.storagePath),
          `${a.id}.${v}.${PREVIEW_PROFILE[v].extension}`,
        );
        await writeFile(join(UPLOADS, rel), await renderPreview(out, v));
        previews[COLUMN[v]] = rel;
      }
    }
    await prisma.attachment.update({
      where: { id: a.id },
      data: {
        sizeBytes: (await stat(abs)).size,
        mimeType: 'image/jpeg',
        ...previews,
      },
    });
    trimmed += 1;
  }
  console.log(`trimmed ${trimmed} of ${rows.length}`);
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
