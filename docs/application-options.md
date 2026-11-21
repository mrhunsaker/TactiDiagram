# Application controls and options

This page describes the controls in the current `src/index.html` and their behavior in `src/js/ui.js` and the layout/analysis modules. It is a reference for the controls as implemented, not a statement that every output is production-ready.

## 1. Choose a diagram

### Built-in samples

Select a sample thumbnail in the left rail. The current sample gallery includes heart, volcano, animal cell, mitochondrion, tooth, ear, earth layers, flower, and eye. Samples are useful for learning the workflow and comparing settings. They are not a substitute for testing a representative source diagram from the actual transcription job.

### Upload or drop an image

The file picker and drag-and-drop area accept:

- PNG (`.png`)
- JPEG/JPG (`.jpg`, `.jpeg`)
- WebP (`.webp`)

The UI rejects files larger than **15 MiB**. The app composites transparent pixels onto white and scales the image so its longest side is no more than **1,400 pixels** before analysis. The original-size file is not retained as the analysis raster; the normalized raster is used for inference and comparison.

Use a clean, legible source with labels and leader lines where possible. Low-resolution scans, handwriting, rotated text, complex overlapping leaders, and labels on busy fills can reduce detection quality.

## 2. Output options

Options are in the left rail under **Output options**. Choose them before analysis when possible. Some options rerun the complete analysis; others rebuild only the tactile page from the existing analysis.

### Paper

Select the physical page format used by the layout engine:

| Choice | Physical size | Behavior |
|---|---:|---|
| Swell paper: Letter | 8.5 × 11 in (215.9 × 279.4 mm) | Default. |
| Swell paper: Tabloid | 11 × 17 in (279.4 × 431.8 mm) | Larger page for diagrams that need more room. |
| Braille page | 11.5 × 11 in (292.1 × 279.4 mm) | Square-ish braille production page; the layout does not automatically rotate this format for a landscape source. |

For Letter and Tabloid, a source image with width/height ratio greater than 1.15 is laid out in landscape orientation. Otherwise it is portrait. The layout reserves a 15 mm page margin and fits the image into the remaining area while preserving its aspect ratio. A nonempty title reserves additional vertical space.

Changing the page rebuilds the layout and checks; it does not rerun OCR or segmentation.

### Outline style

This controls how much source structure becomes raised line art:

- **Detailed (like the original)** — preserves more of the traced source structure. The layout removes short specks under 4 mm where possible, emphasizes boundaries associated with named-part segmentation masks, and retains other detail as finer lines. This can preserve useful anatomy or internal structure, but can also leave more close lines and small details for the transcriber to review.
- **Simplified (3 mm spacing)** — emphasizes major region boundaries and thin drawn strokes, closes gaps at approximately the 3 mm clearance scale, thins merged areas to centerlines, removes fragments shorter than 12.5 mm, and raises the resulting structural strokes to the nominal 1 mm line target. Use it when the detailed result is too crowded for touch.

The 3 mm setting is a processing target, not a guarantee that every part of every output will pass physical tactile inspection. Compare both styles on the source and on a physical proof.

Changing the style rebuilds the layout and checks; it does not rerun OCR or segmentation.

### Use Autotrace (Potrace)

**Off by default.** When enabled, the app runs the source raster through the locally vendored Potrace WebAssembly package, obtains an SVG reconstruction, rasterizes that SVG back to an image at the original normalized pixel dimensions, and then runs the normal OCR, leader, foreground, structural-line, and segmentation pipeline on that reconstructed image.

Use it when the source has noisy raster edges or you want to test whether a vector reconstruction produces cleaner contours. Do not assume it improves every image: tracing can remove small details, alter boundaries, or affect OCR. Compare the **Original** view with the analysis and tactile result. The original source is retained for comparison; the reconstructed raster is the analysis input.

If Potrace cannot initialize or produces no visible contours, the analysis reports an error and restores the previous result. Turning this option on or off reruns the full analysis.

### Use Indra OCR

