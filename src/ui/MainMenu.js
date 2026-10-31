import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CARD_W, CARD_H, loadImage, easeInOut, backTexture, glowTexture } from './UpgradeCards.js';
import { MENU_ROWS, menuFrontCanvas } from './MenuCards.js';
import { menuText, LANGUAGE_NAMES } from './MenuText.js';
import { createVoxelLogo } from './VoxelLogo.js';
import { LANGUAGES, Progress } from '../core/Settings.js';

const CAM_Z = 2.45;
const FOV = 30;
const VIS_H = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
/** Height / width of the voxel logo canvas. */
export const LOGO_ASPECT = 874 / 1860;
const QUALITY_CYCLE = [null, 'high', 'medium', 'low'];

/**
 * Screen layout of the main menu in pixels (mirrored by MonoGame UI/MainMenu.cs Layout):
 * logo top left, the PLAY / OPTIONS / EXIT plates under it, the card stage on the right.
 * `u` is the CSS-pixel unit (desktop: 941-line key art; short landscape phones: 430 lines).
 */
export function menuLayout(W, H) {
  const compact = H < 560;
  const u = compact ? H / 430 : H / 941;
  const m = (compact ? 22 : 44) * u;
  const logoW = Math.min(W * 0.3, (compact ? 250 : 500) * u);
  const logo = { x: m, y: (compact ? 8 : 30) * u, w: logoW, h: logoW * LOGO_ASPECT };
  const plateH = (compact ? 46 : 76) * u;
  const gap = (compact ? 8 : 16) * u;
  const navY = Math.max(logo.y + logo.h + (compact ? 12 : 40) * u, compact ? 0 : H * 0.4);
  const nav = { x: m, y: navY, w: Math.max(logoW, 230 * u), plateH, gap };
  const sx = logo.x + Math.max(logoW, nav.w) + (compact ? 22 : 48) * u;
  const stage = { x: sx, y: (compact ? 10 : 44) * u, w: W - m * 0.5 - sx, h: H - (compact ? 40 : 76) * u - (compact ? 10 : 44) * u };
  const cardH = Math.min(stage.h * (compact ? 0.6 : 0.62), stage.w * 0.5 * CARD_H / CARD_W);
  const cardW = cardH * CARD_W / CARD_H;
  const card = { cx: stage.x + stage.w / 2, cy: stage.y + stage.h * (compact ? 0.44 : 0.47), w: cardW, h: cardH };
  const headY = card.cy - cardH / 2 - (compact ? 12 : 30) * u;
  const footY = card.cy + cardH / 2 + (compact ? 10 : 22) * u;
  const panelW = Math.min(stage.w * 0.56, 620 * u);
  const openCx = stage.x + Math.max(cardW * 0.5 + 10 * u, (stage.w - panelW - 30 * u) * 0.5);
  const panel = { x: openCx + cardW / 2 + (compact ? 18 : 40) * u, y: card.cy - cardH * 0.52, w: 0, h: cardH * 1.04 };
  panel.w = Math.min(panelW, stage.x + stage.w - panel.x);
  return { W, H, u, compact, logo, nav, stage, card, headY, footY, panel, openCx, hintY: H - (compact ? 16 : 30) * u };
}

/** Pause menu layout: logo centred at the top, the panel centred under it (MainMenu.cs PauseLayout). */
export function pauseLayout(W, H) {
  const L = menuLayout(W, H);
  const u = L.u;
  const lw = Math.min(W * 0.3, (L.compact ? 200 : 380) * u);
  const logo = { x: (W - lw) / 2, y: (L.compact ? 8 : 34) * u, w: lw, h: lw * LOGO_ASPECT };
  const pw = Math.min(W - 40 * u, (L.compact ? 420 : 500) * u);
  const top = logo.y + logo.h + (L.compact ? 6 : 20) * u;
  const panel = { x: (W - pw) / 2, y: top, w: pw, h: Math.max(0, H - top - (L.compact ? 30 : 70) * u) };
  return { logo, panel };
}

/**
 * Main menu. The game keeps running behind it (the attract-mode heli over the depot, trains
 * passing) drained to ash grey like while upgrade cards are up; the menu itself stays in colour.
 *
 *   rows (up / down):   PLAY · OPTIONS · EXIT GAME   (slanted plates under the logo)
 *   cards (left/right): the row's cards on a carousel (upgrade card model without the ribbon)
 *   ENTER / tap:        opens the focused card: briefing + NEW GAME / CONTINUE, a settings
 *                       panel, or the quit question. ESC goes back.
 * Scenario cards show the scenario's stages under the card as lights joined by a line: the
 * stages reached are lit (2 lights once the terrace checkpoint was reached), the boss is last.
 */
