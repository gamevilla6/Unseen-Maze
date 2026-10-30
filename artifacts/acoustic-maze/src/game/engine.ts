/** Deterministic, renderer-independent simulation. All distances are world units. */
export type Vec2 = { x: number; z: number };
export type Cell = Vec2;
export type LevelDef = {
  id: number;
  name: string;
  subtitle: string;
  description: string;
  size: number;
  theme: 'standard' | 'vault' | 'crystal' | 'water' | 'cyber' | 'void';
  difficulty: string;
};
export type Wall = { x: number; z: number; w: number; d: number };
export type Hazard = { x: number; z: number; kind: 'spike' | 'laser' | 'drone' };
export type Pulse = { id: number; x: number; z: number; age: number; range: number };
export type GameEvent = 'step' | 'sonar' | 'hazard' | 'win' | 'shift';
export type Input = { x: number; z: number; stealth: boolean };
export type GameState = {
  level: LevelDef;
  grid: number[][];
  walls: Wall[];
  hazards: Hazard[];
  player: Vec2;
  exit: Vec2;
  pulses: Pulse[];
  steps: number;
  echo: number;
  elapsed: number;
  won: boolean;
  warning: string;
  warningTime: number;
  heading: number;
  shiftIn: number;
  phase: number;
  explored: Set<string>;
  visited: Set<string>;
};

const TITLES = [
  ['The First Echo', 'Learn to listen', 'Every sound draws a fleeting map. Follow the exit signal through your first darkness.'],
  ['Silent Passage', 'Trust the silence', 'Longer passages hide beyond the reach of a single echo.'],
  ['Resonance Chamber', 'Sound leaves a trace', 'Listen for sharp reflections around branching corners.'],
  ['The Hollow', 'Nothing is as it seems', 'Dead ends return your own footsteps. Learn when to turn back.'],
  ['Echoes Below', 'Descend into darkness', 'Hidden spikes occupy forgotten passages. Watch for the red warning.'],
  ['Blind Corners', 'A different perspective', 'A winding labyrinth rewards measured steps and deliberate pulses.'],
  ['The Forgotten Wing', 'A place out of time', 'Abandoned corridors weave through a maze of fading memories.'],
  ['Fractured Silence', 'Find the frequency', 'Your sonar is the only light. Allow it to recharge before the next crossing.'],
  ['Deep Signal', 'Listen a little closer', 'The exit is distant, but its direction never disappears.'],
  ['The Threshold', 'Beyond the familiar', 'A final conventional labyrinth prepares you for stranger acoustics.'],
] as const;

export const LEVELS: LevelDef[] = [
  ...TITLES.map(([name, subtitle, description], i): LevelDef => ({
    id: i + 1, name, subtitle, description,
    size: 3 + Math.floor((i + 1) / 2),
    theme: 'standard',
    difficulty: i < 3 ? 'Initiate' : i < 7 ? 'Explorer' : 'Challenging',
  })),
  { id: 11, name: 'The Subterranean Vault', subtitle: 'Concrete remembers', description: 'Heavy concrete, tight right-angle corners and sharp, short-lived reflections. Echoes fade quickly inside this bunker.', size: 8, theme: 'vault', difficulty: 'Advanced' },
  { id: 12, name: 'The Crystal Cavern', subtitle: 'Refractive echoes', description: 'Crystalline formations amplify and extend your sonar. Each pulse travels farther and leaves a longer luminous trace.', size: 9, theme: 'crystal', difficulty: 'Advanced' },
  { id: 13, name: 'The Sunken Catacombs', subtitle: 'Tread softly', description: 'Running stirs the water and dampens sonar. Hold Shift or use the stealth control to move quietly and preserve your echo range.', size: 9, theme: 'water', difficulty: 'Expert' },
  { id: 14, name: 'The Neon Cyber-Corridor', subtitle: 'You are not alone', description: 'Laser grids cycle on and off. Security drones hear manual sonar and move toward its source. Time your crossings.', size: 9, theme: 'cyber', difficulty: 'Expert' },
  { id: 15, name: 'The Void Labyrinth', subtitle: 'The darkness moves', description: 'There are no walls. Invisible gravitational paths hover in space and rearrange every 30 seconds. An echo reveals safe footing.', size: 9, theme: 'void', difficulty: 'Transcendent' },
];

