// First-stage image cleanup. Potrace vectorizes the source before OCR, leader
// detection, foreground extraction, and SAM segmentation run. The rasterized SVG
// is deliberately returned as ImageData so every downstream stage sees one clean,
// consistent image rather than mixing raw pixels with a late-stage outline mask.
let potraceReady;
async function loadPotrace() {
  if (!potraceReady) {
    potraceReady = import('../vendor/potrace/index.js').then(async (m) => {
      await m.init();
      return m.potrace;
    }).catch((error) => {
      potraceReady = null;
      throw error;
    });
  }
  return potraceReady;
}

export async function prepareAutotrace(sourceImageData) {
  const potrace = await loadPotrace();
  const svg = await potrace(sourceImageData, {
    turdsize: 4,
    turnpolicy: 4,
    alphamax: 1,
    opticurve: 1,
    opttolerance: 0.25,
    pathonly: false,
    extractcolors: true,
    posterizelevel: 4,
    posterizationalgorithm: 0,
  });

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = sourceImageData.width;
    canvas.height = sourceImageData.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    // Potrace SVG may be transparent; use the same white page background as input.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const cleaned = context.getImageData(0, 0, canvas.width, canvas.height);
    if (!cleaned.data.some((value, index) => index % 4 !== 3 && value < 245)) {
      throw new Error('Potrace did not produce any visible diagram contours.');
    }
    return cleaned;
  } finally {
    URL.revokeObjectURL(url);
  }
}
