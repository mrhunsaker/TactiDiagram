// Indra OCR v1.1.0 recognizer adapter for TouchSight.
// PaddleOCR supplies text-region geometry; Indra receives upstream-compatible
// grayscale ink maps and its variable-width [x, widths] recognizer inputs.
// Any exception is allowed to propagate to pipeline.js, which immediately runs
// the full PaddleOCR detector + recognizer path.

const base = new URL('..', import.meta.url).href;
const MODELS = base + 'models/indra/';
const REC = 'rec.onnx';
const META = 'meta.json';
const LINE_HEIGHT = 32;
const PAD_Y = 0.2;
const PAD_X = 0.3;
const WIDTH_MULTIPLE = 8;
const REC_BATCH = 16;
const MIN_CONF = 0.5;

let indraPromise;
export function loadIndra({ proxy = false } = {}) {
  indraPromise ??= (async () => {
    const ort = await import(base + 'vendor/ort/ort.webgpu.min.mjs');
    ort.env.wasm.wasmPaths = base + 'vendor/ort/';
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    ort.env.wasm.proxy = proxy;

    const [recBuf, metaResponse] = await Promise.all([
      fetch(MODELS + REC).then(async r => {
        if (!r.ok) throw new Error(`Could not load ${REC} (${r.status}); run "npm run vendor"`);
        return new Uint8Array(await r.arrayBuffer());
      }),
      fetch(MODELS + META).then(r => {
        if (!r.ok) throw new Error(`Could not load ${META} (${r.status}); run "npm run vendor"`);
        return r.json();
      }),
    ]);
    const meta = metaResponse;
    const vocab = loadVocab(meta);
    const recHeight = Number(meta.rec_height || meta.recHeight || LINE_HEIGHT);
    if (!Number.isInteger(recHeight) || recHeight < 8) throw new Error('Indra meta.json has an invalid rec_height');
    const rec = await ort.InferenceSession.create(recBuf, {
      executionProviders: ['wasm'], graphOptimizationLevel: 'all',
    });
    const inputNames = rec.inputNames;
    if (!inputNames.includes('x') || !inputNames.includes('widths')) {
      throw new Error(`Indra recognizer input contract mismatch: expected x and widths, got ${inputNames.join(', ')}`);
    }
    for (const name of ['ids', 'conf', 'lengths']) {
      if (!rec.outputNames.includes(name)) throw new Error(`Indra recognizer is missing expected output "${name}"`);
    }
    return { ort, rec, vocab, recHeight };
  })().catch(error => {
    // A failed initialization must not poison subsequent attempts.
    indraPromise = null;
    throw error;
  });
  return indraPromise;
}

function loadVocab(meta) {
  let value = meta.vocab;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { /* older plain-text vocabulary */ }
  }
  if (value && !Array.isArray(value) && Array.isArray(value.chars)) value = value.chars;
  if (Array.isArray(value) && value.length > 40) return value.map(String);
  if (typeof value === 'string' && value.length > 40) return [...value];
  throw new Error('Indra meta.json does not contain the upstream vocab.chars vocabulary');
}

