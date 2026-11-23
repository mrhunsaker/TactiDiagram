# Models and inference engines

This page distinguishes **trained model weights** from **runtime libraries**. The runtime libraries execute algorithms; model files contain learned parameters and vocabularies. They have different sizes, licenses, loading behavior, and failure modes.

The file names below come from the checked-in `scripts/vendor.mjs`, `package.json`, and browser loader modules. The local server serves `src/` directly. Run `npm run vendor` to populate generated browser libraries in `src/vendor/` and model files in `src/models/`; see [Getting started](getting-started.md).

## At a glance

| Component | Model / asset | Purpose in TactiDiagram | When used |
|---|---|---|---|
| OpenCV.js | `@techstark/opencv-js@4.12.0-release.1` browser build | Classical image processing and geometry | Throughout analysis and checking |
| PaddleOCR detector | `PP-OCRv6_det_small.onnx` | Locates text regions in the image | Primary OCR |
| PaddleOCR recognizer | `en_PP-OCRv5_rec_mobile.onnx` | Converts detected text crops into English text | Primary OCR |
| Tesseract.js | Tesseract.js 7 browser worker/core | Independent OCR fallback | Only if PaddleOCR fails |
| Indra OCR (opt-in) | `det.onnx` + `rec.onnx` + `meta.json` (Datalab Indra v1.1.0) | Experimental alternative printed-text engine | Only when "Use Indra OCR" is checked, before the PaddleOCR default |
| Tesseract language data | `eng.traineddata.gz` (4.0.0_best_int) | English LSTM character/language model | Tesseract fallback |
| SlimSAM | `Xenova/slimsam-77-uniform` ONNX files | Default point-prompted segmentation backend | After labels and anchors are found |
| SAM 2.1 Hiera Tiny (opt-in) | `onnx-community/sam2.1-hiera-tiny-ONNX` fp16 ONNX files and external tensor data | Experimental alternative point-prompted segmentation backend | Only when the SAM 2.1 checkbox is selected; requires WebGPU and a usable adapter |
| Transformers.js | `@huggingface/transformers@4.3.0` | Loads and runs SlimSAM and optional SAM 2.1 in the browser | Segmentation |
| ONNX Runtime Web | `onnxruntime-web` WASM and WebGPU-targeted bundle | Executes ONNX inference in the browser | PaddleOCR, SlimSAM, and optional SAM 2.1 |
| three.js | `three@0.186.1` | 3D relief visualization and STL geometry support | Only when the relief view/export is used |
| Potrace | `esm-potrace-wasm@^0.5.1` package dependency | Optional bitmap-to-vector preprocessing | When Autotrace is enabled before analysis |

## PaddleOCR: primary OCR

OCR (optical character recognition) converts printed words in the source diagram into text plus spatial coordinates. TactiDiagram needs both: the recognized word and its bounding box are used to group labels and search for leader lines.

PaddleOCR is the primary OCR path. The vendor script downloads two ONNX models converted by RapidOCR:

### PP-OCRv6 detection-small

File: `PP-OCRv6_det_small.onnx`

The detector finds candidate text regions. It does not determine the final text string. The implementation resizes the image for inference, runs a DB-style text-detection model, thresholds the probability map, and post-processes connected regions into quadrilateral boxes. Detection is especially important for small labels, rotated labels, and text placed over coloured diagram fills.

### PP-OCRv5 English recognition-mobile

File: `en_PP-OCRv5_rec_mobile.onnx`

The recognizer reads cropped regions proposed by the detector. It predicts a character sequence using a CTC-style decoding process and the model's character dictionary. The current app uses an English recognizer, so non-English labels and specialist symbols are not a supported target.

The detector and recognizer are complementary: a detector can locate a label without reading it, while a recognizer needs a correctly cropped text region to read. Both are required for the primary OCR path.

### Runtime

`src/js/paddle.js` loads ONNX Runtime Web and creates detector and recognizer sessions with the WASM execution provider. It downloads the two ONNX files from the RapidOCR ModelScope repository configured in `scripts/vendor.mjs`. The app uses a small batch for recognition and converts recognized line boxes into approximate word boxes so the shared OCR post-processing can group words into labels.

**Failure behavior:** if PaddleOCR initialization or recognition throws, `src/js/pipeline.js` logs the error and attempts Tesseract. This fallback is resilience, not an ensemble: the two engines are not routinely voting on each label in the normal path.

## Indra OCR: opt-in experimental alternative OCR

File: `src/models/indra/det.onnx`, `rec.onnx`, and `meta.json`, downloaded by
the vendor script from Datalab's official Hugging Face repository and pinned to
the v1.1.0 commit, with the repository LICENSE copied alongside.

Indra is a small OCR model family that runs on plain ONNX Runtime (no PyTorch,
no GPU in the reference implementation), which makes its artifacts portable to
onnxruntime-web. `src/js/indra.js` runs the same DB text-detection and
batched CTC recognition pattern as PaddleOCR and emits word records in the
shared format, so the rest of the pipeline is unchanged whatever the engine.

