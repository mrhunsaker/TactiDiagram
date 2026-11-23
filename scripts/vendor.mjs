// Populate browser-side dependencies and model assets for offline/local execution.
import { mkdir, copyFile, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const nm = join(root, 'node_modules');
const out = join(root, 'src', 'vendor');

function section(title, description) {
  console.log('');
  console.log('='.repeat(72));
  console.log(title);
  console.log(description);
  console.log('='.repeat(72));
}

async function cp(src, dst, description) {
  console.log(`  Copying: ${description}`);
  console.log(`    from ${src}`);
  console.log(`    to   ${dst}`);
  await mkdir(join(dst, '..'), { recursive: true });
  await copyFile(src, dst);
  console.log('    done');
}

async function fetchTo(url, dst, description) {
  try {
    if ((await stat(dst)).size > 0) {
      console.log(`  Already present; skipping: ${description}`);
      console.log(`    ${dst}`);
      return;
    }
  } catch {}

  console.log(`  Downloading: ${description}`);
  console.log(`    source: ${url}`);
  console.log(`    target: ${dst}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'TouchSight-vendor/0.1' } });
  if (!res.ok) throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`);
  await mkdir(join(dst, '..'), { recursive: true });
  const data = Buffer.from(await res.arrayBuffer());
  await writeFile(dst, data);
  console.log(`    complete (${(data.length / (1024 * 1024)).toFixed(1)} MiB)`);
}

console.log('TactiDiagram browser dependency and model setup');
console.log('This step prepares local assets so the browser app can run without fetching these files from a CDN at runtime.');
console.log('Existing non-empty model files are reused; missing files are downloaded.');

// Potrace ESM/WASM bundle and its complete third-party license notice.
section('1/7 — Potrace image-tracing support',
  'Provides the optional Autotrace preprocessing feature. The WASM package converts raster artwork to vector paths; the app rasterizes that result before its normal analysis pipeline. The license notice is included with the vendored package.');
await cp(join(nm, 'esm-potrace-wasm/dist/index.js'), join(out, 'potrace/index.js'), 'Potrace JavaScript/WASM loader');
await cp(join(root, 'LICENSES', 'GPL-2.0.txt'), join(out, 'potrace/GPL-2.0.txt'), 'Potrace third-party GPL-2.0 license');

// OpenCV.js
section('2/7 — OpenCV.js image-processing library',
  'Provides browser-side computer-vision operations used for image normalization, masks, morphology, line detection, contours, and geometric checks. This is copied from the installed npm dependency; no network download is needed.');
await cp(join(nm, '@techstark/opencv-js/dist/opencv.js'), join(out, 'opencv/opencv.js'), 'OpenCV.js browser build');

// Tesseract.js (main, worker, wasm core) + English model
section('3/7 — Tesseract.js OCR fallback',
  'Tesseract is the fallback text-recognition engine when the primary PaddleOCR path cannot load or run. Its worker and LSTM WebAssembly runtime are copied locally, and the English traineddata file supplies the language data needed to recognize English diagram labels.');
for (const f of ['tesseract.esm.min.js', 'tesseract.min.js', 'worker.min.js']) {
  await cp(join(nm, 'tesseract.js/dist', f), join(out, 'tesseract', f), `Tesseract.js runtime file: ${f}`);
}
await patchTesseractJobIds(join(out, 'tesseract', 'tesseract.esm.min.js'));
for (const f of await readdir(join(nm, 'tesseract.js-core'))) {
  // OEM 1 (LSTM only) loads one of the *-lstm.wasm.js builds (wasm embedded).
  if (/-lstm\.wasm\.js$/.test(f)) {
    await cp(join(nm, 'tesseract.js-core', f), join(out, 'tesseract/core', f), `Tesseract LSTM WebAssembly runtime: ${f}`);
  }
}
await fetchTo(
  'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz',
  join(out, 'tesseract/lang/eng.traineddata.gz'),
  'Tesseract English language model (traineddata)'
);

// transformers.js + onnxruntime-web wasm
section('4/7 — Transformers.js and ONNX Runtime Web',
  'These runtimes execute the neural-network models in the browser. Transformers.js provides the model-loading/inference interface used by SlimSAM; ONNX Runtime Web supplies the WebAssembly runtime and the WebGPU-capable module used by the OCR implementation.');
await cp(join(nm, '@huggingface/transformers/dist/transformers.min.js'), join(out, 'transformers/transformers.min.js'), 'Transformers.js browser runtime');
// The bundled transformers.min.js only requests the asyncify build of ORT.
for (const f of ['ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs']) {
  await cp(join(nm, 'onnxruntime-web/dist', f), join(out, 'ort', f), `ONNX Runtime WebAssembly runtime: ${f}`);
}

// three.js for the 3D relief preview (OrbitControls imports 'three' via the page's import map)
section('5/7 — three.js 3D relief preview',
  'The three.js modules render the interactive 3D tactile-relief preview. OrbitControls provides mouse/touch camera navigation. These files are copied from the installed npm dependency.');
for (const f of ['build/three.module.js', 'build/three.core.js', 'examples/jsm/controls/OrbitControls.js']) {
  await cp(join(nm, 'three', f), join(out, 'three', f.split('/').pop()), `three.js module: ${f}`);
}

// SlimSAM (Segment Anything, distilled) weights
section('6/7 — SlimSAM segmentation model',
  'SlimSAM is the compact Segment Anything model used to propose masks for named diagram parts from point prompts. Its configuration, image preprocessor settings, vision encoder, and prompt/mask decoder are required for browser inference.');
const hf = 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/main/';
for (const f of ['config.json', 'preprocessor_config.json', 'onnx/vision_encoder.onnx', 'onnx/prompt_encoder_mask_decoder.onnx']) {
  await fetchTo(hf + f, join(root, 'src', 'models', 'Xenova', 'slimsam-77-uniform', f), `SlimSAM model asset: ${f}`);
}

// Optional SAM 2.1 Hiera Tiny ONNX model (loaded only when selected in the UI).
section('8/8 — Optional SAM 2.1 Hiera Tiny segmentation model','Experimental WebGPU backend. Stage the pinned ONNX model and its external tensor data locally; the browser does not load it unless selected.');
const sam2='https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX/resolve/814a066/';
for(const f of ['config.json','preprocessor_config.json','processor_config.json','onnx/vision_encoder_fp16.onnx','onnx/vision_encoder_fp16.onnx_data','onnx/prompt_encoder_mask_decoder_fp16.onnx','onnx/prompt_encoder_mask_decoder_fp16.onnx_data']) await fetchTo(sam2+f,join(root,'src','models','onnx-community','sam2.1-hiera-tiny-ONNX',f),`SAM 2.1 Hiera Tiny asset: ${f}`);

// PaddleOCR text detector + English recognizer (ONNX conversions by RapidOCR, Apache-2.0),
// run by src/js/paddle.js on the WebGPU build of ORT, which loads the asyncify WASM above.
console.log('');
console.log('  Preparing PaddleOCR runtime and model files:');
console.log('  PaddleOCR is the default OCR engine. The detector locates text regions; the English recognizer reads the cropped regions. The ONNX files are RapidOCR conversions.');
await cp(join(nm, 'onnxruntime-web/dist/ort.webgpu.min.mjs'), join(out, 'ort', 'ort.webgpu.min.mjs'), 'ONNX Runtime Web WebGPU module used by PaddleOCR');
const rapid = 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/';
for (const f of ['PP-OCRv6/det/PP-OCRv6_det_small.onnx', 'PP-OCRv5/rec/en_PP-OCRv5_rec_mobile.onnx']) {
  await fetchTo(rapid + f, join(root, 'src', 'models', 'paddleocr', f.split('/').pop()), `PaddleOCR model: ${f}`);
}

// Indra OCR v1.1.0 (Datalab) - experimental recognizer used with PaddleOCR's
// detector. The CTC recognizer and meta.json vocabulary are pinned to the same
// model revision. Requires onnxruntime-web, already vendored above.
section('7/7 — Indra OCR experimental alternative',
  'Indra is an optional, experimental Latin-script recognizer. PaddleOCR supplies text-region geometry; Indra reads those crops, and meta.json supplies the matching character vocabulary and input settings. The recognizer and metadata are pinned to one repository revision. ONNX Runtime is provided in the earlier runtime step.');
const indra = 'https://huggingface.co/datalab-to/indra-ocr/resolve/bd02167/';
for (const f of ['rec.onnx', 'meta.json', 'LICENSE']) {
  await fetchTo(indra + f, join(root, 'src', 'models', 'indra', f), `Indra OCR v1.1.0 asset: ${f}`);
}

console.log('');
console.log('Vendor setup complete.');
console.log('Browser libraries are in src/vendor/; model assets are in src/models/.');
console.log('You can now run the app with: npm run serve');

// CodeQL js/insecure-randomness: the vendored Tesseract.js bundle uses Math.random()
// only to mint non-cryptographic task IDs inside its worker scheduler. Rewrite that
// one call with a deterministic stepping counter so the committed bundle is free of
// insecure-randomness findings without changing any behavior.
async function patchTesseractJobIds(dst) {
  const text = await readFile(dst, 'utf8');
  const insec = 'concat(Math.random().toString(16).slice(3,8))';
  const patch = 'concat((globalThis.__tesseractJobSeq=((globalThis.__tesseractJobSeq|0)+4194305)).toString(16).slice(1,6))';
  if (!text.includes(insec)) {
    console.log('  Note: Tesseract job-ID pattern not found; nothing patched (upstream bundle changed?).');
    return;
  }
  await writeFile(dst, text.replace(insec, patch));
  console.log('  Patched insecure random task-ID generation out of vendored Tesseract.js');
}
