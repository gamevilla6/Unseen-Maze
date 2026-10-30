import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  consumeEvents, createGame, emitPulse, getVisibility, isLaserActive, tickGame, TILE,
} from '../src/game/engine.ts';
import { advance, assertSafe, DIRECTIONS, DT, IDLE, isOpen, route, worldOf } from './simulation.ts';

test('cyber: every laser repeats its on/off cycle and permits a timed crossing', () => {
  const lasers = createGame(14).hazards.filter(h => h.kind === 'laser');
  assert.ok(lasers.length > 0);
  for (const laser of lasers) {
    const phaseOffset = laser.x * 0.13 + laser.z * 0.07;
    const base = 12 - phaseOffset;
    const game = createGame(14);
    for (const [offset, active] of [[0.001, true], [3.099, true], [3.101, false], [5.999, false], [6.001, true]] as const) {
      game.elapsed = base + offset;
      assert.equal(isLaserActive(game, laser), active, `laser phase ${offset}`);
      game.elapsed += 6;
      assert.equal(isLaserActive(game, laser), active, 'cycle must repeat');
    }
    const path = route(game, { x: Math.round(laser.x / TILE), z: Math.round(laser.z / TILE) });
    const from = worldOf(path[path.length - 2]!);
    const direction = { x: (laser.x - from.x) / TILE, z: (laser.z - from.z) / TILE, stealth: false };
    // Retain only this real gate so a drone or another gate cannot mask results.
    game.hazards = [{ ...laser }];
    game.player = { ...from };
    game.elapsed = base + 3.2;
    advance(game, 0.6, direction);
    const cell = { x: Math.round(laser.x / TILE), z: Math.round(laser.z / TILE) };
    const onward = DIRECTIONS.find(d =>
      isOpen(game, { x: cell.x + d.x, z: cell.z + d.z }) &&
      Math.hypot((cell.x + d.x) * TILE - from.x, (cell.z + d.z) * TILE - from.z) > 0.1);
    // A gate on a corner requires a turn; at a dead end, retreat.
    advance(game, 0.6, onward ? { ...onward, stealth: false } :
      { x: -direction.x, z: -direction.z, stealth: false });
    assertSafe(game);
    assert.ok(!consumeEvents(game).includes('hazard'), 'inactive gate hit player');
    assert.ok(Math.hypot(game.player.x - laser.x, game.player.z - laser.z) > 0.85);

    const blocked = createGame(14);
    blocked.hazards = [{ ...laser }];
    blocked.player = { ...from };
    blocked.elapsed = base + 0.1;
    tickGame(blocked, IDLE, DT); // Register an actual safe checkpoint.
    advance(blocked, 0.6, direction);
    assert.ok(consumeEvents(blocked).includes('hazard'), 'active gate failed to detect contact');
    assert.match(blocked.warning, /LASER CONTACT/);
    assertSafe(blocked);
  }
});

function manualRange(id: number) {
  const game = createGame(id);
  assert.ok(emitPulse(game));
  return game.pulses.at(-1)!.range;
}

test('water: running damps manual and footstep sonar; stealth and resting restore it', () => {
  const running = createGame(13);
  const quiet = createGame(13);
  // Use a known solution corridor in each state.
  const path = route(running);
  const from = worldOf(path[0]!);
  const to = worldOf(path[1]!);
  const input = { x: (to.x - from.x) / TILE, z: (to.z - from.z) / TILE, stealth: false };
  advance(running, 0.8, input);
  advance(quiet, 0.8, { ...input, stealth: true });
  assert.ok(running.steps > 0 && quiet.steps > 0);
  assert.ok(running.pulses.at(-1)!.range < quiet.pulses.at(-1)!.range);
  assert.ok(emitPulse(running) && emitPulse(quiet));
  assert.ok(Math.abs(running.pulses.at(-1)!.range - 4.8) < 1e-9);
  assert.equal(quiet.pulses.at(-1)!.range, 15);
  assert.match(running.warning, /WATER DISTURBED/);
  advance(running, 1.2, { ...input, stealth: true });
  assert.ok(emitPulse(running));
  assert.equal(running.pulses.at(-1)!.range, 15, 'stealth should restore range');
  advance(running, 0.8, input);
  advance(running, 1.2);
  assert.ok(emitPulse(running));
  assert.equal(running.pulses.at(-1)!.range, 15, 'rest should restore range');
});

test('crystal: both pulse types amplify, travel farther, linger longer, and expire', () => {
  assert.equal(manualRange(12), manualRange(1) * 1.7);
  const normal = createGame(1);
  const crystal = createGame(12);
  for (const game of [normal, crystal]) {
    assert.ok(emitPulse(game));
    advance(game, 2);
  }
  const x = normal.player.x + 20;
  assert.equal(getVisibility(normal, x, normal.player.z), 0);
  assert.ok(getVisibility(crystal, crystal.player.x + 20, crystal.player.z) > 0);
  assert.equal(getVisibility(normal, normal.player.x, normal.player.z), 0);
  assert.ok(getVisibility(crystal, crystal.player.x, crystal.player.z) > 0);
  advance(normal, 2.6);
  advance(crystal, 2.6);
  assert.equal(normal.pulses.length, 0);
  assert.equal(crystal.pulses.length, 1);
  advance(crystal, 2);
  assert.equal(crystal.pulses.length, 0);

  for (const game of [normal, crystal]) {
    const path = route(game);
    const to = worldOf(path[1]!);
    advance(game, 0.3, { x: (to.x - game.player.x) / TILE, z: (to.z - game.player.z) / TILE, stealth: false });
  }
  assert.equal(normal.pulses.at(-1)!.range, 8);
  assert.equal(crystal.pulses.at(-1)!.range, 8 * 1.7);
});

test('sonar: cooldown, energy costs, recharge and pulse limits are enforced', () => {
  const game = createGame(1);
  assert.ok(emitPulse(game));
  assert.equal(game.echo, 86);
  assert.equal(emitPulse(game), false);
  advance(game, 0.5);
  assert.ok(emitPulse(game));
  game.echo = 0;
  advance(game, 0.5);
  assert.equal(emitPulse(game), false);
  assert.match(game.warning, /SONAR RECHARGING/);
  advance(game, 2);
  assert.ok(emitPulse(game));
  for (let i = 0; i < 20; i++) {
    advance(game, 0.5);
    game.echo = 100;
    emitPulse(game);
    assert.ok(game.pulses.length <= 10);
  }
  advance(game, 12);
  assert.equal(game.echo, 100);
});
