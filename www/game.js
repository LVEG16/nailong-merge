/* 奶龙合成所 —— matter-js 物理 + canvas 2D 渲染
 * 玩法：拖动瞄准 → 松手投放 → 两个同阶奶龙相碰进化一级 → 堆过虚线判负
 * 逻辑坐标系固定 360x620，物理参数与分辨率无关，缩放只发生在绘制层。
 */
(() => {
'use strict';
const { Engine, World, Bodies, Body, Events, Sleeping } = Matter;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ---------------- 可调参数 ---------------- */
const W = 360, H = 620;          // 逻辑画布（收窄以贴近参考图比例，也让堆叠更快触线）
const WALL = 16, FLOOR = 18;     // 侧壁 / 地板厚度
const DROP_LINE = 200;           // 虚线：奶龙顶部越过它并停住即判负（已抬高，给下方多留 40 的堆叠空间）
const HOLD_Y = 64;               // 手持件中心高度
const DROP_CD = 380;             // 两次投放最小间隔(ms)
const OVER_MS = 1250;            // 压线停留多久判负(ms)
const MERGE_CD = 500;            // 单个奶龙出生后多久才能参与合成(ms)
const FILL = 0.9;                // 素材长边占 512 画布的比例（构建时归一化留的白）

// r = 圆形碰撞体半径；f = 素材长边 / 碰撞体直径；ar = 主体宽高比（算手持高度与横向夹取）
// com = 重心相对几何中心下移量（占 r 的比例）：质量压在肚子/下半身，落地会歪会晃再自己立正
const TIERS = [
  { file: '01_swirl', name: '便便', r: 33, f: 1.10, ar: 0.88, com: 0.42, pts: 5 },
  { file: '02_angry', name: '怒球', r: 45, f: 1.06, ar: 0.97, com: 0.40, pts: 5 },
  { file: '03_blade', name: '刀盾', r: 56, f: 1.16, ar: 1.60, com: 0.44, pts: 10 },
  { file: '04_stand', name: '立胖', r: 69, f: 1.04, ar: 0.77, com: 0.50, pts: 20 },
  { file: '05_belly', name: '摸肚', r: 83, f: 1.16, ar: 0.50, com: 0.52, pts: 40 },
  { file: '06_sphinx', name: '狮身', r: 92, f: 1.06, ar: 1.12, com: 0.46, pts: 80 },
  { file: '07_angel', name: '天使', r: 106, f: 1.10, ar: 0.80, com: 0.48, pts: 160 },
  { file: '08_wave', name: '奶龙', r: 120, f: 1.06, ar: 0.70, com: 0.50, pts: 320 },
];
const PHYSICS_SUBSTEPS = 4;   // 每帧分成四个物理子步，总推进时间仍为 dt；增加子步不等于加速
let MAX_TILT = 0.52; // 倾角软上限(~30°)：范围内纯物理，超出用恢复力矩拽回，防止躺平/倒立
const TOP = TIERS.length - 1;
// 只投前五阶，权重与现有难度保持一致。
const SPAWN_W = [0.30, 0.26, 0.20, 0.14, 0.10];   // 五阶投放：场上种类多 -> 同阶相邻概率低 -> 堆才长得起来（合成大西瓜靠 11 阶达到同样效果）
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
  /* 兜底收敛：若因字体渲染/换行等环境差异页面仍超出视口（scrollHeight 校验），
     按溢出量再收紧一次画布，保证"底部提示永不落屏外"；正常环境此分支不触发。 */
  const overPx = document.documentElement.scrollHeight - window.innerHeight;
  if (overPx > 2) {
    const h2 = Math.max(300, cssH - overPx);
    const w2 = Math.round(h2 * W / H);
    canvas.style.height = Math.round(h2) + 'px';
    canvas.style.width = w2 + 'px';
    boardEl.style.width = w2 + 2 + 'px';
  }
}
layout();
addEventListener('resize', layout);
addEventListener('orientationchange', layout);
addEventListener('load', layout);   // 资源全部就绪后再校准一次（字体/图片万一影响高度）

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
const sOver = () => tone(330, 0.7, 'sine', 0.08, 80);

/* ---------------- 物理世界 ---------------- */
const engine = Engine.create();
engine.gravity.y = 1;
engine.positionIterations = 16;   // 复合体堆叠需要更多位置迭代
engine.velocityIterations = 8;
engine.enableSleeping = true;     // 静止棋子休眠：堆叠不再抖/不再被求解器压穿
const world = engine.world;

function buildWalls() {
  const opt = { isStatic: true, restitution: 0, friction: 0.3 };
  World.add(world, [
    Bodies.rectangle(W / 2, H + 60, W * 3, 160, opt),   // 加厚地板：高速下落不会砸穿
    Bodies.rectangle(-WALL / 2, H / 2, WALL * 2, H * 4, opt),
    Bodies.rectangle(W + WALL / 2, H / 2, WALL * 2, H * 4, opt),
  ]);
}
buildWalls();

function polyCentroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const q = poly[(i + 1) % poly.length];
    const cr = poly[i].x * q.y - q.x * poly[i].y;
    a += cr; cx += (poly[i].x + q.x) * cr; cy += (poly[i].y + q.y) * cr;
  }
  a /= 2;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}
