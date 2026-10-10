/* 奶龙合成所 —— matter-js 物理 + canvas 2D 渲染
 * 玩法：拖动瞄准 → 松手投放 → 两个同阶奶龙相碰进化一级 → 堆过虚线判负
 * 逻辑坐标系固定 420x620，物理参数与分辨率无关，缩放只发生在绘制层。
 */
(() => {
'use strict';
const { Engine, World, Bodies, Body, Events } = Matter;
if (window.decomp && Matter.Common && Matter.Common.setDecomp) Matter.Common.setDecomp(window.decomp);  // 凹多边形碰撞体分解

/* ---------------- 可调参数 ---------------- */
const W = 360, H = 620;          // 逻辑画布（收窄以贴近参考图比例，也让堆叠更快触线）
const WALL = 16, FLOOR = 18;     // 侧壁 / 地板厚度
const DROP_LINE = 190;           // 虚线：奶龙顶部越过它并停住即判负（碰撞体改矩形后更耐堆，线下移补偿局时）
const HOLD_Y = 64;               // 手持件中心高度
const DROP_CD = 380;             // 两次投放最小间隔(ms)
const OVER_MS = 1250;            // 压线停留多久判负(ms)
const FILL = 0.9;                // 素材长边占 512 画布的比例（构建时归一化留的白）

// r = 圆形碰撞体半径；f = 素材长边 / 碰撞体直径；ar = 主体宽高比（算手持高度与横向夹取）
// com = 重心相对几何中心下移量（占 r 的比例）：质量压在肚子/下半身，落地会歪会晃再自己立正
const TIERS = [
  { file: '01_swirl', name: '便便', r: 26, f: 1.10, ar: 0.88, com: 0.42, pts: 5 },
  { file: '02_angry', name: '怒球', r: 36, f: 1.06, ar: 0.97, com: 0.40, pts: 5 },
  { file: '03_blade', name: '刀盾', r: 45, f: 1.16, ar: 1.60, com: 0.44, pts: 10 },
  { file: '04_stand', name: '立胖', r: 55, f: 1.04, ar: 0.77, com: 0.50, pts: 20 },
  { file: '05_belly', name: '摸肚', r: 66, f: 1.16, ar: 0.50, com: 0.52, pts: 40 },
  { file: '06_sphinx', name: '狮身', r: 80, f: 1.06, ar: 1.12, com: 0.46, pts: 80 },
  { file: '07_angel', name: '天使', r: 95, f: 1.10, ar: 0.80, com: 0.48, pts: 160 },
  { file: '08_wave', name: '奶龙', r: 110, f: 1.06, ar: 0.70, com: 0.50, pts: 320 },
];
const SIM_SPEED = 2;   // 每帧物理子步数：2 = 整体速度翻倍（掉落/滑落/ settling 都快一倍）
const MAX_TILT = 0.52; // 倾角软上限(~30°)：范围内纯物理，超出用恢复力矩拽回，防止躺平/倒立
const TOP = TIERS.length - 1;
// 只投前三阶：手持件才不会顶出画面，也贴近参考图"掉最小的"手感
const SPAWN_W = [0.42, 0.33, 0.25];
const SPAWN_MAX = SPAWN_W.length - 1;
const BEST_KEY = 'nailong.best.v1';

/* ---------------- 画布 ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const boardEl = document.getElementById('board');
const stageEl = document.querySelector('.stage');
const MARGINS = 34;      // board/chain/hint 三段 margin 合计
const BODY_PAD = 40;     // body 上下 padding
const BADGE = 34;        // Netlify 免费角标额外留白，别压住底部提示
function layout() {
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  // 先放开尺寸量出"棋盘以外"占的高度，再把剩余视口高度分给棋盘：
  // 手机上不会被 flex 压扁裁掉底部，也不需要滚动
  canvas.style.width = '100%'; canvas.style.height = 'auto';
  boardEl.style.width = '';
  let others = 0;
  for (const el of stageEl.children) if (el !== boardEl) others += el.getBoundingClientRect().height;
  const avail = window.innerHeight - others - MARGINS - BODY_PAD - BADGE;
  const byWidth = stageEl.clientWidth * H / W;
  const cssH = Math.max(300, Math.min(byWidth, avail));
  const cssW = Math.min(stageEl.clientWidth, cssH * W / H);
  canvas.style.height = Math.round(cssH) + 'px';
  canvas.style.width = Math.round(cssW) + 'px';
  boardEl.style.width = Math.round(cssW + 2) + 'px';   // border-box，含 1px 边框×2
}
layout();
addEventListener('resize', layout);
addEventListener('orientationchange', layout);

/* ---------------- 素材 ---------------- */
const imgs = TIERS.map((t) => {
  const im = new Image();
  im.src = 'assets/' + t.file + '.png';
  return im;
});
const loaded = imgs.map(() => false);
imgs.forEach((im, i) => { im.onload = () => { loaded[i] = true; }; });

/* ---------------- 音效（WebAudio 合成，无需音频文件） ---------------- */
let ac = null, muted = false;
function tone(freq, dur, type, vol, slideTo) {
  if (muted) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, ac.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
    g.gain.setValueAtTime(0, ac.currentTime);
    g.gain.linearRampToValueAtTime(vol || 0.07, ac.currentTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur + 0.02);
  } catch (e) { /* 音频不可用时静默 */ }
}
const sDrop = () => tone(150, 0.10, 'sine', 0.05, 90);
const sMerge = (t) => { tone(240 * Math.pow(1.19, t), 0.16, 'triangle', 0.075, 320 * Math.pow(1.19, t)); };
const sBoom = () => { tone(180, 0.5, 'sawtooth', 0.07, 60); tone(520, 0.4, 'sine', 0.05, 1200); };
const sOver = () => tone(330, 0.7, 'sine', 0.08, 80);

/* ---------------- 物理世界 ---------------- */
const engine = Engine.create();
engine.gravity.y = 1;
const world = engine.world;

function buildWalls() {
  const opt = { isStatic: true, restitution: 0, friction: 0.3 };
  World.add(world, [
    Bodies.rectangle(W / 2, H + FLOOR / 2, W * 3, FLOOR * 2, opt),
    Bodies.rectangle(-WALL / 2, H / 2, WALL * 2, H * 4, opt),
    Bodies.rectangle(W + WALL / 2, H / 2, WALL * 2, H * 4, opt),
  ]);
}
buildWalls();

function makeBody(x, y, tier) {
  const t = TIERS[tier];
  const b = Bodies.fromVertices(x, y, [hullVerts(tier)], {
    restitution: 0.04, friction: 0.42, frictionAir: 0.02, density: 0.0016,
  });
  // fromVertices 把质心放在 (x,y)；凸包质心 != 包围盒中心，
  // 这里把"包围盒中心"对齐到 (x,y)，绘制以 position 为中心才不会和碰撞体错位
  const vs = b.vertices;
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
  for (const v of vs) { if (v.x < mnx) mnx = v.x; if (v.x > mxx) mxx = v.x; if (v.y < mny) mny = v.y; if (v.y > mxy) mxy = v.y; }
  Body.setPosition(b, { x: x + (x - (mnx + mxx) / 2), y: y + (y - (mny + mxy) / 2) });
  // 重心压到下半身：受撞会歪、重力矩扶正，推过支撑面才会真倒
  Body.setCentre(b, { x: 0, y: hullExt(tier).hh * t.com }, true);
  b.tier = tier; b.born = simTime; b.overSince = null; b.dead = false;
  return b;
}
const pieces = () => Composite_bodies().filter((b) => b.tier !== undefined && !b.dead);
function Composite_bodies() { return world.bodies; }

/* ---------------- 游戏状态 ---------------- */
let score = 0;
let best = +(localStorage.getItem(BEST_KEY) || 0);
let curTier = 0, nextTier = 0;
let aimX = W / 2, aiming = false, lastDrop = -9999;
let over = false, started = false;
let simTime = 0;   // 模拟时钟(ms)：无头 step() 与真机 rAF 共用，判负计时不依赖真实时间
const fx = [];

const el = {
  score: document.getElementById('score'), best: document.getElementById('best'),
  next: document.getElementById('next-img'), over: document.getElementById('over'),
  overScore: document.getElementById('over-score'), overTitle: document.getElementById('over-title'),
  overNote: document.getElementById('over-note'), chain: document.getElementById('chain'),
  sound: document.getElementById('btn-sound'),
};
el.best.textContent = best;

function rollTier() {
  let s = 0; for (const v of SPAWN_W) s += v;
  let x = Math.random() * s;
  for (let i = 0; i < SPAWN_W.length; i++) { x -= SPAWN_W[i]; if (x <= 0) return i; }
  return 0;
}
function setScore(v) {
  score = v;
  el.score.textContent = score;
  if (score > best) { best = score; el.best.textContent = best; localStorage.setItem(BEST_KEY, best); }
}
function refreshNext() { el.next.src = 'assets/' + TIERS[nextTier].file + '.png'; }

function reset() {
  for (const b of pieces().slice()) World.remove(world, b);
  fx.length = 0;
  over = false; started = false; lastDrop = -9999;
  el.over.hidden = true;
  setScore(0);
  curTier = rollTier(); nextTier = rollTier(); refreshNext();
}

/* ---------------- 合成 ---------------- */
let merges = [];
// 凹多边形刚体是复合体，碰撞 pair 里给的是子部件，要沿 parent 链取到带 tier 的根刚体
const rootBody = (b) => { let x = b; while (x.parent && x.parent !== x) x = x.parent; return x; };
Events.on(engine, 'collisionStart', (ev) => {
  for (const p of ev.pairs) {
    const a = rootBody(p.bodyA), b = rootBody(p.bodyB);
    if (a === b) continue;
    if (a.tier === undefined || b.tier === undefined) continue;
    if (a.tier !== b.tier || a.dead || b.dead) continue;
    merges.push([a, b]);
  }
});

function processMerges() {
  const used = new Set();
  for (const [a, b] of merges) {
    if (used.has(a.id) || used.has(b.id) || a.dead || b.dead) continue;
    used.add(a.id); used.add(b.id);
    a.dead = b.dead = true;
    const mx = (a.position.x + b.position.x) / 2;
    const my = (a.position.y + b.position.y) / 2;
    World.remove(world, a); World.remove(world, b);
    const t = a.tier;

    if (t < TOP) {
      const nt = t + 1;
      const nb = makeBody(mx, my, nt);
      Body.setVelocity(nb, { x: 0, y: -1.2 });
      World.add(world, nb);
      setScore(score + TIERS[nt].pts);
      fx.push({ kind: 'ring', x: mx, y: my, t0: performance.now(), life: 420, r: TIERS[t].r * 1.1, hue: nt });
      fx.push({ kind: 'dust', x: mx, y: my, t0: performance.now(), life: 520, n: 10, r: TIERS[t].r });
      fx.push({ kind: 'text', x: mx, y: my - TIERS[nt].r * 0.6, t0: performance.now(), life: 760,
        txt: '+' + TIERS[nt].pts });
      sMerge(nt);
      if (nt === TOP) fx.push({ kind: 'halo', x: mx, y: my, t0: performance.now(), life: 1400, r: TIERS[nt].r });
    } else {
      // 两个顶级天使相碰：双双升天，给大奖
      setScore(score + 500);
      fx.push({ kind: 'text', x: mx, y: my - 20, t0: performance.now(), life: 1100, txt: '+500 升天!', big: true });
      fx.push({ kind: 'ring', x: mx, y: my, t0: performance.now(), life: 620, r: TIERS[TOP].r * 1.2, hue: TOP });
      fx.push({ kind: 'dust', x: mx, y: my, t0: performance.now(), life: 900, n: 26, r: TIERS[TOP].r });
      sBoom();
    }
  }
  merges = [];
}

/* ---------------- 投放 ---------------- */
// 手持件高度按素材实际高度算，保证大件也不会顶出画布
function drawnBox(tier) {
  const t = TIERS[tier];
  const L = 2 * t.r * t.f;
  return t.ar >= 1 ? { w: L, h: L / t.ar } : { w: L * t.ar, h: L };
}
// 碰撞体 = 立绘包围盒缩一点（K），平边相贴 => 消除圆碰撞体留下的缝
const COL_K = 0.95;
function colliderBox(tier) {
  const d = drawnBox(tier);
  return { w: d.w * COL_K, h: d.h * COL_K };
}
// 贴合贴图轮廓的凹多边形碰撞体（scripts/gen_outline.js 由 alpha 通道生成，归一化到主体包围盒）
function hullVerts(tier) {
  const h = window.OUTLINES[TIERS[tier].file];
  const c = colliderBox(tier);
  return h.pts.map(([x, y]) => ({ x: x * c.w, y: y * c.h }));
}
function hullExt(tier) {
  const h = window.OUTLINES[TIERS[tier].file];
  const c = colliderBox(tier);
  return {
    hw: Math.max(-h.ext.l, h.ext.r) * c.w,      // 半宽
    top: h.ext.t * c.h,                          // 顶边（负值，相对中心）
    hh: (h.ext.b - h.ext.t) / 2 * c.h,           // 半高
  };
}
function holdY(tier) {
  return Math.max(HOLD_Y, drawnBox(tier).h / 2 + 6);
}
function aimClamp(x, tier) {
  const half = hullExt(tier).hw;
  return Math.min(W - WALL - half, Math.max(WALL + half, x));
}
function drop() {
  if (over) return;
  const now = performance.now();
  if (now - lastDrop < DROP_CD) return;
  const b = makeBody(aimClamp(aimX, curTier), holdY(curTier), curTier);
  Body.setVelocity(b, { x: 0, y: 4 });
  World.add(world, b);
  lastDrop = now; started = true;
  curTier = nextTier; nextTier = rollTier(); refreshNext();
  sDrop();
}

/* ---------------- 判负 ---------------- */
function checkOver(now) {
  for (const b of pieces()) {
    if (now - b.born < 500) continue;
    const topY = b.position.y + hullExt(b.tier).top;
    const calm = b.speed < 0.28;
    if (topY < DROP_LINE && calm) {
      if (b.overSince == null) b.overSince = now;
      else if (now - b.overSince > OVER_MS) return true;
    } else b.overSince = null;
  }
  return false;
}
function gameOver() {
  over = true;
  el.overTitle.textContent = '堆到线上了';
  el.overScore.textContent = score;
  el.overNote.textContent = score >= best && score > 0 ? '新纪录！' : '最高分 ' + best;
  el.over.hidden = false;
  sOver();
}

/* ---------------- 输入 ---------------- */
const board = document.getElementById('board');
function toLogicalX(clientX) {
  const rect = canvas.getBoundingClientRect();
  return ((clientX - rect.left) / rect.width) * W;
}
board.addEventListener('pointerdown', (e) => {
  if (over) return;
  aiming = true; aimX = toLogicalX(e.clientX);
  board.setPointerCapture(e.pointerId);
  e.preventDefault();
});
board.addEventListener('pointermove', (e) => { if (aiming) aimX = toLogicalX(e.clientX); });
board.addEventListener('pointerup', (e) => { if (!aiming) return; aiming = false; aimX = toLogicalX(e.clientX); drop(); });
board.addEventListener('pointercancel', () => { aiming = false; });
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !over) { drop(); e.preventDefault(); }
  if (e.key === 'ArrowLeft') aimX -= 16;
  if (e.key === 'ArrowRight') aimX += 16;
});
document.getElementById('btn-restart').addEventListener('click', reset);
document.getElementById('btn-again').addEventListener('click', reset);
el.sound.addEventListener('click', () => {
  muted = !muted;
  el.sound.textContent = muted ? '🔇' : '🔊';
  el.sound.classList.toggle('off', muted);
  if (!muted) tone(660, 0.08, 'sine', 0.05);
});

