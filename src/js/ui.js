import { loadOpenCV } from './libs.js';
import { analyze, updateTracing } from './pipeline.js';
import { DEFAULT_TRACING_SENSITIVITY } from './tracing-config.js';
import { prepareAutotrace, traceOriginalDiagram } from './autotrace.js';
import { buildLayout } from './tactile.js';
import { renderTactile, renderPotraceBraille, renderKeyPage, TEXTURES } from './render.js';
import { checkAll } from './check.js';
import { toUnicode } from './braille.js';

// ---------- desktop shell (Neutralino) ----------
// The packaged desktop app runs in a WebView that blocks blob-URL downloads and
// window.open, so file saves and printing go through Neutralino native APIs.
// In a plain browser this stays null and the normal download/open path is used.
let desktop = null;
try {
  await import('./neutralino.js');
  if (window.NL_PORT && window.Neutralino) {
    Neutralino.init();
    desktop = window.Neutralino;
  }
} catch { /* plain browser tab: no Neutralino client here */ }
let reliefMod = null, relief = null, reliefFor = null;
async function showRelief() {
  try {
    reliefMod ??= await import('./relief.js');
    relief ??= new reliefMod.ReliefView($('#relief'));
    if (reliefFor !== state.layout) { await relief.build(state.layout); reliefFor = state.layout; }
    else relief.start();
  } catch (e) {
    console.error(e);
    $('#relief').innerHTML = `<p style="color:#eee;padding:24px">3D preview needs WebGL, which this browser could not start (${e.message}).</p>`;
  }
}

// Forward browser diagnostics to the local development server terminal.
const browserLogLevel = new URLSearchParams(location.search).get('log') || 'info';
const logLevels = { debug: 10, info: 20, warn: 30, error: 40 };
function sendTerminalLog(level, args) {
  if ((logLevels[level] ?? 20) < (logLevels[browserLogLevel] ?? 20)) return;
  const detail = args.map((value) => {
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
    try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); }
  });
  fetch('/__debug/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, detail, page: location.pathname + location.search, time: new Date().toISOString() }),
    keepalive: true,
  }).catch(() => {});
}
for (const level of ['debug', 'info', 'warn', 'error']) {
  const original = console[level]?.bind(console);
  if (!original) continue;
  console[level] = (...args) => {
    original(...args);
    sendTerminalLog(level, args);
  };
}
window.addEventListener('error', (event) => {
  sendTerminalLog('error', [event.message, { filename: event.filename, line: event.lineno, column: event.colno, error: event.error }]);
});
window.addEventListener('unhandledrejection', (event) => sendTerminalLog('error', ['Unhandled promise rejection', event.reason]));

const $ = (s) => document.querySelector(s);
const state = { imageData: null, sourceImageData: null, original: null, analysis: null, traceSvg: null, layout: null, check: null, name: 'diagram', busy: false, mode: 'tactile', sensitivity: DEFAULT_TRACING_SENSITIVITY, pending: null, optionsSnapshot: null };
const MAX_SIDE = 1400; // keep in-browser inference fast
const PAL = ['#e6194b', '#3cb44b', '#0082c8', '#f58230', '#911eb4', '#2fa8a8', '#f032e6', '#7f9d1f', '#008080', '#aa6e28', '#5a5aff', '#c0392b'];

// ---------- samples ----------
const grid = $('#samples');
const byId = Object.create(null);
const assetURL = (path) => new URL(`../${path}`, import.meta.url).href;
const shortTitle = (t) => String(t || 'Sample').replace(/^(Diagram of the |Schematic diagram of the )/i, '').replace(/^./, (c) => c.toUpperCase());