function makeBody(x, y, tier) {
  const t = TIERS[tier];
  const opts = { restitution: 0.02, friction: 0.28, frictionAir: 0.02, density: 0.0016 };
  /* fromVertices 会把形状的面积质心平移到传入的 (x,y)。
     复合体必须逐部件传入"部件自己的质心"：若都传同一个点，所有条带会被摆到原点叠在一起，
     碰撞体塌成中间一条 —— 早年"复合体穿透 70-90px"的真凶就是这个，不是 Matter 解不动。 */
  const polys = hullVerts(tier);
  const partBodies = polys.map((poly) => {
    const c = polyCentroid(poly);
    return Bodies.fromVertices(c.x, c.y, [poly], opts);
  });
  const b = partBodies.length > 1 ? Body.create(Object.assign({ parts: partBodies }, opts)) : partBodies[0];
  // Body.setPosition 是绝对赋值，所以要"当前位置 + 期望位移"，把包围盒中心平移到 (x,y)，绘制以包围盒中心为准才不错位。
  // 复合体的 b.vertices 被 setParts 换成了"全部件的凸包再平移"，不可信，包围盒要从部件顶点算
  const vs = b.parts.reduce((acc, p) => acc.concat(p.vertices), []);
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
  for (const v of vs) { if (v.x < mnx) mnx = v.x; if (v.x > mxx) mxx = v.x; if (v.y < mny) mny = v.y; if (v.y > mxy) mxy = v.y; }
  Body.setPosition(b, {
    x: b.position.x + (x - (mnx + mxx) / 2),
    y: b.position.y + (y - (mny + mxy) / 2),
  });
  // 重心压到下半身：受撞会歪、重力矩扶正，推过支撑面才会真倒
  const comD = hullExt(tier).hh * t.com;
  Body.setCentre(b, { x: 0, y: comD }, true);
  /* setCentre 只挪了参考点（求解器拿它当质心算力臂），惯量还是按几何中心算的：
     少了平行轴那一项 m·d²，棋子比真实情况更容易被转歪 —— 看着就是"没根"地乱倾、动不动顶到倾角上限。 */
  if (COM_FIX) Body.setInertia(b, b.inertia + b.mass * comD * comD);
  b.tier = tier; b.born = simTime; b.overSince = null; b.dead = false;
  b.touchAt = -1e9;             // 上次碰到东西的时刻：判"是不是还在空中"
  b.readyAt = simTime + MERGE_CD;   // 出生冷却：打断"合成->立刻再合成"的瞬时连锁，让堆能长起来
  return b;
}
const pieces = () => Composite_bodies().filter((b) => b.tier !== undefined && !b.dead);
function Composite_bodies() { return world.bodies; }

/* ---------------- 游戏状态 ---------------- */
let score = 0;
let best = 0, bestAtStart = 0;
try { best = Math.max(0, parseInt(localStorage.getItem(BEST_KEY), 10) || 0); } catch (e) { best = 0; }  // 隐私模式等场景 localStorage 可能抛错
bestAtStart = best;
let curTier = 0, nextTier = 0;
let aimX = W / 2, aiming = false, lastDrop = -9999;
let over = false, started = false;
let simTime = 0;
let fellOut = 0;   // 调试计数：掉出世界被收容删除的棋子数   // 模拟时钟(ms)：无头 step() 与真机 rAF 共用，判负计时不依赖真实时间
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
  if (score > best) {
    best = score; el.best.textContent = best;
    try { localStorage.setItem(BEST_KEY, best); } catch (e) { /* 存不了就只留内存 */ }
  }
}
function refreshNext() { el.next.src = 'assets/' + TIERS[nextTier].file + '.png'; }