It is **opt-in** ("Use Indra OCR" under Output options) and **experimental**.
The preferred path uses PaddleOCR's PP-OCRv6 detector to locate rotated
quadrilateral text regions, OpenCV to perspective-crop and deskew them, and
Indra's Latin recognizer to read the crops. If Paddle detection fails, the app
tries Indra's own detector and recognizer; if the Indra path errors or returns
no text, it falls back to the normal PaddleOCR path, then Tesseract when
PaddleOCR fails. The JavaScript port still omits Indra's orientation and script
classifiers, so perspective correction does not guarantee correct reading
direction for upside-down or arbitrary-orientation text. See
[OCR engines](ocr-engines.md) for the data-flow diagram, limitations,
validation recipe against the `indra-ocr` Python package, and licensing notes.

## Tesseract.js: fallback OCR

Tesseract is a mature OCR engine. In this project it is the fallback when PaddleOCR is unavailable or fails.

The vendor script copies:

- `tesseract.esm.min.js`, `tesseract.min.js`, and `worker.min.js`: browser-side library and worker code. Right after copying, the vendor script rewrites the bundle's single `Math.random()` task-ID generator (Tesseract.js worker-scheduler module 70) with a deterministic counter, so the committed bundle contains no insecure-randomness pattern for Code scanning; the identifiers it mints are non-cryptographic debug/log IDs.
- The Tesseract.js Core LSTM WebAssembly builds: the OCR engine runtime.
- `eng.traineddata.gz`: English trained data, version path `4.0.0_best_int`.

The loader configures English, OEM 1 (LSTM-only recognition), and PSM 11 (sparse text). PSM 11 is suitable for diagram labels scattered around an image rather than a page of continuous prose. If fallback is needed, the pipeline runs OCR on the original normalized image and on an adaptive-threshold version, then merges overlapping word detections while keeping the more confident result.

Tesseract and PaddleOCR have different model architectures and error patterns. Keeping Tesseract as a fallback makes the app less dependent on one ONNX runtime path, but it does not guarantee that every missed label will be recovered.

## SlimSAM: label-guided segmentation

Model repository: `Xenova/slimsam-77-uniform`

The vendor script downloads:

- `config.json`
- `preprocessor_config.json`
- `onnx/vision_encoder.onnx`
- `onnx/prompt_encoder_mask_decoder.onnx`

Segment Anything models are promptable segmentation systems. They do not need a fixed class label such as “heart chamber” to return a mask; they need a visual prompt, such as a point inside the region of interest. TactiDiagram supplies a point estimated from the tip of a leader line or from the area around a label printed directly on the part.

The vision encoder creates an image embedding once. The prompt encoder and mask decoder then use each point prompt to produce candidate masks. TactiDiagram filters candidates by area and confidence, preferring a tighter mask when its score is close to the best candidate. This is an attempt to select the named component rather than an entire surrounding object.

The current loader uses Transformers.js with local-only model resolution and ONNX Runtime WASM. It explicitly selects `device: 'wasm'`; the code comments say WebGPU is not considered sufficiently tested across the target hardware. The ONNX WASM proxy is enabled for the segmentation loader so inference does not block the UI thread.

## Optional SAM 2.1 Hiera Tiny segmentation

The UI checkbox selects SAM 2.1 Hiera Tiny for the next analysis. It requires a **Chromium-based browser** (Chrome/Edge/Brave/Chromium) with WebGPU and a usable adapter from `navigator.gpu.requestAdapter()`, and is loaded only when selected; SlimSAM remains the default WASM backend. It is **not supported on WebKit (Safari on macOS, GNOME Web)** and is **gated off Firefox at load time**: Firefox ships WebGPU, but the ONNX Runtime WebGPU execution provider is Chromium-oriented and the SAM 2.1 encoder can fail mid-run there with an invalid shader module. If WebGPU is unavailable, the browser is Firefox/WebKit, or the SAM 2.1 run fails mid-analysis, the pipeline logs the reason and **falls back to SlimSAM automatically** for that run; the UI unchecks the option. The fallback is time-boxed so a stalled runtime can never leave the interface disabled. `npm run vendor` stages the pinned ONNX Community fp16 files and external tensor data locally (about 78 MB). This backend is experimental and should be compared on target browsers before routine use.

### Transformers.js v4 prompt handling

With Transformers.js 4.3.0, every `SamProcessor` call runs the full image preprocess (the processor no longer supports the v3 pattern of passing `null` as the image to get point-prompt-only inputs). `src/js/segment.js` therefore builds the SAM 2.1 point-prompt tensors directly from the cached embed-step dimensions:

- `processor.reshape_input_points(...)` rescales the [x, y] prompts into the model's reshaped input coordinates using the stored `original_sizes` / `reshaped_input_sizes`.
- Labels are wrapped as an `int64` tensor shaped like the points tensor.
- `reshaped_input_sizes` is passed to `post_process_masks`, which the v4 API requires to remove padding when upscaling masks back to original resolution.
- The per-image preprocess outputs (`original_sizes`, `reshaped_input_sizes`) are cached for the whole analysis, so each label only re-runs one full model call instead of re-preprocessing the page. The multi-level image embeddings are deliberately NOT cached for SAM 2.1: this Sam2Model build re-dispatches decoder-only inputs into the vision encoder and fails (see the segment.js comment).

