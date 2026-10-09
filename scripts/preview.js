// 验收拼图：把成品分别叠在品红 / 深色 / 棋盘格上，检查彩边、漏抠、半透明雾
const sharp = require('sharp');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DIR = process.argv[2] || 'assets_out/square_1024';
const files = ['01_swirl', '02_angry', '03_stand', '04_belly', '05_sphinx', '06_angel'];
const TILE = 420, PAD = 12, COLS = 3, ROWS = 2;
const W = COLS * (TILE + PAD) + PAD, H = ROWS * (TILE + PAD) + PAD;

async function base(kind) {
  if (kind === 'checker') {
    const n = 28, px = Buffer.alloc(n * n * 3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = ((x < n / 2) === (y < n / 2)) ? 232 : 150;
      const i = (y * n + x) * 3; px[i] = px[i + 1] = px[i + 2] = v;
    }
    const t = await sharp(px, { raw: { width: n, height: n, channels: 3 } }).png().toBuffer();
    return sharp({ create: { width: W, height: H, channels: 3, background: { r: 190, g: 190, b: 190 } } }).tile(t).png().toBuffer();
  }
  const c = kind === 'magenta' ? { r: 255, g: 0, b: 255 } : { r: 34, g: 40, b: 54 };
  return sharp({ create: { width: W, height: H, channels: 3, background: c } }).png().toBuffer();
}

(async () => {
  const sprites = [];
  for (const f of files) sprites.push(await sharp(path.join(ROOT, DIR, f + '.png')).resize(TILE, TILE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
  for (const kind of ['magenta', 'checker', 'dark']) {
    const comps = sprites.map((input, i) => ({ input, left: PAD + (i % COLS) * (TILE + PAD), top: PAD + ((i / COLS) | 0) * (TILE + PAD) }));
    const b = await base(kind);
    await sharp(b).composite(comps).png().toFile(path.join(ROOT, `preview_${kind}.png`));
    console.log('preview_' + kind + '.png  <=', DIR);
  }
})().catch((e) => { console.error(e); process.exit(1); });