function reset() {
  for (const b of pieces().slice()) World.remove(world, b);
  Matter.Pairs.clear(engine.pairs);   // 上一局的接触对里还留着已删除刚体，不清会污染碰撞检测/统计
  fx.length = 0;
  merges.length = 0;          // 清掉未处理的合成队列，否则重开瞬间可能冒出幽灵合成
  deferredMerges.clear();
  over = false; started = false; lastDrop = -9999;
  bestAtStart = best;
  el.over.hidden = true;
  setScore(0);
  curTier = rollTier(); nextTier = rollTier(); refreshNext();
}

/* ---------------- 合成 ---------------- */
let merges = [];
const deferredMerges = new Map();
// 凹多边形刚体是复合体，碰撞 pair 里给的是子部件，要沿 parent 链取到带 tier 的根刚体
const rootBody = (b) => { let x = b; while (x.parent && x.parent !== x) x = x.parent; return x; };
/* 支撑追踪：倾角扶正只对"有东西托着"的棋子生效，
   空中自由落体的棋子让它自然翻转（否则会出现悬在半空还硬撑着 30° 的怪画面） */
const markTouch = (ev) => {
  for (const p of ev.pairs) { rootBody(p.bodyA).touchAt = simTime; rootBody(p.bodyB).touchAt = simTime; }
};
Events.on(engine, 'collisionActive', markTouch);
Events.on(engine, 'collisionEnd', markTouch);
Events.on(engine, 'collisionStart', (ev) => {
  markTouch(ev);
  for (const p of ev.pairs) {
    const a = rootBody(p.bodyA), b = rootBody(p.bodyB);
    if (a === b) continue;
    if (a.tier === undefined || b.tier === undefined) continue;
    if (a.tier !== b.tier || a.dead || b.dead) continue;
    if (a.tier === TOP) continue;   // 顶级为终端阶：不再合成，留在场上堵堆（合成大西瓜的经典压力源）
    if (simTime < a.readyAt || simTime < b.readyAt) {
      // 冷却内的首次接触也要保留：静止/休眠后未必再有 collisionStart。
      const key = Math.min(a.id, b.id) + ':' + Math.max(a.id, b.id);
      deferredMerges.set(key, [a, b]);
      continue;
    }
    merges.push([a, b]);
  }
});

// 合成新体的落点：中点若与现有棋子重叠就往上找空位，避免生成在别人身体里被求解器弹飞
function freeSpot(x, y, tier) {
  for (let k = 0; k < 7; k++) {
    const py = y - k * 14;
    let ok = true;
    for (const o of pieces()) {
      if (o.dead) continue;
      const rr = (TIERS[tier].r + TIERS[o.tier].r) * 0.85;
      const dx = o.position.x - x, dy = o.position.y - py;
      if (dx * dx + dy * dy < rr * rr) { ok = false; break; }
    }
    if (ok) return { x, y: py };
  }
  return { x, y };
}

