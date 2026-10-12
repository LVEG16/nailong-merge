/**
 * 条带凸包复合碰撞体生成器。
 *
 * 背景：Matter 对 quickDecomp 产出的十几~几十片凹多边形复合体位置求解很弱，
 * 堆叠时互相压进对方（实测穿透 80px+）。凸体则求解稳健。
 * 折中方案：把 silhouette 竖切成 K 条，每条取不透明像素的凸包，
 * 得到 2~4 个"粗壮"凸部件组成的复合体——刀/盾/举臂这类横向凹口各自成条被保留，
 * 同时每个部件都是凸的，Matter 能正常推开。
 *
 * 输出 www/colliders.js：window.COLLIDERS = { id: { parts: [[[x,y],..],..], ext:{l,r,t,b} } }
 * 坐标归一化到主体包围盒中心（x/y ∈ [-0.5, 0.5]）。
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IDS = ['01_swirl', '02_angry', '03_blade', '04_stand', '05_belly', '06_sphinx', '07_angel', '08_wave'];
const STRIPS = 3;
const MAX_PTS = 18;

function convexHull(pts) {
  pts = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}
function hullArea(h) {
  let a = 0;
  for (let i = 0; i < h.length; i++) { const p = h[i], q = h[(i + 1) % h.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a / 2);
}
function simplify(poly, eps) {
  const n = poly.length;
  if (n <= 3) return poly;
  const d = (a, b, p) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1e-9;
    return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L;
  };
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const st = [[0, n - 1]];
  while (st.length) {
    const [s, e] = st.pop();
    let mi = -1, md = 0;
    for (let i = s + 1; i < e; i++) { const v = d(poly[s], poly[e], poly[i]); if (v > md) { md = v; mi = i; } }
    if (md > eps) { keep[mi] = 1; st.push([s, mi], [mi, e]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(poly[i]);
  return out;
}

(async () => {
  const result = {};
  for (const id of IDS) {
    const { data, info } = await sharp(path.join(ROOT, 'assets_out', 'tight', id + '.png'))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    const g = Math.max(1, Math.round(Math.max(W, H) / 200));
    const GW = Math.ceil(W / g), GH = Math.ceil(H / g);
    const mask = new Uint8Array(GW * GH);
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const sx = Math.min(W - 1, x * g), sy = Math.min(H - 1, y * g);
      if (data[(sy * W + sx) * 4 + 3] > 128) {
        mask[y * GW + x] = 1;
        if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y;
      }
    }
    const bw = (mxx - mnx) || 1, bh = (mxy - mny) || 1;
    // 竖切条带，每条取凸包
    const raw = [];
    for (let s = 0; s < STRIPS; s++) {
      const x0 = mnx + Math.floor(bw * s / STRIPS), x1 = mnx + Math.floor(bw * (s + 1) / STRIPS);
      const pts = [];
      for (let y = mny; y <= mxy; y++) for (let x = Math.max(x0, mnx); x <= Math.min(x1 - 1, mxx); x++) {
        if (mask[y * GW + x]) pts.push([x, y]);
      }
      if (pts.length < 8) continue;
      raw.push(convexHull(pts));
    }
    // 丢掉面积过小的碎片条（避免细条部件拖累求解）
    const total = raw.reduce((s, h) => s + hullArea(h), 0);
    let parts = raw.filter((h) => hullArea(h) / total > 0.06);
    if (!parts.length) parts = [convexHull(raw.flat())];
    // 简化 + 归一化
    const norm = parts.map((h) => simplify(h, 0.9).slice(0, MAX_PTS).map(([x, y]) =>
      [+((x - mnx) / bw - 0.5).toFixed(4), +((y - mny) / bh - 0.5).toFixed(4)]));
    let l = 9, r = -9, t = 9, b = -9;
    for (const p of norm) for (const [x, y] of p) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
    result[id] = { parts: norm, ext: { l: +l.toFixed(4), r: +r.toFixed(4), t: +t.toFixed(4), b: +b.toFixed(4) } };
    console.log(id.padEnd(11), 'parts', parts.length, 'pts', norm.map((p) => p.length).join('/'));
  }
  const body = 'window.COLLIDERS = ' + JSON.stringify(result) + ';\n';
  fs.writeFileSync(path.join(ROOT, 'www', 'colliders.js'), body);
  console.log('www/colliders.js', (body.length / 1024).toFixed(1) + 'KB');
})().catch((e) => { console.error(e); process.exit(1); });
