// Deletes the demo photographs: their Attachment rows, their files and
// renditions on disk, and the cover pins that point at them.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const UPLOADS =
  process.env.UPLOADS_DIR ?? join(__dirname, '..', '..', 'uploads');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

(async () => {
  const rows = await prisma.attachment.findMany({
    where: { id: { startsWith: 'att_demo_' } },
  });
  for (const a of rows) {
    for (const p of [
      a.storagePath,
      a.previewXsPath,
      a.previewSmPath,
      a.previewLgPath,
    ]) {
      if (p) await rm(join(UPLOADS, p), { force: true });
    }
  }
  const ids = rows.map((a) => a.id);
  await prisma.component.updateMany({
    where: { coverAttachmentId: { in: ids } },
    data: { coverAttachmentId: null },
  });
  await prisma.project.updateMany({
    where: { coverAttachmentId: { in: ids } },
    data: { coverAttachmentId: null },
  });
  const del = await prisma.attachment.deleteMany({
    where: { id: { startsWith: 'att_demo_' } },
  });
  console.log(`removed ${del.count} attachments and their files`);
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
