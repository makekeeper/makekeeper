/**
 * Adds photographs to the demo dataset (#273): downloads freely-licensed
 * pictures from Wikimedia Commons and ingests them exactly the way an upload
 * would — same `YYYY/MM/DD/<id>.<ext>` layout, same eager xs/sm renditions from
 * the repo's own preview profile (#113), same `Attachment` row shape — so the
 * derivative pipeline is exercised rather than bypassed.
 *
 * Attachment ids carry the `att_demo_` prefix so undo-demo-photos.ts can find
 * them, and only them.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  eagerVariants,
  probeImage,
  renderPreview,
  shouldGenerate,
  PREVIEW_PROFILE,
  PREVIEW_PROFILE_REVISION,
} from '../../libs/backend-core/src/lib/image-derivatives';

const UPLOADS =
  process.env.UPLOADS_DIR ?? join(__dirname, '..', '..', 'uploads');
const SCOPE = process.env.DEMO_SCOPE_ID ?? null;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Keyed by preview variant; typed loosely on purpose so the variant union
// (owned by plugin-contract) does not have to be imported into a tool.
const PREVIEW_COLUMN: Record<string, string> = {
  xs: 'previewXsPath',
  sm: 'previewSmPath',
  lg: 'previewLgPath',
};

// owner kind, owner id, Commons file name (without the "File:" prefix), cover?
type Pick = [
  owner: 'component' | 'project',
  id: string,
  file: string,
  cover: boolean,
];

const PICKS: Pick[] = [
  [
    'component',
    'demo_it_r220',
    'Electronic Axial Lead Resistors 47kOhm.jpg',
    true,
  ],
  [
    'component',
    'demo_it_r1k',
    'Electronic Axial Lead Resistors 47kOhm.jpg',
    true,
  ],
  [
    'component',
    'demo_it_r10k',
    'Electronic-Axial-Lead-Resistors-Array.jpg',
    true,
  ],
  ['component', 'demo_it_c10u', 'Electrolytic capacitors-P1090328.JPG', true],
  ['component', 'demo_it_c470u', 'Aluminium Electrolytic Capacitors.jpg', true],
  ['component', 'demo_it_esp32c3', 'ESP32 Dev Board.jpg', true],
  [
    'component',
    'demo_it_esp32c3',
    'Espressif ESP-WROOM-32 Wi-Fi & Bluetooth Module.jpg',
    false,
  ],
  ['component', 'demo_it_d1mini', 'WeMos D1 Mini front.jpg', true],
  ['component', 'demo_it_pico', 'Raspberry Pi Pico oblique.jpg', true],
  [
    'component',
    'demo_it_nano',
    'Iskra Nano Pro (Arduino Nano clone) top.jpg',
    true,
  ],
  [
    'component',
    'demo_it_nano',
    'Iskra Nano Pro (Arduino Nano clone) bottom.jpg',
    false,
  ],
  ['component', 'demo_it_bme280', 'BME280.jpg', true],
  ['component', 'demo_it_ds18b20', 'SparkFun DS18B20 1.jpg', true],
  [
    'component',
    'demo_it_hcsr04',
    'HC-SR04 ultrasonic distance sensor module pcb.jpg',
    true,
  ],
  ['component', 'demo_it_pir', 'PIR-inexpensive.jpg', true],
  [
    'component',
    'demo_it_tft',
    'Arduino 2,2" TFT display (20679950896).jpg',
    true,
  ],
  ['component', 'demo_it_ws2812', 'LED strip on reel.jpg', true],
  ['component', 'demo_it_ws2812', 'LED strip closeup.jpg', false],
  [
    'component',
    'demo_it_psu5v',
    'Plug-in switching mode power adapter, unbranded-4237.jpg',
    true,
  ],
  ['component', 'demo_it_psu12v', 'MP3 MP4 Power Supply YJ 1002 top.jpg', true],
  [
    'component',
    'demo_it_m3x16',
    'Partially formed socket head cap screw.JPG',
    true,
  ],
  ['component', 'demo_it_m3nut', 'Nut-hardware.jpg', true],
  ['component', 'demo_it_m3insert', 'Press-in Insert.png', true],
  [
    'component',
    'demo_it_pla',
    'Universal stand-alone filament spool holder (Fully 3D-printable) v08.jpg',
    true,
  ],
  ['component', 'demo_it_solder', '60-40 Solder.jpg', true],
  [
    'component',
    'demo_it_flux',
    'Rosin-alcohol soldering fluxes - Канифольно-спиртовые флюсы.jpg',
    true,
  ],
  ['component', 'demo_it_shrink', 'Heat-shrink tubing.jpg', true],
  ['component', 'demo_it_dupont', 'A few Jumper Wires.jpg', true],
  ['project', 'demo_pr_lamp', 'Led desk lmap 1.png', true],
  ['project', 'demo_pr_meteo', 'SparkFun Weather Shield 13956-01.jpg', true],
  [
    'project',
    'demo_pr_shelf',
    'LED Light Strip Huaqiangbei July 2024.jpg',
    true,
  ],
  ['project', 'demo_pr_aqua', 'Goldfish in fish tank.jpg', true],
  ['project', 'demo_pr_bench', 'Pegboard.jpg', true],
];

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

// Commons stores a file under md5(name)[0]/md5(name)[0..1]; the thumb sits in a
// parallel tree. Deriving the URL beats another API round trip — the search
// endpoint rate-limits hard (429) and this is pure arithmetic.
const commonsUrls = (file: string): { thumb: string; original: string } => {
  const name = file.replace(/ /g, '_');
  const md5 = createHash('md5').update(name).digest('hex');
  const shard = `${md5[0]}/${md5[0]}${md5[1]}`;
  const enc = encodeURIComponent(name)
    .replace(/%2C/g, ',')
    .replace(/'/g, '%27');
  return {
    original: `https://upload.wikimedia.org/wikipedia/commons/${shard}/${enc}`,
    thumb: `https://upload.wikimedia.org/wikipedia/commons/thumb/${shard}/${enc}/1024px-${enc}`,
  };
};

// Commons asks automated clients to identify themselves; it also rate-limits
// hard (429 after a handful of calls), which is why the URLs below are derived
// arithmetically instead of asked for through the search API.
const UA = 'makekeeper-demo-seed/0.1 (self-hosted dev instance)';

const download = async (file: string): Promise<Buffer> => {
  const { thumb, original } = commonsUrls(file);
  for (const url of [thumb, original]) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    console.warn(`  ${res.status} ${url.slice(0, 120)}`);
  }
  throw new Error(`cannot download ${file}`);
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

async function main(): Promise<void> {
  const owners = new Map<string, Date>();
  for (const c of await prisma.component.findMany({
    where: { id: { startsWith: 'demo_' } },
    select: { id: true, createdAt: true },
  }))
    owners.set(c.id, c.createdAt);
  for (const p of await prisma.project.findMany({
    where: { id: { startsWith: 'demo_' } },
    select: { id: true, createdAt: true },
  }))
    owners.set(p.id, p.createdAt);

  const manifest: string[] = [];
  let n = 0;
  for (const [kind, ownerId, file, cover] of PICKS) {
    const ownerCreated = owners.get(ownerId);
    if (!ownerCreated) {
      console.warn(`skip ${ownerId} — no such demo row`);
      continue;
    }
    const bytes = await download(file);
    const ext = (file.split('.').pop() ?? 'jpg').toLowerCase();
    const mimeType = MIME[ext] ?? 'image/jpeg';
    const id = `att_demo_${uuidv7()}`;

    // Backdated one day after its owner appeared, so the Files tab and the disk
    // report show a history instead of one wall of "today".
    const created = new Date(ownerCreated.getTime() + 86400000);
    const relDir = join(
      String(created.getFullYear()),
      pad2(created.getMonth() + 1),
      pad2(created.getDate()),
    );
    const relPath = join(relDir, `${id}.${ext}`);
    await mkdir(join(UPLOADS, relDir), { recursive: true });
    await writeFile(join(UPLOADS, relPath), bytes);

    // Same eager-rendition rule the upload path applies, from the same profile.
    const previews: Record<string, string> = {};
    const dimensions = await probeImage(bytes);
    if (dimensions) {
      for (const variant of eagerVariants()) {
        if (!shouldGenerate(variant, dimensions, bytes.length)) continue;
        const out = join(
          dirname(relPath),
          `${id}.${variant}.${PREVIEW_PROFILE[variant].extension}`,
        );
        await writeFile(
          join(UPLOADS, out),
          await renderPreview(bytes, variant),
        );
        previews[PREVIEW_COLUMN[variant]] = out;
      }
    }

    await prisma.attachment.create({
      data: {
        id,
        ownerPluginId: kind === 'component' ? 'inventory' : 'projects',
        componentId: kind === 'component' ? ownerId : null,
        projectId: kind === 'project' ? ownerId : null,
        uploadedByUserId: SCOPE,
        storagePath: relPath,
        mimeType,
        filename: file,
        sizeBytes: bytes.length,
        isImage: dimensions !== null,
        previewsRevision: PREVIEW_PROFILE_REVISION,
        scopeId: SCOPE,
        createdAt: created,
        ...previews,
      },
    });

    if (cover) {
      if (kind === 'component')
        await prisma.component.update({
          where: { id: ownerId },
          data: { coverAttachmentId: id },
        });
      else
        await prisma.project.update({
          where: { id: ownerId },
          data: { coverAttachmentId: id },
        });
    }

    n += 1;
    manifest.push(
      `${ownerId}\t${file}\thttps://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, '_'))}`,
    );
    console.log(
      `  ${n}. ${ownerId} ← ${file} (${Math.round(bytes.length / 1024)} kB, ${Object.keys(previews).length} previews)`,
    );
    // Commons rate-limits aggressively; a short pause keeps the run polite.
    await new Promise((r) => setTimeout(r, 1200));
  }
  await writeFile(
    join(__dirname, 'photo-manifest.tsv'),
    manifest.join('\n') + '\n',
  );
  console.log(`Done: ${n} photographs.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
