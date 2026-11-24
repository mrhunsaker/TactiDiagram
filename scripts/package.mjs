#!/usr/bin/env node
// Package TactiDiagram as a desktop application.
//
// Usage:
//   npm run package:desktop            (auto: linux, macOS, or Windows target)
//   node scripts/package.mjs --target linux [--version 2026.11.22] [--out dist]
//   node scripts/package.mjs --target win   [--version 2026.11.22] [--out dist]
//   node scripts/package.mjs --target mac   [--version 2026.11.22] [--out dist]
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
//      - Windows: a zip with TactiDiagram.exe + resources.neu; the exe icon
//        is embedded with rcedit when available (see scripts/win-icon.cjs).
//      - macOS: a universal .app bundle, a portable ZIP, and a drag-to-install DMG.
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
//   On macOS: Xcode command-line tools (ditto, hdiutil) are provided by macOS.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync,
  rmSync, copyFileSync, chmodSync, statSync, cpSync, mkdtempSync,
} from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const neuDir = join(repoRoot, 'desktop', 'neutralino');
const packagingDir = join(repoRoot, 'packaging');

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) throw new Error(cmd + ' ' + args.join(' ') + ' failed with exit code ' + r.status);
};
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

// ---- arguments -------------------------------------------------------------
let target = process.platform === 'win32' ? 'win' : process.platform === 'linux' ? 'linux' : process.platform === 'darwin' ? 'mac' : null;
let versionArg = null;
let outArg = process.env.PACKAGE_OUT || 'dist';
const argv = process.argv.slice(2);
function option(name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(name + ' requires a value.');
  return argv[i + 1];
}
target = option('--target') || target;
versionArg = option('--version');
outArg = option('--out') || outArg;
if (!target) throw new Error('Automatic target selection supports Linux, macOS, and Windows; use --target linux, --target mac, or --target win.');
if (!['linux', 'win', 'mac'].includes(target)) {
  console.error('Unsupported target: ' + target + '. Use --target linux, --target mac, or --target win.');
  process.exit(1);
}
const SEMVER = /^[0-9]+[.][0-9]+[.][0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
if (versionArg && !SEMVER.test(versionArg)) {
  console.error('Version must be a SemVer triple (for example 2026.11.22), got: ' + versionArg);
  process.exit(1);
}

const outDir = resolve(repoRoot, outArg);

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
    throw new Error('Missing Neutralino client library: ' + clientLib + '. Run npx neu update in desktop/neutralino.');
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
  cfg.enableNativeAPI = true; // save dialogs, file writes and print handoff
  // resources.neu preserves the resources/ directory prefix. Point the
  // internal server at that directory so "/" resolves to /resources/index.html.
  // Without this, Neutralino starts its localhost server but returns 404 at "/".
  cfg.documentRoot = '/resources/';
  cfg.url = '/';
  cfg.exportAuthInfo = false;
  if (versionArg) {
    // Stamped build: the version matches the git tag and GitHub release.
    cfg.version = versionArg;
    writeFileSync(join(resDir, 'version.json'),
      JSON.stringify({ name: 'TactiDiagram', version: versionArg }, null, 2) + '\n');
  }
  if (existsSync(join(resDir, 'icon.png'))) {
    cfg.modes.window.icon = '/resources/icon.png';
  } else {
    // The checked-in Neutralino config points at ./resources/icon.png, but
    // the packaging icon is optional. Remove the stale path when no PNG was
    // staged so `neu build` does not fail while stat'ing a missing file.
    delete cfg.modes.window.icon;
  }
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

  // Fail the package step early if the generated standalone config cannot
  // serve the staged entry point, rather than shipping a blank localhost page.
  const writtenCfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  if (!writtenCfg.enableServer || writtenCfg.documentRoot !== '/resources/' || writtenCfg.url !== '/') {
    throw new Error('Invalid packaged Neutralino server configuration: expected enableServer=true, documentRoot=/resources/, and url=/.');
  }
  if (!existsSync(join(resDir, 'index.html'))) {
    throw new Error('Packaged application entry point is missing: ' + join(resDir, 'index.html'));
  }
}

