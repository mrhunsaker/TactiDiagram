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
- **macOS:** WKWebView, provided by the operating system. Releases include a
  universal macOS app bundle for Intel and Apple silicon, a portable ZIP, and
  a drag-to-install DMG.
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

## Optional SAM 2.1 / WebGPU in the desktop window

The Windows desktop window uses the installed Microsoft Edge WebView2 runtime, so SAM 2.1 may be available when that runtime is current and Windows exposes a compatible WebGPU adapter. Its availability still depends on graphics acceleration, GPU drivers, and ONNX Runtime compatibility. The Linux desktop window uses WebKitGTK and is not a supported SAM 2.1 target; use the browser app in Chrome or Edge for the experimental backend. SlimSAM/WASM remains the default and automatic fallback. See [WebGPU setup and browser compatibility](webgpu.md).

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
npm i --no-save sharp png-to-ico rcedit
npx neu update                  # once per machine
node scripts/win-icon.cjs       # generate packaging/icon.ico before packaging
npm run package:desktop -- --target win --version 2026.11.22
choco install nsis --yes
makensis /DAPP_VERSION=2026.11.22 packaging/windows/TactiDiagram.nsi
```

The release tag is the source of truth for the build version. On a valid tag,
GitHub Actions opens a pull request to update `package.json` and
`package-lock.json` on the default branch to the tag-derived version when they
differ, then stamps that version into the release artifacts. Configure the
repository Actions secret `RELEASE_PR_TOKEN` with a fine-grained token granting
Contents (read/write) and Pull requests (read/write) access so the workflow can
create or update that PR. Merge the PR to align the default branch metadata.
You do not need to edit the package version before tagging:

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
   - **Windows:** `TactiDiagram-win-x64.zip` containing `TactiDiagram.exe`
     and `resources.neu`, plus `TactiDiagram-Setup.exe` compiled from
     `packaging/windows/TactiDiagram.nsi`. The installer installs both runtime
     files together, creates desktop and Start Menu shortcuts, and registers
     an uninstaller in the current user's Apps/installed-applications list.
     It defaults to `%LOCALAPPDATA%\Programs\TactiDiagram` and does not
     request administrator elevation. The portable ZIP remains available.
     `scripts/win-icon.cjs` generates the multi-size icon and `rcedit`
     embeds it in the application executable.
   - **macOS:** `TactiDiagram.app` is a standard app bundle containing the
     universal Neutralino executable and its `resources.neu` payload.
     `TactiDiagram-macOS-universal.zip` preserves the app bundle for portable
     extraction and direct launch. `TactiDiagram-macOS-universal.dmg` contains
     the same app plus an `/Applications` shortcut for drag-to-install. The
     universal executable supports both Intel and Apple-silicon Macs.

### macOS app bundle and disk image

The macOS package uses Neutralino's universal Darwin executable
(`mac_universal`), so one build runs natively on Intel and Apple-silicon Macs.
The packaging script creates `dist/TactiDiagram.app` with an `Info.plist`,
the executable, and its adjacent `resources.neu` payload. It then creates:

- `TactiDiagram-macOS-universal.zip`: a portable archive containing the
  `.app` bundle. Extract it and move or launch the app from the extracted
  location.
- `TactiDiagram-macOS-universal.dmg`: a compressed disk image containing the
  same `.app` bundle and an `/Applications` alias. Open the image and drag
  TactiDiagram into Applications to install it.

Local macOS build (run from the repository root):

```bash
npm ci
npx neu update
node scripts/package.mjs --target mac --version 2026.11.23
```

The script uses macOS-provided `ditto`, `ln`, and `hdiutil`; no third-party
installer compiler is required. `--target mac` is also selected automatically
when `npm run package:desktop` is run on macOS. The outputs are written to
`dist/`.

The current artifacts are not code-signed or notarized. Gatekeeper may block
the first launch when the app is downloaded from the internet; users may need
to Control-click the app, choose **Open**, and confirm the macOS prompt.
Signing and notarization require an Apple Developer identity and are not
configured in this workflow.

### How the NSIS installer is constructed

NSIS is the installer compiler and runtime; it does not build the TactiDiagram
application itself. The application is first built by Neutralino, then the
NSIS script packages that build into a conventional Windows setup executable.

The build has two distinct stages:

1. **Build the application payload.** `scripts/package.mjs` vendors the
   browser libraries and models, stages `src/` into Neutralino's resources,
   configures Neutralino to serve the embedded `resources.neu` archive, and
   runs `neu build --release`. It produces the Windows x64 executable and
   `resources.neu` side by side. The Windows packaging step also generates
   `TactiDiagram-win-x64.zip` for users who prefer a portable, extraction-only
   distribution. `scripts/win-icon.cjs` creates a multi-resolution ICO from
   `packaging/icon.svg`; `rcedit` embeds that icon into the executable.

2. **Compile the installer.** The Windows workflow installs NSIS with
   Chocolatey, then invokes `makensis.exe` on
   `packaging/windows/TactiDiagram.nsi`, passing the release version as
   `/DAPP_VERSION=...`. The NSIS script includes `MUI2.nsh` for the standard
   welcome, install-directory, Start Menu, progress, and uninstall pages. Its
   `File` instructions copy the executable, `resources.neu`, bundled
   README, and icon into the selected install directory; NSIS writes
   `Uninstall.exe` there as well.

The installer policy is intentionally conservative:

- **Per-user, no elevation:** `RequestExecutionLevel user`; the default
  destination is `$LOCALAPPDATA\Programs\TactiDiagram`.
- **Upgrade-aware destination:** `InstallDirRegKey` reads the previous
  `InstallLocation` from the per-user uninstall registration.
- **Shortcuts:** a desktop launch shortcut plus Start Menu launch and
  uninstall shortcuts are created for the current user.
- **Windows app registration:** version, publisher, install location, display
  icon, and quoted uninstall commands are written beneath
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\TactiDiagram`.
- **Scoped cleanup:** uninstall deletes the known application files and
  shortcuts, removes the app's uninstall registration, and removes its
  Start Menu folder only if empty. It does not recursively erase the install
  directory, so unexpected or user-created files are preserved.