async function loadSamples() {
  grid.replaceChildren();
  try {
    const response = await fetch(assetURL('samples/samples.json'), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Sample manifest request failed: HTTP ${response.status}`);
    const samples = await response.json();
    if (!Array.isArray(samples) || samples.length === 0) throw new Error('Sample manifest is empty or invalid.');
    for (const sample of samples) {
      if (!sample?.id || !sample?.file) {
        console.warn('Skipping malformed sample manifest entry:', sample);
        continue;
      }
      byId[sample.id] = sample;
      const button = document.createElement('button');
      button.className = 'sample';
      button.type = 'button';
      button.dataset.id = sample.id;
      button.setAttribute('role', 'listitem');
      button.setAttribute('aria-pressed', 'false');
      const image = document.createElement('img');
      image.src = assetURL(`samples/${sample.file}`);
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => console.error('Sample thumbnail failed to load:', sample.id, image.src));
      const label = document.createElement('span');
      label.textContent = shortTitle(sample.title);
      button.append(image, label);
      button.title = `${sample.title || sample.id} — ${sample.author || 'Unknown author'}, ${sample.license || 'License unspecified'}`;
      button.addEventListener('click', () => runSample(sample.id, false));
      grid.appendChild(button);
    }
    if (!grid.children.length) throw new Error('No usable sample entries were found in the manifest.');
    console.info(`Loaded ${grid.children.length} sample choices.`);
  } catch (error) {
    console.error('Could not populate sample gallery:', error);
    setStatus(`Sample gallery could not be loaded: ${error.message}`, true);
  }
}
await loadSamples();

function runSample(id, autoRun = false) {
  const sample = byId[id];
  if (!sample) return setStatus(`Sample "${id}" is not present in the sample manifest.`, true);
  if (state.busy) return setStatus('Please wait for the current analysis to finish.', true);
  grid.querySelectorAll('.sample').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.id === id)));
  console.info('Loading sample:', id, sample.file);
  runFromURL(assetURL(`samples/${sample.file}`), shortTitle(sample.title), id).then((loaded) => {
    // Deep links and the hero demo start only after the sample has decoded successfully.
    if (autoRun && loaded) startAnalysis();
  }).catch((error) => {
    console.error('Could not stage sample:', sample.id, error);
    setStatus(`Could not load ${sample.title || sample.id}. ${error.message || error}`, true);
  });
}
// The hero CTA is a one-click demo: load the heart sample and start the pipeline.
$('#try-heart').addEventListener('click', () => runSample('heart', true));

// ---------- input ----------
const drop = $('#drop');
const file = $('#file');
const uploadPreview = $('#upload-preview');
function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function showUploadPreview({ src, name, width, height, size }) {
  $('#upload-preview-image').src = src;
  $('#upload-preview-name').textContent = name;
  $('#upload-preview-meta').textContent =
    `${width} × ${height} px · ${formatFileSize(size)}`;
  uploadPreview.hidden = false;
  drop.classList.add('has-upload');
}
function clearUploadPreview(preservePending = false) {
  uploadPreview.hidden = true;
  $('#upload-preview-image').removeAttribute('src');
  $('#upload-preview-name').textContent = '';
  $('#upload-preview-meta').textContent = '';
  drop.classList.remove('has-upload');
  if (!preservePending) state.pending = null;
  updateAnalyzeButton();
}
$('#upload-clear').addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  clearUploadPreview();
  setStatus('Selected upload removed. Choose another diagram or select a sample.');
});
function openFilePicker() {
  if (state.busy) return setStatus('Please wait for the current analysis to finish.', true);
  file.disabled = false;
  console.debug('Opening image file picker.');
  try {
    if (typeof file.showPicker === 'function') file.showPicker();
    else file.click();
  } catch (error) {
    console.warn('showPicker() unavailable; falling back to input.click():', error);
    file.click();
  }
}
$('#browse-file').addEventListener('click', (event) => {
  event.stopPropagation();
  openFilePicker();
});
drop.addEventListener('click', (event) => {
  if (event.target.closest('#browse-file, #upload-clear')) return;
  openFilePicker();
});
drop.addEventListener('keydown', (event) => {
  if (event.target === drop && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openFilePicker();
  }
});
file.addEventListener('change', () => {
  const selected = file.files?.[0];
  console.info('File picker selection:', selected ? { name: selected.name, type: selected.type, size: selected.size } : 'no file selected');
  if (selected) runFromFile(selected);
  file.value = '';
});
['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (event) => {
  const selected = event.dataTransfer?.files?.[0];
  if (selected) runFromFile(selected);
});

function runFromFile(selected) {
  const extension = selected.name.split('.').pop()?.toLowerCase();
  const supported = /^image\/(png|jpeg|webp)$/i.test(selected.type) || ['png', 'jpg', 'jpeg', 'webp'].includes(extension);
  if (!supported) return setStatus('Please choose a PNG, JPG or WebP image.', true);
  if (selected.size > 15 * 1024 * 1024) return setStatus('That image is over 15 MB. Please use a smaller file.', true);
  if (state.busy) return setStatus('Please wait for the current analysis to finish.', true);
  grid.querySelectorAll('.sample').forEach((button) => button.setAttribute('aria-pressed', 'false'));
  const objectURL = URL.createObjectURL(selected);
  console.info('Reading uploaded image:', { name: selected.name, type: selected.type, size: selected.size });
  runFromURL(objectURL, '', selected.name.replace(/\.[^.]+$/, ''), true, { size: selected.size });
}

async function runFromURL(url, title, name, revokeUrl = false, fileInfo = null) { // loads only; see startAnalysis()
  if (state.busy) {
    if (revokeUrl) URL.revokeObjectURL(url);
    return setStatus('Please wait for the current analysis to finish.', true);
  }
  try {
    console.debug('Decoding image:', url);
    const img = new Image();
    img.src = url;
    await img.decode();
    let W = img.naturalWidth, H = img.naturalHeight;
    if (!W || !H) throw new Error('The selected image has no usable dimensions.');
    const scale = Math.min(1, MAX_SIDE / Math.max(W, H));
    W = Math.round(W * scale); H = Math.round(H * scale);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser could not create a 2D canvas context.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, W, H);
    context.drawImage(img, 0, 0, W, H);
    const sourceImageData = context.getImageData(0, 0, W, H);
    // Only stage the image: analysis starts when the user presses the Start button,
    // so settings can be reviewed first without waiting for a run in between.
    const previewDataURL = canvas.toDataURL('image/jpeg', 0.82);
    state.pending = { sourceImageData, original: previewDataURL, name: name || 'diagram', title: title || '' };
    if (fileInfo) {
      showUploadPreview({ src: previewDataURL, name: name || 'Uploaded image', width: W, height: H, size: fileInfo.size });
    } else {
      clearUploadPreview(true);
    }
    console.info('Image loaded; waiting for Start:', { width: W, height: H, name: state.pending.name });
    setStatus(`${state.pending.name} loaded. Set the options on the left, then press Start analysis.`);
    updateAnalyzeButton();
    return true;
  } catch (error) {
    console.error('Could not load or decode image:', error);
    setStatus('Could not read that image. ' + (error.message || ''), true);
    return false;
  } finally {
    if (revokeUrl) URL.revokeObjectURL(url);
  }
}

// ---------- explicit start ----------
// The Start button is the only thing that launches the full pipeline (besides a
// sample deep link), so a user can load an image, set every option, and choose
// when to spend the processing time.
function currentPipelineOptions() {
  return {
    autotrace: $('#opt-autotrace')?.checked ?? false,
    indra: $('#opt-indra')?.checked ?? false,
    sam21: $('#opt-sam21')?.checked ?? false,
    potraceOutput: $('#opt-original-braille')?.checked ?? false,
    sensitivity: Number($('#opt-sensitivity')?.value ?? DEFAULT_TRACING_SENSITIVITY),
  };
}
function updateAnalyzeButton() {
  const btn = $('#btn-analyze');
  if (!btn || state.busy) return;
  const newImage = !!state.pending && state.pending.sourceImageData !== state.sourceImageData;
  btn.disabled = !state.pending && !state.analysis;
  if (newImage || !state.analysis) { btn.textContent = state.pending ? 'Start analysis' : 'Re-analyze'; return; }
  const o = currentPipelineOptions(), s = state.optionsSnapshot;
  const enginesDiffer = !s || o.autotrace !== s.autotrace || o.indra !== s.indra || o.sam21 !== s.sam21 || o.potraceOutput !== s.potraceOutput;
  const sensitivityDiffers = o.sensitivity !== state.sensitivity;
  btn.textContent = enginesDiffer || sensitivityDiffers ? 'Apply settings & re-analyze' : 'Re-run analysis';
}
async function startAnalysis() {
  if (state.busy) return;
  const o = currentPipelineOptions(), s = state.optionsSnapshot;
  const enginesDiffer = !s || o.autotrace !== s.autotrace || o.indra !== s.indra || o.sam21 !== s.sam21 || o.potraceOutput !== s.potraceOutput;
  if (state.pending || !state.analysis || enginesDiffer) return run(state.pending ?? {});
  if (o.sensitivity !== state.sensitivity) {
    // Same engines, only tracing sensitivity changed: reuse OCR and SAM masks.
    state.busy = true;
    document.querySelectorAll("#btn-analyze, #opt-autotrace, #opt-indra, #opt-sam21, #opt-original-braille, #opt-sensitivity, #opt-page, #opt-style, #opt-textures, #opt-keys, #opt-title, #file").forEach((el) => { el.disabled = true; });
    const btn = $('#btn-analyze'); if (btn) btn.disabled = true;
    setStatus('Updating tracing sensitivity…');
    try {
      const cv = await loadOpenCV();
      state.sensitivity = o.sensitivity;
      updateTracing(cv, state.imageData, state.analysis, state.sensitivity);
      state.optionsSnapshot = o;
      await relayout();
      setStatus('Tracing updated. Sensitivity ' + state.sensitivity + '/100; OCR and segmentation were reused.');
    } catch (e) {
      console.error(e);
      setStatus('Could not update tracing: ' + (e.message || e), true);
    } finally {
      document.querySelectorAll("#btn-analyze, #opt-autotrace, #opt-indra, #opt-sam21, #opt-original-braille, #opt-sensitivity, #opt-page, #opt-style, #opt-textures, #opt-keys, #opt-title, #file").forEach((el) => { el.disabled = false; });
      if (btn) btn.disabled = false;
      state.busy = false;
      updateAnalyzeButton();
    }
  }
}

// ---------- loading overlay ----------
const STEPS = ['engines', 'ocr', 'leaders', 'segment', 'layout', 'check'];
let timer = null;
function showLoading(on) {
  $('#loading').hidden = !on;
  clearInterval(timer);
  if (on) {
    const t0 = performance.now();
    $('#elapsed').textContent = '0 s';
    timer = setInterval(() => { $('#elapsed').textContent = `${Math.round((performance.now() - t0) / 1000)} s`; }, 500);
    setStep('engines', 'Loading on-device models…');
  }
}
function setStep(k, msg) {
  const i = STEPS.indexOf(k);
  document.querySelectorAll('#steps li').forEach((el) => {
    const j = STEPS.indexOf(el.dataset.step);
    el.classList.toggle('done', j < i);
    el.classList.toggle('active', j === i);
  });
  if (msg) $('#loadmsg').textContent = msg;
}
function setStatus(msg, err = false) { const s = $('#status'); s.textContent = msg; s.classList.toggle('error', err); }
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------- pipeline ----------
async function run(input = {}) {
  if (state.busy) return;
  const previous = { imageData: state.imageData, sourceImageData: state.sourceImageData, original: state.original, analysis: state.analysis, traceSvg: state.traceSvg, layout: state.layout, check: state.check, name: state.name };
  state.busy = true;
  document.body.setAttribute('aria-busy', 'true');
  document.querySelectorAll('#btn-analyze, #opt-autotrace, #opt-indra, #opt-sam21, #opt-original-braille, #opt-sensitivity, #opt-page, #opt-style, #opt-textures, #opt-keys, #opt-title, #file').forEach((el) => { el.disabled = true; });
  $('#empty').hidden = true;
  showLoading(true);
  setStatus('Working… everything runs on this device.');
  const t0 = performance.now();
  try {
    const sourceImageData = input.sourceImageData ?? state.sourceImageData;
    if (!sourceImageData) throw new Error('No source image is available.');
    state.sensitivity = Number($('#opt-sensitivity')?.value ?? DEFAULT_TRACING_SENSITIVITY);
    state.optionsSnapshot = currentPipelineOptions();
    let preparedImageData = sourceImageData;
    if ($('#opt-autotrace')?.checked) {
      setStep('engines', 'Reconstructing image with Potrace…');
      preparedImageData = await prepareAutotrace(sourceImageData);
    }
    const analysis = await analyze(preparedImageData, { sensitivity: state.sensitivity,
      preferIndra: $('#opt-indra')?.checked ?? false,
      segmentationBackend: $('#opt-sam21')?.checked ? 'sam2' : 'slimsam',
      onStage: (k, msg) => setStep(k, k === 'engines' ? 'Loading on-device models… (first run only)' : msg),
    });
    state.sourceImageData = sourceImageData;
    state.imageData = preparedImageData;
    state.original = input.original ?? state.original;
    state.name = input.name ?? state.name;
    if (input.title !== undefined) $('#opt-title').value = input.title;
    state.analysis = analysis;
    state.traceSvg = null;
    await relayout(true);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const st = state.layout.stats;
    const indraNote = state.analysis.indraFallback ? ' · Indra OCR produced no usable text; PaddleOCR was used.' : '';
    const fallbackNote = state.analysis.segmentationFallbackReason
      ? ` SAM 2.1 could not use WebGPU (${state.analysis.segmentationFallbackReason}); switched to SlimSAM.`
      : '';
    if (fallbackNote) $('#opt-sam21').checked = false;
    const fixes = state.analysis.labels.reduce((n, L) => n + (L.corrections?.length || 0), 0);
    const outputNote = $('#opt-original-braille')?.checked ? ' · full analysis completed; direct Potrace SVG used for diagram artwork' : '';
    setStatus(`Done in ${secs} s on this device · ${state.analysis.labels.length} labels found · ${st.parts} parts segmented · ${st.fullLabels} full braille labels + ${st.keyLabels} keyed${fixes ? ` · ${fixes} OCR slip${fixes > 1 ? 's' : ''} auto-corrected` : ''}${state.analysis.labels.length ? '' : ' · no printed labels found, so this is outlines only'}` + indraNote + fallbackNote + outputNote);
  } catch (e) {
    console.error(e);
    Object.assign(state, previous);
    if (state.analysis) { try { draw(); } catch {} }
    if (!state.analysis && !$('#opt-original-braille')?.checked && byId[state.name] && await showPrecomputed(state.name)) {
      setStatus(`This browser could not run the on-device models (${e.message || e}). Showing a result computed earlier with the same pipeline.`, true);
    } else {
      $('#empty').hidden = !!state.layout;
      setStatus('Something went wrong: ' + (e.message || e) + '. Try another image or reload the page.', true);
    }
  } finally {
    showLoading(false);
    state.busy = false;
    state.pending = null;
    document.querySelectorAll('#btn-analyze, #opt-autotrace, #opt-indra, #opt-sam21, #opt-original-braille, #opt-sensitivity, #opt-page, #opt-style, #opt-textures, #opt-keys, #opt-title, #file').forEach((el) => { el.disabled = false; });
    document.body.removeAttribute('aria-busy');
    updateAnalyzeButton();
  }
}

async function showPrecomputed(id) {
  try {
    // Render the precomputed SVG as an image, never as inline markup: fetched
    // document text must not run as active HTML inside this page.
    const img = new Image();
    img.alt = 'Tactile graphic computed earlier with the same pipeline';
    img.src = assetURL(`precomputed/${encodeURIComponent(id)}.svg`);
    await img.decode();
    $('#views').hidden = false;
    $('#tactile').replaceChildren(img);
    return true;
  } catch { return false; }
}

async function relayout(withSteps = false) {
  const cv = await loadOpenCV();
  if (withSteps) { setStep('layout', 'Laying out the tactile page…'); await nextFrame(); }
  state.layout = buildLayout(cv, state.analysis, {
    page: $('#opt-page').value, style: $('#opt-style').value, title: $('#opt-title').value.trim(), sensitivity: state.sensitivity,
    textures: $('#opt-textures').checked, forceKeys: $('#opt-keys').checked,
  });
  if (withSteps) { setStep('check', 'Running guideline checks…'); await nextFrame(); }
  if ($('#opt-original-braille')?.checked) {
    setStep('engines', 'Tracing the analyzed diagram with Potrace…');
    const placedTexts = new Set(state.layout.labels.map((label) => label.text));
    state.traceSvg = await traceOriginalDiagram(state.sourceImageData, state.analysis.labels.filter((label) => !label.removed && placedTexts.has(label.text)));
  }
  state.check = checkAll(cv, state.analysis, state.layout, state.imageData);
  draw();
}

// ---------- views ----------
function draw() {
  $('#tabs').hidden = false; $('#views').hidden = false; $('#side').hidden = false; $('#howto').hidden = true;
  const originalBraille = !!$('#opt-original-braille')?.checked;
  $('#dl-pottrace-svg').hidden = !originalBraille;
  $('#dl-svg').textContent = originalBraille ? 'Download layered Potrace SVG' : 'Download editable tactile SVG';
  for (const tabName of ['compare', 'relief']) {
    const tab = $(`#tabs [data-tab="${tabName}"]`);
    if (tab) tab.hidden = originalBraille;
  }
  if (originalBraille && ['compare', 'relief'].includes(currentTab())) {
    document.querySelectorAll('#tabs button').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.tab === 'tactile')));
    document.querySelectorAll('.view').forEach((view) => { view.hidden = view.dataset.view !== 'tactile'; });
  }
  $('#viewmode').hidden = currentTab() !== 'tactile' || originalBraille;
  drawTactile();
  $('#ours-small').innerHTML = renderTactile(state.layout);
  $('#keypage').innerHTML = state.layout.keyEntries.length
    ? renderKeyPage(state.layout, { preview: true })
    : '<p>Every label fits as full braille, so no key page is needed.</p>';
  drawBaseline();
  drawAnalysis();
  drawLabels();
  drawLegend();
  drawRules();
  if (currentTab() === 'relief') showRelief();
}

