#!/usr/bin/env node
// Package TouchSight-NG as a desktop application.
//
// Usage:
//   npm run package:desktop            (auto: linux target on Linux, win on Windows)
//   node scripts/package.mjs --target linux [--version 2026.11.22] [--out dist]
//   node scripts/package.mjs --target win   [--version 2026.11.22] [--out dist]
//
// What this does:
//   1. Vendors runtime assets ("npm run vendor") so the bundle is complete.
//   2. Stages src/ into desktop/neutralino/resources/ (keeping the Neutralino
//      client library), plus a window icon when packaging/icon.png exists.
//   3. Rewrites the Neutralino config for a standalone build: the shell serves
//      the staged resources itself (enableServer, url "/"), so the packaged
//      app does not depend on scripts/serve.mjs or localhost:5173.
//   4. Runs "neu build --release", which produces the platform binary (from the
//      binaries present in desktop/neutralino/bin/, downloaded by
//      "npx neu update") and a resources.neu bundle.
//   5. Packages it:
//      - Linux: an AppImage built with appimagetool (downloaded on first run
//        and executed with --appimage-extract-and-run, so no FUSE needed).
//      - Windows: a zip with touchsight-ng.exe + resources.neu; the exe icon
//        is embedded with rcedit when available (see scripts/win-icon.cjs).
//
// --version stamps the build: it sets neutralino.config.json "version" and
// writes resources/version.json. The release workflow passes the tag version
// (vYYYY.M.D -> YYYY.M.D, e.g. v2026.11.22), so build, git tag, and GitHub
// release always carry the same calendar version. A version that is not a
// SemVer triple is rejected.
//
// Prerequisites:
//   npm install         (installs @neutralinojs/neu)
//   npx neu update      (once, downloads binaries into desktop/neutralino/bin/)
//   On Linux: curl/network for the first appimagetool download.
//   On Windows (optional, for the exe icon): npm i --no-save sharp png-to-ico rcedit
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync,
  rmSync, copyFileSync, chmodSync, statSync,
} from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const neuDir = join(repoRoot, 'desktop', 'neutralino');
const packagingDir = join(repoRoot, 'packaging');

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) throw new Error(cmd + ' ' + args.join(' ') + ' failed with exit code ' + r.status);
};
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

