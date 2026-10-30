import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TouchNavigation } from '../src/game/touch-input.ts';

test('desktop mouse and stylus cannot move or trigger sonar', () => {
  const input = new TouchNavigation();
  for (const kind of ['mouse', 'pen']) {
    assert.equal(input.begin(1, kind, 100, 100, 0, 360), false);
    input.move(1, 200, 100);
    assert.deepEqual(input.vector, { x: 0, z: 0, stealth: false });
    assert.equal(input.end(1, 100), false);
  }
});

test('short stationary touch produces one echo without movement', () => {
  const input = new TouchNavigation();
  input.begin(1, 'touch', 100, 200, 0, 360);
  input.move(1, 104, 204);
  assert.equal(input.vector.x, 0);
  assert.equal(input.end(1, 100), true);
  assert.equal(input.end(1, 101), false);
  assert.deepEqual(input.vector, { x: 0, z: 0, stealth: false });
});

test('small swipes provide proportional stealth; long swipes run', () => {
  const input = new TouchNavigation();
  input.begin(1, 'touch', 100, 200, 0, 360);
  input.move(1, 122, 200);
  assert.ok(input.vector.x > 0 && input.vector.x < 0.5);
  assert.equal(input.vector.stealth, true);
  input.move(1, 200, 200);
  assert.equal(input.vector.x, 1);
  assert.equal(input.vector.stealth, false);
  assert.equal(input.end(1, 200), false, 'swiping must not emit a release echo');
  assert.equal(input.vector.x, 0);
});

test('direction changes and diagonals stay normalized in all orientations', () => {
  for (const width of [320, 360, 800, 1280]) {
    const input = new TouchNavigation();
    input.begin(1, 'touch', 100, 200, 0, width);
    input.move(1, 100, 100);
    assert.equal(input.vector.x, 0);
    assert.equal(input.vector.z, -1);
    input.move(1, 0, 300);
    assert.ok(input.vector.x < 0 && input.vector.z > 0);
    assert.ok(Math.hypot(input.vector.x, input.vector.z) <= 1.00001);
    input.reset();
    assert.deepEqual(input.vector, { x: 0, z: 0, stealth: false });
  }
});

test('second-finger echo does not interrupt a held movement swipe', () => {
  const input = new TouchNavigation();
  input.begin(1, 'touch', 50, 200, 0, 360);
  input.move(1, 140, 200);
  input.begin(2, 'touch', 250, 200, 40, 360);
  assert.equal(input.end(2, 100), true);
  assert.equal(input.vector.x, 1);
  assert.equal(input.end(1, 400), false);
  assert.equal(input.vector.x, 0);
});

test('cancel, interruption, long hold, and return-to-origin are never mistaken for taps', () => {
  const input = new TouchNavigation();
  input.begin(1, 'touch', 100, 200, 0, 360);
  assert.equal(input.end(1, 100, true), false);
  input.begin(2, 'touch', 100, 200, 0, 360);
  assert.equal(input.end(2, 500), false);
  input.begin(3, 'touch', 100, 200, 0, 360);
  input.move(3, 200, 200); input.move(3, 100, 200);
  assert.equal(input.end(3, 200), false);
  input.begin(4, 'touch', 100, 200, 0, 360);
  input.move(4, 200, 200);
  input.reset();
  assert.equal(input.end(4, 250), false);
  assert.deepEqual(input.ids, []);
  assert.equal(input.gesture.active, false);
});
