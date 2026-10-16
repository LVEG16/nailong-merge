// 验收拼图：把成品分别叠在品红 / 深色 / 棋盘格上，检查彩边、漏抠、半透明雾
const sharp = require('sharp');
const fs = require('fs/promises');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DIR = path.resolve(ROOT, process.argv[2] || 'www/assets');
const OUT = path.resolve(ROOT, process.argv[3] || '.');
const files = ['01_swirl', '02_angry', '03_blade', '04_stand', '05_belly', '06_sphinx', '07_angel', '08_wave'];
const TILE = 420, PAD = 12, COLS = 4, ROWS = Math.ceil(files.length / COLS);
const W = COLS * (TILE + PAD) + PAD, H = ROWS * (TILE + PAD) + PAD;

async function base(kind) {
  if (kind === 'checker') {
    const n = 28, px = Buffer.alloc(n * n * 3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = ((x < n / 2) === (y < n / 2)) ? 232 : 150;
      const i = (y * n + x) * 3; px[i] = px[i + 1] = px[i + 2] = v;
    }
    const t = await sharp(px, { raw: { width: n, height: n, channels: 3 } }).png().toBuffer();
    return sharp({ create: { width: W, height: H, channels: 3, background: { r: 190, g: 190, b: 190 } } })
      .composite([{ input: t, tile: true, gravity: 'northwest' }]).png().toBuffer();
  }
  const c = kind === 'magenta' ? { r: 255, g: 0, b: 255 } : { r: 34, g: 40, b: 54 };
  return sharp({ create: { width: W, height: H, channels: 3, background: c } }).png().toBuffer();
}

(async () => {
  const input = await fs.stat(DIR).catch(() => null);
  if (!input || !input.isDirectory()) throw new Error('输入目录不存在或不是目录: ' + DIR);
  // 先核对全部输入，避免漏一阶却留下看似完整的部分验收图。
  for (const f of files) {
    const file = path.join(DIR, f + '.png');
    const stat = await fs.stat(file).catch(() => null);
    if (!stat || !stat.isFile()) throw new Error('缺少素材: ' + file);
  }
  const sprites = [];
  for (const f of files) {
    const file = path.join(DIR, f + '.png');
    try {
      sprites.push(await sharp(file).resize(TILE, TILE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
    } catch (e) { throw new Error('无法读取素材: ' + file + '\n' + e.message); }
  }
  await fs.mkdir(OUT, { recursive: true });
  for (const kind of ['magenta', 'checker', 'dark']) {
    const comps = sprites.map((input, i) => ({ input, left: PAD + (i % COLS) * (TILE + PAD), top: PAD + ((i / COLS) | 0) * (TILE + PAD) }));
    const b = await base(kind);
    const output = path.join(OUT, `preview_${kind}.png`);
    await sharp(b).composite(comps).png().toFile(output);
    console.log(output + '  <= ' + DIR);
  }
})().catch((e) => { console.error(e); process.exit(1); });