**Off by default; experimental.** When checked, the app tries Datalab Indra OCR v1.1.0 first. If Indra throws an error or returns no text, the pipeline tries PaddleOCR; if PaddleOCR cannot run, Tesseract.js is the final fallback. With the box unchecked, PaddleOCR is the first engine and Tesseract is the fallback.

This is a fallback chain, not an ensemble: the engines do not vote on every label. Indra's current browser port supports Latin-script recognition and omits the reference package's CJK/RTL/world recognizers, orientation/script classifiers, and language-model rescoring. It is therefore not the preferred setting for non-Latin scripts or difficult orientation cases.

The checkbox requires the Indra model assets to have been prepared with `npm run vendor`. Enabling or disabling it reruns the full analysis because the OCR results can change. Check the **What the AI saw** view and correct every label against the source. See [OCR engines](ocr-engines.md) for model and validation details.

### Tracing sensitivity (0–100)

The slider has a range of **0 to 100**, in steps of **5**, and starts at **55**.

- **Lower values** use more conservative thresholds. This can suppress weak/noisy contours but may miss faint lines, pale boundaries, or low-contrast strokes.
- **Higher values** lower several detection thresholds and make the pipeline more willing to recover faint regions and strokes. This can reveal useful detail but may also introduce noise, extra contours, or clutter.

Sensitivity affects foreground, edge, region, and thin-stroke recovery. It does **not** relax downstream physical layout rules such as braille clearance or tactile line-size handling. After changing the slider, the app updates tracing from the existing prepared image and reuses OCR and segmentation rather than rerunning those expensive stages. The status message confirms that OCR and segmentation were reused.

There is no universally correct setting. Start at 55, inspect the **What the AI saw** overlay, and move in increments of 5–10 when faint structures are missed or noise is excessive. Recheck both the detailed and simplified tactile layouts after changing it.

### Title (in braille, optional)

Enter a short title of up to **40 characters**. The title is encoded as uncontracted UEB Grade 1 braille and placed in the reserved title area at the top of the page. The field is optional; leave it blank if a title is not required or if it would consume space needed by the diagram.

The current encoder is designed for short English labels. Proofread title spelling and braille; the field does not provide contracted braille or a full literary transcription workflow.

Changing the title rebuilds the layout and checks, without rerunning OCR or segmentation.

### Fill parts with textures

When checked, the layout assigns distinct fill patterns to up to **four** sufficiently large, non-dominant segmented parts. The patterns are inset from the part boundary and kept clear of structural line art where possible. Very large parts and small parts are not textured because a pattern can obscure the figure or become too dense to distinguish.

When unchecked, parts use outlines and line hierarchy without these interior texture fills. Textures can help distinguish named regions when colour is unavailable to touch, but they should be checked on a physical proof; visually distinct patterns can merge when raised.

Changing this option rebuilds the layout and checks, not OCR or segmentation.

### Use letter keys for every label

When checked, every placed label uses a generated **two-letter alphabetic key** in braille instead of trying to fit the full word in braille beside the figure. A key page is then needed to map each two-letter key back to its full print label.

When unchecked (default), the layout first attempts to place the full uncontracted braille label. If it cannot fit within the page or avoid other labels and drawing geometry, it falls back to a two-letter key for that label. Therefore, even with this option off, a key page can still be generated for labels that do not fit in full.

Keys are generated to be unique within the page and avoid selected ambiguous letter pairs. Review the key-to-label mapping and the braille on both pages. Changing this option rebuilds the layout and checks, not OCR or segmentation.

## 3. Result views

After a successful analysis, the center stage provides five tabs:

- **Tactile graphic** — the production-oriented layout preview. Its sub-controls switch between Tactile, Overlay, and Original:
  - **Tactile** shows the tactile page preview.
  - **Overlay** places the original image beneath the tactile rendering to help compare alignment and retained structure.
  - **Original** shows the normalized source image by itself.