A local Windows build can reproduce the CI sequence (run from the repository
root; use the same version for the app and installer):

```powershell
npm ci
npm install --no-save sharp png-to-ico rcedit
npx neu update
node scripts/win-icon.cjs
node scripts/package.mjs --target win --version 2026.11.23
choco install nsis --yes
& "${env:ProgramFiles(x86)}\NSIS\makensis.exe" /DAPP_VERSION=2026.11.23 packaging/windows/TactiDiagram.nsi
```

The compiler writes `dist/TactiDiagram-Setup.exe`. The script's
`OutFile` setting points there, and its `APP_VERSION` define stamps the
installer's Windows file metadata and Add/Remove Programs version. The
version-tag workflow validates `vYYYY.MM.DD` and the matching
`package.json` version before creating release artifacts. Pull requests
compile the installer on `windows-latest` as a validation check but do not
run the release job. Only a valid version-tag push publishes a GitHub Release.

### App icon

`packaging/icon.svg` is the icon source of truth. The CI workflow generates `packaging/icon.png` and `packaging/icon.ico` from
this source on Windows; locally you can generate the Windows assets with
`npm i --no-save sharp png-to-ico && node scripts/win-icon.cjs`.
Without an icon, the package still builds; the exe keeps the stock
Neutralino icon, and the window has no custom taskbar icon.

### CI builds

`.github/workflows/desktop-packaging.yml` validates packaging scripts and
builds the documentation on relevant pull requests. Desktop artifacts are
built only on release tags; there is no manual release dispatch. The tag must follow
the `vYYYY.MM.DD` format (for example `v2026.11.22`); anything else fails the
build. On a matching tag the workflow:

1. validates the tag format and calendar date, then synchronizes
   `package.json` and `package-lock.json` on the default branch to the
   tag-derived version (`v2026.11.22` -> `2026.11.22`);
2. stamps that version into the packaged builds (`neutralino.config.json`,
   `resources/version.json`, and the Windows installer metadata);
3. builds the Linux AppImage, Windows portable ZIP plus NSIS installer, and
   macOS universal app ZIP plus DMG independently, uploads the artifacts, then
   one release job attaches all platform artifacts after every build succeeds.

Pull requests that touch packaging sources also compile the Windows installer
on a Windows runner and build the macOS app bundle, portable ZIP, and DMG on a
macOS runner. Pull requests do not publish releases. The release job
runs only for the version-tag push event; ordinary branch pushes do not build
or publish release artifacts.

To release: move the `CHANGES.md` `[Unreleased]` entries under a heading named
for the release date, create and push a tag such as `v2026.11.23`. The workflow
opens a pull request to update `package.json` and `package-lock.json` when
needed; merge that PR after its required checks pass. Do not manually change the
package version before tagging.

### Limitations

- Windows installer and portable ZIP are currently unsigned. SmartScreen may
  warn at download or first launch. The target machine needs Microsoft Edge
  WebView2 Runtime. The NSIS installer is per-user and does not elevate.
- The macOS app is universal (Intel x86_64 and Apple arm64) but is unsigned and not notarized.
- The AppImage is x86_64 only; aarch64 builds would need ARM Neutralino
  binaries and `aarch64` `appimagetool`.
- The packaged app reaches the network the same way the web app does. Its
  native-API access is limited to the `nativeAllowList` (dialogs, file
  writes, opening a file with the system browser).

## Future packaging options: Tauri

Neutralino remains intentionally minimal. This repository already provides a
basic x86_64 Linux AppImage, a portable Windows ZIP, and a per-user NSIS
Windows installer. The installer handles basic install/uninstall and shortcuts,
but the binaries are unsigned and there is no automatic updater. If the
project later wants integrated signing and update machinery
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