export const TILE = 2.4;
const RADIUS = 0.25;
const MAX_PULSES = 10;
type Internals = {
  events: GameEvent[];
  stepDistance: number;
  pulseId: number;
  hazardCooldown: number;
  lastSafe: Vec2;
  agitation: number;
  droneTarget: Vec2 | null;
  droneAlert: number;
  pulseCooldown: number;
};
const internal = new WeakMap<GameState, Internals>();
const key = (x: number, z: number) => `${x},${z}`;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const toCell = (v: Vec2) => ({ x: Math.round(v.x / TILE), z: Math.round(v.z / TILE) });
const toWorld = (v: Vec2) => ({ x: v.x * TILE, z: v.z * TILE });
const DIRS = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];

function random(seed: number) {
  let n = seed >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}

function generate(size: number, seed: number): number[][] {
  const n = size * 2 + 1;
  const grid = Array.from({ length: n }, () => Array<number>(n).fill(1));
  const rng = random(seed);
  const stack: Vec2[] = [{ x: 1, z: 1 }];
  grid[1]![1] = 0;
  while (stack.length) {
    const p = stack[stack.length - 1]!;
    const options = DIRS.map(d => ({ x: p.x + d.x * 2, z: p.z + d.z * 2 }))
      .filter(q => q.x > 0 && q.z > 0 && q.x < n - 1 && q.z < n - 1 && grid[q.z]![q.x] === 1);
    if (!options.length) { stack.pop(); continue; }
    const next = options[Math.floor(rng() * options.length)]!;
    grid[(p.z + next.z) / 2]![(p.x + next.x) / 2] = 0;
    grid[next.z]![next.x] = 0;
    stack.push(next);
  }
  return grid;
}

function open(grid: number[][], x: number, z: number) {
  return grid[z]?.[x] === 0;
}

function flood(grid: number[][], start: Cell) {
  const queue = [start];
  const parents = new Map<string, Cell | null>([[key(start.x, start.z), null]]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]!;
    for (const d of DIRS) {
      const q = { x: p.x + d.x, z: p.z + d.z };
      const k = key(q.x, q.z);
      if (open(grid, q.x, q.z) && !parents.has(k)) {
        parents.set(k, p);
        queue.push(q);
      }
    }
  }
  return { queue, parents };
}

function wallsFor(grid: number[][]): Wall[] {
  // Individual cells preserve accurate wavefront arrival at each wall segment.
  const walls: Wall[] = [];
  grid.forEach((row, z) => row.forEach((v, x) => {
    if (v) walls.push({ x: x * TILE, z: z * TILE, w: TILE, d: TILE });
  }));
  return walls;
}