function drawTactile(highlight = null) {
  const el = $('#tactile');
  if ($('#opt-original-braille')?.checked) {
    el.innerHTML = renderPotraceBraille(state.layout, state.analysis, state.traceSvg, { layered: true });
    el.querySelector('svg')?.setAttribute('aria-label', 'Original diagram with detected print labels replaced by braille');
    return;
  }
  if (state.mode === 'original') {
    el.innerHTML = `<img src="${state.original}" alt="Original diagram">`;
    return;
  }
  const underlay = state.mode === 'overlay' ? { href: state.original, w: state.analysis.W, h: state.analysis.H } : null;
  el.innerHTML = renderTactile(state.layout, { preview: true, highlight, underlay });
  el.querySelector('svg')?.setAttribute('aria-label', `Tactile graphic preview with ${state.layout.labels.length} braille labels`);
}

function drawBaseline() {
  // The same Canny tracing the checker measures, thickened to the same 0.8 mm raised line.
  const cv = window.cv, L = state.layout, img = state.imageData;
  const src = cv.matFromImageData(img), gray = new cv.Mat(), edges = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
  cv.Canny(gray, edges, 60, 160);
  const k = Math.max(1, Math.round(0.8 / L.s)) | 1;
  const ker = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k));
  cv.dilate(edges, edges, ker); ker.delete();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const id = new ImageData(img.width, img.height);
  for (let i = 0; i < img.width * img.height; i++) { const v = edges.data[i] ? 0 : 255; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  c.getContext('2d').putImageData(id, 0, 0);
  src.delete(); gray.delete(); edges.delete();
  $('#baseline').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.pageW} ${L.pageH}"><rect width="100%" height="100%" fill="#fff"/><image href="${c.toDataURL()}" x="${L.ox}" y="${L.oy}" width="${img.width * L.s}" height="${img.height * L.s}"/></svg>`;
}

