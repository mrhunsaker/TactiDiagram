# Module reference

This page describes the implementation modules in `src/js/`, based on the current source. It is intended as a developer-oriented guide: what each module owns, what it consumes and produces, how it collaborates with other modules, and where its limitations matter. The high-level execution order is shown in [Pipeline stages and theory](pipeline.md); this page focuses on the code boundaries.

The application is a set of native browser ES modules. There is no bundler or compile step for the JavaScript application. The UI module coordinates the work, analysis modules produce an intermediate analysis object, the tactile layout module converts that analysis into millimetre geometry, and render/check/relief modules consume that shared layout.

## Module map

| Module | Primary responsibility | Main output / contract |
|---|---|---|
| `ui.js` | Browser interaction and application lifecycle | Current image, analysis, layout, views, and exports |
| `pipeline.js` | End-to-end image analysis orchestration | Analysis object with labels, masks, lines, timings, and engine metadata |
| `libs.js` | Runtime and model initialization | Ready OpenCV, OCR, and segmentation runtimes |
| `paddle.js`, `indra.js`, `ocr.js`, `vocab.js` | Text recognition and label normalization | Normalized word records and reviewed label text |
| `leaders.js`, `lineart.js`, `fine-lines.js` | Recover diagram geometry | Leader candidates, structural line masks, and fine-line polylines |
| `segment.js` | Prompted part segmentation | Per-label binary masks |
| `tracing-config.js` | Shared tracing sensitivity | Consistent thresholds and morphology parameters |
| `tactile.js`, `braille.js` | Physical page composition and braille encoding | Layout in millimetres, braille cells, and key assignments |
| `autotrace.js` | Potrace preprocessing and direct trace output | Prepared raster or normalized SVG trace |
| `render.js` | SVG generation | Editable tactile SVG, direct-trace SVG, and key-page SVG |
| `check.js` | Geometric diagnostics | Measurements and comparison baseline |
| `relief.js` | 3D preview and mesh export | Interactive relief and STL file data |

## Application orchestration

### `ui.js` — browser application controller

`ui.js` is the application-facing coordinator. It owns the DOM and user interaction; the image-processing modules deliberately do not. It connects the file/sample input, analysis controls, review panels, tactile preview, key page, 3D view, and export buttons.

Its main responsibilities are:

- **Input lifecycle:** load a local file, a built-in sample, or a supported URL sample; decode it; normalize it to the analysis raster; retain the original image for comparison; and show image metadata and upload state.
- **Analysis lifecycle:** collect the current options, start analysis, display stage/progress messages, handle failures, and prevent stale or incomplete results from being presented as finished output.
- **Derived output:** call `analyze()`, pass its result to `buildLayout()`, run `checkAll()`, and refresh the analysis overlay, tactile preview, rules panel, and key page.
- **Human review:** draw the OCR labels, leader associations, segmentation masks, and other overlays; support selecting/highlighting labels and changing label text or review state before relayout.
- **Re-layout:** rebuild the page when layout-affecting options change without unnecessarily repeating OCR and model inference. Tracing sensitivity is a special case: it calls `updateTracing()` to recompute image tracing while reusing existing recognition and segmentation results.
- **Export and print:** request SVG and other output formats, route file saving and print handoff through the appropriate browser or Neutralino path, and keep preview-only elements separate from production artwork.
- **Optional desktop integration:** detect the Neutralino runtime dynamically. In a normal browser, standard browser download/open behavior remains active; in the packaged desktop shell, native save and print handoff APIs are used.

The UI is intentionally the only module that manipulates application DOM state. It should orchestrate modules and display their results rather than duplicate image-processing or tactile-layout algorithms.

### `pipeline.js` — analysis coordinator

The main public entry point is `analyze(imageData, options)`. This module owns the sequence that turns the normalized source raster into a structured description of the diagram. It coordinates engines and algorithms but delegates the individual operations to focused modules.

The analysis sequence is broadly:

