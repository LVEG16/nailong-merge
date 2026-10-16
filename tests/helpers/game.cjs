const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

// Only browser surfaces are substituted. Physics, colliders and game rules are
// loaded unmodified in a fresh realm, including Matter's own sleeping/pair state.
function createGame({ storage = new Map(), unavailableStorage = false } = {}) {
  let now = 0, scheduledFrame;
  const elements = new Map();
  const noop = () => {};
  const gradient = () => ({ addColorStop: noop });
  const context2d = {
    setTransform: noop, save: noop, restore: noop, translate: noop, rotate: noop,
    beginPath: noop, closePath: noop, arc: noop, moveTo: noop, lineTo: noop,
    fill: noop, stroke: noop, fillRect: noop, clearRect: noop, drawImage: noop,
    fillText: noop, setLineDash: noop,
    createLinearGradient: gradient, createRadialGradient: gradient,
  };
  function element(id) {
    if (!elements.has(id)) {
      const listeners = new Map();
      elements.set(id, {
        style: {}, hidden: true, textContent: '', innerHTML: '', clientWidth: 360,
        classList: { toggle: noop }, setPointerCapture: noop,
        addEventListener(type, callback) { listeners.set(type, callback); },
        dispatch(type, values = {}) { listeners.get(type)?.({ preventDefault: noop, ...values }); },
        getBoundingClientRect() { return { left: 0, top: 0, width: 360, height: 620 }; },
        getContext() { return context2d; },
      });
    }
    return elements.get(id);
  }
  const stage = element('stage');
  stage.children = [element('board')];
  const accessStorage = () => { if (unavailableStorage) throw new Error('Storage unavailable'); };
  const sandbox = {
    console,
    performance: { now: () => now },
    localStorage: {
      getItem(key) { accessStorage(); return storage.get(key) ?? null; },
      setItem(key, value) { accessStorage(); storage.set(key, String(value)); },
    },
    Image: class {},
    devicePixelRatio: 1, innerHeight: 900,
    requestAnimationFrame(callback) { scheduledFrame = callback; },
    addEventListener: noop,
    document: {
      getElementById: element,
      querySelector: () => stage,
      documentElement: { scrollHeight: 900 },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['www/vendor/matter.min.js', 'www/colliders.js', 'www/game.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  }
  const game = sandbox.NAIWA;
  return {
    game, Matter: sandbox.Matter, elements, storage,
    frame(dt = 16.7) { now += dt; scheduledFrame(now); },
    advance(frames = 1, dt = 16.7) {
      for (let i = 0; i < frames; i++) { now += dt; game.step(1, dt); }
    },
  };
}

function contactPair(host, tier = 0) {
  const { game, Matter } = host;
  const a = game.mk(180, 560, tier), b = game.mk(180, 489, tier);
  Matter.World.add(game.world, [a, b]);
  return [a, b];
}

module.exports = { createGame, contactPair };
