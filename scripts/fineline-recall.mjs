// Fine-line recall metric: how much of hand-annotated fine exterior linework
// survives into TactiDiagram's analysis. Annotations are binary PNGs in
// src/samples/fine_lines/<id>.png (white = annotated fine line, any size, matched
// to the sample by image size). Samples without an annotation are listed as
// unannotated. Writes eval-out/fineline.md.
//
// Three numbers per sample:
//   - lineArt recall    : annotated pixels near the existing structure line art
//   - +detail recall    : annotated pixels near line art OR analysis.detailLines
//   - detail gain       : how much the detail polylines add on their own
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const base = process.env.BASE || 'http://localhost:5173';
const TOL = Number(process.env.TOL || 3); // px of positional tolerance
const samples = JSON.parse(await readFile('src/samples/samples.json', 'utf8'));
const annotated = samples.filter((s) => !s.fine_lines || s.fine_lines !== false);
await mkdir('eval-out', { recursive: true });
const browser = await chromium.launch();
const rows = [];
for (const s of samples) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  try {
    await page.goto(`${base}/?sample=${s.id}`);
    await page.waitForFunction(() => /Done in|went wrong|Could not/.test(document.querySelector('#status')?.textContent || ''), null, { timeout: 240000 });
    const r = await page.evaluate(async (id, tol) => {
      const st = window.__touchsight;
      if (!st?.analysis) return { skip: 'no analysis' };
      let ann;
      try {
        ann = await new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = () => rej(new Error('no annotation'));
          img.src = `/samples/fine_lines/${id}.png`;
        });
      } catch { return { skip: 'no annotation' }; }
      const c = document.createElement('canvas');
      c.width = ann.naturalWidth; c.height = ann.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(ann, 0, 0);
      const a = ctx.getImageData(0, 0, c.width, c.height).data;
      const W = c.width, H = c.height, N = W * H;
      const truth = new Uint8Array(N);
      for (let p = 0; p < N; p++) truth[p] = a[p * 4] > 127 ? 1 : 0;
      const nTruth = truth.reduce((s2, v) => s2 + v, 0);
      if (!nTruth) return { skip: 'empty annotation' };
      const dil = (mask) => {
        let cur = mask;
        for (let it = 0; it < tol; it++) {
          const next = new Uint8Array(N);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const p = y * W + x;
            next[p] = cur[p] ||
              (x > 0 && cur[p - 1]) || (x < W - 1 && cur[p + 1]) ||
              (y > 0 && cur[p - W]) || (y < H - 1 && cur[p + W]) ||
              (x > 0 && y > 0 && cur[p - W - 1]) || (x < W - 1 && y > 0 && cur[p - W + 1]) ||
              (x > 0 && y < H - 1 && cur[p + W - 1]) || (x < W - 1 && y < H - 1 && cur[p + W + 1]) ? 1 : 0;
          }
          cur = next;
        }
        return cur;
      };
      const A = st.analysis;
      const cov = (pred) => { const d = dil(pred); let n = 0; for (let p = 0; p < N; p++) n += truth[p] && d[p] ? 1 : 0; return n / nTruth; };
      const la = new Uint8Array(N); la.set(A.lineArt ?? []);
      const dl = new Uint8Array(N); dl.set(A.detailLines?.mask ?? []);
      const both = new Uint8Array(N); for (let p = 0; p < N; p++) both[p] = (la[p] || dl[p]) ? 1 : 0;
      return {
        nTruth,
        lineArt: +(cov(la) * 100).toFixed(1),
        withDetail: +(cov(both) * 100).toFixed(1),
        detailOnlyPolylines: A.detailLines?.polylines?.length ?? 0,
      };
    }, s.id, TOL);
    if (r.skip) { rows.push({ id: s.id, skip: r.skip }); console.log(s.id, 'skipped:', r.skip); }
    else { rows.push({ id: s.id, ...r }); console.log(s.id, `lineArt ${r.lineArt}% | +detail ${r.withDetail}%`); }
  } catch (e) {
    rows.push({ id: s.id, error: String(e.message || e) });
    console.log(s.id, 'ERROR', e.message);
  }
  await page.close();
}
await browser.close();
const md = [`Fine-line recall (tolerance ${TOL} px) against src/samples/fine_lines/<id>.png annotations:`, '',
  '| Sample | Annotated px | line-art recall | + detail recall | detail polylines |', '|---|---|---|---|---|'];
const cov = rows.filter((r) => r.lineArt !== undefined);
for (const r of rows) {
  md.push(r.error ? `| ${r.id} | error | | | |` : r.skip ? `| ${r.id} | skipped (${r.skip}) | | | |` : `| ${r.id} | ${r.nTruth} | ${r.lineArt}% | ${r.withDetail}% | ${r.detailOnlyPolylines} |`);
}
if (cov.length) {
  const avg = (f) => (cov.reduce((a, r) => a + f(r), 0) / cov.length).toFixed(1);
  md.push('', `Mean over ${cov.length} annotated samples: line-art ${avg((r) => +r.lineArt)}%, +detail ${avg((r) => +r.withDetail)}%. Increase in "+detail" over "line-art" is the value of the fine-line tracer; see docs/fine-lines.md.`);
}
await writeFile('eval-out/fineline.md', md.join('\n'));
console.log(md.join('\n'));
