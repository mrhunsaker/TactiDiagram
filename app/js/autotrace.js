// Potrace vectorization is an alternate outline extractor. It deliberately leaves
// OCR, leader assignment, SAM masks, and foreground segmentation untouched.
let potraceReady;
async function engine() {
  if (!potraceReady) potraceReady = import('../vendor/potrace/index.js').then(async (m) => {
    await m.init();
    return m.potrace;
  }).catch((e) => { potraceReady = null; throw e; });
  return potraceReady;
}

export async function updateAutotrace(imageData, analysis) {
  const potrace = await engine();
  const source = document.createElement('canvas');
  source.width = imageData.width;
  source.height = imageData.height;
  source.getContext('2d').putImageData(imageData, 0, 0);
  const svg = await potrace(source, {
    turdsize: 3,
    turnpolicy: 4,
    alphamax: 1,
    opticurve: 1,
    opttolerance: 0.25,
    pathonly: false,
    extractcolors: false,
    posterizelevel: 1,
    posterizationalgorithm: 0,
  });
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const mask = new Uint8Array(canvas.width * canvas.height);
    for (let p = 0; p < mask.length; p++) {
      const i = p * 4;
      // Potrace emits dark vector paths on a transparent canvas.
      mask[p] = pixels[i + 3] > 16 && (pixels[i] + pixels[i + 1] + pixels[i + 2]) < 600 ? 1 : 0;
    }
    if (!mask.some(Boolean)) throw new Error('Potrace returned no traceable contours for this image.');
    analysis.lineArt = mask;
    analysis.edges = mask;
    analysis.autotrace = true;
    return analysis;
  } finally {
    URL.revokeObjectURL(url);
  }
}
