import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronLeft, Ghost, Grid3x3, Lock, LogOut, Pause, Play, Radio, RotateCcw, Settings2, Home, SkipForward } from 'lucide-react';
import { LEVELS, type Input, type LevelDef } from '../game/engine';
import { audio } from '../game/audio';
import { completeLevel, loadProgress, loadSettings, saveSettings, type Progress, type Settings } from '../game/storage';
import { SIGNAL_HEX, t as tr, type Strings } from '../i18n';
import type { HudData } from '../components/GameScene';
import { Game2D, hasWebGL2, MenuMaze2D, SceneBoundary } from '../components/Fallback2D';

const MenuScene = lazy(() => import('../components/MenuScene'));
const GameScene = lazy(() => import('../components/GameScene'));

type Screen = 'menu' | 'gallery' | 'settings' | 'game' | 'exit';
type Win = { steps: number; seconds: number; echoes: number };

const WARN_HI: [string, string][] = [
  ['SONAR RECHARGING', 'सोनार चार्ज हो रहा है — अपने कदमों को सुनें'],
  ['SIGNAL DETECTED', 'संकेत पकड़ा गया — ड्रोन जाँच कर रहा है'],
  ['GRAVITATIONAL SHIFT', 'गुरुत्वीय बदलाव — नए रास्ते खोजें'],
  ['WATER DISTURBED', 'पानी हिला — धीरे चलने के लिए Shift दबाएँ'],
  ['WALL DETECTED', 'दीवार मिली — दूसरी दिशा आज़माएँ'],
  ['HAZARD NEARBY', 'खतरा पास है — सावधानी से बढ़ें'],
  ['PATH LOST', 'रास्ता खो गया — स्थिर ज़मीन पर लौटे'],
  ['DRONE CONTACT', 'ड्रोन टकराया — संकेत बाधित'],
  ['LASER CONTACT', 'लेज़र टकराया — ग्रिड साफ़ होने तक रुकें'],
  ['SPIKE TRAP', 'काँटों का जाल — सुरक्षित ज़मीन पर लौटे'],
  ['DEAD END', 'बंद रास्ता — अपने कदम वापस लें'],
  ['EXIT FOUND', 'निकास मिला'],
  ['EXIT SIGNAL', 'निकास संकेत — पहुँच में'],
];
function localize(s: string, lang: Settings['language']) {
  if (lang !== 'hi' || !s) return s;
  const hit = WARN_HI.find(([k]) => s.startsWith(k));
  if (hit) return hit[1];
  return s.replace('m to exit signal', 'मी. निकास संकेत तक');
}
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function AcousticMaze() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [screen, setScreen] = useState<Screen>('menu');
  const [prev, setPrev] = useState<Screen>('menu');
  const [levelId, setLevelId] = useState(1);
  const [runKey, setRunKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [win, setWin] = useState<Win | null>(null);
  const [hud, setHud] = useState<HudData | null>(null);
  const L = tr(settings.language);
  const [gl, setGl] = useState<boolean>(() => hasWebGL2());
  const inputRef = useRef<Input>({ x: 0, z: 0, stealth: false });
  const sonarReq = useRef(false);
  const keys = useRef(new Set<string>());
  const pad = useRef({ x: 0, z: 0, stealth: false });

  useEffect(() => { saveSettings(settings); audio.setVolume(settings.volume); document.documentElement.lang = settings.language; }, [settings]);

  const unlock = useCallback(() => { audio.unlock().catch(() => undefined); }, []);
  const go = (s: Screen) => { setPrev(screen); setScreen(s); if (s === 'exit') audio.suspend(); else if (screen === 'exit') audio.resume(); };

  const startLevel = useCallback((id: number) => {
    unlock();
    if (id > progress.unlocked) return;
    setLevelId(id); setRunKey((k) => k + 1); setWin(null); setPaused(false); setHud(null);
    audio.resume();
    setScreen('game');
  }, [progress.unlocked, unlock]);

  const recompute = useCallback(() => {
    const k = keys.current;
    let x = pad.current.x, z = pad.current.z;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z += 1;
    x = Math.max(-1, Math.min(1, x)); z = Math.max(-1, Math.min(1, z));
    inputRef.current = { x, z, stealth: pad.current.stealth || k.has('ShiftLeft') || k.has('ShiftRight') };
  }, []);

  const setPause = useCallback((p: boolean) => {
    setPaused(p);
    if (p) { audio.suspend(); keys.current.clear(); pad.current = { x: 0, z: 0, stealth: false }; recompute(); }
    else audio.resume();
  }, [recompute]);

  useEffect(() => {
    if (screen !== 'game') return;
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { if (!win) setPause(!pausedRef.current); return; }
      if (e.code === 'Space') { e.preventDefault(); if (!pausedRef.current) sonarReq.current = true; return; }
      if (e.code.startsWith('Arrow')) e.preventDefault();
      keys.current.add(e.code); recompute();
    };
    const up = (e: KeyboardEvent) => { keys.current.delete(e.code); recompute(); };
    const hide = () => { if (document.hidden && !winRef.current) setPause(true); };
    const blur = () => { if (!winRef.current) setPause(true); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    document.addEventListener('visibilitychange', hide); window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up);
      document.removeEventListener('visibilitychange', hide); window.removeEventListener('blur', blur);
    };
  }, [screen, recompute, setPause, win]);
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const winRef = useRef(win); winRef.current = win;

  const onWin = useCallback((r: Win) => {
    setProgress(completeLevel(levelId, r.steps, Math.round(r.seconds), r.echoes));
    setWin(r);
  }, [levelId]);

  const level = LEVELS.find((l) => l.id === levelId) ?? LEVELS[0];
  const startId = Math.min(progress.unlocked, LEVELS.length);

  return (
    <div data-sig={settings.color} className="grain scan relative min-h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      {screen === 'game' ? (
        <div className="fixed inset-0">
          {(() => {
            const common = { levelId, runKey, paused: paused || !!win, settings, inputRef, sonarReq, onHud: setHud, onWin };
            const flat = <Game2D {...common} label={L.compat} />;
            return gl ? (
              <SceneBoundary fallback={flat} onFail={() => setGl(false)}>
                <Suspense fallback={<BootSkeleton />}><GameScene {...common} /></Suspense>
              </SceneBoundary>
            ) : flat;
          })()}
          <GameHud L={L} level={level} hud={hud} lang={settings.language} onPause={() => setPause(true)}
            onSonar={() => { unlock(); sonarReq.current = true; }} pad={pad} recompute={recompute} />
          {paused && !win && (
            <Overlay>
              <p className="font-data text-xs tracking-[0.3em] sig-text uppercase">{L.level} {String(level.id).padStart(2, '0')}</p>
              <h2 className="neon-title mt-2 text-4xl sm:text-5xl">{L.paused}</h2>
              <div className="mt-8 grid gap-2">
                <PanelBtn testid="button-resume" primary icon={<Play size={18} />} onClick={() => setPause(false)}>{L.resume}</PanelBtn>
                <PanelBtn testid="button-restart" icon={<RotateCcw size={18} />} onClick={() => startLevel(levelId)}>{L.restart}</PanelBtn>
                <PanelBtn testid="button-pause-gallery" icon={<Grid3x3 size={18} />} onClick={() => { setPause(false); go('gallery'); }}>{L.toGallery}</PanelBtn>
                <PanelBtn testid="button-pause-menu" icon={<Home size={18} />} onClick={() => { setPause(false); go('menu'); }}>{L.toMenu}</PanelBtn>
              </div>
            </Overlay>
          )}
          {win && (
            <Overlay>
              <p className="font-data text-xs tracking-[0.3em] sig-text uppercase">{L.level} {String(level.id).padStart(2, '0')} / {level.name}</p>
              <h2 className="neon-title mt-2 text-4xl sm:text-5xl">{L.complete}</h2>
              <div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10">
                {[[L.steps, win.steps], [L.time, fmt(win.seconds)], [L.echoes, win.echoes]].map(([k, v]) => (
                  <div key={String(k)} className="bg-[hsl(230_45%_5%/0.8)] p-3 text-center">
                    <div className="font-data text-2xl" data-testid={`text-result-${k}`}>{v}</div>
                    <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{k}</div>
                  </div>
                ))}
              </div>
              {level.id === LEVELS.length && <p className="mt-4 text-sm text-muted-foreground">{L.allDone}</p>}
              <div className="mt-6 grid gap-2">
                {level.id < LEVELS.length && (
                  <PanelBtn testid="button-next" primary icon={<SkipForward size={18} />} onClick={() => startLevel(level.id + 1)}>{L.next}</PanelBtn>
                )}
                <PanelBtn testid="button-retry" icon={<RotateCcw size={18} />} onClick={() => startLevel(levelId)}>{L.retry}</PanelBtn>
                <PanelBtn testid="button-win-gallery" icon={<Grid3x3 size={18} />} onClick={() => { setWin(null); go('gallery'); }}>{L.toGallery}</PanelBtn>
              </div>
            </Overlay>
          )}
        </div>
      ) : (
        <>
          <div className="fixed inset-0 opacity-90">
            {gl ? (
              <SceneBoundary fallback={<MenuMaze2D color={SIGNAL_HEX[settings.color]} intensity={settings.intensity} />} onFail={() => setGl(false)}>
                <Suspense fallback={null}>
                  <MenuScene color={SIGNAL_HEX[settings.color]} intensity={settings.intensity} quality={settings.quality} />
                </Suspense>
              </SceneBoundary>
            ) : <MenuMaze2D color={SIGNAL_HEX[settings.color]} intensity={settings.intensity} />}
          </div>
          <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_30%_50%,transparent_20%,hsl(230_45%_3%/0.85)_75%)]" />
          {screen === 'menu' && <MenuScreen L={L} startId={startId} progress={progress} onStart={() => startLevel(startId)}
            onGo={(s) => { unlock(); go(s); }} />}
          {screen === 'gallery' && <Gallery L={L} progress={progress} onBack={() => go('menu')} onPlay={startLevel} />}
          {screen === 'settings' && <SettingsPanel L={L} s={settings} set={setSettings} onBack={() => go(prev === 'settings' ? 'menu' : prev === 'game' ? 'menu' : prev)} />}
          {screen === 'exit' && <ExitScreen L={L} onBack={() => go('menu')} />}
        </>
      )}
    </div>
  );
}

