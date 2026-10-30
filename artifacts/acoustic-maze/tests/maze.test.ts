import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consumeEvents, createGame, LEVELS, tickGame, TILE } from '../src/game/engine.ts';
import {
  advance, assertSafe, cellKey, cellOf, DIRECTIONS, DT, IDLE, isOpen,
  reachable, route, walkToExit, worldOf,
} from './simulation.ts';

test('the campaign contains exactly 15 ordered levels', () => {
  assert.deepEqual(LEVELS.map(l => l.id), Array.from({ length: 15 }, (_, i) => i + 1));
});

for (const level of LEVELS) {
  test(`level ${level.id}: deterministic layout, reachable exit, and a simulated win`, () => {
    const game = createGame(level.id);
    assert.deepEqual(game, createGame(level.id));
    const { queue } = reachable(game);
    assert.equal(queue.length, game.grid.flat().filter(v => v === 0).length);
    const path = route(game);
    assert.ok(path.length > 1);
    for (const h of game.hazards) {
      assert.ok(isOpen(game, cellOf(h)), 'hazard must be in a corridor');
      if (h.kind === 'spike') {
        assert.ok(!path.some(p => cellKey(p) === cellKey(cellOf(h))), 'spike blocks required solution');
      }
    }
    const hits = walkToExit(game);
    if (level.theme !== 'cyber') assert.equal(hits, 0, 'solution required a rescue');
    const finished = structuredClone(game);
    tickGame(game, { x: 1, z: 1, stealth: false }, DT);
    assert.deepEqual(game, finished, 'winning freezes the simulation');
  });

  if (level.theme === 'void') continue;
  test(`level ${level.id}: walls and diagonal corners cannot be crossed`, () => {
    const game = createGame(level.id);
    game.hazards = []; // Isolate geometry, not hazard knockback.
    game.exit = { x: -100, z: -100 }; // Keep victory from freezing geometry probes.
    const cells = reachable(game).queue;
    for (const p of cells) {
      for (const d of DIRECTIONS) {
        if (isOpen(game, { x: p.x + d.x, z: p.z + d.z })) continue;
        game.player = worldOf(p);
        for (let i = 0; i < 12; i++) {
          tickGame(game, { ...d, stealth: false }, 10); // Oversized frames must be clamped.
          assertSafe(game);
        }
        assert.equal(cellKey(cellOf(game.player)), cellKey(p), 'tunneled through a wall');
        const center = worldOf(p);
        const moved = Math.hypot(game.player.x - center.x, game.player.z - center.z);
        assert.ok(moved >= 0.7 && moved <= 0.95, 'wall probe must move up to, but not inside, the player-radius boundary');
      }
    }
    for (const input of [{ x: 1, z: 1 }, { x: -1, z: 1 }, { x: 1, z: -1 }, { x: -1, z: -1 }]) {
      game.player = worldOf({ x: 1, z: 1 });
      for (let i = 0; i < 100; i++) {
        tickGame(game, { ...input, stealth: false }, DT);
        assertSafe(game);
      }
    }
  });
}

test('void: repeated real 30-second shifts preserve routes from varied fractional positions', () => {
  // Room centers, connecting passages, dead ends and near-edge positions.
  const cells = reachable(createGame(15)).queue;
  const positions = [
    cells[0]!, cells[1]!, cells[Math.floor(cells.length / 2)]!,
    cells[cells.length - 2]!,
    ...cells.filter(p => DIRECTIONS.filter(d =>
      cells.some(q => q.x === p.x + d.x && q.z === p.z + d.z)).length === 1).slice(1, 3),
  ];
  for (const [index, p] of positions.entries()) {
    const game = createGame(15);
    game.player = worldOf(p);
    // In void mode ground safety uses tile ownership, including near an edge.
    game.player.x += index % 2 ? TILE * 0.49 : 0;
    game.player.z += index % 3 ? -TILE * 0.49 : 0;
    const exit = { ...game.exit };
    for (let phase = 1; phase <= 12; phase++) {
      const before = { ...game.player };
      const oldGrid = structuredClone(game.grid);
      // Advance the actual clock, don't call or duplicate the private shuffler.
      advance(game, game.shiftIn - 0.05);
      assert.equal(game.phase, phase - 1, 'shift happened early');
      advance(game, 0.1);
      assert.equal(game.phase, phase);
      assert.ok(Math.abs(game.shiftIn - 29.95) < 1e-6);
      assert.deepEqual(game.player, before, 'reshuffle teleported the player');
      assert.deepEqual(game.exit, exit, 'exit moved');
      assert.notDeepEqual(game.grid, oldGrid, 'reshuffle did not change paths');
      assert.deepEqual(game.walls, []);
      assertSafe(game);
      assert.equal(reachable(game).queue.length, game.grid.flat().filter(v => v === 0).length);
      route(game);
      assert.equal(consumeEvents(game).filter(e => e === 'shift').length, 1);
      assert.ok(game.pulses.length > 0, 'reshuffle must reveal safe footing');
      assert.ok(Math.abs(game.elapsed - (phase * 30 + 0.05)) < 1e-6);
    }
    // Confirm the preserved fractional position supports movement, not just BFS.
    assert.equal(walkToExit(game), 0);
  }
});

test('void: leaving a path rescues safely, including just after a reshuffle', () => {
  for (const shift of [false, true]) {
    const game = createGame(15);
    if (shift) advance(game, 30.05);
    const start = { ...game.player };
    consumeEvents(game);
    for (let i = 0; i < 10; i++) {
      tickGame(game, { x: -1, z: 0, stealth: false }, DT);
      assertSafe(game);
    }
    assert.ok(consumeEvents(game).includes('hazard'));
    assert.ok(Math.abs(game.player.x - start.x) < TILE / 2);
    route(game);
  }
});

test('void: every initial path tile survives reshuffles at early and late phases', () => {
  const cells = reachable(createGame(15)).queue;
  for (const phase of [0, 1, 2, 7, 19, 99]) {
    for (const cell of cells) {
      for (const offset of [-0.49, 0, 0.49]) {
        const game = createGame(15);
        game.phase = phase;
        game.elapsed = phase * 30 + 29.975;
        game.shiftIn = 0.025;
        game.player = worldOf(cell);
        game.player.x += TILE * offset;
        game.player.z -= TILE * offset;
        // Don't freeze at the goal before exercising the shift.
        if (Math.hypot(game.player.x - game.exit.x, game.player.z - game.exit.z) < 0.8) continue;
        const before = { ...game.player };
        tickGame(game, IDLE, DT);
        assert.equal(game.phase, phase + 1);
        assert.deepEqual(game.player, before);
        assertSafe(game);
        route(game);
      }
    }
  }
});
