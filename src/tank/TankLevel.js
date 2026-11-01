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

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const GRAVITY = 18;
const TANK_R = 2.25;

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
    this.tank.bounds = { minX: -halfW + TANK_R, maxX: halfW - TANK_R, minZ: 2.4, maxZ: A.topZ - 2 };
    this.tank.heightAt = (z) => this.arena.floorHeight(z);
    this.blocks.resolveTank = (b) => this.pushTank(b);
    this.blocks.onDrain = (b) => this.onDrain(b);
    this.blocks.onDestroyed = (b, depth, at) => this.onBlockDestroyed(b, depth, at);

    this.shells = [];
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
    t.speed = 0;
    t.turnRate = 0;
    t.turretYaw = 0;
    t.recoil = 0;
    t.recoilVel = 0;
    t.cooldown = 0;
    for (const s of this.shells) s.mesh.removeFromParent();
    this.shells = [];
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
    t.update(dt, drive, this.aim);
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

  /**
   * A sliding block touching the tank pushes it (out of the block's square). Returns how far the
   * block has to be held back when the tank cannot give way (pinned against the bottom / walls).
   */
  pushTank(b) {
    const p = this.tank.position;
    const h = this.blocks.size * 0.5;
    const cx = THREE.MathUtils.clamp(p.x, b.x - h, b.x + h);
    const cz = THREE.MathUtils.clamp(p.z, b.z - h, b.z + h);
    let dx = p.x - cx;
    let dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= TANK_R * TANK_R) return 0;
    let d = Math.sqrt(d2);
    if (d < 1e-4) {
      dx = 0;
      dz = -1;
      d = 1;
    }
    const over = TANK_R - d;
    p.x += (dx / d) * over;
    p.z += (dz / d) * over;
    this.tank.clampToBounds();
    // Whatever overlap is left holds the block back up the lane.
    const cz2 = THREE.MathUtils.clamp(p.z, b.z - h, b.z + h);
    const cx2 = THREE.MathUtils.clamp(p.x, b.x - h, b.x + h);
    const rest = Math.hypot(p.x - cx2, p.z - cz2);
    if (rest >= TANK_R - 1e-3 || p.z > b.z) return 0;
    return TANK_R - rest;
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

  // ---- Shooting ------------------------------------------------------------------------------

  /** Shot: barrel kick, muzzle flash, shells lobbed to land on the aim point (3 with T). */
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
    const p = this.tank.position;
    const dist = THREE.MathUtils.clamp(Math.hypot(this.aim.x - p.x, this.aim.z - p.z), 5, cfg.shellRange);
    const spreads = this.powers.T > 0 ? [-0.14, 0, 0.14] : [0];
    for (const off of spreads) {
      const yaw = this.tank.gunYaw + off;
      const tx = p.x + Math.sin(yaw) * dist;
      const tz = p.z + Math.cos(yaw) * dist;
      const ty = this.arena.floorHeight(tz) + (this.blocks.blockAt(tx, tz) ? this.blocks.size : 0.1);
      const T = Math.max(0.2, Math.hypot(tx - muzzle.x, tz - muzzle.z) / cfg.shellSpeed);
      const vel = new THREE.Vector3((tx - muzzle.x) / T, (ty - muzzle.y + 0.5 * GRAVITY * T * T) / T, (tz - muzzle.z) / T);
      const mesh = new THREE.Mesh(this.shellGeometry, this.shellMaterial);
      mesh.position.copy(muzzle);
      this.scene.add(mesh);
      this.shells.push({ mesh, vel, t: 0, T, heavy: this.powers.R > 0 });
    }
  }

  updateShells(dt) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t += dt;
      s.vel.y -= GRAVITY * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.lookAt(v1.copy(s.mesh.position).add(s.vel));
      this.effects.fire.emit({ x: s.mesh.position.x, y: s.mesh.position.y, z: s.mesh.position.z, life: 0.12, size0: 0.45, size1: 0.1, color0: [3, 1.8, 0.6, 1], color1: [1, 0.4, 0.1, 0] });
      if (s.t < s.T) continue;
      const at = s.mesh.position;
      s.mesh.removeFromParent();
      this.shells.splice(i, 1);
      this.impact(at, s.heavy);
    }
  }

  impact(at, heavy) {
    const dmg = GameConfig.tank.shellDamage;
    const b = this.blocks.blockAt(at.x, at.z);
    if (b) this.blocks.damage(b, dmg * (heavy ? 2 : 1), at);
    if (heavy) {
      // Splash: the four neighbours take a hit too.
      const S = this.blocks.size;
      for (const [dx, dz] of [[S, 0], [-S, 0], [0, S], [0, -S]]) {
        const n = this.blocks.blockAt(at.x + dx, at.z + dz);
        if (n) this.blocks.damage(n, dmg, v2.set(n.x, at.y, n.z));
      }
    }
    this.effects.explosion(at, heavy ? 1.3 : 0.9, b ? null : 0x7a6a52, b ? 0 : 6);
    if (!b) this.effects.snowPuff(v2.set(at.x, at.y + 0.1, at.z), 6);
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