function BootSkeleton() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative h-24 w-24">
        <span className="ping-ring absolute inset-0 rounded-full border sig-text" style={{ borderColor: 'currentColor' }} />
        <span className="absolute inset-[42%] rounded-full bg-[hsl(var(--sig))]" />
      </div>
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="fadein absolute inset-0 z-40 flex items-center justify-center bg-[hsl(230_45%_2%/0.55)] p-4">
      <div className="glass rise w-full max-w-md rounded-2xl p-6 sm:p-8">{children}</div>
    </div>
  );
}

function PanelBtn({ children, icon, onClick, primary, testid }: { children: ReactNode; icon: ReactNode; onClick: () => void; primary?: boolean; testid: string }) {
  return (
    <button data-testid={testid} onClick={onClick}
      className={`group flex items-center gap-3 rounded-lg border px-4 py-3 text-left font-semibold tracking-wide transition-all duration-200 active:scale-[0.98] ${primary ? 'border-[hsl(var(--sig)/0.7)] bg-[hsl(var(--sig)/0.16)] sig-glow hover:bg-[hsl(var(--sig)/0.26)]' : 'border-white/10 bg-white/[0.03] hover:border-[hsl(var(--sig)/0.5)] hover:bg-white/[0.07]'}`}>
      <span className="sig-text transition-transform group-hover:scale-110">{icon}</span>{children}
    </button>
  );
}

