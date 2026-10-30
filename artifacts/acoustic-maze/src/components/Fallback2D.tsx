import { Component, useEffect, useMemo, useRef, type ReactNode, type MutableRefObject } from 'react';
import {
  consumeEvents, createGame, emitPulse, getGuidance, getPathTiles, getVisibility,
  isLaserActive, tickGame, type Input,
} from '../game/engine';
import { audio } from '../game/audio';
import type { Settings } from '../game/storage';
import { SIGNAL_HEX } from '../i18n';
import type { HudData } from './GameScene';

/* ---------- capability probe: runs once per page load ---------- */
let probed: boolean | null = null;
export function hasWebGL2(): boolean {
  if (probed !== null) return probed;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    probed = !!gl;
    if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    probed = false;
  }
  return probed;
}
export function markWebGLFailed() { probed = false; }

/* ---------- scoped boundary: a 3D failure swaps to 2D instead of killing the app ---------- */
export class SceneBoundary extends Component<{ fallback: ReactNode; onFail?: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { markWebGLFailed(); this.props.onFail?.(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function useCanvasLoop(draw: (ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, t: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw); drawRef.current = draw;
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRef.current(ctx, w, h, dt, now / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return ref;
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/* ---------- decorative menu maze ---------- */
export function MenuMaze2D({ color, intensity }: { color: string; intensity: number }) {
  const walls = useMemo(() => {
    const n = 23; let s = 917;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const g = Array.from({ length: n }, () => Array(n).fill(1));
    const st: [number, number][] = [[1, 1]]; g[1][1] = 0;
    while (st.length) {
      const [x, z] = st[st.length - 1];
      const d = [[2, 0], [-2, 0], [0, 2], [0, -2]].filter(([a, b]) => x + a > 0 && z + b > 0 && x + a < n - 1 && z + b < n - 1 && g[z + b][x + a]);
      if (!d.length) { st.pop(); continue; }
      const [a, b] = d[Math.floor(rnd() * d.length)];
      g[z + b / 2][x + a / 2] = 0; g[z + b][x + a] = 0; st.push([x + a, z + b]);
    }
    const out: { x: number; z: number }[] = [];
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) if (g[z][x] && Math.hypot(x - 11, z - 11) > 1.5) out.push({ x: x - 11, z: z - 11 });
    return out;
  }, []);
  const ref = useCanvasLoop((ctx, w, h, _dt, t) => {
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h);
    const u = Math.max(w, h) / 26;
    const cx = w * 0.62, cy = h * 0.5, period = 2.6;
    const fronts = [0, 1].map((k) => ((t + k * period / 2) % period) * 9 / 1.2);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.03);
    walls.forEach((wl, i) => {
      const d = Math.hypot(wl.x, wl.z); let v = 0;
      for (const f of fronts) { const dl = f - d; if (dl > 0) v = Math.max(v, Math.exp(-dl * 0.55) * Math.max(0, 1 - f / 20)); }
      if (v < 0.01) return;
      const c = i % 29 === 0 ? '#ff3b55' : color;
      ctx.fillStyle = rgba(c, v * intensity * 0.22);
      ctx.strokeStyle = rgba(c, v * intensity);
      ctx.fillRect(wl.x * u - u / 2, wl.z * u - u / 2, u, u);
      ctx.strokeRect(wl.x * u - u / 2 + 0.5, wl.z * u - u / 2 + 0.5, u - 1, u - 1);
    });
    fronts.forEach((f) => {
      ctx.beginPath(); ctx.arc(0, 0, f * u, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(color, Math.max(0, 1 - f / 20) * 0.8); ctx.lineWidth = 1.5; ctx.stroke();
    });
    ctx.strokeStyle = '#eef4ff'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, u * 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  });
  return <canvas ref={ref} className="h-full w-full" aria-hidden />;
}

/* ---------- playable 2D compatibility gameplay ---------- */
type GameProps = {
  levelId: number; runKey: number; paused: boolean; settings: Settings;
  inputRef: MutableRefObject<Input>; sonarReq: MutableRefObject<boolean>;
  onHud: (h: HudData) => void; onWin: (r: { steps: number; seconds: number; echoes: number }) => void;
  label: string;
};

export function Game2D({ levelId, runKey, paused, settings, inputRef, sonarReq, onHud, onWin, label }: GameProps) {
  const game = useMemo(() => createGame(levelId), [levelId, runKey]);
  const live = useRef({ paused, settings, onHud, onWin });
  live.current = { paused, settings, onHud, onWin };
  const st = useRef({ echoes: 0, reported: false, hudT: 0, cam: { x: game.player.x, z: game.player.z }, phase: -1, tiles: [] as { x: number; z: number }[] });
  useEffect(() => {
    st.current = { echoes: 0, reported: false, hudT: 0, cam: { x: game.player.x, z: game.player.z }, phase: -1, tiles: [] };
    audio.setTheme(game.level.theme);
  }, [game]);

  const ref = useCanvasLoop((ctx, w, h, dt, t) => {
    const g = game; const L = live.current; const s = st.current;
    const sig = SIGNAL_HEX[L.settings.color]; const red = '#ff3b55'; const k = L.settings.intensity;
    if (!L.paused && !g.won && !g.failed) {
      if (sonarReq.current) { sonarReq.current = false; if (emitPulse(g)) { s.echoes++; audio.play('sonar'); } }
      tickGame(g, inputRef.current, dt);
      for (const e of consumeEvents(g)) if (e !== 'sonar') audio.play(e);
    } else sonarReq.current = false;
    if (g.won && !s.reported) { s.reported = true; L.onWin({ steps: g.steps, seconds: g.elapsed, echoes: s.echoes }); }

    const CW = g.level.corridorWidth;
    const u = Math.min(w, h) / (w < h ? 9 : 11) / 2.4;
    s.cam.x += (g.player.x - s.cam.x) * Math.min(1, dt * 8);
    s.cam.z += (g.player.z - s.cam.z) * Math.min(1, dt * 8);
    const X = (x: number) => w / 2 + (x - s.cam.x) * u;
    const Y = (z: number) => h / 2 + (z - s.cam.z) * u;
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h);

    if (g.level.theme === 'void') {
      if (s.phase !== g.phase) { s.phase = g.phase; s.tiles = getPathTiles(g); }
      for (const p of s.tiles) {
        const v = getVisibility(g, p.x, p.z) * k; if (v < 0.01) continue;
        const z = CW * 0.82 * u;
        ctx.fillStyle = rgba(sig, v * 0.35); ctx.fillRect(X(p.x) - z / 2, Y(p.z) - z / 2, z, z);
      }
    }
    const thick = g.level.theme === 'vault' ? 1.12 : 1;
    g.walls.forEach((wl, i) => {
      const v = Math.min(1, getVisibility(g, wl.x, wl.z)) * k; if (v < 0.01) return;
      const c = g.level.theme === 'cyber' && i % 5 === 0 ? red : sig;
      const ww = wl.w * thick * u, dd = wl.d * thick * u;
      ctx.fillStyle = rgba(c, v * (g.level.theme === 'vault' ? 0.4 : 0.2));
      ctx.fillRect(X(wl.x) - ww / 2, Y(wl.z) - dd / 2, ww, dd);
      ctx.strokeStyle = rgba(c, v); ctx.lineWidth = g.level.theme === 'vault' ? 2 : 1;
      ctx.strokeRect(X(wl.x) - ww / 2, Y(wl.z) - dd / 2, ww, dd);
      if (g.level.theme === 'crystal' && i % 3 === 0) {
        const r = u * 0.35; ctx.save(); ctx.translate(X(wl.x), Y(wl.z)); ctx.rotate(t * 0.8 + i);
        ctx.strokeStyle = `hsla(${(190 + i * 25 + t * 10) % 360},90%,70%,${v})`;
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.6, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.6, 0); ctx.closePath(); ctx.stroke(); ctx.restore();
      }
    });
    // exit
    const ev = getVisibility(g, g.exit.x, g.exit.z) * k;
    if (ev > 0.01) {
      ctx.save(); ctx.translate(X(g.exit.x), Y(g.exit.z)); ctx.rotate(t * 0.8);
      ctx.strokeStyle = rgba('#eef4ff', ev); ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.lineTo(Math.cos(a) * u * 0.9, Math.sin(a) * u * 0.9); }
      ctx.closePath(); ctx.stroke(); ctx.fillStyle = rgba(sig, ev * 0.3); ctx.fill(); ctx.restore();
    }
    // hazards (always red, brighter glow)
    g.hazards.forEach((hz, i) => {
      const near = Math.hypot(hz.x - g.player.x, hz.z - g.player.z);
      let v = getVisibility(g, hz.x, hz.z);
      if (hz.kind === 'spike') v = Math.max(v, Math.max(0, 1 - near / (CW * 1.6)) * 0.9);
      if (hz.kind === 'laser' && !isLaserActive(g, hz)) v *= 0.15;
      v = Math.min(1, v * k * 1.3); if (v < 0.01) return;
      const hc = hz.kind === 'obstacle' ? '#5fe8ff' : red;
      ctx.save(); ctx.translate(X(hz.x), Y(hz.z)); ctx.shadowColor = hc; ctx.shadowBlur = 14 * v;
      ctx.strokeStyle = rgba(hc, v); ctx.fillStyle = rgba(hc, v * 0.35); ctx.lineWidth = 1.5;
      if (hz.kind === 'spike') {
        for (const dx of [-0.45, 0, 0.45]) for (const dz of [-0.4, 0.4]) {
          ctx.beginPath(); ctx.moveTo(dx * u, (dz - 0.18) * u); ctx.lineTo((dx + 0.15) * u, (dz + 0.15) * u); ctx.lineTo((dx - 0.15) * u, (dz + 0.15) * u); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      } else if (hz.kind === 'laser') {
        ctx.fillRect(-CW * u / 2, -2, CW * u, 4);
      } else if (hz.kind === 'obstacle') {
        const b = CW * 0.55 * u; ctx.strokeRect(-b / 2, -b / 2, b, b); ctx.beginPath(); ctx.moveTo(-b / 2, -b / 2); ctx.lineTo(b / 2, b / 2); ctx.moveTo(b / 2, -b / 2); ctx.lineTo(-b / 2, b / 2); ctx.stroke();
      } else {
        ctx.rotate(t * 2.4 + i); ctx.strokeRect(-u * 0.3, -u * 0.3, u * 0.6, u * 0.6);
        ctx.beginPath(); ctx.arc(0, 0, u * 0.65, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    });
    // pulses
    for (const p of g.pulses) {
      const rad = Math.min(p.range, p.age * 10); const a = Math.max(0, 1 - rad / p.range) * k;
      ctx.strokeStyle = rgba((p as { reflected?: boolean }).reflected ? '#9ef0ff' : sig, a); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.z), rad * u, 0, Math.PI * 2); ctx.stroke();
      if (g.level.theme === 'water') {
        ctx.strokeStyle = rgba('#3fe0d0', a * 0.6); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(X(p.x), Y(p.z), rad * u * 0.72, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // player
    const px = X(g.player.x), py = Y(g.player.z), pr = u * 0.38;
    ctx.save(); ctx.translate(px, py);
    ctx.globalAlpha = inputRef.current.stealth ? 0.4 : 1;
    ctx.strokeStyle = rgba(sig, 0.45); ctx.beginPath(); ctx.arc(0, 0, u * 0.58, 0, Math.PI * 2); ctx.stroke();
    ctx.rotate(t * 0.9); ctx.strokeStyle = '#eef4ff'; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.lineTo(Math.cos(a) * pr, Math.sin(a) * pr); }
    ctx.closePath(); ctx.stroke(); ctx.rotate(-t * 0.9);
    ctx.rotate(g.heading); ctx.fillStyle = sig; ctx.beginPath();
    ctx.moveTo(0, -u * 0.72); ctx.lineTo(u * 0.12, -u * 0.5); ctx.lineTo(-u * 0.12, -u * 0.5); ctx.closePath(); ctx.fill();
    ctx.restore();

    s.hudT += dt;
    if (s.hudT > 0.1) {
      s.hudT = 0;
      L.onHud({ steps: g.steps, echo: g.echo, elapsed: g.elapsed, guidance: getGuidance(g), warning: g.warning,
        angleToExit: Math.atan2(g.exit.x - g.player.x, -(g.exit.z - g.player.z)), shiftIn: g.shiftIn, pulses: s.echoes, failed: !!g.failed, stepLimit: g.stepLimit });
    }
  });

  return (
    <div className="relative h-full w-full bg-[#000000]">
      <canvas ref={ref} className="h-full w-full" style={{ touchAction: 'none' }} data-testid="canvas-2d-game" />
      <span data-testid="status-compat-mode" className="pointer-events-none absolute top-[calc(env(safe-area-inset-top)+7.5rem)] left-1/2 z-30 max-w-[92vw] truncate -translate-x-1/2 whitespace-nowrap rounded-full border border-white/15 bg-black/60 px-3 py-1 font-data text-[10px] uppercase tracking-[0.2em] text-[hsl(214_30%_75%)] ">{label}</span>
    </div>
  );
}
