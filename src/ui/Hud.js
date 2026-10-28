import { createVoxelLogo } from './VoxelLogo.js';
import { POWERUPS } from '../entities/PowerUps.js';

/**
 * DOM heads-up display: score, wave, lives, health bar, toasts and overlays.
 * Kept separate from rendering so it scales crisply on every screen size.
 */
export class Hud {
  constructor(container) {
    const root = document.createElement('div');
    root.className = 'hud';
    root.innerHTML = `
      <div class="hud-top">
        <div class="hud-panel hud-score"><span class="label">SCORE</span><span class="value" data-score>0</span></div>
        <div class="hud-center">
          <div class="train-panel" data-train>
            <div class="train-head"><span>ARMORED TRAIN</span><span class="train-pct" data-train-pct></span></div>
            <div class="train-cars" data-cars></div>
          </div>
        </div>
        <div class="hud-panel hud-wave"><span class="label">WAVE</span><span class="value" data-wave>1</span></div>
      </div>
      <div class="hud-bottom">
        <div class="hud-lives" data-lives></div>
        <div class="hp-row"><div class="seg-bar" data-hp></div><span class="hp-num" data-hp-num>100</span></div>
      </div>
      <div class="hud-notice" data-notice></div>
      <div class="damage-vignette" data-vignette></div>
      <div class="skill-feed" data-skills></div>
      <div class="hud-toast" data-toast></div>
      <div class="hud-overlay" data-overlay></div>
    `;
    container.appendChild(root);
    this.root = root;
    this.scoreEl = root.querySelector('[data-score]');
    this.waveEl = root.querySelector('[data-wave]');
    this.livesEl = root.querySelector('[data-lives]');
    // Player HP: 20 segments (5% each).
    this.hpBar = root.querySelector('[data-hp]');
    this.hpNum = root.querySelector('[data-hp-num]');
    this.hpSegments = Array.from({ length: 20 }, () => {
      const seg = document.createElement('i');
      this.hpBar.appendChild(seg);
      return seg;
    });
    this.trainPanel = root.querySelector('[data-train]');
    this.trainCarsEl = root.querySelector('[data-cars]');
    this.trainPctEl = root.querySelector('[data-train-pct]');
    this.noticeEl = root.querySelector('[data-notice]');
    this.trainRef = null;
    this.vignetteEl = root.querySelector('[data-vignette]');
    this.toastEl = root.querySelector('[data-toast]');
    this.overlayEl = root.querySelector('[data-overlay]');
    this.toastTimer = null;
    this.skillsEl = root.querySelector('[data-skills]');
    /** @type {Map<string, {row: HTMLElement, fill: HTMLElement, time: HTMLElement, duration: number}>} */
    this.skillRows = new Map();
    this.setLives(3);
  }

  setScore(score) {
    this.scoreEl.textContent = String(score).padStart(6, '0');
  }

  setWave(wave) {
    this.waveEl.textContent = String(wave);
  }

  setLives(lives) {
    this.livesEl.innerHTML = '<span class="heart"></span>'.repeat(Math.max(0, lives));
  }

  /**
   * Bottom-right feed of active power-ups (like a chat log): newest at the bottom, each with a
   * thin white-outlined bar whose inner white fill drains; rows fade out when they expire.
   * @param {Map<string, {remaining:number, duration:number}>} active
   */
  setSkills(active) {
    for (const [type, p] of active) {
      let entry = this.skillRows.get(type);
      if (!entry || entry.duration !== p.duration) {
        if (entry) entry.row.remove();
        const def = POWERUPS[type];
        const row = document.createElement('div');
        row.className = 'skill';
        row.style.setProperty('--skill-color', p.css ?? def.css);
        row.innerHTML = `<span class="skill-key">${type === 'G' ? '◆' : type}</span><div class="skill-body"><div class="skill-head"><span class="skill-name">${def.name}</span><span class="skill-time"></span></div><div class="skill-bar"><div class="skill-fill"></div></div></div>`;
        this.skillsEl.appendChild(row);
        entry = { row, fill: row.querySelector('.skill-fill'), time: row.querySelector('.skill-time'), duration: p.duration };
        this.skillRows.set(type, entry);
      }
      const ratio = Math.max(0, p.remaining / p.duration);
      entry.fill.style.transform = `scaleX(${ratio})`;
      entry.time.textContent = p.duration > 100 ? '' : `${p.remaining.toFixed(1)}s`;
    }
    for (const [type, entry] of this.skillRows) {
      if (active.has(type)) continue;
      this.skillRows.delete(type);
      entry.row.classList.add('leaving');
      setTimeout(() => entry.row.remove(), 450);
    }
  }

  /** Segmented player HP at the top (red + pulsing below 25%). */
  setHealth(ratio) {
    const r = Math.max(0, Math.min(1, ratio));
    const lit = Math.ceil(r * this.hpSegments.length - 1e-6);
    this.hpSegments.forEach((seg, i) => seg.classList.toggle('on', i < lit));
    this.hpBar.classList.toggle('low', r < 0.25);
    this.hpNum.textContent = `${Math.round(r * 100)}/100`;
  }