function MenuScreen({ L, startId, progress, onStart, onGo }: { L: Strings; startId: number; progress: Progress; onStart: () => void; onGo: (s: Screen) => void }) {
  const done = Object.keys(progress.completed).length;
  const items: [string, string, ReactNode, () => void, string][] = [
    [L.start, `${L.startSub} ${String(startId).padStart(2, '0')}`, <Play size={20} />, onStart, 'button-start'],
    [L.gallery, L.gallerySub, <Grid3x3 size={20} />, () => onGo('gallery'), 'button-gallery'],
    [L.settings, L.settingsSub, <Settings2 size={20} />, () => onGo('settings'), 'button-settings'],
    [L.exit, L.exitSub, <LogOut size={20} />, () => onGo('exit'), 'button-exit'],
  ];
  return (
    <div className="relative z-10 flex min-h-[100dvh] flex-col justify-between gap-8 p-5 sm:p-10 lg:p-14">
      <header className="rise flex items-center justify-between font-data text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
        <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--sig))]" />SONAR ONLINE</span>
        <span data-testid="text-progress">{L.progress} {done}/15</span>
      </header>
      <div className="grid items-end gap-10 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="rise font-data text-xs uppercase tracking-[0.4em] sig-text" style={{ animationDelay: '.1s' }}>// 15 chambers · 0 lux</p>
          <h1 className="rise mt-3 text-[clamp(3.2rem,12vw,9rem)]" style={{ animationDelay: '.2s' }}>
            <span className="neon-title block">ACOUSTIC</span>
            <span className="neon-outline block tracking-[0.12em]">MAZE</span>
          </h1>
          <p className="rise mt-5 max-w-md text-lg text-[hsl(214_30%_78%)]" style={{ animationDelay: '.35s' }}>{L.tagline}</p>
        </div>
        <nav className="rise glass-soft max-w-md rounded-xl p-2 lg:justify-self-end lg:w-full" style={{ animationDelay: '.45s' }}>
          {items.map(([title, sub, icon, fn, id], i) => (
            <button key={id} data-testid={id} onClick={fn} className="menu-btn rounded-md">
              <span className="font-data text-xs text-muted-foreground">0{i + 1}</span>
              <span className="sig-text">{icon}</span>
              <span className="flex flex-col">
                <span className="font-display text-lg font-bold tracking-wide">{title}</span>
                <span className="text-xs text-muted-foreground">{sub}</span>
              </span>
            </button>
          ))}
        </nav>
      </div>
      <footer className="rise grid gap-3 text-xs text-muted-foreground sm:flex sm:flex-wrap sm:items-center sm:gap-6" style={{ animationDelay: '.6s' }}>
        <span className="font-data uppercase tracking-[0.25em] sig-text">{L.howTo}</span>
        <Kbd k="WASD / ←↑→↓" v={L.ctrlMove} /><Kbd k="SPACE / CLICK" v={L.ctrlSonar} />
        <Kbd k="SHIFT" v={L.ctrlStealth} /><Kbd k="ESC" v={L.ctrlPause} />
        <span className="sm:basis-full">{L.ctrlTouch}</span>
      </footer>
    </div>
  );
}

