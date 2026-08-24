/*
 * Regenerates every static brand asset from the ONE geometry definition
 * (`libs/frontend-core/src/lib/brand-mark.ts`) — favicon, the browser's `.ico`
 * fallback and the PWA icons.
 *
 * Run from the repo root:
 *   node --experimental-strip-types tools/brand/generate-brand-assets.mjs
 *
 * It IMPORTS the geometry rather than restating it (Node strips the types), so
 * a change to the mark reaches the tab icon and the installed phone app by
 * re-running this — the failure mode this whole ticket (#260) was about was a
 * mark that lived in three places and agreed in none.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { brandMarkSvg } from '../../libs/frontend-core/src/lib/brand-mark.ts';

// The brand's OWN colour — deliberately not the app's accent. Inside the app
// the mark takes the active colour scheme (#236, `BrandMark.vue`), because
// there it is one element of a themed UI; outside it — a tab among tabs, an
// icon on a home screen — it is the product's identity, and identity does not
// change with a user preference. So these assets are fixed at amber and no
// runtime code rewrites them.
const ACCENT = '#f59e0b';

const publicDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../apps/frontend/public',
);

const render = (svg, px) =>
  sharp(Buffer.from(svg)).resize(px, px).png({ compressionLevel: 9 }).toBuffer();

/**
 * ICO with PNG payloads (the Vista-era format every current browser reads) —
 * written here rather than shelled out to ImageMagick so the whole asset set
 * comes from one command with no system dependency.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0); // width (0 means 256)
    entry.writeUInt8(size === 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette size — none, it is a PNG
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const lockup = brandMarkSvg({ accent: ACCENT });
writeFileSync(join(publicDir, 'favicon.svg'), `${lockup}\n`);

writeFileSync(
  join(publicDir, 'favicon.ico'),
  ico([
    { size: 16, data: await render(lockup, 16) },
    { size: 32, data: await render(lockup, 32) },
    { size: 48, data: await render(lockup, 48) },
  ]),
);

writeFileSync(join(publicDir, 'icons/icon-192.png'), await render(lockup, 192));
writeFileSync(join(publicDir, 'icons/icon-512.png'), await render(lockup, 512));

// Maskable: the platform crops up to 20% per edge and applies its own mask, so
// this variant bleeds the tile to the full square (no corner radius of its own)
// and pulls the glyph into the safe zone.
writeFileSync(
  join(publicDir, 'icons/icon-maskable-512.png'),
  await render(brandMarkSvg({ accent: ACCENT, radius: 0, padding: 0.3 }), 512),
);
