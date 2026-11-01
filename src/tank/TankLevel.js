import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { EffectsManager } from '../fx/EffectsManager.js';
import { PlayerTank } from './PlayerTank.js';
import { TankArena } from './TankArena.js';
import { BlockFlow } from './BlockFlow.js';
import { DrainPile } from './DrainPile.js';
import { ArenaTrain } from './ArenaTrain.js';
import { SupplyCrates } from '../entities/PowerUps.js';
import { PickupSfx } from '../audio/PickupSfx.js';
import { fxRandom as rnd } from '../util/Random.js';
import { reticleTexture } from '../ui/Reticle.js';

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Tank power-ups from supply blocks (the heli game's crates, tank meanings). */
const POWER_NAMES = Object.freeze({ T: 'TRIPLE SHELLS', D: 'RAPID FIRE', R: 'HEAVY SHELLS', H: 'DRAIN PUMP -10', G: 'RAPID FIRE' });

/**
 * Tank level (menu card IRON TRACKS), phase 1. The tank drives in a sloped concrete channel with
 * shallow flowing water. Trains cross the rail at the far end and drop blocks into the lanes;
 * the blocks slide down toward the dam (pushing each other, and pushing the tank) and whatever
 * gets past the lip tumbles into the oval drain and piles up there (physics).
 *   1000 blocks come in phase 1: break 900. 100 blocks in the drain loses.
 *   Same-coloured neighbours chain-explode; weak / normal / strong (caged) / supply (star) blocks.
 *   Supplies: T triple shells, D rapid fire, R heavy shells (splash), H drain pump (-10 blocks).
 * The tank is solid: blocks sliding into it stop in front of it (and hold up their lane), and it
 * cannot drive through them.
 * Aiming (smart aim, like the heli): the mouse turns the turret; within a narrow cone around that
 * direction the best block is locked (reticle), the turret settles on it and the barrel depresses
 * toward it. Shells fly straight (direct fire) and hit the first block in their path.
 * Controls: W/S drive, A/D turn, mouse aims the turret, click / SPACE fires, ENTER restarts a
 * finished phase, ESC pause menu. Own scene and camera; the game's pipeline points at them.
 */
export class TankLevel {
  /**
   * @param {{ gltf:any, textures:any, materials:any, trainFactory:any, renderer:THREE.WebGLRenderer, input:any, quality:any, settings:any }} deps
   */
  constructor({ gltf, textures, materials, trainFactory, renderer, input, quality, settings, environment }) {
    this.input = input;
    this.settings = settings;
    this.trainFactory = trainFactory;
    this.element = renderer.domElement;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9cc4e4);
    this.scene.fog = new THREE.Fog(0x9cc4e4, 90, 190);
    // Same room environment as the heli game (reflections on water, blocks and trees).
    this.scene.environment = environment ?? null;
    this.scene.environmentIntensity = 0.35;
    const cfg = GameConfig.tank.camera;
    this.camera = new THREE.PerspectiveCamera(cfg.fov, 16 / 9, 0.5, 500);
    this.camera.userData.baseFov = cfg.fov;

    this.scene.add(new THREE.HemisphereLight(0xe2f0ff, 0x58663f, 1.15));
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.7);
    this.sun.castShadow = true;
    const sm = quality?.shadowMapSize ?? 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 120;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.arena = new TankArena(materials, textures);
    this.scene.add(this.arena.group);

    const debris = new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.9 });
    this.effects = new EffectsManager(this.scene, textures, debris, (x, z) => this.arena.floorHeight(z), { flashLights: 3 });
    this.blocks = new BlockFlow(materials, this.effects, this.arena);
    this.scene.add(this.blocks.group);
    this.pile = new DrainPile(materials, this.effects, this.arena);
    this.scene.add(this.pile.group);
    this.supplies = new SupplyCrates(this.scene, this.effects, textures, materials);
    this.supplies.onPickup = (type, item) => this.onPickup(type, item);

    this.tank = new PlayerTank(gltf);
    this.scene.add(this.tank.root);
    const A = GameConfig.tankArena;
    const halfW = (A.block * A.lanes) / 2;
    // The hull footprint stays in the channel, above the dam lip and below the landing zone.
    this.tank.bounds = { minX: -halfW, maxX: halfW, minZ: 0.3, maxZ: A.topZ - A.block * 2.6 };
    this.tank.heightAt = (z) => this.arena.floorHeight(z);
    this.tank.collide = () => this.collideTank();
    this.blocks.resolveTank = (b) => this.holdBlock(b);
    this.blocks.onDrain = (b) => this.onDrain(b);
    this.blocks.onDestroyed = (b, depth, at) => this.onBlockDestroyed(b, depth, at);

    this.shells = [];
    this.lock = null;
    this.time = 0;
    this.reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleTexture(), depthTest: false, transparent: true }));
    this.reticle.renderOrder = 30;
    this.reticle.visible = false;
    this.reticleSpin = 0;
    this.scene.add(this.reticle);
    this.shellGeometry = new THREE.CapsuleGeometry(0.13, 0.5, 4, 8).rotateX(Math.PI / 2);
    this.shellMaterial = new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffa040, emissiveIntensity: 2.2, roughness: 0.3 });
    this.aim = new THREE.Vector3(0, 0, 20);
    this.pointer = null;
    this.shake = 0;
    this.camPos = new THREE.Vector3();
    this.active = false;
    this.dustTimer = 0;
    this.powers = { T: 0, D: 0, R: 0 };
    this.buildHud();

    this.onPointerMove = (e) => {
      const r = this.element.getBoundingClientRect();
      this.pointer = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
    };
    this.onPointerDown = (e) => {
      if (!this.active || this.paused) return;
      this.onPointerMove(e);
      if (e.button === 0 || e.pointerType !== 'mouse') this.fireQueued = true;
    };
  }

  buildHud() {
    const el = document.createElement('div');
    el.className = 'tank-hud';
    el.innerHTML = `
      <div class="th-stats">
        <div class="th-stat"><span>BROKEN</span><b data-broken>0</b><em>/ ${GameConfig.tankArena.breakGoal}</em></div>
        <div class="th-stat drain"><span>DRAIN</span><b data-drain>0</b><em>/ ${GameConfig.tankArena.drainLimit}</em><i class="th-bar"><i data-drainbar></i></i></div>
        <div class="th-stat"><span>INCOMING</span><b data-left>${GameConfig.tankArena.phaseBlocks}</b></div>
      </div>
      <div class="th-powers" data-powers></div>
      <div class="th-banner" data-banner></div>
      <div class="th-title">IRON TRACKS <small>PHASE 1 · THE CHANNEL</small></div>
      <div class="th-keys"><b>W S</b> drive · <b>A D</b> turn · <b>MOUSE</b> aim · <b>CLICK / SPACE</b> fire · <b>ESC</b> menu</div>
      <div class="th-reload"><i></i></div>`;
    Object.assign(el.style, { display: 'none' });
    this.hud = el;
    this.reloadBar = el.querySelector('.th-reload i');
    this.hudEl = {
      broken: el.querySelector('[data-broken]'), drain: el.querySelector('[data-drain]'), drainBar: el.querySelector('[data-drainbar]'),
      left: el.querySelector('[data-left]'), powers: el.querySelector('[data-powers]'), banner: el.querySelector('[data-banner]'),
    };
    (this.element.parentElement ?? document.body).appendChild(el);
  }

  /** Starts (or restarts) phase 1: tank at the bottom of the channel, everything cleared. */
  start() {
    this.active = true;
    this.paused = false;
    const t = this.tank;
    t.root.position.set(0, 0, 8);
    t.heading = 0;
    t.elevation = t.aimElevation = -0.12;
    this.lock = null;
    t.speed = 0;
    t.turnRate = 0;
    t.turretYaw = 0;
    t.recoil = 0;
    t.recoilVel = 0;
    t.cooldown = 0;
    for (const s of this.shells) s.mesh.removeFromParent();
    this.shells = [];
    this.lock = null;
    this.time = 0;
    this.reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleTexture(), depthTest: false, transparent: true }));
    this.reticle.renderOrder = 30;
    this.reticle.visible = false;
    this.reticleSpin = 0;
    this.scene.add(this.reticle);
    this.blocks.reset();
    this.pile.reset();
    this.supplies.clear();
    this.train?.dispose();
    this.train = null;
    this.trainTimer = 1.5;
    this.trainDir = 1;
    this.trainCount = 0;
    this.dropped = 0;
    this.broken = 0;
    this.powers = { T: 0, D: 0, R: 0 };
    this.state = 'playing';
    this.hudEl.banner.className = 'th-banner';
    this.aim.set(0, 0, 24);
    this.pointer = null;
    this.updateCamera(0, true);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.hud.style.display = '';
    this.blocks.render();
    this.pile.render();
  }

  stop() {
    this.active = false;
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.hud.style.display = 'none';
  }

  update(dt) {
    const keys = this.input.keys;
    const k = (...codes) => codes.some((c) => keys.has(c));
    if (this.state !== 'playing' && k('Enter', 'NumpadEnter')) {
      keys.delete('Enter');
      this.start();
      return;
    }
    const playing = this.state === 'playing';
    const drive = playing ? {
      throttle: (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0),
      turn: (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0),
    } : { throttle: 0, turn: 0 };
    if (this.pointer) {
      ndc.set(this.pointer.x, this.pointer.y);
      ray.setFromCamera(ndc, this.camera);
      plane.constant = -this.arena.floorHeight(this.aim.z) - 1;
      if (ray.ray.intersectPlane(plane, v1)) this.aim.copy(v1);
    }
    this.step(dt, drive, playing && (this.fireQueued || keys.has('Space')));
    this.fireQueued = false;
  }

  /** One simulation step (also driven by test scripts). */
  step(dt, drive, fire) {
    const t = this.tank;
    this.time += dt;
    // Smart aim: the turret settles on the locked block, the barrel depresses toward it.
    const lock = this.state === 'playing' ? this.lockedTarget() : null;
    const target = lock ? this.blockCenter(lock, v3) : this.freeAimPoint(v3);
    t.update(dt, drive, target);
    this.aimBarrel(target);
    this.updateReticle(dt, lock, target);
    for (const key of Object.keys(this.powers)) this.powers[key] = Math.max(0, this.powers[key] - dt);
    if (fire) this.fire();
    if (this.state === 'playing') this.updateTrains(dt);
    this.blocks.update(dt);
    this.pile.update(dt);
    this.updateShells(dt);
    this.supplies.update(dt, v1.copy(t.position).setY(t.position.y + 1.2), this.state === 'playing');
    this.updateDust(dt);
    this.arena.update(dt);
    this.effects.update(dt);
    this.blocks.render();
    this.pile.render();
    this.updateCamera(dt);
    this.checkEnd();
    this.updateHud();
  }

  // ---- Trains ----------------------------------------------------------------------------

  updateTrains(dt) {
    const A = GameConfig.tankArena;
    if (this.train) {
      this.train.update(dt, (x) => this.blocks.laneAt(x));
      if (this.train.done) {
        this.train.dispose();
        this.train = null;
        this.trainTimer = A.trainGap;
      }
      return;
    }
    if (this.dropped >= A.phaseBlocks) return;
    this.trainTimer -= dt;
    if (this.trainTimer > 0) return;
    this.trainCount += 1;
    const [lo, hi] = A.trainCars;
    const wagons = lo + Math.floor(Math.random() * (hi - lo + 1));
    this.train = new ArenaTrain(this.trainFactory, this.effects, this.arena.railY, this.trainDir, wagons, this.trainCount);
    this.trainDir = -this.trainDir;
    this.train.onDrop = (lane, from) => this.trainDrop(lane, from);
    this.scene.add(this.train.group);
  }

  /** A wagon over a lane: a block (or two back to back), or a gap. */
  trainDrop(lane, from) {
    const A = GameConfig.tankArena;
    if (this.dropped >= A.phaseBlocks || Math.random() > A.dropChance) return;
    const z = A.topZ - A.block * (0.5 + Math.random() * 1.5);
    this.blocks.drop(lane, z, from);
    this.dropped += 1;
    if (this.dropped < A.phaseBlocks && Math.random() < A.doubleChance) {
      this.blocks.drop(lane, z, from.clone().add(v2.set(0, 1.4, 0)));
      this.dropped += 1;
    }
  }

  // ---- Blocks vs tank, drain, scoring -------------------------------------------------------

  /** Projections of the tank footprint and a block square on a 2D axis (ax, az). */
  project(ax, az, b, out) {
    const t = this.tank;
    const p = t.position;
    const c = Math.cos(t.heading);
    const sn = Math.sin(t.heading);
    // Tank right (c, -sn), forward (sn, c).
    const tr = t.half.x * Math.abs(c * ax - sn * az) + t.half.z * Math.abs(sn * ax + c * az);
    const tc = p.x * ax + p.z * az;
    const h = this.blocks.size * 0.475;
    const br = h * (Math.abs(ax) + Math.abs(az));
    const bc = b.x * ax + b.z * az;
    out.tmin = tc - tr; out.tmax = tc + tr; out.bmin = bc - br; out.bmax = bc + br; out.tc = tc; out.bc = bc;
    return out;
  }

  /** Separating axes of the footprint / block pair: the block's x, z and the hull's right, forward. */
  axes() {
    const c = Math.cos(this.tank.heading);
    const sn = Math.sin(this.tank.heading);
    return [[1, 0], [0, 1], [c, -sn], [sn, c]];
  }

  near(b) {
    const p = this.tank.position;
    return Math.abs(b.x - p.x) < 4.6 && Math.abs(b.z - p.z) < 4.6;
  }

  /**
   * A block sliding into the tank stops in front of it: returns how far up the lane it has to be
   * held back (0 when it is clear of the hull or below it).
   */
  holdBlock(b) {
    if (!this.near(b) || b.z <= this.tank.position.z) return 0;
    const pr = {};
    let need = Infinity;
    for (const [ax, az] of this.axes()) {
      this.project(ax, az, b, pr);
      if (pr.bmin >= pr.tmax || pr.bmax <= pr.tmin) return 0;
      // Moving the block by dz along +z shifts its projection by dz * az.
      if (az > 1e-4) need = Math.min(need, (pr.tmax - pr.bmin) / az);
      else if (az < -1e-4) need = Math.min(need, (pr.tmin - pr.bmax) / az);
    }
    return Number.isFinite(need) ? need + 1e-3 : 0;
  }

  /** The hull cannot drive into blocks: pushed back out along the axis of least overlap. */
  collideTank() {
    const p = this.tank.position;
    const pr = {};
    for (let pass = 0; pass < 2; pass++) {
      for (const lane of this.blocks.lanes) {
        for (const b of lane) {
          if (!this.near(b)) continue;
          let best = Infinity;
          let bx = 0;
          let bz = 0;
          for (const [ax, az] of this.axes()) {
            this.project(ax, az, b, pr);
            const o = Math.min(pr.tmax - pr.bmin, pr.bmax - pr.tmin);
            if (o <= 0) { best = 0; break; }
            if (o < best) {
              best = o;
              const sgn = pr.tc < pr.bc ? -1 : 1;
              bx = ax * sgn;
              bz = az * sgn;
            }
          }
          if (best > 0 && Number.isFinite(best)) {
            p.x += bx * best;
            p.z += bz * best;
          }
        }
      }
    }
  }

  onDrain(b) {
    this.pile.add(b.x, this.arena.floorHeight(0) + this.blocks.size / 2, -0.2, b.color);
    this.effects.snowPuff(v1.set(b.x, 0.3, -0.3), 5);
  }

  onBlockDestroyed(b, depth, at) {
    this.broken += 1;
    this.shake = Math.max(this.shake, depth > 0 ? 0.12 : 0.18);
    if (b.type === 'supply' && this.state === 'playing') this.supplies.spawnRandom(at, { gems: false, homing: true });
  }

  onPickup(type, item) {
    const s = this.settings;
    PickupSfx.play(s ? (s.master / 10) * (s.sfx / 10) : 0.64, 0, type === 'H' ? -0.1 : 0);
    if (type === 'H') {
      this.pile.remove(10);
    } else {
      const key = type === 'G' ? 'D' : type;
      this.powers[key] = GameConfig.tankArena.powerTime;
    }
    this.flashBanner(POWER_NAMES[type] ?? type, 1.4);
    this.effects.sparkBurst(item.mesh.position, 26, 6, [3, 3, 3, 1]);
  }

  checkEnd() {
    if (this.state !== 'playing') return;
    const A = GameConfig.tankArena;
    if (this.pile.count >= A.drainLimit) {
      this.state = 'lost';
      this.showBanner('DRAIN OVERFLOW', 'The drain is full · ENTER to try again', 'lost');
    } else if (this.dropped >= A.phaseBlocks && !this.train && this.blocks.count === 0) {
      const won = this.broken >= A.breakGoal;
      this.state = won ? 'won' : 'lost';
      if (won) this.showBanner('PHASE 1 CLEAR!', `${this.broken} blocks broken · ${this.pile.count} in the drain · ENTER to play again`, 'won');
      else this.showBanner('NOT ENOUGH', `Only ${this.broken} / ${A.breakGoal} broken · ENTER to try again`, 'lost');
    }
  }

  showBanner(title, sub, cls) {
    this.hudEl.banner.innerHTML = `<b>${title}</b><span>${sub}</span>`;
    this.hudEl.banner.className = `th-banner show ${cls}`;
  }

  flashBanner(text, seconds) {
    if (this.state !== 'playing') return;
    this.hudEl.banner.innerHTML = `<b>${text}</b>`;
    this.hudEl.banner.className = 'th-banner show power';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      if (this.state === 'playing') this.hudEl.banner.className = 'th-banner';
    }, seconds * 1000);
  }

  updateHud() {
    const A = GameConfig.tankArena;
    const e = this.hudEl;
    const t = this.tank;
    e.broken.textContent = this.broken;
    e.drain.textContent = this.pile.count;
    e.drainBar.style.width = `${Math.min(100, (this.pile.count / A.drainLimit) * 100)}%`;
    e.left.textContent = Math.max(0, A.phaseBlocks - this.dropped);
    const pw = Object.entries(this.powers).filter(([, v]) => v > 0).map(([k, v]) => `<span>${POWER_NAMES[k]} ${Math.ceil(v)}s</span>`).join('');
    if (pw !== this.powersHtml) {
      this.powersHtml = pw;
      e.powers.innerHTML = pw;
    }
    this.reloadBar.style.width = `${Math.round((1 - t.cooldown / (t.reloadTime || GameConfig.tank.reload)) * 100)}%`;
  }

  // ---- Aiming (smart aim) ---------------------------------------------------------------------

  /**
   * The locked block (refreshed every lockRefresh s): within aimCone around the direction the
   * player aims the turret, the best block by angle and distance (nearer and more centred wins),
   * or null.
   */
  lockedTarget() {
    const cfg = GameConfig.tank;
    const L = this.lock;
    if (L && this.time - L.at < cfg.lockRefresh && L.block.alive && !L.block.drained) return L.block;
    const p = this.tank.position;
    const yaw = Math.atan2(this.aim.x - p.x, this.aim.z - p.z);
    let best = null;
    let bestScore = Infinity;
    for (const lane of this.blocks.lanes) {
      for (const b of lane) {
        const dx = b.x - p.x;
        const dz = b.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 2.6 || d > cfg.shellRange) continue;
        const ang = Math.abs(wrap(Math.atan2(dx, dz) - yaw));
        if (ang > cfg.aimCone) continue;
        // Keep the current lock unless something is clearly better (no flicker between neighbours).
        const score = ang * 12 + d * 0.35 - (L && L.block === b ? 0.6 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = b;
        }
      }
    }
    this.lock = best ? { block: best, at: this.time } : null;
    return best;
  }

  blockCenter(b, out) {
    const s = this.blocks.size * 0.95 * (b.type === 'weak' ? 0.9 : 1);
    return out.set(b.x, this.arena.floorHeight(b.z) + s / 2, b.z);
  }

  /** No lock: a point along the aim direction at block-centre height. */
  freeAimPoint(out) {
    const p = this.tank.position;
    const dx = this.aim.x - p.x;
    const dz = this.aim.z - p.z;
    const d = Math.max(1e-3, Math.hypot(dx, dz));
    const r = THREE.MathUtils.clamp(d, 8, 26);
    out.set(p.x + (dx / d) * r, 0, p.z + (dz / d) * r);
    out.y = this.arena.floorHeight(out.z) + 0.9;
    return out;
  }

  /** Barrel elevation toward the target (from the barrel's pivot). */
  aimBarrel(target) {
    const t = this.tank;
    t.turret.updateWorldMatrix(true, false);
    const pivot = t.turret.localToWorld(v2.copy(t.barrelHome));
    const h = Math.hypot(target.x - pivot.x, target.z - pivot.z);
    t.aimElevation = Math.atan2(target.y - pivot.y, Math.max(h, 0.5));
  }

  updateReticle(dt, lock, target) {
    const r = this.reticle;
    r.visible = this.state === 'playing';
    if (!r.visible) return;
    this.reticleSpin += dt * (lock ? 2 : 0.8);
    r.position.copy(target);
    r.material.rotation = this.reticleSpin;
    r.material.opacity = lock ? 1 : 0.4;
    r.scale.setScalar(lock ? 2.6 + Math.sin(this.reticleSpin * 3) * 0.18 : 2.2);
  }

  // ---- Shooting ------------------------------------------------------------------------------

  /** Shot: barrel kick, muzzle flash, shells straight at the locked block (3 with T). */
  fire() {
    const shot = this.tank.fire(this.powers.D > 0 ? 0.4 : 1);
    if (!shot) return;
    const cfg = GameConfig.tank;
    const { muzzle, dir } = shot;
    this.effects.muzzleFlash(muzzle, dir, [4, 2.6, 0.9, 1], 1.6);
    this.effects.flash(muzzle, 0xffb060, 70, 0.25, 12);
    for (let i = 0; i < 8; i++) {
      this.effects.smoke.emit({
        x: muzzle.x + dir.x * 0.4, y: muzzle.y + dir.y * 0.4, z: muzzle.z + dir.z * 0.4,
        vx: dir.x * rnd.range(2, 6) + rnd.spread(1.6), vy: dir.y * rnd.range(2, 6) + rnd.range(0, 1), vz: dir.z * rnd.range(2, 6) + rnd.spread(1.6), drag: 2.4,
        life: rnd.range(0.6, 1.2), size0: rnd.range(0.5, 0.8), size1: rnd.range(1.8, 2.6),
        color0: [0.7, 0.68, 0.64, 0.8], color1: [0.85, 0.85, 0.86, 0], rotVel: rnd.spread(1),
      });
    }
    this.shake = Math.max(this.shake, 0.3);
    // Locked: straight at the block's centre (the gunner corrects the last few degrees).
    const lock = this.lock?.block?.alive ? this.lock.block : null;
    const aimDir = lock ? this.blockCenter(lock, new THREE.Vector3()).sub(muzzle).normalize() : dir.clone();
    // Point blank: a block between the barrel's base and the muzzle (pressed against the hull)
    // takes the hit at once.
    const pivot = this.tank.turret.localToWorld(v3.copy(this.tank.barrelHome));
    const close = this.traceBlock(pivot, muzzle);
    if (close) {
      this.impact(this.blockCenter(close, v1).clone(), this.powers.R > 0, close, 'block');
      return;
    }
    const spreads = this.powers.T > 0 ? [-0.12, 0, 0.12] : [0];
    for (const off of spreads) {
      const vel = v2.copy(aimDir).applyAxisAngle(UP, off).multiplyScalar(cfg.shellSpeed).clone();
      const mesh = new THREE.Mesh(this.shellGeometry, this.shellMaterial);
      mesh.position.copy(muzzle);
      mesh.lookAt(v1.copy(muzzle).add(vel));
      this.scene.add(mesh);
      this.shells.push({ mesh, vel, dist: 0, heavy: this.powers.R > 0 });
    }
  }

  /** First block on the segment a -> b (0.25 steps), or null. */
  traceBlock(a, b) {
    const d = a.distanceTo(b);
    const n = Math.max(1, Math.ceil(d / 0.25));
    const p = new THREE.Vector3();
    for (let k = 0; k <= n; k++) {
      p.lerpVectors(a, b, k / n);
      const blk = this.blocks.blockAt(p.x, p.z);
      if (blk && p.y <= this.blockCenter(blk, v1).y * 2 - this.arena.floorHeight(blk.z)) return blk;
    }
    return null;
  }

  /** Direct fire: each shell flies straight and stops at the first block, wall or the floor. */
  updateShells(dt) {
    const A = GameConfig.tankArena;
    const halfW = (A.block * A.lanes) / 2;
    const range = GameConfig.tank.shellRange;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      const p = s.mesh.position;
      const speed = s.vel.length();
      const n = Math.max(1, Math.ceil((speed * dt) / 0.5));
      const h = dt / n;
      let hit = null;
      let block = null;
      for (let k = 0; k < n && !hit; k++) {
        p.addScaledVector(s.vel, h);
        s.dist += speed * h;
        const b = this.blocks.blockAt(p.x, p.z);
        if (b && p.y <= this.blockCenter(b, v1).y * 2 - this.arena.floorHeight(b.z)) {
          hit = 'block';
          block = b;
        } else if (p.y <= this.arena.floorHeight(p.z) + 0.05) hit = 'floor';
        else if (Math.abs(p.x) > halfW || p.z > A.topZ + 0.5) hit = 'wall';
        else if (s.dist > range) hit = 'air';
      }
      this.effects.fire.emit({ x: p.x, y: p.y, z: p.z, life: 0.12, size0: 0.45, size1: 0.1, color0: [3, 1.8, 0.6, 1], color1: [1, 0.4, 0.1, 0] });
      if (!hit) continue;
      s.mesh.removeFromParent();
      this.shells.splice(i, 1);
      this.impact(p, s.heavy, block, hit);
    }
  }

  impact(at, heavy, b, kind) {
    const dmg = GameConfig.tank.shellDamage;
    if (b) this.blocks.damage(b, dmg * (heavy ? 2 : 1), at);
    if (heavy) {
      // Splash: the four neighbours take a hit too.
      const S = this.blocks.size;
      for (const [dx, dz] of [[S, 0], [-S, 0], [0, S], [0, -S]]) {
        const n = this.blocks.blockAt(at.x + dx, at.z + dz);
        if (n && n !== b) this.blocks.damage(n, dmg, v2.set(n.x, at.y, n.z));
      }
    }
    const debris = kind === 'wall' ? 0xb9b6ad : 0x7a6a52;
    this.effects.explosion(at, heavy ? 1.3 : 0.9, b ? null : debris, b || kind === 'air' ? 0 : 6);
    if (kind === 'floor') this.effects.snowPuff(v2.set(at.x, at.y + 0.1, at.z), 6);
    const d = at.distanceTo(this.tank.position);
    this.shake = Math.max(this.shake, THREE.MathUtils.clamp(0.4 - d * 0.01, 0.06, 0.4));
  }

  /** Spray behind the tracks while driving (shallow water). */
  updateDust(dt) {
    const t = this.tank;
    const moving = Math.abs(t.speed) + Math.abs(t.turnRate) * 1.5;
    this.dustTimer -= dt * moving;
    if (this.dustTimer > 0) return;
    this.dustTimer = 0.3;
    for (const x of t.track.x) {
      v1.set(x, 0.2, -2.3 * Math.sign(t.speed || 1)).applyMatrix4(t.root.matrixWorld);
      this.effects.smoke.emit({
        x: v1.x + rnd.spread(0.3), y: this.arena.floorHeight(v1.z) + 0.3, z: v1.z + rnd.spread(0.3), vx: rnd.spread(0.8), vy: rnd.range(0.8, 1.8), vz: rnd.spread(0.8), drag: 1.8, gravity: 4,
        life: rnd.range(0.5, 0.9), size0: 0.4, size1: rnd.range(1.2, 1.8), color0: [1.15, 1.3, 1.4, 0.6], color1: [1.1, 1.2, 1.3, 0],
      });
    }
  }

  /** Follow camera from behind the tank's start heading (looking up the channel). */
  updateCamera(dt, snap = false) {
    const cfg = GameConfig.tank.camera;
    const p = this.tank.position;
    const A = GameConfig.tankArena;
    const halfW = (A.block * A.lanes) / 2;
    // Keep the channel framed: follow x only partly, z fully.
    v1.set(THREE.MathUtils.clamp(p.x * 0.4, -halfW * 0.3, halfW * 0.3), cfg.height, p.z * cfg.follow - cfg.back);
    if (snap) this.camPos.copy(v1);
    else this.camPos.lerp(v1, 1 - Math.exp(-4 * dt));
    this.camera.position.copy(this.camPos);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    if (this.shake > 0) this.camera.position.add(v2.set(rnd.spread(1), rnd.spread(1), rnd.spread(1)).multiplyScalar(this.shake * 0.35));
    this.camera.lookAt(this.camPos.x, 0, this.camPos.z + cfg.ahead);
    this.sun.position.set(p.x - 20, p.y + 40, p.z - 6);
    this.sun.target.position.set(p.x, p.y, p.z + 10);
  }
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