- **What the AI saw** — overlays detected label boxes, leader-line estimates, segmentation masks, and anchor points on the prepared analysis image. Use it to find OCR, leader, and mask errors. If Autotrace is enabled, the analysis image is the reconstructed raster; use the Original mode to compare with the uploaded source.
- **vs. edge tracing** — compares TouchSight-NG's label-guided layout with a simple Canny edge-tracing baseline at the same page scale. It demonstrates why raw edge tracing can retain print and visual clutter; it is not a contest between two complete transcription systems.
- **Key page** — displays the key-to-print-label page when one or more labels use keys. If all labels fit in full braille, the view explains that no key page is needed.
- **3D relief** — displays raised geometry for inspection. Drag to rotate and scroll to zoom. The light control pauses or resumes the moving/raking light. WebGL is required; lack of WebGL does not prevent SVG or print/PDF export.

## 4. Review labels

Each detected label entry shows its text, a braille preview, and status:

- **full braille** or **key “xx”** describes how the label is represented in the current layout;
- **leader traced** means the geometric leader detector found a candidate leader;
- **label sits on the part** means no leader was assigned and the pipeline used an in-figure anchor;
- **part segmented** means a segmentation mask was produced;
- **no part found** means there is no usable mask for that label;
- **auto-corrected** identifies vocabulary-based OCR changes that should still be checked.

Available actions:

- Edit the text field and commit the change (for example, press Enter or move focus). Braille and layout are rebuilt immediately. This corrects a detected label; it does not rerun OCR.
- Use the merge control (up-arrow) to append the current label to the label immediately above it. This is intended for OCR that split one multi-line label into separate entries. It removes the lower entry and combines the bounding boxes; inspect the resulting association because a merge can also combine two genuinely separate labels if used incorrectly.
- Use **Remove** to exclude a false or irrelevant label from the layout. Use **Undo** on that entry to restore it. Removing a label does not delete the source image or rerun analysis.

The current interface does not provide a general add-missing-label action. If OCR misses a required label entirely, it must be handled outside the current in-app label editor and documented as a limitation of the generated draft.

Hovering a label entry highlights its corresponding mask/label in the analysis view or tactile view (where the view supports that highlight).

## 5. Automated guideline check

The check table reports TouchSight-NG measurements beside an edge-tracing baseline. It includes residual print-label marks, braille label placement, areas of narrow line gaps, short fragments, braille clearance, texture count, and leader lengths. Some rows are diagnostic rather than pass/fail; a neutral or blank status means the checker does not define a pass condition for that row.

These are geometric checks on the generated layout. They cannot verify scientific correctness, semantic label-to-part relationships, tactile discrimination, physical swell height, or reader comprehension. Read [Tactile layout and BANA guidelines](guidelines.md) and perform professional review and physical proofing.

## 6. Export and production

- **Download editable tactile SVG** saves the tactile page as an SVG with millimetre dimensions and named vector groups. Open it in Inkscape (recommended FOSS editor) or another SVG editor for manual post-processing.
- **Key page** downloads the key-page SVG. It is useful when the layout uses two-letter keys; the key page can still be downloaded, but may contain no useful entries if all labels fit in full braille.
- **Print / PDF** opens a print-ready browser document. It includes the tactile page and automatically appends the key page when keys are present. Use the print dialog's Save as PDF or print at 100% / actual size; disable fit-to-page scaling.
- **Download STL for 3D printing** is in the 3D relief tab. It exports a plate model of raised lines, textures, and braille. It is a separate fabrication route and does not validate swell-paper output.

The editable SVG and print/PDF contain production geometry, not every screen-only preview element. Preserve page dimensions and braille/line sizes when editing. Keep an untouched copy of the original export and independently recheck any edits; a vector-editor change does not update the app's automated report. See [Printing and swell paper](printing.md) and [Review workflow](review-workflow.md).

## 7. What the application does not currently do

The current UI does not provide manual drawing tools for adding arbitrary contours, a freehand leader editor, a way to add a completely missed OCR label, contracted UEB, multilingual braille transcription, or automatic certification that a page meets every tactile standard. Larger vision-language and segmentation models described in [Advanced model options](advanced-model-options.md) are research candidates, not active controls.
