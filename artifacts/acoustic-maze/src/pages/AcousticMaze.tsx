import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Footprints, Hand, Locate, Waves, Grid3x3, Lock, LogOut, Pause, Play, Radio, RotateCcw, Settings2, Home, SkipForward } from 'lucide-react';
import { LEVELS, type Input, type LevelDef } from '../game/engine';
import { audio } from '../game/audio';
import { completeLevel, loadProgress, loadSettings, saveSettings, type Progress, type Settings } from '../game/storage';
import { SIGNAL_HEX, t as tr, type Strings } from '../i18n';
import type { HudData } from '../components/GameScene';
import { Game2D, hasWebGL2, MenuMaze2D, SceneBoundary } from '../components/Fallback2D';
import { useTouchNavigation } from '../game/useTouchNavigation';

const MenuScene = lazy(() => import('../components/MenuScene'));
const GameScene = lazy(() => import('../components/GameScene'));

type Screen = 'menu' | 'gallery' | 'settings' | 'game' | 'exit';
type Win = { steps: number; seconds: number; echoes: number };

const WARN_HI: [string, string][] = [
  ['MOVING OBSTACLE', 'चलती बाधा — पत्थर के किनारे से धीरे निकलें'],
  ['STEP LIMIT REACHED', 'कदम सीमा समाप्त — फिर से कोशिश करें'],
  ['SONAR RECHARGING', 'सोनार चार्ज हो रहा है — अपने कदमों को सुनें'],
  ['SIGNAL DETECTED', 'संकेत पकड़ा गया — ड्रोन जाँच कर रहा है'],
  ['GRAVITATIONAL SHIFT', 'गुरुत्वीय बदलाव — नए रास्ते खोजें'],
  ['WATER DISTURBED', 'पानी हिला — धीमे, छोटे स्वाइप से चुपके चलें'],
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

export default function UnseenMaze() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [screen, setScreen] = useState<Screen>('menu');
  const [prev, setPrev] = useState<Screen>('menu');
  const [levelId, setLevelId] = useState(1);
  const [runKey, setRunKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [win, setWin] = useState<Win | null>(null);
  const [hud, setHud] = useState<HudData | null>(null);
  const failed = !!hud?.failed && !win;
  const L = tr(settings.language);
  const [gl, setGl] = useState<boolean>(() => hasWebGL2());
  const inputRef = useRef<Input>({ x: 0, z: 0, stealth: false });
  const sonarReq = useRef(false);

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

  const { touchHandlers, reset, gesture } = useTouchNavigation({ inputRef, sonarReq, enabled: screen === 'game' && !paused && !win && !failed, onGesture: unlock });
  const resetRef = useRef(reset); resetRef.current = reset;
  const clearInput = useCallback(() => { resetRef.current(); inputRef.current = { x: 0, z: 0, stealth: false }; sonarReq.current = false; }, []);
  useEffect(() => { clearInput(); }, [screen, levelId, runKey, clearInput]);
  useEffect(() => {
    const on = screen === 'game';
    document.documentElement.classList.toggle('playing', on);
    return () => document.documentElement.classList.remove('playing');
  }, [screen]);

  const setPause = useCallback((p: boolean) => {
    setPaused(p);
    clearInput();
    if (p) audio.suspend();
    else audio.resume();
  }, [clearInput]);

  useEffect(() => {
    if (screen !== 'game') return;
    const hide = () => { if (document.hidden && !winRef.current && !failedRef.current) setPause(true); };
    const blur = () => { if (!winRef.current && !failedRef.current) setPause(true); };
    document.addEventListener('visibilitychange', hide); window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('visibilitychange', hide); window.removeEventListener('blur', blur);
    };
  }, [screen, setPause]);
    const winRef = useRef(win); winRef.current = win;
  const failedRef = useRef(failed); failedRef.current = failed;

  const onWin = useCallback((r: Win) => {
    setProgress(completeLevel(levelId, r.steps, Math.round(r.seconds), r.echoes));
    setWin(r);
  }, [levelId]);

  const level = LEVELS.find((l) => l.id === levelId) ?? LEVELS[0];
  const startId = Math.min(progress.unlocked, LEVELS.length);

  return (
    <div data-sig={settings.color} className="grain scan relative min-h-[100dvh] w-full overflow-x-hidden bg-background text-foreground">
      {screen === 'game' ? (
        <div className="fixed inset-0">
          {(() => {
            const common = { levelId, runKey, paused: paused || !!win || failed, settings, inputRef, sonarReq, onHud: setHud, onWin };
            const flat = <Game2D {...common} label={L.compat} />;
            return gl ? (
              <SceneBoundary fallback={flat} onFail={() => setGl(false)}>
                <Suspense fallback={<BootSkeleton />}><GameScene {...common} onLost={() => setGl(false)} /></Suspense>
              </SceneBoundary>
            ) : flat;
          })()}
          <div data-testid="touch-play-surface" {...touchHandlers} className="absolute inset-0 z-20" style={{ touchAction: 'none', pointerEvents: 'auto', WebkitUserSelect: 'none', userSelect: 'none' }}>
            <TouchTrace g={gesture} />
          </div>
          <GameHud L={L} level={level} hud={hud} lang={settings.language} onPause={() => setPause(true)} stealth={gesture.active && gesture.slow} />
          {failed && (
            <Overlay>
              <p className="font-data text-xs tracking-[0.3em] text-[hsl(var(--sig-red))] uppercase">{L.level} {String(level.id).padStart(2, '0')} / {LEVELS.length} · {L.stepBudget} {hud?.stepLimit}</p>
              <h2 className="neon-title mt-2 text-4xl sm:text-5xl" data-testid="text-failed">{L.failedTitle}</h2>
              <p className="mt-4 text-sm text-muted-foreground">{L.failedBody}</p>
              <div className="mt-6 grid gap-2">
                <PanelBtn testid="button-fail-restart" primary icon={<RotateCcw size={18} />} onClick={() => startLevel(levelId)}>{L.restart}</PanelBtn>
                <PanelBtn testid="button-fail-gallery" icon={<Grid3x3 size={18} />} onClick={() => go('gallery')}>{L.toGallery}</PanelBtn>
                <PanelBtn testid="button-fail-menu" icon={<Home size={18} />} onClick={() => go('menu')}>{L.toMenu}</PanelBtn>
              </div>
            </Overlay>
          )}
          {paused && !win && !failed && (
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
          {screen === 'gallery' && <Gallery L={L} progress={progress} focusId={screen === 'gallery' && prev === 'game' ? levelId : startId} onBack={() => go('menu')} onPlay={startLevel} />}
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
    <div className="fadein absolute inset-0 z-40 flex items-center justify-center overflow-hidden bg-[hsl(230_45%_2%/0.6)] p-3"
      style={{ touchAction: 'pan-y', paddingTop: 'max(.75rem, env(safe-area-inset-top))', paddingBottom: 'max(.75rem, env(safe-area-inset-bottom))', paddingLeft: 'max(.75rem, env(safe-area-inset-left))', paddingRight: 'max(.75rem, env(safe-area-inset-right))' }}>
      <div data-testid="game-overlay-panel" className="glass rise min-h-0 w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl p-[clamp(1rem,4.5vw,2rem)] [&_h2]:text-[clamp(1.9rem,8vw,3rem)]"
        style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 1.5rem)' }}>{children}</div>
    </div>
  );
}

function PanelBtn({ children, icon, onClick, primary, testid }: { children: ReactNode; icon: ReactNode; onClick: () => void; primary?: boolean; testid: string }) {
  return (
    <button data-testid={testid} onClick={onClick}
      className={`group flex min-h-12 items-center gap-3 rounded-lg border px-4 py-3 text-left font-semibold tracking-wide transition-all duration-200 active:scale-[0.98] ${primary ? 'border-[hsl(var(--sig)/0.7)] bg-[hsl(var(--sig)/0.16)] sig-glow hover:bg-[hsl(var(--sig)/0.26)]' : 'border-white/10 bg-white/[0.03] hover:border-[hsl(var(--sig)/0.5)] hover:bg-white/[0.07]'}`}>
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
    <div className="safe relative z-10 flex min-h-[100dvh] flex-col justify-between gap-[clamp(1rem,4dvh,2rem)] p-[clamp(1rem,4vw,3.5rem)]">
      <header className="rise flex items-center justify-between font-data text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
        <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--sig))]" />SONAR ONLINE</span>
        <span data-testid="text-progress">{L.progress} {done}/{LEVELS.length}</span>
      </header>
      <div className="grid items-end gap-[clamp(1rem,4dvh,2.5rem)] landscape:grid-cols-[1.2fr_1fr] md:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="rise font-data text-xs uppercase tracking-[0.4em] sig-text" style={{ animationDelay: '.1s' }}>// {LEVELS.length} {L.chambers} · 0 lux</p>
          <h1 className="rise mt-3 text-[clamp(2.8rem,min(16vw,15dvh),8rem)]" style={{ animationDelay: '.2s' }}>
            <span className="neon-title block">UNSEEN</span>
            <span className="neon-outline block tracking-[0.12em]">MAZE</span>
          </h1>
          <p className="rise mt-[clamp(.5rem,2dvh,1.25rem)] max-w-md text-[clamp(1rem,2.4vw,1.125rem)] text-[hsl(214_30%_78%)]" style={{ animationDelay: '.35s' }}>{L.tagline}</p>
          <div className="rise mt-6 max-w-md" style={{ animationDelay: '.4s' }}>
            <div className="flex h-1.5 gap-px overflow-hidden rounded" data-testid="bar-progress">
              {TIERS.map((tr0) => {
                const n = LEVELS.filter((l) => l.tier === tr0.id);
                const c = n.filter((l) => progress.completed[String(l.id)]).length;
                return <div key={tr0.id} className="relative h-full bg-white/10" style={{ flex: n.length }}><div className="h-full origin-left bg-[hsl(var(--sig))]" style={{ transform: `scaleX(${n.length ? c / n.length : 0})` }} /></div>;
              })}
            </div>
            <div className="mt-2 flex justify-between font-data text-[10px] uppercase tracking-widest text-muted-foreground">
              {TIERS.map((tr0) => <span key={tr0.id}>{L[tr0.key]}</span>)}
            </div>
          </div>
        </div>
        <nav className="rise glass-soft max-w-md rounded-xl p-2 landscape:justify-self-end landscape:w-full w-full" style={{ animationDelay: '.45s' }}>
          {items.map(([title, sub, icon, fn, id], i) => (
            <button key={id} data-testid={id} onClick={fn} className="menu-btn min-h-[52px] rounded-md">
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
        <Kbd k={L.gTap} v={L.ctrlSonar} /><Kbd k={L.gDrag} v={L.ctrlMove} />
        <Kbd k={L.gSlow} v={L.ctrlStealth} /><Kbd k={L.gTwo} v={L.ctrlTouch} />
        <span className="flex items-center gap-2 sm:basis-full"><Footprints size={14} className="sig-text" />{L.stepHint}</span>
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

const TIERS = [
  { id: 'easy', key: 'tierEasy' }, { id: 'medium', key: 'tierMedium' }, { id: 'hard', key: 'tierHard' }, { id: 'expert', key: 'tierExpert' },
] as const;
const PER = 12;

function Gallery({ L, progress, focusId, onBack, onPlay }: { L: Strings; progress: Progress; focusId: number; onBack: () => void; onPlay: (id: number) => void }) {
  const pages = Math.ceil(LEVELS.length / PER);
  const pageOf = (id: number) => Math.min(pages - 1, Math.floor((Math.max(1, id) - 1) / PER));
  const [page, setPage] = useState(() => pageOf(focusId));
  const slice = LEVELS.slice(page * PER, page * PER + PER);
  const first = slice[0]?.id ?? 1, last = slice[slice.length - 1]?.id ?? 1;
  const latest = Math.min(progress.unlocked, LEVELS.length);
  const tierStart = (id: string) => LEVELS.find((l) => l.tier === id)?.id ?? 1;
  const curTier = slice[0]?.tier;
  return (
    <div className="safe relative z-10 mx-auto min-h-[100dvh] max-w-7xl p-[clamp(1rem,4vw,2.5rem)]">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <button data-testid="button-back-gallery" onClick={onBack} className="mb-2 flex min-h-11 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"><ChevronLeft size={16} />{L.back}</button>
          <h2 className="neon-title text-[clamp(2rem,8vw,3.75rem)]">{L.gallery}</h2>
        </div>
        <p className="font-data text-xs uppercase tracking-[0.3em] text-muted-foreground">{L.progress} <span className="sig-text">{Object.keys(progress.completed).length}</span>/{LEVELS.length}</p>
      </div>
      <div className="rise mt-6 grid gap-3" style={{ animationDelay: '.1s' }}>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/20 p-1 sm:grid-cols-4">
          {TIERS.map((tr0) => {
            const lv = LEVELS.filter((l) => l.tier === tr0.id);
            const lo = lv[0]?.id ?? 0, hi = lv[lv.length - 1]?.id ?? 0;
            const on = curTier === tr0.id;
            return (
              <button key={tr0.id} data-testid={`button-tier-${tr0.id}`} onClick={() => setPage(pageOf(tierStart(tr0.id)))}
                className={`flex min-h-11 flex-col items-start rounded-md px-3 py-2 text-left transition-all ${on ? 'bg-[hsl(var(--sig)/0.18)] sig-glow' : 'text-muted-foreground hover:bg-white/5'}`}>
                <span className="text-sm font-semibold">{L[tr0.key]}</span>
                <span className="font-data text-[10px] tracking-widest">{String(lo).padStart(2, '0')}–{String(hi).padStart(2, '0')}{tierStart(tr0.id) > progress.unlocked ? ` · ${L.locked}` : ''}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-data text-xs uppercase tracking-[0.25em] text-muted-foreground" data-testid="text-page-range">{L.page} {page + 1}/{pages} · <span className="sig-text">{String(first).padStart(2, '0')}–{String(last).padStart(2, '0')}</span></p>
          <button data-testid="button-jump-latest" onClick={() => setPage(pageOf(latest))} className="flex min-h-11 items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 font-data text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-[hsl(var(--sig)/0.5)] hover:text-foreground"><Locate size={13} />{L.jumpLatest} {String(latest).padStart(2, '0')}</button>
        </div>
      </div>
      <div key={page} className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(min(100%,9.5rem),1fr))] gap-[clamp(.5rem,2vw,1rem)] md:grid-cols-3 lg:grid-cols-4">
        {slice.map((lv, i) => {
          const locked = lv.id > progress.unlocked;
          const rec = progress.completed[String(lv.id)];
          return (
            <button key={lv.id} data-testid={`card-level-${lv.id}`} disabled={locked} onClick={() => onPlay(lv.id)}
              title={locked ? L.lockedHint : lv.description}
              className={`group rise glass flex flex-col overflow-hidden rounded-xl text-left transition-all duration-300 ${locked ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-1 hover:border-[hsl(var(--sig)/0.6)]'} ${lv.id === latest ? 'border-[hsl(var(--sig)/0.6)]' : ''}`}
              style={{ animationDelay: `${i * 0.03}s` }}>
              <div className="relative aspect-[4/3] bg-[hsl(230_45%_3%/0.7)]">
                <Thumb lv={lv} locked={locked} />
                <span className="absolute left-2 top-2 font-data text-xs text-muted-foreground">{String(lv.id).padStart(2, '0')}/{LEVELS.length}</span>
                <span className="absolute right-2 top-2 max-w-[55%] truncate rounded-full border border-white/10 px-2 py-0.5 font-data text-[10px] uppercase tracking-wider text-muted-foreground">{lv.theme}</span>
                {locked && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground"><Lock size={22} /><span className="font-data text-[10px] uppercase tracking-[0.3em]">{L.locked}</span></div>}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 p-[clamp(.6rem,2.5vw,1rem)]">
                <span className="font-display text-[clamp(.875rem,3.6vw,1rem)] font-bold leading-tight break-words">{lv.name}</span>
                <span className="text-xs text-muted-foreground">{lv.region ?? lv.subtitle} · {L[TIERS.find((x) => x.id === lv.tier)?.key ?? 'tierEasy']}</span>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-1 pt-2 font-data text-[11px]">
                  {rec ? <span className="sig-text">{L.cleared} · {rec.steps} {L.steps.toLowerCase()} · {fmt(rec.seconds)}</span>
                    : <span className="text-muted-foreground">{locked ? L.lockedHint : '—'}</span>}
                  {!locked && <span className="flex items-center gap-1 uppercase tracking-widest opacity-70">{L.play}<ArrowRight size={12} /></span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <nav className="flex flex-wrap items-center justify-center gap-2 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]" aria-label={L.page}>
        <button data-testid="button-page-prev" disabled={page === 0} onClick={() => setPage(page - 1)} className="flex h-11 items-center gap-1 rounded-lg border border-white/10 px-3 text-sm transition-colors hover:border-[hsl(var(--sig)/0.5)] disabled:opacity-30"><ChevronLeft size={16} />{L.prevPage}</button>
        <div className="flex flex-wrap justify-center gap-1">
          {Array.from({ length: pages }).map((_, p) => {
            const lo = p * PER + 1; const sealed = lo > progress.unlocked;
            return (
              <button key={p} data-testid={`button-page-${p + 1}`} onClick={() => setPage(p)} aria-current={p === page}
                className={`h-11 min-w-11 rounded-lg px-2 font-data text-xs transition-all ${p === page ? 'border border-[hsl(var(--sig)/0.7)] bg-[hsl(var(--sig)/0.16)] sig-glow' : sealed ? 'border border-white/5 text-muted-foreground/50' : 'border border-white/10 text-muted-foreground hover:text-foreground'}`}>{p + 1}</button>
            );
          })}
        </div>
        <button data-testid="button-page-next" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="flex h-11 items-center gap-1 rounded-lg border border-white/10 px-3 text-sm transition-colors hover:border-[hsl(var(--sig)/0.5)] disabled:opacity-30">{L.nextPage}<ChevronRight size={16} /></button>
      </nav>
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
          className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-2 py-2 text-sm font-semibold transition-all ${value === v ? 'bg-[hsl(var(--sig)/0.18)] sig-glow' : 'text-muted-foreground hover:bg-white/5'}`}>
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
    <div className="safe relative z-10 flex min-h-[100dvh] items-center justify-center p-3 sm:p-4">
      <div className="glass rise my-2 w-full max-w-lg rounded-2xl p-[clamp(1rem,4vw,2rem)]">
        <button data-testid="button-back-settings" onClick={onBack} className="mb-2 flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft size={16} />{L.back}</button>
        <h2 className="neon-title text-[clamp(2rem,8vw,2.5rem)]">{L.settings}</h2>
        <div className="mt-5 space-y-5">
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
    <div className="safe relative z-10 flex min-h-[100dvh] items-center justify-center p-3 sm:p-4">
      <div className="glass rise my-2 w-full max-w-md rounded-2xl p-[clamp(1.25rem,5vw,2rem)] text-center">
        <div className="relative mx-auto mb-6 h-16 w-16">
          <span className="ping-ring absolute inset-0 rounded-full border-2 border-[hsl(var(--sig)/0.6)]" />
          <span className="absolute inset-0 flex items-center justify-center sig-text"><Radio size={26} /></span>
        </div>
        <h2 className="neon-title text-[clamp(2rem,8vw,2.5rem)]">{L.exitTitle}</h2>
        <p className="mt-4 text-muted-foreground">{L.exitBody}</p>
        <div className="mt-8 grid gap-2">
          <PanelBtn testid="button-return" primary icon={<Play size={18} />} onClick={onBack}>{L.returnBtn}</PanelBtn>
        </div>
      </div>
    </div>
  );
}

function TouchTrace({ g }: { g: { active: boolean; slow: boolean; originX: number; originY: number; x: number; y: number } }) {
  if (!g.active) return null;
  const dx = g.x - g.originX, dy = g.y - g.originY;
  const len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
  const tone = g.slow ? 'hsl(214 60% 94% / 0.45)' : 'hsl(var(--sig) / 0.6)';
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="touch-trace" aria-hidden>
      <span className="absolute h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border" style={{ left: g.originX, top: g.originY, borderColor: tone, borderStyle: g.slow ? 'dashed' : 'solid' }} />
      <span className="absolute h-px origin-left" style={{ left: g.originX, top: g.originY, width: Math.min(len, 140), transform: `rotate(${ang}rad)`, background: `linear-gradient(90deg, ${tone}, transparent)` }} />
      <span className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border" style={{ left: g.x, top: g.y, borderColor: tone }} />
    </div>
  );
}

function GameHud({ L, level, hud, lang, onPause, stealth }: {
  L: Strings; level: LevelDef; hud: HudData | null; lang: Settings['language']; onPause: () => void; stealth: boolean;
}) {
  const [hint, setHint] = useState(true);
  useEffect(() => { setHint(true); const id = setTimeout(() => setHint(false), 7000); return () => clearTimeout(id); }, [level.id]);
  const echo = hud ? Math.round(hud.echo) : 100;
  const left = hud?.stepLimit ? Math.max(0, hud.stepLimit - hud.steps) : null;
  const warning = localize(hud?.warning ?? '', lang);
  return (
    <div className="hud-safe pointer-events-none absolute inset-0 z-30 select-none">
      <div className="flex items-start justify-between gap-2">
        <div className="glass-soft fadein min-w-0 rounded-xl px-3 py-2 landscape:max-w-[42vw]">
          <p className="truncate font-data text-[11px] uppercase tracking-[0.2em] sig-text">{L.level} <span data-testid="text-level-index">{String(level.id).padStart(2, '0')}/{LEVELS.length}</span> · {L[TIERS.find((x) => x.id === level.tier)?.key ?? 'tierEasy']}</p>
          <p className="truncate font-display text-[clamp(.875rem,3.5vw,1.05rem)] font-bold" data-testid="text-level-name">{level.name}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-data text-sm">
            <Stat k={L.steps} v={String(hud?.steps ?? 0)} id="steps" />
            <Stat k={L.stepBudget} v={left !== null ? `${left}` : '—'} id="step-budget" warn={left !== null && hud!.stepLimit > 0 && left / hud!.stepLimit < 0.2} />
            <Stat k={L.echo} v={`${echo}%`} id="echo" warn={echo < 14} />
            {level.theme === 'void' && <Stat k={L.shift} v={`${Math.ceil(hud?.shiftIn ?? 30)}s`} id="shift" />}
          </div>
          <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded bg-white/10"><div className="h-full origin-left bg-[hsl(var(--sig))] transition-transform duration-150" style={{ transform: `scaleX(${echo / 100})` }} /></div>
          {hud?.stepLimit ? <div className="mt-1 h-[3px] w-full overflow-hidden rounded bg-white/10" data-testid="bar-step-budget"><div className={`h-full origin-left transition-transform ${hud.steps / hud.stepLimit > 0.8 ? 'bg-[hsl(var(--sig-red))]' : 'bg-[hsl(214_60%_94%/0.55)]'}`} style={{ transform: `scaleX(${Math.max(0, 1 - hud.steps / hud.stepLimit)})` }} /></div> : null}
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <div className="glass-soft flex items-center gap-2 rounded-xl p-1.5 md:px-3" title={localize(hud?.guidance ?? '', lang)}>
            <Compass a={hud?.angleToExit ?? 0} />
            <p className="hidden max-w-[14rem] font-data text-xs text-[hsl(214_30%_80%)] md:block" data-testid="text-guidance">{localize(hud?.guidance ?? '', lang)}</p>
          </div>
          <button data-testid="button-pause" onClick={(e) => { e.stopPropagation(); onPause(); }} onPointerDown={(e) => e.stopPropagation()}
            className="glass-soft pointer-events-auto flex h-12 w-12 items-center justify-center rounded-xl active:scale-95" aria-label={L.ctrlPause}><Pause size={20} /></button>
        </div>
      </div>
      {warning && (
        <div key={warning} className="absolute left-1/2 top-[30%] max-w-[88vw] -translate-x-1/2 rounded-md border border-[hsl(var(--sig-red)/0.6)] bg-[hsl(353_80%_10%/0.7)] px-3 py-2 text-center font-data text-xs uppercase tracking-widest text-[hsl(353_100%_80%)] backdrop-blur" style={{ animation: 'warn 1.6s ease both' }} data-testid="text-warning">{warning}</div>
      )}
      <div className="absolute inset-x-0 bottom-[max(.75rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-2 px-3">
        <span data-testid="gesture-stealth" aria-live="polite" className={`flex items-center gap-2 rounded-full border px-3 py-1 font-data text-[11px] uppercase tracking-[0.25em] transition-opacity duration-200 ${stealth ? 'opacity-100 border-[hsl(214_60%_94%/0.4)] bg-black/60 text-[hsl(214_60%_94%)]' : 'opacity-0 border-transparent'}`}>
          <Footprints size={13} />{L.stealthActive}
        </span>
        {hint && (
          <div className="fadein glass-soft flex max-w-[94vw] flex-wrap justify-center gap-x-4 gap-y-1 rounded-2xl px-4 py-2 text-xs text-muted-foreground" data-testid="text-touch-hint">
            <span className="flex items-center gap-1.5"><Waves size={13} className="sig-text" />{L.gTap}</span>
            <span className="flex items-center gap-1.5"><Hand size={13} className="sig-text" />{L.gDrag}</span>
            <span className="flex items-center gap-1.5"><Footprints size={13} className="sig-text" />{L.gSlow}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ k, v, id, warn }: { k: string; v: string; id: string; warn?: boolean }) {
  return <div><div className={`text-base leading-none ${warn ? 'text-[hsl(var(--sig-red))]' : ''}`} data-testid={`text-${id}`}>{v}</div><div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">{k}</div></div>;
}

function Compass({ a }: { a: number }) {
  return (
    <svg viewBox="0 0 40 40" className="h-9 w-9 shrink-0" data-testid="img-compass">
      <circle cx="20" cy="20" r="18" fill="none" stroke="hsl(214 50% 70% / 0.25)" />
      {[0, 90, 180, 270].map((d) => <line key={d} x1="20" y1="3" x2="20" y2="6" stroke="hsl(214 50% 70% / 0.5)" transform={`rotate(${d} 20 20)`} />)}
      <g style={{ transform: `rotate(${(a * 180) / Math.PI}deg)`, transformOrigin: '20px 20px', transition: 'transform .2s' }}>
        <path d="M20 6 L24 22 L20 19 L16 22 Z" fill="hsl(var(--sig))" />
        <path d="M20 34 L23 22 L17 22 Z" fill="hsl(var(--sig-red) / 0.6)" />
      </g>
    </svg>
  );
}