// Mask outlines (computed once per label) for the "What the AI saw" view.
function maskContours(L, W, H) {
  if (L._contours || !L.mask) return L._contours || [];
  const cv = window.cv;
  const m = new cv.Mat(H, W, cv.CV_8UC1);
  for (let i = 0; i < W * H; i++) m.data[i] = L.mask[i] ? 255 : 0;
  const cs = new cv.MatVector(), hier = new cv.Mat();
  cv.findContours(m, cs, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  L._contours = [];
  for (let i = 0; i < cs.size(); i++) {
    const c = cs.get(i);
    if (cv.contourArea(c) > 40) { const pts = []; for (let j = 0; j < c.rows; j++) pts.push([c.data32S[j * 2], c.data32S[j * 2 + 1]]); L._contours.push(pts); }
    c.delete();
  }
  m.delete(); cs.delete(); hier.delete();
  return L._contours;
}

function drawAnalysis(highlight = -1) {
  const a = state.analysis, c = $('#analysis');
  c.width = a.W; c.height = a.H;
  const ctx = c.getContext('2d');
  ctx.putImageData(state.imageData, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(0, 0, a.W, a.H); // fade the original
  const lw = Math.max(2, a.W / 380);
  a.labels.forEach((L, i) => {
    if (L.removed) return;
    const col = PAL[i % PAL.length], on = highlight === -1 || highlight === i;
    ctx.globalAlpha = on ? 1 : 0.18;
    for (const poly of maskContours(L, a.W, a.H)) {
      ctx.beginPath(); poly.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.fillStyle = col + (highlight === i ? '55' : '22'); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = highlight === i ? lw * 2 : lw; ctx.stroke();
    }
    ctx.strokeStyle = col; ctx.lineWidth = lw;
    ctx.setLineDash([lw * 3, lw * 2]);
    ctx.strokeRect(L.x0 - 3, L.y0 - 3, L.x1 - L.x0 + 6, L.y1 - L.y0 + 6);
    ctx.setLineDash([]);
    if (L.leader) { ctx.lineWidth = lw * 1.4; ctx.beginPath(); ctx.moveTo(L.leader.x1, L.leader.y1); ctx.lineTo(L.leader.x2, L.leader.y2); ctx.stroke(); }
    if (L.anchor) badge(ctx, L.anchor[0], L.anchor[1], String(i + 1), col, lw);
    badge(ctx, L.x0 - 3, L.y0 - 3, String(i + 1), col, lw * 0.8);
    ctx.globalAlpha = 1;
  });
}
function badge(ctx, x, y, text, col, lw) {
  const r = lw * 5.5;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
  ctx.lineWidth = lw * 0.8; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `700 ${r * 1.1}px "Atkinson Hyperlegible", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + r * 0.05);
}

function drawLabels() {
  const ol = $('#labels'); ol.innerHTML = '';
  const placedByText = new Map(state.layout.labels.map((p, k) => [p.text, { p, k }]));
  state.analysis.labels.forEach((L, i) => {
    const li = document.createElement('li');
    if (L.removed) li.classList.add('removed');
    const hit = placedByText.get(L.text), p = hit?.p;
    const how = L.removed ? 'removed' : !p ? 'could not be placed' : p.usesKey ? `key “${p.key}”` : 'full braille';
    const fix = L.corrections?.length ? ` · <span class="fix">auto-corrected ${L.corrections.join(', ')}</span>` : '';
    li.innerHTML = `<span class="badge" style="background:${PAL[i % PAL.length]}">${i + 1}</span>
      <input type="text" aria-label="Label ${i + 1} text" value="${L.text.replace(/"/g, '&quot;')}">
      <span class="acts">${i > 0 && !L.removed ? `<button class="m" type="button" aria-label="Merge label ${i + 1} into the label above" title="Merge into the label above">⤒</button>` : ''}<button class="x" type="button" aria-label="${L.removed ? 'Restore' : 'Remove'} label ${i + 1}" title="${L.removed ? 'Restore' : 'Remove'}">${L.removed ? 'Undo' : '✕'}</button></span>
      <div class="br" aria-hidden="true">${toUnicode(L.text.toLowerCase())}</div>
      <div class="meta">${how} · ${L.leader ? 'leader traced' : 'label sits on the part'} · ${L.mask ? 'part segmented' : 'no part found'}${fix}</div>`;
    const input = li.querySelector('input');
    input.addEventListener('change', async () => { L.text = input.value.trim() || L.text; L.corrections = []; await relayout(); });
    li.querySelector('.x').addEventListener('click', async () => { L.removed = !L.removed; await relayout(); });
    li.querySelector('.m')?.addEventListener('click', async () => {
      // OCR sometimes splits a two-line label: join it to the one above.
      const labels = state.analysis.labels, prev = labels[i - 1];
      prev.text = `${prev.text} ${L.text}`.trim();
      prev.x0 = Math.min(prev.x0, L.x0); prev.y0 = Math.min(prev.y0, L.y0); prev.x1 = Math.max(prev.x1, L.x1); prev.y1 = Math.max(prev.y1, L.y1);
      prev.leader ??= L.leader; prev.mask ??= L.mask;
      labels.splice(i, 1);
      await relayout();
    });
    li.addEventListener('mouseenter', () => { li.classList.add('hl'); hover(i, hit?.k); });
    li.addEventListener('mouseleave', () => { li.classList.remove('hl'); hover(-1, null); });
    ol.appendChild(li);
  });
}
function hover(i, k) {
  if (currentTab() === 'analysis') drawAnalysis(i);
  else if (currentTab() === 'tactile' && state.mode !== 'original') drawTactile(k ?? null);
}

function drawLegend() {
  const ul = $('#legend'); ul.innerHTML = '';
  const parts = state.layout.parts.filter((p) => p.texture != null);
  const bold = state.layout.stats.boldEdges;
  $('#legend-card').hidden = !!$('#opt-original-braille')?.checked || (!parts.length && !bold);
  if (bold) {
    for (const [w, txt] of [[3, '<b>Bold line</b> · edge of a labeled part (found by Segment Anything from the leader tip)'], [1.4, '<b>Fine line</b> · other detail traced from the original']]) {
      const li = document.createElement('li');
      li.innerHTML = `<svg viewBox="0 0 12 12" aria-hidden="true"><line x1="1" y1="6" x2="11" y2="6" stroke="#000" stroke-width="${w}" stroke-linecap="round"/></svg><span>${txt}</span>`;
      ul.appendChild(li);
    }
  }
  for (const p of parts) {
    const names = state.analysis.labels.filter((L) => !L.removed && L.partId === p.id).map((L) => L.text);
    const li = document.createElement('li');
    li.innerHTML = `<svg viewBox="0 0 12 12" aria-hidden="true"><defs>${TEXTURES[p.texture].svg.replace(`id="tx${p.texture}"`, `id="lg${p.texture}"`)}</defs><rect width="12" height="12" fill="url(#lg${p.texture})"/></svg>
      <span><b>${TEXTURES[p.texture].name}</b> · ${names.join(', ') || p.labelText}</span>`;
    ul.appendChild(li);
  }
}

function drawRules() {
  const card = $('#guideline-card');
  if (card) card.hidden = false;
  const tb = $('#rules tbody'); tb.innerHTML = '';
  for (const r of state.check.rules) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.name}</td><td class="${r.pass === true ? 'ok' : r.pass === false ? 'warn' : ''}">${r.ours}</td><td class="base">${r.base}</td>`;
    tb.appendChild(tr);
  }
}