1. Load OpenCV, the selected segmentation backend, and the OCR runtime/model dependencies. Model initialization is lazy and shared.
2. Convert the image to OpenCV matrices and derive grayscale and canvas representations needed by the engines.
3. Run the selected OCR path. Optional Indra recognition is attempted only when requested; otherwise PaddleOCR is the normal path. Tesseract is the fallback when the ONNX OCR path cannot produce usable text.
4. Normalize, filter, group, and merge recognized words into candidate labels. Apply science-vocabulary corrections while retaining correction information for review.
5. Build thin-stroke masks, find Hough line segments, associate candidate leader lines with labels, and estimate leader endpoints.
6. Estimate the drawing foreground and derive structural line representations. These are distinct concepts: foreground describes the drawing's occupied area; structural line art describes boundaries and strokes inside it.
7. Compute segmentation image data/embeddings and use label-associated points as prompts to segment named parts. Each label can receive a mask or remain unsegmented if no acceptable candidate is found.
8. Extract fine exterior linework into a separate analysis result. This is diagnostic/research output at present and is not yet incorporated into the tactile page renderer.
9. Return the analysis object, including dimensions, labels, masks, foreground and line masks, selected OCR/segmentation engine information, and per-stage timings.

The `onStage` callback reports progress to the UI. The module also uses bounded waits around potentially stalled model operations so a failed or wedged backend does not leave the interface indefinitely disabled.

`updateTracing(cv, imageData, analysis, sensitivity)` is the partial recomputation path. It recalculates foreground and line tracing from an existing analysis rather than rerunning OCR and SAM inference. This is why changing tracing sensitivity can be faster than starting a new analysis.

### `libs.js` — runtime and model loaders

This module centralizes the browser-side initialization of third-party runtimes. It does not perform OCR or segmentation itself; it makes the engines available to those modules.

- **OpenCV.js:** injects the local vendored build first and has a version-pinned CDN fallback for development situations where generated vendor assets are absent. It waits for the Emscripten runtime and verifies the `cv.Mat` API before resolving.
- **OCR:** exposes the Tesseract worker loader and its progress callback so the UI can report language-data initialization.
- **Segmentation:** loads Transformers.js and the selected model pipeline. SlimSAM is the default WASM-backed backend; experimental SAM 2.1 uses WebGPU.
- **Local model policy:** configures local model paths and Transformers.js local-only behavior so model resolution does not silently fetch model files from a remote hub.

Load promises are cached so repeated analyses reuse initialized runtimes rather than injecting scripts or constructing model sessions each time. A failed initialization is surfaced to the caller; fallback decisions belong to the pipeline or engine-selection layer.

## Recognition and label interpretation

### `paddle.js` — PaddleOCR detector and recognizer

This module implements the default OCR engine using ONNX Runtime Web with the WASM execution provider. It loads two separate models because text localization and text reading are different tasks:

- **Detection:** PP-OCRv6 detection-small produces a probability map for text regions. The module thresholds and post-processes the map, scores candidate contours, expands candidate boxes, and restores coordinates from the detector's resized image to the original raster.
- **Recognition:** PP-OCRv5 English recognition-mobile reads each detected, perspective-corrected crop. Crops are resized and normalized to the recognizer's input geometry, batched, and decoded using CTC sequence decoding and the character dictionary stored in ONNX metadata.
- **Output normalization:** line-level recognition results can be converted into approximate word boxes. The word boundaries are estimated from character counts because the recognizer returns a line transcription rather than independently detected word geometry.

`detectText()` returns records with text, confidence, and bounding coordinates. `detectTextRegions()` exposes detection geometry without running Paddle's recognizer; this is used when Indra is selected so that Indra can recognize the same Paddle-detected crops.

The module composites transparent pixels onto white before inference. Model sessions are created once and reused. PaddleOCR is the baseline path, not an ensemble voter: it is used when selected directly or as the full fallback after Indra fails.

### `indra.js` — optional Indra recognizer