// ---- 4. neu build ----------------------------------------------------------
function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (isDir(path)) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}
function neuBuild() {
  run('npx', ['neu', 'build', '--release'], { cwd: neuDir });
  const distRoot = join(neuDir, 'dist');
  if (!isDir(distRoot)) throw new Error('Neutralino did not create ' + distRoot);
  const files = walk(distRoot);
  const resources = files.find((path) => basename(path) === 'resources.neu');
  const binaryPattern = target === 'win' ? /win_x64\.exe$/i : target === 'mac' ? /mac_universal$/i : /linux_x64$/i;
  const binary = files.find((path) => binaryPattern.test(basename(path)));
  if (!binary || !resources) {
    throw new Error('Could not find target x86_64 binary and resources.neu under ' + distRoot +
      '. Found:\\n' + files.join('\\n'));
  }
  if (dirname(binary) !== dirname(resources)) {
    throw new Error('Neutralino binary and resources.neu are not in the same directory.');
  }
  return { binary, resources };
}

// ---- 5. package: Linux AppImage -------------------------------------------
function resolveAppIcon() {
  const png = join(packagingDir, 'icon.png');
  if (existsSync(png)) return png;
  const svg = join(packagingDir, 'icon.svg');
  if (existsSync(svg)) {
    const pngOut = join(outDir, 'TactiDiagram.png');
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
  mkdirSync(dirname(cached), { recursive: true });
  const r = spawnSync('curl', ['-fL', '-o', cached, url], { stdio: 'inherit' });
  if (r.status !== 0 || !existsSync(cached)) {
    console.error('Could not download appimagetool. Set APPIMAGETOOL to a local copy and re-run.');
    throw new Error('Could not download appimagetool. Set APPIMAGETOOL to a local copy and re-run.');
  }
  return cached;
}
function buildAppImage(binary, resources) {
  const appDir = join(outDir, 'AppDir');
  rmSync(appDir, { recursive: true, force: true });
  const icons = join(appDir, 'usr', 'share', 'icons', 'hicolor', '256x256', 'apps');
  mkdirSync(icons, { recursive: true });
  copyFileSync(binary, join(appDir, 'TactiDiagram'));
  chmodSync(join(appDir, 'TactiDiagram'), 0o755);
  copyFileSync(resources, join(appDir, 'resources.neu'));
  chmodSync(join(appDir, 'resources.neu'), 0o644);

  writeFileSync(join(appDir, 'TactiDiagram.desktop'),
    '[Desktop Entry]\n' +
    'Type=Application\n' +
    'Name=TactiDiagram\n' +
    'Comment=Turn diagrams into print-ready tactile graphics with braille labels.\n' +
    'Exec=TactiDiagram\n' +
    'Icon=TactiDiagram\n' +
    'Categories=Graphics;Office;Education;\n' +
    'Terminal=false\n');

  writeFileSync(join(appDir, 'AppRun'),
    '#!/bin/sh\n' +
    'HERE="$(dirname "$(readlink -f "$0")")"\n' +
    'cd "$HERE"\n' +
    'exec ./TactiDiagram "$@"\n');
  chmodSync(join(appDir, 'AppRun'), 0o755);

  const icon = resolveAppIcon();
  if (icon) {
    copyFileSync(icon, join(appDir, 'TactiDiagram.png'));
    copyFileSync(icon, join(icons, 'TactiDiagram.png'));
  } else {
    console.warn('No app icon found (packaging/icon.png). Continuing without a launcher icon.');
    console.warn('Generate one with ImageMagick: convert -background none packaging/icon.svg -resize 256x256 packaging/icon.png');
  }

  const tool = resolveAppImageTool();
  chmodSync(tool, 0o755);
  const appImagePath = join(outDir, 'TactiDiagram-x86_64.AppImage');
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
      const rceditModule = require('rcedit');
      const rcedit = typeof rceditModule === 'function'
        ? rceditModule
        : (typeof rceditModule.rcedit === 'function'
          ? rceditModule.rcedit
          : rceditModule.default);
      if (typeof rcedit !== 'function') {
        throw new Error('The installed rcedit package does not expose a callable rcedit function.');
      }
      await rcedit(binary, { icon: icoPath });
      iconEmbedded = true;
      console.log('Embedded application icon into the exe (rcedit).');
    }
  } catch (err) {
    console.warn('Skipping icon embedding: ' + err.message);
    console.warn('To brand the exe: npm i --no-save sharp png-to-ico rcedit && node scripts/win-icon.cjs');
  }

  const stage = join(outDir, 'TactiDiagram-win-x64');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  copyFileSync(binary, join(stage, 'TactiDiagram.exe'));
  copyFileSync(resources, join(stage, 'resources.neu'));
  writeFileSync(join(stage, 'README.txt'),
    'TactiDiagram desktop application\n\n' +
    'Keep TactiDiagram.exe and resources.neu together. Run TactiDiagram.exe;\n' +
    'the app opens in its own window and serves itself (no Node.js needed).\n');

  const zipPath = join(outDir, 'TactiDiagram-win-x64.zip');
  run('powershell', ['-NoProfile', '-Command',
    'Compress-Archive -Path "' + stage + '\\*" -DestinationPath "' + zipPath + '" -Force']);
  console.log('\nBuilt ' + zipPath + (iconEmbedded ? '' : ' (default exe icon)'));
}


