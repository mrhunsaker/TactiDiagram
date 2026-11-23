#!/usr/bin/env node
// Build Windows icon assets for the TactiDiagram desktop package.
//
// Usage:
//   npm i --no-save sharp png-to-ico
//   node scripts/win-icon.cjs
//
// Produces packaging/icon.png (256x256) and a multi-size packaging/icon.ico.
const { existsSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const repoRoot = path.resolve(__dirname, '..');
const svgPath = path.join(repoRoot, 'packaging', 'icon.svg');
const pngPath = path.join(repoRoot, 'packaging', 'icon.png');
const icoPath = path.join(repoRoot, 'packaging', 'icon.ico');

async function main() {
  if (!existsSync(svgPath)) throw new Error('Missing ' + svgPath);
  const pngToIcoModule = await import('png-to-ico');
  const pngToIco = pngToIcoModule.default || pngToIcoModule;
  await sharp(svgPath, { density: 600 }).resize(256, 256).png().toFile(pngPath);
  console.log('Wrote ' + pngPath);

  const pngs = [];
  for (const size of [16, 24, 32, 48, 256]) {
    pngs.push(await sharp(svgPath, { density: 600 }).resize(size, size).png().toBuffer());
  }
  writeFileSync(icoPath, await pngToIco(pngs));
  console.log('Wrote ' + icoPath);
}

main().catch((err) => {
  console.error(err.message || err);
  console.error('Install helper dependencies with: npm i --no-save sharp png-to-ico');
  process.exitCode = 1;
});