Indra is an experimental recognition alternative, not a replacement detector. The current integration uses PaddleOCR to find and rectify text regions, then passes those regions to the Datalab Indra OCR v1.1.0 recognizer.

The module loads the vendored `rec.onnx` model and `meta.json` vocabulary, prepares grayscale ink maps with the expected height and width constraints, batches variable-width crops, runs CTC recognition, and converts decoded sequences into the same word-record shape used by PaddleOCR. It handles the model's blank index, vocabulary, crop polarity, and input tensor shape.

The pipeline invokes this path only when the Indra option is enabled. Any load, preprocessing, inference, decoding, or empty-result failure returns control to the pipeline, which runs the complete PaddleOCR detection-and-recognition path. This makes Indra an opt-in experiment rather than a dependency for ordinary use. See [OCR engines](ocr-engines.md).

### `ocr.js` — OCR cleanup and label grouping

OCR engines return candidate words, not final diagram labels. This module converts those raw detections into a stable label representation for the rest of the pipeline.

Its operations include:

- **Word-set merging:** combine results from separate OCR passes where applicable, using bounding-box overlap and retaining the more confident duplicate.
- **Geometric/confidence filtering:** reject implausible boxes, non-word-like tokens, very small low-confidence fragments, and boxes that are unreasonably large relative to the image.
- **Baseline grouping:** sort words spatially and group words whose vertical extents overlap and whose horizontal gap is consistent with one printed line.
- **Multi-line label grouping:** merge stacked lines when they appear to form one label. Leader-line ownership and spatial relationships help prevent two nearby labels from being incorrectly joined.
- **Text cleanup:** normalize punctuation and preserve bounding geometry so later modules can associate a label with its leader and a point on the diagram.

The output is a list of label records with text and image-space bounds. These records become the shared identity for review, leader association, segmentation prompts, braille layout, and key generation. OCR confidence is evidence about recognition quality; it is not proof that the text is scientifically correct or that the label points to the correct part.

### `vocab.js` — domain vocabulary and conservative correction

This module contains a curated science and anatomy vocabulary, common multiword terms, and phrase patterns that help interpret OCR output from educational diagrams. It is not a general-purpose spellchecker.

- `correctWord()` compares a token with known terms and only accepts close candidates under confidence-aware rules.
- `correctLabel()` applies token-level corrections to a label.
- `correctPhrase()` and `isPhrase()` recognize known multiword terms such as named anatomical structures.
- `isKnownLabel()` helps distinguish plausible diagram terminology from OCR noise.

The correction logic is deliberately conservative because an incorrect correction can change scientific meaning. Corrections are surfaced in the UI for human review and can be undone; the module does not silently certify the content.

## Geometry extraction and segmentation

### `leaders.js` — label-to-part leader detection

A leader is a line or pointer that connects printed text to a feature in the drawing. This module estimates those connections using image geometry rather than a learned semantic relationship model.

1. Apply morphological black-hat and top-hat operations to grayscale pixels to reveal thin dark-on-light and light-on-dark strokes.
2. Erase OCR text boxes, with a margin, so letter strokes are less likely to be detected as leaders.
3. Run the probabilistic Hough transform to produce finite line-segment candidates.
4. Score and assign candidate segments to text lines using proximity, direction, length, and geometric compatibility.
5. Follow nearby approximately collinear segments to bridge gaps and estimate a leader endpoint.

The resulting leader record is attached to a label and includes a line/endpoint estimate. The endpoint becomes a positive point prompt for part segmentation. The method is heuristic: curved leaders, arrowheads, crossings, dotted leaders, and dense diagrams can cause incorrect assignments. Review overlays remain necessary.

### `lineart.js` — structural drawing lines

This module extracts the diagram's own boundaries and strokes. It is deliberately separate from `leaders.js`: leader lines encode label-to-part relationships, whereas structural line art describes the shapes and internal boundaries of the diagram.

The implementation downsamples large images for bounded processing cost, smooths colour noise with bilateral filtering, and converts the image to CIE Lab space. It estimates the border-connected background, clusters remaining drawing colours with k-means, and merges small connected regions into neighbouring regions to suppress shading speckle. Candidate region boundaries are retained only when the colour change is sufficiently strong, reducing false edges caused by smooth gradients.

