/**
 * 最终素材构建：只加透明通道，原始像素一律不改（不反混合、不改色、不修型）
 *
 *  01-05：AI 前景遮罩（segmentForeground）直接乘到原图上，人物本体连自带的
 *         明暗与投影一起保留，只去掉纯色底。
 *  06   ：原天使是发光半透明体，翅膀 / 光环与周围光束同色同亮度，AI 与色彩
 *         方法都分不开。这里用混合遮罩：
 *           实体（袍身、脚）  = AI 遮罩高置信区
 *           翅膀 / 光环 / 光晕 = 亮度项 × 人物包络（椭圆软边），
 *         从而去掉星空、云台、顶部小天使与飘羽，保留人物与其原有光感。
 *
 * 输出三套：orig/ 原构图透明版；png1024/ 归一化方形；png512/ 游戏内直接可用。
 */
const { segmentForeground } = require('@imgly/background-removal-node');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'assets_raw');
const OUT = path.join(ROOT, 'assets_out');

const JOBS = [
  { src: '01_poop.webp', id: '01_swirl', attachR: 12 },
  { src: '02_angry.jpg', id: '02_angry', attachR: 12 },
  { src: '07_blade.jpg', id: '03_blade', attachR: 12 },
  { src: '03_stand.jpg', id: '04_stand', attachR: 12 },
  { src: '04_belly.jpg', id: '05_belly', attachR: 12 },
  { src: '05_sphinx.jpg', id: '06_sphinx', attachR: 12 },
  { src: '06_angel_orig.jpg', id: '07_angel', hybrid: {
      cx: 480, cy: 900, rx: 424, ry: 436, lumLo: 88, lumHi: 170, bodyCut: 160, feather: 3, attachR: 60,
  } },
  { src: '08_wave.jpg', id: '08_wave', attachR: 12 },
];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

async function rgbOf(file) {
  const { data, info } = await sharp(file).removeAlpha().toFormat('raw').toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}

async function aiMask(file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const out = await segmentForeground(new Blob([buf], { type: mime }), { output: { format: 'image/png' } });
  const ab = Buffer.from(await out.arrayBuffer());
  // 注意：遮罩 PNG 的 matte 存在 alpha 通道里，亮度通道是无关的填充色
  const { data, info } = await sharp(ab).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const m = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) m[p] = data[p * 4 + 3];
  return { m, W, H };
}

// 椭圆软包络：1 = 完全在人物范围内，边缘平滑衰减到 0
function envelope(W, H, e) {
  const env = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - e.cx) / e.rx, dy = (y - e.cy) / e.ry;
    const d = Math.hypot(dx, dy);
    let v = clamp(1 - (d - 1) / 0.35, 0, 1);
    env[y * W + x] = v * v * (3 - 2 * v);
  }
  return env;
}

function blurF(src, W, H, r) {
  if (r <= 0) return src;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), win = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[y * W + clamp(k, 0, W - 1)];
    for (let x = 0; x < W; x++) { tmp[y * W + x] = s / win; s += src[y * W + clamp(x + r + 1, 0, W - 1)] - src[y * W + clamp(x - r, 0, W - 1)]; }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[clamp(k, 0, H - 1) * W + x];
    for (let y = 0; y < H; y++) { out[y * W + x] = s / win; s += tmp[clamp(y + r + 1, 0, H - 1) * W + x] - tmp[clamp(y - r, 0, H - 1) * W + x]; }
  }
  return out;
}

// 只保留紧贴本体的半透明像素：远处的高斯雾 / 地面投影淡出不留
// 可分离方形膨胀（滑动窗口计数），半径几十像素也不慢
function dilateMask(src, W, H, r) {
  if (r <= 0) return Uint8Array.from(src);
  const t = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[y * W + clamp(k, 0, W - 1)];
    for (let x = 0; x < W; x++) {
      t[y * W + x] = s > 0 ? 1 : 0;
      s += src[y * W + clamp(x + r + 1, 0, W - 1)] - src[y * W + clamp(x - r, 0, W - 1)];
    }
  }
  const o = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += t[clamp(k, 0, H - 1) * W + x];
    for (let y = 0; y < H; y++) {
      o[y * W + x] = s > 0 ? 1 : 0;
      s += t[clamp(y + r + 1, 0, H - 1) * W + x] - t[clamp(y - r, 0, H - 1) * W + x];
    }
  }
  return o;
}