function Kbd({ k, v }: { k: string; v: string }) {
  return <span className="flex items-center gap-2"><kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-data text-[10px] text-foreground">{k}</kbd>{v}</span>;
}

function Thumb({ lv, locked }: { lv: LevelDef; locked: boolean }) {
  const cells = useMemo(() => {
    let s = lv.id * 7919 + 13;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const n = 9; const out: [number, number][] = [];
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const edge = x === 0 || z === 0 || x === n - 1 || z === n - 1;
      if (lv.theme === 'void' ? r() < 0.35 : edge || (x % 2 === 0 && z % 2 === 0) || r() < 0.28) out.push([x, z]);
    }
    return out;
  }, [lv]);
  const tint = { standard: 'hsl(var(--sig))', vault: 'hsl(222 70% 85%)', crystal: 'hsl(186 90% 70%)', water: 'hsl(172 75% 55%)', cyber: 'hsl(var(--sig-red))', void: 'hsl(214 60% 94%)' }[lv.theme];
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full">
      <defs>
        <radialGradient id={`rg${lv.id}`}><stop offset="0" stopColor="white" stopOpacity="1" /><stop offset="1" stopColor="white" stopOpacity="0.05" /></radialGradient>
        <mask id={`mk${lv.id}`}><rect width="100" height="100" fill={`url(#rg${lv.id})`} /></mask>
      </defs>
      <g mask={`url(#mk${lv.id})`} opacity={locked ? 0.18 : 1}>
        {cells.map(([x, z]) => (
          <rect key={`${x}-${z}`} x={6 + x * 9.8} y={6 + z * 9.8} width={lv.theme === 'void' ? 6 : 9} height={lv.theme === 'void' ? 6 : 9}
            fill="none" stroke={tint} strokeWidth={lv.theme === 'vault' ? 1.6 : 0.7} transform={lv.theme === 'crystal' ? `rotate(45 ${10.5 + x * 9.8} ${10.5 + z * 9.8})` : undefined} />
        ))}
        {lv.theme === 'water' && [14, 26, 38].map((r) => <circle key={r} cx="50" cy="50" r={r} fill="none" stroke={tint} strokeWidth="0.5" opacity="0.6" />)}
        {lv.theme === 'cyber' && <line x1="6" y1="52" x2="94" y2="52" stroke="hsl(var(--sig-red))" strokeWidth="1" strokeDasharray="3 2" />}
      </g>
      {!locked && <circle className="origin-center transition-transform duration-500 group-hover:scale-[1.6]" style={{ transformBox: 'fill-box' }} cx="50" cy="50" r="18" fill="none" stroke={tint} strokeWidth="0.8" />}
      <circle cx="50" cy="50" r="2" fill={locked ? 'hsl(214 20% 40%)' : 'hsl(214 60% 94%)'} />
    </svg>
  );
}