export class MainMenu {
  /**
   * @param {{ pipeline:any, container:HTMLElement, cardGltf:any, settings:import('../core/Settings.js').Settings,
   *   runningQuality:string, onPlay:(mode:'new'|'continue')=>void, canContinue:()=>boolean }} deps
   */
  constructor({ pipeline, container, cardGltf, settings, runningQuality, onPlay, canContinue }) {
    this.pipeline = pipeline;
    this.container = container;
    this.settings = settings;
    this.runningQuality = runningQuality;
    this.onPlay = onPlay;
    this.canContinue = canContinue;
    this.template = cardGltf?.scene ?? null;
    this.lang = settings.lang;
    this.row = 0;
    this.rowAnim = 0;
    this.cols = MENU_ROWS.map(() => 0);
    this.colAnim = MENU_ROWS.map(() => 0);
    this.open = null; // panel kind while a card is opened
    this.openT = 0;
    this.panelIndex = 0;
    this.visible = false;
    this.active = false;
    this.ash = 0;
    this.time = 0;
    this.leaving = null;
    this.pointer = new THREE.Vector2(9, 9);
    this.raycaster = new THREE.Raycaster();

    // ---- 3D cards (own transparent canvas at full DPR, like the upgrade cards) ----
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 20);
    this.camera.position.set(0, 0, CAM_Z);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'menu-canvas';
    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.9;
    const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
    key.position.set(-1.5, 2, 3);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.2);
    rim.position.set(2, -1, 1.5);
    this.scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.35));
    this.backTexture = backTexture();
    this.glowTexture = glowTexture();
    this.images = new Map();
    this.cards = MENU_ROWS.map((row) => row.cards.map((def) => ({ def, row: row.id })));
    const urls = [...new Set(MENU_ROWS.flatMap((r) => r.cards.map((c) => c.art)))];
    this.ready = Promise.all(urls.map(async (u) => this.images.set(u, await loadImage(u)))).then(() => {
      for (const list of this.cards) for (const c of list) this.buildCard(c);
      this.loaded = true;
    });

    // ---- DOM ----
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.innerHTML = `
      <div class="menu-shade"></div>
      <div class="menu-logo"></div>
      <nav class="menu-nav">${MENU_ROWS.map((r, i) => `
        <button class="menu-plate" data-row="${i}"><span class="mp-num">0${i + 1}</span><span class="mp-text"><span class="mp-label" data-t="${r.label}"></span><span class="mp-sub" data-t="${r.sub}"></span></span><span class="mp-chev">›</span></button>`).join('')}
      </nav>
      <div class="menu-link"></div>
      <div class="menu-head"><span class="mh-title"></span><span class="mh-count"></span></div>
      <button class="menu-arrow left" data-dir="-1">‹</button>
      <button class="menu-arrow right" data-dir="1">›</button>
      <div class="menu-foot"></div>
      <div class="menu-panel"></div>
      <div class="menu-hint"></div>
      <div class="menu-brand">ARARGAMES</div>`;
    this.root.insertBefore(this.canvas, this.root.querySelector('.menu-logo'));
    container.appendChild(this.root);
    this.logo = createVoxelLogo(Math.min(3, Math.max(2, window.devicePixelRatio || 1)));
    this.logo.className = 'menu-logo-canvas';
    this.root.querySelector('.menu-logo').appendChild(this.logo);
    this.el = {
      nav: this.root.querySelector('.menu-nav'),
      plates: [...this.root.querySelectorAll('.menu-plate')],
      link: this.root.querySelector('.menu-link'),
      head: this.root.querySelector('.mh-title'),
      count: this.root.querySelector('.mh-count'),
      headBox: this.root.querySelector('.menu-head'),
      arrows: [...this.root.querySelectorAll('.menu-arrow')],
      foot: this.root.querySelector('.menu-foot'),
      panel: this.root.querySelector('.menu-panel'),
      hint: this.root.querySelector('.menu-hint'),
      logoBox: this.root.querySelector('.menu-logo'),
    };
    this.el.plates.forEach((p) => p.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!this.active) return;
      this.setRow(Number(p.dataset.row));
    }));
    this.el.arrows.forEach((a) => a.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.active && !this.open) this.setCol(this.cols[this.row] + Number(a.dataset.dir));
    }));
    this.root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e), { passive: true });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.root.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('resize', () => (this.layoutKey = null));
    document.addEventListener('fullscreenchange', () => {
      this.settings.fullscreen = !!document.fullscreenElement;
      this.refresh();
    });
    settings.onChange((k) => {
      if (k === 'lang') this.setLanguage(settings.lang);
    });
    this.applyTexts();
  }

  // ---- Show / hide ------------------------------------------------------------------------

  async show() {
    this.mode = 'main';
    this.root.classList.remove('pause-mode');
    this.layoutKey = null;
    this.visible = true;
    this.active = false;
    this.leaving = null;
    this.open = null;
    this.openT = 0;
    this.introT = 0;
    this.root.classList.add('visible');
    this.root.classList.remove('leaving', 'panel-open');
    this.refresh();
    if (!this.loaded) await this.ready;
    this.introT = 0;
    // Input opens a moment later (update), so the key that brought the menu up doesn't also pick.
  }

  /** Plays the chosen card into the game, then calls onPlay(mode). */
  start(mode) {
    if (!this.active) return;
    this.active = false;
    this.leaving = { t: 0, mode, fired: false };
    this.closePanel(true);
    this.root.classList.add('leaving');
  }

  hide() {
    this.visible = false;
    this.active = false;
    this.open = null;
    this.root.classList.remove('visible', 'leaving', 'panel-open');
  }

  /**
   * Pause menu: the same panel style centred over the frozen, grey game.
   * RESUME · OPTIONS (sound / graphics / language) · RESTART · MAIN MENU.
   * @param {{resume:()=>void, restart:()=>void, mainMenu:()=>void}} actions
   */
  showPause(actions) {
    this.mode = 'pause';
    this.pauseActions = actions;
    this.layoutKey = null;
    this.visible = true;
    this.active = false;
    this.leaving = null;
    this.introT = 0;
    this.open = 'pause';
    this.panelIndex = 0;
    this.root.classList.add('visible', 'pause-mode', 'panel-open');
    this.root.classList.remove('leaving');
    for (const list of this.cards) for (const c of list) if (c.group) c.group.visible = false;
    this.refresh();
  }

  get paused() {
    return this.visible && this.mode === 'pause';
  }

  /** BACK: sub panel -> its parent; in the pause menu's top level it resumes the game. */
  back() {
    if (this.mode !== 'pause') return this.closePanel();
    if (this.open === 'pauseOptions') return this.openPanel('pause', 1);
    if (this.open === 'sound' || this.open === 'graphics' || this.open === 'language') {
      const i = ['sound', 'graphics', 'language'].indexOf(this.open);
      return this.openPanel('pauseOptions', i);
    }
    this.pauseActions?.resume();
  }

  // ---- Cards ------------------------------------------------------------------------------

  buildCard(c) {
    const def = c.def;
    const group = new THREE.Group();
    const frontTex = this.faceTexture(def);
    const sheen = { value: 0.8 };
    const sweep = { value: -1 };
    let model;
    if (this.template) {
      model = this.template.clone(true);
      model.rotation.x = Math.PI / 2;
    } else {
      model = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_H, 0.003), new THREE.MeshStandardMaterial({ name: 'CardFront' }));
    }
    const mats = [];
    const hidden = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.material.name;
      let m;
      if (name === 'CardBanner' || name === 'CardTail') {
        // No ribbon on menu cards.
        hidden.push(o);
        return;
      } else if (name === 'CardFront') {
        m = new THREE.MeshPhysicalMaterial({ map: frontTex, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.18 });
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uSheen = sheen;
          shader.uniforms.uSweep = sweep;
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uSheen;\nuniform float uSweep;')
            .replace('#include <dithering_fragment>', `#include <dithering_fragment>
              float sd = dot(vMapUv - 0.5, normalize(vec2(1.0, 0.55))) - uSweep;
              gl_FragColor.rgb += vec3(1.0, 0.94, 0.8) * uSheen * (smoothstep(0.09, 0.0, abs(sd)) * 0.55 + smoothstep(0.02, 0.0, abs(sd)) * 0.5);`);
        };
        c.front = m;
      } else if (name === 'CardBack') {
        m = new THREE.MeshPhysicalMaterial({ map: this.backTexture, roughness: 0.5, clearcoat: 0.5 });
      } else if (name === 'CardGold') {
        m = new THREE.MeshStandardMaterial({ color: def.locked ? 0xa8adb5 : 0xe6bb58, roughness: 0.22, metalness: 1, envMapIntensity: 1.4 });
      } else if (name === 'CardJewel') {
        m = new THREE.MeshPhysicalMaterial({ color: def.jewel, emissive: def.jewel, emissiveIntensity: 0.6, roughness: 0.05, clearcoat: 1, flatShading: true });
      } else {
        m = new THREE.MeshStandardMaterial({ color: 0xe6d9b8, roughness: 0.7 });
      }
      m.transparent = true;
      m.userData.base = m.color.clone();
      m.userData.emissiveBase = m.emissive ? m.emissive.clone() : null;
      o.material = m;
      mats.push(m);
    });
    for (const o of hidden) o.visible = false;
    group.add(model);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_W * 1.9, CARD_H * 1.6),
      new THREE.MeshBasicMaterial({ map: this.glowTexture, color: def.glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    glow.position.z = -0.04;
    group.add(glow);
    group.visible = false;
    this.scene.add(group);
    Object.assign(c, { group, model, glow, mats, frontTex, sheen, sweep, hoverT: 0, nope: 0, focusT: 0 });
  }

  faceTexture(def) {
    const tex = new THREE.CanvasTexture(menuFrontCanvas(def, this.images.get(def.art), this.lang));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.maxAniso;
    tex.flipY = !this.template;
    return tex;
  }

  setLanguage(lang) {
    this.lang = lang;
    if (this.loaded) {
      for (const list of this.cards) {
        for (const c of list) {
          const old = c.frontTex;
          c.frontTex = this.faceTexture(c.def);
          c.front.map = c.frontTex;
          c.front.needsUpdate = true;
          old.dispose();
          c.sweep.value = -0.9;
        }
      }
    }
    this.applyTexts();
    this.refresh();
  }

  t(key, vars) {
    return menuText(this.lang, key, vars);
  }

  applyTexts() {
    this.root.querySelectorAll('[data-t]').forEach((n) => {
      n.textContent = this.t(n.dataset.t);
    });
    document.documentElement.lang = this.lang;
  }

  // ---- Navigation -------------------------------------------------------------------------

  setRow(i) {
    i = THREE.MathUtils.clamp(i, 0, MENU_ROWS.length - 1);
    if (i === this.row && !this.open) return;
    this.closePanel();
    this.row = i;
    const c = this.focused();
    if (c?.sweep) c.sweep.value = -0.9;
    this.refresh();
  }

  setCol(i) {
    const n = MENU_ROWS[this.row].cards.length;
    i = THREE.MathUtils.clamp(i, 0, n - 1);
    if (i === this.cols[this.row]) {
      const c = this.focused();
      if (c) c.nope = 1; // bump at the ends
      return;
    }
    this.cols[this.row] = i;
    const c = this.focused();
    if (c?.sweep) c.sweep.value = -0.9;
    this.refresh();
  }

  focused() {
    return this.cards[this.row][this.cols[this.row]];
  }

  /** ENTER / tap on the focused card. */
  activate() {
    const c = this.focused();
    if (!c) return;
    const def = c.def;
    if (def.locked) {
      c.nope = 1;
      this.el.foot.classList.remove('flash');
      void this.el.foot.offsetWidth;
      this.el.foot.classList.add('flash');
      return;
    }
    this.openPanel(def.scenario ? 'scenario' : def.panel);
  }

  openPanel(kind, index = 0) {
    this.open = kind;
    this.panelIndex = index;
    this.farewell = false;
    this.root.classList.add('panel-open');
    this.refresh();
  }

  closePanel(silent = false) {
    if (!this.open || this.mode === 'pause') return;
    this.open = null;
    this.root.classList.remove('panel-open');
    if (!silent) this.refresh();
  }

  // ---- Panels -----------------------------------------------------------------------------

  /** Rows of the open panel: { kind:'slider'|'cycle'|'radio'|'button', ... }. */
  panelItems() {
    const s = this.settings;
    const back = { kind: 'button', label: this.t('back'), act: () => this.back() };
    switch (this.open) {
      case 'pause':
        return [
          { kind: 'button', label: this.t('resume'), primary: true, act: () => this.pauseActions?.resume() },
          { kind: 'button', label: this.t('options'), act: () => this.openPanel('pauseOptions') },
          { kind: 'button', label: this.t('restart'), act: () => this.pauseActions?.restart() },
          { kind: 'button', label: this.t('mainMenu'), act: () => this.pauseActions?.mainMenu() },
        ];
      case 'pauseOptions':
        return [
          { kind: 'button', label: this.t('soundTitle'), act: () => this.openPanel('sound') },
          { kind: 'button', label: this.t('graphicsTitle'), act: () => this.openPanel('graphics') },
          { kind: 'button', label: this.t('languageTitle'), act: () => this.openPanel('language') },
          back,
        ];
      case 'scenario': {
        const items = [];
        if (this.canContinue()) items.push({ kind: 'button', label: this.t('continueStage'), primary: true, act: () => this.start('continue') });
        items.push({ kind: 'button', label: this.t('newGame'), primary: !this.canContinue(), act: () => this.start('new') });
        items.push({ kind: 'button', label: this.t('back'), act: () => this.closePanel() });
        return items;
      }
      case 'sound':
        return [
          ...['master', 'music', 'sfx'].map((k) => ({ kind: 'slider', key: k, label: this.t(k), value: s[k], max: 10 })),
          back,
        ];
      case 'graphics': {
        const q = s.quality;
        const items = [
          { kind: 'cycle', key: 'quality', label: this.t('quality'), text: q ? this.t(q) : `${this.t('auto')} · ${this.t(this.runningQuality)}` },
          { kind: 'cycle', key: 'shake', label: this.t('shake'), text: this.t(s.shake ? 'on' : 'off') },
        ];
        if (document.fullscreenEnabled) items.push({ kind: 'cycle', key: 'fullscreen', label: this.t('fullscreen'), text: this.t(s.fullscreen ? 'on' : 'off') });
        items.push(back);
        return items;
      }
      case 'language':
        return [
          ...LANGUAGES.map((l) => ({ kind: 'radio', label: LANGUAGE_NAMES[l], on: s.lang === l, act: () => s.set('lang', l) })),
          back,
        ];
      case 'exit':
        return [
          { kind: 'button', label: this.t('yes'), danger: true, act: () => this.quit() },
          { kind: 'button', label: this.t('no'), act: () => this.closePanel() },
        ];
      default:
        return [];
    }
  }

  /** Left / right on a panel row. */
  adjust(item, dir) {
    const s = this.settings;
    if (!item) return;
    if (item.kind === 'slider') s.set(item.key, THREE.MathUtils.clamp(s[item.key] + dir, 0, item.max));
    else if (item.kind === 'cycle') {
      if (item.key === 'quality') {
        const i = QUALITY_CYCLE.indexOf(s.quality);
        s.set('quality', QUALITY_CYCLE[(i + dir + QUALITY_CYCLE.length) % QUALITY_CYCLE.length]);
      } else if (item.key === 'fullscreen') this.toggleFullscreen();
      else s.set(item.key, !s[item.key]);
    } else if (item.kind === 'radio' && dir) {
      const i = LANGUAGES.indexOf(s.lang);
      s.set('lang', LANGUAGES[(i + dir + LANGUAGES.length) % LANGUAGES.length]);
    }
    this.refresh();
  }

  toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    } catch {
      // not allowed here
    }
  }

  activatePanel(i) {
    const item = this.panelItems()[i];
    if (!item) return;
    this.panelIndex = i;
    if (item.kind === 'button' || item.kind === 'radio') item.act();
    else this.adjust(item, 1);
    this.refresh();
  }

  quit() {
    // Browsers only let a page close a window it opened itself; otherwise say goodbye.
    try {
      window.close();
    } catch {
      // ignore
    }
    this.farewell = true;
    this.refresh();
  }

  // ---- DOM refresh ------------------------------------------------------------------------

  refresh() {
    const row = MENU_ROWS[this.row];
    this.el.plates.forEach((p, i) => p.classList.toggle('on', i === this.row));
    this.el.head.textContent = this.t(row.head);
    this.el.count.textContent = row.cards.length > 1 ? `${this.cols[this.row] + 1} / ${row.cards.length}` : '';
    this.el.arrows[0].classList.toggle('off', this.cols[this.row] <= 0);
    this.el.arrows[1].classList.toggle('off', this.cols[this.row] >= row.cards.length - 1);
    const touch = matchMedia('(pointer: coarse)').matches;
    this.el.hint.textContent = this.mode === 'pause' ? (touch ? this.t('hintPauseTouch') : this.t('hintPause')) : touch ? this.t('hintTouch') : this.t('hintKeys');
    this.renderFoot();
    this.renderPanel();
  }

  /** Under the focused card: stage lights for scenarios, current values for option cards. */
  renderFoot() {
    const c = this.focused();
    const def = c?.def;
    const s = this.settings;
    let html = '';
    if (def?.scenario || def?.locked) {
      const p = def.scenario ? Progress.load(def.id) : { best: 0, cleared: false };
      const at = def.scenario ? (this.canContinue() ? 2 : 1) : 0;
      const names = [this.t('stepDepot'), this.t('stepTerrace'), this.t('stepBoss')];
      html += '<div class="mf-steps">';
      names.forEach((name, i) => {
        const lit = i < p.best;
        const cls = ['st', lit ? 'lit' : '', i === 2 ? 'boss' : '', at === i + 1 ? 'current' : '', (p.cleared && i < 2) || i < p.best - 1 ? 'done' : ''].join(' ');
        if (i) html += `<div class="st-line${lit ? ' lit' : ''}"></div>`;
        html += `<div class="${cls}"><i>${i === 2 ? '☠' : ''}</i><span>${name}</span></div>`;
      });
      html += '</div>';
      const cap = def.locked ? `${this.t('locked')} · ${this.t('comingSoon')}` : this.t('stageOf', { n: Math.max(at, Math.min(2, p.best)) });
      html += `<div class="mf-cap${def.locked ? ' locked' : ''}">${cap}</div>`;
    } else if (def?.panel === 'sound') {
      html += `<div class="mf-vals">${['master', 'music', 'sfx'].map((k) => `<span class="mf-val"><b>${this.t(k)}</b>${meter(s[k], 10, 'mini')}</span>`).join('')}</div>`;
    } else if (def?.panel === 'graphics') {
      html += `<div class="mf-vals"><span class="mf-val"><b>${this.t('quality')}</b><em>${s.quality ? this.t(s.quality) : this.t('auto')}</em></span><span class="mf-val"><b>${this.t('shake')}</b><em>${this.t(s.shake ? 'on' : 'off')}</em></span></div>`;
    } else if (def?.panel === 'language') {
      html += `<div class="mf-vals"><span class="mf-val"><em>${LANGUAGE_NAMES[s.lang]}</em></span></div>`;
    }
    if (def && !def.locked) html += `<div class="mf-open">${this.t('open')}</div>`;
    if (html !== this.footHtml) {
      this.footHtml = html;
      this.el.foot.innerHTML = html;
    }
  }

  renderPanel() {
    if (!this.open) return;
    const pause = this.mode === 'pause';
    const def = pause ? { glow: 0xffcf6a, title: { pause: 'paused', pauseOptions: 'optionsHead', sound: 'soundTitle', graphics: 'graphicsTitle', language: 'languageTitle' }[this.open] } : this.focused().def;
    const items = this.panelItems();
    this.panelIndex = THREE.MathUtils.clamp(this.panelIndex, 0, items.length - 1);
    const accent = `#${def.glow.toString(16).padStart(6, '0')}`;
    let body = '';
    if (this.open === 'scenario') {
      const p = Progress.load(def.id);
      const lines = [this.t('brief1'), this.t('brief2'), this.t('brief3')];
      body += `<div class="pn-brief">${lines.map((l, i) => `<div class="pb${i < p.best ? ' lit' : ''}${i === 2 ? ' boss' : ''}"><i>${i === 2 ? '☠' : i + 1}</i><span>${l}</span></div>`).join('')}</div>`;
    }
    if (this.open === 'exit') body += `<div class="pn-ask">${this.farewell ? this.t('farewell') : this.t('quitAsk')}</div>`;
    body += '<div class="pn-items">';
    items.forEach((it, i) => {
      const on = i === this.panelIndex ? ' on' : '';
      if (it.kind === 'button') body += `<div class="pn-btn${on}${it.primary ? ' primary' : ''}${it.danger ? ' danger' : ''}" data-i="${i}">${it.label}</div>`;
      else if (it.kind === 'radio') body += `<div class="pn-row radio${on}${it.on ? ' checked' : ''}" data-i="${i}"><span class="pn-dot"></span><span class="pn-label">${it.label}</span></div>`;
      else {
        const val = it.kind === 'slider' ? `${meter(it.value, it.max)}<em>${it.value * 10}%</em>` : `<em class="pn-text">${it.text}</em>`;
        body += `<div class="pn-row${on}" data-i="${i}"><span class="pn-label">${it.label}</span><span class="pn-ctrl"><b class="pn-arrow" data-i="${i}" data-d="-1">◀</b>${val}<b class="pn-arrow" data-i="${i}" data-d="1">▶</b></span></div>`;
      }
    });
    body += '</div>';
    if (this.open === 'sound') body += `<div class="pn-note">${this.t('soundNote')}</div>`;
    if (this.open === 'graphics' && (this.settings.quality ?? this.runningQuality) !== this.runningQuality) body += `<div class="pn-note warn">${this.t('qualityNote')}</div>`;
    const heading = this.open === 'scenario' ? this.t('briefing') : this.t(def.title);
    const html = `<div class="pn-frame" style="--accent:${accent}"><div class="pn-head"><span>${heading}</span></div>${body}</div>`;
    if (html === this.panelHtml) return;
    this.panelHtml = html;
    this.el.panel.innerHTML = html;
    this.el.panel.querySelectorAll('[data-i]').forEach((n) => n.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!this.active) return;
      const i = Number(n.dataset.i);
      if (n.dataset.d) {
        this.panelIndex = i;
        this.adjust(this.panelItems()[i], Number(n.dataset.d));
      } else this.activatePanel(i);
    }));
  }

  // ---- Input ------------------------------------------------------------------------------

  onKey(e) {
    if (!this.visible) return;
    if (!this.active) return;
    const k = e.code;
    const nav = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Enter', 'NumpadEnter', 'Space', 'Escape', 'Backspace', 'KeyP'];
    if (nav.includes(k)) e.preventDefault();
    const up = k === 'ArrowUp' || k === 'KeyW';
    const down = k === 'ArrowDown' || k === 'KeyS';
    const left = k === 'ArrowLeft' || k === 'KeyA';
    const right = k === 'ArrowRight' || k === 'KeyD';
    const enter = k === 'Enter' || k === 'NumpadEnter' || k === 'Space';
    const back = k === 'Escape' || k === 'Backspace' || (k === 'KeyP' && this.mode === 'pause');
    if (this.open) {
      const items = this.panelItems();
      if (up) this.panelIndex = (this.panelIndex - 1 + items.length) % items.length;
      else if (down) this.panelIndex = (this.panelIndex + 1) % items.length;
      else if (left || right) this.adjust(items[this.panelIndex], left ? -1 : 1);
      else if (enter) this.activatePanel(this.panelIndex);
      else if (back) this.back();
      if (this.visible) this.refresh();
      return;
    }
    if (up) this.setRow(this.row - 1);
    else if (down) this.setRow(this.row + 1);
    else if (left) this.setCol(this.cols[this.row] - 1);
    else if (right) this.setCol(this.cols[this.row] + 1);
    else if (enter) this.activate();
    else if (k === 'KeyC' && this.canContinue()) this.start('continue');
  }

  toNdc(e) {
    this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  }

  onPointerMove(e) {
    if (!this.visible) return;
    this.toNdc(e);
    if (this.drag && e.pointerId === this.drag.id) this.drag.dx = e.clientX - this.drag.x;
  }

  onPointerDown(e) {
    if (!this.active) return;
    this.toNdc(e);
    this.drag = { id: e.pointerId, x: e.clientX, dx: 0, hit: this.hitCard() };
  }

  onPointerUp(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if (!this.active) return;
    if (!this.open && Math.abs(d.dx) > 40) {
      this.setCol(this.cols[this.row] + (d.dx < 0 ? 1 : -1));
      return;
    }
    if (!d.hit) {
      if (this.open && e.target === this.root.querySelector('.menu-shade')) this.closePanel();
      return;
    }
    const { row, col } = d.hit;
    if (row !== this.row) this.setRow(row);
    else if (col !== this.cols[this.row]) this.setCol(col);
    else if (!this.open) this.activate();
  }

  onWheel(e) {
    if (!this.active || this.open) return;
    const now = performance.now();
    if (now - (this.wheelAt ?? 0) < 220 || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 8) return;
    this.wheelAt = now;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    this.setCol(this.cols[this.row] + (d > 0 ? 1 : -1));
  }

  hitCard() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    let best = null;
    let bestD = Infinity;
    this.cards[this.row].forEach((c, col) => {
      if (!c.group?.visible || c.opacity < 0.3) return;
      const hit = this.raycaster.intersectObject(c.model, true)[0];
      if (hit && hit.distance < bestD) {
        bestD = hit.distance;
        best = { row: this.row, col };
      }
    });
    return best;
  }

  // ---- Frame ------------------------------------------------------------------------------

  layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const key = `${W}x${H}x${this.mode}`;
    if (key === this.layoutKey) return this.L;
    this.layoutKey = key;
    const L = (this.L = menuLayout(W, H));
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    const px = (v) => `${Math.round(v)}px`;
    const st = this.root.style;
    st.setProperty('--u', String(L.u));
    Object.assign(this.el.logoBox.style, { left: px(L.logo.x), top: px(L.logo.y), width: px(L.logo.w), height: px(L.logo.h) });
    Object.assign(this.el.nav.style, { left: px(L.nav.x), top: px(L.nav.y), width: px(L.nav.w) });
    this.el.plates.forEach((p) => Object.assign(p.style, { height: px(L.nav.plateH), marginBottom: px(L.nav.gap) }));
    Object.assign(this.el.headBox.style, { left: px(L.stage.x), width: px(L.stage.w), top: px(L.headY) });
    Object.assign(this.el.foot.style, { left: px(L.stage.x), width: px(L.stage.w), top: px(L.footY) });
    const ay = L.card.cy;
    // Arrows hug the focused card (the neighbours sit dimmed behind them).
    const ax = L.card.w / 2 + (L.compact ? 10 : 22) * L.u;
    Object.assign(this.el.arrows[0].style, { left: px(Math.max(L.stage.x, L.card.cx - ax - 52 * L.u)), top: px(ay) });
    Object.assign(this.el.arrows[1].style, { left: px(Math.min(L.stage.x + L.stage.w, L.card.cx + ax + 52 * L.u)), top: px(ay) });
    Object.assign(this.el.panel.style, { left: px(L.panel.x), top: px(L.panel.y), width: px(L.panel.w), minHeight: px(L.panel.h) });
    if (this.mode === 'pause') {
      // Centred panel under a centred logo.
      const P = pauseLayout(W, H);
      Object.assign(this.el.logoBox.style, { left: px(P.logo.x), top: px(P.logo.y), width: px(P.logo.w), height: px(P.logo.h) });
      Object.assign(this.el.panel.style, { left: px(P.panel.x), top: px(P.panel.y), width: px(P.panel.w), minHeight: px(P.panel.h) });
    }
    this.el.hint.style.top = px(L.hintY);
    this.root.classList.toggle('compact', L.compact);
    return L;
  }

  /** Screen pixel to the z = 0 plane of the card camera. */
  world(px, py) {
    const L = this.L;
    const aspect = L.W / L.H;
    return new THREE.Vector2((px / L.W * 2 - 1) * VIS_H * aspect / 2, -(py / L.H * 2 - 1) * VIS_H / 2);
  }

  /** Called every frame by the game loop (the game keeps running underneath). */
  update(dt) {
    const target = this.visible && !(this.leaving && this.leaving.t > 0.35) ? 1 : 0;
    this.ash += (target - this.ash) * (1 - Math.exp(-(target ? 4 : 3) * dt));
    if (!target && this.ash < 0.002) this.ash = 0;
    const grade = this.pipeline.gradePass;
    if (grade && this.ash > 0) grade.uniforms.uAsh.value = Math.max(grade.uniforms.uAsh.value, this.ash);
    if (!this.visible) {
      if (this.drawn) {
        this.renderer.clear();
        this.drawn = false;
      }
      return;
    }
    this.time += dt;
    this.introT = (this.introT ?? 0) + dt;
    const L = this.layout();
    if (!this.loaded) return;
    if (!this.active && !this.leaving && this.introT > (this.mode === 'pause' ? 0.12 : 0.35)) this.active = true;
    if (this.mode === 'pause') {
      if (this.drawn) {
        this.renderer.clear();
        this.drawn = false;
      }
      return;
    }
    const k = (L.card.h / L.H * VIS_H) / CARD_H; // world units per card unit
    const base = this.world(L.card.cx, L.card.cy);
    const openBase = this.world(L.openCx, L.card.cy);
    const follow = (a, b, rate) => a + (b - a) * (1 - Math.exp(-rate * dt));
    this.rowAnim = follow(this.rowAnim, this.row, 9);
    this.openT = follow(this.openT, this.open ? 1 : 0, 10);
    const hover = this.active && !this.drag ? this.hitCard() : null;
    const leave = this.leaving;
    MENU_ROWS.forEach((row, ri) => {
      this.colAnim[ri] = follow(this.colAnim[ri], this.cols[ri], 10);
      const rd = ri - this.rowAnim;
      const rowFade = THREE.MathUtils.clamp(1 - Math.abs(rd) * 1.6, 0, 1);
      this.cards[ri].forEach((c, ci) => {
        const d = ci - this.colAnim[ri];
        const ad = Math.abs(d);
        const isFocus = ri === this.row && ci === this.cols[ri];
        // Intro: cards slide in from the right one after another.
        const intro = easeInOut((this.introT - 0.1 - ci * 0.08 - (ri === this.row ? 0 : 0.2)) / 0.6);
        let x = Math.sign(d) * (ad <= 1 ? ad * 0.74 : 0.74 + (ad - 1) * 0.42);
        let y = -rd * 1.18;
        let z = -Math.min(ad, 2) * 0.24;
        let ry = -THREE.MathUtils.clamp(d, -1, 1) * 0.55;
        let rx = 0;
        let rz = 0;
        let scale = 1 - Math.min(ad, 2) * 0.15;
        let dim = 1 - Math.min(ad, 1) * 0.5;
        let fade = rowFade * THREE.MathUtils.clamp(2.3 - ad, 0, 1);
        x += (1 - intro) * 1.6;
        ry += (1 - intro) * -0.9;
        fade *= intro;
        // Focus: lift, bob, hover tilt, nope shake.
        c.focusT = follow(c.focusT, isFocus ? 1 : 0, 8);
        const hovered = hover && hover.row === ri && hover.col === ci;
        c.hoverT = follow(c.hoverT, hovered && !this.open ? 1 : 0, 10);
        y += Math.sin(this.time * 1.5 + ci) * 0.01 * c.focusT;
        if (c.hoverT > 0.001 && isFocus) {
          const wp = this.world((this.pointer.x + 1) / 2 * L.W, (1 - this.pointer.y) / 2 * L.H);
          ry += THREE.MathUtils.clamp((wp.x - base.x) / (k * 0.4), -1, 1) * 0.22 * c.hoverT;
          rx += -THREE.MathUtils.clamp((wp.y - base.y) / (k * 0.5), -1, 1) * 0.16 * c.hoverT;
        }
        if (c.nope > 0) {
          c.nope = Math.max(0, c.nope - dt * 2.2);
          x += Math.sin(c.nope * 30) * 0.035 * c.nope;
        }
        scale *= 1 + c.hoverT * 0.04;
        // Opened: the card steps aside for the panel, the others fade away.
        let px = base.x;
        if (ri === this.row) {
          if (isFocus) px = THREE.MathUtils.lerp(base.x, openBase.x, easeInOut(this.openT));
          else fade *= 1 - this.openT;
        }
        let glow = c.focusT * 0.35 + c.hoverT * 0.25;
        // Leaving: the chosen card flies toward the camera and fades into the game.
        if (leave && isFocus) {
          const a = easeInOut(leave.t / 0.7);
          z += a * 1.2;
          scale *= 1 + a * 0.3;
          rz += a * 0.12;
          fade *= 1 - easeInOut((leave.t - 0.25) / 0.45);
          glow = 0.6 * (1 - a);
        } else if (leave) {
          fade *= 1 - easeInOut(leave.t / 0.35);
        }
        c.opacity = fade;
        c.group.visible = fade > 0.003;
        if (!c.group.visible) return;
        c.group.position.set(px + x * k, base.y + y * k, z * k);
        c.group.rotation.set(rx, ry, rz);
        c.group.scale.setScalar(scale * k);
        dim *= 0.55 + 0.45 * rowFade;
        for (const m of c.mats) {
          m.opacity = fade;
          m.color.copy(m.userData.base).multiplyScalar(dim);
          if (m.userData.emissiveBase) m.emissive.copy(m.userData.emissiveBase).multiplyScalar(dim);
        }
        c.glow.material.opacity = glow * fade;
        // Shine sweep across the focused face.
        if (c.sweep.value < 1.2) c.sweep.value += dt * 1.5;
        if (isFocus && hovered && c.sweep.value >= 1.2 && this.time - (c.sweepAt ?? 0) > 2.5) {
          c.sweep.value = -0.9;
          c.sweepAt = this.time;
        }
        c.sheen.value = 0.45 * c.focusT + 0.25;
      });
    });
    // DOM: the link line from the selected plate to the stage follows the plate.
    const plate = this.el.plates[this.row];
    if (plate) {
      const top = L.nav.y + this.rowAnim * (L.nav.plateH + L.nav.gap) + L.nav.plateH / 2;
      Object.assign(this.el.link.style, { left: `${L.nav.x + L.nav.w}px`, top: `${top}px`, width: `${Math.max(0, L.stage.x - L.nav.x - L.nav.w - 6)}px` });
    }
    if (leave) {
      leave.t += dt;
      if (!leave.fired && leave.t > 0.45) {
        leave.fired = true;
        this.onPlay?.(leave.mode);
      }
      if (leave.t > 0.85) this.hide();
    }
    this.renderer.render(this.scene, this.camera);
    this.drawn = true;
  }
}

/** Segmented meter (10 cells) as HTML. */
function meter(value, max, cls = '') {
  let s = `<span class="pn-meter ${cls}">`;
  for (let i = 0; i < max; i++) s += `<i class="${i < value ? 'on' : ''}"></i>`;
  return `${s}</span>`;
}