// ---- arguments -------------------------------------------------------------
let target = process.platform === 'win32' ? 'win' : 'linux';
let versionArg = null;
const argv = process.argv.slice(2);
const tIdx = argv.indexOf('--target');
if (tIdx >= 0) target = argv[tIdx + 1];
const vIdx = argv.indexOf('--version');
if (vIdx >= 0) versionArg = argv[vIdx + 1];
if (!['linux', 'win'].includes(target)) {
  console.error('Unsupported target: ' + target + '. Use --target linux or --target win.');
  process.exit(1);
}
const SEMVER = /^[0-9]+[.][0-9]+[.][0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
if (versionArg && !SEMVER.test(versionArg)) {
  console.error('Version must be a SemVer triple (for example 2026.11.22), got: ' + versionArg);
  process.exit(1);
}

const outDir = resolve(repoRoot, process.env.PACKAGE_OUT || 'dist');

// ---- 2. stage resources ----------------------------------------------------
const resDir = join(neuDir, 'resources');
function copyTree(src, dest, exclude) {
  for (const name of readdirSync(src)) {
    if (exclude.includes(name)) continue;
    const s = join(src, name);
    const d = join(dest, name);
    if (isDir(s)) { mkdirSync(d, { recursive: true }); copyTree(s, d, []); }
    else copyFileSync(s, d);
  }
}
function stageResources() {
  const clientLib = join(resDir, 'js', 'neutralino.js');
  const clientJs = existsSync(clientLib) ? readFileSync(clientLib) : null;
  if (!clientJs) {
    console.error('Missing ' + clientLib + '.');
    console.error('Run "npx neu update" inside desktop/neutralino first.');
    process.exit(1);
  }
  rmSync(resDir, { recursive: true, force: true });
  mkdirSync(join(resDir, 'js'), { recursive: true });
  writeFileSync(clientLib, clientJs);
  copyTree(join(repoRoot, 'src'), resDir, ['dev']);
  const iconPng = join(packagingDir, 'icon.png');
  if (existsSync(iconPng)) copyFileSync(iconPng, join(resDir, 'icon.png'));
}

// ---- 3. build config -------------------------------------------------------
const cfgPath = join(neuDir, 'neutralino.config.json');
const originalCfg = readFileSync(cfgPath, 'utf8');
function writeBuildConfig() {
  const cfg = JSON.parse(originalCfg);
  cfg.enableServer = true; // the shell serves resources.neu itself
  cfg.url = '/';
  cfg.exportAuthInfo = false;
  if (versionArg) {
    // Stamped build: the version matches the git tag and GitHub release.
    cfg.version = versionArg;
    writeFileSync(join(resDir, 'version.json'),
      JSON.stringify({ name: 'TouchSight-NG', version: versionArg }, null, 2) + '\n');
  }
  if (existsSync(join(resDir, 'icon.png'))) cfg.modes.window.icon = '/resources/icon.png';
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
}

// ---- 4. neu build ----------------------------------------------------------
function walk(dir) {
  const acc = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (isDir(p)) acc.push(...walk(p).map((rel) => join(name, rel)));
    else acc.push(name);
  }
  return acc;
}
function neuBuild() {
  run('npx', ['neu', 'build', '--release'], { cwd: neuDir });
  const distRoot = join(neuDir, 'dist');
  const namedDir = readdirSync(distRoot).find((n2) => n2 !== 'touchsight-ng-release');
  const buildDir = join(distRoot, namedDir || '');
  const files = walk(buildDir);
  const rel = (f) => join(buildDir, f);
  const binary = target === 'win'
    ? files.find((f) => f.endsWith('.exe') && f.includes('win'))
    : files.find((f) => f.includes('linux_') && !f.endsWith('.zip'));
  const resources = files.find((f) => f === 'resources.neu');
  if (!binary || !resources) {
    console.error('Could not find built artifacts in ' + buildDir + ':');
    console.error(files.join('\n'));
    process.exit(1);
  }
  return { binary: rel(binary), resources: rel(resources) };
}

