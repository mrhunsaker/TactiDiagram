// Build Windows icon assets for the TouchSight-NG desktop package.
//
// Usage (on Windows; requires the optional helper deps):
//   npm i --no-save sharp png-to-ico
//   node scripts/win-icon.cjs
//
// Produces:
//   packaging/icon.png  256x256 raster of packaging/icon.svg (window/launcher icon)
//   packaging/icon.ico  multi-size ico (16/24/32/48/256) for the exe (Explorer/Start menu)
//
// scripts/package.mjs picks these up automatically when they exist.
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const svgPath = join(repoRoot, 'packaging', 'icon.svg');
const pngPath = join(repoRoot, 'packaging', 'icon.png');
const icoPath = join(repoRoot, 'packaging', 'icon.ico');

async function main() {
  const require = createRequire(import.meta.url);
  const sharp = require('sharp');
  const pngToIco = require('png-to-ico');
  if (!existsSync(svgPath)) {
    console.error('Missing ' + svgPath);
    process.exit(1);
  }

  await sharp(svgPath, { density: 600 }).resize(256, 256).png().toFile(pngPath);
  console.log('Wrote ' + pngPath);

  // png-to-ico accepts multiple PNGs of increasing size; a single 256px PNG is
  // a valid ico (Vista+), but adding standard sizes avoids blurry small icons
  // in Explorer and on the taskbar.
  const sizes = [16, 24, 32, 48, 256];
  const pngs = [];
  for (const size of sizes) {
    const buf = await sharp(svgPath, { density: 600 }).resize(size, size).png().toBuffer();
    pngs.push(buf);
  }
  const ico = await pngToIco(pngs);
  writeFileSync(icoPath, ico);
  console.log('Wrote ' + icoPath);
}

main().catch((err) => {
  console.error(err.message || err);
  console.error('Install the helper deps first: npm i --no-save sharp png-to-ico');
  process.exit(1);
});
