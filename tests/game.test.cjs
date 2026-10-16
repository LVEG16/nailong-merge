const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, contactPair } = require('./helpers/game.cjs');

function assertMerged(game) {
  assert.equal(game.stat().pieces, 1, 'two contacting tier-0 pieces should become one');
  assert.deepEqual(Array.from(game.stat().tiers), [1]);
  assert.equal(game.stat().score, 5, 'award the tier-1 score exactly once');
}

test('contact during cooldown merges after expiry without a second collision start', () => {
  const host = createGame();
  contactPair(host);
  host.advance(20);
  assert.equal(host.game.stat().pieces, 2, 'respect the 500 ms birth cooldown');
  assert.equal(host.game.stat().score, 0);
  host.advance(580);
  assertMerged(host.game);
});

test('sleeping contacts are reconsidered when the cooldown expires', () => {
  const host = createGame();
  const pair = contactPair(host);
  host.advance();
  for (const body of pair) host.Matter.Sleeping.set(body, true);
  assert.equal(host.game.stat().sleep, 2);
  host.advance(90);
  assertMerged(host.game);
});

test('the browser frame loop also completes deferred merges', () => {
  const host = createGame();
  contactPair(host);
  for (let i = 0; i < 120; i++) host.frame();
  assertMerged(host.game);
});

test('separated pieces do not merge at expiry and can merge on later contact', () => {
  const host = createGame();
  const [a, b] = contactPair(host);
  host.advance();
  host.Matter.Body.setPosition(b, { x: 280, y: 300 });
  for (const body of [a, b]) host.Matter.Sleeping.set(body, true);
  host.advance(90);
  assert.equal(host.game.stat().pieces, 2);
  assert.equal(host.game.stat().score, 0, 'no merge across empty space');
  host.Matter.Body.setPosition(b, { x: a.position.x, y: a.position.y - 62 });
  for (const body of [a, b]) host.Matter.Sleeping.set(body, false);
  host.advance(90);
  assertMerged(host.game);
});

test('a removed contact partner cannot become a ghost merge', () => {
  const host = createGame();
  const [, b] = contactPair(host);
  host.advance();
  host.Matter.World.remove(host.game.world, b);
  host.advance(90);
  assert.equal(host.game.stat().pieces, 1);
  assert.equal(host.game.stat().score, 0);
});

test('three simultaneous contacts consume each piece at most once', () => {
  const host = createGame();
  const bodies = [140, 180, 220].map(x => host.game.mk(x, 550, 0));
  for (const body of bodies) body.readyAt = 0;
  host.Matter.World.add(host.game.world, bodies);
  host.advance();
  assert.equal(host.game.stat().pieces, 2);
  assert.equal(host.game.stat().score, 5);
  assert.deepEqual(Array.from(host.game.stat().tiers).sort(), [0, 1]);
});

test('compound collider contacts resolve to parent tiers and score once', () => {
  const host = createGame();
  const bodies = [host.game.mk(180, 500, 2), host.game.mk(180, 500, 2)];
  assert.ok(bodies.every(body => body.parts.length > 1));
  for (const body of bodies) body.readyAt = 0;
  host.Matter.World.add(host.game.world, bodies);
  host.advance();
  assert.equal(host.game.stat().pieces, 1);
  assert.deepEqual(Array.from(host.game.stat().tiers), [3]);
  assert.equal(host.game.stat().score, 20);
});

test('different tiers never merge', () => {
  const host = createGame();
  const bodies = [host.game.mk(180, 560, 0), host.game.mk(180, 489, 1)];
  host.Matter.World.add(host.game.world, bodies);
  host.advance(120);
  assert.equal(host.game.stat().pieces, 2);
  assert.equal(host.game.stat().score, 0);
});

test('terminal-tier contacts never produce a ninth tier', () => {
  const host = createGame();
  const top = host.game.TIERS.length - 1;
  host.Matter.World.add(host.game.world, [host.game.mk(140, 450, top), host.game.mk(220, 450, top)]);
  host.advance(120);
  assert.equal(host.game.stat().pieces, 2);
  assert.equal(host.game.stat().score, 0);
  assert.ok(Array.from(host.game.stat().tiers).every(tier => tier === top));
});

test('normal drops merge, save the best score, and reset only the current score', () => {
  const host = createGame();
  host.game.dropAt(180, 0);
  host.advance(180);
  host.game.dropAt(180, 0);
  host.advance(300);
  assertMerged(host.game);
  assert.equal(host.storage.get('nailong.best.v1'), '5');
  host.elements.get('btn-restart').dispatch('click');
  assert.equal(host.game.stat().pieces, 0);
  assert.equal(host.game.stat().score, 0);
  assert.equal(host.game.stat().best, 5);
  assert.equal(createGame({ storage: host.storage }).game.stat().best, 5);
});

test('reset clears pending contacts before a new game', () => {
  const host = createGame();
  contactPair(host);
  host.advance();
  host.game.reset();
  host.advance(120);
  assert.equal(host.game.stat().pieces, 0);
  assert.equal(host.game.stat().score, 0);
  assert.equal(host.game.stat().over, false);
});

test('unavailable localStorage does not interrupt play or scoring', () => {
  const host = createGame({ unavailableStorage: true });
  const pair = contactPair(host);
  for (const body of pair) body.readyAt = 0;
  host.advance(90);
  assertMerged(host.game);
  assert.equal(host.game.stat().best, 5);
});

test('frame and debug steps advance the same total physical time', () => {
  const browser = createGame(), debug = createGame();
  browser.frame(16);
  debug.advance(1, 16);
  assert.equal(browser.game.engine.timing.timestamp, 16);
  assert.equal(debug.game.engine.timing.timestamp, 16);
});
