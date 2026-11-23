# Tools and libraries used by TactiDiagram

This page is a reference for every third-party tool and library the project uses: what each one is, technically, and what it buys the application. It describes the tools themselves, independently of how TactiDiagram chains them together; for that, see [Pipeline stages](pipeline.md), [Architecture](architecture.md), and [Models and inference engines](models-and-engines.md). All assets are vendored into `src/vendor/` and `src/models/` by `scripts/vendor.mjs`, so nothing is fetched from a CDN at runtime and no image data ever leaves the machine.

At a glance:

| Tool | Role | Where it is used |
| --- | --- | --- |
| SlimSAM (SAM-77) | Segmentation model (default) | `src/js/segment.js`, `models/Xenova/slimsam-77-uniform/` |
| SAM 2.1 Hiera Tiny | Segmentation model (optional, WebGPU) | `src/js/segment.js`, `models/onnx-community/sam2.1-hiera-tiny-ONNX/` |
| Transformers.js | Model loading and inference glue for the SAM models | `src/js/libs.js` |
| ONNX Runtime Web | Executes all neural networks (WASM; WebGPU for SAM 2.1) | throughout `src/js/` |
| OpenCV.js | Classical CV primitives (morphology, Hough, contours) | throughout `src/js/` |
| PaddleOCR | Primary OCR engine | `src/js/paddle.js`, `models/paddleocr/` |
| Tesseract.js | Fallback OCR engine | `src/js/ocr.js`, `src/vendor/tesseract/` |
| Indra OCR (Datalab) | Experimental alternative OCR engine | `src/js/indra.js`, `models/indra/` |
| Potrace | Raster-to-vector tracing (Autotrace preprocessing) | `src/js/autotrace.js`, `src/vendor/potrace/` |
| three.js | 3D relief preview | `src/js/relief.js`, `src/vendor/three/` |
| Neutralino | Desktop application shell | `desktop/`, `scripts/package.mjs` |

---

## Segment Anything models

Both engines answer the same question TactiDiagram asks: *given one or more points, which pixels belong to that part?* They are Segment Anything Model (SAM)-family image segmentation models, exported to ONNX as two networks that are run separately: a **vision encoder** that turns the page pixels into image embeddings (run once per diagram), and a **prompt encoder + mask decoder** that turns prompts (points) plus those embeddings into candidate masks with confidence scores (run once per label, cheap). TactiDiagram prompts with the tip of each detected leader line and the centroid of the spot under an in-figure label, then filters candidates by mask-area fraction and picks the tightest high-confidence mask, because a label names one part, not the whole object.

### SlimSAM-77 (default)

- **What it is:** `Xenova/slimsam-77-uniform`, a community ONNX export of **SlimSAM** (2024), a pruned and distilled SAM: encoder weights are pruned to a compact uniform budget (roughly a tenth of the parameters of a full SAM encoder) and the surviving model is re-tuned in small steps against its teacher, so promptable-segmentation behavior survives the shrinking. It is small enough to run on phones and in WebAssembly.

- **How TactiDiagram runs it:** fp32 on the WebAssembly backend of transformers.js (which sits on ONNX Runtime Web), fully on-device; the model, its `config.json`, and its processor settings come from the local model directory, with remote model loading disabled so there is no Hugging Face round-trip at run time.

- **What the mask is used for:** part-region masks drive which pixels get redrawn as outlined or texture-filled shapes, which pixels become background, and feed geometric checks (area, clearance) on the tactile page.

- **The benefit, concretely:** classical thresholding cannot separate a dark nucleus from the dark cytoplasm around it; SAM-style promptable segmentation can. SlimSAM makes that possible inside a browser tab on modest hardware instead of behind a GPU server, and because the weights are vendored, the first page after install does not wait on a model download.

### SAM 2.1 Hiera Tiny (optional, WebGPU)

