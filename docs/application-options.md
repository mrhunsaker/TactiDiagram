# Application controls and options

This reference describes the controls implemented in `src/index.html`, `src/js/ui.js`, and the layout/analysis modules on the current main branch.

## Choose a diagram

The sample gallery provides heart, volcano, animal cell, mitochondrion, tooth, ear, earth layers, flower, and eye examples. Select a thumbnail to run it. Upload or drop a PNG, JPEG/JPG, or WebP image to use your own source. Files larger than 15 MiB are rejected. Transparent pixels are composited onto white; the longest image side is scaled to at most 1,400 pixels for analysis.

Use a clear labeled diagram where possible. Handwriting, rotated text, busy fills, overlapping leaders, and low-contrast lines can reduce recognition quality.

## Output options

### Paper

| Choice | Physical dimensions |
|---|---:|
| Swell paper: Letter | 8.5 × 11 in (215.9 × 279.4 mm) |
| Swell paper: Tabloid | 11 × 17 in (279.4 × 431.8 mm) |
| Braille page | 11.5 × 11 in (292.1 × 279.4 mm) |

Letter and Tabloid automatically use landscape when the source width/height ratio exceeds 1.15; otherwise they use portrait. Braille page does not auto-rotate. Layout preserves image aspect ratio and reserves a 15 mm margin. Changing paper rebuilds layout/checks, not OCR or segmentation.

### Outline style

- **Detailed (like the original):** retains more source structure. It drops connected specks under 4 mm where possible, emphasizes edges associated with named-part masks, and retains other detail as finer lines. It can preserve useful internal anatomy but leave crowded regions for review.
- **Simplified (3 mm spacing):** merges nearby lines at approximately the 3 mm scale, thins merged regions to centerlines, removes fragments shorter than 12.5 mm, and produces a cleaner structural layer. It can remove meaningful detail as well as noise.

This is a trade-off, not a quality ranking. Compare both styles on crowded diagrams. Changing style rebuilds layout/checks without rerunning OCR or segmentation.

### Use Autotrace (Potrace)

Off by default. When enabled, the locally vendored Potrace WebAssembly package reconstructs the source as SVG; the app rasterizes that SVG at the normalized source dimensions and uses the reconstructed raster for OCR, leader detection, foreground/line analysis, and segmentation. The original remains available in the **Original** view.

Try it when raster edges are noisy, but compare carefully: reconstruction can simplify small details, alter boundaries, or affect OCR. If initialization fails or no visible contours are produced, the run reports an error and restores the previous result. Toggling Autotrace reruns the complete analysis.

### Use Indra OCR

Off by default and experimental. When checked, Indra OCR v1.1.0 is attempted first; if it errors or returns no text, PaddleOCR is tried, then Tesseract.js if PaddleOCR cannot run. When unchecked, PaddleOCR is first and Tesseract is the fallback. This is sequential fallback, not an ensemble.

The browser port currently supports Latin-script recognition only; the reference package's CJK/RTL/world recognizers, orientation/script classifiers, and language-model rescoring are not ported. Do not select it expecting multilingual OCR. Model assets must be prepared by `npm run vendor`. Toggling this option reruns all analysis. See [OCR engines](ocr-engines.md).

### Tracing sensitivity (0–100)

The slider moves in steps of 5 and defaults to 55. Lower values are more conservative and can suppress noise, but may miss pale or faint contours. Higher values lower detection thresholds and can recover lighter regions and strokes, but may add noise and unnecessary detail. Sensitivity affects foreground, edge, colour-region, and thin-stroke recovery; it does not disable physical layout or braille-clearance logic.

After the slider changes, tracing is recalculated from the current prepared image while OCR and segmentation are reused. Start at 55 and adjust by 5–10 after inspecting **What the AI saw**. There is no universally correct value.

### Title (in braille, optional)

Enter up to 40 characters. The title is encoded in uncontracted UEB Grade 1 braille and placed in a reserved area above the diagram. Leave blank if not required or if page space is limited. Proofread the title and braille; this is not a full literary transcription tool. Changing it rebuilds layout/checks only.

### Fill parts with textures

When enabled, the layout assigns distinct patterns to up to four sufficiently large, non-dominant segmented parts. Small parts and parts covering most of the figure are excluded; fills are inset from boundaries and kept clear of structural lines where possible. When disabled, the layout relies on outlines and line hierarchy. Textures can encode distinctions that colour cannot, but must be checked on a physical proof. Changing this option rebuilds layout/checks only.

### Use letter keys for every label

When enabled, all labels that can be placed use unique two-letter alphabetic braille keys rather than full braille words. A key page maps each key to its full print label.

When disabled, the layout first tries full uncontracted braille and uses a key only when the full label cannot be placed without collisions or leaving the page. Thus a key page may still be produced with this option off. Review key uniqueness and mapping. Changing it rebuilds layout/checks only.

## Result views

- **Tactile graphic:** layout preview. **Tactile** shows the page; **Overlay** places the original beneath the tactile drawing; **Original** shows the normalized source only.
- **What the AI saw:** prepared analysis image with OCR boxes, leader estimates, segmentation masks, and anchors. If Autotrace is on, this view reflects the reconstructed image; use Original to compare with the upload.
- **vs. edge tracing:** compares the label-guided output with a simple Canny edge-tracing baseline at the same page scale. The baseline is a diagnostic, not a competing complete transcription system.
- **Key page:** shows the key legend when any labels use keys. If all labels fit in full braille, it reports that no key page is needed.
- **3D relief:** interactive raised-geometry view. Drag to rotate and scroll to zoom. The moving-light control pauses/resumes raking light. WebGL is required for this view and STL export, not for SVG or print/PDF.

## Review labels

Each detected entry shows text, braille preview, placement status (full braille or key), association status (leader traced or label sits on the part), segmentation status, and any automatic vocabulary correction.

- **Edit text:** change the field and commit it (Enter or focus change). Braille and layout update; OCR is not rerun.
- **Merge:** the up-arrow appends this entry to the entry immediately above and combines their bounding boxes. Use only when OCR split one multi-line label. It removes the lower entry; inspect the merged label and association.
- **Remove / Undo:** exclude a false or irrelevant detected label, or restore it. This changes layout, not the analysis run.

The current interface cannot add a label that OCR missed entirely. Hovering an entry highlights its associated mask/label in supported views.

## Guideline check

The table reports residual print marks, braille placement, close-line area, short fragments, braille clearance, texture count, and diagnostic leader lengths alongside a Canny baseline. A neutral row may be diagnostic rather than pass/fail. These geometric measurements do not establish scientific correctness, semantic label-to-part accuracy, tactile discrimination, or compliance certification.

## Export

- **Download editable tactile SVG:** saves vector geometry with millimetre page dimensions and named groups. Inkscape is the recommended FOSS editor; other SVG editors can be used.
- **Key page:** downloads the key-page SVG.
- **Print / PDF:** opens a print document containing the tactile page and automatically appends the key page when keys are present. Use Save as PDF or print at 100% / actual size; disable fit-to-page.
- **Download STL for 3D printing:** available in the 3D relief tab; exports a plate model of raised lines, textures, and braille.

Screen-only preview elements are not necessarily part of the production SVG. Preserve physical page dimensions and braille/line sizes when editing. Keep an untouched export and independently recheck edits; vector-editor changes do not update the app's automated report.

## Current limitations

The app has no in-app freehand contour editor, freehand leader editor, add-missed-label control, contracted UEB, multilingual braille transcription, or automatic tactile-usability certification. Larger vision-language and segmentation models on the [research roadmap](advanced-model-options.md) are not current app options.
