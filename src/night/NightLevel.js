import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GameConfig } from '../config/GameConfig.js';
import { EffectsManager } from '../fx/EffectsManager.js';
import { PlayerTank } from '../tank/PlayerTank.js';
import { TankSupplies, SUPPLY_COLORS } from '../tank/TankSupplies.js';
import { PowerUpSystem, POWERUPS } from '../entities/PowerUps.js';
import { reticleTexture } from '../ui/Reticle.js';
import { Random, fxRandom as rnd } from '../util/Random.js';
import { createCanvas, canvasToTexture } from '../textures/CanvasUtils.js';
import { WetReflection } from './WetReflection.js';
import { NightTextures } from './NightTextures.js';
import { NightDesk } from './NightDesk.js';
import { BlockWall } from './BlockWall.js';
import { ColorWheel, SHELL_COLORS } from './ColorWheel.js';
import { Gems } from './Gems.js';
import { Rain } from './Rain.js';
import { NIGHT_CAMERA, NIGHT_WHEEL, NIGHT_POSTER } from './NightLayout.js';
import { NIGHT_BLOCKS, GEM_COLORS, shellOf } from './NightColors.js';

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** The hull's footprint on the tray as a circle (world units, tank scale 0.42). */
const TANK_RADIUS = 0.85;
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const FEED = Object.freeze({ tank: '#7be86a', enemy: '#ff6b6b', grey: '#c9ced6', gold: '#ffd34a' });
const SCORE = Object.freeze({ block: 10, chain: 5, mine: 50 });
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Supplies a supply block can drop (B only while no balls are out). */
const SUPPLY_TYPES = Object.freeze(['T', 'R', 'D', 'B']);
const SUPPLY_NAMES = Object.freeze({ T: 'TRIPLE FIRE', R: 'HOMING ROCKETS', D: '8-WAY BURST', B: 'BOUNCING BALLS' });
const STAGE_NAMES = Object.freeze(['STAGE 1', 'STAGE 2', 'STAGE 3', 'BOSS']);

/**
 * The key art's plain flak shell: a white teardrop head ringed with small irregular spikes (a
 * splash of light), soft grey shading inside, a short tapering tail behind it; the head points
 * along +x (the sprite's centre sits on the head).
 */
function cometTexture() {
  const W = 256;
  const H = 128;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const r = new Random(311);
  const hx = W * 0.72;
  const hy = H / 2;
  const R = H * 0.3;
  // Outline: a circle at the head drawn out into a tail toward -x, with jagged little spikes.
  const pts = [];
  const n = 64;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const back = Math.max(0, -Math.cos(a));
    // Teardrop: the back half stretches toward the tail, narrowing.
    const len = R * (1 + back * back * 3.2);
    const wid = R * (1 - back * 0.55);
    const spike = 1 + (i % 2 ? 0.22 + r.next() * 0.18 : -0.05) * (1 - back * 0.5);
    pts.push([hx + Math.cos(a) * len * (Math.cos(a) > 0 ? spike : 1), hy + Math.sin(a) * wid * spike]);
  }
  const body = g.createLinearGradient(hx - R * 4, 0, hx + R, 0);
  body.addColorStop(0, 'rgba(255,255,255,0)');
  body.addColorStop(0.45, 'rgba(225,230,240,0.75)');
  body.addColorStop(0.8, 'rgba(255,255,255,1)');
  body.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = body;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
  // Soft grey inner shading and a hot white core.
  const shade = g.createRadialGradient(hx - R * 0.3, hy + R * 0.25, 0, hx - R * 0.3, hy + R * 0.25, R * 1.4);
  shade.addColorStop(0, 'rgba(120,128,150,0.35)');
  shade.addColorStop(1, 'rgba(120,128,150,0)');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  const core = g.createRadialGradient(hx + R * 0.2, hy - R * 0.1, 0, hx + R * 0.2, hy - R * 0.1, R * 0.8);
  core.addColorStop(0, 'rgba(255,255,255,0.9)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, W, H);
  // A thin dotted streak behind (the art's faint trace toward the tank).
  g.fillStyle = 'rgba(220,235,255,0.55)';
  for (let x = hx - R * 4; x > 4; x -= 9) g.fillRect(x, hy - 1, 4, 2);
  return canvasToTexture(c, { srgb: false });
}

/** Starburst: a hot white-yellow core with long and short spiky rays (orange toward the tips). */
function burstTexture() {
  const S = 256;
  const c = createCanvas(S, S);
  const g = c.getContext('2d');
  const r = new Random(53);
  const m = S / 2;
  g.globalCompositeOperation = 'lighter';
  const glow = g.createRadialGradient(m, m, 0, m, m, m);
  glow.addColorStop(0, 'rgba(255,255,240,1)');
  glow.addColorStop(0.12, 'rgba(255,240,170,1)');
  glow.addColorStop(0.3, 'rgba(255,170,60,0.55)');
  glow.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + r.spread(0.08);
    const len = m * (i % 2 ? 0.45 + r.next() * 0.2 : 0.75 + r.next() * 0.25);
    const w = 0.05 + r.next() * 0.04;
    const ray = g.createLinearGradient(m, m, m + Math.cos(a) * len, m + Math.sin(a) * len);
    ray.addColorStop(0, 'rgba(255,255,230,1)');
    ray.addColorStop(0.5, 'rgba(255,200,90,0.8)');
    ray.addColorStop(1, 'rgba(255,110,30,0)');
    g.fillStyle = ray;
    g.beginPath();
    g.moveTo(m + Math.cos(a - w) * 10, m + Math.sin(a - w) * 10);
    g.lineTo(m + Math.cos(a) * len, m + Math.sin(a) * len);
    g.lineTo(m + Math.cos(a + w) * 10, m + Math.sin(a + w) * 10);
    g.closePath();
    g.fill();
  }
  return canvasToTexture(c, { srgb: false });
}

/**
 * The key art's plasma orb: a white-hot core in a magenta ring, a thin blue corona; the trail
 * (orbTrailTexture) is drawn as its own sprite behind it.
 */
