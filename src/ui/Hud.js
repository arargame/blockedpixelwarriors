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
            <div class="train-head"><span data-train-title>ARMORED TRAIN</span><span class="train-pct" data-train-pct></span></div>
            <div class="train-cars" data-cars></div>
          </div>
        </div>
        <div class="hud-panel hud-wave"><span class="label">WAVE</span><span class="value" data-wave>1</span></div>
      </div>
      <div class="hud-bottom">
        <div class="log-feed" data-log></div>
        <div class="objectives" data-objectives></div>
        <div class="mission" data-mission>
          <span class="mission-title">MISSION</span>
          <span class="mc red"><i></i><b data-m="red">0</b>/<em data-g="red">100</em></span>
          <span class="mc green"><i></i><b data-m="green">0</b>/<em data-g="green">100</em></span>
          <span class="mc blue"><i></i><b data-m="blue">0</b>/<em data-g="blue">100</em></span>
          <span class="dock" data-dock>DOCK 0/26</span>
        </div>
        <div class="chopper" data-chopper>
          <span class="chopper-icon">🚁</span>
          <span class="chopper-label" data-chopper-label>CARGO CHOPPER IN</span>
          <span class="chopper-time" data-chopper-time>2:00</span>
          <div class="chopper-bar"><div class="chopper-fill" data-chopper-fill></div></div>
        </div>
        <div class="hud-bottom-row">
          <div class="hud-lives" data-lives></div>
          <div class="hp-row"><div class="seg-bar" data-hp></div><span class="hp-num" data-hp-num>100</span></div>
        </div>
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
    this.chopperEl = root.querySelector('[data-chopper]');
    this.chopperLabel = root.querySelector('[data-chopper-label]');
    this.chopperTime = root.querySelector('[data-chopper-time]');
    this.chopperFill = root.querySelector('[data-chopper-fill]');
    this.missionEls = Object.fromEntries(['red', 'green', 'blue'].map((k) => [k, root.querySelector(`[data-m="${k}"]`)]));
    this.goalEls = Object.fromEntries(['red', 'green', 'blue'].map((k) => [k, root.querySelector(`[data-g="${k}"]`)]));
    this.dockEl = root.querySelector('[data-dock]');
    this.logEl = root.querySelector('[data-log]');
    this.setLives(3);
  }

  /** Mission panel + chopper countdown only exist once the engineer is on duty. */
  setLogisticsVisible(on) {
    this.root.querySelector('[data-mission]').classList.toggle('off', !on);
  }

  /** The chopper countdown shows once the engineer works AND the cargo chopper is contracted. */
  setChopperVisible(on) {
    this.chopperEl.classList.toggle('off', !on);
  }

  /**
   * Pop-up text at a screen point (e.g. "CRITICAL!" where a black-gem shot crits), rising and
   * fading like Blocked's floating combat text.
   */
  floatText(text, x, y, color = '#ff3b3b') {
    if (this.floatCount > 12) return;
    this.floatCount = (this.floatCount ?? 0) + 1;
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.color = color;
    el.style.setProperty('--drift', `${(Math.random() - 0.5) * 30}px`);
    this.root.appendChild(el);
    setTimeout(() => {
      el.remove();
      this.floatCount -= 1;
    }, 900);
  }

  /** Mission progress: delivered red / green / blue packages vs. the goal. */
  setMission(delivered, goal) {
    for (const k of Object.keys(this.missionEls)) {
      this.missionEls[k].textContent = String(delivered[k] ?? 0);
      this.goalEls[k].textContent = String(goal[k]);
      this.missionEls[k].parentElement.classList.toggle('done', (delivered[k] ?? 0) >= goal[k]);
    }
  }

  setDock(count, capacity) {
    this.dockEl.textContent = `DOCK ${count}/${capacity}`;
  }

  /**
   * Cargo chopper countdown above the HP bar (2:00 -> 0:00); the last 10 seconds are emphasised.
   * While the chopper is on station it shows the loading progress instead.
   */
  setChopper(s) {
    let key;
    if (s.active) {
      key = `a${s.loaded}:${s.left}`;
      if (key === this.chopperKey) return;
      this.chopperLabel.textContent = 'CARGO CHOPPER LOADING';
      this.chopperTime.textContent = `${s.loaded} ⬆`;
      this.chopperFill.style.transform = 'scaleX(1)';
      this.chopperEl.classList.remove('urgent');
      this.chopperEl.classList.add('active');
    } else {
      const t = Math.max(0, s.remaining);
      const secs = Math.ceil(t);
      const urgent = t <= 10;
      key = `w${urgent ? Math.ceil(t * 10) : secs}`;
      if (key === this.chopperKey) return;
      this.chopperLabel.textContent = 'CARGO CHOPPER IN';
      this.chopperTime.textContent = urgent ? t.toFixed(1) : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      const total = s.total ?? 120;
      this.chopperFill.style.transform = `scaleX(${Math.min(1, t / total)})`;
      this.chopperEl.classList.toggle('urgent', urgent);
      this.chopperEl.classList.remove('active');
    }
    this.chopperKey = key;
  }

  showMissionComplete(score, delivered) {
    this.overlayEl.innerHTML = `<div class="gameover win">MISSION COMPLETE</div>
      <div class="final">DEPOT SHIPPED · BLOCK HAULER DESTROYED</div>
      <div class="final">${delivered.red} RED · ${delivered.green} GREEN · ${delivered.blue} BLUE DELIVERED</div>
      <div class="final">SCORE ${String(score).padStart(6, '0')}</div><div class="prompt">TAP / PRESS ANY KEY</div>`;
    this.overlayEl.classList.add('visible');
  }

  /**
   * Objective checklist (bottom left): a title and rows with a checkbox, text and progress.
   * @param {{title:string, items:{text:string, done:boolean, progress?:string, swatch?:string}[]}} o
   */
  setObjectives(o) {
    this.objectivesEl ??= this.root.querySelector('[data-objectives]');
    const key = JSON.stringify(o);
    if (key === this.objectivesKey) return;
    const prev = this.objectivesDone ?? new Set();
    const done = new Set(o.items.filter((i) => i.done).map((i) => i.text));
    this.objectivesKey = key;
    this.objectivesEl.innerHTML = `<div class="obj-title">${o.title}</div>` + o.items.map((i) => {
      const fresh = i.done && !prev.has(i.text) && this.objectivesDone ? ' fresh' : '';
      const sw = i.swatch ? `<i class="obj-sw ${i.swatch}"></i>` : '';
      return `<div class="obj${i.done ? ' done' : ''}${fresh}"><span class="obj-box">${i.done ? '✔' : ''}</span>${sw}<span class="obj-text">${i.text}</span>${i.progress ? `<span class="obj-prog">${i.progress}</span>` : ''}</div>`;
    }).join('');
    this.objectivesDone = done;
  }

  /** Overlay CONTINUE button (title / game over) when a checkpoint is saved. */
  continueMarkup(save) {
    if (!save) return '';
    return `<button class="continue-btn" data-continue>CONTINUE · STAGE 2 <small>C</small></button>`;
  }

  bindContinue(onContinue) {
    const btn = this.overlayEl.querySelector('[data-continue]');
    if (!btn || !onContinue) return;
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onContinue();
    });
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
      if (!entry || entry.duration !== p.duration || entry.name !== (p.name ?? '')) {
        if (entry) entry.row.remove();
        const def = POWERUPS[type];
        const row = document.createElement('div');
        row.className = 'skill';
        row.style.setProperty('--skill-color', p.css ?? def.css);
        row.innerHTML = `<span class="skill-key">${type === 'G' ? '◆' : type}</span><div class="skill-body"><div class="skill-head"><span class="skill-name">${p.name ?? def.name}</span><span class="skill-time"></span></div><div class="skill-bar"><div class="skill-fill"></div></div></div>`;
        this.skillsEl.appendChild(row);
        entry = { row, fill: row.querySelector('.skill-fill'), time: row.querySelector('.skill-time'), duration: p.duration, name: p.name ?? '' };
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
    this.trainTitleEl ??= this.root.querySelector('[data-train-title]');
    if (this.trainTitleEl.textContent !== train.title) this.trainTitleEl.textContent = train.title ?? 'ARMORED TRAIN';
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
    const shield = train.gemShielded ? ' · 🛡 SHIELD' : '';
    this.trainPctEl.textContent = train.destroyed ? 'DESTROYED' : `${lap > 1 ? `LAP ${lap} · ` : ''}${mode}${shield} · ${Math.round(train.integrity * 100)}%`;
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

  /**
   * Big centre message. After it has been read it shrinks and flies down into the log feed
   * (bottom left), where it stays for a while like a terminal line.
   */
  toast(text, color = '#ffcf6a') {
    // A toast still on screen goes to the log right away.
    if (this.toastPending) this.toastToLog(this.toastPending, false);
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
    this.toastPending = { text, color };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      const pending = this.toastPending;
      this.toastPending = null;
      if (pending) this.toastToLog(pending, true);
      this.toastEl.classList.remove('show');
    }, 2200);
  }

  /** Moves a toast into the log; with `fly`, a copy shrinks from the toast spot onto its line. */
  toastToLog({ text, color }, fly) {
    const line = this.log([[text, color]], { kind: 'event' });
    if (!fly || !line || getComputedStyle(this.toastEl).opacity < 0.05) return;
    const from = this.toastEl.getBoundingClientRect();
    const to = line.querySelector('.log-text').getBoundingClientRect();
    const host = this.root.getBoundingClientRect();
    if (!from.width || !to.width) return;
    const ghost = document.createElement('div');
    ghost.className = 'log-ghost';
    ghost.textContent = text;
    const fs = parseFloat(getComputedStyle(this.toastEl).fontSize);
    Object.assign(ghost.style, { left: `${from.left - host.left}px`, top: `${from.top - host.top}px`, fontSize: `${fs}px` });
    this.root.appendChild(ghost);
    line.classList.add('waiting');
    const k = to.height / Math.max(1, from.height);
    requestAnimationFrame(() => {
      ghost.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${Math.max(0.3, k)})`;
      ghost.style.opacity = '0.2';
    });
    setTimeout(() => {
      ghost.remove();
      line.classList.remove('waiting');
    }, 520);
  }

  /**
   * Bottom-left feed (above the chopper timer): terminal-style lines that fade out after a while.
   * `parts` is a list of [text, css colour?]; kill-feed style lines read "HELI ➜ TURRET".
   * @returns {HTMLElement|null} the line
   */
  log(parts, { ttl = 9, kind = 'kill' } = {}) {
    if (!this.logEl) return null;
    const line = document.createElement('div');
    line.className = `log-line ${kind}`;
    const prompt = document.createElement('span');
    prompt.className = 'log-prompt';
    prompt.textContent = kind === 'kill' ? '›' : '$';
    const body = document.createElement('span');
    body.className = 'log-text';
    for (const [text, color] of parts) {
      const span = document.createElement('span');
      span.textContent = text;
      if (color) span.style.color = color;
      body.appendChild(span);
    }
    line.append(prompt, body);
    this.logEl.appendChild(line);
    // Keep the feed short: the oldest lines scroll away.
    while (this.logEl.children.length > 6) this.logEl.firstChild.remove();
    setTimeout(() => {
      line.classList.add('fading');
      setTimeout(() => line.remove(), 700);
    }, ttl * 1000);
    return line;
  }

  /** Kill-feed line: who ➜ what. */
  kill(who, whoColor, what, whatColor, extra = null) {
    const parts = [[who, whoColor], ['  ➜  ', 'rgba(255,255,255,0.55)'], [what, whatColor]];
    if (extra) parts.push([`  ${extra[0]}`, extra[1]]);
    this.log(parts, { kind: 'kill' });
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

  showTitle(save = null, onContinue = null) {
    this.overlayEl.innerHTML = `${this.logoMarkup()}<div class="prompt">TAP / PRESS ANY KEY</div>${this.continueMarkup(save)}
      <div class="help">WASD fly &middot; &larr; &rarr; turn &middot; or DRAG &middot; weapons fire automatically<br/>Break the turrets, then the gem! Shoot cargo off the train - the engineer ships it.<br/>Stage 1: ship 20 red, 20 green and 20 blue packages &middot; Stage 2: stop the Block Hauler.</div>`;
    this.mountLogo();
    this.bindContinue(onContinue);
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

  showGameOver(score, save = null, onContinue = null) {
    this.overlayEl.innerHTML = `<div class="gameover">GAME OVER</div><div class="final">SCORE ${String(score).padStart(6, '0')}</div><div class="prompt">TAP / PRESS ANY KEY</div>${this.continueMarkup(save)}`;
    this.bindContinue(onContinue);
    this.overlayEl.classList.add('visible');
  }

  /** Empties the log feed and any toast (new run). */
  clearLog() {
    this.logEl.innerHTML = '';
    clearTimeout(this.toastTimer);
    this.toastPending = null;
    this.toastEl.classList.remove('show');
  }

  hideOverlay() {
    this.overlayEl.classList.remove('visible');
  }
}