// ---------- tabs, view mode & options ----------
const currentTab = () => $('#tabs button[aria-selected="true"]')?.dataset.tab;
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[role=tab]'); if (!b) return;
  document.querySelectorAll('#tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== b.dataset.tab; });
  $('#viewmode').hidden = b.dataset.tab !== 'tactile' || $('#opt-original-braille')?.checked;
  if (b.dataset.tab === 'analysis') drawAnalysis();
  if (b.dataset.tab === 'relief') showRelief(); else relief?.stop();
});
$('#viewmode').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !state.layout) return;
  state.mode = b.dataset.mode;
  $('#viewmode').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  drawTactile();
});
for (const id of ['#opt-page', '#opt-style', '#opt-textures', '#opt-keys', '#opt-title']) $(id).addEventListener('change', () => state.analysis && !state.busy && relayout());

const autotraceInput = $('#opt-autotrace');
autotraceInput?.addEventListener('change', () => updateAnalyzeButton());

// Switching the OCR engine changes which labels are found: it needs the full
// pipeline, which the Start button chooses via startAnalysis().
const indraInput = $('#opt-indra');
indraInput?.addEventListener('change', () => updateAnalyzeButton());

const originalBrailleInput = $('#opt-original-braille');
originalBrailleInput?.addEventListener('change', () => {
  const ready = originalBrailleInput.checked && !!state.traceSvg && !!state.analysis;
  $('#dl-pottrace-svg').hidden = !ready;
  $('#dl-svg').textContent = ready ? 'Download layered Potrace SVG' : 'Download editable tactile SVG';
  updateAnalyzeButton();
});