function orbTexture() {
  const S = 128;
  const c = createCanvas(S, S);
  const g = c.getContext('2d');
  const m = S / 2;
  const halo = g.createRadialGradient(m, m, 0, m, m, m);
  halo.addColorStop(0, 'rgba(255,255,255,1)');
  halo.addColorStop(0.12, 'rgba(255,245,255,1)');
  halo.addColorStop(0.2, 'rgba(255,90,220,1)');
  halo.addColorStop(0.34, 'rgba(235,30,180,0.9)');
  halo.addColorStop(0.44, 'rgba(150,50,255,0.4)');
  halo.addColorStop(0.62, 'rgba(60,110,255,0.16)');
  halo.addColorStop(1, 'rgba(40,90,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, S, S);
  return canvasToTexture(c, { srgb: false });
}

/** Orb trail: cyan-blue jagged feather tapering away from the orb (orb at +x, tail toward -x). */
function orbTrailTexture() {
  const W = 256;
  const H = 64;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const r = new Random(97);
  const hy = H / 2;
  g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const grd = g.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, 'rgba(40,120,255,0)');
    grd.addColorStop(0.55, `rgba(60,170,255,${0.35 + k * 0.15})`);
    grd.addColorStop(0.92, k === 2 ? 'rgba(220,250,255,1)' : 'rgba(90,210,255,0.9)');
    grd.addColorStop(1, 'rgba(90,210,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(W * 0.96, hy);
    const w0 = H * (0.42 - k * 0.12);
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      g.lineTo(W * (0.96 - t * 0.94), hy - w0 * (1 - t) * (i % 2 ? 1 : 0.45 + r.next() * 0.3));
    }
    for (let i = 18; i >= 0; i--) {
      const t = i / 18;
      g.lineTo(W * (0.96 - t * 0.94), hy + w0 * (1 - t) * (i % 2 ? 0.45 + r.next() * 0.3 : 1));
    }
    g.closePath();
    g.fill();
  }
  return canvasToTexture(c, { srgb: false });
}

/**
 * Scenario 03 NEON RAIN (menu card): the tank in a wooden toy tray on a wet desk by a rainy
 * window at midnight, lit by a brass desk lamp - the key art (assets/textures/menu/night.jpg)
 * as a game scene, laid out and lit after it (NightLayout.js, NightDesk.js; compare with
 * tools/night/compare.mjs).
 *
 * The game is Blocked (AIRepos/Blocked) on the tank, a run of four stages:
 *   - stages 1-3: a wall of blocks (BlockWall) rolls down the tray; 300, 300 and 400 rows - the
 *     run's 1000 rows walk through Blocked's 100 levels (block types and HP from Blocked's
 *     LevelManager). A block that gets off the near edge, or shoves into the tank, costs armour
 *     (a damage flash). After stage 1 the tray stretches to twice its length and the camera
 *     follows the tank up it (the street below the window comes into view); stage 4 is the boss;
 *   - the tank drives anywhere on the tray (blocks are solid) and fires one shell at a time; the
 *     colour wheel (ColorWheel; NightColors.js) picks it - white NORMAL (endless), red POWER,
 *     green ACID, blue RAPID, black CRITICAL (the skull shot, "CRITICAL!", a shake); a shell of
 *     the block's own colour does double damage;
 *   - a destroyed block takes its same-coloured neighbours with it (chain reaction); explosive
 *     blocks blast the eight round them; supply blocks drop a supply - T triple fire, R homing
 *     rockets, D 8-way burst, B bouncing balls;
 *   - gems (Blocked's colour ammo) drop now and then and fly to the tank: + ammo;
 *   - spike mines roll out of the wall now and then: shoot them before they reach the tank.
 * Aiming is the tank level's auto aim (the selected colour's blocks first, then the closest to
 * the line, mines before anything); Q / E or the left / right arrows (phones: the two buttons)
 * turn the barrel instead.
 * Controls: W/S drive, A/D turn the hull, Q/E or left/right arrows the barrel; the colour wheel
 * as in Blocked (desktop and phones): SPACE, the mouse wheel or up/down arrows step it, 1-5 pick a
 * colour, tap the hub for the next one or a wedge for that one, drag the rim to turn it, flick it
 * to spin (it settles on a wedge), wind it up and let go for the fountain fire; the gun fires by
 * itself at the lock (a click fires too). ESC pause menu, ENTER restarts a finished game. Own
 * scene, fixed key-art camera, lights and post look (pushed onto the pipeline).
 */