/* ---------------- 合成链展示 ---------------- */
el.chain.innerHTML = TIERS.map((t, i) =>
  `<div class="slot${i === TOP ? ' max' : ''}"><img src="assets/${t.file}.png" alt="${t.name}"><span class="n">${i + 1}</span></div>` +
  (i < TOP ? '<span class="arrow">›</span>' : '')
).join('');

/* ---------------- 绘制 ---------------- */
function drawTier(tier, x, y, alpha, angle) {
  const t = TIERS[tier];
  const im = imgs[tier];
  const side = (2 * t.r * t.f) / FILL;
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  if (alpha != null) ctx.globalAlpha = alpha;
  if (!loaded[tier]) {                       // 素材没到先画占位圆，不阻塞玩法
    ctx.fillStyle = 'rgba(240,205,140,.55)';
    ctx.beginPath(); ctx.arc(0, 0, t.r, 0, 7); ctx.fill();
  } else {
    ctx.drawImage(im, -side / 2, -side / 2, side, side);
  }
  ctx.restore();
}

function drawBackdrop() {
  ctx.clearRect(0, 0, W, H);
  // 危险区
  const g = ctx.createLinearGradient(0, 0, 0, DROP_LINE);
  g.addColorStop(0, 'rgba(255,215,205,.42)');
  g.addColorStop(1, 'rgba(255,215,205,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, DROP_LINE);
  // 虚线
  ctx.save();
  ctx.strokeStyle = 'rgba(226,140,120,.55)'; ctx.lineWidth = 1.5; ctx.setLineDash([7, 7]);
  ctx.beginPath(); ctx.moveTo(WALL, DROP_LINE); ctx.lineTo(W - WALL, DROP_LINE); ctx.stroke();
  ctx.restore();
}

function drawAim() {
  if (over) return;
  const t = TIERS[curTier];
  const x = aimClamp(aimX, curTier), y = holdY(curTier);
  ctx.save();
  ctx.strokeStyle = 'rgba(180,160,140,.45)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 8]);
  ctx.beginPath(); ctx.moveTo(x, y + t.r + 6); ctx.lineTo(x, H - FLOOR); ctx.stroke();
  ctx.restore();
  drawTier(curTier, x, y, 1);
}

function drawFx(now) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const e = fx[i];
    const k = (now - e.t0) / e.life;
    if (k >= 1) { fx.splice(i, 1); continue; }
    ctx.save();
    if (e.kind === 'ring') {
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = 'rgba(255,205,120,1)'; ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 46 * k, 0, 7); ctx.stroke();
    } else if (e.kind === 'halo') {
      ctx.globalAlpha = (1 - k) * 0.55;
      const g = ctx.createRadialGradient(e.x, e.y, e.r * 0.4, e.x, e.y, e.r * 2.4);
      g.addColorStop(0, 'rgba(255,240,190,.95)'); g.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 2.4, 0, 7); ctx.fill();
    } else if (e.kind === 'dust') {
      for (let j = 0; j < e.n; j++) {
        const a = (j / e.n) * Math.PI * 2 + e.t0;
        const d = e.r * (0.5 + 1.5 * k);
        ctx.globalAlpha = (1 - k) * 0.7;
        ctx.fillStyle = j % 2 ? 'rgba(255,224,170,1)' : 'rgba(255,255,255,1)';
        ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, 3.4 * (1 - k) + 0.6, 0, 7); ctx.fill();
      }
    } else if (e.kind === 'text') {
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = e.big ? '#e8863d' : '#c99a52';
      ctx.font = (e.big ? '700 22px ' : '700 16px ') + '"PingFang SC",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(e.txt, e.x, e.y - 26 * k);
    }
    ctx.restore();
  }
}