const sensitivityInput = $('#opt-sensitivity');
const sensitivityValue = $('#opt-sensitivity-value');
sensitivityInput?.addEventListener('input', () => { sensitivityValue.value = sensitivityInput.value; sensitivityValue.textContent = sensitivityInput.value; });
sensitivityInput?.addEventListener('change', () => {
  sensitivityValue.value = sensitivityInput.value; sensitivityValue.textContent = sensitivityInput.value;
  updateAnalyzeButton(); // applied via the Start button; same-engine changes reuse OCR and SAM masks
});

$('#btn-analyze')?.addEventListener('click', () => startAnalysis());

// ---------- export ----------
function download(name, text, type = 'image/svg+xml') {
  // Browser path (run from a repo checkout).
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Desktop path: native Save dialog, then the real file is written to disk.
async function saveAs(name, content, type = 'image/svg+xml') {
  if (!desktop) return download(name, content, type);
  const path = await desktop.os.showSaveDialog('Save as', { defaultPath: name });
  if (!path) return; // user cancelled
  const buf = content instanceof Blob
    ? await content.arrayBuffer()
    : new TextEncoder().encode(content).buffer;
  try {
    await desktop.filesystem.writeFile(path, buf);
  } catch {
    await desktop.filesystem.writeBinaryFile(path, buf); // older Neutralino clients
  }
  setStatus('Saved to ' + path);
}

$('#relief-light').onclick = (e) => {
  if (!relief) return;
  relief.sweep = !relief.sweep;
  e.currentTarget.setAttribute('aria-pressed', String(relief.sweep));
  e.currentTarget.textContent = relief.sweep ? 'Pause light' : 'Move light';
};
$('#dl-stl').onclick = async () => {
  const btn = $('#dl-stl'); btn.disabled = true; btn.textContent = 'Building STL…';
  try {
    reliefMod ??= await import('./relief.js');
    const blob = await reliefMod.buildSTL(state.layout);
    await saveAs(`${state.name}-tactile.stl`, blob, 'model/stl');
  } finally { btn.disabled = false; btn.textContent = 'Download STL for 3D printing'; }
};
function primaryTactileSVG() {
  return $('#opt-original-braille')?.checked
    ? renderPotraceBraille(state.layout, state.analysis, state.traceSvg, { layered: true })
    : renderTactile(state.layout);
}
$('#dl-svg').onclick = () => saveAs(`${state.name}-${$('#opt-original-braille')?.checked ? 'potrace-layered' : 'tactile-editable'}.svg`, primaryTactileSVG());
$('#dl-pottrace-svg').onclick = () => saveAs(`${state.name}-potrace-braille.svg`, renderPotraceBraille(state.layout, state.analysis, state.traceSvg));
$('#dl-key').onclick = () => saveAs(`${state.name}-key.svg`, renderKeyPage(state.layout, { preview: true }));
function printHTML(L, pages) {
  // The document is written into a fresh browsing context (or a temp file), so
  // its markup must contain no user-controlled data, such as the diagram name.
  // The title is set safely via document.title after the document loads.
  return `<!doctype html><title>TouchSight tactile graphic</title><style>@page{size:${L.pageW}mm ${L.pageH}mm;margin:0}body{margin:0}svg{display:block;width:${L.pageW}mm;height:${L.pageH}mm;page-break-after:always}</style>${pages.join('')}<script>onload=()=>print()<\/script>`;
}
$('#print').onclick = async () => {
  const L = state.layout;
  const pages = [primaryTactileSVG()];
  if (L.keyEntries.length) pages.push(renderKeyPage(L, { preview: true }));
  const html = printHTML(L, pages);
  if (!desktop) {
    // Browser: a new tab is the only way to print the bare page-sized SVGs.
    const w = window.open('', '_blank');
    if (!w) return setStatus('Allow pop-ups to print.', true);
    w.document.write(html);
    w.document.close();
    w.document.title = state.name; // safe textContent-style assignment
    return;
  }
  // Desktop: the WebView blocks window.open (pop-up blocker), so write the print
  // page to a temporary file and open it in the system browser, where printing
  // and Save as PDF work normally.
  try {
    const tempDir = await desktop.os.getPath('temp');
    // '/' separators work on Windows too, so keep it simple.
    const dir = (tempDir.endsWith('/') ? tempDir : tempDir + '/') + 'TactiDiagram';
    try { await desktop.filesystem.mkdir(dir); } catch {}
    const path = dir + '/' + 'print-' + Date.now() + '.html';
    await desktop.filesystem.writeFile(path, html);
    await desktop.os.open(path);
    setStatus('The print view opened in your browser; choose Print there to print or save as PDF.');
  } catch (e) {
    console.error(e);
    setStatus('Could not open the print view: ' + (e.message || e), true);
  }
};

// Deep link: ?sample=heart runs a sample straight away (demos and the eval harness).
const params = new URLSearchParams(location.search);
if (params.get('sam') === 'sam2') $('#opt-sam21').checked = true;
const deep = params.get('sample');
if (deep && byId[deep]) {
  // Explicit sample deep links are used by demos and the evaluation harness.
  runSample(deep, true);
}
// Normal app startup stays idle. The user chooses a sample or uploads an image.
window.__touchsight = state; // read by scripts/eval.mjs