export class NightLevel {
  constructor({ tankGltf, deskGltf, wheelGltf, gemGltf, supplyGltf, skullGltf, backdrop, streetPlate, textures, materials, renderer, input, quality, hud, environment }) {
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
    if (backdrop) this.desk.setBackdrop(backdrop, streetPlate);
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

    this.gems = new Gems(this.scene, this.effects, textures);
    this.gems.onCollect = (color) => this.onGem(color);
    // T / D supply crates (the tank level's Blender crate, sized for the tray); they land on top
    // of a block if they fall on one.
    this.supplies = new TankSupplies(this.scene, this.effects, supplyGltf, (x, z) => (this.wall.blockAt(x, z) ? this.wall.size : 0), { scale: 0.95, magnetRadius: 4.2, pickupRadius: 1.5, glow: 0.3, puff: false });
    this.supplies.onPickup = (type, item) => this.onSupply(type, item);
    this.powerups = new PowerUpSystem();
    this.burstTimer = 0;

    this.tank = new PlayerTank(tankGltf);
    this.tank.root.scale.setScalar(N.tankScale);
    this.tank.half = { x: 2.0 * N.tankScale, z: 2.25 * N.tankScale };
    this.scene.add(this.tank.root);
    const Z = N.tankZone;
    this.tank.bounds = { minX: Z.minX, maxX: Z.maxX, minZ: Z.minZ, maxZ: Z.maxZ };
    this.tank.heightAt = () => 0;
    this.tank.collide = () => this.collideTank();
    // Blocks are solid: the hull can't drive into the wall (it slides along it).
    this.tank.canStand = (x, z) => !this.blockOverlap(x, z, TANK_RADIUS);
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
    // B supply: the mines' pixel balls, bouncing round the tray.
    this.balls = [];
    // CRITICAL shell: the Blender skull (skull_shot.glb), else a dark sphere.
    this.skullTemplate = skullGltf?.scene.getObjectByName('SkullShot') ?? null;
    this.skullTemplate?.traverse((o) => {
      if (!o.isMesh) return;
      // Violet eyes that read in flight; the lacquered bone mirrors the room.
      if (o.material.name === 'SkullEyes') {
        o.material.emissiveIntensity = 4;
        o.material.toneMapped = false;
      }
      if (o.material.name === 'SkullBone') o.material.envMapIntensity = 2;
    });
    this.stage = 0;
    this.fieldMaxZ = N.maxZ;

    this.rain = new Rain(this.scene, { drops: low ? 5000 : 10000, ripples: low ? 320 : 700, box: new THREE.Vector3(44, 30, 30) });
    this.rain.setLights(this.desk.rainLights);
    this.reflection.hidden = [...this.desk.floors, this.rain.streaks, this.rain.ripples];

    // Shots: colour lasers (instant), plain flak comets, pink plasma orbs.
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0);
    this.beams = [];
    this.cometTex = cometTexture();
    this.orbTex = orbTexture();
    this.orbTrailTex = orbTrailTexture();
    this.burstTex = burstTexture();
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
    this.onPointerMove = (e) => this.pointerMove(e);
    this.onPointerUp = (e) => this.pointerUp(e);
    this.dragPlane = new THREE.Plane();
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
      <div class="th-keys"><b>W S</b> drive · <b>A D</b> turn hull · <b>← →</b> / <b>Q E</b> barrel · <b>SPACE</b> / <b>↑ ↓</b> / <b>wheel</b> / <b>1-5</b> colour · drag / flick / wind the dial · <b>ESC</b> menu</div>
      <div class="nw-chips" data-chips>${SHELL_COLORS.map((c, i) => `<button class="nw-chip" data-c="${c.id}" style="--c:${css(c.chip)}"><i></i><b>${c.infinite ? '∞' : '0'}</b><small>${i + 1}</small></button>`).join('')}</div>
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
      fringe: pipeline.lensPass?.uniforms.uFringe.value,
    };
    // The key art is a plain perspective (no lens barrel).
    // The key art is a plain perspective: no lens barrel, no colour fringes.
    if (pipeline.lensPass) {
      pipeline.lensPass.uniforms.uK.value = 0;
      pipeline.lensPass.uniforms.uFringe.value = 0;
    }
    if (g) {
      // Mid-tone exposure of the art (its frame mean is ~92, 87, 82).
      g.uExposure.value = 1.3;
      g.uSaturation.value = 1.35;
      g.uContrast.value = 1.12;
      g.uVignette.value = 0.95;
      g.uSunStrength.value = 0;
      g.uTint.value.setRGB(1.0, 0.98, 1.02);
    }
    if (b) {
      b.strength = 0.36;
      b.radius = 0.4;
      b.threshold = 1.25;
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
    if (p.lensPass && L.fringe !== undefined) p.lensPass.uniforms.uFringe.value = L.fringe;
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
    this.crushTimer = 0;
    this.homingTimer = 0;
    this.clearBalls();
    this.setStage(0, true);
    this.wheel.reset(N.startAmmo);
    this.gems.clear();
    this.supplies.clear();
    this.powerups.clear();
    this.burstTimer = 0;
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
      ui.toast(`NEON RAIN · STAGE 1 - ${N.stages[0]} ROWS`);
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
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.wheelDrag = null;
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
    this.reflection.every = 1;
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
    this.supplies.clear();
    this.gems.spawn(P.gem.color, new THREE.Vector3(P.gem.x, 1, P.gem.z), P.gem.x, P.gem.z, { frozen: true });
    const t = this.tank;
    t.root.position.set(P.tank.x, 0, P.tank.z);
    t.heading = P.tank.heading;
    t.turretYaw = 0;
    this.wheel.select('green');
    // The dial as in the art: red at the top.
    this.wheel.holdSpin(0);
    // Frozen shots, measured off the art (art px projected onto the shot height y = 1.1): the
    // green laser up the middle, the fan of eight orbs, the five flak comets (sizes as drawn).
    this.clearShots();
    t.update(0, { throttle: 0, turn: 0, turret: 0 }, null);
    t.root.updateMatrixWorld(true);
    const muzzle = t.muzzle.getWorldPosition(new THREE.Vector3());
    this.addBeam(muzzle, new THREE.Vector3(0.17, 1.2, 4.48), shellOf('green').hex, 99);
    const from = new THREE.Vector3(P.tank.x, 1.1, P.tank.z);
    const outward = (x, z, speed) => new THREE.Vector3(x, 1.1, z).sub(from).setY(0).normalize().multiplyScalar(speed);
    for (const [x, z] of P.orbs) this.addOrb(new THREE.Vector3(x, 1.1, z), outward(x, z, 20), true);
    for (const [x, z, size] of P.comets) this.addComet(new THREE.Vector3(x, 1.1, z), outward(x, z, 30), true, size);
    for (const [x, y, z, size, color] of P.bursts) {
      this.addBurst(new THREE.Vector3(x, y, z), size, true);
      this.effects.shatter(new THREE.Vector3(x, y, z), NIGHT_BLOCKS[color], 18, 1.2, [0.2, 0.5]);
    }
    this.hud.style.display = 'none';
    if (this.ui) this.ui.root.style.display = 'none';
  }

  /**
   * Pointer on the canvas: on the colour wheel (within its rim, + a little slack) it is Blocked's
   * wheel gesture - tap the hub for the next colour, tap a wedge for that colour, drag to spin /
   * flick / wind up (ColorWheel.beginPress); a press there never starts the move stick. Elsewhere
   * a mouse click fires.
   */
  pointerDown(e) {
    if (!this.active || this.paused) return;
    if (this.wheel.root) {
      const hit = this.dialHit(e);
      if (hit && this.wheel.radiusAt(hit) <= 1.18) {
        // Not a joystick press (Input claimed it first).
        if (this.input.pointerId === e.pointerId) {
          this.input.pointerId = null;
          this.input.dragVector = { x: 0, y: 0 };
        }
        const a = this.wheel.angleAt(hit);
        const hub = this.wheel.radiusAt(hit) < 0.3;
        this.wheelDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, travel: 0, t0: performance.now(), tLast: performance.now(), last: a };
        this.wheel.beginPress(a, hub);
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('pointercancel', this.onPointerUp);
        return;
      }
    }
    if (e.pointerType === 'mouse' && e.button === 0) this.fireQueued = true;
  }

  /** Where the pointer ray meets the dial's plane (world), or null. */
  dialHit(e) {
    const r = this.element.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.wheel.plane(this.dragPlane), new THREE.Vector3());
  }

  pointerMove(e) {
    const d = this.wheelDrag;
    if (!d || e.pointerId !== d.id) return;
    d.travel += Math.hypot(e.clientX - d.x, e.clientY - d.y);
    d.x = e.clientX;
    d.y = e.clientY;
    const hit = this.dialHit(e);
    if (!hit) return;
    const now = performance.now();
    d.last = this.wheel.angleAt(hit);
    this.wheel.movePress(d.last, (now - d.tLast) / 1000);
    d.tLast = now;
  }

  pointerUp(e) {
    const d = this.wheelDrag;
    if (!d || e.pointerId !== d.id) return;
    this.wheelDrag = null;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    // Blocked: a press is a tap when it is short (0.35 s) and still (12 px).
    const tap = performance.now() - d.t0 <= 350 && d.travel <= 12;
    this.wheel.endPress(tap, d.last);
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
    // Blocked's wheel keys: SPACE (and the mouse wheel) one wedge on; the up / down arrows too.
    if (this.edge('Space')) this.wheel.next();
    if (this.edge('ArrowUp')) this.wheel.prev();
    if (this.edge('ArrowDown')) this.wheel.next();
    SHELL_COLORS.forEach((c, i) => {
      if (this.edge(`Digit${i + 1}`) && !this.wheel.select(c.id)) this.ui?.notice(`NO ${c.name} AMMO`, '#ff8a7a');
    });
    const driving = this.state === 'playing' || this.state === 'won' || this.state === 'stretch';
    const drive = driving ? {
      throttle: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
      turn: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0),
      turret: (k('KeyQ', 'ArrowLeft') || this.touch.left ? 1 : 0) - (k('KeyE', 'ArrowRight') || this.touch.right ? 1 : 0),
    } : { throttle: 0, turn: 0, turret: 0 };
    if (driving && this.input.dragging && !drive.throttle && !drive.turn) Object.assign(drive, this.stickDrive(this.input.move.x, this.input.move.z));
    this.step(dt, drive, driving && this.fireQueued);
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
    // Blocked's fall speed for the level of the rows on the tray (24 + 2 x level-in-cycle px/s,
    // 100 px blocks), and a thin wall rushes in.
    const L = this.wall.rows[0]?.level ?? this.wall.level;
    this.wall.speed = ((24 + 2 * ((L - 1) % 10)) / 100) * N.block * N.speedScale;
    if (this.wall.rows.length < N.startRows && this.wall.spawned < this.wall.stageRows) this.wall.speed *= 6;
    this.wall.update(dt, !playing || this.state === 'stretch');
    if (this.state === 'stretch') this.updateStretch(dt);
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
    if (playing) this.updateCrush(dt);
    // Supplies: crates to pick up, the timed weapons ticking down (shown in the HUD's skill feed).
    this.supplies.update(dt, t.position, playing);
    if (playing) {
      this.powerups.update(dt);
      this.burstTimer -= dt;
      if (this.powerups.has('D') && this.burstTimer <= 0) {
        this.burstTimer = GameConfig.night.burstInterval;
        this.fireBurst();
      }
      this.homingTimer -= dt;
      if (this.powerups.has('R') && this.homingTimer <= 0) {
        this.homingTimer = GameConfig.night.homingInterval;
        this.fireHoming();
      }
    }
    this.updateBalls(dt);
    this.updateFountain(dt);
    this.ui?.setSkills(this.powerups.active);

    this.updateShots(dt);
    this.updateMines(dt);
    this.gems.update(dt, t.position);
    this.wheel.update(dt);
    this.desk.update(dt);
    this.effects.update(dt);
    this.updateCamera(dt);
    this.rain.setView(this.camera, this.renderer?.domElement.height ?? 941);
    this.rain.update(dt, v1.set(0, 0, 3 + this.follow), this.desk.flash);
    if (this.desk.backdrop) this.desk.backdrop.uniforms.uRain.value = this.rain.intensity;
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
      const urgency = Math.max(0, 6 - (c.z - N.minZ)) * 0.6;
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
   * Fires one shell of the wheel's colour (NightColors.js): white a flak comet, red / green / blue
   * a beam of that colour (instant, up to the first block), black the CRITICAL skull. A coloured
   * shell costs one round; blue fires twice as fast. TRIPLE FIRE (T) sends it three ways for the
   * one round (Blocked: the two extra are free).
   */
  fire(lock) {
    const N = GameConfig.night;
    const col = this.wheel.color;
    const shot = this.tank.fire(N.reload / (col.rate ?? 1) / GameConfig.tank.reload);
    if (!shot) return;
    this.wheel.spend(col.id);
    const { muzzle, dir } = shot;
    const tint = new THREE.Color(col.hex);
    this.effects.muzzleFlash(muzzle, dir, [tint.r * 4, tint.g * 4, tint.b * 4, 1], col.id === 'red' ? 1.5 : 1.1);
    this.effects.flash(muzzle, col.hex, col.id === 'red' ? 70 : 50, 0.2, 10);
    this.shake = Math.max(this.shake, col.id === 'red' ? 0.22 : 0.12);
    const aimDir = lock ? this.targetPoint(lock, v1).sub(muzzle).normalize() : dir.clone();
    const angles = this.powerups.has('T') ? [0, -N.tripleSpread, N.tripleSpread] : [0];
    for (const a of angles) {
      const d = a ? aimDir.clone().applyAxisAngle(UP, a) : aimDir.clone();
      if (col.critical) this.addSkull(muzzle, d.multiplyScalar(N.shellSpeed * 0.6));
      else if (col.infinite) this.addComet(muzzle, d.multiplyScalar(N.shellSpeed), false, 1, col.id);
      else this.laser(muzzle, d, col);
    }
  }

  /**
   * Blocked's fountain fire (Player.UpdateWheelFountain): while a wound-up wheel unwinds fast the
   * tank sprays shells round itself on three arms that turn with the dial, up to 34 volleys a
   * second at full speed. Each volley takes a random colour that still has rounds (one round per
   * volley, not per arm), white once they are all spent - it never stops while the dial spins.
   */
  updateFountain(dt) {
    const w = this.wheel;
    if (!w.fountaining || this.state !== 'playing' && this.state !== 'stretch') {
      this.fountainAcc = 0;
      return;
    }
    const rate = 34 * THREE.MathUtils.clamp(w.speedNorm, 0, 1);
    if (rate <= 0.01) return;
    this.fountainAcc = (this.fountainAcc ?? 0) + rate * dt;
    const N = GameConfig.night;
    const t = this.tank;
    t.root.updateMatrixWorld(true);
    const muzzle = t.muzzle.getWorldPosition(v3);
    let shots = 0;
    while (this.fountainAcc >= 1 && shots < 6) {
      this.fountainAcc -= 1;
      shots++;
      const ready = SHELL_COLORS.filter((c) => !c.infinite && w.ammo[c.id] > 0);
      const col = ready.length ? ready[Math.floor(rnd.next() * ready.length)] : SHELL_COLORS[0];
      if (!col.infinite) w.spend(col.id);
      for (let i = 0; i < 3; i++) {
        const a = w.spin + (i * Math.PI * 2) / 3;
        const vel = v2.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(N.shellSpeed * 0.8);
        this.addComet(muzzle, vel, false, 0.8, col.id, col.infinite ? null : col.hex);
      }
    }
    if (shots) {
      this.effects.muzzleFlash(muzzle, v2.set(0, 1, 0), [3, 3, 3, 1], 0.9);
      this.shake = Math.max(this.shake, 0.06);
    }
  }

  /**
   * A shell of `shellId` hits block b: the shell's damage, double on its own colour; acid
   * eats on; a critical hit pops "CRITICAL!" and shakes the screen a little.
   */
  hitBlock(b, shellId, at) {
    const N = GameConfig.night;
    const col = shellOf(shellId) ?? shellOf('white');
    const match = col.block && col.block === b.color;
    const dmg = col.damage * (match ? 2 : 1);
    this.wall.damage(b, dmg, at, { acid: col.acid ? N.acidSeconds : 0, tint: col.infinite ? 0xd8dde6 : col.hex });
    if (col.critical) this.criticalHit(at);
    return dmg;
  }

  criticalHit(at) {
    this.shake = Math.max(this.shake, 0.32);
    this.effects.flash(at, 0x8a4cff, 60, 0.3, 9);
    this.effects.sparkBurst(at, 22, 7, [2.4, 1.2, 4, 1]);
    // (A fountain of black shells would pop it every frame.)
    if (this.time - (this.lastCritical ?? -9) > 0.5) this.ui?.notice('CRITICAL!', '#b98cff');
    this.lastCritical = this.time;
  }

  /** CRITICAL shell: the black skull, trailing purple-black smoke. */
  addSkull(pos, vel) {
    let m;
    if (this.skullTemplate) {
      m = this.skullTemplate.clone(true);
      m.scale.setScalar(0.55);
    } else {
      m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshStandardMaterial({ color: 0x0b0a10, roughness: 0.2, metalness: 0.4, emissive: 0x2a1050 }));
    }
    m.position.copy(pos);
    m.lookAt(v1.copy(pos).add(vel));
    m.renderOrder = 17;
    this.scene.add(m);
    this.shots.push({ kind: 'skull', mesh: m, pos: pos.clone(), vel: vel.clone(), life: 1.6, frozen: false, shell: 'black', smoke: 0 });
  }

  /** HOMING ROCKETS (R): a rocket out of the turret onto a random block. */
  fireHoming() {
    const targets = this.wall.exposed(this.exposed).filter((b) => b.alive && !b.doomed);
    if (!targets.length) return;
    const b = targets[Math.floor(rnd.next() * targets.length)];
    const t = this.tank;
    const from = v2.copy(t.position).setY(1.4);
    const vel = new THREE.Vector3(rnd.spread(1), 2.2, rnd.spread(1)).normalize().multiplyScalar(9);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.orbTex, color: new THREE.Color(2.4, 1.2, 0.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    s.scale.setScalar(0.6);
    s.position.copy(from);
    s.renderOrder = 18;
    this.scene.add(s);
    this.shots.push({ kind: 'rocket', mesh: s, pos: from.clone(), vel, life: 3, frozen: false, shell: this.wheel.color.infinite ? 'white' : 'red', target: b, serial: b.serial });
    this.effects.flash(from, 0xff9a40, 26, 0.15, 5);
  }

  /** 8-WAY BURST (D): plasma orbs out all round the tank, a little turned each volley. */
  fireBurst() {
    const t = this.tank;
    const from = v2.copy(t.position).setY(1.1);
    this.burstTurn = ((this.burstTurn ?? 0) + 0.2) % (Math.PI / 4);
    for (let i = 0; i < 8; i++) {
      const a = t.heading + this.burstTurn + (i / 8) * Math.PI * 2;
      this.addOrb(from.clone(), new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(20), false, this.wheel.selected);
    }
    this.effects.flash(from, 0xff4ad0, 26, 0.18, 6);
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
        this.damageMine(m, col.damage, p);
        hit = p;
        break;
      }
      const b = this.wall.blockAt(p.x, p.z);
      if (b) {
        this.hitBlock(b, col.id, p.clone());
        hit = p;
        break;
      }
      if (Math.abs(p.x) > N.maxX || p.z > this.fieldMaxZ || p.z < N.minZ) {
        hit = p;
        break;
      }
    }
    const end = hit ?? p;
    this.addBeam(from, end, col.hex, 0.16, col.id === 'red' ? 1.8 : col.id === 'blue' ? 0.7 : 1);
    const c = new THREE.Color(col.hex);
    this.effects.impact(end, [c.r * 5, c.g * 5, c.b * 5, 1]);
  }

  addBeam(from, to, hex, life, width = 1) {
    const c = new THREE.Color(hex);
    const core = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).lerp(c, 0.6).multiplyScalar(5), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glow = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.5), toneMapped: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    const len = from.distanceTo(to);
    for (const [m, w] of [[core, 0.035 * width], [glow, 0.17 * width]]) {
      m.position.copy(from);
      m.quaternion.setFromUnitVectors(UP, v1.copy(to).sub(from).normalize());
      m.scale.set(w, len, w);
      m.renderOrder = 16;
      this.scene.add(m);
    }
    this.beams.push({ core, glow, life, max: life });
  }

  /** Plain flak shell: a white spiky comet. */
  addComet(pos, vel, frozen = false, size = 1, shell = 'white', tint = null) {
    const color = tint === null ? new THREE.Color(1.3, 1.3, 1.35) : new THREE.Color(tint === 0x8a4cff ? 0x9a5cff : tint).multiplyScalar(2.2);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.cometTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    s.scale.set(2.0 * size, 1.0 * size, 1);
    s.center.set(0.72, 0.5);
    s.position.copy(pos);
    s.renderOrder = 17;
    this.scene.add(s);
    this.shots.push({ kind: 'comet', mesh: s, pos: pos.clone(), vel: vel.clone(), life: 1.4, frozen, shell });
  }

  /** A block blowing apart: the art's white-yellow starburst (spiky rays round a hot core). */
  addBurst(pos, size = 1, frozen = false) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.burstTex, color: new THREE.Color(2.2, 1.9, 1.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    s.scale.setScalar(2.6 * size);
    s.material.rotation = rnd.next() * Math.PI;
    s.position.copy(pos);
    s.renderOrder = 18;
    this.scene.add(s);
    this.shots.push({ kind: 'burst', mesh: s, pos: pos.clone(), vel: new THREE.Vector3(), life: 0.35, max: 0.35, size, frozen, damage: 0, shell: null });
  }

  /** Pink plasma orb (blue feather trail). */
  addOrb(pos, vel, frozen = false, shell = 'white') {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.orbTex, color: new THREE.Color(1.15, 1.0, 1.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    s.scale.setScalar(0.95);
    s.position.copy(pos);
    s.renderOrder = 18;
    this.scene.add(s);
    const trail = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.orbTrailTex, color: new THREE.Color(1.6, 1.6, 1.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    trail.scale.set(1.25, 0.32, 1);
    trail.center.set(0.95, 0.5);
    trail.renderOrder = 17;
    this.scene.add(trail);
    this.shots.push({ kind: 'orb', mesh: s, trail, pos: pos.clone(), vel: vel.clone(), life: 1.2, frozen, shell });
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
      if (s.kind === 'burst') {
        if (!s.frozen) s.life -= dt;
        const k = Math.max(0, s.life / s.max);
        s.mesh.material.opacity = s.frozen ? 1 : k;
        if (!s.frozen) s.mesh.scale.setScalar(2.6 * s.size * (1.25 - 0.45 * k));
        if (s.life <= 0) {
          s.mesh.removeFromParent();
          s.mesh.material.dispose();
          this.shots.splice(i, 1);
        }
        continue;
      }
      if (!s.frozen) {
        s.life -= dt;
        if (s.kind === 'rocket') {
          // Homing: steer onto the target block (a new one if it broke), speeding up.
          if (!s.target?.alive || s.target.serial !== s.serial) {
            const list = this.wall.exposed(this.exposed);
            s.target = list.length ? list[Math.floor(rnd.next() * list.length)] : null;
            s.serial = s.target?.serial;
          }
          if (s.target) {
            const want = this.wall.center(s.target, v1).sub(s.pos);
            const speed = Math.min(26, s.vel.length() + dt * 30);
            s.vel.lerp(want.normalize().multiplyScalar(speed), 1 - Math.exp(-5 * dt));
          }
          // A short hot trail (no smoke: smoke is the skull's alone).
          if (rnd.next() < 0.6) this.effects.fire.emit({ x: s.pos.x, y: s.pos.y, z: s.pos.z, life: 0.16, size0: 0.32, size1: 0.08, color0: [3, 1.6, 0.6, 0.9], color1: [1, 0.3, 0.1, 0] });
        }
        if (s.kind === 'skull') {
          // Purple-black smoke behind the skull.
          s.smoke -= dt;
          if (s.smoke <= 0) {
            s.smoke = 0.02;
            this.effects.smoke.emit({
              x: s.pos.x + rnd.spread(0.15), y: s.pos.y + rnd.spread(0.15), z: s.pos.z + rnd.spread(0.15), vy: 0.4, drag: 1.2,
              life: rnd.range(0.5, 0.9), size0: 0.35, size1: rnd.range(0.9, 1.4), rotVel: rnd.spread(1.5),
              color0: rnd.next() < 0.5 ? [0.32, 0.08, 0.5, 0.85] : [0.04, 0.02, 0.06, 0.85], color1: [0.08, 0.02, 0.12, 0],
            });
          }
          s.mesh.rotation.z += dt * 3;
        }
        const steps = Math.max(1, Math.ceil((s.vel.length() * dt) / 0.3));
        for (let k = 0; k < steps && !done; k++) {
          s.pos.addScaledVector(s.vel, dt / steps);
          const m = this.mineAt(s.pos);
          if (m) {
            this.damageMine(m, shellOf(s.shell)?.damage ?? 1, s.pos);
            if (s.kind === 'skull') this.criticalHit(s.pos);
            done = true;
            break;
          }
          const b = this.wall.blockAt(s.pos.x, s.pos.z);
          if (b && (s.kind !== 'rocket' || s.pos.y < this.wall.size + 0.3)) {
            this.hitBlock(b, s.shell, s.pos.clone());
            this.effects.impact(s.pos, s.kind === 'orb' ? [3.5, 1, 3, 1] : s.kind === 'skull' ? [2, 0.8, 3.5, 1] : [4, 4, 4, 1]);
            if (s.kind === 'rocket') this.effects.blast(s.pos, 0.6);
            else if (s.kind === 'skull') this.effects.blast(s.pos, 1.1, [2.2, 0.9, 3.6, 1]);
            done = true;
          } else if (Math.abs(s.pos.x) > N.maxX + 0.2 || s.pos.z > this.fieldMaxZ + 0.2 || s.pos.z < N.minZ - 1) {
            this.effects.sparkBurst(s.pos, 6, 4, [3, 2.6, 2.6, 1]);
            done = true;
          }
        }
      }
      if (done || s.life <= 0) {
        s.mesh.removeFromParent();
        if (s.kind !== 'skull') s.mesh.material.dispose();
        s.trail?.removeFromParent();
        s.trail?.material.dispose();
        this.shots.splice(i, 1);
        continue;
      }
      s.mesh.position.copy(s.pos);
      // Sprite rotation: the velocity's direction on screen (heads point the way they fly).
      v1.copy(s.pos).project(this.camera);
      v2.copy(s.pos).add(s.vel).project(this.camera);
      const screenAngle = Math.atan2((v2.y - v1.y) / this.camera.aspect, v2.x - v1.x);
      if (s.kind === 'comet' || s.kind === 'rocket') {
        if (s.kind === 'comet') s.mesh.material.rotation = screenAngle;
      } else if (s.trail) {
        s.trail.position.copy(s.pos);
        s.trail.material.rotation = screenAngle;
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
    if (!this.mineTuned) {
      // Neutral gunmetal greys as in the art (the Blender lavender reads magenta under the neon).
      this.mineTuned = true;
      const greys = { MineBlock: 0x2b2c30, MineMid: 0x585a60, MineLight: 0x9a9ca2 };
      this.mineTemplate.traverse((o) => {
        for (const m of o.isMesh ? [o.material].flat() : []) if (greys[m.name]) m.color.setHex(greys[m.name]);
      });
    }
    root.position.set(x, 0, z);
    root.scale.setScalar(0.95);
    this.scene.add(root);
    // The ball turns about its own centre (MineBall), not the bottom pivot of the root.
    const ball = root.getObjectByName('MineBall') ?? root;
    const m = { isMine: true, root, ball, alive: true, hp: GameConfig.night.mine.hp, frozen, spin: 0, serial: 0 };
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
    this.effects.blast(p, 1.2);
    this.effects.shatter(p, 0x3a3e45, 10, 1.2, [0.15, 0.35]);
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
      // Rolling: the drawn ball's radius (Blender R 0.62 x 0.95).
      m.ball.rotation.x += (vz / 0.59) * dt;
      m.ball.rotation.z -= (vx / 0.59) * dt;
      if (d < M.radius + 1.3) {
        this.killMine(m, false);
        this.takeDamage(M.damage, 'MINE HIT');
      }
    }
  }

  clearMines() {
    for (const m of this.mines) m.root.removeFromParent();
    this.mines.length = 0;
  }

  // ---- B supply: bouncing balls ------------------------------------------------------------------

  /** BOUNCING BALLS (B): 2-5 pixel balls off the tank, each gone after 5-15 bounces. */
  launchBalls() {
    const N = GameConfig.night;
    const n = N.balls[0] + Math.floor(rnd.next() * (N.balls[1] - N.balls[0] + 1));
    const t = this.tank.position;
    for (let i = 0; i < n; i++) {
      const a = this.tank.heading + rnd.spread(1.1);
      const root = this.mineTemplate ? this.mineTemplate.clone(true) : new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), new THREE.MeshStandardMaterial({ color: 0x8a8d94, metalness: 0.7, roughness: 0.25 }));
      root.scale.setScalar(0.6);
      root.position.set(t.x, 0, t.z);
      this.scene.add(root);
      const bounces = N.bounces[0] + Math.floor(rnd.next() * (N.bounces[1] - N.bounces[0] + 1));
      this.balls.push({ root, ball: root.getObjectByName('MineBall') ?? root, vx: Math.sin(a) * N.ballSpeed, vz: Math.cos(a) * N.ballSpeed, bounces, hitCooldown: 0 });
    }
    this.effects.flash(v1.set(t.x, 1, t.z), 0x9fd8ff, 40, 0.25, 8);
  }

  updateBalls(dt) {
    const N = GameConfig.night;
    const r = 0.37;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const B = this.balls[i];
      if (this.state !== 'playing' && this.state !== 'stretch') continue;
      B.hitCooldown -= dt;
      const p = B.root.position;
      let bounced = false;
      // Sub-steps so a fast ball can't tunnel through a block.
      const steps = Math.max(1, Math.ceil((Math.hypot(B.vx, B.vz) * dt) / 0.25));
      for (let k = 0; k < steps; k++) {
        p.x += (B.vx * dt) / steps;
        p.z += (B.vz * dt) / steps;
        // Tray walls.
        if (p.x < N.minX + r || p.x > N.maxX - r) {
          p.x = THREE.MathUtils.clamp(p.x, N.minX + r, N.maxX - r);
          B.vx = -B.vx;
          bounced = true;
        }
        if (p.z < N.minZ + r || p.z > this.fieldMaxZ - r) {
          p.z = THREE.MathUtils.clamp(p.z, N.minZ + r, this.fieldMaxZ - r);
          B.vz = -B.vz;
          bounced = true;
        }
        // Blocks: bounce off the face it came through, and hurt the block.
        const b = this.wall.blockAt(p.x, p.z);
        if (b) {
          const c = this.wall.center(b, v1);
          const dx = p.x - c.x;
          const dz = p.z - c.z;
          if (Math.abs(dx) > Math.abs(dz)) {
            B.vx = Math.sign(dx || 1) * Math.abs(B.vx);
            p.x = c.x + Math.sign(dx || 1) * (this.wall.size / 2 + r);
          } else {
            B.vz = Math.sign(dz || 1) * Math.abs(B.vz);
            p.z = c.z + Math.sign(dz || 1) * (this.wall.size / 2 + r);
          }
          if (B.hitCooldown <= 0) {
            this.hitBlock(b, this.wheel.color.infinite ? 'white' : this.wheel.selected, v2.set(p.x, 0.75, p.z).clone());
            B.hitCooldown = 0.05;
          }
          bounced = true;
        }
      }
      if (bounced) {
        B.bounces -= 1;
        this.effects.sparkBurst(v2.set(p.x, 0.5, p.z), 6, 4, [2, 3, 4, 1]);
      }
      B.ball.rotation.x += (B.vz / 0.37) * dt;
      B.ball.rotation.z -= (B.vx / 0.37) * dt;
      if (B.bounces <= 0) {
        this.effects.blast(v2.set(p.x, 0.5, p.z), 0.6, [2, 3, 4, 1]);
        B.root.removeFromParent();
        this.balls.splice(i, 1);
      }
    }
  }

  clearBalls() {
    for (const B of this.balls ?? []) B.root.removeFromParent();
    if (this.balls) this.balls.length = 0;
  }

  /**
   * Blocks shoving into the tank: when the wall pushes the hull back against the near edge (no
   * room left) the tank takes Blocked's contact damage, once a `crushCooldown`.
   */
  updateCrush(dt) {
    const N = GameConfig.night;
    this.crushTimer -= dt;
    const p = this.tank.position;
    if (this.crushTimer > 0 || p.z > N.tankZone.minZ + 0.25) return;
    let worst = null;
    for (const row of this.wall.rows) {
      if (row.z - this.wall.size / 2 > p.z + TANK_RADIUS + 0.15) break;
      for (const b of row.cells) if (b && Math.abs(this.wall.colX(b.col) - p.x) < this.wall.size / 2 + TANK_RADIUS) worst = !worst || b.hp > worst.hp ? b : worst;
    }
    if (!worst) return;
    this.crushTimer = N.crushCooldown;
    this.takeDamage(Math.max(1, Math.round(worst.hp * N.escapeDamage)), 'CRUSHED');
  }

  /** Armour loss with the heli game's damage flash. */
  takeDamage(dmg, what) {
    this.hp = Math.max(0, this.hp - dmg);
    this.shake = Math.max(this.shake, 0.6);
    this.ui?.damageFlash(Math.min(1, 0.35 + dmg / 30));
    this.ui?.notice(`${what}  -${dmg} ARMOR`, '#ff6b6b');
  }

  /**
   * Calls `fn(push x, push z, depth)` for every standing block the tank's footprint circle
   * (centre x, z, radius r) overlaps - the push that takes the circle out of that block - and
   * returns how many there were.
   */
  blockOverlap(x, z, r, fn = null) {
    const w = this.wall;
    const h = w.size / 2;
    let n = 0;
    for (const row of w.rows) {
      if (Math.abs(row.z - z) > h + r || row.rise < 0.5) continue;
      for (const b of row.cells) {
        if (!b) continue;
        const bx = w.colX(b.col);
        const qx = THREE.MathUtils.clamp(x, bx - h, bx + h);
        const qz = THREE.MathUtils.clamp(z, row.z - h, row.z + h);
        const dx = x - qx;
        const dz = z - qz;
        const d = Math.hypot(dx, dz);
        if (d >= r) continue;
        n++;
        if (!fn) return n;
        // Centre inside the block: out through the near face toward the tank's side (-z).
        if (d < 1e-4) fn(0, -1, row.z - h - z + r);
        else fn(dx / d, dz / d, r - d);
      }
    }
    return n;
  }

  /** Mines and blocks push the tank (both solid; an advancing wall shoves it back). */
  collideTank() {
    const p = this.tank.root.position;
    for (let k = 0; k < 3; k++) {
      if (!this.blockOverlap(p.x, p.z, TANK_RADIUS, (nx, nz, depth) => {
        p.x += nx * depth;
        p.z += nz * depth;
      })) break;
    }
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
    // The art's starburst over the breaking block (smaller down a chain).
    if (this.shots.length < 60) this.addBurst(v1.copy(at).setY(at.y + 0.4), depth > 0 ? 0.6 : 0.85);
    if (chain.size > this.bestChain) this.bestChain = chain.size;
    for (const n of [5, 10, 15, 20]) {
      if (chain.size === n) this.ui?.kill('CHAIN', css(NIGHT_BLOCKS[b.color] ?? 0xffffff), `×${n}`, FEED.gold, `+${SCORE.chain * n}`, FEED.gold);
    }
    if (this.state !== 'playing') return;
    // A supply block always drops a supply (Blocked); B only while no balls are out.
    if (b.type === 'supply') {
      const pool = SUPPLY_TYPES.filter((t) => t !== 'B' || !this.balls.length);
      const item = this.supplies.spawn(pool[Math.floor(rnd.next() * pool.length)], v1.copy(at).setY(1.6));
      item.vel.z -= 3.5;
    }
    // Gems: Blocked's colour ammo (red, green, blue, black).
    if (rnd.next() < N.gemChance) {
      const color = GEM_COLORS[Math.floor(rnd.next() * GEM_COLORS.length)];
      const hz = THREE.MathUtils.clamp(at.z - 2.2, N.minZ + 1, this.fieldMaxZ - 1);
      this.gems.spawn(color, at, THREE.MathUtils.clamp(at.x, N.minX + 1, N.maxX - 1), hz);
    }
  }

  onSupply(type, item) {
    if (type === 'B') this.launchBalls();
    else this.powerups.activate(type);
    this.ui?.kill('TANK', FEED.tank, SUPPLY_NAMES[type] ?? POWERUPS[type]?.name ?? type, css(SUPPLY_COLORS[type] ?? 0x9fd8ff));
    this.effects.sparkBurst(item.obj.position, 26, 6, [3, 3, 3, 1]);
  }

  /** Blocks off the near edge: each costs Blocked's contact damage (25 % of its HP, at least 1). */
  onBreach(blocks) {
    if (this.state !== 'playing') return;
    let dmg = 0;
    for (const b of blocks) dmg += Math.max(1, Math.round(b.hp * GameConfig.night.escapeDamage));
    this.breaches += blocks.length;
    this.takeDamage(dmg, `${blocks.length} BLOCK${blocks.length === 1 ? '' : 'S'} GOT PAST`);
  }

  onGem(color) {
    const c = shellOf(color);
    // Blocked: blue 80, the others 20; one green gem in twenty is an acid gem worth 80.
    const n = color === 'green' && rnd.next() < 0.05 ? 80 : c.gem ?? 20;
    this.wheel.add(color, n);
    this.ui?.kill('TANK', FEED.tank, `+${n} ${c.name}`, css(c.id === 'black' ? 0xc8c8d2 : c.chip));
  }

  // ---- Stages -------------------------------------------------------------------------------------

  /** Rows before stage i (the Blocked level of its first row is 1 + that / 10). */
  rowBase(i) {
    return GameConfig.night.stages.slice(0, i).reduce((a, n) => a + n, 0);
  }

  /** Sets the run to stage i: 0-2 a wall of rows (1 on: the long tray), 3 the boss. */
  setStage(i, instant = false) {
    const N = GameConfig.night;
    this.stage = i;
    const long = i > 0;
    this.fieldMaxZ = long ? N.longMaxZ : N.maxZ;
    this.tank.bounds.maxZ = this.fieldMaxZ;
    if (instant) {
      this.stretch = long ? 1 : 0;
      this.desk.setStretch(this.stretch);
      this.follow = 0;
    }
    if (i < N.stages.length) this.wall.reset({ rows: N.stages[i], rowBase: this.rowBase(i), maxZ: this.fieldMaxZ });
    else this.wall.reset({ rows: 0, rowBase: this.rowBase(i), maxZ: this.fieldMaxZ });
  }

  /** Stage 1 done: the tray stretches to twice its length (2.5 s), then stage 2 rolls in. */
  updateStretch(dt) {
    this.stretch = Math.min(1, (this.stretch ?? 0) + dt / 2.5);
    const k = this.stretch * this.stretch * (3 - 2 * this.stretch);
    this.desk.setStretch(k);
    this.fieldMaxZ = GameConfig.night.maxZ + (GameConfig.night.longMaxZ - GameConfig.night.maxZ) * k;
    if (this.stretch >= 1) {
      this.state = 'playing';
      this.setStage(1);
      this.showBanner('', '', '');
      this.ui?.toast(`STAGE 2 - ${GameConfig.night.stages[1]} ROWS`, '#7fe0ff');
    }
  }

  checkEnd() {
    const N = GameConfig.night;
    if (this.state !== 'playing' || this.poster) return;
    if (this.hp <= 0) {
      this.state = 'lost';
      this.time = 0;
      this.showBanner('TANK CRUSHED', `${STAGE_NAMES[this.stage]} · ${this.broken} blocks · ENTER to try again`, 'lost');
      this.effects.blast(this.tank.position.clone().add(v1.set(0, 1, 0)), 2.0);
      return;
    }
    if (this.stage < N.stages.length && this.wall.finished) {
      this.score += 1000 * (this.stage + 1);
      if (this.stage === 0) {
        // The tray grows: twice as long, the camera follows the tank up it from now on.
        this.state = 'stretch';
        this.stretch = 0;
        this.showBanner('STAGE 1 CLEAR', 'The tray stretches out - drive up it, the wall comes from further away', 'won');
        this.ui?.toast('STAGE 1 CLEAR', '#ffd34a');
      } else if (this.stage === 1) {
        this.setStage(2);
        this.ui?.toast(`STAGE 2 CLEAR · STAGE 3 - ${N.stages[2]} ROWS`, '#ffd34a');
      } else {
        // Stage 4: the boss (coming next).
        this.setStage(3);
        this.state = 'won';
        this.time = 0;
        this.showBanner('STAGE 3 CLEAR', `BOSS STAGE - coming soon · ${this.broken} blocks · best chain ×${this.bestChain} · ENTER to play again`, 'won');
        this.ui?.toast('NEON RAIN · BOSS NEXT', '#ffd34a');
      }
    }
  }

  // ---- Camera and HUD ---------------------------------------------------------------------------

  /**
   * The key art's camera, with a little shake. From stage 2 (the long tray) it follows the tank
   * up the tray (`follow`, 0 .. the tray's extra length), easing.
   */
  updateCamera(dt) {
    const N = GameConfig.night;
    const extra = this.fieldMaxZ - N.maxZ;
    const want = extra > 0 ? THREE.MathUtils.clamp(this.tank.position.z - 1.5, 0, extra) : 0;
    this.follow = THREE.MathUtils.damp(this.follow ?? 0, want, 2.2, dt || 1);
    this.camera.position.copy(this.camBase);
    this.camera.position.z += this.follow;
    this.desk.setFollow?.(this.follow / Math.max(1e-3, N.longMaxZ - N.maxZ));
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
      const n = c.infinite ? Infinity : this.wheel.ammo[c.id] ?? 0;
      chip.classList.toggle('on', this.wheel.selected === c.id);
      chip.classList.toggle('off', n <= 0);
      const label = c.infinite ? '∞' : String(n);
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
    const W = this.wall;
    const passed = Math.max(0, W.spawned - W.rows.length);
    const stageRows = W.stageRows || 1;
    const front = W.rows[0];
    const span = this.fieldMaxZ - N.minZ;
    const near = front ? THREE.MathUtils.clamp(1 - (front.z - N.block / 2 - N.minZ) / span, 0, 1) : 0;
    const name = STAGE_NAMES[this.stage] ?? 'BOSS';
    ui.setTankPanel({
      title: `THE TRAY · ${name}`,
      broken: Math.min(passed, stageRows), goal: stageRows, drain: Math.round(near * 100), drainLimit: 100, incoming: 0,
      labels: ['ROWS', 'WALL'], incomingText: `LEVEL ${front?.level ?? W.level}`,
    });
    ui.setObjectives({
      title: `NEON RAIN · ${name}`,
      items: [
        { text: `Get through ${stageRows} rows`, done: W.finished, progress: `${Math.min(passed, stageRows)}/${stageRows}` },
        { text: 'Keep the blocks off the near edge', done: false, progress: `${this.breaches} got past` },
        { text: 'Set off a 10-block chain', done: this.bestChain >= 10, progress: `${Math.min(this.bestChain, 10)}/10` },
      ],
    });
  }
}