It also detects thin strokes that are darker or more saturated than their surroundings. Text boxes and short decorative marks are suppressed where possible. The output is a binary structural-line mask consumed by tactile layout generation. It is a line-recovery heuristic, not a semantic classifier; colour fills, gradients, low contrast, and complex illustrations can still create omissions or false boundaries.

### `fine-lines.js` — fine exterior stroke recovery

This module preserves a class of narrow strokes that would otherwise be lost when the leader detector's thin-stroke mask is consumed for Hough detection and label assignment. Examples include hairline vessel contours and fine exterior boundaries.

The algorithm compares small- and larger-scale morphological top-hat/black-hat responses, uses a distance transform to estimate stroke width, removes text boxes and assigned leader lines, applies Zhang–Suen thinning, and walks the resulting skeleton through endpoints and junctions to create polylines. It returns a full-resolution mask and vector-like polyline chains, exposed as `analysis.detailLines`, with its own timing.

**Integration status:** the result is available for analysis and recall evaluation but is not currently rendered into the tactile page. It should not be described as part of the production line hierarchy until a downstream renderer consumes it. See [Fine exterior lines](fine-lines.md).

### `segment.js` — point-prompted object masks

This module adapts the selected Segment Anything backend to the label geometry produced by OCR and leader detection. It separates image embedding/preprocessing from per-label point prompts where the backend supports that split.

For each label, the pipeline supplies a positive point at the leader tip or at an estimated location under an in-figure label. Optional negative points can exclude nearby regions. The module formats points and labels into the tensor shapes expected by the selected model, runs inference, post-processes masks back to source-image dimensions, and evaluates the returned candidates.

Candidate masks are constrained by minimum and maximum area fractions so tiny noise regions and near-whole-page masks are not accepted as ordinary named parts. The selected result is returned as a full-resolution binary mask or `null`. SlimSAM can reuse image embeddings across prompts. The current SAM 2.1 path performs its required forward processing for each prompt rather than reusing the SlimSAM embedding contract.

The module returns geometric candidates, not verified semantic objects. A mask can be spatially plausible and still cover the wrong anatomical or mechanical part; the review stage must check label-to-part correspondence.

### `tracing-config.js` — shared sensitivity curve

The tracing-sensitivity control must affect related image-processing stages consistently. This module converts a user value (0–100; default 55) into a set of thresholds and scale parameters used by foreground extraction, Canny/edge processing, colour-region boundaries, and thin-stroke recovery.

The mapping is monotonic: increasing sensitivity generally lowers thresholds or minimum feature sizes so weaker or smaller evidence can be recovered. It does not change the physical tactile constraints in `tactile.js`—for example minimum line length, braille clearance, or page dimensions. Keeping those concerns separate prevents a high image sensitivity setting from silently weakening output safety constraints.

## Tactile layout and braille

### `tactile.js` — physical layout engine

This module converts the pixel-space analysis object into a physical page layout expressed in millimetres. It is the bridge between computer-vision output and printable tactile geometry. Its public entry point is `buildLayout(cv, analysis, options)`.

The layout engine:

- Selects the configured page size and orientation, reserves margins and optional title space, and computes a scale/offset mapping from source-image pixels to page millimetres.
- Converts the foreground mask into a cleaned outer silhouette.
- Converts structural line masks into page-space contours. Detailed mode retains more source structure and emphasizes edges around named-part masks; simplified mode closes nearby strokes, thins them, and drops fragments that are too short to distinguish by touch.
- Cleans and deduplicates per-label segmentation masks, rejects very small regions, and derives part outlines where structural line art does not already provide the boundary.
- Assigns distinct fill textures to a limited number of eligible, sufficiently large named parts. Large whole-figure masks are not textured because doing so would overwhelm the interior detail.
- Builds an occupancy grid in physical units and uses it to place braille while preserving clearances from the silhouette, structural lines, textures, other labels, and page edges.
- Places full uncontracted braille where possible. If a full label cannot fit, it assigns a short two-letter key and records the original text in the separate key-page data.
- Adds leader geometry when a label has moved away from its original location, and uses white knockouts where required to preserve braille clearance.

