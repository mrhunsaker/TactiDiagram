// Label-guided segmentation: each leader tip (or the spot under an in-figure label)
// becomes a point prompt for Segment Anything (SlimSAM, on-device).

export async function embedImage(sam, imageData) {
  const { T, model, processor } = sam;
  const raw = new T.RawImage(imageData.data, imageData.width, imageData.height, 4).rgb();
  if (sam.backend === 'sam2') return { raw, inputs: await processor(raw), width: imageData.width, height: imageData.height };
  const inputs = await processor(raw);
  const embeddings = await model.get_image_embeddings(inputs);
  return { inputs, embeddings, width: imageData.width, height: imageData.height };
}

// Returns a Uint8Array mask (1 = part) at image resolution, or null.
// `positives` is a list of [x, y] image points that should all be inside the part.
export async function segmentPoint(sam, emb, positives, { minFrac = 0.0008, maxFrac = 0.45, negatives = [] } = {}) {
  const { T, model, processor } = sam;
  if (sam.backend === 'sam2') {
    const pts = [...positives, ...negatives], pointLabels = [...positives.map(() => 1), ...negatives.map(() => 0)];
    // Transformers.js v4 runs the full image preprocess on every processor call, so the
    // v3 pattern `processor(null, { input_points })` throws
    // "TypeError: Cannot read properties of null (reading 'size')". Build the prompt
    // tensors directly from the cached embed-step dimensions instead.
    const input_points = processor.reshape_input_points([[pts]], emb.inputs.original_sizes, emb.inputs.reshaped_input_sizes);
    const input_labels = new T.Tensor('int64', pointLabels.map(BigInt), input_points.dims.slice(0, -1));
    // Always run the full forward (pixel_values + prompts). Reusing the first
    // call's decoder-only outputs (image embeddings) as inputs makes this
    // Sam2Model build re-dispatch into the vision encoder and fail with
    // "Missing the following inputs: pixel_values" on the second label, so the
    // embedding cache is deliberately not used on this backend.
    const out = await model({ ...emb.inputs, input_points, input_labels });
    const masks = await processor.post_process_masks(out.pred_masks, emb.inputs.original_sizes, emb.inputs.reshaped_input_sizes);
    return maskCandidates(masks, out, emb, { minFrac, maxFrac });
  }
  const [rh, rw] = emb.inputs.reshaped_input_sizes[0];
  const sx = rw / emb.width, sy = rh / emb.height;
  const pts = [...positives, ...negatives].map(([x, y]) => [x * sx, y * sy]);
  const labels = [...positives.map(() => 1), ...negatives.map(() => 0)];
  const input_points = new T.Tensor('float32', pts.flat(), [1, 1, pts.length, 2]);
  const input_labels = new T.Tensor('int64', labels.map(BigInt), [1, 1, labels.length]);
  const out = await model({ ...emb.embeddings, input_points, input_labels });
  const masks = await processor.post_process_masks(out.pred_masks, emb.inputs.original_sizes, emb.inputs.reshaped_input_sizes);
  const m = masks[0]; // [1, 3, H, W]
  const scores = out.iou_scores.data;
  const plane = emb.width * emb.height;
  const cands = [];
  for (let k = 0; k < 3; k++) {
    const data = m.data.subarray(k * plane, (k + 1) * plane);
    let area = 0;
    for (let i = 0; i < plane; i++) area += data[i] ? 1 : 0;
    const frac = area / plane;
    if (frac < minFrac || frac > maxFrac) continue;
    cands.push({ k, score: scores[k], area, data });
  }
  if (!cands.length) return null;
  // A label names a specific part, so prefer the tightest mask that SAM is nearly as
  // confident about over the "whole object" mask.
  const top = Math.max(...cands.map((c) => c.score));
  const best = cands.filter((c) => c.score >= top - 0.06).sort((a, b) => a.area - b.area)[0];
  const mask = new Uint8Array(plane);
  for (let i = 0; i < plane; i++) mask[i] = best.data[i] ? 1 : 0;
  return { mask, score: best.score, area: best.area };
}

// Shared candidate selection for the SAM 2.1 path, mirroring the SlimSAM logic above.
function maskCandidates(masks, out, emb, { minFrac, maxFrac }) {
  const dims = masks[0].dims, plane = emb.width * emb.height, count = dims[dims.length - 3] || 3;
  const data = masks[0].data, scores = out.iou_scores.data, cands = [];
  for (let k = 0; k < count; k++) {
    const d = data.subarray(k * plane, (k + 1) * plane);
    let area = 0;
    for (let i = 0; i < plane; i++) area += d[i] > 0 ? 1 : 0;
    const frac = area / plane;
    if (frac >= minFrac && frac <= maxFrac) cands.push({ data: d, area, score: scores[k] ?? 0 });
  }
  if (!cands.length) return null;
  const top = Math.max(...cands.map((x) => x.score));
  const best = cands.filter((x) => x.score >= top - 0.06).sort((a, b) => a.area - b.area)[0];
  const mask = new Uint8Array(plane);
  for (let i = 0; i < plane; i++) mask[i] = best.data[i] > 0 ? 1 : 0;
  return { mask, score: best.score, area: best.area };
}
