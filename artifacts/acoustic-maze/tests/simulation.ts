import assert from 'node:assert/strict';
import {
  consumeEvents, isLaserActive, tickGame, TILE,
  type Cell, type GameState, type Input, type Vec2,
} from '../src/game/engine.ts';

export const DT = 1 / 20;
export const IDLE: Input = { x: 0, z: 0, stealth: false };
export const DIRECTIONS = [
  { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
];
export const cellKey = (p: Cell) => `${p.x},${p.z}`;
export const cellOf = (p: Vec2): Cell => ({ x: Math.round(p.x / TILE), z: Math.round(p.z / TILE) });
export const worldOf = (p: Cell): Vec2 => ({ x: p.x * TILE, z: p.z * TILE });
export const isOpen = (game: GameState, p: Cell) => game.grid[p.z]?.[p.x] === 0;

// Independent BFS oracle: never rely on the engine's generator or pathfinder.
export function reachable(game: GameState, from = cellOf(game.player)) {
  assert.ok(isOpen(game, from), `closed starting tile ${cellKey(from)}`);
  const queue = [from];
  const parents = new Map<string, Cell | null>([[cellKey(from), null]]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]!;
    for (const d of DIRECTIONS) {
      const next = { x: p.x + d.x, z: p.z + d.z };
      if (isOpen(game, next) && !parents.has(cellKey(next))) {
        parents.set(cellKey(next), p);
        queue.push(next);
      }
    }
  }
  return { queue, parents };
}

export function route(game: GameState, goal = cellOf(game.exit)): Cell[] {
  const { parents } = reachable(game);
  assert.ok(parents.has(cellKey(goal)), `level ${game.level.id}, phase ${game.phase}: unreachable goal`);
  const path: Cell[] = [];
  let p: Cell | null = goal;
  while (p) {
    path.push(p);
    p = parents.get(cellKey(p))!;
  }
  return path.reverse();
}

export function assertSafe(game: GameState) {
  assert.ok(Number.isFinite(game.player.x) && Number.isFinite(game.player.z));
  assert.ok(isOpen(game, cellOf(game.player)), `player on closed tile at ${JSON.stringify(game.player)}`);
  if (game.level.theme === 'void') return;
  // Check the full player footprint independently, including outside the grid.
  const c = cellOf(game.player);
  for (let z = c.z - 1; z <= c.z + 1; z++) {
    for (let x = c.x - 1; x <= c.x + 1; x++) {
      if (game.grid[z]?.[x] === 0) continue;
      assert.ok(
        Math.abs(game.player.x - x * TILE) >= TILE / 2 + 0.25 - 1e-9 ||
        Math.abs(game.player.z - z * TILE) >= TILE / 2 + 0.25 - 1e-9,
        `player overlaps wall ${x},${z}`,
      );
    }
  }
}

export function advance(game: GameState, seconds: number, input = IDLE) {
  for (let left = seconds; left > 1e-9; left -= DT) {
    tickGame(game, input, Math.min(DT, left));
  }
}

// A real movement controller, not a teleport. Replans if the void changes.
export function walkToExit(game: GameState, maxSeconds = 600) {
  let path = route(game);
  let waypoint = 1;
  let phase = game.phase;
  let hits = 0;
  for (let frame = 0; frame < maxSeconds / DT && !game.won; frame++) {
    if (phase !== game.phase) {
      path = route(game);
      waypoint = 0; // Recenter before following the new corridor.
      phase = game.phase;
    }
    const target = worldOf(path[Math.min(waypoint, path.length - 1)]!);
    const dx = target.x - game.player.x;
    const dz = target.z - game.player.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-7 && waypoint < path.length - 1) { waypoint++; continue; }
    const nearLasers = game.hazards.filter(h =>
      h.kind === 'laser' && Math.hypot(h.x - target.x, h.z - target.z) < 0.1);
    // Wait at the previous center until the entire crossing has an off window.
    const wait = distance > TILE - 0.01 && nearLasers.some(h =>
      Array.from({ length: 19 }, (_, i) => i * DT).some(offset =>
        isLaserActive({ ...game, elapsed: game.elapsed + offset }, h)));
    tickGame(game, wait ? IDLE : {
      x: distance ? dx / distance : 0,
      z: distance ? dz / distance : 0,
      stealth: false,
    }, Math.min(DT, distance / 4 || DT));
    assertSafe(game);
    const events = consumeEvents(game);
    if (events.includes('hazard')) {
      assert.match(game.warning, /DRONE CONTACT/, 'solution hit a spike, active laser, or unsafe void path');
      hits++;
      path = route(game);
      waypoint = 0;
    }
  }
  assert.ok(game.won, `level ${game.level.id}: no win after ${maxSeconds}s (${hits} contacts)`);
  assert.ok(Math.hypot(game.player.x - game.exit.x, game.player.z - game.exit.z) < 0.8);
  return hits;
}
