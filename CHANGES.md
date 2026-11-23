# Changelog

All notable changes to TactiDiagram are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses calendar-style versions. Git tags and GitHub releases
use the strict `vYYYY.MM.DD` format (for example `v2026.11.22`). The tag is
the source of truth; the release workflow synchronizes `package.json` and
`package-lock.json` on the default branch to the corresponding SemVer triple.

## [21026.11.23]

### Fixed
- SAM 2.1 (WebGPU) segmentation: Transformers.js v4 runs the full image
  preprocess on every processor call, so building point prompts with
  `processor(null, ...)` (the v3 pattern) crashed with
  "Cannot read properties of null (reading 'size')". Point-prompt tensors are
  now built from the cached embed-step dimensions, and the multi-level image
  embeddings are cached so per-label prompts no longer rerun the encoder.
- Code scanning (`js/insecure-randomness`): the vendored Tesseract.js bundle
  used `Math.random()` for non-cryptographic task IDs. `npm run vendor` now
  rewrites that call with a deterministic counter, and vendored third-party
  code is excluded from CodeQL scanning.

### Added
- Windows distribution now includes a per-user NSIS installer (`TactiDiagram-Setup.exe`) alongside the existing portable ZIP. The Neutralino build produces the `TactiDiagram.exe` + `resources.neu` payload; `makensis.exe` compiles `packaging/windows/TactiDiagram.nsi` into the setup program with the release version supplied as `APP_VERSION`. The script uses MUI2 install-directory and Start Menu pages, defaults to `%LOCALAPPDATA%\Programs\TactiDiagram`, registers Add/Remove Programs metadata under HKCU, creates desktop/Start Menu shortcuts, and writes an uninstaller that removes only known app files and shortcuts. It does not elevate and preserves unexpected files in the install directory. The tag-only desktop release workflow attaches the installer and portable ZIP to GitHub Releases; pull requests compile-check the installer on Windows but never publish releases.
- Direct Potrace SVG output now runs the complete analysis and segmentation pipeline, then replaces segmented diagram artwork with monochrome object-outline paths traced from the original source. The exported SVG has a transparent background, no source colour fills, and independent braille label layers; it uses the normal tactile layout, supports two-letter keys for every label, and retains the standard key-page export.
- Desktop packaging: `npm run package:desktop` (`scripts/package.mjs`)
  builds the existing Neutralino shell into distributable artifacts - an
  AppImage (`TactiDiagram-x86_64.AppImage`) on Linux and a zipped,
  icon-embedded `TactiDiagram.exe` bundle on Windows, both serving the app
  without Node.js. A new `packaging/icon.svg` provides the app icon, and
  `.github/workflows/desktop-packaging.yml` builds both artifacts only on
  release tags. Tags use the `vYYYY.MM.DD` format (for example
  `v2026.11.22`); the workflow validates that format, synchronizes the package
  version (`v2026.11.22` -> `2026.11.22`) on the default branch, and stamps it
  into the packaged app so tag, build,
  and GitHub release agree, and attaches both artifacts to the release.
- Explicit start: loading an image or sample and changing options no longer
  starts processing on its own. A "Start analysis" button in the Output
  options panel begins the pipeline when the user is ready; after a run, the
  same button reads "Apply settings & re-analyze" when settings changed.
  Sensitivity-only changes still reuse OCR and segmentation. Sample deep
  links (?sample=...) keep auto-running for demos and the evaluation harness.
- Optional Indra OCR engine (Datalab, v1.1.0): detector and recognizer ONNX
  models vendored from the official Hugging Face repository (pinned commit)
  and run in the browser on onnxruntime-web. Opt-in via a "Use Indra OCR"
  checkbox; on error or empty output the pipeline falls back to PaddleOCR
  and then Tesseract, so the default behavior is unchanged.
- `src/js/indra.js`: the engine port (DB text detection, batched CTC
  recognition, load-time input-shape probing, documented detector channel
  order and vocabulary handling).
- `docs/ocr-engines.md`: engine chain documentation, port architecture,
  validation recipe against the `indra-ocr` Python reference, and licensing
  notes; plus cross-references throughout the documentation and a changelog
  entry.

## [Unreleased]

### Added
- Fine exterior-line recovery: two-scale thin-stroke extraction, stroke-width
  classification, Zhang-Suen thinning and skeleton polyline tracing
  (`src/js/fine-lines.js`), exposed as `analysis.detailLines` in the analysis
  result with a `fine_lines` timing.
- `scripts/fineline-recall.mjs`: fine-line recall metric against optional
  hand annotations in `src/samples/fine_lines/<id>.png` (writes
  `eval-out/fineline.md`).
- `docs/fine-lines.md`: tracer architecture, metric usage, and a roadmap of
  not-yet-implemented improvements (contrast-relative thresholds, SAM box
  prompts on detail strokes, tactile weight for detail lines, CLAHE).

## [2026.11.20-beta] - 2026-11-20

### Added
- `docs/`: MkDocs (Material) documentation covering the tool for transcribers, the pipeline, the BANA-derived layout rules, the module reference, the evaluation harness and deployment. Published at the GitHub Pages root, with the app at `/app/`.
- Community files: `CONTRIBUTING.md`, `CODE_STYLE.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, pull request and issue templates.
- `.github/workflows/pages.yml` now publishes the documentation site at `/` and the app at `/app/`.
- One-time restructure workflow that renames `app/` to `src/` and updates all path references.

### Changed
- Repository layout: the application moves from `app/` to `src/` so the repository and the Pages site are cleaner; scripts (serve, vendor, eval, recall, thumb) and `.gitignore` updated accordingly.
- README rewritten to reflect TactiDiagram as a maintained, in-use tool by a transcriber rather than a hackathon entry.
- `package.json` homepage corrected to `https://mrhunsaker.github.io/TactiDiagram/`.

## [2026.11.20] - 2026-11-20

### Added
- PaddleOCR (text detector + English recognizer) on ONNX Runtime Web as the primary OCR, with Tesseract as fallback.
- Leader-line tracing and chaining; SlimSAM point-prompted segmentation per labeled part.
- Label-guided line hierarchy in the Detailed outline style (bold named-part edges, fine detail).
- Simplified outline style with BANA 3 mm spacing, centreline thinning and short-fragment removal.
- Millimetre layout: textures (max 5), UEB Grade 1 braille at Spec 800 dot dimensions, two-letter keys with key page, 3 mm braille clearance with knockouts.
- OCR slip repair against a science vocabulary, always shown to the teacher.
- Guideline checker measuring print-text traces, short fragments, narrow-gap area and braille clearance, with a Canny edge-tracing baseline.
- 3D relief preview (three.js) with STL export for 3D printing.
- Playwright evaluation harness (`npm run eval`, `scripts/recall.mjs`, `scripts/ocrbench.mjs`) over 16 Wikimedia Commons sample diagrams.

### Notes
- Results snapshot in the README (98% label recall, all but 1 of 233 labels placed in braille, 66 short fragments vs 763 for edge tracing).
- Not yet formally tested with blind readers or printed on physical swell paper.


### Documentation update — processing modes and pipelines

- Expanded user and technical documentation to distinguish standard segmented tactile rendering, optional pre-analysis Autotrace reconstruction, and post-analysis direct Potrace SVG output.
- Documented the direct outline-image algorithm: OCR text masking, per-channel RGB Sobel gradients, bounded Otsu thresholding, monochrome Potrace tracing, and SVG normalization.
- Documented transparent output, editable Potrace and per-label braille layers, normal tactile-layout/key-page reuse, the interaction between the two Potrace options, and mode-specific review limitations.
