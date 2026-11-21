# Evaluation and benchmarks

## What the evaluation measures

The Playwright harness drives the local browser app against repository samples and records selected geometric guideline metrics. A separate recall script compares recognized labels with hand-counted ground truth. This supports regression testing; it is not a formal tactile-usability study.

## Run

Requirements: Node.js 24+, npm dependencies, vendored browser assets/models, and Playwright Chromium.

```bash
npm ci
npm run vendor
npx playwright install chromium
npm run serve
```

In a second terminal:

```bash
npm run eval
node scripts/recall.mjs
```

The server serves `src/`; `npm run vendor` prepares `src/vendor/` and `src/models/`. Generated evaluation output is written under `eval-out/`.

Other repository scripts include `scripts/ocrbench.mjs` (OCR benchmarking), `scripts/lab.mjs`, `scripts/la.mjs`, and `scripts/edge.mjs` (analysis/line-art/edge investigation), `scripts/qa.mjs` (QA automation), `scripts/record.mjs`, `scripts/shot.mjs`, `scripts/shot3d.mjs`, and `scripts/thumb.mjs` (recording and screenshots), `scripts/gallery.mjs` and `scripts/tsvg.mjs` (gallery/SVG tooling), and `scripts/desktop.mjs` (Neutralino launcher). These are developer tools; not all are npm commands. Inspect each script before use.

## Historical snapshot

The documentation snapshot reports results on 16 Wikimedia Commons diagrams:

| Metric | Detailed | Simplified | Canny edge baseline | Canny, text erased |
|---|---:|---:|---:|---:|
| Label recall (10 diagrams, 151 hand-counted labels) | 148/151 (98%) | same | n/a | n/a |
| Labels placed in braille | 232/233 | same | none | none |
| Print text traced as raised marks | 0 | 0 | all 233 labels | 0 |
| Short fragments under 12.5 mm | 66 | 14 | 763 | 336 |
| Mean figure area with lines under 3 mm apart | 3.5% | 1.0% | 6.4% | 4.8% |
| Braille labels with full 3 mm clearance | 165/232 (71%) | 172/231 (74%) | n/a | n/a |

These are historical figures, not a fresh run for this documentation change. Rerun after code, model, or configuration changes.

## OCR comparison and performance

The OCR chain is Indra (only when selected) → PaddleOCR → Tesseract fallback. This is sequential fallback, not an ensemble. Compare engines against the same hand-counted labels; see [OCR engines](ocr-engines.md).

Earlier measurements report roughly 10–30 seconds per diagram on an i9-14900KF desktop running Chromium with assets cached. This is a hardware-specific historical observation, not a performance guarantee.

## What is not measured

The harness does not establish tactile readability, semantic correctness of every label-to-part association, physical texture discrimination, transcription time savings, or compatibility with every printer/fuser. Those require professional review, physical proofs, and structured evaluation with tactile readers.

## Regression practice

1. Run the same sample set before and after a change.
2. Compare label recall and false positives.
3. Inspect leader endpoints and segmentation masks.
4. Compare Detailed and Simplified geometry.
5. Review braille placement and clearance.
6. Record browser, OS, hardware, model revisions, and cache state.
7. Keep before/after examples where behavior changes.
