import assert from 'node:assert/strict';
import { LEVELS, createGame, emitPulse, getPathTiles, getVisibility, tickGame, type GameState } from './engine';
import { completeLevel, loadProgress, loadSettings, saveSettings } from './storage';

const still = { x: 0, z: 0, stealth: false };
function reachable(g: GameState) {
  const tile = g.level.corridorWidth;
  const start = { x: Math.round(g.player.x / tile), z: Math.round(g.player.z / tile) };
  const end = `${Math.round(g.exit.x / tile)},${Math.round(g.exit.z / tile)}`;
  const seen = new Set([`${start.x},${start.z}`]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = p.x + dx!, z = p.z + dz!;
      const k = `${x},${z}`;
      if (g.grid[z]?.[x] === 0 && !seen.has(k)) { seen.add(k); queue.push({ x, z }); }
    }
  }
  assert.ok(seen.has(end), `Level ${g.level.id} phase ${g.phase}: exit must be reachable`);
  return seen.size;
}

assert.equal(LEVELS.length, 99);
assert.equal(new Set(LEVELS.map(l => l.id)).size, 99);
assert.equal(new Set(LEVELS.map(l => JSON.stringify(createGame(l.id).grid))).size, 99, 'Every chamber has a distinct layout');
assert.deepEqual(
  ['easy', 'medium', 'hard', 'expert'].map(t => LEVELS.filter(l => l.tier === t).length),
  [33, 33, 24, 9],
);
for (let id = 1; id <= 99; id++) {
  const g = createGame(id);
  assert.equal(g.level.id, id);
  assert.ok(g.stepLimit > 0);
  assert.ok(reachable(g) > 1);
  assert.equal(getVisibility(g, g.player.x, g.player.z), 0, 'No ambient map visibility');
  assert.ok(g.hazards.every(h => g.grid[Math.round(h.z / g.level.corridorWidth)]?.[Math.round(h.x / g.level.corridorWidth)] === 0));
  if (id <= 33) {
    assert.equal(g.level.theme, 'standard');
    assert.ok(g.hazards.some(h => h.kind === 'obstacle'));
    assert.ok(g.hazards.every(h => h.kind === 'obstacle'));
  } else if (id <= 66) {
    assert.ok(['vault', 'crystal'].includes(g.level.theme));
  } else if (id <= 90) {
    assert.ok(['water', 'cyber'].includes(g.level.theme));
  } else {
    assert.equal(g.level.theme, 'void');
    assert.equal(g.walls.length, 0);
    for (let phase = 0; phase < 5; phase++) {
      // Exercise reshuffles from several actual safe floor positions.
      const tiles = getPathTiles(g);
      g.player = { ...tiles[(id + phase * 7) % tiles.length]! };
      g.shiftIn = 0.01;
      tickGame(g, still, 0.02);
      assert.equal(g.phase, phase + 1);
      reachable(g);
    }
  }
}

const easy = createGame(1);
const obstacleZ = easy.hazards[0]!.z;
for (let i = 0; i < 20; i++) tickGame(easy, still, 0.05);
assert.notEqual(easy.hazards[0]!.z, obstacleZ, 'Easy stones move slowly');
assert.ok(easy.level.corridorWidth > createGame(34).level.corridorWidth);

const crystal = createGame(35);
assert.ok(emitPulse(crystal));
assert.equal(crystal.echo, 86);
assert.ok(crystal.pulses.some(p => p.reflected), 'Crystal facets emit delayed secondary echoes');
assert.ok(crystal.pulses[0]!.range > createGame(1).level.corridorWidth * 5);
assert.equal(emitPulse(crystal), false, 'Debounce repeated pulses');

const water = createGame(67);
// Find an unobstructed starting direction and disturb the water by running.
const tile = water.level.corridorWidth;
const direction = water.grid[1]?.[2] === 0 ? { x: 1, z: 0, stealth: false } : { x: 0, z: 1, stealth: false };
for (let i = 0; i < 20; i++) tickGame(water, direction, 0.05);
emitPulse(water);
const dampened = water.pulses.find(p => p.range < 10);
assert.ok(dampened, 'Fast steps dampen water sonar');
for (let i = 0; i < 30; i++) tickGame(water, { ...still, stealth: true }, 0.05);
water.echo = 100;
assert.ok(emitPulse(water));
assert.ok(water.pulses.at(-1)!.range > dampened.range, 'Quiet movement restores sonar range');
assert.equal(tile, 2.2);

const voidClock = createGame(91);
for (let i = 0; i < 599; i++) tickGame(voidClock, still, 0.05);
assert.equal(voidClock.phase, 0);
tickGame(voidClock, still, 0.05);
tickGame(voidClock, still, 0.001); // absorb floating-point timer rounding
assert.equal(voidClock.phase, 1, 'Void paths shift every 30 seconds');

const failed = createGame(1);
failed.steps = failed.stepLimit;
tickGame(failed, still, 0.01);
assert.equal(failed.failed, true);
assert.equal(failed.won, false);
assert.equal(emitPulse(failed), false);
const winner = createGame(99);
winner.player = { ...winner.exit };
tickGame(winner, still, 0.01);
assert.equal(winner.won, true);

const saved = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) },
});
saved.set('acoustic-maze.progress', JSON.stringify({ unlocked: 15, completed: { 15: { steps: 100, seconds: 60, echoes: 9 } } }));
assert.equal(loadProgress().unlocked, 16, 'Former campaign completion unlocks the continuation');
assert.equal(loadProgress().completed['15']?.steps, 100);
saved.clear();
for (let id = 1; id <= 99; id++) {
  const p = completeLevel(id, 100 + id, 40, 5);
  assert.equal(p.unlocked, Math.min(99, id + 1));
  assert.equal(Object.keys(p.completed).length, id);
}
assert.equal(completeLevel(100, 1, 1, 1).completed['100'], undefined);
assert.equal(loadProgress().unlocked, 99);
const settings = { ...loadSettings(), intensity: 1.4 };
saveSettings(settings);
assert.equal(loadSettings().intensity, 1.4);
console.log('99-level campaign checks passed: tiers, all exits, 45 void reshuffles, 30-second timing, obstacles, refraction, water damping, failure, final win, migration and unlocks.');