export function createGame(id: number): GameState {
  const level = LEVELS[Math.max(0, Math.min(14, Math.floor(id) - 1))]!;
  const grid = generate(level.size, level.id * 8191 + 41);
  const { queue, parents } = flood(grid, { x: 1, z: 1 });
  const end = queue[queue.length - 1]!;
  const solution = new Set<string>();
  let p: Cell | null | undefined = end;
  while (p) { solution.add(key(p.x, p.z)); p = parents.get(key(p.x, p.z)); }
  const rng = random(id * 333);
  const candidates = queue.filter(q => !solution.has(key(q.x, q.z)) && q.x + q.z > 5);
  const hazards: Hazard[] = [];
  if (id >= 5 && level.theme !== 'void') {
    for (const q of candidates) {
      if (rng() < 0.09 && hazards.length < 3 + Math.floor(id / 2)) {
        hazards.push({ ...toWorld(q), kind: 'spike' });
      }
    }
  }
  if (level.theme === 'cyber') {
    // Gates on traversable passages are timed, never permanent obstacles.
    queue.filter(q => q.x + q.z > 6 && (q.x + q.z) % 7 === 0)
      .slice(0, 5).forEach(q => hazards.push({ ...toWorld(q), kind: 'laser' }));
    const q = queue[Math.floor(queue.length * 0.65)]!;
    hazards.push({ ...toWorld(q), kind: 'drone' });
  }
  const state: GameState = {
    level, grid, walls: level.theme === 'void' ? [] : wallsFor(grid), hazards,
    player: toWorld({ x: 1, z: 1 }), exit: toWorld(end),
    pulses: [], steps: 0, echo: 100, elapsed: 0, won: false,
    warning: '', warningTime: 0, heading: 0, shiftIn: 30, phase: 0,
    explored: new Set(), visited: new Set([key(1, 1)]),
  };
  internal.set(state, {
    events: [], stepDistance: 0, pulseId: 0, hazardCooldown: 0,
    lastSafe: { ...state.player }, agitation: 0, droneTarget: null,
    droneAlert: 0, pulseCooldown: 0,
  });
  return state;
}

function addPulse(state: GameState, manual: boolean) {
  const m = internal.get(state)!;
  let range = manual ? 15 : 8;
  if (state.level.theme === 'crystal') range *= 1.7;
  if (state.level.theme === 'vault') range *= 0.8;
  if (state.level.theme === 'water') range *= 1 - m.agitation * 0.68;
  state.pulses.push({ id: ++m.pulseId, ...state.player, age: 0, range });
  if (state.pulses.length > MAX_PULSES) state.pulses.shift();
}

export function emitPulse(state: GameState): boolean {
  const m = internal.get(state);
  if (!m || state.won || m.pulseCooldown > 0) return false;
  if (state.echo < 14) {
    warn(state, 'SONAR RECHARGING — listen to your footsteps', 1.5);
    return false;
  }
  state.echo = Math.max(0, state.echo - 14);
  m.pulseCooldown = 0.4;
  addPulse(state, true);
  m.events.push('sonar');
  if (state.level.theme === 'cyber') {
    m.droneTarget = { ...state.player };
    m.droneAlert = 7;
    warn(state, 'SIGNAL DETECTED — drone investigating', 2.5);
  }
  return true;
}

function warn(state: GameState, message: string, duration = 1.3) {
  state.warning = message;
  state.warningTime = duration;
}

function collides(state: GameState, point: Vec2): boolean {
  const c = toCell(point);
  // The void has no walls: unsafe ground is handled as a fall, not a collision.
  if (state.level.theme === 'void') return false;
  for (let z = c.z - 1; z <= c.z + 1; z++) {
    for (let x = c.x - 1; x <= c.x + 1; x++) {
      if (open(state.grid, x, z)) continue;
      if (Math.abs(point.x - x * TILE) < TILE / 2 + RADIUS &&
          Math.abs(point.z - z * TILE) < TILE / 2 + RADIUS) return true;
    }
  }
  return false;
}

function hit(state: GameState, message: string) {
  const m = internal.get(state)!;
  if (m.hazardCooldown > 0) return;
  m.hazardCooldown = 2;
  m.events.push('hazard');
  warn(state, message, 2);
  state.echo = Math.max(0, state.echo - 12);
  state.player = { ...m.lastSafe };
  // Free rescue echo never leaves a player stranded without a visible safe route.
  addPulse(state, true);
}

function shiftVoid(state: GameState) {
  const next = generate(state.level.size, state.level.id * 8191 + 41 + state.phase * 97);
  const c = toCell(state.player);
  // A safe island at the current position and an L bridge to the original start
  // keep every reshuffle solvable, without teleporting the player.
  const safeX = Math.max(1, Math.min(next.length - 2, c.x));
  const safeZ = Math.max(1, Math.min(next.length - 2, c.z));
  for (let x = 1; x <= safeX; x++) next[safeZ]![x] = 0;
  for (let z = 1; z <= safeZ; z++) next[z]![1] = 0;
  // Preserve the exit's bridge too: the goal never disappears.
  const end = toCell(state.exit);
  for (let x = 1; x <= end.x; x++) next[end.z]![x] = 0;
  for (let z = 1; z <= end.z; z++) next[z]![1] = 0;
  state.grid = next;
  state.explored.clear();
  const m = internal.get(state)!;
  m.lastSafe = { ...state.player };
  m.events.push('shift');
  warn(state, 'GRAVITATIONAL SHIFT — map the new paths', 3);
  addPulse(state, true);
}

