# Desktop GUI with Neutralino

TactiDiagram is a static, browser-based application, so the graphics pipeline
(OCR, segmentation, layout, WebGL/3D preview) runs on the user's device and no
application backend exists. By default the transcriber opens the app in a
normal browser tab. Some users prefer an application window instead, with an
icon in the taskbar or dock and no browser chrome (tabs, address bar,
bookmarks). This page describes an optional, lightweight way to get that.

## Design: system webview, not a bundled browser

The [Neutralino](https://neutralino.js.org/) wrapper in this repository does
not ship or bundle a browser engine. It opens the existing operating-system
webview:

- **Windows:** Microsoft Edge WebView2 Runtime. It is preinstalled on most
  current Windows 10/11 systems; managed, LTSC, or stripped-down images may
  need the [Evergreen WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).
- **macOS:** WKWebView, provided by the operating system. macOS is not a
  packaged release target at present.
- **Linux:** WebKitGTK, which must be installed from the distribution's
  packages (commonly named webkit2gtk or webkit2gtk-4.1).

The wrapper itself is a few megabytes. Nothing like the 150+ MB of Chromium
that a full Electron bundle would carry is downloaded or installed, and no
Google services, updater, or telemetry components are involved because no
Chromium is shipped at all.

For repository development, scripts/serve.mjs serves http://localhost:5173/
and the npm run desktop launcher points Neutralino at that server. Packaged
builds instead embed the application in resources.neu and enable Neutralino's
own resource server; they do not start or depend on the development server.

## Setup

Repository-launched development requires Node.js 24+, npm dependencies,
vendored browser assets, and the platform webview. Packaged end users do not
need Node.js or npm, but still need WebView2 (Windows) or WebKitGTK (Linux).

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
    neutralino.config.json   window configuration (size, title, restricted native API list)
    resources/index.html     placeholder shown only if the server is unreachable
scripts/
  desktop.mjs               launcher: starts serve.mjs, opens the window, cleans up
```

The window configuration enables Neutralino's native API with a restricted
`nativeAllowList` (save/open dialogs, file writes, opening a file with the
system browser and app metadata), and nothing else. Process, extensions and
all other native namespaces stay blocked: the app can save the tactile SVG,
key page and STL through a native Save dialog and hand the print view to the
default browser, but it can run no arbitrary commands; the static server
remains the only other local surface.

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

The version can be stamped into the build so it matches the git tag and the
GitHub release. The release workflow verifies that `package.json` matches
the tag-derived version before building:

```bash
node scripts/package.mjs --target linux --version 2026.11.22 --out dist
```

`scripts/package.mjs`:

1. Runs `npm run vendor` so the runtime asset bundle is complete.
2. Backs up the existing Neutralino resources directory, stages `src/`
   (except `src/dev/`) into `desktop/neutralino/resources/`, then restores
   the original resources and development configuration even if packaging fails.
3. Rewrites the Neutralino configuration for a standalone build
   (`enableServer: true`, `documentRoot: "/resources/"`, `url: "/"`), then
   runs `neu build --release`. The explicit document root is required because
   the bundled files retain their `resources/` prefix; without it, the app can
   open its localhost server but return a 404 for the root page. The packaging
   script verifies this configuration and the staged `resources/index.html`
   before building. It locates the target x86_64 binary and `resources.neu` by
   filename anywhere under Neutralino's `dist/` output and verifies they are
   siblings.
4. Assembles artifacts in the selected output directory (default `dist/`).
   The `--out` option accepts a relative or absolute directory; `PACKAGE_OUT`
   is also supported as an environment-variable override. Automatic target
   selection is supported only on Linux and Windows.
   - **Linux:** `TactiDiagram-x86_64.AppImage`, built with `appimagetool`
     (downloaded on first run; executed with `--appimage-extract-and-run` so
     FUSE is not required). The AppImage includes an `AppRun`, a
     `TactiDiagram.desktop` entry and the app icon, so it can be marked
     executable and launched directly or integrated into application menus
     with an AppImage launcher.
   - **Windows:** `TactiDiagram-win-x64.zip` containing
     `TactiDiagram.exe` + `resources.neu` (keep the two files together).
     When `packaging/icon.ico` exists and `rcedit` is installed, the
     application icon is embedded in the exe, so Explorer and the Start menu
     show TactiDiagram's icon after extraction or shortcut creation.

### App icon

`packaging/icon.svg` is the icon source of truth. The CI workflow rasterizes
it; locally you can generate `packaging/icon.png` with ImageMagick
(`convert -background none -density 300 packaging/icon.svg -resize 256x256 packaging/icon.png`)
and, on Windows, `packaging/icon.ico` with
`npm i --no-save sharp png-to-ico && node scripts/win-icon.cjs`.
Without an icon, the package still builds; the exe keeps the stock
Neutralino icon, and the window has no custom taskbar icon.

### CI builds

`.github/workflows/desktop-packaging.yml` validates packaging scripts and
builds the documentation on relevant pull requests. Desktop artifacts are
built only on release tags; there is no manual release dispatch. The tag must follow
the `vYYYY.M.D` format (for example `v2026.11.22`); anything else fails the
build. On a matching tag the workflow:

1. validates the tag format and verifies `package.json` matches the tag-derived
   version (`v2026.11.22` -> `2026.11.22`);
2. stamps that version into the packaged builds (`neutralino.config.json`
   and `resources/version.json`);
3. builds the Linux AppImage and Windows ZIP independently, uploads both as
   workflow artifacts, then one release job attaches both after both builds
   succeed.

To release: move the `CHANGES.md` `[Unreleased]` entries under a heading named
for the tag and dated, set the same version in `package.json`, tag `vYYYY.M.D`,
and push the tag.

### Limitations

- Windows distribution is an unsigned ZIP with a portable executable and
  resources.neu, not an installer. SmartScreen may warn at first launch. The
  target machine needs Microsoft Edge WebView2 Runtime.
- The AppImage is x86_64 only; aarch64 builds would need ARM Neutralino
  binaries and `aarch64` `appimagetool`.
- The packaged app reaches the network the same way the web app does. Its
  native-API access is limited to the `nativeAllowList` (dialogs, file
  writes, opening a file with the system browser).

## If you later want an installable desktop app: Tauri

Neutralino remains intentionally minimal. This repository now provides a
basic x86_64 Linux AppImage and portable unsigned Windows ZIP, but not signed
installers, automatic updates, or a managed installer experience. If the
project later wants more complete installer, signing, and update machinery
with the same system-webview, no-Chromium design,
[Tauri 2](https://v2.tauri.app/) is the natural next step and the migration is
small because the architecture is identical (stub shell + local static server):

- Add a Rust crate that declares TactiDiagram's Node server as a
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

### Saving and printing in the desktop app

The desktop shell runs the app in a WebView, which does not support browser-style
downloads or pop-up windows. In the packaged app:

- **Save SVG / key page / STL** opens the system Save As dialog and writes the real
  file where you choose.
- **Print / PDF** writes a page-sized print view to a temporary HTML file and opens
  it in your default browser. Print or Save as PDF from there; the browser is not
  restricted by the app's WebView.

When running from a repo checkout in a normal browser, the standard download links
and new-tab printing are used instead. This works because the packaged build enables
Neutralino's native API with a restricted allow list (`enableNativeAPI: true` plus a
`nativeAllowList` limited to dialogs, file I/O and opening files); the script in
`scripts/package.mjs` sets this up in the build config automatically.
