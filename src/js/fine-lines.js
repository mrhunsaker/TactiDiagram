// Fine exterior linework: strokes finer than the leader/arrow strokes (vessel
// outlines, hairline boundaries, faint external contours). The leader detector's
// thin-stroke mask finds them but is consumed by Hough + label assignment and then
// discarded; this module keeps them deliberately:
//
//   1. two-scale tophat/blackhat on the grayscale image: a 3x3 kernel responds only
//      to strokes narrower than ~3 px, separating fine detail from leader-width strokes;
//   2. a distance transform classifies skeleton-relevant pixels by stroke width, so
//      thick strokes (already covered by structureLines' region boundaries) drop out;
//   3. Zhang-Suen thinning gives a 1-px skeleton, walked into polylines through
//      endpoints and junctions (curves survive as whole chains, unlike Hough);
//   4. text boxes and assigned leader lines are knocked out so detail lines do not
//      duplicate them.
//
// Output: a full-resolution mask and polylines, exposed as analysis.detailLines for
// downstream tactile-weight rendering (not yet wired into the tactile page) and for
// the fine-line recall metric in scripts/fineline-recall.mjs.
import { tracingConfig, DEFAULT_TRACING_SENSITIVITY } from './tracing-config.js';

export function extractFineLines(cv, gray, opt = {}) {
  const t0 = performance.now();
  const W = gray.cols, H = gray.rows, N = W * H;
  const t = tracingConfig(opt.sensitivity ?? DEFAULT_TRACING_SENSITIVITY);
  const ft = opt.threshold ?? Math.max(22, Math.round(44 - 20 * (t.sensitivity / 100)));
  const minLen = (opt.minLen ?? 0.04) * Math.hypot(W, H);

  // (1) fine-scale tophat/blackhat: what a 3x3 kernel sees but a 9x9 kernel barely does.
  const kf = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const kw = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
  const bhF = new cv.Mat(), thF = new cv.Mat(), bhW = new cv.Mat(), thW = new cv.Mat();
  cv.morphologyEx(gray, bhF, cv.MORPH_BLACKHAT, kf);
  cv.morphologyEx(gray, thF, cv.MORPH_TOPHAT, kf);
  cv.morphologyEx(gray, bhW, cv.MORPH_BLACKHAT, kw);
  cv.morphologyEx(gray, thW, cv.MORPH_TOPHAT, kw);
  const fine = new cv.Mat(), wide = new cv.Mat();
  cv.max(bhF, thF, fine); cv.max(bhW, thW, wide);
  cv.threshold(fine, fine, ft, 255, cv.THRESH_BINARY);
  cv.threshold(wide, wide, ft + 8, 255, cv.THRESH_BINARY);
  for (const m of [kf, kw, bhF, thF, bhW, thW]) m.delete();

  // (2) stroke width via distance transform: keep only thin strokes.
  const dist = new cv.Mat(), u8 = new cv.Mat();
  cv.bitwise_or(fine, wide, u8);
  cv.distanceTransform(u8, dist, cv.DIST_L2, 3);
  const mask = new Uint8Array(N);
  for (let p = 0; p < N; p++) mask[p] = fine.data[p] > 0 && dist.data32F[p] <= 1.35 ? 1 : 0;
  for (const m of [fine, wide, dist, u8]) m.delete();

  // (4) remove text and leader lines, then tiny specks.
  for (const b of opt.textBoxes ?? []) {
    for (let y = Math.max(0, b.y0 - 4); y < Math.min(H, b.y1 + 4); y++)
      for (let x = Math.max(0, b.x0 - 4); x < Math.min(W, b.x1 + 4); x++) mask[y * W + x] = 0;
  }
  for (const L of opt.leaders ?? []) if (L.leader) knockLine(mask, W, H, L.leader, 4);

  let sk = skeletonize(mask, W, H);
  const polylines = tracePolylines(sk, W, H, minLen);
  // Refill the mask from surviving polylines so mask and polylines agree.
  const kept = new Uint8Array(N);
  for (const pl of polylines) for (const [x, y] of pl.pts) kept[y * W + x] = 1;
  return { mask: kept, polylines, ms: Math.round(performance.now() - t0) };
}

function knockLine(mask, W, H, L, r = 4) {
  const n = Math.ceil(Math.hypot(L.x2 - L.x1, L.y2 - L.y1));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(L.x1 + ((L.x2 - L.x1) * i) / n), y = Math.round(L.y1 + ((L.y2 - L.y1) * i) / n);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const qx = x + dx, qy = y + dy;
      if (qx >= 0 && qy >= 0 && qx < W && qy < H) mask[qy * W + qx] = 0;
    }
  }
}

// Zhang-Suen thinning to a 1-px skeleton. Plain JS on a Uint8Array; OpenCV.js builds
// used here have no ximgproc thinning, and this is fast enough at analysis resolution.
export function skeletonize(bin, W, H) {
  const I = Uint8Array.from(bin);
  const id = (x, y) => y * W + x;
  const N8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? I[id(x, y)] : 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      const del = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!I[id(x, y)]) continue;
        const n = N8.map(([dx, dy]) => at(x + dx, y + dy));
        const B = n.reduce((a, b) => a + b, 0);
        if (B < 2 || B > 6) continue;
        let A = 0;
        for (let i = 0; i < 8; i++) if (n[i] === 0 && n[(i + 1) % 8] === 1) A++;
        if (A !== 1) continue;
        if (step === 0) { if (n[0] && n[2] && n[4]) continue; if (n[2] && n[4] && n[6]) continue; }
        else { if (n[0] && n[2] && n[6]) continue; if (n[0] && n[4] && n[6]) continue; }
        del.push(id(x, y));
      }
      if (del.length) { changed = true; for (const p of del) I[p] = 0; }
    }
  }
  return I;
}

// Walk the skeleton graph from endpoints and around closed loops into polylines.
// Junctions are natural cut points: a chain stops where two strokes merge.
export function tracePolylines(sk, W, H, minLen = 30) {
  const id = (x, y) => y * W + x;
  const N8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? sk[id(x, y)] : 0);
  const deg = (x, y) => N8.reduce((a, [dx, dy]) => a + at(x + dx, y + dy), 0);
  const used = new Uint8Array(W * H);
  const out = [];
  const plen = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };
  const walk = (sx, sy) => {
    const pts = [[sx, sy]];
    let x = sx, y = sy;
    while (true) {
      const nbs = N8.map(([dx, dy]) => [x + dx, y + dy]).filter(([qx, qy]) => at(qx, qy) && !used[id(qx, qy)]);
      if (nbs.length !== 1) break;
      const [nx, ny] = nbs[0];
      used[id(nx, ny)] = 1; pts.push([nx, ny]); x = nx; y = ny;
    }
    return pts;
  };
  // Chains with free ends (most exterior contours).
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = id(x, y);
    if (!sk[p] || used[p] || deg(x, y) !== 1) continue;
    used[p] = 1;
    const pts = walk(x, y);
    const len = plen(pts);
    if (len >= minLen) out.push({ pts, len: Math.round(len) });
  }
  // Closed loops (o-shaped outlines) with no endpoints.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = id(x, y);
    if (!sk[p] || used[p]) continue;
    used[p] = 1;
    const a = walk(x, y); // walks one way around
    const b = walk(x, y); // walks the other way from the start
    const pts = [...b.slice(1).reverse(), ...a];
    used[id(x, y)] = 1;
    const len = plen(pts);
    if (len >= minLen) out.push({ pts, len: Math.round(len), loop: true });
  }
  return out;
}