/* 倾角软上限：矩形碰撞体能紧密堆叠，但侧躺是稳定平衡会起不来；
   这里在 |angle| 超过 MAX_TILT 时施加恢复，把它平滑拽回上限内（不倒翁的"自己爬起来"）。 */
function stabilize() {
  for (const b of pieces()) {
    let a = b.angle;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    if (Math.abs(a) <= MAX_TILT) continue;
    const target = Math.sign(a) * MAX_TILT;
    Body.setAngle(b, b.angle + (target - a) * 0.14);
    Body.setAngularVelocity(b, b.angularVelocity * 0.55);
  }
}

/* ---------------- 主循环 ---------------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(32, now - last); last = now;
  if (!over) simTime += dt;
  if (!over) {
    for (let i = 0; i < SIM_SPEED; i++) Engine.update(engine, dt);   // 子步数=速度倍率，比调重力稳
    stabilize();
    processMerges();
    if (started && checkOver(simTime)) gameOver();
  }
  drawBackdrop();
  for (const b of pieces()) drawTier(b.tier, b.position.x, b.position.y, null, b.angle);
  drawAim();
  drawFx(now);
  requestAnimationFrame(frame);
}

reset();
requestAnimationFrame(frame);

/* 自测钩子：控制台里 NAIWA.dropAt(210, 0) 定点投放，NAIWA.stat() 看状态。
   纯调试用，不影响正常玩法，发布要删可以整段删掉。 */