The output is a shared layout object containing page dimensions, scale and offsets, silhouette and line geometry, parts and textures, placed labels, key entries, title data, and summary statistics. The renderer, checker, and 3D relief module all consume this same object.

The `SPEC` constants centralize the current physical constraints, including line widths, minimum feature sizes, texture inset, and clearances. They are implementation parameters derived from the project's tactile specification, not a substitute for a standards review or a physical proof.

### `braille.js` — UEB Grade 1 encoding and cell geometry

This module converts short label strings into six-dot braille cell masks and exposes geometry helpers used by layout and rendering.

- Maps letters and supported punctuation to six-dot patterns.
- Converts digits using the numeric indicator and the corresponding a–j letter patterns.
- Adds capitalization indicators and the Grade 1 indicator where needed to avoid ambiguous letter/word-sign interpretation.
- Converts text into arrays of cell masks (`toCells`) or Unicode braille characters (`toUnicode`).
- Generates deterministic two-letter keys for labels that cannot be placed in full (`makeKeys`).
- Provides dot coordinates, cell width, line height, dot diameter, and pitch constants for millimetre layout.

The module separates encoding from placement. It knows how text maps to cells and how dots are spaced; `tactile.js` decides where those cells fit on the page. The current implementation is uncontracted UEB Grade 1 for the supported label character set; it should not be treated as a full literary braille translator.

## Potrace processing

### `autotrace.js` — raster preprocessing and direct SVG tracing

This module owns two distinct Potrace workflows that share the locally vendored WebAssembly implementation but have different purposes.

**Autotrace preprocessing** is an optional input transformation. It sends the source raster to Potrace, receives a vector reconstruction, rasterizes that SVG back onto a white canvas at the original dimensions, and validates that the result contains visible diagram content. The returned `ImageData` becomes the analysis input when this option is enabled. This can simplify colour regions and suppress raster noise before OCR and segmentation, but it can also alter fine details.

**Direct outline-map construction** is a separate output path. It operates on the original uploaded raster, not the preprocessed analysis image. It suppresses OCR label boxes, computes independent RGB Sobel gradients, builds a monochrome edge image, and uses bounded Otsu threshold selection to avoid an empty or excessively dense trace. Potrace converts that image to SVG paths; the module validates and normalizes the SVG into editable black paths on transparency.

The distinction matters when both options are enabled: analysis uses the reconstructed raster, while direct Potrace artwork is traced from the original source. The ordinary analysis, overlay, and guideline measurements are not a quality certification of the direct trace.

## SVG rendering and quality diagnostics

### `render.js` — production and preview SVGs

This module turns the physical layout into SVG documents. It does not perform OCR, segmentation, or page placement; it serializes the geometry and braille decisions already made by upstream modules.

It provides three output paths:

- **Tactile SVG (`renderTactile`):** an editable, millimetre-sized page with named SVG/Inkscape groups for the page background, textures, structural line art, outlines, label-clearance knockouts, leaders, and braille. The production output uses black raised-content artwork on white; sighted print text and comparison underlays are preview-only.
- **Direct Potrace SVG (`renderPotraceBraille`):** combines normalized transparent Potrace paths with the normal layout's braille labels. It can produce separate/movable braille layers while retaining the traced diagram as independent artwork.
- **Key-page SVG (`renderKeyPage`):** produces the reference page for abbreviated two-letter keys, separating braille from sighted print-reference text.

Texture definitions are centralized in `TEXTURES`. SVG geometry is emitted as vector paths and circles rather than a flattened screenshot, so the output can be inspected and edited in an SVG-capable vector editor. The renderer preserves physical page dimensions; downstream editing should preserve those dimensions and scale.

