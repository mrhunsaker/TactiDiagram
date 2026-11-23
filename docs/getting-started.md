# Getting started

GitHub Pages publishes the documentation only. The browser application is run locally.

## Requirements

- Node.js 24 or newer (npm included).
- A **Chromium-based desktop browser** (Chrome, Edge, Brave, Chromium) with JavaScript modules, WebAssembly, and Canvas support is recommended. Firefox runs the standard application and SlimSAM, but TactiDiagram deliberately disables SAM 2.1 on Firefox because of an ONNX Runtime WebGPU compatibility issue. Safari and other WebKit browsers are not supported application targets. Packaged desktop builds additionally require Microsoft Edge WebView2 Runtime (Windows) or WebKitGTK (Linux); these runtimes are not bundled.
- WebGL for the optional 3D relief view and STL export.
- Internet access for dependency installation and initial asset preparation.
- Enough memory for in-browser OCR, segmentation, and image processing.

## 1. Clone and install

```bash
git clone https://github.com/mrhunsaker/TactiDiagram.git
cd TactiDiagram
npm ci
```

`npm ci` installs the exact dependency tree in `package-lock.json`. It does not populate all browser model assets.

## 2. Prepare browser assets and models

```bash
npm run vendor
```

The vendor script copies browser libraries into `src/vendor/` and downloads model assets into `src/models/`. It prepares OpenCV.js, Tesseract.js and English traineddata, Transformers.js, ONNX Runtime Web, three.js, SlimSAM, optional SAM 2.1 Hiera Tiny files (about 78 MB), PaddleOCR, optional Indra OCR files, and the Potrace runtime/license notice. Existing nonempty downloaded files are skipped. If a specific generated file is corrupt or incomplete, remove that file and rerun the command.

Generated browser libraries and model weights are local runtime output, not application source. Do not commit them unless a deliberate distribution policy requires it.

## 3. Start the app

```bash
npm run serve
```

The static server serves the tracked `src/` directory. Its default address is `http://localhost:5173`; keep the terminal open. To change the port, set `PORT` before starting (for example, `PORT=8080 npm run serve` on macOS/Linux).

## Optional SAM 2.1 / WebGPU setup

WebGPU is not required for TactiDiagram's default SlimSAM/WASM segmentation. To try the optional SAM 2.1 backend, use current Chrome or Edge on a platform with a compatible GPU adapter, enable hardware acceleration, restart the browser, and confirm WebGPU is available on the browser's internal GPU page (`chrome://gpu` or `edge://gpu`). Then check **Use experimental SAM 2.1 segmentation (WebGPU)** in the app before starting analysis. See the [WebGPU setup and browser compatibility guide](webgpu.md) for browser-specific instructions, Firefox limitations, operating-system notes, and troubleshooting. A browser reporting WebGPU support does not guarantee that every ONNX Runtime model operator will run; the app falls back to SlimSAM if SAM 2.1 fails.

## 4. Run a diagram

Choose a built-in sample or upload/drop a PNG, JPEG/JPG, or WebP image no larger than 15 MiB. The UI composites transparency onto white and scales the longest side to at most 1,400 pixels.

Loading a sample or your own scan only stages it. Set paper and outline style first, leave optional Autotrace and Indra OCR off for a baseline run, begin with tracing sensitivity 55, then press **Start analysis**. Changing analysis-affecting options (Autotrace, Indra OCR, SAM 2.1, or direct Potrace output) after a run requires pressing the button again; the label shows "Apply settings & re-analyze" when settings differ from the last run. Optionally add a braille title, texture fills, or force letter keys.

For a baseline, leave both Potrace options off. Enable **Use Autotrace (Potrace)** when you want a reconstructed raster to feed OCR, leader detection, and segmentation. Enable **Use direct Potrace SVG output (full analysis)** when you want complete analysis and tactile layout but prefer a monochrome transparent outline trace as the primary artwork. These controls can be combined: Autotrace changes the analysis input, while direct output always traces the original uploaded image. Enable **Use letter keys for every label** to make every placed label a two-letter braille key with a corresponding key page; this also works in direct Potrace mode.

The standard processing sequence is image/model preparation, OCR, leader detection, foreground/structural-line analysis, SAM segmentation, tactile layout, and guideline checks. Direct Potrace tracing is an additional output stage after layout; it does not skip OCR, leader detection, or segmentation.

Read [Application controls and options](application-options.md) for the exact effect of every control, tab, review action, and export.

## 5. Review and export