// ---- 5. package: macOS universal app, ZIP, and DMG -------------------------
function buildMacPackage(binary, resources) {
  const appPath = join(outDir, 'TactiDiagram.app');
  const contents = join(appPath, 'Contents');
  const macOS = join(contents, 'MacOS');
  mkdirSync(macOS, { recursive: true });
  copyFileSync(binary, join(macOS, 'TactiDiagram'));
  chmodSync(join(macOS, 'TactiDiagram'), 0o755);
  // Keep resources.neu beside the executable: this is the layout emitted by
  // Neutralino's native macOS build and is resolved relative to the binary.
  copyFileSync(resources, join(macOS, 'resources.neu'));

  const version = versionArg || JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    '<key>CFBundleDevelopmentRegion</key><string>en</string>',
    '<key>CFBundleExecutable</key><string>TactiDiagram</string>',
    '<key>CFBundleIdentifier</key><string>org.hunsakerweb.tactidiagram</string>',
    '<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>',
    '<key>CFBundleName</key><string>TactiDiagram</string>',
    '<key>CFBundleDisplayName</key><string>TactiDiagram</string>',
    '<key>CFBundlePackageType</key><string>APPL</string>',
    '<key>CFBundleShortVersionString</key><string>' + version + '</string>',
    '<key>CFBundleVersion</key><string>' + version + '</string>',
    '<key>LSMinimumSystemVersion</key><string>10.13</string>',
    '<key>NSHighResolutionCapable</key><true/>',
    '</dict></plist>',
    '',
  ].join('\\n');
  writeFileSync(join(contents, 'Info.plist'), plist);
  writeFileSync(join(contents, 'PkgInfo'), 'APPL????');

  const zipPath = join(outDir, 'TactiDiagram-macOS-universal.zip');
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath]);

  const dmgStage = join(outDir, 'TactiDiagram-dmg-stage');
  rmSync(dmgStage, { recursive: true, force: true });
  mkdirSync(dmgStage, { recursive: true });
  run('ditto', [appPath, join(dmgStage, 'TactiDiagram.app')]);
  run('ln', ['-s', '/Applications', join(dmgStage, 'Applications')]);
  const dmgPath = join(outDir, 'TactiDiagram-macOS-universal.dmg');
  run('hdiutil', ['create', '-volname', 'TactiDiagram', '-srcfolder', dmgStage, '-ov', '-format', 'UDZO', dmgPath]);
  rmSync(dmgStage, { recursive: true, force: true });
  console.log('\\nBuilt ' + appPath + ', ' + zipPath + ', and ' + dmgPath);
}

// ---- main ------------------------------------------------------------------
const backupRoot = mkdtempSync(join(tmpdir(), 'tactidiagram-package-'));
const resourceBackup = join(backupRoot, 'resources');
const hadResources = existsSync(resDir);
if (hadResources) cpSync(resDir, resourceBackup, { recursive: true });
mkdirSync(outDir, { recursive: true });
try {
  run('npm', ['run', 'vendor'], { cwd: repoRoot });
  stageResources();
  writeBuildConfig();
  const built = neuBuild();
  if (target === 'linux') buildAppImage(built.binary, built.resources);
  else if (target === 'mac') buildMacPackage(built.binary, built.resources);
  else await buildWindowsPackage(built.binary, built.resources);
  console.log('Done.');
} catch (err) {
  console.error(err.message || err);
  process.exitCode = 1;
} finally {
  writeFileSync(cfgPath, originalCfg);
  rmSync(resDir, { recursive: true, force: true });
  if (hadResources) cpSync(resourceBackup, resDir, { recursive: true });
  rmSync(backupRoot, { recursive: true, force: true });
}
