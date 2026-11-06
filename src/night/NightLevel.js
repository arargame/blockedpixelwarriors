import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GameConfig } from '../config/GameConfig.js';
import { Palette } from '../config/Palette.js';
import { EffectsManager } from '../fx/EffectsManager.js';
import { PlayerTank } from '../tank/PlayerTank.js';
import { reticleTexture } from '../ui/Reticle.js';
import { fxRandom as rnd } from '../util/Random.js';
import { createCanvas, canvasToTexture } from '../textures/CanvasUtils.js';
import { WetReflection } from './WetReflection.js';
import { NightTextures } from './NightTextures.js';
import { NightDesk } from './NightDesk.js';
import { BlockWall } from './BlockWall.js';
import { ColorWheel, SHELL_COLORS } from './ColorWheel.js';
import { Gems } from './Gems.js';
import { Rain } from './Rain.js';
import { NIGHT_CAMERA, NIGHT_WHEEL, NIGHT_POSTER } from './NightLayout.js';

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const FEED = Object.freeze({ tank: '#7be86a', enemy: '#ff6b6b', grey: '#c9ced6', gold: '#ffd34a' });
const SCORE = Object.freeze({ block: 10, chain: 5, mine: 50 });
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const shellOf = (id) => SHELL_COLORS.find((c) => c.id === id);

