/**
 * 从 assets_out/tight/*.png 的 alpha 通道提取每张贴图的**真实外轮廓**（凹多边形），
 * 归一化到主体包围盒坐标（x/y ∈ [-0.5, 0.5]），输出 www/outlines.js。
 * 游戏里交给 Matter 的 Bodies.fromVertices + poly-decomp 做凹多边形分解，
 * 碰撞体即贴图轮廓本身（凸包会填掉凹口，这版不会）。
 *
 * 流程：降采样二值化 -> 最大连通域 -> Moore 邻域边界追踪 -> Douglas-Peucker 简化
 *       -> 自交检测（自交则放宽容差重试，仍失败退该连通域的凸包）
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IDS = ['01_swirl', '02_angry', '03_blade', '04_stand', '05_belly', '06_sphinx', '07_angel', '08_wave'];
const MAX_PTS = 110;
const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];  // 屏幕坐标顺时针
const DIR_IDX = new Map(N8.map((v, i) => [v[0] + ',' + v[1], i]));

function mooreTrace(mask, GW, GH) {
  let sx = -1, sy = -1;
  outer: for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (mask[y * GW + x]) { sx = x; sy = y; break outer; }
  if (sx < 0) return [];
  const at = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && mask[y * GW + x] === 1;
  let bx = sx, by = sy, cx = sx - 1, cy = sy;      // c = 进入 b 之前那块背景
  const poly = [[bx, by]];
  const guardMax = GW * GH * 4;
  for (let guard = 0; guard < guardMax; guard++) {
    const i0 = DIR_IDX.get((cx - bx) + ',' + (cy - by));
    if (i0 === undefined) break;
    let nb = null, nc = null;
    for (let k = 0; k < 8; k++) {
      const idx = (i0 + k) % 8;
      const px = bx + N8[idx][0], py = by + N8[idx][1];
      if (at(px, py)) {
        const back = (idx + 7) % 8;                 // 新 c = 命中前最后检查的那格
        nb = [px, py]; nc = [bx + N8[back][0], by + N8[back][1]];
        break;
      }
    }
    if (!nb) break;
    bx = nb[0]; by = nb[1]; cx = nc[0]; cy = nc[1];
    poly.push([bx, by]);
    if (bx === sx && by === sy && cx === sx - 1 && cy === sy) break;   // Jacob 停止准则
  }
  return poly;
}

function largestComponent(mask, GW, GH) {
  const seen = new Uint8Array(GW * GH);
  let best = null;
  const q = new Int32Array(GW * GH);
  for (let s = 0; s < GW * GH; s++) {
    if (!mask[s] || seen[s]) continue;
    let head = 0, tail = 0;
    const px = [];
    q[tail++] = s; seen[s] = 1;
    while (head < tail) {
      const p = q[head++], x = p % GW, y = (p / GW) | 0;
      px.push(p);
      const nb = [p - 1, p + 1, p - GW, p + GW];
      for (let k = 0; k < 4; k++) {
        const np = nb[k];
        if (np < 0 || np >= GW * GH || seen[np] || !mask[np]) continue;
        if (k === 0 && x === 0) continue;
        if (k === 1 && x === GW - 1) continue;
        seen[np] = 1; q[tail++] = np;
      }
    }
    if (!best || px.length > best.length) best = px;
  }
  const out = new Uint8Array(GW * GH);
  for (const p of best) out[p] = 1;
  return out;
}

function simplify(poly, eps) {
  const n = poly.length;
  if (n <= 3) return poly;
  const d = (a, b, p) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1e-9;
    return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L;
  };
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let mi = -1, md = 0;
    for (let i = s + 1; i < e; i++) { const v = d(poly[s], poly[e], poly[i]); if (v > md) { md = v; mi = i; } }
    if (md > eps) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(poly[i]);
  return out;
}

const ori = (p, q, r) => {
  const v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0;
};
const seg = (a, b, c, dd) => ori(a, b, c) * ori(a, b, dd) < 0 && ori(c, dd, a) * ori(c, dd, b) < 0;
function selfIntersects(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (seg(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
  }
  return false;
}

function convexHull(pts) {
  pts = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}

(async () => {
  const result = {};
  for (const id of IDS) {
    const { data, info } = await sharp(path.join(ROOT, 'assets_out', 'tight', id + '.png'))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    const g = Math.max(1, Math.round(Math.max(W, H) / 180));
    const GW = Math.ceil(W / g), GH = Math.ceil(H / g);
    const raw = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const sx = Math.min(W - 1, x * g), sy = Math.min(H - 1, y * g);
      raw[y * GW + x] = data[(sy * W + sx) * 4 + 3] > 128 ? 1 : 0;
    }
    const comp = largestComponent(raw, GW, GH);
    let trace = mooreTrace(comp, GW, GH);
    trace = trace.filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
    if (trace.length > 2 && trace[0][0] === trace[trace.length - 1][0] && trace[0][1] === trace[trace.length - 1][1]) trace.pop();
    let poly = trace, eps = 0.8, used = 'outline';
    const EPS_MAX = 5.0;
    for (;;) {
      poly = simplify(trace, eps).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
      if (poly.length >= 3 && poly.length <= MAX_PTS && !selfIntersects(poly)) break;
      if (poly.length <= MAX_PTS && eps >= EPS_MAX) break;      // 点数已达标但仍有微自交：交给 decomp 前再试一次
      if (eps >= EPS_MAX) { poly = convexHull(trace); used = 'hull-fallback'; break; }
      eps *= 1.25;
    }
    if (poly.length < 3) { poly = convexHull(trace); used = 'hull-fallback'; }
    // 连通域包围盒 -> 归一化中心坐标
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    for (let p = 0; p < GW * GH; p++) if (comp[p]) {
      const x = p % GW, y = (p / GW) | 0;
      if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y;
    }
    const bw = (mxx - mnx) || 1, bh = (mxy - mny) || 1;
    const norm = poly.map(([x, y]) => [+((x - mnx) / bw - 0.5).toFixed(4), +((y - mny) / bh - 0.5).toFixed(4)]);
    const xs = norm.map((p) => p[0]), ys = norm.map((p) => p[1]);
    result[id] = {
      pts: norm,
      ext: { l: +Math.min(...xs).toFixed(4), r: +Math.max(...xs).toFixed(4), t: +Math.min(...ys).toFixed(4), b: +Math.max(...ys).toFixed(4) },
    };
    console.log(id.padEnd(11), used.padEnd(14), 'pts', String(norm.length).padStart(2), 'grid', GW + 'x' + GH);
  }
  const body = 'window.OUTLINES = ' + JSON.stringify(result) + ';\n';
  fs.writeFileSync(path.join(ROOT, 'www', 'outlines.js'), body);
  console.log('www/outlines.js', (body.length / 1024).toFixed(1) + 'KB');
})().catch((e) => { console.error(e); process.exit(1); });
