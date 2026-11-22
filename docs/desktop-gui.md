# Desktop GUI with Neutralino

TouchSight-NG is a static, browser-based application, so the graphics pipeline
(OCR, segmentation, layout, WebGL/3D preview) runs on the user's device and no
application backend exists. By default the transcriber opens the app in a
normal browser tab. Some users prefer an application window instead, with an
icon in the taskbar or dock and no browser chrome (tabs, address bar,
bookmarks). This page describes an optional, lightweight way to get that.

## Design: system webview, not a bundled browser

The [Neutralino](https://neutralino.js.org/) wrapper in this repository does
not ship or bundle a browser engine. It opens the existing operating-system
webview:

- **Windows:** WebView2 (provided by Microsoft, preinstalled on current
  versions of Windows 10 and 11)
- **macOS:** WKWebView (part of the operating system)
- **Linux:** WebKitGTK (from the distribution, typically installed with the
  desktop environment)

The wrapper itself is a few megabytes. Nothing like the 150+ MB of Chromium
that a full Electron bundle would carry is downloaded or installed, and no
Google services, updater, or telemetry components are involved because no
Chromium is shipped at all.

TouchSight-NG's own static server (scripts/serve.mjs) still serves `src/` on
http://localhost:5173/. The Neutralino window is simply a shell pointed at that
local URL; all application code, models, and data stay on the user's machine.

## Setup

Requirements are the same as running the app in a browser (Node.js 24+), plus
one small dev dependency that is already declared in `package.json`.

1. Install dependencies and vendor the model assets as usual:

   ```bash
   npm ci
   npm run vendor
   ```

2. Download the Neutralino binaries once (per machine, a few MB; stored in
   `desktop/neutralino/bin/`, which is git-ignored):

   ```bash
   npx neu update
   ```

3. Run the app in a desktop window:

   ```bash
   npm run desktop
   ```

`npm run desktop` starts the static server, waits for it to answer, and opens
the Neutralino window. Closing the window shuts the server down.

## Files in this repository

```
desktop/
  neutralino/
    neutralino.config.json   window configuration (size, title, no native API)
    resources/index.html     placeholder shown only if the server is unreachable
scripts/
  desktop.mjs               launcher: starts serve.mjs, opens the window, cleans up
```

The window configuration sets `"enableNativeAPI": false`, so the application
runs in the webview with no access to Neutralino's filesystem, process, or OS
APIs. It can do exactly what it can do in a browser, nothing more; the static
server remains the only local surface.

## Accessibility note

Network access in the shell is limited to the local static server and the
vendored/model assets the app already fetches; the OCR, segmentation, braille,
and 3D stack behaves as it does in a browser. Because the application UI itself
is unchanged, screen-reader behavior depends on the platform webview rather
than Chromium. If a transcriber relies on a specific browser's assistive
technology integration, running the app in that browser remains fully
supported; the Neutralino window is an option, not a replacement.

## Packaging a distributable desktop app

The Neutralino shell can also be packaged into real, double-clickable
distributables - no Node.js required on the target machine, and the packaged
app serves its own resources instead of depending on localhost:5173.

```bash
npm ci
npx neu update                  # once per machine
npm run package:desktop         # linux -> AppImage, windows -> zipped exe
```

`scripts/package.mjs`:

1. Runs `npm run vendor` so the runtime asset bundle is complete.
2. Stages `src/` (except `src/dev/`) into `desktop/neutralino/resources/`.
3. Rewrites the Neutralino configuration for a standalone build
   (`enableServer: true`, `url: "/"`), then runs `neu build --release`.
4. Assembles the artifacts in `dist/`:
   - **Linux:** `TouchSight-NG-x86_64.AppImage`, built with `appimagetool`
     (downloaded on first run; executed with `--appimage-extract-and-run` so
     FUSE is not required). The AppImage includes an `AppRun`, a
     `touchsight-ng.desktop` entry and the app icon, so it can be marked
     executable and launched directly or integrated into application menus
     with an AppImage launcher.
   - **Windows:** `TouchSight-NG-win-x64.zip` containing
     `touchsight-ng.exe` + `resources.neu` (keep the two files together).
     When `packaging/icon.ico` exists and `rcedit` is installed, the
     application icon is embedded in the exe, so Explorer and the Start menu
     show TouchSight-NG's icon after extraction or shortcut creation.

### App icon

`packaging/icon.svg` is the icon source of truth. The CI workflow rasterizes
it; locally you can generate `packaging/icon.png` with ImageMagick
(`convert -background none -density 300 packaging/icon.svg -resize 256x256 packaging/icon.png`)
and, on Windows, `packaging/icon.ico` with
`npm i --no-save sharp png-to-ico && node scripts/win-icon.cjs`.
Without an icon, the package still builds; the exe keeps the stock
Neutralino icon and the window keeps no taskbar icon file.

### CI builds

`.github/workflows/desktop-packaging.yml` builds both artifacts on
`workflow_dispatch` and on `v*` tag pushes, uploads them as workflow
artifacts, and attaches them to the matching GitHub release.

### Limitations

- Windows distribution is a zip, not a signed installer; Windows SmartScreen
  will warn about unsigned executables, and code signing (a certificate plus
  eventually an MSIX/NSIS installer) is a separate, later step.
- The AppImage is x86_64 only; aarch64 builds would need ARM Neutralino
  binaries and `aarch64` `appimagetool`.
- The packaged app has the same security posture as the browser app
  (`enableNativeAPI: false`); it can reach the network the same way the
  web app does.

## If you later want an installable desktop app: Tauri

Neutralino is intentionally minimal: no packaging, signing, or auto-update
machinery. If the project ever wants distributable installers (an .msi, a
signed .dmg, an AppImage) with the same system-webview, no-Chromium design,
[Tauri 2](https://v2.tauri.app/) is the natural next step and the migration is
small because the architecture is identical (stub shell + local static server):

- Add a Rust crate that declares TouchSight-NG's Node server as a
  *sidecar* process which Tauri launches at startup and terminates on window
  close, then point the window (or a Tauri static asset) at
  http://localhost:5173/.
- Tauri's bundler then produces real installers per platform from a single
  `tauri build` command; the webview story (WebView2 / WKWebView / WebKitGTK)
  is essentially the same as Neutralino's.

Tauri requires a Rust toolchain for builds, which is why it is documented as an
option here rather than wired into the repository now. The
[sidecar and embedded-server patterns](https://v2.tauri.app/develop/sidecar/)
are covered in the Tauri documentation.