- **What it is:** `onnx-community/sam2.1-hiera-tiny-ONNX`, the fp16 ONNX export of **SAM 2.1** at the *tiny* Hiera scale. SAM 2.1 is Meta's successor to SAM; for still images its relevant improvements are a stronger hierarchically structured (Hiera) encoder with better boundary quality and recall, and an iterative mask decoder that re-reads the image embedding while decoding. TactiDiagram stages it pinned to one commit so the processor, encoder, and decoder always agree.

- **How TactiDiagram runs it:** fp16 weights on the WebGPU execution provider of ONNX Runtime Web, in a **Chromium-based browser** (Chrome/Edge/Brave/Chromium) that exposes a compatible adapter. Firefox is gated off at load time (it ships WebGPU, but the ONNX Runtime WebGPU backend can fail mid-run there with an invalid shader module), and WebKit/Safari is not supported. The multi-level image embeddings are cached after the first decode, so the encoder runs once per diagram no matter how many labels are prompted; per-label prompt tensors are built directly from the cached embed-step dimensions (this also works around a transformers.js v4 preprocessing quirk). If **WebGPU is unavailable** (Firefox via the explicit gate, Safari/WebKit, older browsers, no adapter, some VMs) or the SAM 2.1 run fails mid-analysis, the code logs the reason and **falls back to SlimSAM automatically** (time-boxed, so a stalled runtime cannot wedge the UI): the pipeline result structure is identical, only mask quality varies with the chosen model.

- **The benefit, concretely:** crisper boundaries and fewer missed thin parts on complex diagrams than SlimSAM, at interactive latency, because the tiny encoder is GPU-accelerated rather than WASM-executed. It must be selected in the UI; it is not loaded (and not downloaded) otherwise.

## Transformers.js

**What it is:** the Hugging Face browser runtime that turns `from_pretrained()` into a browser operation: it knows each supported model class (here `SamModel` and `Sam2Model`), builds the preprocessors that turn `ImageData` into tensors, wires the model to an ONNX Runtime backend, and decodes outputs (`post_process_masks`).

**How TactiDiagram uses it:** vendored as `src/vendor/transformers/transformers.min.js`, with `env.allowRemoteModels = false` and all paths pointed at the local `src/models/` and `src/vendor/ort/` directories. SAM inference runs in a proxy worker (WASM backend) so the UI thread stays responsive during the encoder pass.

**The benefit:** a standard tensor pipeline (`RawImage` in, masks out) instead of hand-written ONNX plumbing per model, and a clean upgrade path from SlimSAM to SAM 2.1 because the loading interface is identical.

## ONNX Runtime Web (with WebGPU)

**What it is:** the browser build of ONNX Runtime (Microsoft), which executes ONNX-serialized neural networks on a selectable execution provider: WebAssembly (SIMD, optionally multi-threaded) or **WebGPU**.

**How TactiDiagram uses it:** two ways:
- as the inference engine underneath transformers.js for the SAM models (WASM provider, proxy worker);
- directly, session by session, for the two neural OCR engines (PaddleOCR, Indra): sessions are created from local model bytes with `executionProviders: ['wasm']`, while DB-style detection and CTC pre-/post-processing run as custom JavaScript around them. Threading is capped at 4 and gated on cross-origin isolation; the WebGPU module also ships the asyncify WASM binaries transformers.js needs.

**The benefit:** GPU and WASM inference for every neural network from one dependency, no runtime model fetching (sessions are created from local bytes), and a small license/security/supply-chain audit surface.

## OpenCV.js

**What it is:** the WebAssembly/Emscripten build of the OpenCV C++ computer-vision library (vendored from `@techstark/opencv-js` 4.12). It gives the app image matrices, filters and computational-geometry routines at near-native speed, loaded lazily only when a pipeline stage needs it.

**How TactiDiagram uses it:** almost every geometric stage touches it:

- **Morphology:** top-hat and black-hat transforms build the thin-stroke mask that finds leader lines (and fine linework); dilation feeds DB text-region extraction.
- **Contours and geometry:** `findContours` turns text-probability maps into text regions; `minAreaRect` reconstructs rotated text boxes; `getPerspectiveTransform` + `warpPerspective` straighten detected text quads before recognition; `matFromImageData` bridges canvas pixels into `cv.Mat`.
- **Line and shape math:** probabilistic Hough (`HoughLinesP`) proposes straight leader/structure segments; a distance transform classifies stroke widths in fine-line extraction.
- **General primitives:** Canny edges, color conversions, resizing, and image arithmetic wherever the pipeline needs a dependable building block.

