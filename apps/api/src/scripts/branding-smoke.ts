// Smoke test for the upgraded branding upload pipeline — sharp resize +
// EXIF strip on raster, DOMPurify sanitisation on SVG. Run from apps/api.
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { saveBrandingLogo } from '../services/storage/local-storage.service.js';

async function main() {
  // 1) Raster — sharp normalises to 400×120 max, drops EXIF.
  const big = await sharp({
    create: { width: 1600, height: 480, channels: 3, background: '#0f62fe' },
  })
    .png()
    .toBuffer();
  const r = await saveBrandingLogo({
    subjectKind: 'AGENCY',
    subjectId: 'a'.repeat(24),
    buffer: big,
  });
  const meta = await sharp(r.absolutePath).metadata();
  console.log(
    `raster: ext=${r.ext} bytes=${r.bytes} dims=${meta.width}x${meta.height} (target ≤ 400x120)`,
  );

  // 2) SVG with embedded <script> — sanitiser strips it.
  const dirty = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30"><script>alert(1)</script><rect width="100" height="30" fill="red"/></svg>`;
  const s = await saveBrandingLogo({
    subjectKind: 'AGENCY',
    subjectId: 'b'.repeat(24),
    buffer: Buffer.from(dirty, 'utf8'),
  });
  const cleaned = await fs.readFile(s.absolutePath, 'utf8');
  console.log(
    `svg:    ext=${s.ext} bytes=${s.bytes} hasScript=${cleaned.includes('<script>')}`,
  );
  console.log(`svg sample: ${cleaned.slice(0, 100)}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
