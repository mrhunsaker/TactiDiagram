# Getting started

GitHub Pages publishes the documentation only. The browser application is run locally.

## Requirements

- Node.js 24 or newer (npm included).
- A current desktop browser with JavaScript modules, WebAssembly, and Canvas support. Packaged desktop builds additionally require Microsoft Edge WebView2 Runtime (Windows) or WebKitGTK (Linux); these runtimes are not bundled.
- WebGL for the optional 3D relief view and STL export.
- Internet access for dependency installation and initial asset preparation.
- Enough memory for in-browser OCR, segmentation, and image processing.

## 1. Clone and install

```bash
git clone https://github.com/mrhunsaker/touchsight-NG.git
cd touchsight-NG
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

## 4. Run a diagram

Choose a built-in sample or upload/drop a PNG, JPEG/JPG, or WebP image no larger than 15 MiB. The UI composites transparency onto white and scales the longest side to at most 1,400 pixels.

Loading a sample or your own scan only stages it. Set paper and outline style first, leave optional Autotrace and Indra OCR off for a baseline run, begin with tracing sensitivity 55, then press **Start analysis**. Changing analysis-affecting options (Autotrace, Indra OCR, SAM 2.1) after a run requires pressing the button again; the label shows "Apply settings & re-analyze" when settings differ from the last run. Optionally add a braille title, texture fills, or force letter keys. The processing stages are image/model preparation, OCR, leader detection, segmentation, tactile layout, and guideline checks.

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

- **Linux x86_64:** download `TouchSight-NG-x86_64.AppImage` from [Releases](https://github.com/mrhunsaker/touchsight-NG/releases), mark it executable (`chmod +x TouchSight-NG-x86_64.AppImage`), and run it. It ships an application menu entry and launcher icon. A compatible WebKitGTK runtime must be installed by the distribution; the AppImage does not bundle the system webview.
- **Windows x64:** download `TouchSight-NG-win-x64.zip` from Releases, extract it anywhere, and run `touchsight-ng.exe` (keep `resources.neu` next to it). Microsoft Edge WebView2 Runtime is required. The executable is unsigned, so Windows SmartScreen may warn at first launch.

Packaged builds carry the same version as the `vYYYY.M.D` release tag and the GitHub release they are attached to. See [Desktop app and packaging](desktop-gui.md).

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
| SAM 2.1 says WebGPU is unavailable or no adapter exists | This is a browser/OS/GPU/driver capability issue, not an upload or sample-gallery problem. Uncheck SAM 2.1 and use SlimSAM; WebGPU setup is optional and varies by browser and platform. |
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
- [Pipeline stages](pipeline.md)
- [Printing and swell paper](printing.md)
