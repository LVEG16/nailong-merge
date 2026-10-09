/**
 * 从 assets_out/tight/*.png 的 alpha 通道算每张立绘的凸包，
 * 归一化到「主体包围盒」坐标（x/y ∈ [-0.5, 0.5]），输出 www/hulls.js。
 * 游戏里再按 drawnBox 缩放到逻辑坐标，作为贴合贴图的碰撞体。
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IDS = ['01_swirl', '02_angry', '03_blade', '04_stand', '05_belly', '06_sphinx', '07_angel', '08_wave'];
const MAX_PTS = 26;

function convexHull(pts) {
  pts.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function simplify(poly, eps) {
  if (poly.length <= 3) return poly;
  const d2 = (a, b, p) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1e-9;
    return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L;
  };
  const rec = (s, e) => {
    let mi = -1, md = 0;
    for (let i = s + 1; i < e; i++) { const d = d2(poly[s], poly[e], poly[i]); if (d > md) { md = d; mi = i; } }
    if (md > eps) return [...rec(s, mi), ...rec(mi, e).slice(1)];
    return [poly[s], poly[e]];
  };
  const out = rec(0, poly.length - 1);
  out.pop();
  return out;
}

(async () => {
  const result = {};
  for (const id of IDS) {
    const file = path.join(ROOT, 'assets_out', 'tight', id + '.png');
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    const pts = [];
    const stride = Math.max(1, Math.round(Math.max(W, H) / 320));
    for (let y = 0; y < H; y += stride) for (let x = 0; x < W; x += stride) {
      if (data[(y * W + x) * 4 + 3] > 128) pts.push([x, y]);
    }
    let hull = convexHull(pts);
    // 逐步放宽容差，把点数压到 MAX_PTS 以内
    let eps = 0.004 * Math.max(W, H);
    for (let i = 0; i < 12 && hull.length > MAX_PTS; i++) { hull = simplify(hull, eps); eps *= 1.35; }
    if (hull.length > MAX_PTS) hull = hull.filter((_, i) => i % Math.ceil(hull.length / MAX_PTS) === 0);
    // 归一化到包围盒中心坐标 [-0.5, 0.5]
    const norm = hull.map(([x, y]) => [+(x / W - 0.5).toFixed(4), +(y / H - 0.5).toFixed(4)]);
    // 顺时针（matter 的 y 向下坐标系）
    let area = 0;
    for (let i = 0; i < norm.length; i++) {
      const a = norm[i], b = norm[(i + 1) % norm.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (area < 0) norm.reverse();
    const xs = norm.map((p) => p[0]), ys = norm.map((p) => p[1]);
    result[id] = {
      pts: norm,
      ext: {
        l: +Math.min(...xs).toFixed(4), r: +Math.max(...xs).toFixed(4),
        t: +Math.min(...ys).toFixed(4), b: +Math.max(...ys).toFixed(4),
      },
    };
    console.log(id.padEnd(11), 'hull pts', String(norm.length).padStart(2), 'src', W + 'x' + H,
      'ext', JSON.stringify(result[id].ext));
  }
  const body = 'window.HULLS = ' + JSON.stringify(result) + ';\n';
  fs.writeFileSync(path.join(ROOT, 'www', 'hulls.js'), body);
  console.log('www/hulls.js', (body.length / 1024).toFixed(1) + 'KB');
})().catch((e) => { console.error(e); process.exit(1); });