/** Spiky white streak (the key art's plain flak shells), pointing along +x. */
function cometTexture() {
  const W = 256;
  const H = 128;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.translate(W * 0.78, H / 2);
  const grd = g.createLinearGradient(-W * 0.78, 0, W * 0.2, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(W * 0.2, 0);
  // Jagged flame edges.
  for (let i = 0; i <= 14; i++) {
    const x = W * 0.2 - (i / 14) * W * 0.98;
    const r = (1 - i / 14) * H * 0.34 + 3;
    g.lineTo(x, -r * (i % 2 ? 1.25 : 0.7));
  }
  for (let i = 14; i >= 0; i--) {
    const x = W * 0.2 - (i / 14) * W * 0.98;
    const r = (1 - i / 14) * H * 0.34 + 3;
    g.lineTo(x, r * (i % 2 ? 0.7 : 1.25));
  }
  g.closePath();
  g.fill();
  const core = g.createRadialGradient(W * 0.12, 0, 0, W * 0.12, 0, H * 0.3);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(-W, -H, W * 2, H * 2);
  return canvasToTexture(c, { srgb: false });
}

/** Glowing orb: white-hot core, coloured halo. */
function orbTexture() {
  const S = 128;
  const c = createCanvas(S, S);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.22, 'rgba(255,255,255,1)');
  grd.addColorStop(0.32, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return canvasToTexture(c, { srgb: false });
}

/**
 * Scenario 03 NEON RAIN (menu card): the tank in a wooden toy tray on a wet desk by a rainy
 * window at midnight, lit by a brass desk lamp - the key art (assets/textures/menu/night.jpg)
 * as a game scene, laid out and lit after it (NightLayout.js, NightDesk.js; compare with
 * tools/night/compare.mjs).
 *
 * The game is Blocked's colour system on the tank:
 *   - a wall of coloured blocks (BlockWall) rolls down the tray toward the tank's line; a row that
 *     reaches it breaks on the tank (armour);
 *   - the colour wheel (the toy dial on the desk, ColorWheel) picks the shell colour: the black
 *     wedge is the endless plain shell (white flak), each colour has ammo; a shell of the
 *     block's colour breaks it in one hit (a laser of that colour), plain or a wrong colour takes
 *     three;
 *   - a destroyed block takes its same-coloured neighbours with it (chain reaction);
 *   - destroyed blocks sometimes throw a gem of their colour: it hovers in a ring, then flies to
 *     the tank (+ammo);
 *   - spike mines roll out of the wall now and then: shoot them before they reach the tank;
 *   - every shot also throws two pink plasma orbs to the sides (the key art's fan).
 * Aiming is the tank level's auto aim (the selected colour's blocks first, then the closest to
 * the line, mines before anything); Q / E or the left / right arrows (phones: the two buttons)
 * turn the barrel instead.
 * Controls: W/S drive, A/D turn the hull, Q/E or left/right arrows the barrel, up/down arrows or
 * the mouse wheel step the colour wheel, 1-5 pick a colour, click / tap the dial (or the chips)
 * for the next colour, SPACE fires at will. ESC pause menu, ENTER restarts a finished game. Own
 * scene, fixed key-art camera, lights and post look (pushed onto the pipeline).
 */
export class NightLevel {
  constructor({ tankGltf, deskGltf, wheelGltf, gemGltf, textures, materials, renderer, input, quality, hud, environment }) {
    const N = GameConfig.night;
    this.input = input;
    this.ui = hud ?? null;
    this.renderer = renderer;
    this.element = renderer.domElement;
    const low = !quality || quality.msaa === 0;
    this.low = low;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070d);
    this.scene.fog = new THREE.FogExp2(0x0a1020, 0.006);
    // Night reflections: a small light room (warm lamp, blue window, pink neon) instead of the
    // heli game's daylight sky, so the glossy blocks and the wet wood mirror the art's lights.
    this.scene.environment = this.nightEnvironment(renderer) ?? environment ?? null;
    this.scene.environmentIntensity = 1;
    this.camera = new THREE.PerspectiveCamera(NIGHT_CAMERA.fov, 1672 / 941, 0.5, 300);
    this.camera.userData.baseFov = NIGHT_CAMERA.fov;
    // Layer 0 only: the out-of-focus plants (FOREGROUND layer) come in through the blur pass.
    this.camBase = new THREE.Vector3(...NIGHT_CAMERA.position);
    this.camQuat = new THREE.Quaternion(...NIGHT_CAMERA.quaternion);

    this.reflection = new WetReflection(renderer, { enabled: !low, scale: 0.5 });
    this.nightTextures = new NightTextures();
    this.desk = new NightDesk(deskGltf, this.nightTextures, this.reflection, materials, { shadowMap: low ? 1024 : 2048 });
    this.scene.add(this.desk.group);

    const debris = new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.6 });
    this.effects = new EffectsManager(this.scene, textures, debris, () => 0, { flashLights: 3 });
    this.wall = new BlockWall(textures, this.effects, this.nightTextures);
    this.scene.add(this.wall.group);
    // The desk's loose cubes wear the wall's wet cracked material.
    for (const c of this.desk.cubes) c.material = this.wall.meshes[c.userData.color].material;
    this.wall.onDestroyed = (b, depth, at, id) => this.onBlockDestroyed(b, depth, at, id);
    this.wall.onBreach = (blocks) => this.onBreach(blocks);
    this.materials = materials;

    this.wheel = new ColorWheel(wheelGltf, this.scene);
    this.wheel.place(NIGHT_WHEEL);

    this.gems = new Gems(this.scene, this.effects, gemGltf);
    this.gems.onCollect = (color) => this.onGem(color);

    this.tank = new PlayerTank(tankGltf);
    this.tank.root.scale.setScalar(N.tankScale);
    this.tank.half = { x: 2.0 * N.tankScale, z: 2.25 * N.tankScale };
    this.scene.add(this.tank.root);
    const Z = N.tankZone;
    this.tank.bounds = { minX: Z.minX, maxX: Z.maxX, minZ: Z.minZ, maxZ: Z.maxZ };
    this.tank.heightAt = () => 0;
    this.tank.collide = () => this.collideTank();
    // The muzzle's glow on the hull (the key art's tank shines green in its own laser light).
    this.tankGlow = new THREE.PointLight(0xb8ffb0, 6, 7, 1.6);
    this.tankGlow.position.set(0, 4, 2);
    this.tank.root.add(this.tankGlow);

    // Lights shine on every layer (the blurred foreground plants too).
    this.scene.traverse((o) => {
      if (o.isLight) o.layers.enableAll();
    });
    this.mineTemplate = deskGltf?.scene.getObjectByName('SpikeMine') ?? null;
    this.mines = [];

    this.rain = new Rain(this.scene, { drops: low ? 3500 : 8000, ripples: low ? 320 : 700, box: new THREE.Vector3(44, 30, 30) });
    this.rain.setLights(this.desk.rainLights);
    this.reflection.hidden = [...this.desk.floors, this.rain.streaks, this.rain.ripples];

    // Shots: colour lasers (instant), plain flak comets, pink plasma orbs.
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0);
    this.beams = [];
    this.cometTex = cometTexture();
    this.orbTex = orbTexture();
    this.shots = [];
    this.loose = [];

    this.reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleTexture(), depthTest: false, transparent: true }));
    this.reticle.renderOrder = 30;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
    this.reticleSpin = 0;

    this.aim = new THREE.Vector3(0, 0, 20);
    this.exposed = [];
    this.touch = { left: false, right: false };
    this.pressed = new Set();
    this.raycaster = new THREE.Raycaster();
    this.buildHud();
    this.onPointerDown = (e) => this.pointerDown(e);
    this.onWheel = (e) => {
      if (!this.active || this.paused) return;
      this.wheel.next(e.deltaY > 0 ? 1 : -1);
    };
  }

  /** PMREM of a dark room with the art's light sources as glowing cards. */
  nightEnvironment(renderer) {
    try {
      const room = new THREE.Scene();
      room.background = new THREE.Color(0x020306);
      const card = (w, h, color, pos, look) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
        m.position.set(...pos);
        m.lookAt(...look);
        room.add(m);
      };
      // Window behind the tray: wide cold blue, a cyan strip and pink signs.
      card(60, 18, new THREE.Color(0.08, 0.2, 0.5), [0, 8, 30], [0, 0, 0]);
      card(18, 1.2, new THREE.Color(0.4, 1.6, 2.2), [-8, 12, 29], [0, 0, 0]);
      card(2, 9, new THREE.Color(2.2, 0.35, 1.4), [-14, 10, 28], [0, 0, 0]);
      // The desk lamp, high on the left.
      card(6, 6, new THREE.Color(3.2, 1.6, 0.6), [14, 12, 4], [0, 0, 0]);
      // Dim warm room behind the camera, dark floor.
      card(60, 20, new THREE.Color(0.05, 0.035, 0.03), [0, 10, -30], [0, 0, 0]);
      card(80, 80, new THREE.Color(0.012, 0.01, 0.008), [0, -12, 0], [0, 0, 0]);
      const pm = new THREE.PMREMGenerator(renderer);
      const tex = pm.fromScene(room, 0.03).texture;
      pm.dispose();
      return tex;
    } catch {
      return null;
    }
  }

  // ---- HUD (the shared heli HUD + the night extras) -------------------------------------------

  buildHud() {
    const el = document.createElement('div');
    el.className = 'tank-hud night-hud';
    el.innerHTML = `
      <div class="th-banner" data-banner></div>
      <div class="th-keys"><b>W S</b> drive · <b>A D</b> turn hull · <b>← →</b> / <b>Q E</b> barrel · <b>↑ ↓</b> / <b>wheel</b> / <b>1-5</b> colour · <b>SPACE</b> fire · <b>ESC</b> menu</div>
      <div class="nw-chips" data-chips>${SHELL_COLORS.map((c, i) => `<button class="nw-chip" data-c="${c.id}" style="--c:${css(c.chip)}"><i></i><b>${c.block ? '0' : '∞'}</b><small>${i + 1}</small></button>`).join('')}</div>
      <div class="th-touch">
        <button class="th-btn" data-tl aria-label="barrel left">&#9664;</button>
        <button class="th-btn" data-tr aria-label="barrel right">&#9654;</button>
      </div>
      <div class="th-stick" data-stick><i></i></div>
      <div class="th-reload"><i></i></div>`;
    el.style.display = 'none';
    this.hud = el;
    this.reloadBar = el.querySelector('.th-reload i');
    this.hudEl = {
      banner: el.querySelector('[data-banner]'), keys: el.querySelector('.th-keys'), stick: el.querySelector('[data-stick]'),
      chips: Object.fromEntries([...el.querySelectorAll('.nw-chip')].map((b) => [b.dataset.c, b])),
    };
    for (const [id, b] of Object.entries(this.hudEl.chips)) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.wheel.select(id)) this.ui?.notice(`NO ${shellOf(id).name} AMMO`, '#ff8a7a');
      });
    }
    (this.element.parentElement ?? document.body).appendChild(el);
    const hold = (sel, key) => {
      const b = el.querySelector(sel);
      const on = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.touch[key] = true;
      };
      const off = (e) => {
        e.preventDefault();
        this.touch[key] = false;
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
    };
    hold('[data-tl]', 'left');
    hold('[data-tr]', 'right');
  }

  showBanner(title, sub, cls) {
    this.hudEl.banner.innerHTML = `<b>${title}</b><span>${sub}</span>`;
    this.hudEl.banner.className = `th-banner show ${cls}`;
  }

  /** Bloom / grade for the night (restored by stop()). */
  pushLook(pipeline) {
    this.pipeline = pipeline;
    const g = pipeline.gradePass?.uniforms;
    const b = pipeline.bloomPass;
    this.savedLook = {
      grade: g && { exp: g.uExposure.value, sat: g.uSaturation.value, con: g.uContrast.value, vig: g.uVignette.value, sun: g.uSunStrength.value, tint: g.uTint.value.clone() },
      bloom: b && { s: b.strength, r: b.radius, t: b.threshold },
      lensK: pipeline.lensPass?.uniforms.uK.value,
    };
    // The key art is a plain perspective (no lens barrel).
    if (pipeline.lensPass) pipeline.lensPass.uniforms.uK.value = 0;
    if (g) {
      g.uExposure.value = 1.0;
      g.uSaturation.value = 1.45;
      g.uContrast.value = 1.12;
      g.uVignette.value = 0.95;
      g.uSunStrength.value = 0;
      g.uTint.value.setRGB(1.0, 0.98, 1.02);
    }
    if (b) {
      b.strength = 0.55;
      b.radius = 0.45;
      b.threshold = 1.0;
    }
  }

  popLook() {
    const p = this.pipeline;
    const L = this.savedLook;
    if (!p || !L) return;
    const g = p.gradePass?.uniforms;
    if (g && L.grade) {
      g.uExposure.value = L.grade.exp;
      g.uSaturation.value = L.grade.sat;
      g.uContrast.value = L.grade.con;
      g.uVignette.value = L.grade.vig;
      g.uSunStrength.value = L.grade.sun;
      g.uTint.value.copy(L.grade.tint);
    }
    if (p.lensPass && L.lensK !== undefined) p.lensPass.uniforms.uK.value = L.lensK;
    if (p.bloomPass && L.bloom) {
      p.bloomPass.strength = L.bloom.s;
      p.bloomPass.radius = L.bloom.r;
      p.bloomPass.threshold = L.bloom.t;
    }
    this.savedLook = null;
  }

  // ---- Lifecycle --------------------------------------------------------------------------------

  start() {
    const N = GameConfig.night;
    this.active = true;
    this.paused = false;
    const t = this.tank;
    t.root.position.set(0, 0, -3.4);
    t.heading = 0;
    t.speed = 0;
    t.turnRate = 0;
    t.turretYaw = 0;
    t.recoil = 0;
    t.recoilVel = 0;
    t.cooldown = 0;
    t.elevation = t.aimElevation = 0.05;
    this.lock = null;
    this.manualAim = 0;
    this.time = 0;
    this.hp = GameConfig.tank.hp;
    this.broken = 0;
    this.score = 0;
    this.bestChain = 0;
    this.breaches = 0;
    this.shake = 0;
    this.state = 'playing';
    this.mineTimer = N.mine.first;
    this.wall.reset();
    this.wheel.reset(N.startAmmo);
    this.gems.clear();
    this.clearShots();
    this.clearMines();
    this.clearLoose();
    this.hudEl.banner.className = 'th-banner';
    this.hudEl.keys.classList.remove('faded');
    const ui = this.ui;
    if (ui) {
      ui.clearLog();
      ui.setLives(0);
      ui.setWaveLabel('SCENARIO');
      ui.setWave(3);
      ui.setSkills(new Map());
      ui.toast(`NEON RAIN - BREAK ${N.goal} BLOCKS · MATCH THE WHEEL`);
    }
    this.aim.set(0, 0, 20);
    this.updateCamera(0);
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('wheel', this.onWheel, { passive: true });
    this.hud.style.display = '';
    this.wall.render();
  }

  stop() {
    this.active = false;
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('wheel', this.onWheel);
    this.hud.style.display = 'none';
    this.popLook();
  }

  /**
   * The key-art moment (poster and the comparison tool): the wall as in the art, loose cubes
   * knocked about, the two mines, the red gem in its ring, the tank firing its laser, the fan
   * of plasma orbs and flak comets, explosions on both sides, the HUD hidden.
   */
  stagePoster() {
    const P = NIGHT_POSTER;
    this.poster = true;
    this.wall.stage(P.rows);
    this.wall.paused = true;
    this.clearLoose();
    const geo = new RoundedBoxGeometry(1, 1, 1, 3, 0.07);
    for (const [color, x, y, z, s, r] of P.loose) {
      const m = new THREE.Mesh(geo, this.wall.meshes[color].material);
      m.scale.setScalar(s);
      m.position.set(x, y + s / 2, z);
      m.rotation.set(...r);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this.loose.push(m);
    }
    this.clearMines();
    for (const [x, z] of P.mines) this.spawnMine(x, z, true);
    this.gems.clear();
    this.gems.spawn(P.gem.color, new THREE.Vector3(P.gem.x, 1, P.gem.z), P.gem.x, P.gem.z, { frozen: true });
    const t = this.tank;
    t.root.position.set(P.tank.x, 0, P.tank.z);
    t.heading = P.tank.heading;
    t.turretYaw = 0;
    this.wheel.select('green');
    // Frozen shots: the green laser up the middle, the orb fan, the flak comets.
    this.clearShots();
    t.update(0, { throttle: 0, turn: 0, turret: 0 }, null);
    t.root.updateMatrixWorld(true);
    const muzzle = t.muzzle.getWorldPosition(new THREE.Vector3());
    this.addBeam(muzzle, new THREE.Vector3(P.tank.x - 0.1, 1.2, 4.4), shellOf('green').hex, 99);
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      const k = Math.floor(i / 2);
      const a = side * (0.2 + k * 0.17);
      const d = 3.5 + k * 1.6;
      const p = new THREE.Vector3(P.tank.x + Math.sin(a) * d * 1.3, 1.1, P.tank.z + 2 + Math.cos(a) * d);
      this.addOrb(p, new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(20), true);
    }
    for (const [x, z, a] of [[3.1, -0.6, -0.55], [-3.6, -1.2, 0.6], [2.0, -2.4, -0.75], [-2.0, -2.6, 0.7], [-6.3, -4.5, 1.35]]) {
      this.addComet(new THREE.Vector3(x, 1.1, z), new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(30), true);
    }
    this.effects.explosion(new THREE.Vector3(6.2, 1.4, 3.6), 1.1, null, 0);
    this.effects.explosion(new THREE.Vector3(-5.7, 1.6, 6.1), 1.3, null, 0);
    this.effects.shatter(new THREE.Vector3(-5.7, 1.6, 6.1), Palette.blocks.red, 18, 1.2, [0.2, 0.5]);
    this.effects.shatter(new THREE.Vector3(6.2, 1.4, 3.6), Palette.blocks.yellow, 14, 1.2, [0.2, 0.5]);
    this.hud.style.display = 'none';
    if (this.ui) this.ui.root.style.display = 'none';
  }

  pointerDown(e) {
    if (!this.active || this.paused) return;
    if (this.wheel.root) {
      const r = this.element.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      if (this.raycaster.intersectObject(this.wheel.root, true).length) {
        this.wheel.next();
        return;
      }
    }
    if (e.pointerType === 'mouse' && e.button === 0) this.fireQueued = true;
  }

  edge(code) {
    const down = this.input.keys.has(code);
    const was = this.pressed.has(code);
    if (down) this.pressed.add(code);
    else this.pressed.delete(code);
    return down && !was;
  }

  update(dt) {
    const keys = this.input.keys;
    const k = (...codes) => codes.some((c) => keys.has(c));
    if ((this.state === 'lost' || this.state === 'won') && k('Enter', 'NumpadEnter') && this.time > 2) {
      keys.delete('Enter');
      this.start();
      return;
    }
    if (this.edge('ArrowUp')) this.wheel.prev();
    if (this.edge('ArrowDown')) this.wheel.next();
    SHELL_COLORS.forEach((c, i) => {
      if (this.edge(`Digit${i + 1}`) && !this.wheel.select(c.id)) this.ui?.notice(`NO ${c.name} AMMO`, '#ff8a7a');
    });
    const driving = this.state === 'playing' || this.state === 'won';
    const drive = driving ? {
      throttle: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
      turn: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0),
      turret: (k('KeyQ', 'ArrowLeft') || this.touch.left ? 1 : 0) - (k('KeyE', 'ArrowRight') || this.touch.right ? 1 : 0),
    } : { throttle: 0, turn: 0, turret: 0 };
    if (driving && this.input.dragging && !drive.throttle && !drive.turn) Object.assign(drive, this.stickDrive(this.input.move.x, this.input.move.z));
    this.step(dt, drive, driving && (this.fireQueued || keys.has('Space')));
    this.fireQueued = false;
  }

  stickDrive(sx, sy) {
    const mag = Math.min(1, Math.hypot(sx, sy));
    if (mag < 0.12) return { throttle: 0, turn: 0 };
    const err = wrap(Math.atan2(-sx, -sy) - this.tank.heading);
    return { throttle: mag * Math.max(0, Math.cos(err)) ** 2, turn: -THREE.MathUtils.clamp(err * 2.5, -1, 1) };
  }

  /** One simulation step (also driven by test scripts). */
  step(dt, drive, fire) {
    const N = GameConfig.night;
    const t = this.tank;
    this.time += dt;
    const playing = this.state === 'playing' && !this.poster;
    this.wall.speed = Math.min(N.speedMax, N.speed + this.broken * N.speedGrowth);
    // A thin wall rushes in (rows keep coming at the top while the field is nearly clear).
    if (this.wall.rows.length < N.startRows && this.wall.spawned < N.totalRows) this.wall.speed *= 6;
    this.wall.update(dt, !playing);
    if (playing) this.updateMineSpawns(dt);

    const manual = !!drive.turret;
    this.manualAim = manual ? GameConfig.tank.manualHold : Math.max(0, this.manualAim - dt);
    const auto = this.manualAim <= 0;
    this.aim.set(t.position.x + Math.sin(t.gunYaw) * 20, 0, t.position.z + Math.cos(t.gunYaw) * 20);
    const lock = playing ? this.lockedTarget(auto) : null;
    const lockPoint = lock ? this.targetPoint(lock, v3) : null;
    t.update(dt, this.poster ? { throttle: 0, turn: 0, turret: 0 } : drive, auto ? lockPoint : null);
    this.aim.set(t.position.x + Math.sin(t.gunYaw) * 20, 0, t.position.z + Math.cos(t.gunYaw) * 20);
    const target = lockPoint ?? v2.set(this.aim.x, 0.75, Math.min(this.aim.z, N.maxZ));
    this.aimBarrel(target);
    this.updateReticle(dt, lock, target);
    let autoShot = false;
    if (lock && auto && playing) {
      const off = Math.abs(wrap(Math.atan2(lockPoint.x - t.position.x, lockPoint.z - t.position.z) - t.gunYaw));
      if (off < GameConfig.tank.autoFireAngle) autoShot = true;
    }
    if (playing && (fire || autoShot)) this.fire(autoShot && !fire ? lock : null);

    this.updateShots(dt);
    this.updateMines(dt);
    this.gems.update(dt, t.position);
    this.wheel.update(dt);
    this.desk.update(dt);
    this.effects.update(dt);
    this.updateCamera(dt);
    this.rain.update(dt, v1.set(0, 0, 3), this.desk.flash);
    if (!this.poster) this.updateHud(dt);
    this.checkEnd();
    this.camera.updateMatrixWorld();
    this.reflection.update(this.scene, this.camera, this.time);
  }

  // ---- Aiming and shooting --------------------------------------------------------------------

  targetPoint(target, out) {
    if (target.isMine) return out.set(target.root.position.x, 0.7, target.root.position.z);
    return this.wall.center(target, out);
  }

  /**
   * The locked target: a mine rolling at the tank first; otherwise an exposed block (front of its
   * column), scored by turret swing and distance, the selected colour's blocks and the blocks
   * near the line first.
   */
  lockedTarget(auto) {
    const cfg = GameConfig.tank;
    const N = GameConfig.night;
    const L = this.lock;
    const alive = (o) => (o.isMine ? o.alive : o.alive && !o.doomed && o.serial === L.serial);
    const held = L && alive(L.block);
    if (held && L.auto === auto && this.time - L.at < cfg.lockRefresh) return L.block;
    const p = this.tank.position;
    const yaw = Math.atan2(this.aim.x - p.x, this.aim.z - p.z);
    const want = this.wheel.color.block;
    let best = null;
    let bestScore = Infinity;
    const consider = (o, c, bonus) => {
      const dx = c.x - p.x;
      const dz = c.z - p.z;
      const d = Math.hypot(dx, dz);
      const ang = Math.abs(wrap(Math.atan2(dx, dz) - yaw));
      if (!auto && ang > cfg.aimCone) return;
      const mine = held && L.block === o;
      const score = auto ? ang * cfg.autoSwingWeight + d * 0.25 + bonus - (mine ? cfg.autoKeep : 0) : ang * 12 + d * 0.35 - (mine ? 0.6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    };
    for (const m of this.mines) if (m.alive && !m.frozen) consider(m, m.root.position, -14);
    for (const b of this.wall.exposed(this.exposed)) {
      const c = this.wall.center(b, v1);
      const urgency = Math.max(0, 6 - (c.z - N.deadline)) * 0.6;
      consider(b, c, (want && b.color !== want ? 9 : 0) - urgency);
    }
    this.lock = best ? { block: best, serial: best.serial, at: this.time, auto } : null;
    return best;
  }

  aimBarrel(target) {
    const t = this.tank;
    t.turret.updateWorldMatrix(true, false);
    const pivot = t.turret.localToWorld(v1.copy(t.barrelHome));
    const h = Math.hypot(target.x - pivot.x, target.z - pivot.z);
    t.aimElevation = Math.atan2(target.y - pivot.y, Math.max(h, 0.5));
  }

  updateReticle(dt, lock, target) {
    const r = this.reticle;
    r.visible = this.state === 'playing' && !this.poster;
    if (!r.visible) return;
    this.reticleSpin += dt * (lock ? 2 : 0.8);
    r.position.copy(target);
    r.material.rotation = this.reticleSpin;
    r.material.opacity = lock ? 1 : 0.4;
    r.scale.setScalar(lock ? 2.2 + Math.sin(this.reticleSpin * 3) * 0.14 : 1.8);
  }

  /**
   * Fires. A coloured shell is a laser of that colour (instant, up to the first block); a plain
   * one a white flak comet. Auto shots use the selected colour only on a block of that colour
   * (plain otherwise, no colour wasted). Every shot throws two plasma orbs to the sides.
   */
  fire(lock) {
    const N = GameConfig.night;
    const shot = this.tank.fire(N.reload / GameConfig.tank.reload);
    if (!shot) return;
    const sel = this.wheel.color;
    const id = lock && !lock.isMine && sel.block && lock.color !== sel.block ? 'black' : lock?.isMine ? 'black' : sel.id;
    this.wheel.spend(id);
    const col = shellOf(id);
    const { muzzle, dir } = shot;
    const tint = new THREE.Color(col.block ? col.hex : 0xfff2d8);
    this.effects.muzzleFlash(muzzle, dir, [tint.r * 4, tint.g * 4, tint.b * 4, 1], 1.1);
    this.effects.flash(muzzle, col.block ? col.hex : 0xffe6c0, 50, 0.2, 10);
    this.shake = Math.max(this.shake, 0.15);
    const aimDir = lock ? this.targetPoint(lock, v1).sub(muzzle).normalize() : dir.clone();
    if (col.block) this.laser(muzzle, aimDir, col);
    else this.addComet(muzzle, aimDir.multiplyScalar(N.shellSpeed));
    for (const side of [-1, 1]) {
      const d = aimDir.clone().applyAxisAngle(UP, side * (0.35 + rnd.next() * 0.25));
      d.y = 0;
      this.addOrb(muzzle.clone(), d.normalize().multiplyScalar(22));
    }
  }

  /** Laser: straight to the first block (or mine, or the tray's far side), damage at once. */
  laser(from, dir, col) {
    const N = GameConfig.night;
    const p = from.clone();
    const step = dir.clone().multiplyScalar(0.3);
    let hit = null;
    for (let i = 0; i < 120; i++) {
      p.add(step);
      const m = this.mineAt(p);
      if (m) {
        this.damageMine(m, 3, p);
        hit = p;
        break;
      }
      const b = this.wall.blockAt(p.x, p.z);
      if (b) {
        this.wall.damage(b, col.block, p.clone());
        hit = p;
        break;
      }
      if (Math.abs(p.x) > N.maxX || p.z > N.maxZ || p.z < N.minZ) {
        hit = p;
        break;
      }
    }
    const end = hit ?? p;
    this.addBeam(from, end, col.hex, 0.16);
    const c = new THREE.Color(col.hex);
    this.effects.impact(end, [c.r * 5, c.g * 5, c.b * 5, 1]);
  }

  addBeam(from, to, hex, life) {
    const c = new THREE.Color(hex);
    const core = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).lerp(c, 0.25).multiplyScalar(6), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glow = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.5), toneMapped: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    const len = from.distanceTo(to);
    for (const [m, w] of [[core, 0.05], [glow, 0.22]]) {
      m.position.copy(from);
      m.quaternion.setFromUnitVectors(UP, v1.copy(to).sub(from).normalize());
      m.scale.set(w, len, w);
      m.renderOrder = 16;
      this.scene.add(m);
    }
    this.beams.push({ core, glow, life, max: life });
  }

  /** Plain flak shell: a white spiky comet. */
  addComet(pos, vel, frozen = false) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.cometTex, color: new THREE.Color(1.3, 1.3, 1.35), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    s.scale.set(2.2, 1.0, 1);
    s.center.set(0.78, 0.5);
    s.position.copy(pos);
    s.renderOrder = 17;
    this.scene.add(s);
    this.shots.push({ kind: 'comet', mesh: s, pos: pos.clone(), vel: vel.clone(), life: 1.4, frozen, damage: GameConfig.night.plainDamage, shell: null });
  }

  /** Pink plasma orb (blue trail). */
  addOrb(pos, vel, frozen = false) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.orbTex, color: new THREE.Color(2.2, 0.6, 1.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    s.scale.setScalar(0.7);
    s.position.copy(pos);
    s.renderOrder = 17;
    this.scene.add(s);
    const trail = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.45, 1.9), toneMapped: false, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    trail.renderOrder = 16;
    this.scene.add(trail);
    this.shots.push({ kind: 'orb', mesh: s, trail, pos: pos.clone(), vel: vel.clone(), life: 1.2, frozen, damage: GameConfig.night.plainDamage, shell: null });
  }

  updateShots(dt) {
    const N = GameConfig.night;
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= this.poster ? 0 : dt;
      const k = Math.max(0, b.life / b.max);
      b.core.material.opacity = k;
      b.glow.material.opacity = 0.55 * k;
      if (b.life <= 0) {
        b.core.removeFromParent();
        b.glow.removeFromParent();
        b.core.material.dispose();
        b.glow.material.dispose();
        this.beams.splice(i, 1);
      }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      let done = false;
      if (!s.frozen) {
        s.life -= dt;
        const steps = Math.max(1, Math.ceil((s.vel.length() * dt) / 0.3));
        for (let k = 0; k < steps && !done; k++) {
          s.pos.addScaledVector(s.vel, dt / steps);
          const m = this.mineAt(s.pos);
          if (m) {
            this.damageMine(m, 1, s.pos);
            done = true;
            break;
          }
          const b = this.wall.blockAt(s.pos.x, s.pos.z);
          if (b) {
            this.wall.damage(b, s.shell, s.pos.clone());
            this.effects.impact(s.pos, s.kind === 'orb' ? [3.5, 1, 3, 1] : [4, 4, 4, 1]);
            done = true;
          } else if (Math.abs(s.pos.x) > N.maxX + 0.2 || s.pos.z > N.maxZ + 0.2 || s.pos.z < N.minZ - 1) {
            this.effects.sparkBurst(s.pos, 6, 4, [3, 2.6, 2.6, 1]);
            done = true;
          }
        }
      }
      if (done || s.life <= 0) {
        s.mesh.removeFromParent();
        s.mesh.material.dispose();
        s.trail?.removeFromParent();
        s.trail?.material.dispose();
        this.shots.splice(i, 1);
        continue;
      }
      s.mesh.position.copy(s.pos);
      if (s.kind === 'comet') {
        // Sprite rotation: the velocity's direction on screen.
        v1.copy(s.pos).project(this.camera);
        v2.copy(s.pos).add(s.vel).project(this.camera);
        s.mesh.material.rotation = Math.atan2((v2.y - v1.y) / this.camera.aspect, v2.x - v1.x) + Math.PI;
      } else if (s.trail) {
        const back = v1.copy(s.vel).normalize().multiplyScalar(-1.6);
        s.trail.position.copy(s.pos).add(back);
        s.trail.quaternion.setFromUnitVectors(UP, v2.copy(s.vel).normalize());
        s.trail.scale.set(0.13, 1.6, 0.13);
        if (!s.frozen && rnd.next() < 0.6) {
          this.effects.fire.emit({ x: s.pos.x, y: s.pos.y, z: s.pos.z, life: rnd.range(0.15, 0.3), size0: 0.4, size1: 0.05, color0: [0.6, 1.4, 4, 1], color1: [0.2, 0.4, 1.5, 0] });
        }
      }
    }
  }

  clearShots() {
    for (const b of this.beams) {
      b.core.removeFromParent();
      b.glow.removeFromParent();
    }
    this.beams.length = 0;
    for (const s of this.shots) {
      s.mesh.removeFromParent();
      s.trail?.removeFromParent();
    }
    this.shots.length = 0;
  }

  clearLoose() {
    for (const m of this.loose) m.removeFromParent();
    this.loose.length = 0;
  }

  // ---- Mines ----------------------------------------------------------------------------------

  spawnMine(x, z, frozen = false) {
    if (!this.mineTemplate) return null;
    const root = this.mineTemplate.clone(true);
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    root.position.set(x, 0, z);
    root.scale.setScalar(0.95);
    this.scene.add(root);
    const m = { isMine: true, root, alive: true, hp: GameConfig.night.mine.hp, frozen, spin: 0, serial: 0 };
    this.mines.push(m);
    return m;
  }

  updateMineSpawns(dt) {
    const M = GameConfig.night.mine;
    this.mineTimer -= dt;
    if (this.mineTimer > 0) return;
    this.mineTimer = M.every[0] + rnd.next() * (M.every[1] - M.every[0]);
    const front = this.wall.rows[0];
    const z = front ? front.z - 1.6 : GameConfig.night.maxZ - 2;
    this.spawnMine(rnd.range(-7, 7), z);
    this.ui?.log([['● SPIKE MINE ROLLING IN', '#ff8a7a']], { kind: 'event' });
  }

  mineAt(p) {
    for (const m of this.mines) {
      if (m.alive && Math.hypot(m.root.position.x - p.x, m.root.position.z - p.z) < GameConfig.night.mine.radius && p.y < 1.9) return m;
    }
    return null;
  }

  damageMine(m, dmg, at) {
    m.hp -= dmg;
    this.effects.sparkBurst(at, 8, 6, [4, 4, 4, 1]);
    if (m.hp <= 0) this.killMine(m, true);
  }

  killMine(m, shot) {
    m.alive = false;
    const p = m.root.position.clone().add(v1.set(0, 0.8, 0));
    this.effects.explosion(p, 1.2, null, 0);
    this.effects.shatter(p, 0x3a3e45, 14, 1.2, [0.15, 0.35]);
    this.effects.flash(p, 0xffa040, 50, 0.3, 9);
    m.root.removeFromParent();
    if (shot) {
      this.score += SCORE.mine;
      this.ui?.kill('TANK', FEED.tank, 'SPIKE MINE', FEED.enemy, `+${SCORE.mine}`, FEED.gold);
    }
  }

  updateMines(dt) {
    const M = GameConfig.night.mine;
    const t = this.tank.position;
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      if (!m.alive) {
        this.mines.splice(i, 1);
        continue;
      }
      if (m.frozen || this.state !== 'playing') continue;
      // Roll toward the tank.
      const dx = t.x - m.root.position.x;
      const dz = t.z - m.root.position.z;
      const d = Math.hypot(dx, dz);
      const vx = (dx / Math.max(d, 1e-3)) * M.speed;
      const vz = (dz / Math.max(d, 1e-3)) * M.speed;
      m.root.position.x += vx * dt;
      m.root.position.z += vz * dt;
      m.root.rotation.x += (vz / M.radius) * dt;
      m.root.rotation.z -= (vx / M.radius) * dt;
      if (d < M.radius + 1.3) {
        this.killMine(m, false);
        this.hp = Math.max(0, this.hp - M.damage);
        this.shake = Math.max(this.shake, 0.7);
        this.ui?.damageFlash(0.8);
        this.ui?.notice(`MINE HIT  -${M.damage} ARMOR`, '#ff6b6b');
      }
    }
  }

  clearMines() {
    for (const m of this.mines) m.root.removeFromParent();
    this.mines.length = 0;
  }

  /** Mines push the tank (solid). */
  collideTank() {
    const p = this.tank.root.position;
    for (const m of this.mines) {
      if (!m.alive) continue;
      const dx = p.x - m.root.position.x;
      const dz = p.z - m.root.position.z;
      const d = Math.hypot(dx, dz);
      const min = GameConfig.night.mine.radius + 1.2;
      if (d < min && d > 1e-3) {
        p.x += (dx / d) * (min - d);
        p.z += (dz / d) * (min - d);
      }
    }
  }

  // ---- Game events ------------------------------------------------------------------------------

  onBlockDestroyed(b, depth, at, chain) {
    const N = GameConfig.night;
    this.broken += 1;
    this.score += SCORE.block + (chain.size >= 3 ? SCORE.chain * chain.size : 0);
    this.shake = Math.max(this.shake, depth > 0 ? 0.1 : 0.16);
    if (chain.size > this.bestChain) this.bestChain = chain.size;
    for (const n of [5, 10, 15, 20]) {
      if (chain.size === n) this.ui?.kill('CHAIN', css(Palette.blocks[b.color]), `×${n}`, FEED.gold, `+${SCORE.chain * n}`, FEED.gold);
    }
    if (this.state === 'playing' && rnd.next() < N.gemChance) {
      const front = this.wall.rows[0];
      const hz = THREE.MathUtils.clamp((front ? front.z : at.z) - 2.2, N.deadline + 0.8, N.maxZ - 1);
      this.gems.spawn(b.color, at, THREE.MathUtils.clamp(at.x, N.minX + 1, N.maxX - 1), hz);
    }
    if (this.broken % 100 === 0) this.ui?.kill('TANK', FEED.tank, `${this.broken} BLOCKS`, FEED.grey, `/ ${N.goal}`, FEED.gold);
  }

  onBreach(blocks) {
    if (this.state !== 'playing') return;
    const dmg = blocks.length * GameConfig.night.breachDamage;
    this.hp = Math.max(0, this.hp - dmg);
    this.breaches += 1;
    this.shake = Math.max(this.shake, 0.8);
    this.ui?.damageFlash(Math.min(1, 0.4 + dmg / 40));
    this.ui?.notice(`WALL BREACH  -${dmg} ARMOR`, '#ff6b6b');
  }

  onGem(color) {
    const N = GameConfig.night;
    this.wheel.add(color, N.gemAmmo);
    const c = shellOf(color);
    this.ui?.kill('TANK', FEED.tank, `+${N.gemAmmo} ${c.name}`, css(c.chip));
  }

  checkEnd() {
    const N = GameConfig.night;
    if (this.state !== 'playing' || this.poster) return;
    if (this.hp <= 0) {
      this.state = 'lost';
      this.time = 0;
      this.showBanner('TANK CRUSHED', 'The wall broke through - match the wheel to its colours · ENTER to try again', 'lost');
      this.effects.explosion(this.tank.position.clone().add(v1.set(0, 1, 0)), 2.0, null, 0);
      return;
    }
    if (this.broken >= N.goal || this.wall.finished) {
      this.state = 'won';
      this.time = 0;
      this.showBanner('TRAY CLEAR!', `${this.broken} blocks · best chain ×${this.bestChain} · ENTER to play again`, 'won');
      this.ui?.toast('NEON RAIN CLEAR', '#ffd34a');
      let tt = 0;
      for (const r of this.wall.rows) {
        for (const blk of r.cells) {
          if (!blk || blk.doomed) continue;
          blk.doomed = true;
          this.wall.chain.push({ b: blk, serial: blk.serial, t: (tt += 0.025), depth: 1, id: { size: 0, color: blk.color } });
        }
      }
    }
  }

  // ---- Camera and HUD ---------------------------------------------------------------------------

  /** The key art's camera (fixed), with a little shake. */
  updateCamera(dt) {
    this.camera.position.copy(this.camBase);
    this.camera.quaternion.copy(this.camQuat);
    this.shake = Math.max(0, (this.shake ?? 0) - dt * 1.6);
    if (this.shake > 0 && !this.poster) this.camera.position.add(v2.set(rnd.spread(1), rnd.spread(1), rnd.spread(1)).multiplyScalar(this.shake * 0.25));
  }

  updateHud() {
    const N = GameConfig.night;
    const t = this.tank;
    if (this.time > 14) this.hudEl.keys.classList.add('faded');
    this.reloadBar.style.width = `${Math.round((1 - t.cooldown / (t.reloadTime || N.reload)) * 100)}%`;
    for (const c of SHELL_COLORS) {
      const chip = this.hudEl.chips[c.id];
      const n = c.block ? this.wheel.ammo[c.id] ?? 0 : Infinity;
      chip.classList.toggle('on', this.wheel.selected === c.id);
      chip.classList.toggle('off', n <= 0);
      const label = c.block ? String(n) : '∞';
      const el = chip.querySelector('b');
      if (el.textContent !== label) el.textContent = label;
    }
    const st = this.hudEl.stick;
    const showStick = this.input.pointerId !== null && this.input.dragStart && matchMedia('(pointer: coarse)').matches;
    st.classList.toggle('on', !!showStick);
    if (showStick) {
      const r = Math.min(window.innerWidth, window.innerHeight) * 0.12;
      const host = this.hud.getBoundingClientRect();
      st.style.left = `${this.input.dragStart.x - host.left}px`;
      st.style.top = `${this.input.dragStart.y - host.top}px`;
      st.style.width = st.style.height = `${r * 2}px`;
      st.firstElementChild.style.transform = `translate(${this.input.move.x * r}px, ${this.input.move.z * r}px)`;
    }
    const ui = this.ui;
    if (!ui) return;
    ui.setScore(this.score);
    ui.setHealth(this.hp / GameConfig.tank.hp);
    const front = this.wall.rows[0];
    const span = N.maxZ - N.deadline - N.startRows * N.block;
    const near = front ? THREE.MathUtils.clamp(1 - (front.z - N.block / 2 - N.deadline) / span, 0, 1) : 0;
    ui.setTankPanel({
      title: this.state === 'won' ? 'THE TRAY · CLEAR' : 'THE TRAY',
      broken: this.broken, goal: N.goal, drain: Math.round(near * 100), drainLimit: 100, incoming: 0,
      labels: ['BROKEN', 'WALL'], incomingText: `ROWS LEFT ${Math.max(0, N.totalRows - this.wall.spawned)}`,
    });
    ui.setObjectives({
      title: 'NEON RAIN · MIDNIGHT',
      items: [
        { text: `Break ${N.goal} blocks`, done: this.broken >= N.goal, progress: `${Math.min(this.broken, N.goal)}/${N.goal}` },
        { text: 'Keep the wall off your line', done: this.state === 'won', progress: `${this.breaches} breach${this.breaches === 1 ? '' : 'es'}` },
        { text: 'Set off a 10-block chain', done: this.bestChain >= 10, progress: `${Math.min(this.bestChain, 10)}/10` },
      ],
    });
  }
}