Passing `processor(null, ...)` throws "Cannot read properties of null (reading 'size')"; if a future Transformers.js upgrade reintroduces an inputs-only call, prefer that over manual tensor construction.

## OpenCV.js: classical computer vision

OpenCV.js is a browser build of OpenCV. It is not a trained AI model. It supplies image-processing operations used to make the pipeline deterministic and explainable:

- grayscale conversion and colour-space conversion
- morphology (opening, closing, dilation, black-hat, top-hat)
- thresholding and connected components
- Hough line detection for leader segments
- contour extraction, hole filling, and small-component removal
- Canny edges for the comparison baseline and quality checks

The vendor script copies the pinned npm package build. `src/js/libs.js` first tries the local asset and then has a version-pinned jsDelivr fallback. The fallback downloads library code only; the source image is not sent to the CDN.

## ONNX Runtime Web and Transformers.js

These are execution frameworks, not task-specific model weights.

- **ONNX Runtime Web** executes ONNX graphs in the browser. The project vendors WASM runtime files and uses the WASM execution provider for PaddleOCR and SlimSAM.
- **Transformers.js** provides the model-loading and preprocessing interface used for SlimSAM and the optional SAM 2.1 backend. The app disables remote model loading and sets a local model directory.

This separation matters when debugging: a model file can be present but still fail because the runtime bundle, WASM binary, preprocessing configuration, or expected model path is wrong.

## three.js: 3D preview, not AI

three.js is a rendering library. It supports the interactive relief preview and STL export. It does not recognize labels or infer diagram parts. The 3D view is a review aid; physical swell-paper output still needs production QA.

## Potrace and Autotrace

Potrace is a bitmap-to-vector tracer: it converts raster shapes into vector paths. It is useful when a raster diagram needs a clean vector representation, but it is not an OCR engine, a semantic segmentation model, or a tactile-layout engine.

The repository's package manifest includes `esm-potrace-wasm`, a browser-oriented WebAssembly package. The optional Autotrace control in `src/index.html` invokes `src/js/autotrace.js`. The vendor script copies the ESM/WASM runtime into `src/vendor/potrace/` and includes the GPL-2.0 notice beside it.

The implemented Autotrace design is an optional upstream preprocessing pass:

1. Preserve the original uploaded raster.
2. If Autotrace is enabled, run Potrace to reconstruct a cleaner representation.
3. Rasterize that representation into an image for analysis.
4. Run OCR, leader detection, foreground/structure analysis, and segmentation on the prepared image.
5. Keep the original available for comparison and for the non-Autotrace path.

That is different from simply exporting Potrace's paths as the tactile graphic. The tactile renderer still needs semantic parts, braille, physical spacing, line hierarchy, and production constraints. Potrace is an optional preprocessing stage, not the tactile renderer. Browser behavior and output quality should be checked against representative samples before production use.

## Download size and caching

The total setup transfer size depends on the exact model files, compression, and vendor-script revision. The vendor script downloads the required assets during setup and skips a destination file when it already exists and has nonzero size. Browser caching can reduce later loading; a corrupt but nonempty downloaded file may need to be removed manually before rerunning the vendor command.

For a reproducible release, record exact model URLs/revisions, checksums, licenses, and measured uncompressed and transferred sizes. The current script pins some dependencies and uses versioned model paths, but it does not yet provide a complete generated model manifest with hashes.

## Licensing and redistribution

The npm dependencies and model repositories can have separate licenses. Do not infer the license of a model from the license of its runtime or conversion tool. Before redistributing a bundled build, review the license and attribution requirements for every library, model weight, conversion, and sample image. In particular, review the Potrace package's GPL-2.0 terms independently from the application's GPL-3.0-or-later license.

## Editable SVG post-processing and quality control

The tactile SVG is an editable vector document sized in millimetres, with named groups for textures, structural line art, outlines, label-clearance knockouts, leader lines, and braille dots. The key-page SVG separates braille from sighted print-reference text. These are vector objects, not a flattened screenshot.

**Inkscape is the recommended reference editor because it is free and open-source (FOSS).** The SVG is standard vector artwork and can also be edited in other SVG-capable tools, including Adobe Illustrator and Affinity Designer. Inkscape is the documented default because the project targets FOSS workflows; it is not a technical requirement.

Use the vector editor for post-processing: compare with the source and analysis overlays, correct paths and false contours, adjust leaders, and inspect braille, label-to-part correspondence, line hierarchy, textures, clearances, and margins. Preserve the page dimensions and mm scale. Save a separate reviewed copy, then produce a physical proof on the intended swell-paper/fuser system.

Vector editing is an optional manual post-processing and QC stage, not automated validation. Edits do not update TactiDiagram's analysis state or guideline report. Recheck the edited SVG independently, retain the untouched export, and assess the physical proof; visual correctness alone does not establish tactile readability.