### `check.js` — layout diagnostics and baseline comparison

This module evaluates selected measurable properties of a completed tactile layout. It rasterizes the layout at a known pixels-per-millimetre resolution, separates line and texture layers, and measures geometry such as short line fragments, clearances, narrow gaps, and braille-to-line spacing.

It also creates a naive Canny edge-tracing baseline from the source image, maps it to the same page dimensions, and runs comparable measurements. This provides context for whether the structured pipeline improves selected geometric metrics over a simple edge trace.

The public entry point is `checkAll(cv, analysis, layout, imageData)`. Results are diagnostics for the transcriber, not a standards certification or a pass/fail test of tactile readability. They cannot determine whether a label is correct, whether a leader points to the intended structure, or whether a reader can reliably interpret the physical output.

### `relief.js` — 3D tactile preview and STL export

This module renders the two-dimensional tactile page as a raised surface so the user can inspect the implied physical result. It uses three.js and OrbitControls for a navigable 3D scene with a moving/raking light that makes relief features easier to see.

The module converts the non-braille SVG artwork into a sampled height field, then adds braille dots as explicit raised domes. The current model uses a flat base plate with raised diagram lines/textures and braille at their configured heights. `ReliefView` manages the WebGL renderer, camera, controls, resize behavior, scene lifecycle, and disposal of replaced geometry/materials.

`buildSTL(layout)` builds a printable mesh from the same layout data. The 3D view is a visualization and mesh-generation aid; it does not model every material property of swell paper or guarantee that a particular printer/fuser will reproduce the intended tactile characteristics.

## Data flow and module boundaries

The following boundaries are useful when changing the application:

- **UI state versus analysis state:** `ui.js` owns user interaction and DOM state. `pipeline.js` owns the analysis result. Vision modules should not reach into the DOM.
- **Engine adapters versus OCR policy:** `paddle.js` and `indra.js` produce recognition output. `ocr.js` normalizes and groups it; `vocab.js` provides domain-aware correction; `pipeline.js` selects fallbacks.
- **Leader geometry versus structural drawing geometry:** `leaders.js` estimates where labels point. `lineart.js` recovers the diagram's own boundaries. They must not be conflated.
- **Image sensitivity versus physical constraints:** `tracing-config.js` controls evidence recovery. `tactile.js` enforces physical page geometry and tactile spacing.
- **Analysis versus layout:** the pipeline works in source-image pixels. `tactile.js` converts those results to millimetres. Rendering, checking, and relief generation should consume the shared layout rather than independently recomputing placement.
- **Automated diagnostics versus human QA:** `check.js` measures selected geometry. The transcriber must still verify labels, leader associations, braille, tactile hierarchy, and a physical proof.

## Planned or not currently integrated

- **Fine exterior line rendering:** `fine-lines.js` computes and exposes detail lines for evaluation, but the current tactile layout/render path does not yet draw them.
- **Other large vision-language or segmentation models:** these are research directions described in [Advanced model options](advanced-model-options.md). SlimSAM is the default integrated segmentation backend; SAM 2.1 Hiera Tiny is the opt-in WebGPU experiment.
- **Automated semantic validation:** no module proves that OCR text is scientifically correct or that a detected leader terminates on the intended structure. Those decisions require human review.

## Further reading

- [Pipeline stages and theory](pipeline.md) — processing sequence and algorithm rationale.
- [OCR engines](ocr-engines.md) — model behavior, engine selection, and fallback details.
- [Models and engines](models-and-engines.md) — distinction between model weights and runtime libraries.
- [Fine exterior lines](fine-lines.md) — current extraction algorithm and evaluation status.
- [Application controls and options](application-options.md) — user-facing controls and their effects.
- [Tactile layout and BANA guidelines](guidelines.md) — physical constraints and design rationale.
- [Transcriber review workflow](review-workflow.md) — human review and production QA.
- [Code style](https://github.com/mrhunsaker/TactiDiagram/blob/main/CODE_STYLE.md) — source organization and implementation conventions.
