/**
 * Player settings (main menu OPTIONS) and scenario progress, kept in localStorage.
 * MonoGame keeps the same fields in %LOCALAPPDATA%/BlockedPixelWarriors/settings.json.
 *
 * Volumes are 0..10 steps (the game has no audio yet; the values are kept for when it does).
 * `quality` null = automatic (medium on phones, high elsewhere); it applies on the next start.
 */
export const SETTINGS_KEY = 'bpw.settings';
export const PROGRESS_KEY = 'bpw.progress';

export const DEFAULT_SETTINGS = Object.freeze({
  lang: 'en',
  master: 8,
  music: 7,
  sfx: 8,
  quality: null,
  shake: true,
  fullscreen: false,
});

export const QUALITY_LEVELS = Object.freeze(['high', 'medium', 'low']);
export const LANGUAGES = Object.freeze(['en', 'tr']);

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / storage off: settings last for this session only.
  }
}

export class Settings {
  constructor() {
    const saved = read(SETTINGS_KEY) ?? {};
    Object.assign(this, DEFAULT_SETTINGS);
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (saved[k] !== undefined) this[k] = saved[k];
    if (!LANGUAGES.includes(this.lang)) this.lang = 'en';
    if (this.quality !== null && !QUALITY_LEVELS.includes(this.quality)) this.quality = null;
    this.listeners = new Set();
  }

  /** Quality preset to start with: URL override, saved choice, else automatic. */
  static startupQuality(urlValue, isMobile) {
    if (urlValue) return urlValue;
    const saved = read(SETTINGS_KEY);
    if (saved && QUALITY_LEVELS.includes(saved.quality)) return saved.quality;
    return isMobile ? 'medium' : 'high';
  }

  set(key, value) {
    if (this[key] === value) return;
    this[key] = value;
    this.save();
    for (const fn of this.listeners) fn(key, value);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  save() {
    const out = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = this[k];
    write(SETTINGS_KEY, out);
  }
}

/**
 * Scenario progress for the menu's step lights: the furthest stage reached (1 depot, 2 terrace,
 * 3 boss) and whether the scenario's last built stage was beaten.
 */
export const Progress = {
  load(id = 'rail') {
    const all = read(PROGRESS_KEY) ?? {};
    const p = all[id] ?? {};
    return { best: Math.max(1, p.best ?? 1), cleared: !!p.cleared };
  },

  reach(stage, id = 'rail') {
    const all = read(PROGRESS_KEY) ?? {};
    const p = all[id] ?? {};
    p.best = Math.max(p.best ?? 1, stage);
    all[id] = p;
    write(PROGRESS_KEY, all);
  },

  clear(id = 'rail') {
    const all = read(PROGRESS_KEY) ?? {};
    const p = all[id] ?? {};
    p.cleared = true;
    p.best = Math.max(p.best ?? 1, 2);
    all[id] = p;
    write(PROGRESS_KEY, all);
  },
};