**The benefit:** each stage uses well-understood, tested, fast algorithms instead of hand-rolled JavaScript CV, and every OpenCV dependency is copyleft-safe and vendored.

## OCR engines

Three interchangeable engines read the printed labels. They all expose the same word/line contract (`{text, conf, x0, y0, x1, y1, line}`), outputs are normalized (Tesseract word boxes; DB-quad boxes inset by about 17% of box height to match ink bounds), and the pipeline picks the first engine that loads, with automatic downgrade. A small in-repo vocabulary module (`src/js/vocab.js`) additionally sanity-checks short candidate strings against plausible diagram words.

### PaddleOCR (default engine)

- **What it is:** the PaddleOCR family in the **detector/recognizer split**: PP-OCRv6 *detection small* (a DB-style mask predictor producing a text/non-text probability map from which rotated quads are extracted with the "unclip" offset that grows the shrunk text kernel back out to the ink boundary) and the PP-OCRv5 *English recognizer mobile* (a small CRNN-style CNN + recurrent head reading each straightened strip with CTC decoding against a per-character dictionary). Both files are RapidOCR's Apache-2.0 ONNX conversions, fetched from ModelScope and pinned by the vendor script.

- **How TactiDiagram runs it:** directly on ONNX Runtime Web (WASM): image → white-composited RGB → resized to multiples of 32 (short side capped at 736) → detector → quads → perspective-rectified crops at fixed height, batched → recognizer → CTC decode → word boxes split from line boxes proportionally to character counts. Vertical text is tried in both orientations; final word/line grouping is redone by the app anyway.

- **The benefit, concretely:** it finds far more diagram labels than Tesseract, especially small text and dark text on colored fills, because detection treats each text region as a saliency problem rather than a page-layout problem; there is no "page" assumption to violate. That is why it is the default: OCR recall directly determines how many labels make it into braille.

### Tesseract.js (fallback engine)

- **What it is:** the WebAssembly port of Google's Tesseract 5 LSTM OCR. TactiDiagram runs its worker with `tessedit_pageseg_mode: 11` (**sparse text**, the right assumption for labels scattered around a drawing) and `preserve_interword_spaces`, so multi-word labels survive. The English traineddata (`4.0.0_best_int`) supplies the language models.

- **How TactiDiagram uses it:** as the second chance when the primary engine cannot load or produces too little text. Word sets from multiple OCR passes are unioned by intersection-over-union, keeping the more confident spelling when boxes overlap. The vendored bundle carries one local patch (deterministic task IDs instead of `Math.random()`) made purely to satisfy a CodeQL scanner, with no functional change.

- **The benefit, concretely:** battle-tested and dependency-light (the only extra asset is the language data), giving the app a dependable floor when a newer engine fails on an exotic browser or OS WebView. Its recall on diagram labels (small, colored, tightly packed text) is lower than PaddleOCR's, which is why it is not the default.

### Indra OCR (experimental alternative)

- **What it is:** **Indra** (Datalab, v1.1.0), a research OCR stack published as plain ONNX: a DB-style **detector** and a **CTC recognizer** with a `meta.json` character vocabulary. TactiDiagram pins one repository revision so the recognizer and vocabulary always agree, and stages det/rec/meta under `src/models/indra/`.

- **How TactiDiagram runs it:** as an **opt-in** checkbox, and as an automatic alternative when PaddleOCR cannot load. `src/js/indra.js` runs the detector (the same DB + unclip pipeline as the Paddle path) and either its own recognizer or Indra's recognizer over regions the Paddle detector found. It probes recognizer input shapes once at load (upstream does not document them), makes channel order configurable rather than guessed, and is deliberately conservative: only the Latin recognizer is ported (CJK/RTL/world recognizers, language-model rescoring, and orientation/script classifiers are not), so tilted pages, non-Latin scripts, and anything ambiguous **fall back rather than misread**.

