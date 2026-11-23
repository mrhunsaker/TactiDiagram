# Tactile layout and BANA guidelines

TactiDiagram implements a checkable subset of the BANA *Guidelines and Standards for Tactile Graphics* (2022), with braille geometry based on Library of Congress Spec 800 and uncontracted Unified English Braille (UEB) Grade 1. These are current implementation targets, not a substitute for full standards, local production requirements, or qualified transcription review.

## Why tactile translation differs from visual tracing

Colour, shading, small labels, thin leaders, and close contours do not transfer directly to touch. Raised features that are too close can merge; tiny fragments may be impossible to identify. TactiDiagram attempts to preserve named-part boundaries, suppress print/noise, and replace colour distinctions with line hierarchy and limited texture patterns.

## Line hierarchy

| Element | Nominal vector width |
|---|---:|
| Silhouette | 1.5 mm |
| Named-part boundary emphasis (Detailed) | 1.5 mm |
| Fine structural detail (Detailed) | 0.8 mm |
| Structural strokes (Simplified) | 1.0 mm |
| Leader lines | 0.6 mm |

Vector widths do not guarantee identical raised height or tactile detectability. Verify on a physical proof.

## Textures

When enabled, the current layout assigns patterns to up to **four** sufficiently large, non-dominant segmented parts. Small parts and parts covering most of the figure are excluded. Patterns are inset from boundaries and kept clear of structural line art where possible. The legend identifies assignments. Texture use is optional; verify that patterns remain distinguishable on the target swell paper and fuser.

## Braille

- Current encoding is uncontracted UEB Grade 1 for English labels and titles.
- Dot diameter: 1.44 mm; dot pitch: 2.34 mm; cell pitch: 6.2 mm; line pitch: 10 mm.
- Full words are used when they fit. Otherwise the layout can substitute a unique two-letter key and provide a key page.
- **Use letter keys for every label** forces key representation for all labels that can be placed.
- The key generator avoids `aa`, `ac`, `cc`, and `ca`, and requires at least one letter with dot 3 or 6.
- The layout targets 3 mm clearance around braille. A white knockout may be used behind a label when needed.
- Optional title field: up to 40 characters.

Proofread braille against corrected print labels. The encoder is not a full contracted-braille or multilingual transcription system.

## Page geometry

Letter is 215.9 × 279.4 mm; Tabloid is 279.4 × 431.8 mm; Braille page is 292.1 × 279.4 mm. Layout reserves a 15 mm margin and preserves source aspect ratio. Letter and Tabloid switch to landscape when source width/height exceeds 1.15; Braille page does not auto-rotate.

## Detailed and Simplified

- **Detailed** retains more source structure, removes connected fragments under 4 mm where possible, emphasizes named-part boundaries, and keeps other details finer. It may retain crowded detail.
- **Simplified** closes nearby lines at approximately 3 mm, thins merged regions to centerlines, removes fragments shorter than 12.5 mm, and produces cleaner structural strokes. It may also remove meaningful details.

The styles are different trade-offs. Inspect the result against the source and physical proof.

## Tracing sensitivity

The slider ranges 0–100 in increments of 5, default 55. Higher values lower thresholds for foreground, edge, colour-region, and thin-stroke recovery. This can recover faint contours but may add noise. Lower values are more conservative and may omit pale features. Sensitivity does not turn off physical layout or braille-clearance logic. The UI updates tracing while reusing OCR and segmentation.

## Automated checks

The checker compares TactiDiagram output with a Canny edge baseline at the same page scale. It reports residual print-label marks, braille placement, proportion of figure area affected by lines closer than 3 mm, fragments shorter than 12.5 mm, braille labels meeting the 3 mm clearance target, texture count, and diagnostic leader lengths in the 20–37.5 mm range.

These are geometric proxies. They do not verify scientific correctness, semantic label-to-part relationships, tactile-reader comprehension, physical texture distinction, or full standards compliance. A green status is not certification; some rows are diagnostic only.

## QA loop

1. Verify every label against the source.
2. Inspect leader endpoints and segmentation masks.
3. Compare styles where density or missing detail is a concern.
4. Check braille, keys, textures, margins, and clearances.
5. Print at actual size and produce a physical swell-paper proof.
6. Obtain tactile-reader feedback where possible.

## Editable SVG handoff

The SVG uses millimetre dimensions and named groups. Inkscape is the recommended FOSS editor; other SVG editors are compatible. Vector editing is manual post-processing, not validation: edits do not update the app's analysis or report. Preserve the original export, page dimensions, and braille geometry, then independently recheck edited files.
