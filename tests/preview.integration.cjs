const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'www/assets');
const SCRIPT = path.join(ROOT, 'scripts/preview.js');
const FILES = ['01_swirl', '02_angry', '03_blade', '04_stand', '05_belly', '06_sphinx', '07_angel', '08_wave'];
const KINDS = ['magenta', 'checker', 'dark'];
const TILE = 420, PAD = 12, WIDTH = 1740, HEIGHT = 876;

async function scratch(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nailong-preview-'));
  t.after(async () => {
    // Remove only this test's mkdtemp-created directory, never an arbitrary path.
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('nailong-preview-'));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function run(input, output, cwd) {
  return spawnSync(process.execPath, [SCRIPT, input, output], { cwd, encoding: 'utf8' });
}

test('CLI generates three eight-tier sheets from committed assets outside the repo cwd', async t => {
  const dir = await scratch(t), output = path.join(dir, 'sheets');
  const result = run(ASSETS, output, dir);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await fs.readdir(output)).sort(), KINDS.map(k => `preview_${k}.png`).sort());
  for (const kind of KINDS) {
    const { data, info } = await sharp(path.join(output, `preview_${kind}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, WIDTH);
    assert.equal(info.height, HEIGHT);
    for (let i = 0; i < FILES.length; i++) {
      const source = await sharp(path.join(ASSETS, FILES[i] + '.png'))
        .resize(TILE, TILE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha().raw().toBuffer();
      const left = PAD + (i % 4) * (TILE + PAD), top = PAD + Math.floor(i / 4) * (TILE + PAD);
      let opaqueSamples = 0;
      for (let y = 0; y < TILE; y += 17) for (let x = 0; x < TILE; x += 17) {
        const sourceOffset = (y * TILE + x) * 4;
        if (source[sourceOffset + 3] !== 255) continue;
        const outOffset = ((top + y) * WIDTH + left + x) * 4;
        for (let c = 0; c < 3; c++) {
          assert.ok(Math.abs(data[outOffset + c] - source[sourceOffset + c]) <= 1,
            `${kind}: cell ${i + 1} must contain ${FILES[i]} at ${x},${y}`);
        }
        opaqueSamples++;
      }
      assert.ok(opaqueSamples > 10, `verify visible artwork in cell ${i + 1}`);
    }
    const rgb = (x, y) => Array.from(data.subarray((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 3));
    if (kind === 'checker') {
      assert.deepEqual(rgb(0, 0), [232, 232, 232]);
      assert.deepEqual(rgb(14, 0), [150, 150, 150]);
      assert.deepEqual(rgb(0, 14), [150, 150, 150]);
      assert.deepEqual(rgb(28, 0), [232, 232, 232]);
    } else {
      assert.deepEqual(rgb(0, 0), kind === 'magenta' ? [255, 0, 255] : [34, 40, 54]);
    }
  }
});

test('missing input directory fails with the path before creating output', async t => {
  const dir = await scratch(t), input = path.join(dir, 'absent'), output = path.join(dir, 'out');
  const result = run(input, output, dir);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(input), result.stderr);
  await assert.rejects(fs.access(output), { code: 'ENOENT' });
});

test('missing eighth sprite fails with its filename and creates no partial sheets', async t => {
  const dir = await scratch(t), input = path.join(dir, 'assets'), output = path.join(dir, 'out');
  await fs.mkdir(input);
  for (const file of FILES.slice(0, -1)) await fs.copyFile(path.join(ASSETS, file + '.png'), path.join(input, file + '.png'));
  const result = run(input, output, dir);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(path.join(input, '08_wave.png')), result.stderr);
  await assert.rejects(fs.access(output), { code: 'ENOENT' });
});

test('corrupt sprite fails without producing a partial preview', async t => {
  const dir = await scratch(t), input = path.join(dir, 'assets'), output = path.join(dir, 'out');
  await fs.mkdir(input);
  for (const file of FILES) await fs.copyFile(path.join(ASSETS, file + '.png'), path.join(input, file + '.png'));
  await fs.writeFile(path.join(input, '08_wave.png'), 'not a PNG');
  const result = run(input, output, dir);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('08_wave.png'), result.stderr);
  await assert.rejects(fs.access(output), { code: 'ENOENT' });
});