export function isLaserActive(state: GameState, hazard: Hazard) {
  return ((state.elapsed + hazard.x * 0.13 + hazard.z * 0.07) % 6) < 3.1;
}

export function tickGame(state: GameState, input: Input, delta: number): void {
  const m = internal.get(state);
  if (!m || state.won) return;
  const dt = Math.min(0.05, Math.max(0, delta));
  state.elapsed += dt;
  state.warningTime = Math.max(0, state.warningTime - dt);
  if (state.warningTime === 0) state.warning = '';
  state.echo = Math.min(100, state.echo + dt * 9);
  m.pulseCooldown = Math.max(0, m.pulseCooldown - dt);
  m.hazardCooldown = Math.max(0, m.hazardCooldown - dt);
  m.droneAlert = Math.max(0, m.droneAlert - dt);
  for (const pulse of state.pulses) pulse.age += dt;
  state.pulses = state.pulses.filter(p => p.age < (state.level.theme === 'crystal' ? 6.5 : 4.5));

  const length = Math.hypot(input.x, input.z);
  const moving = length > 0.05;
  m.agitation = Math.max(0, Math.min(1, m.agitation + dt * (moving && !input.stealth ? 1.4 : -0.9)));
  if (moving) {
    const speed = input.stealth ? 1.8 : 4;
    const dx = input.x / Math.max(1, length) * speed * dt;
    const dz = input.z / Math.max(1, length) * speed * dt;
    const before = { ...state.player };
    const nextX = { x: state.player.x + dx, z: state.player.z };
    if (!collides(state, nextX)) state.player.x = nextX.x;
    const nextZ = { x: state.player.x, z: state.player.z + dz };
    if (!collides(state, nextZ)) state.player.z = nextZ.z;
    state.heading = Math.atan2(input.x, -input.z);
    const moved = dist(before, state.player);
    m.stepDistance += moved;
    if (m.stepDistance >= 1.05) {
      m.stepDistance -= 1.05;
      state.steps++;
      m.events.push('step');
      addPulse(state, false);
      if (state.level.theme === 'water' && m.agitation > 0.55) {
        warn(state, 'WATER DISTURBED — hold Shift to move quietly', 1.3);
      }
    }
    if (moved < 0.005 && state.warningTime === 0) warn(state, 'WALL DETECTED — try another direction', 0.7);
  }

  const cell = toCell(state.player);
  state.visited.add(key(cell.x, cell.z));
  const center = toWorld(cell);
  if (state.level.theme === 'void' && !open(state.grid, cell.x, cell.z)) {
    hit(state, 'PATH LOST — returned to stable ground');
    state.player = { ...m.lastSafe };
  } else if (dist(center, state.player) < 0.25 &&
             !state.hazards.some(h => dist(h, center) < TILE * 0.8)) {
    m.lastSafe = { ...center };
  }

  let nearbyHazard = false;
  for (const hazard of state.hazards) {
    if (hazard.kind === 'drone') {
      const target = m.droneAlert > 0 && m.droneTarget ? m.droneTarget : state.exit;
      // Drones stay inside corridors using the same grid pathfinding as the maze.
      const hc = toCell(hazard);
      const tc = toCell(target);
      const { parents } = flood(state.grid, tc);
      const next = parents.get(key(hc.x, hc.z));
      const goal = next ? toWorld(next) : target;
      const d = dist(hazard, goal);
      if (d > 0.1) {
        const speed = m.droneAlert > 0 ? 2.4 : 0.8;
        const fraction = Math.min(1, speed * dt / d);
        const nx = { x: hazard.x + (goal.x - hazard.x) * fraction, z: hazard.z };
        if (!collides(state, nx)) hazard.x = nx.x;
        const nz = { x: hazard.x, z: hazard.z + (goal.z - hazard.z) * fraction };
        if (!collides(state, nz)) hazard.z = nz.z;
      }
    }
    if (hazard.kind === 'laser' && !isLaserActive(state, hazard)) continue;
    const distance = dist(hazard, state.player);
    if (distance < 3.1) nearbyHazard = true;
    if (distance < (hazard.kind === 'laser' ? 0.85 : 0.6)) {
      hit(state, hazard.kind === 'drone' ? 'DRONE CONTACT — signal disrupted' :
        hazard.kind === 'laser' ? 'LASER CONTACT — wait for the grid to clear' : 'SPIKE TRAP — returned to safe ground');
    }
  }
  if (nearbyHazard && state.warningTime < 0.3) {
    warn(state, 'HAZARD NEARBY — proceed with caution', 0.6);
  } else if (moving && state.warningTime === 0 && dist(state.player, state.exit) > TILE &&
      dist(state.player, toWorld({ x: 1, z: 1 })) > TILE * 2) {
    const neighbors = DIRS.filter(d => open(state.grid, cell.x + d.x, cell.z + d.z)).length;
    if (neighbors === 1) warn(state, 'DEAD END — retrace your steps', 1);
  }

  if (state.level.theme === 'void') {
    state.shiftIn -= dt;
    if (state.shiftIn <= 0) {
      state.shiftIn += 30;
      state.phase++;
      shiftVoid(state);
    }
  }

  // Discovery follows the expanding wave, rather than revealing the entire map
  // instantly. Only scan near the player to keep per-frame work bounded.
  for (let z = Math.max(0, cell.z - 12); z < Math.min(state.grid.length, cell.z + 13); z++) {
    for (let x = Math.max(0, cell.x - 12); x < Math.min(state.grid.length, cell.x + 13); x++) {
      if (open(state.grid, x, z) && getVisibility(state, x * TILE, z * TILE) > 0.2) {
        state.explored.add(key(x, z));
      }
    }
  }
  if (dist(state.player, state.exit) < 0.8) {
    state.won = true;
    m.events.push('win');
    warn(state, 'EXIT FOUND', 10);
  }
}

