# Module reference

This page maps the current browser application source under `src/js/`. It describes the implementation in the inspected main-branch source; planned features are called out separately rather than listed as active modules.

## Application orchestration

### `ui.js`

Owns browser UI state, image input, tabs, review rail, export actions, and the deep-link sample parameter. It decodes and normalizes the image, invokes `analyze()`, builds the tactile layout, runs checks, and updates the views.

### `pipeline.js`

Coordinates the analysis stage: loads OpenCV.js, the selected segmentation backend (SlimSAM by default or optional SAM 2.1), and OCR engines; runs the engine chain (opt-in Indra, then PaddleOCR, then Tesseract); filters and groups OCR words into labels; applies vocabulary corrections; detects label/leader relationships; builds foreground and structural line representations; computes the selected segmenter image embeddings; and segments label anchors.

## Recognition and geometry

### `indra.js`

Experimental, opt-in engine (Datalab Indra OCR v1.1.0) that runs the vendored
`det.onnx` / `rec.onnx` ONNX models on ONNX Runtime Web. DB-style text
detection with OpenCV post-processing, batched CTC recognition using the
`meta.json` vocabulary, and shape/blank-index handling documented inline.
Emits the same word records as `paddle.js`; the pipeline uses it before
PaddleOCR only when "Use Indra OCR" is checked, and falls back on error or
empty output. See [OCR engines](ocr-engines.md).

### `paddle.js`

Loads PP-OCRv6 detection-small and PP-OCRv5 English recognition-mobile ONNX models using ONNX Runtime Web. The detector proposes text regions; the recognizer reads their content. The implementation uses the WASM execution provider, crops candidate quadrilaterals, batches recognition, and can return line or word-level records. Word boxes are approximated from line boxes using character counts.

### `ocr.js`

Normalizes OCR output into words, filters implausible tokens using confidence and size, groups words into baselines, and merges stacked lines into labels. It uses leader associations and a small science vocabulary to avoid incorrectly merging separate labels.

### `fine-lines.js`

Recovers fine exterior linework (strokes finer than leader/arrow strokes) that
the leader detector's thin-stroke mask would otherwise discard: two-scale
tophat/blackhat extraction, distance-transform stroke-width classification,
Zhang-Suen thinning, and skeleton-graph walking into polylines. Exposed as
`analysis.detailLines` (mask + polylines) with its own timing; not yet
rendered on the tactile page. Measured by `scripts/fineline-recall.mjs`; see
[Fine exterior lines](fine-lines.md).

### `leaders.js`

Creates a thin-stroke mask using morphological black-hat/top-hat operations, finds line segments with probabilistic Hough transform, assigns candidate segments to text lines, and chains nearby collinear segments to estimate leader tips.

### `lineart.js`

Builds structural line art from colour-region boundaries and thin strokes. It uses image smoothing, Lab colour space, k-means clustering, component-size filtering, and edge tests to suppress shading gradients and small decorative marks.

### `segment.js`

Uses Transformers.js with SlimSAM by default or SAM 2.1 Hiera Tiny when the experimental WebGPU checkbox is selected. The direct Potrace SVG output option still runs the complete pipeline, including leader detection, line extraction, foreground reconstruction, and SAM segmentation. Potrace then traces the original source as the primary SVG artwork while the normal tactile layout supplies braille placement and optional two-letter keys. SAM 2.1 requires a usable WebGPU adapter; it does not automatically fall back to SlimSAM.

### `libs.js`

Provides lazy loaders for OpenCV.js, Tesseract.js, Transformers.js, and ONNX Runtime Web. SlimSAM uses WASM; optional SAM 2.1 uses WebGPU. It configures local model paths and disables remote model resolution for Transformers.js. OpenCV has a pinned CDN fallback if the local bundle is missing.

## Tactile output and quality

### `tracing-config.js`

Centralizes tracing-sensitivity settings shared by the UI and analysis pipeline.

### `tactile.js`

Builds a page layout in physical units, places braille labels and keys, assigns textures, and applies spacing/clearance and knockout rules.

### `braille.js`

Encodes uncontracted UEB Grade 1 and generates two-letter label keys.

### `render.js`

Renders the tactile page and key page as SVG, including line geometry, texture patterns, braille dots, and preview-only presentation elements. The direct Potrace output mode embeds editable Potrace paths and exports each normally laid-out braille label as a separately movable layer, while retaining the standard key-page export.

### `check.js`

Measures selected layout properties and computes a Canny edge-tracing baseline for comparison. The checker does not establish tactile readability.

### `relief.js`

Uses three.js to display a 3D relief preview and generate an STL plate model.

## Planned / not currently wired into the main pipeline

- **Other larger vision-language or segmentation models:** discussed as research directions in [Advanced model options](advanced-model-options.md); SAM 2.1 is the sole integrated experimental exception.

## Editable SVG and vector-editor handoff

`render.js` exports editable SVG geometry with named groups for page background, textures, structural line art, outlines, knockouts, leaders, and braille. The tactile SVG uses millimetre page dimensions. Inkscape is the recommended FOSS editor, but any SVG-capable vector editor can perform manual post-processing and QC. See [The transcriber review workflow](review-workflow.md).

## Editable SVG post-processing and quality control

The tactile SVG is an editable vector document sized in millimetres, with named groups for textures, structural line art, outlines, label-clearance knockouts, leader lines, and braille dots. The key-page SVG separates braille from sighted print-reference text. These are vector objects, not a flattened screenshot.

**Inkscape is the recommended reference editor because it is free and open-source (FOSS).** The SVG is standard vector artwork and can also be edited in other SVG-capable tools, including Adobe Illustrator and Affinity Designer. Inkscape is the documented default because the project targets FOSS workflows; it is not a technical requirement.

Use the vector editor for post-processing: compare with the source and analysis overlays, correct paths and false contours, adjust leaders, and inspect braille, label-to-part correspondence, line hierarchy, textures, clearances, and margins. Preserve the page dimensions and mm scale. Save a separate reviewed copy, then produce a physical proof on the intended swell-paper/fuser system.

Vector editing is an optional manual post-processing and QC stage, not automated validation. Edits do not update TactiDiagram's analysis state or guideline report. Recheck the edited SVG independently, retain the untouched export, and assess the physical proof; visual correctness alone does not establish tactile readability.


## Potrace processing and output modules

The autotrace module implements two distinct call paths:

- **Autotrace preprocessing** runs before analysis when its checkbox is selected. It vectorizes and rasterizes a reconstructed image; the returned image data becomes the analysis input.
- **Direct outline-map construction** masks OCR text boxes, computes independent RGB Sobel gradients, thresholds the gradient histogram with bounded Otsu selection, and rejects nearly blank results.
- **Direct trace normalization** passes that edge map to Potrace and validates/normalizes the returned SVG to black editable paths without a background shape.
- **Direct rendering** scales the trace into page coordinates and emits a separate linework layer, optional title layer, and one braille layer per label. It consumes the ordinary layout labels and key entries; it does not calculate an alternate braille layout.

The direct trace always uses the original source raster. If Autotrace and direct output are both enabled, the reconstructed raster is used for analysis but the original raster is used for final Potrace artwork. Standard analysis overlays and checks remain based on the analysis image and layout; they do not certify the direct trace.