window.NAIWA = {
  dropAt(x, tier) { if (tier != null) curTier = Math.max(0, Math.min(TOP, tier)); aimX = x; lastDrop = -9999; drop(); },
  // 后台标签页 rAF 会暂停，用这个手动推进物理做无头验证
  step(n, dt) {
    for (let i = 0; i < (n || 1); i++) {
      const sdt = dt || 16.7; simTime += sdt;
      Engine.update(engine, sdt); stabilize(); processMerges();
      if (started && checkOver(simTime)) gameOver();
    }
  },
  render() { drawBackdrop(); for (const b of pieces()) drawTier(b.tier, b.position.x, b.position.y, null, b.angle); drawAim(); drawFx(performance.now()); },
  stat() {
    return {
      score, best, pieces: pieces().length, tiers: pieces().map((b) => b.tier), over, cur: curTier, next: nextTier,
      // 调试用：每个体的倾角(度)，验证重心扶正效果
      angles: pieces().map((b) => Math.round((b.angle * 180 / Math.PI) % 360)),
      // 调试用：堆顶 y（越小越高），调 DROP_LINE 用
      tops: pieces().map((b) => Math.round(b.position.y + hullExt(b.tier).top)).sort((a, b) => a - b).slice(0, 4),
    };
  },
  reset, TIERS, engine, world,
};
})();