function processMerges() {
  if (deferredMerges.size) {
    const live = new Set(pieces());
    for (const [key, [a, b]] of deferredMerges) {
      if (!live.has(a) || !live.has(b) || a.tier !== b.tier || a.tier === TOP) {
        deferredMerges.delete(key);
        continue;
      }
      if (simTime < a.readyAt || simTime < b.readyAt) continue;
      deferredMerges.delete(key);
      // Query 只展开候选 b 的部件；查询体 a 也必须逐部件检查，
      // 否则复合体的父凸包会把刀盾等角色的凹口空隙误判成接触。
      const parts = a.parts.length > 1 ? a.parts.slice(1) : [a];
      if (parts.some(part => Matter.Query.collides(part, [b]).length)) merges.push([a, b]);
    }
  }
  const used = new Set();
  for (const [a, b] of merges) {
    if (used.has(a.id) || used.has(b.id) || a.dead || b.dead) continue;
    used.add(a.id); used.add(b.id);
    a.dead = b.dead = true;
    const mx = (a.position.x + b.position.x) / 2;
    const my = (a.position.y + b.position.y) / 2;
    World.remove(world, a); World.remove(world, b);
    /* 支撑被合成掉了：Matter 不会因为"邻居消失"唤醒休眠体（afterCollisions 里
       双方都睡着 或 对方是静态墙 都直接 continue），压在上面的棋子会永远冻在半空。
       所以每次合成后全体唤醒，让堆重新沉降一次。 */
    for (const o of pieces()) Sleeping.set(o, false);
    const t = a.tier;

    const nt = t + 1;
    const sp = freeSpot(mx, my, nt);
    const nb = makeBody(sp.x, sp.y, nt);
    Body.setVelocity(nb, { x: 0, y: -1.2 });
    World.add(world, nb);
    setScore(score + TIERS[nt].pts);
    fx.push({ kind: 'ring', x: mx, y: my, t0: performance.now(), life: 420, r: TIERS[t].r * 1.1, hue: nt });
    fx.push({ kind: 'dust', x: mx, y: my, t0: performance.now(), life: 520, n: 10, r: TIERS[t].r });
    fx.push({ kind: 'text', x: mx, y: my - TIERS[nt].r * 0.6, t0: performance.now(), life: 760, txt: '+' + TIERS[nt].pts });
    sMerge(nt);
    if (nt === TOP) fx.push({ kind: 'halo', x: mx, y: my, t0: performance.now(), life: 1400, r: TIERS[nt].r });
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
const COL_K = 1.0;   // 碰撞体=贴图实际尺寸：不再预留交叠余量，避免穿模观感
function colliderBox(tier) {
  const d = drawnBox(tier);
  return { w: d.w * COL_K, h: d.h * COL_K };
}
// 贴合贴图轮廓的碰撞体：colliders.js 里每阶 3 条竖向条带凸包（scripts/gen_colliders.js 由 alpha 通道生成，归一化到主体包围盒）
function hullParts(tier) {
  const c = colliderBox(tier);
  return window.COLLIDERS[TIERS[tier].file].parts.map((part) => part.map(([x, y]) => ({ x: x * c.w, y: y * c.h })));
}
function hull2d(pts) {
  const p = pts.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}
/* 两套碰撞体：
   PARTS  = 每阶 3 条竖向条带凸包组成的复合体，贴合贴图（凹口保留，刀盾的刀身之间不会被填实）
   SINGLE = 条带点集合并后的单凸包，堆叠最稳，但凹口被填掉，棋子会停在看不见的凸包角上留出缝
   默认 hybrid：只在"单凸包明显比立绘胖"的阶用 PARTS，其余用 SINGLE。 */
const PARTS = TIERS.map((t, i) => hullParts(i).map((p) => hull2d(p)));
const SINGLE = TIERS.map((t, i) => [hull2d(hullParts(i).flat())]);
// 单凸包比立绘大多少（面积）：刀盾 26%、天使 6%，其余 ≤3.4%。
// 差得多的那两阶用条带复合体（否则棋子会停在看不见的凸包角上，出现"隔空"缝），其余用单凸包（堆叠最稳）。
const FAT = TIERS.map((t, i) => {
  const area = (poly) => { let s = 0; for (let k = 0; k < poly.length; k++) { const p = poly[k], q = poly[(k + 1) % poly.length]; s += p.x * q.y - q.x * p.y; } return Math.abs(s / 2); };
  const sa = PARTS[i].reduce((s, p) => s + area(p), 0);
  return area(SINGLE[i][0]) / sa - 1;
});
let COL_MODE = 'hybrid';
let COM_FIX = true;      // 重心下移后按平行轴定理补转动惯量
const HYBRID_MIN = 0.05;
function hullVerts(tier) {
  if (COL_MODE === 'single') return SINGLE[tier];
  if (COL_MODE === 'hybrid' && FAT[tier] < HYBRID_MIN) return SINGLE[tier];
  return PARTS[tier];
}
function hullExt(tier) {
  const h = window.COLLIDERS[TIERS[tier].file];
  const c = colliderBox(tier);
  return {
    hw: Math.max(-h.ext.l, h.ext.r) * c.w,      // 半宽
    top: h.ext.t * c.h,                          // 顶边（负值，相对中心）
    hh: (h.ext.b - h.ext.t) / 2 * c.h,           // 半高
  };
}
// setCentre 会把 body.position 移到重心；立绘是按包围盒中心画的，
// 所以绘制/判负都要用"包围盒中心"= position 减去旋转后的重心偏移
function artCenter(b) {
  const off = hullExt(b.tier).hh * TIERS[b.tier].com;
  return { x: b.position.x + off * Math.sin(b.angle), y: b.position.y - off * Math.cos(b.angle) };
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
    const topY = artCenter(b).y + hullExt(b.tier).top;
    // 用位置增量判静止：去穿透的位置修正会让 speed 失真，位置增量不会
    const dx = b.position.x - (b.px == null ? b.position.x : b.px);
    const dy = b.position.y - (b.py == null ? b.position.y : b.py);
    b.px = b.position.x; b.py = b.position.y;
    const calm = Math.hypot(dx, dy) < 1.2;
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
  el.overNote.textContent = score > bestAtStart && score > 0 ? '新纪录！' : '最高分 ' + best;
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
/* 首次 layout() 跑在 chain 填充之前：那时链高 0，画布多分了 50 多像素，
   chain 补上后没人重算 —— 页面整体超出视口，底部提示被裁。
   这里（以及 load 事件）补一次校准，保证"高度分配"基于完整 DOM。 */
layout();

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
  const x = aimClamp(aimX, curTier), y = holdY(curTier);
  ctx.save();
  ctx.strokeStyle = 'rgba(180,160,140,.45)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 8]);
  ctx.beginPath(); ctx.moveTo(x, y + drawnBox(curTier).h / 2 + 4); ctx.lineTo(x, H - FLOOR); ctx.stroke();
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


/* 收容：位置修正可能把刚体一步推出侧墙，这里每帧夹回场内，杜绝飞出场外 */
function contain() {
  let removed = false;
  for (const b of pieces()) {
    const e = hullExt(b.tier);
    const minX = WALL + e.hw * 0.6, maxX = W - WALL - e.hw * 0.6;
    if (b.position.x < minX) Body.setPosition(b, { x: minX, y: b.position.y });
    else if (b.position.x > maxX) Body.setPosition(b, { x: maxX, y: b.position.y });
    if (b.position.y > H + 300) { b.dead = true; fellOut++; removed = true; World.remove(world, b); }   // 万一掉出世界直接清掉，不卡判负
    if (b.position.y < -60) {   // 上边界护栏：被挤飞的棋子拦住并消掉上冲速度，不许飞出画面
      Body.setPosition(b, { x: b.position.x, y: -60 });
      if (b.velocity.y < 0) Body.setVelocity(b, { x: b.velocity.x, y: 0 });
    }
  }
  if (removed) for (const b of pieces()) Sleeping.set(b, false);   // 支撑被清掉，全体重新沉降
}

/* 倾角软上限：轮廓刚体被推过支撑面后侧躺是稳定平衡会起不来；
   这里在 |angle| 超过 MAX_TILT 时施加恢复，把它平滑拽回上限内（不倒翁的"自己爬起来"）。
   只对"脚下有东西"的棋子生效：空中的棋子该自由翻转，硬扶正会拍成悬空斜靠的怪姿势。 */
function stabilize() {
  for (const b of pieces()) {
    if (b.isSleeping) continue;   // 休眠体由 Matter 冻结，写速度也没用，别做无用功
    // 速度上限：任何原因（合成落点、挤压）导致的爆速都夹住，杜绝弹飞出场
    const sp = Math.hypot(b.velocity.x, b.velocity.y);
    if (sp > 22) Body.setVelocity(b, { x: b.velocity.x * 22 / sp, y: b.velocity.y * 22 / sp });
    if (simTime - b.touchAt > 180) continue;   // 180ms 内没碰过任何东西 = 空中，交给重力
    let a = b.angle;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    const over = Math.abs(a) - MAX_TILT;
    if (over <= 0) continue;
    /* 只加"往回转正"的角速度，绝不给现有角速度打折。
       之前写成 av*0.5 + 恢复量，等于在倾角上限处把旋转急刹住 —— 正在倒的棋子被冻在 30°，
       看着就是"斜靠在空中"。现在是越歪越用力往回掰，掰不动也至少不会假死。 */
    Body.setAngularVelocity(b, b.angularVelocity - Math.sign(a) * clamp(over * 0.5, 0, 0.09));
  }
}

/* ---------------- 主循环 ---------------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(32, now - last); last = now;
  if (!over) simTime += dt;
  if (!over) {
    const sdt = dt / PHYSICS_SUBSTEPS;
    for (let i = 0; i < PHYSICS_SUBSTEPS; i++) Engine.update(engine, sdt);
    contain();
    stabilize();
    processMerges();
    if (started && checkOver(simTime)) gameOver();
  }
  drawBackdrop();
  for (const b of pieces()) { const c = artCenter(b); drawTier(b.tier, c.x, c.y, null, b.angle); }
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
      const full = dt || 16.7, sdt = full / PHYSICS_SUBSTEPS;
      for (let k = 0; k < PHYSICS_SUBSTEPS; k++) { simTime += sdt; Engine.update(engine, sdt); }
      contain(); stabilize(); processMerges();
      if (started && checkOver(simTime)) gameOver();
    }
  },
  render() { drawBackdrop(); for (const b of pieces()) { const c = artCenter(b); drawTier(b.tier, c.x, c.y, null, b.angle); } drawAim(); drawFx(performance.now()); },
  stat() {
    return {
      score, best, fellOut, pieces: pieces().length, tiers: pieces().map((b) => b.tier), over, cur: curTier, next: nextTier,
      // 调试用：每个体的倾角(度)，验证重心扶正效果
      angles: pieces().map((b) => Math.round((b.angle * 180 / Math.PI) % 360)),
      // 调试用：堆顶 y（越小越高），调 DROP_LINE 用
      tops: pieces().map((b) => Math.round(artCenter(b).y + hullExt(b.tier).top)).sort((a, b) => a - b).slice(0, 4),
      col: COL_MODE, sleep: pieces().filter((b) => b.isSleeping).length,
      pinned: pieces().filter((b) => Math.abs(b.angle) > MAX_TILT - 0.02).length,   // 顶到倾角上限的棋子数（越多越假）
    };
  },
  // A/B 碰撞体：'hybrid'(默认，仅胖阶用条带) / 'parts'(全部条带复合体) / 'single'(全部单凸包)
  setCol(mode) { if (['hybrid', 'parts', 'single'].includes(mode)) { COL_MODE = mode; reset(); } return { mode: COL_MODE, fat: FAT.map((v) => +(v * 100).toFixed(1)) }; },
  setCom(on) { COM_FIX = !!on; reset(); return COM_FIX; },
  setTilt(v) { MAX_TILT = v; reset(); return MAX_TILT; },
  mk(x, y, t) { return makeBody(x, y, t); },   // 调试：建一个不入场地的刚体，看碰撞几何
  reset, TIERS, engine, world,
  fell() { return fellOut; },
  // 自检：八阶「贴图 + 真实碰撞体(分解后的凸部件)」叠图，红线即实际碰撞几何
  colliderSheet() {
    const cell = 170, pad = 8, cols = 4, rows = 2;
    const cv = document.createElement('canvas');
    cv.width = cols * (cell + pad) + pad; cv.height = rows * (cell + pad) + pad;
    const c = cv.getContext('2d');
    c.fillStyle = '#20242e'; c.fillRect(0, 0, cv.width, cv.height);
    TIERS.forEach((t, i) => {
      const x0 = pad + (i % cols) * (cell + pad), y0 = pad + ((i / cols) | 0) * (cell + pad);
      const cx = x0 + cell / 2, cy = y0 + cell / 2 + 6;
      const d = drawnBox(i);
      const scale = (cell * 0.9) / Math.max(d.w, d.h);
      const side = ((2 * t.r * t.f) / FILL) * scale;
      if (loaded[i]) c.drawImage(imgs[i], cx - side / 2, cy - side / 2, side, side);
      const b = makeBody(0, 0, i);
      c.strokeStyle = 'rgba(255,64,64,.95)'; c.lineWidth = 1.4;
      const ps = b.parts.length > 1 ? b.parts.slice(1) : b.parts;   // 复合体的 parts[0] 是父体（顶点=全部部件的并集），画了会重复
      for (const part of ps) {
        c.beginPath();
        part.vertices.forEach((v, k) => {
          const ac = artCenter(b);
          const px = cx + (v.x - ac.x) * scale, py = cy + (v.y - ac.y) * scale;
          if (k) c.lineTo(px, py); else c.moveTo(px, py);
        });
        c.closePath(); c.stroke();
      }
      World.remove(world, b);
      c.fillStyle = '#fff'; c.font = '11px sans-serif'; c.fillText((i + 1) + ' ' + t.name, x0 + 5, y0 + 14);
    });
    return cv.toDataURL('image/png');
  },
};
})();