function Gallery({ L, progress, onBack, onPlay }: { L: Strings; progress: Progress; onBack: () => void; onPlay: (id: number) => void }) {
  return (
    <div className="relative z-10 mx-auto min-h-[100dvh] max-w-7xl p-5 sm:p-10">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <button data-testid="button-back-gallery" onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"><ChevronLeft size={16} />{L.back}</button>
          <h2 className="neon-title text-4xl sm:text-6xl">{L.gallery}</h2>
        </div>
        <p className="font-data text-xs uppercase tracking-[0.3em] text-muted-foreground">{L.progress} <span className="sig-text">{Object.keys(progress.completed).length}</span>/15</p>
      </div>
      <div className="mt-8 grid grid-cols-1 gap-4 pb-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {LEVELS.map((lv, i) => {
          const locked = lv.id > progress.unlocked;
          const rec = progress.completed[String(lv.id)];
          return (
            <button key={lv.id} data-testid={`card-level-${lv.id}`} disabled={locked} onClick={() => onPlay(lv.id)}
              title={locked ? L.lockedHint : lv.description}
              className={`group rise glass flex flex-col overflow-hidden rounded-xl text-left transition-all duration-300 ${locked ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-1 hover:border-[hsl(var(--sig)/0.6)]'}`}
              style={{ animationDelay: `${i * 0.035}s` }}>
              <div className="relative aspect-[4/3] bg-[hsl(230_45%_3%/0.7)]">
                <Thumb lv={lv} locked={locked} />
                <span className="absolute left-3 top-3 font-data text-xs text-muted-foreground">{String(lv.id).padStart(2, '0')}</span>
                <span className="absolute right-3 top-3 rounded-full border border-white/10 px-2 py-0.5 font-data text-[10px] uppercase tracking-wider text-muted-foreground">{lv.theme}</span>
                {locked && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground"><Lock size={22} /><span className="font-data text-[10px] uppercase tracking-[0.3em]">{L.locked}</span></div>}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-4">
                <span className="font-display text-base font-bold leading-tight">{lv.name}</span>
                <span className="text-xs text-muted-foreground">{lv.subtitle} · {lv.difficulty}</span>
                <div className="mt-auto flex items-center justify-between pt-3 font-data text-[11px]">
                  {rec ? <span className="sig-text">{L.cleared} · {rec.steps} {L.steps.toLowerCase()} · {fmt(rec.seconds)}</span>
                    : <span className="text-muted-foreground">{locked ? L.lockedHint : '—'}</span>}
                  {!locked && <span className="flex items-center gap-1 uppercase tracking-widest opacity-0 transition-opacity group-hover:opacity-100">{L.play}<ArrowRight size={12} /></span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, display, testid }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string; testid: string }) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-sm"><span>{label}</span><span className="font-data sig-text" data-testid={`text-${testid}`}>{display}</span></div>
      <input data-testid={`slider-${testid}`} type="range" className="range" min={min} max={max} step={step} value={value}
        style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Seg<T extends string>({ options, value, onChange, testid }: { options: [T, string, string?][]; value: T; onChange: (v: T) => void; testid: string }) {
  return (
    <div className="grid gap-1 rounded-lg border border-white/10 bg-black/20 p-1" style={{ gridTemplateColumns: `repeat(${options.length},1fr)` }}>
      {options.map(([v, l, sw]) => (
        <button key={v} data-testid={`${testid}-${v}`} onClick={() => onChange(v)}
          className={`flex items-center justify-center gap-2 rounded-md px-2 py-2 text-sm font-semibold transition-all ${value === v ? 'bg-[hsl(var(--sig)/0.18)] sig-glow' : 'text-muted-foreground hover:bg-white/5'}`}>
          {sw && <span className="h-2.5 w-2.5 rotate-45" style={{ background: sw, boxShadow: `0 0 10px ${sw}` }} />}{l}
        </button>
      ))}
    </div>
  );
}

function SettingsPanel({ L, s, set, onBack }: { L: Strings; s: Settings; set: (s: Settings) => void; onBack: () => void }) {
  const qs: Settings['quality'][] = ['low', 'medium', 'high'];
  const qi = qs.indexOf(s.quality);
  return (
    <div className="relative z-10 flex min-h-[100dvh] items-center justify-center p-4">
      <div className="glass rise w-full max-w-lg rounded-2xl p-6 sm:p-8">
        <button data-testid="button-back-settings" onClick={onBack} className="mb-3 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft size={16} />{L.back}</button>
        <h2 className="neon-title text-4xl">{L.settings}</h2>
        <div className="mt-7 space-y-6">
          <Slider testid="quality" label={L.graphics} value={qi} min={0} max={2} step={1} display={[L.low, L.medium, L.high][qi]} onChange={(v) => set({ ...s, quality: qs[v] })} />
          <Slider testid="intensity" label={L.intensity} value={s.intensity} min={0.2} max={1.5} step={0.05} display={`${Math.round(s.intensity * 100)}%`} onChange={(v) => set({ ...s, intensity: v })} />
          <Slider testid="volume" label={L.volume} value={s.volume} min={0} max={1} step={0.01} display={`${Math.round(s.volume * 100)}%`} onChange={(v) => { set({ ...s, volume: v }); audio.unlock().catch(() => undefined); }} />
          <div><p className="mb-2 text-sm">{L.color}</p>
            <Seg testid="button-color" value={s.color} onChange={(v) => set({ ...s, color: v })}
              options={[['blue', L.blue, SIGNAL_HEX.blue], ['red', L.red, SIGNAL_HEX.red], ['white', L.white, SIGNAL_HEX.white]]} /></div>
          <div><p className="mb-2 text-sm">{L.language}</p>
            <Seg testid="button-lang" value={s.language} onChange={(v) => set({ ...s, language: v })} options={[['en', 'English'], ['hi', 'हिन्दी']]} /></div>
        </div>
        <button data-testid="button-settings-done" onClick={onBack} className="mt-8 w-full rounded-lg border border-[hsl(var(--sig)/0.7)] bg-[hsl(var(--sig)/0.16)] py-3 font-display font-bold tracking-widest sig-glow transition-transform active:scale-[0.98]">{L.done}</button>
      </div>
    </div>
  );
}

function ExitScreen({ L, onBack }: { L: Strings; onBack: () => void }) {
  return (
    <div className="relative z-10 flex min-h-[100dvh] items-center justify-center p-4">
      <div className="glass rise w-full max-w-md rounded-2xl p-8 text-center">
        <div className="relative mx-auto mb-6 h-16 w-16">
          <span className="ping-ring absolute inset-0 rounded-full border-2 border-[hsl(var(--sig)/0.6)]" />
          <span className="absolute inset-0 flex items-center justify-center sig-text"><Radio size={26} /></span>
        </div>
        <h2 className="neon-title text-4xl">{L.exitTitle}</h2>
        <p className="mt-4 text-muted-foreground">{L.exitBody}</p>
        <div className="mt-8 grid gap-2">
          <PanelBtn testid="button-return" primary icon={<Play size={18} />} onClick={onBack}>{L.returnBtn}</PanelBtn>
          <PanelBtn testid="button-close-tab" icon={<LogOut size={18} />} onClick={() => window.close()}>{L.closeTry}</PanelBtn>
        </div>
      </div>
    </div>
  );
}

function GameHud({ L, level, hud, lang, onPause, onSonar, pad, recompute }: {
  L: Strings; level: LevelDef; hud: HudData | null; lang: Settings['language']; onPause: () => void; onSonar: () => void;
  pad: React.MutableRefObject<{ x: number; z: number; stealth: boolean }>; recompute: () => void;
}) {
  const [held, setHeld] = useState<string>('');
  const [stealth, setStealth] = useState(false);
  const [hint, setHint] = useState(true);
  useEffect(() => { const id = setTimeout(() => setHint(false), 7000); return () => clearTimeout(id); }, [level.id]);
  const echo = hud ? Math.round(hud.echo) : 100;
  const press = (d: string, x: number, z: number) => (e: React.PointerEvent) => {
    e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pad.current.x = x; pad.current.z = z; setHeld(d); recompute();
  };
  const release = () => { pad.current.x = 0; pad.current.z = 0; setHeld(''); recompute(); };
  const warning = localize(hud?.warning ?? '', lang);
  const dirs: [string, number, number, ReactNode, string][] = [
    ['up', 0, -1, <ArrowUp size={22} />, 'col-start-2 row-start-1'], ['left', -1, 0, <ArrowLeft size={22} />, 'col-start-1 row-start-2'],
    ['right', 1, 0, <ArrowRight size={22} />, 'col-start-3 row-start-2'], ['down', 0, 1, <ArrowDown size={22} />, 'col-start-2 row-start-3'],
  ];
  return (
    <div className="pointer-events-none absolute inset-0 z-30 select-none">
      <div className="flex items-start justify-between gap-3 p-3 sm:p-5">
        <div className="glass-soft fadein rounded-xl px-4 py-3">
          <p className="font-data text-[10px] uppercase tracking-[0.3em] sig-text">{L.level} {String(level.id).padStart(2, '0')} · {level.theme}</p>
          <p className="font-display text-base font-bold sm:text-lg" data-testid="text-level-name">{level.name}</p>
          <div className="mt-2 flex gap-5 font-data text-sm">
            <Stat k={L.steps} v={String(hud?.steps ?? 0)} id="steps" />
            <Stat k={L.time} v={fmt(hud?.elapsed ?? 0)} id="time" />
            {level.theme === 'void' && <Stat k="Shift" v={`${Math.ceil(hud?.shiftIn ?? 30)}s`} id="shift" />}
          </div>
          <div className="mt-2">
            <div className="flex justify-between font-data text-[10px] uppercase tracking-widest text-muted-foreground"><span>{L.echo}</span><span data-testid="text-echo" className={echo < 14 ? 'text-[hsl(var(--sig-red))]' : 'sig-text'}>{echo}%</span></div>
            <div className="mt-1 h-1 w-40 overflow-hidden rounded bg-white/10"><div className="h-full origin-left bg-[hsl(var(--sig))] transition-transform duration-150" style={{ transform: `scaleX(${echo / 100})` }} /></div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="glass-soft hidden items-center gap-3 rounded-xl px-3 py-2 sm:flex">
            <Compass a={hud?.angleToExit ?? 0} />
            <p className="max-w-[14rem] font-data text-xs text-[hsl(214_30%_80%)]" data-testid="text-guidance">{localize(hud?.guidance ?? '', lang)}</p>
          </div>
          <button data-testid="button-pause" onClick={(e) => { e.stopPropagation(); onPause(); }} onPointerDown={(e) => e.stopPropagation()}
            className="glass-soft pointer-events-auto flex h-12 w-12 items-center justify-center rounded-xl transition-all hover:border-[hsl(var(--sig)/0.6)] active:scale-95" aria-label="Pause"><Pause size={20} /></button>
        </div>
      </div>
      <div className="glass-soft mx-3 flex items-center gap-3 rounded-xl px-3 py-2 sm:hidden">
        <Compass a={hud?.angleToExit ?? 0} />
        <p className="font-data text-[11px] text-[hsl(214_30%_80%)]">{localize(hud?.guidance ?? '', lang)}</p>
      </div>
      {warning && (
        <div key={warning} className="absolute left-1/2 top-[38%] -translate-x-1/2 rounded-md border border-[hsl(var(--sig-red)/0.6)] bg-[hsl(353_80%_10%/0.7)] px-4 py-2 font-data text-xs uppercase tracking-widest text-[hsl(353_100%_80%)] backdrop-blur" style={{ animation: 'warn 1.6s ease both' }} data-testid="text-warning">{warning}</div>
      )}
      {hint && (
        <div className="fadein absolute bottom-40 left-1/2 hidden -translate-x-1/2 gap-5 rounded-full px-5 py-2 text-xs text-muted-foreground glass-soft md:flex">
          <Kbd k="WASD" v={L.ctrlMove} /><Kbd k="SPACE" v={L.ctrlSonar} /><Kbd k="SHIFT" v={L.ctrlStealth} /><Kbd k="ESC" v={L.ctrlPause} />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
        <div className="pointer-events-auto grid grid-cols-3 grid-rows-3 gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
          {dirs.map(([d, x, z, ic, pos]) => (
            <button key={d} data-testid={`button-dpad-${d}`} data-on={held === d} aria-label={d}
              onPointerDown={press(d, x, z)} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
              className={`dpad-btn glass-soft flex h-14 w-14 items-center justify-center rounded-xl ${pos}`}>{ic}</button>
          ))}
          <button data-testid="button-stealth" data-on={stealth} aria-label={L.stealth}
            onPointerDown={(e) => { e.stopPropagation(); const n = !stealth; setStealth(n); pad.current.stealth = n; recompute(); }}
            className="dpad-btn col-start-2 row-start-2 flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 text-muted-foreground"><Ghost size={20} /></button>
        </div>
        <button data-testid="button-sonar" aria-label={L.sonar}
          onPointerDown={(e) => { e.stopPropagation(); onSonar(); }}
          className="pointer-events-auto relative flex h-24 w-24 items-center justify-center rounded-full border-2 border-[hsl(var(--sig)/0.8)] bg-[hsl(var(--sig)/0.12)] sig-glow backdrop-blur transition-transform active:scale-90">
          <span className="ping-ring absolute inset-0 rounded-full border border-[hsl(var(--sig)/0.5)]" />
          <span className="flex flex-col items-center gap-0.5"><Radio size={26} className="sig-text" /><span className="font-data text-[10px] uppercase tracking-widest">{L.sonar}</span></span>
        </button>
      </div>
    </div>
  );
}

function Stat({ k, v, id }: { k: string; v: string; id: string }) {
  return <div><div className="text-base leading-none" data-testid={`text-${id}`}>{v}</div><div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">{k}</div></div>;
}

function Compass({ a }: { a: number }) {
  return (
    <svg viewBox="0 0 40 40" className="h-10 w-10 shrink-0" data-testid="img-compass">
      <circle cx="20" cy="20" r="18" fill="none" stroke="hsl(214 50% 70% / 0.25)" />
      {[0, 90, 180, 270].map((d) => <line key={d} x1="20" y1="3" x2="20" y2="6" stroke="hsl(214 50% 70% / 0.5)" transform={`rotate(${d} 20 20)`} />)}
      <g style={{ transform: `rotate(${(a * 180) / Math.PI}deg)`, transformOrigin: '20px 20px', transition: 'transform .2s' }}>
        <path d="M20 6 L24 22 L20 19 L16 22 Z" fill="hsl(var(--sig))" />
        <path d="M20 34 L23 22 L17 22 Z" fill="hsl(var(--sig-red) / 0.6)" />
      </g>
    </svg>
  );
}