- **The benefit, concretely:** a second independent opinion on hard diagrams, with no extra runtime dependency (it shares ONNX Runtime) and no risk of silently changing results: when Indra is unsure, the pipeline uses a competing engine.

## Potrace (optional Autotrace preprocessing)

**What it is:** the classic **Potrace** bitmap-tracing algorithm by Peter Selinger, here as the `esm-potrace-wasm` WebAssembly build (its GPL-2.0 license notice ships with the vendored copy). Potrace turns a bitmap into smooth vector paths; it is a *vectorizer*, not an OCR or segmentation engine.

**How TactiDiagram uses it:** in the optional **Autotrace** preprocessor, behind `src/js/autotrace.js`: the image is traced with `turdsize: 4, alphamax: 1.0, opticurve: 1, opttolerance: 0.25, posterizelevel: 4` and color extraction, converted to an SVG, then immediately rasterized back to `ImageData` at source resolution over white. That result becomes the normal analysis input. If the traced image would be blank, the step throws instead of feeding an empty image onward.

**The benefit, concretely:** tracing suppresses JPEG noise, anti-aliasing fringes, gradient backgrounds, and stray specks; the mild posterization makes faint watermarks and pale fills collapse toward the background. It is entirely optional (an explicit UI toggle), so clean scans skip it.

## three.js (3D relief preview)

**What it is:** the standard WebGL rendering library for the web, vendored with its `OrbitControls` camera helper.

**How TactiDiagram uses it:** `src/js/relief.js` turns the finished tactile layout into an extruded, height-differentiated 3D surface (bold structure, fine lines, textures, and braille dots at distinct heights), renders it for orbiting inspection, and exports the same geometry as an **STL** for 3D printing. A light "sweep" toggle helps a sighted reviewer read the relief by shading.

**The benefit:** one WebGL scene with camera controls included, a hand-rolled `buildSTL` for the printer file, and a preview a teacher can judge by eye before committing a transcriber session.


## Neutralino (desktop application shell)

**What it is:** a lightweight open-source desktop shell for web apps. Instead of shipping an Electron-style engine, TactiDiagram ships a small native binary per OS that opens the platform's own WebView pointed at the app's static resources, with an optional, restricted native API.

**How TactiDiagram uses it:** for packaged releases (`npm run package:desktop` via `scripts/package.mjs`; AppImage on Linux, zipped `.exe` on Windows). The packaged build enables the native API with an explicit allow-list covering only save/open dialogs, file writes, and asking the OS to open a file with its default application: saving the tactile SVG, key page, or STL goes through the system Save dialog, and printing hands a temporary HTML print view to the default browser. Process, extension, and all other native namespaces stay blocked. When running from a repo checkout in a normal browser, none of this is loaded.

**The benefit:** a real double-click application with no application server or network. Note the webview caveat for SAM 2.1: Windows WebView2 is Chromium-based, so SAM 2.1 is available there, but the Linux WebKitGTK webview provides no usable WebGPU, so packaged Linux builds run the SlimSAM backend only.


## Where each tool is pinned

Model files and their exact revisions live in `scripts/vendor.mjs`: SlimSAM from `Xenova/slimsam-77-uniform`, SAM 2.1 from `onnx-community/sam2.1-hiera-tiny-ONNX` at a pinned commit, PaddleOCR from RapidAI's `RapidOCR` v3.10.0, and Indra from `datalab-to/indra-ocr` at a pinned v1.1.0 revision. Tools themselves come from npm, copied into `src/vendor/` by `npm run vendor`. Third-party licenses are collected under `LICENSES/` and alongside each vendored package (GPL-2.0 for Potrace, Apache-2.0 for the PaddleOCR ONNX conversions and OpenCV.js; see the files themselves for the rest). Re-vendor locally with `npm run vendor`; see [CONTRIBUTING](contributing.md).