  /**
   * Red "blood" vignette like Blocked: snaps in on damage and fades out over 2 s.
   * @param {number} strength 0..1
   */
  damageFlash(strength = 1) {
    const el = this.vignetteEl;
    el.style.transition = 'none';
    el.style.opacity = String(Math.min(1, Math.max(Number(getComputedStyle(el).opacity) || 0, strength)));
    void el.offsetWidth;
    el.style.transition = 'opacity 2s linear';
    el.style.opacity = '0';
  }

  /** Short floating message under the HP bar (e.g. "+35 HP"). */
  notice(text, color = '#fff') {
    this.noticeEl.textContent = text;
    this.noticeEl.style.color = color;
    this.noticeEl.classList.remove('show');
    void this.noticeEl.offsetWidth;
    this.noticeEl.classList.add('show');
  }

  /**
   * Train damage panel: one card per car (locomotive first, left to right) holding one tick per
   * destructible part (ruby gem, turrets, cargo cubes in their colours). Ticks drain as parts take
   * damage and go hollow when destroyed; a car with nothing left is crossed out.
   * @param {import('../entities/Train.js').Train|null} train
   */
  updateTrain(train) {
    if (!train || train.finished) {
      this.trainPanel.classList.add('hidden');
      this.trainRef = null;
      return;
    }
    if (this.trainRef !== train) this.buildTrain(train);
    let hp = 0;
    let max = 0;
    for (const car of this.trainCars) {
      let carAlive = false;
      for (const t of car.ticks) {
        const target = t.target;
        const ratio = target.alive ? Math.max(0, target.hp / target.maxHp) : 0;
        hp += Math.max(0, target.hp) * (target.alive ? 1 : 0);
        max += target.maxHp;
        if (target.alive) carAlive = true;
        const key = target.alive ? Math.round(ratio * 20) : -1;
        if (key !== t.key) {
          t.key = key;
          t.fill.style.transform = `scaleY(${ratio})`;
          t.el.classList.toggle('dead', !target.alive);
          t.el.classList.toggle('hit', target.alive && ratio < 1);
        }
      }
      car.el.classList.toggle('wrecked', !carAlive || train.destroyed);
    }
    this.trainPanel.classList.toggle('destroyed', train.destroyed);
    const lap = train.lap ?? 1;
    const mode = train.stopped ? 'HALT' : train.mode;
    this.trainPctEl.textContent = train.destroyed ? 'DESTROYED' : `${lap > 1 ? `LAP ${lap} · ` : ''}${mode} · ${Math.round(train.integrity * 100)}%`;
  }

  buildTrain(train) {
    this.trainRef = train;
    this.trainPanel.classList.remove('hidden', 'destroyed');
    this.trainCarsEl.innerHTML = '';
    this.trainCars = train.cars.map((car, index) => {
      const el = document.createElement('div');
      el.className = index === 0 ? 'car loco' : 'car';
      const ticks = car.targets.filter((t) => t.kind !== 'hull').map((target) => {
        const tick = document.createElement('div');
        tick.className = `tick ${target.kind}`;
        if (target.kind === 'cargo') tick.style.setProperty('--tick', `#${target.color.toString(16).padStart(6, '0')}`);
        const fill = document.createElement('b');
        tick.appendChild(fill);
        el.appendChild(tick);
        return { el: tick, fill, target, key: null };
      });
      this.trainCarsEl.appendChild(el);
      return { el, ticks };
    });
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 2200);
  }

  logoMarkup() {
    return `
      <div class="logo">
        <div data-logo-canvas></div>
        <div class="logo-sub"></div>
      </div>`;
  }

  /** Swaps the placeholder for the painted voxel logo canvas (cached). */
  mountLogo() {
    const slot = this.overlayEl.querySelector('[data-logo-canvas]');
    if (!slot) return;
    this.logoCanvas ??= createVoxelLogo(Math.min(3, Math.max(2, window.devicePixelRatio || 1)));
    this.logoCanvas.className = 'voxel-logo';
    slot.replaceWith(this.logoCanvas);
  }

  showTitle() {
    this.overlayEl.innerHTML = `${this.logoMarkup()}<div class="prompt">TAP / PRESS ANY KEY</div>
      <div class="help">WASD fly &middot; &larr; &rarr; turn &middot; or DRAG &middot; weapons fire automatically<br/>Shoot the red gem on the locomotive!</div>`;
    this.mountLogo();
    this.overlayEl.classList.add('visible');
  }

  /** Key-art style frame: just the logo, no HUD panels. */
  showLogoOnly() {
    this.root.querySelector('.hud-top').style.display = 'none';
    this.root.querySelector('.hud-bottom').style.display = 'none';
    this.skillsEl.style.display = 'none';
    this.overlayEl.innerHTML = this.logoMarkup();
    this.mountLogo();
    this.overlayEl.querySelector('.logo-sub').style.display = 'none';
    this.overlayEl.classList.add('visible', 'poster');
  }

  showGameOver(score) {
    this.overlayEl.innerHTML = `<div class="gameover">GAME OVER</div><div class="final">SCORE ${String(score).padStart(6, '0')}</div><div class="prompt">TAP / PRESS ANY KEY</div>`;
    this.overlayEl.classList.add('visible');
  }

  hideOverlay() {
    this.overlayEl.classList.remove('visible');
  }
}