Correct every detected label against the source. Inspect **What the AI saw** for OCR boxes, leader endpoints, and masks. Compare Detailed and Simplified styles where the drawing is crowded. Review braille, key mappings, textures, line spacing, page size, and automated checks. The app cannot currently add a label that OCR entirely missed.

Exports are editable tactile SVG, key-page SVG, browser Print/PDF, and STL from the 3D relief tab. For swell paper, print at 100% / actual size, photocopy onto swell paper, and follow the fuser manufacturer's procedure. See [Printing and swell paper](printing.md).

## Desktop windows and installation

Two desktop options are available after npm installation and asset preparation.

**Run from the repository (no installation):**

```bash
npx neu update
npm run desktop
```

This downloads Neutralino binaries into the ignored `desktop/neutralino/bin/` directory and opens the same local app in the operating system webview. See [Desktop GUI](desktop-gui.md).

**Or install a packaged build (no Node.js needed on the target machine):**

- **Linux x86_64:** download `TactiDiagram-x86_64.AppImage` from [Releases](https://github.com/mrhunsaker/TactiDiagram/releases), mark it executable (`chmod +x TactiDiagram-x86_64.AppImage`), and run it. It ships an application menu entry and launcher icon. A compatible WebKitGTK runtime must be installed by the distribution; the AppImage does not bundle the system webview.
- **Windows x64 (recommended):** download `TactiDiagram-Setup.exe` from [Releases](https://github.com/mrhunsaker/TactiDiagram/releases) and run it. It installs per-user, creates a desktop shortcut and a Start Menu item, and registers an uninstaller; administrator privileges are not required. Microsoft Edge WebView2 Runtime is required. The installer is currently unsigned, so Windows SmartScreen may display a warning.
- **Windows x64 (portable):** download `TactiDiagram-win-x64.zip`, extract it anywhere, and run `TactiDiagram.exe`. Keep `resources.neu` beside the executable.

Packaged builds carry the same version as the `vYYYY.M.D` release tag and the GitHub release they are attached to. GitHub Actions publishes releases only when a matching version tag is pushed; pull requests validate the installer build but never publish a release. See [Desktop app and packaging](desktop-gui.md).

## Evaluation

Install Playwright Chromium once:

```bash
npx playwright install chromium
```

Run `npm run serve` in one terminal, then in another:

```bash
npm run eval
node scripts/recall.mjs
```

Generated output is written under `eval-out/`. The harness measures selected geometric metrics and label recall; it is not a tactile-reader usability study. See [Evaluation](evaluation.md).

## Troubleshooting

| Symptom | Check |
|---|---|
| Server fails | Use Node.js 24+, run from repository root, check whether port 5173 is occupied. |
| Library/model missing | Run `npm run vendor`; inspect `src/vendor/`, `src/models/`, and browser console. |
| Vendor download fails | Check network access. Remove only the known-bad generated file before retrying because nonempty files are skipped. |
| PaddleOCR fails | The pipeline attempts Tesseract fallback; inspect console errors. |
| Indra unavailable | Confirm detector, recognizer, metadata, and license files in `src/models/indra/`; fallback should continue to PaddleOCR. |
| SlimSAM fails | Confirm both SlimSAM ONNX files and Transformers.js/ONNX Runtime assets exist. |
| SAM 2.1 is unavailable, falls back to SlimSAM, or WebGPU errors appear | Follow the [WebGPU setup guide](webgpu.md). Check hardware acceleration and the browser GPU page; Firefox is intentionally routed to SlimSAM. TactiDiagram automatically retries with SlimSAM if SAM 2.1 initialization or inference fails. |
| 3D view blank | Check WebGL/browser/GPU support; SVG and Print/PDF do not need WebGL. |
| Upload rejected | Use PNG/JPEG/WebP under 15 MiB. |
| Print dimensions wrong | Print at actual size and disable fit-to-page/shrink-to-fit. |

## Privacy and network behavior

Image decoding, OCR, segmentation, layout, checking, and rendering run in the browser. There is no application backend or image-upload endpoint. Initial setup downloads npm dependencies, browser libraries, and model files. OpenCV has a version-pinned jsDelivr fallback in `src/js/libs.js` if its local bundle is unavailable; that fetches library code, not source-image pixels. Normal browser/network infrastructure and setup downloads still apply.

## Further reading

- [Application controls and options](application-options.md)
- [Transcriber review workflow](review-workflow.md)
- [Tactile layout and BANA guidelines](guidelines.md)
- [Models and inference engines](models-and-engines.md)
- [WebGPU browser setup](webgpu.md)
- [Pipeline stages](pipeline.md)
- [Printing and swell paper](printing.md)
