let potracePromise;
async function loadPotrace() {
  if (!potracePromise) {
    potracePromise = import('../vendor/potrace/index.js').then(async (module) => {
      await module.init();
      return module.potrace;
    }).catch((error) => {
      potracePromise = null;
      throw new Error('Could not initialize local Potrace: ' + (error?.message || error));
    });
  }
  return potracePromise;
}

export async function prepareAutotrace(sourceImageData) {
  if (!sourceImageData?.width || !sourceImageData?.height || !sourceImageData.data) throw new TypeError('Autotrace requires valid ImageData.');
  const potrace = await loadPotrace();
  const svg = await potrace(sourceImageData, { turdsize: 4, turnpolicy: 4, alphamax: 1, opticurve: 1, opttolerance: 0.25, pathonly: false, extractcolors: true, posterizelevel: 4, posterizationalgorithm: 0 });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = sourceImageData.width; canvas.height = sourceImageData.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D context is unavailable.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const cleaned = context.getImageData(0, 0, canvas.width, canvas.height);
    let visible = false;
    for (let i = 0; i < cleaned.data.length; i += 4) if (cleaned.data[i] < 245 || cleaned.data[i + 1] < 245 || cleaned.data[i + 2] < 245) { visible = true; break; }
    if (!visible) throw new Error('Potrace produced no visible diagram contours.');
    return cleaned;
  } finally { URL.revokeObjectURL(url); }
}

// Build a monochrome edge image from the original RGB source. Potrace then
// traces only the diagram's boundaries, not its colour fills or page background.
function makeOutlineImage(sourceImageData, labels) {
  const { width, height, data } = sourceImageData;
  const count = width * height;
  const channels = new Float32Array(count * 3);
  const excluded = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const p = i * 4, a = data[p + 3] / 255;
    for (let c = 0; c < 3; c++) channels[i * 3 + c] = data[p + c] * a + 255 * (1 - a);
  }
  // Suppress OCR labels before edge detection, with a small safety margin so
  // the label glyphs and their antialiasing cannot become vector contours.
  for (const label of labels) {
    if (label.removed) continue;
    const pad = 5;
    const x0 = Math.max(0, Math.floor(label.x0 - pad));
    const y0 = Math.max(0, Math.floor(label.y0 - pad));
    const x1 = Math.min(width, Math.ceil(label.x1 + pad));
    const y1 = Math.min(height, Math.ceil(label.y1 + pad));
    for (let y = y0; y < y1; y++) excluded.fill(1, y * width + x0, y * width + x1);
  }

  // Sobel gradients are evaluated independently per RGB channel. This retains
  // boundaries between differently coloured regions even when their luminance
  // is similar; the output itself is strictly black and white.
  const magnitude = new Uint8Array(count);
  const histogram = new Uint32Array(256);
  const sample = (x, y, c) => channels[(y * width + x) * 3 + c];
  let maxMagnitude = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (excluded[i]) continue;
      let strongest = 0;
      for (let c = 0; c < 3; c++) {
        const gx = -sample(x - 1, y - 1, c) + sample(x + 1, y - 1, c)
          - 2 * sample(x - 1, y, c) + 2 * sample(x + 1, y, c)
          - sample(x - 1, y + 1, c) + sample(x + 1, y + 1, c);
        const gy = -sample(x - 1, y - 1, c) - 2 * sample(x, y - 1, c) - sample(x + 1, y - 1, c)
          + sample(x - 1, y + 1, c) + 2 * sample(x, y + 1, c) + sample(x + 1, y + 1, c);
        strongest = Math.max(strongest, Math.hypot(gx, gy) / 4);
      }
      const value = Math.min(255, Math.round(strongest));
      magnitude[i] = value;
      if (value) { histogram[value]++; maxMagnitude = Math.max(maxMagnitude, value); }
    }
  }
  // Otsu threshold, bounded to avoid either tracing compression noise or
  // dropping faint but meaningful object outlines on pale diagrams.
  let total = 0, weighted = 0;
  for (let i = 1; i < 256; i++) { total += histogram[i]; weighted += i * histogram[i]; }
  let backgroundWeight = 0, backgroundSum = 0, bestVariance = -1, threshold = 36;
  for (let i = 1; i < 256; i++) {
    backgroundWeight += histogram[i];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += i * histogram[i];
    const meanB = backgroundSum / backgroundWeight;
    const meanF = (weighted - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (meanB - meanF) ** 2;
    if (variance > bestVariance) { bestVariance = variance; threshold = i; }
  }
  threshold = Math.max(24, Math.min(76, threshold));
  const output = new ImageData(width, height);
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    const edge = !excluded[i] && magnitude[i] >= threshold;
    const value = edge ? 0 : 255;
    output.data[p] = output.data[p + 1] = output.data[p + 2] = value;
    output.data[p + 3] = 255;
  }
  // A completely blank trace usually means the source has no recoverable edges
  // or the OCR masks covered the drawing; fail visibly instead of exporting empty SVG.
  let edgePixels = 0;
  for (let i = 0; i < count; i++) if (output.data[i * 4] === 0) edgePixels++;
  if (edgePixels < Math.max(12, count * 0.00005)) {
    throw new Error('No diagram outlines were detected. Try a clearer, higher-contrast source image.');
  }
  return output;
}

function normalizeMonochromeSvg(svg) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('Potrace returned malformed SVG.');
  const root = doc.documentElement;
  // Single-colour tracing should contain only foreground paths. Explicitly
  // discard any background primitives and force every retained path to black.
  root.querySelectorAll('rect, image, polygon, circle, ellipse').forEach((node) => node.remove());
  const paths = Array.from(root.querySelectorAll('path'));
  for (const path of paths) {
    path.setAttribute('fill', '#000000');
    path.removeAttribute('stroke');
    path.removeAttribute('style');
  }
  if (!paths.length) throw new Error('Potrace did not return editable outline paths.');
  root.removeAttribute('style');
  root.removeAttribute('color');
  return new XMLSerializer().serializeToString(root);
}

// Trace OCR-masked object boundaries from a monochrome edge map. The resulting
// SVG has no page/background shape; its black paths sit on transparent canvas.
export async function traceOriginalDiagram(sourceImageData, labels = []) {
  if (!sourceImageData?.width || !sourceImageData?.height || !sourceImageData.data) {
    throw new TypeError('Potrace requires valid source ImageData.');
  }
  const outlineImage = makeOutlineImage(sourceImageData, labels);
  const potrace = await loadPotrace();
  const svg = await potrace(outlineImage, {
    turdsize: 3, turnpolicy: 4, alphamax: 1, opticurve: 1,
    opttolerance: 0.2, pathonly: false, extractcolors: false,
    color: '#000000', background: 'transparent',
  });
  if (typeof svg !== 'string' || !/<svg\b/i.test(svg) || !/<path\b/i.test(svg)) {
    throw new Error('Potrace did not return editable SVG paths.');
  }
  return normalizeMonochromeSvg(svg);
}