// ---- 5. package: Linux AppImage -------------------------------------------
function resolveAppIcon() {
  const png = join(packagingDir, 'icon.png');
  if (existsSync(png)) return png;
  const svg = join(packagingDir, 'icon.svg');
  if (existsSync(svg)) {
    const pngOut = join(outDir, 'touchsight-ng.png');
    for (const conv of ['convert', 'magick', 'rsvg-convert']) {
      const args = conv === 'rsvg-convert'
        ? ['-w', '256', '-h', '256', svg, '-o', pngOut]
        : ['-background', 'none', '-density', '300', svg, '-resize', '256x256', pngOut];
      const r = spawnSync(conv, args, { stdio: 'ignore' });
      if (r.status === 0 && existsSync(pngOut)) return pngOut;
    }
  }
  return null;
}
function resolveAppImageTool() {
  if (process.env.APPIMAGETOOL && existsSync(process.env.APPIMAGETOOL)) return process.env.APPIMAGETOOL;
  const cached = join(homedir(), '.cache', 'appimagetool-x86_64.AppImage');
  if (existsSync(cached)) return cached;
  console.log('Downloading appimagetool (first run only)...');
  const url = 'https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage';
  const r = spawnSync('curl', ['-fL', '-o', cached, url], { stdio: 'inherit' });
  if (r.status !== 0 || !existsSync(cached)) {
    console.error('Could not download appimagetool. Set APPIMAGETOOL to a local copy and re-run.');
    process.exit(1);
  }
  return cached;
}
function buildAppImage(binary, resources) {
  const appDir = join(outDir, 'AppDir');
  rmSync(appDir, { recursive: true, force: true });
  const icons = join(appDir, 'usr', 'share', 'icons', 'hicolor', '256x256', 'apps');
  mkdirSync(icons, { recursive: true });
  copyFileSync(binary, join(appDir, 'touchsight-ng'));
  chmodSync(join(appDir, 'touchsight-ng'), 0o755);
  copyFileSync(resources, join(appDir, 'resources.neu'));
  chmodSync(join(appDir, 'resources.neu'), 0o644);

  writeFileSync(join(appDir, 'touchsight-ng.desktop'),
    '[Desktop Entry]\n' +
    'Type=Application\n' +
    'Name=TouchSight-NG\n' +
    'Comment=Turn diagrams into print-ready tactile graphics with braille labels.\n' +
    'Exec=touchsight-ng\n' +
    'Icon=touchsight-ng\n' +
    'Categories=Graphics;Office;Education;\n' +
    'Terminal=false\n');

  writeFileSync(join(appDir, 'AppRun'),
    '#!/bin/sh\n' +
    'HERE="$(dirname "$(readlink -f "$0")")"\n' +
    'cd "$HERE"\n' +
    'exec ./touchsight-ng "$@"\n');
  chmodSync(join(appDir, 'AppRun'), 0o755);

  const icon = resolveAppIcon();
  if (icon) {
    copyFileSync(icon, join(appDir, 'touchsight-ng.png'));
    copyFileSync(icon, join(icons, 'touchsight-ng.png'));
  } else {
    console.warn('No app icon found (packaging/icon.png). Continuing without a launcher icon.');
    console.warn('Generate one with ImageMagick: convert -background none packaging/icon.svg -resize 256x256 packaging/icon.png');
  }

  const tool = resolveAppImageTool();
  chmodSync(tool, 0o755);
  const appImagePath = join(outDir, 'TouchSight-NG-x86_64.AppImage');
  run(tool, ['--appimage-extract-and-run', appDir, appImagePath]);
  console.log('\nBuilt ' + appImagePath);
}

// ---- 5. package: Windows zip ----------------------------------------------
async function buildWindowsPackage(binary, resources) {
  let iconEmbedded = false;
  try {
    const icoPath = join(packagingDir, 'icon.ico');
    if (existsSync(icoPath)) {
      const require = createRequire(import.meta.url);
      const rcedit = require('rcedit');
      await rcedit(binary, { icon: icoPath });
      iconEmbedded = true;
      console.log('Embedded application icon into the exe (rcedit).');
    }
  } catch (err) {
    console.warn('Skipping icon embedding: ' + err.message);
    console.warn('To brand the exe: npm i --no-save sharp png-to-ico rcedit && node scripts/win-icon.cjs');
  }

  const stage = join(outDir, 'touchsight-ng-win-x64');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  copyFileSync(binary, join(stage, 'touchsight-ng.exe'));
  copyFileSync(resources, join(stage, 'resources.neu'));
  writeFileSync(join(stage, 'README.txt'),
    'TouchSight-NG desktop application\n\n' +
    'Keep touchsight-ng.exe and resources.neu together. Run touchsight-ng.exe;\n' +
    'the app opens in its own window and serves itself (no Node.js needed).\n');

  const zipPath = join(outDir, 'TouchSight-NG-win-x64.zip');
  run('powershell', ['-NoProfile', '-Command',
    'Compress-Archive -Path "' + stage + '\\*" -DestinationPath "' + zipPath + '" -Force']);
  console.log('\nBuilt ' + zipPath + (iconEmbedded ? '' : ' (default exe icon)'));
}

// ---- main ------------------------------------------------------------------
try {
  // 1. vendor runtime assets
  run('npm', ['run', 'vendor'], { cwd: repoRoot });

  stageResources();
  writeBuildConfig();
  let built;
  try {
    built = neuBuild();
  } finally {
    writeFileSync(cfgPath, originalCfg); // restore the dev configuration
  }

  if (target === 'linux') buildAppImage(built.binary, built.resources);
  else await buildWindowsPackage(built.binary, built.resources);
  console.log('Done.');
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
