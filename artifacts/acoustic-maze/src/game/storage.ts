export type Settings = {
  quality: 'low' | 'medium' | 'high';
  intensity: number;
  volume: number;
  color: 'blue' | 'red' | 'white';
  language: 'en' | 'hi';
};
export type Progress = {
  unlocked: number;
  completed: Record<string, { steps: number; seconds: number; echoes: number }>;
};
const DEFAULT: Settings = { quality: 'medium', intensity: 0.8, volume: 0.5, color: 'blue', language: 'en' };
const SETTINGS_KEY = 'acoustic-maze.settings';
const PROGRESS_KEY = 'acoustic-maze.progress';
const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

function read(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); }
  catch { return null; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (error) {
    // Private browsing or a full device should not crash a playable game.
    console.warn('Acoustic Maze: browser storage unavailable; progress is session-only.', error);
  }
}
export function loadSettings(): Settings {
  const raw = read(SETTINGS_KEY) as Partial<Settings> | null;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT };
  return {
    quality: raw.quality === 'low' || raw.quality === 'high' ? raw.quality : 'medium',
    intensity: clamp(raw.intensity, 0.8, 0.2, 1.5),
    volume: clamp(raw.volume, 0.5, 0, 1),
    color: raw.color === 'red' || raw.color === 'white' ? raw.color : 'blue',
    language: raw.language === 'hi' ? 'hi' : 'en',
  };
}
export function saveSettings(settings: Settings): void { write(SETTINGS_KEY, settings); }
let sessionProgress: Progress | null = null;
export function loadProgress(): Progress {
  const raw = read(PROGRESS_KEY) as Progress | null;
  if (!raw || typeof raw !== 'object') return sessionProgress ?? { unlocked: 1, completed: {} };
  const completed: Progress['completed'] = {};
  if (raw.completed && typeof raw.completed === 'object') {
    for (let id = 1; id <= 15; id++) {
      const best = raw.completed[String(id)];
      if (best && Number.isFinite(best.steps) && Number.isFinite(best.seconds) && Number.isFinite(best.echoes)) {
        completed[String(id)] = {
          steps: Math.max(0, best.steps), seconds: Math.max(0, best.seconds), echoes: Math.max(0, best.echoes),
        };
      }
    }
  }
  return { unlocked: Math.floor(clamp(raw.unlocked, 1, 1, 15)), completed };
}
export function completeLevel(id: number, steps: number, seconds: number, echoes: number): Progress {
  const progress = loadProgress();
  if (!Number.isInteger(id) || id < 1 || id > progress.unlocked || id > 15) return progress;
  const previous = progress.completed[String(id)];
  if (!previous || steps < previous.steps || (steps === previous.steps && seconds < previous.seconds)) {
    progress.completed[String(id)] = {
      steps: Math.max(0, steps), seconds: Math.max(0, seconds), echoes: Math.max(0, echoes),
    };
  }
  progress.unlocked = Math.min(15, Math.max(progress.unlocked, id + 1));
  sessionProgress = progress;
  write(PROGRESS_KEY, progress);
  return progress;
}