// Recognize PaddleOCR quadrilaterals. The upstream Indra line crop is a grayscale
// crop expanded by 0.2 line-heights vertically and 0.3 horizontally, resized to
// rec_height, converted to a 0=paper/1=ink map, then right-padded to width % 8.
export async function recognizeTextRegions(imageData, boxes, { cv = window.cv, level = 'word' } = {}) {
  const I = await loadIndra();
  if (!Array.isArray(boxes)) throw new TypeError('Indra expects an array of PaddleOCR text-region boxes');
  const gray = grayscalePage(imageData);
  const jobs = [];
  for (const box of boxes) {
    const pts = box.pts || box;
    if (!Array.isArray(pts) || pts.length < 4) continue;
    const xs = pts.map(p => Number(p[0])), ys = pts.map(p => Number(p[1]));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const h = Math.max(1, y1 - y0);
    const ix0 = Math.floor(x0 - PAD_X * h), ix1 = Math.ceil(x1 + PAD_X * h);
    const iy0 = Math.floor(y0 - PAD_Y * h), iy1 = Math.ceil(y1 + PAD_Y * h);
    const cw = Math.max(1, ix1 - ix0), ch = Math.max(1, iy1 - iy0);
    const crop = new Uint8Array(cw * ch).fill(255);
    const sx0 = Math.max(0, ix0), sx1 = Math.min(imageData.width, ix1);
    const sy0 = Math.max(0, iy0), sy1 = Math.min(imageData.height, iy1);
    for (let y = sy0; y < sy1; y++) {
      const srcOff = y * imageData.width;
      const dstOff = (y - iy0) * cw + (sx0 - ix0);
      crop.set(gray.subarray(srcOff + sx0, srcOff + sx1), dstOff);
    }
    const outW = Math.max(WIDTH_MULTIPLE, Math.min(4096, Math.round(cw * I.recHeight / ch)));
    const src = cv.matFromArray(ch, cw, cv.CV_8UC1, crop);
    const resized = new cv.Mat();
    cv.resize(src, resized, new cv.Size(outW, I.recHeight), 0, 0,
      ch > I.recHeight ? cv.INTER_AREA : cv.INTER_LINEAR);
    src.delete();
    const ink = new Float32Array(I.recHeight * outW);
    for (let p = 0; p < ink.length; p++) ink[p] = 1 - resized.data[p] / 255;
    resized.delete();
    jobs.push({ ink, width: outW, box: { x0, y0, x1, y1 }, cropX: ix0, cropWidth: cw, sourceWidth: imageData.width });
  }

  const results = [];
  for (let i = 0; i < jobs.length; i += REC_BATCH) {
    const batch = jobs.slice(i, i + REC_BATCH);
    const paddedWidth = Math.ceil(Math.max(...batch.map(j => j.width)) / WIDTH_MULTIPLE) * WIDTH_MULTIPLE;
    const x = new Float32Array(batch.length * I.recHeight * paddedWidth);
    const widths = new BigInt64Array(batch.length);
    batch.forEach((job, n) => {
      widths[n] = BigInt(job.width);
      const plane = I.recHeight * paddedWidth;
      for (let y = 0; y < I.recHeight; y++) {
        x.set(job.ink.subarray(y * job.width, (y + 1) * job.width), n * plane + y * paddedWidth);
      }
    });
    const out = await I.rec.run({
      x: new I.ort.Tensor('float32', x, [batch.length, 1, I.recHeight, paddedWidth]),
      widths: new I.ort.Tensor('int64', widths, [batch.length]),
    });
    const ids = out.ids, conf = out.conf, lengths = out.lengths;
    if (ids.dims.length !== 2 || conf.dims.length !== 2 || lengths.dims.length !== 1) {
      throw new Error('Indra returned unexpected ids/conf/lengths tensor dimensions');
    }
    const steps = ids.dims[1], confSteps = conf.dims[1];
    batch.forEach((job, n) => {
      const count = Math.min(Number(lengths.data[n]), steps, confSteps);
      const tokens = [];
      let previous = 0, confidenceSum = 0;
      for (let t = 0; t < count; t++) {
        const id = Number(ids.data[n * steps + t]);
        if (id !== 0 && id !== previous) {
          const token = I.vocab[id - 1];
          if (token !== undefined) {
            tokens.push({ token, step: t });
            confidenceSum += Number(conf.data[n * confSteps + t]);
          }
        }
        previous = id;
      }
      const confidence = tokens.length ? confidenceSum / tokens.length : 0;
      let text = tokens.map(t => t.token).join('');
      if (confidence < MIN_CONF) text = '';
      // Keep confidence semantics aligned with PaddleOCR: 0–100.
      results.push({ job, text, conf: confidence * 100, tokens });
    });
  }

  const lines = results.map(({ job, text, conf, tokens }) => {
    if (!text.trim()) return null;
    // Use Indra's CTC peak positions to map the recognizer's sequence back to
    // page coordinates; the word splitter below can then allocate boxes by glyph.
    const stepCount = Math.max(1, ...tokens.map(t => t.step + 1));
    const stride = Math.ceil(job.width / WIDTH_MULTIPLE) * WIDTH_MULTIPLE / stepCount;
    const xs = tokens.map(t => job.cropX + (t.step + 0.5) * stride * (job.cropWidth / job.width));
    const pad = Math.round(0.17 * Math.min(job.box.x1 - job.box.x0, job.box.y1 - job.box.y0));
    return {
      text: text.trim(), conf,
      x0: Math.max(0, job.box.x0 + pad), y0: Math.max(0, job.box.y0 + pad),
      x1: Math.min(imageData.width, job.box.x1 - pad), y1: Math.min(imageData.height, job.box.y1 - pad),
      tokenXs: xs,
    };
  }).filter(Boolean);
  return level === 'line' ? lines : linesToWords(lines);
}

function grayscalePage(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    const a = data[i + 3] / 255;
    const r = data[i] * a + 255 * (1 - a);
    const g = data[i + 1] * a + 255 * (1 - a);
    const b = data[i + 2] * a + 255 * (1 - a);
    gray[p] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return gray;
}

function linesToWords(lines) {
  const words = [];
  lines.forEach((line, lineIndex) => {
    const n = line.text.length, span = line.x1 - line.x0;
    let wordIndex = 0;
    for (const match of line.text.matchAll(/\\S+/g)) {
      const a = match.index, b = a + match[0].length;
      const text = match[0].replace(/^[^A-Za-z0-9(]+|[^A-Za-z0-9)]+$/g, '');
      if (!text) continue;
      words.push({
        text, conf: line.conf, line: lineIndex, word: wordIndex++,
        x0: Math.round(line.x0 + span * a / n), x1: Math.round(line.x0 + span * b / n),
        y0: line.y0, y1: line.y1,
      });
    }
  });
  return words;
}