export function getVisibility(state: GameState, x: number, z: number): number {
  let strength = 0;
  const crystal = state.level.theme === 'crystal';
  const linger = crystal ? 3 : state.level.theme === 'vault' ? 0.95 : 1.8;
  for (const p of state.pulses) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.range) continue;
    const arrival = d / 10;
    const since = p.age - arrival;
    if (since < -0.08 || since > linger) continue;
    const fade = since < 0.1 ? 1 : Math.pow(Math.max(0, 1 - since / linger), 1.6);
    strength = Math.max(strength, fade * (1 - d / (p.range * 1.6)));
  }
  return Math.min(1, strength);
}

export function getGuidance(state: GameState): string {
  const dx = state.exit.x - state.player.x;
  const dz = state.exit.z - state.player.z;
  const distance = Math.hypot(dx, dz);
  if (distance < TILE) return 'EXIT SIGNAL — within reach';
  const north = dz < -TILE ? 'N' : dz > TILE ? 'S' : '';
  const east = dx > TILE ? 'E' : dx < -TILE ? 'W' : '';
  return `${north}${east || (!north ? 'N' : '')} · ${Math.ceil(distance)}m to exit signal`;
}

export function getPathTiles(state: GameState): Vec2[] {
  const tiles: Vec2[] = [];
  state.grid.forEach((row, z) => row.forEach((v, x) => {
    if (!v) tiles.push({ x: x * TILE, z: z * TILE });
  }));
  return tiles;
}

export function consumeEvents(state: GameState): GameEvent[] {
  const m = internal.get(state);
  if (!m) return [];
  return m.events.splice(0);
}