function componentsOf(mask, W, H) {
  const N = W * H, lab = new Int32Array(N).fill(-1), out = [], q = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const px = [];
    let head = 0, tail = 0;
    q[tail++] = s; lab[s] = out.length;
    while (head < tail) {
      const p = q[head++], x = p % W, y = (p / W) | 0;
      px.push(p);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const sx = x + dx, sy = y + dy;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const np = sy * W + sx;
        if (lab[np] >= 0 || !mask[np]) continue;
        lab[np] = out.length; q[tail++] = np;
      }
    }
    out.push({ px, n: px.length });
  }
  return out;
}

async function build(job) {
  const file = path.join(RAW, job.src);
  const { data: rgb, W, H } = await rgbOf(file);
  const { m, W: mw, H: mh } = await aiMask(file);
  const alpha = new Float32Array(W * H);

  if (!job.hybrid) {
    for (let p = 0; p < W * H; p++) alpha[p] = m[p] / 255;
  } else {
    const e = job.hybrid;
    const env = envelope(W, H, e);
    // AI 遮罩若尺寸不一致则重采样
    let mm = m;
    if (mw !== W || mh !== H) {
      const b = await sharp(m, { raw: { width: mw, height: mh, channels: 1 } }).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer();
      mm = b.data;
    }
    for (let p = 0; p < W * H; p++) {
      const i = p * 3;
      const lum = 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2];
      const body = mm[p] >= e.bodyCut ? 1 : clamp(mm[p] / e.bodyCut, 0, 1) * 0.25;
      const glow = clamp((lum - e.lumLo) / (e.lumHi - e.lumLo), 0, 1);
      alpha[p] = Math.max(body, glow * env[p]);
    }
  }
  // 清理：半透明像素只有在紧贴本体时才保留，远处的雾和投影淡出直接归零
  const core = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) core[p] = alpha[p] >= 0.55 ? 1 : 0;
  // 先删孤立小碎块（地面投影碎片），但保留光环这类足够大的独立部件
  const cc = componentsOf(core, W, H);
  for (const c of cc) {
    if (c.n < (job.minFrac || 0.0008) * W * H) for (const p of c.px) { alpha[p] = 0; core[p] = 0; }
  }
  const near = dilateMask(core, W, H, job.hybrid ? job.hybrid.attachR : job.attachR);
  for (let p = 0; p < W * H; p++) {
    if (!near[p] || alpha[p] < 0.05) alpha[p] = 0;
    else if (alpha[p] > 0.985) alpha[p] = 1;
  }
  const aF = blurF(alpha, W, H, job.hybrid ? job.hybrid.feather : 1);

  const rgba = Buffer.alloc(W * H * 4);
  let x0 = W, y0 = H, x1 = 0, y1 = 0, cover = 0;
  for (let p = 0; p < W * H; p++) {
    const a = clamp(aF[p], 0, 1), o = p * 4, i = p * 3;
    // 原始 RGB 原样写入，一个通道都不动
    rgba[o] = rgb[i]; rgba[o + 1] = rgb[i + 1]; rgba[o + 2] = rgb[i + 2];
    rgba[o + 3] = Math.round(a * 255);
    if (a > 0.02) {
      cover++;
      const x = p % W, y = (p / W) | 0;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
  }
  const base = sharp(rgba, { raw: { width: W, height: H, channels: 4 } });
  const pngOrig = await base.clone().png().toBuffer();
  await fs.promises.writeFile(path.join(OUT, 'orig', job.id + '.png'), pngOrig);

  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const trimmed = await base.clone().extract({ left: x0, top: y0, width: bw, height: bh }).png().toBuffer();
  await fs.promises.writeFile(path.join(OUT, 'tight', job.id + '.png'), trimmed);

  for (const CANVAS of [1024, 512]) {
    const FILL = 0.9;
    const sc = (CANVAS * FILL) / Math.max(bw, bh);
    const sw = Math.max(1, Math.round(bw * sc)), sh = Math.max(1, Math.round(bh * sc));
    const rz = await sharp(trimmed).resize(sw, sh, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
    await sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: rz, left: Math.round((CANVAS - sw) / 2), top: Math.round((CANVAS - sh) / 2) }])
      .png().toFile(path.join(OUT, 'square_' + CANVAS, job.id + '.png'));
  }
  console.log(job.id.padEnd(12), 'src', `${W}x${H}`, 'bbox', `${bw}x${bh}`,
    'cov', (100 * cover / (W * H)).toFixed(1) + '%');
}

(async () => {
  for (const d of ['orig', 'tight', 'square_1024', 'square_512']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
  for (const j of JOBS) await build(j);
})().catch((e) => { console.error(e); process.exit(1); });
