import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { RenderPipeline } from './RenderPipeline.js';
import { Input } from './Input.js';
import { TextureFactory } from '../textures/TextureFactory.js';
import { MaterialLibrary } from '../textures/MaterialLibrary.js';
import { World } from '../world/World.js';
import { EffectsManager } from '../fx/EffectsManager.js';
import { ProjectileSystem } from '../fx/ProjectileSystem.js';
import { BlockField } from '../entities/BlockField.js';
import { Helicopter } from '../entities/Helicopter.js';
import { Train } from '../entities/Train.js';
import { TrainModelFactory } from '../entities/TrainModels.js';
import { SpikeMines } from '../entities/SpikeMines.js';
import { Hud } from '../ui/Hud.js';
import { PowerUpSystem, SupplyCrates, cssOf } from '../entities/PowerUps.js';
import { fxRandom as rnd } from '../util/Random.js';
import { Palette, BLOCK_COLOR_KEYS } from '../config/Palette.js';
import { createCanvas, canvasToTexture } from '../textures/CanvasUtils.js';

const SCORE = Object.freeze({ block: 10, cargo: 25, turret: 100, gem: 500, mine: 50, supply: 50 });
const GameState = Object.freeze({ TITLE: 'title', PLAYING: 'playing', DEAD: 'dead', OVER: 'over' });

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const dir = new THREE.Vector3();
const v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Composition root and main loop. Wires systems together and mediates
 * collisions between projectiles and entities.
 */
export class Game {
  /**
   * @param {HTMLElement} container
   * @param {{ quality?: string, poster?: boolean }} options
   */
  constructor(container, options = {}) {
    this.options = options;
    this.container = container;
    const cam = { ...GameConfig.camera };
    const o = options.camOverride;
    if (o?.length >= 6) {
      cam.position = o.slice(0, 3);
      [cam.pitchDeg, cam.yawDeg, cam.fov] = o.slice(3, 6);
      if (o.length > 6) cam.lensK = o[6];
    }
    this.cameraSpec = cam;
    this.pipeline = new RenderPipeline(container, options.quality ?? 'high', { preserveDrawingBuffer: !!options.poster, lensK: cam.lensK });
    const renderer = this.pipeline.renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(cam.fov, 16 / 9, 0.5, 2000);
    this.cameraBase = new THREE.Vector3(...cam.position);
    this.camera.position.copy(this.cameraBase);
    this.camera.userData.baseFov = cam.fov;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(
      THREE.MathUtils.degToRad(-cam.pitchDeg),
      THREE.MathUtils.degToRad(-cam.yawDeg),
      THREE.MathUtils.degToRad(cam.rollDeg)
    );
    this.pipeline.init(this.scene, this.camera);
    this.camera.updateMatrixWorld(true);
    this.heliAnchor = this.screenToWorld(cam.heliScreen[0], cam.heliScreen[1], GameConfig.heli.altitude);

    this.textures = new TextureFactory(renderer);
    this.materials = new MaterialLibrary(this.textures);
    this.world = new World(this.scene, this.camera, renderer, this.textures, this.materials, {
      shadowMapSize: this.pipeline.quality.shadowMap,
      floorTexture: options.floorTexture ?? null,
    });

    const debrisMaterial = new THREE.MeshStandardMaterial({
      map: this.textures.blockSurface().map,
      normalMap: this.textures.blockSurface().normalMap,
      roughness: 0.6,
    });
    this.effects = new EffectsManager(this.scene, this.textures, debrisMaterial, (x, z) => this.world.board.groundHeightAt(x, z), {
      flashLights: this.pipeline.quality.msaa > 0 ? 4 : 2,
    });
    this.projectiles = new ProjectileSystem(this.scene, this.textures, this.effects);
    this.projectiles.collisionHandler = (p, point) => this.resolveHit(p, point);

    this.blocks = new BlockField(this.materials, this.effects);
    this.scene.add(this.blocks.group);
    this.blocks.onBlockDestroyed = (block, depth) => {
      this.addScore(SCORE.block * (1 + depth));
      // Supply blocks always drop a supply (random type).
      if (block.type === 'supply' && this.state !== GameState.OVER) this.supplies.spawnRandom(v1.set(block.x, GameConfig.blockSize * 0.6, block.z));
      if (depth > 0) this.shake = Math.max(this.shake, 0.12);
    };
    // Power-ups + supply crates (25% drop chance from destroyed board blocks).
    this.powerups = new PowerUpSystem();
    this.supplies = new SupplyCrates(this.scene, this.effects, this.textures, this.materials);
    this.supplies.onPickup = (type, item) => {
      this.addScore(SCORE.supply);
      if (type === 'H') {
        const before = this.heli.hp;
        this.heli.hp = Math.min(GameConfig.heli.maxHp, this.heli.hp + GameConfig.supply.healAmount);
        this.hud.setHealth(this.heli.hp / GameConfig.heli.maxHp);
        this.hud.notice(`+${Math.round(this.heli.hp - before)} HP`, '#ff6b78');
        this.effects.sparkBurst(this.heli.position, 30, 6, [4, 0.8, 1, 1]);
      } else if (type === 'G') {
        this.powerups.activate('G', null, { color: item.color, css: cssOf(item.color) });
      } else {
        this.powerups.activate(type);
      }
    };

    this.mines = new SpikeMines(this.materials, this.world.board, this.blocks, this.effects);
    this.scene.add(this.mines.group);

    this.heli = new Helicopter(this.materials, this.textures, this.world.board, options.heliGltf ?? null);
    this.heli.spawn.copy(this.heliAnchor);
    this.heli.steerable = !options.poster;
    this.heli.position.copy(this.heliAnchor);
    this.scene.add(this.heli.object3d);

    this.trainFactory = new TrainModelFactory(this.materials, this.textures);
    this.train = null;
    this.trainTimer = 1.5;
    this.wave = 0;

    this.input = new Input(this.pipeline.renderer.domElement);
    this.hud = new Hud(container);
    this.state = GameState.TITLE;
    this.score = 0;
    this.lives = 3;
    this.deadTimer = 0;
    this.shake = 0;
    this.weaponTimers = { tracer: 0, plasma: 0, rocket: 0.8, tracerSide: 0, rocketSide: 0 };
    this.clock = new THREE.Clock();
    this.input.onAnyAction = () => this.handleStartInput();

    window.addEventListener('resize', () => this.pipeline.resize());
    this.hud.showTitle();
  }

  /**
   * World point at height `y` under a key-art screen pixel (1672x941 reference), honoring the lens warp.
   * @returns {THREE.Vector3}
   */
  screenToWorld(px, py, y) {
    const [nx, ny] = this.pipeline.lensPass
      ? this.pipeline.lensPass.undistort(px / 1672 * 2 - 1, 1 - py / 941 * 2)
      : [px / 1672 * 2 - 1, 1 - py / 941 * 2];
    const d = new THREE.Vector3(nx, ny, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    return this.camera.position.clone().addScaledVector(d, (y - this.camera.position.y) / d.y);
  }

  handleStartInput() {
    if (this.state === GameState.TITLE || this.state === GameState.OVER) this.startRun();
  }

  startRun() {
    this.powerups.clear();
    this.state = GameState.PLAYING;
    this.score = 0;
    this.lives = 3;
    this.wave = 0;
    this.heli.respawn();
    this.hud.hideOverlay();
    this.hud.setScore(this.score);
    this.hud.setLives(this.lives);
  }

  addScore(points) {
    if (this.state !== GameState.PLAYING && !this.options.poster) return;
    this.score += points;
    this.hud.setScore(this.score);
  }

  spawnTrain() {
    this.wave += 1;
    this.train?.dispose();
    this.train = new Train({ track: this.world.track, effects: this.effects, factory: this.trainFactory, wave: this.wave, seed: this.wave });
    this.train.onFire = (muzzle, target) => this.fireEnemyShell(muzzle, target);
    this.train.onCannonFire = (muzzle, target) => this.fireCannonShell(muzzle, target);
    // Cubes shot off the train fall onto the board as new blocks.
    this.train.onCargoKnocked = (position, colorKey) => this.blocks.dropFromTrain(position, colorKey);
    this.train.onTargetDestroyed = (kind, position) => {
      this.addScore(SCORE[kind] ?? 0);
      this.shake = Math.max(this.shake, kind === 'gem' ? 0.9 : 0.25);
      if (kind === 'gem') this.hud.toast('TRAIN DESTROYED! +500');
    };
    this.scene.add(this.train.group);
    this.hud.setWave(this.wave);
    if (!this.options.poster) this.hud.toast(`WAVE ${this.wave} - ARMORED TRAIN INCOMING`);
  }

  /** Brass side cannon: one heavy, slightly slower shell, aimed with a little lead and spread. */
  fireCannonShell(muzzle, target) {
    dir.subVectors(target, muzzle);
    dir.addScaledVector(this.heli.velocity, dir.length() / 13 * 0.5);
    dir.x += rnd.spread(0.8);
    dir.z += rnd.spread(0.8);
    this.projectiles.spawn('cannonball', muzzle, dir);
    this.shake = Math.max(this.shake, 0.12);
  }

  fireEnemyShell(muzzle, target) {
    dir.subVectors(target, muzzle);
    dir.x += rnd.spread(1.2);
    dir.z += rnd.spread(1.2);
    this.projectiles.spawn('shell', muzzle, dir);
    v1.copy(dir).normalize();
    this.effects.muzzleFlash(muzzle, v1, [5, 2.4, 0.6, 1], 1.1);
    this.effects.flash(muzzle, 0xff8a30, 20, 0.12, 6);
  }

  /** Mediator: decides what a projectile at `point` collided with. */
  resolveHit(p, point) {
    if (p.def.owner === 'enemy') {
      if (this.heli.alive && point.distanceToSquared(this.heli.position) < this.heli.radius * this.heli.radius) {
        if (this.heli.takeDamage((p.damage ?? p.def.damage))) {
          this.effects.impact(point, [5, 2, 0.5, 1]);
          this.effects.flash(point, 0xff6a20, 30, 0.2, 7);
          this.shake = Math.max(this.shake, 0.35);
          this.hud.setHealth(this.heli.hp / GameConfig.heli.maxHp);
          this.hud.damageFlash(0.55);
          if (!this.heli.alive) this.onHeliDestroyed();
        }
        return true;
      }
      if (point.y < 0.05 && this.world.board.contains(point.x, point.z)) {
        this.effects.impact(point);
        this.effects.snowPuff(point, 3);
        return true;
      }
      return false;
    }

    // Player projectiles: generous 2.5D collision for the straight guns (readable from above);
    // homing missiles and 8-way bolts use real 3D so they fly over things to reach their target.
    // Aimed shots (smart-aim lock) fly in true 3D so they pass over blocks on the way to the train.
    const exact = p.kind === 'missile' || p.kind === 'nova' || p.aimed;
    if (p.kind === 'missile' && p.life < 0.3) return false;
    if (this.train) {
      const hit = this.train.hitTest(point, exact);
      if (hit) {
        this.applyPlayerDamage(p, point, () => this.train.damage(hit.car, hit.target, (p.damage ?? p.def.damage), point));
        return true;
      }
    }
    const mine = this.mines.hitTest(exact ? point : v1.set(point.x, GameConfig.mines.radius, point.z));
    if (mine && point.y < 3.5) {
      this.applyPlayerDamage(p, point, () => {
        if (this.mines.damage(mine, (p.damage ?? p.def.damage), point)) this.addScore(SCORE.mine);
      });
      return true;
    }
    const block = this.blocks.blockAt(point.x, exact ? point.y : Math.min(point.y, GameConfig.blockSize * 0.9), point.z);
    if (block && point.y < 3.6) {
      v2.set(point.x, GameConfig.blockSize + 0.05, point.z);
      this.applyPlayerDamage(p, v2, () => this.blocks.damage(block, (p.damage ?? p.def.damage), v2));
      return true;
    }
    if (!this.world.board.contains(point.x, point.z, -1) && point.z < GameConfig.board.minZ - 2) {
      return false; // flies off into the sky
    }
    return false;
  }

  applyPlayerDamage(p, point, apply) {
    apply();
    if (p.kind === 'plasma') {
      this.effects.impact(point, [4, 1, 4, 1]);
    } else if (p.kind === 'nova') {
      this.effects.impact(point, [1, 3, 4, 1]);
    } else if (p.kind === 'missile') {
      this.effects.explosion(point, 0.45);
    } else if (p.kind === 'rocket') {
      this.effects.explosion(point, 0.9);
      this.shake = Math.max(this.shake, 0.2);
      // Splash damage on neighbouring blocks.
      const s = GameConfig.blockSize;
      for (const [dx, dz] of [[s, 0], [-s, 0], [0, s], [0, -s]]) {
        const b = this.blocks.blockAt(point.x + dx, 0.5, point.z + dz);
        if (b) this.blocks.damage(b, 1.5, v1.set(b.x, s, b.z));
      }
    }
  }

  onHeliDestroyed() {
    this.effects.explosion(this.heli.position, 2.2, 0x6a9a33, 26);
    this.heli.object3d.visible = false;
    this.shake = 1.2;
    this.lives -= 1;
    this.hud.setLives(this.lives);
    this.state = GameState.DEAD;
    this.deadTimer = 2.5;
  }

  /**
   * Smart aim ("auto pilot gunner"): the player only has to face the target. Within a narrow cone
   * around the nose the best target is locked (train parts first, then nearest / most centred) and
   * every gun barrel pitches up or down - and corrects a few degrees sideways - to hit its centre.
   * Without a lock the guns fire straight ahead, slightly down.
   * @param {THREE.Vector3} muzzle
   * @param {THREE.Vector3} out receives the normalized fire direction
   */
  aimFrom(muzzle, out, spread) {
    const target = this.lockedTarget();
    this.lastShotAimed = !!target;
    if (target) {
      out.subVectors(target, muzzle).normalize();
    } else {
      this.heli.toWorldDirection(out.set(0, -0.045, -1)).normalize();
    }
    if (spread) {
      out.x += rnd.spread(spread);
      out.z += rnd.spread(spread);
      out.normalize();
    }
    return out;
  }

  /** Current smart-aim lock (world position, refreshed every 0.12 s) or null. */
  lockedTarget() {
    const now = this.clock.elapsedTime;
    if (this.aimLock && now - this.aimLock.at < 0.12 && this.aimLock.entry.alive()) {
      return this.aimLock.entry.position(this.aimLock.pos);
    }
    const cfg = GameConfig.heli;
    const f = this.heli.toWorldDirection(v3.set(0, 0, -1));
    let best = null;
    let bestScore = Infinity;
    for (const q of this.collectTargets(cfg.aimRange)) {
      const d = Math.hypot(q.dx, q.dz);
      if (d < 0.8) continue;
      const cos = (q.dx * f.x + q.dz * f.z) / d;
      if (cos < Math.cos(cfg.aimCone)) continue;
      const angle = Math.acos(Math.min(1, cos));
      // Train parts win over board blocks at a similar angle (that's what the player is after).
      const priority = q.kind === 'gem' ? -3 : q.kind === 'turret' || q.kind === 'cargo' ? -2.5 : 0;
      const score = angle * 12 + d * 0.35 + priority;
      if (score < bestScore) { bestScore = score; best = q; }
    }
    this.aimLock = best ? { entry: best, at: now, pos: this.aimLock?.pos ?? new THREE.Vector3() } : null;
    return best ? best.position(this.aimLock.pos) : null;
  }

  /** Crosshair brackets on the locked target. */
  updateReticle(dt) {
    if (!this.reticle) {
      this.reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleTexture(), depthTest: false, transparent: true }));
      this.reticle.renderOrder = 30;
      this.scene.add(this.reticle);
    }
    const target = this.state === GameState.PLAYING && this.heli.alive ? this.lockedTarget() : null;
    this.reticle.visible = !!target;
    if (!target) return;
    this.reticleSpin = (this.reticleSpin ?? 0) + dt * 2;
    this.reticle.position.copy(target);
    this.reticle.material.rotation = this.reticleSpin;
    this.reticle.scale.setScalar(1.7 + Math.sin(this.reticleSpin * 3) * 0.12);
  }

  /** Ramming the train: 25 HP, knock-back, flicker, red vignette. */
  checkTrainCollision() {
    const t = this.train;
    const h = this.heli;
    if (!t || t.finished || !h.alive || h.invulnerable > 0 || this.state !== GameState.PLAYING) return;
    const p = h.position;
    const halfWidth = 1.15 * t.scale + 0.7;
    if (Math.abs(p.x - t.group.position.x) > halfWidth || p.z < t.minZ - 0.5 || p.z > t.maxZ + 0.5) return;
    const side = Math.sign(p.x - t.group.position.x) || -1;
    if (h.takeDamage(GameConfig.train.collisionDamage)) {
      h.invulnerable = 1.5;
      h.velocity.x = side * 13;
      h.velocity.z += t.dir * t.speed;
      this.effects.explosion(v1.set(t.group.position.x + side * 1.6, p.y - 0.4, p.z), 0.8, 0x3a3d42, 8);
      this.shake = Math.max(this.shake, 0.9);
      this.hud.setHealth(h.hp / GameConfig.heli.maxHp);
      this.hud.damageFlash(1);
      if (!h.alive) this.onHeliDestroyed();
    }
  }

  /**
   * The passing train restocks the two block columns on the far side of the track (the ones it
   * hides while passing): empty cells get a fresh block dropped off the wagons, once per row and trip.
   */
  restockFarSide() {
    const t = this.train;
    if (!t || t.destroyed || t.finished) return;
    if (!this.restock || this.restock.train !== t || this.restock.lap !== t.lap) this.restock = { train: t, lap: t.lap, rows: new Set() };
    const B = this.blocks;
    const trackX = GameConfig.track.x;
    for (let r = 0; r < B.rows; r++) {
      if (this.restock.rows.has(r)) continue;
      const rowZ = B.cellCenter(0, r).z;
      if (rowZ < t.minZ || rowZ > t.maxZ) continue;
      this.restock.rows.add(r);
      for (let c = 0; c < B.cols; c++) {
        if (B.isTrackCell(c) || B.cellCenter(c, r).x < trackX) continue;
        const cell = B.cells.get(B.key(c, r));
        if (cell?.alive || Math.random() > GameConfig.train.restockChance) continue;
        B.placeBlock(c, r, BLOCK_COLOR_KEYS[Math.floor(Math.random() * BLOCK_COLOR_KEYS.length)], { from: v1.set(trackX + 1.2, 3.6, rowZ) });
      }
    }
  }

  /** Gem power: shots take the gem's colour and hit harder. */
  shotStyle() {
    const gem = this.powerups.gemColor;
    return gem === null ? {} : { tint: gem, damageMul: GameConfig.supply.gemDamageMul };
  }

  /**
   * D power-up: 8 bolts (front, back, sides, diagonals in the heli's frame). Each direction looks
   * for a target inside its 45-degree sector and aims at it in 3D, so bolts tilt down for things
   * below the heli and stay level for tall train parts; empty sectors aim at the floor ~6 tiles out.
   */
  fireEightWay() {
    const range = GameConfig.heli.burstRange;
    const targets = this.collectTargets(range);
    const origin = v1.copy(this.heli.position);
    origin.y -= 0.3;
    for (let k = 0; k < 8; k++) {
      const a = this.heli.yaw + (k * Math.PI) / 4;
      const fx = -Math.sin(a);
      const fz = -Math.cos(a);
      let best = null;
      let bestD = Infinity;
      for (const q of targets) {
        const d = Math.hypot(q.dx, q.dz);
        if (d < 0.5) continue;
        if ((q.dx * fx + q.dz * fz) / d < Math.cos(Math.PI / 8)) continue;
        if (d < bestD) { bestD = d; best = q; }
      }
      if (best) {
        best.position(v2);
        dir.subVectors(v2, origin);
      } else {
        dir.set(fx * 6, 0.8 - origin.y, fz * 6);
      }
      this.projectiles.spawn('nova', origin, dir, null, this.shotStyle());
    }
    this.effects.sparkBurst(origin, 10, 5, [1.2, 3, 4, 1]);
  }

  /**
   * Live targets around the helicopter within `range` (horizontal): blocks, mines and train parts.
   * Each entry exposes alive() and position(out) so homing missiles can track moving cars.
   */
  collectTargets(range) {
    const h = this.heli.position;
    const out = [];
    const push = (x, z, alive, position, kind = 'block') => {
      const dx = x - h.x;
      const dz = z - h.z;
      if (dx * dx + dz * dz <= range * range) out.push({ dx, dz, alive, position, kind });
    };
    const s = GameConfig.blockSize;
    for (const b of this.blocks.blocks) {
      if (!b.alive || b.drop > 0) continue;
      push(b.x, b.z, () => b.alive && b.drop <= 0, (o) => o.set(b.x, s * 0.55, b.z));
    }
    for (const m of this.mines.mines) {
      if (m.alive) push(m.pos.x, m.pos.z, () => m.alive, (o) => o.copy(m.pos), 'mine');
    }
    const train = this.train;
    if (train && !train.destroyed) {
      for (const car of train.cars) {
        for (const tgt of car.targets) {
          if (!tgt.alive || tgt.kind === 'hull') continue;
          const local = tgt.box.getCenter(new THREE.Vector3());
          const position = (o) => car.group.localToWorld(o.copy(local));
          const p = position(v2);
          push(p.x, p.z, () => tgt.alive && !train.destroyed, position, tgt.kind);
        }
      }
    }
    return out;
  }

  /**
   * Weapons. Default: single straight shots out of the front of the left/right wing pods,
   * alternating. Supply power-ups add, while active:
   *   T  triple fire - 3-way plasma spread from the chin gun (underneath)
   *   D  8-way burst - bolts in 8 directions around the heli, each aimed up/down at a target
   *                    in that direction (or at the floor a few tiles out)
   *   R  homing rockets - guided missiles onto random nearby targets
   */
  updateWeapons(dt) {
    if (!this.heli.alive) return;
    const cfg = GameConfig.heli;
    const t = this.weaponTimers;
    const pw = this.powerups;
    t.main = (t.main ?? 0) - dt;
    t.triple = (t.triple ?? 0) - dt;
    t.burst = (t.burst ?? 0) - dt;
    t.homing = (t.homing ?? 0) - dt;

    if (t.main <= 0) {
      t.main = cfg.mainInterval;
      const pod = (t.side = (t.side ?? 0) + 1) % 2 === 0 ? 'podL' : 'podR';
      const muzzle = this.heli.hardpoint(pod, v1);
      this.aimFrom(muzzle, dir, 0.012);
      this.projectiles.spawn('tracer', muzzle, dir, null, { ...this.shotStyle(), aimed: this.lastShotAimed });
      this.effects.muzzleFlash(muzzle, dir.normalize(), [4.5, 2.6, 0.9, 1], 0.6);
    }
    if (pw.has('T') && t.triple <= 0) {
      t.triple = cfg.tripleInterval;
      const muzzle = this.heli.hardpoint('chinGun', v1);
      const center = this.aimFrom(muzzle, v3, 0).clone();
      for (const angle of [-0.26, 0, 0.26]) {
        dir.copy(center).applyAxisAngle(UP, angle);
        this.projectiles.spawn('plasma', muzzle, dir, null, { ...this.shotStyle(), aimed: this.lastShotAimed });
      }
      this.effects.muzzleFlash(muzzle, this.heli.toWorldDirection(v2.set(0, 0, -1)), [4, 1, 4, 1], 0.9);
    }
    if (pw.has('D') && t.burst <= 0) {
      t.burst = cfg.burstInterval;
      this.fireEightWay();
    }
    if (pw.has('R') && t.homing <= 0) {
      const targets = this.collectTargets(cfg.homingRange);
      t.homing = targets.length ? cfg.homingInterval : 0.2;
      if (targets.length) {
        const pick = targets[Math.floor(rnd.next() * targets.length)];
        const pod = (t.homingSide = (t.homingSide ?? 0) + 1) % 2 === 0 ? 'podL' : 'podR';
        const muzzle = this.heli.hardpoint(pod, v1);
        // Launch up and outward, then curve down onto the target.
        dir.set(rnd.spread(0.8) + (pod === 'podL' ? -0.5 : 0.5), 1.4, rnd.spread(0.8));
        this.heli.toWorldDirection(dir);
        this.projectiles.spawn('missile', muzzle, dir, { alive: pick.alive, position: pick.position });
        this.effects.muzzleFlash(muzzle, dir.normalize(), [5, 2.4, 0.6, 1], 0.6);
        this.backblast = { time: 0.2, pod: pod === 'podL' ? 'podRearL' : 'podRearR' };
      }
    }
    this.updateBackblast(dt);
    this.updateExhaust(dt);
  }

  /** Below 25% HP the helicopter trails thin black smoke from its engines (damage cue). */
  updateDamageSmoke(dt) {
    const h = this.heli;
    if (!h.alive || h.hp / GameConfig.heli.maxHp >= 0.25) return;
    this.damageSmokeTimer = (this.damageSmokeTimer ?? 0) - dt;
    if (this.damageSmokeTimer > 0) return;
    this.damageSmokeTimer = 0.05;
    const p = this.heli.hardpoint(rnd.chance(0.5) ? 'exhaustL' : 'exhaustR', v1);
    this.effects.smoke.emit({
      x: p.x + rnd.spread(0.15), y: p.y, z: p.z + rnd.spread(0.15),
      vx: rnd.spread(0.4) - h.velocity.x * 0.3, vy: rnd.range(0.8, 1.6), vz: rnd.spread(0.4) - h.velocity.z * 0.3, drag: 0.8,
      life: rnd.range(1.0, 1.6), size0: 0.35, size1: rnd.range(1.4, 2.0),
      color0: [0.06, 0.06, 0.07, 0.75], color1: [0.25, 0.25, 0.27, 0], rotVel: rnd.spread(0.8),
    });
  }

  /** Continuous afterburner flames + white contrails out of the wing pods (key-art look). */
  updateExhaust(dt) {
    this.exhaustTimer = (this.exhaustTimer ?? 0) - dt;
    if (this.exhaustTimer > 0) return;
    this.exhaustTimer = 1 / 40;
    const back = this.heli.toWorldDirection(v2.set(0, -0.18, 1)).normalize();
    for (const pod of ['podRearL', 'podRearR']) {
      const o = this.heli.hardpoint(pod, v1);
      const speed = rnd.range(5, 7);
      // Flame cone: stretched hot streak + billowy fireball core + soft glow.
      this.effects.sparks.emit({
        x: o.x, y: o.y, z: o.z, vx: back.x * speed, vy: back.y * speed, vz: back.z * speed,
        life: rnd.range(0.1, 0.16), size0: 0.55, size1: 0.3, stretch: 0.16,
        color0: [5, 3, 1.2, 1], color1: [3, 0.9, 0.15, 0],
      });
      this.effects.fireballs.emit({
        x: o.x + back.x * 0.2, y: o.y + back.y * 0.2, z: o.z + back.z * 0.2,
        vx: back.x * speed * 0.8, vy: back.y * speed * 0.8, vz: back.z * speed * 0.8,
        life: rnd.range(0.1, 0.16), size0: rnd.range(0.55, 0.75), size1: 0.25, rot: rnd.range(0, 6),
        color0: [2.2, 1.7, 1.2, 1], color1: [1.6, 0.7, 0.3, 0],
      });
      this.effects.fire.emit({
        x: o.x, y: o.y, z: o.z, vx: back.x * speed * 0.5, vy: back.y * speed * 0.5, vz: back.z * speed * 0.5,
        life: 0.1, size0: 1.3, size1: 0.6, color0: [2.4, 1.1, 0.3, 0.8], color1: [1.2, 0.3, 0.05, 0],
      });
      this.effects.smoke.emit({
        x: o.x + back.x * 0.6, y: o.y + back.y * 0.6, z: o.z + back.z * 0.6,
        vx: back.x * 2.5 + rnd.spread(0.2), vy: back.y * 2.5, vz: back.z * 2.5 + rnd.spread(0.2), drag: 1.2,
        life: rnd.range(0.7, 1.0), size0: 0.25, size1: 0.95, color0: [1, 1, 1, 0.42], color1: [1, 1, 1, 0],
      });
    }
  }

  /** Rocket launch exhaust jets streaming backwards out of the pods. */
  updateBackblast(dt) {
    if (!this.backblast || this.backblast.time <= 0) return;
    this.backblast.time -= dt;
    const back = this.heli.toWorldDirection(v2.set(rnd.spread(0.15), -0.25, 1)).normalize();
    for (const pod of ['podRearL', 'podRearR']) {
      const strength = pod === this.backblast.pod ? 1 : 0.45;
      const origin = this.heli.hardpoint(pod, v1);
      for (let i = 0; i < 3; i++) {
        const speed = rnd.range(5, 9) * strength;
        this.effects.fire.emit({
          x: origin.x, y: origin.y, z: origin.z,
          vx: back.x * speed + rnd.spread(0.5), vy: back.y * speed, vz: back.z * speed + rnd.spread(0.5),
          life: rnd.range(0.12, 0.22), size0: 0.55 * strength + 0.2, size1: 0.15,
          color0: [2.6, 1.3, 0.35, 1], color1: [1.6, 0.35, 0.05, 0],
        });
      }
      this.effects.smoke.emit({
        x: origin.x, y: origin.y, z: origin.z, vx: back.x * 3, vy: back.y * 3, vz: back.z * 3, drag: 2,
        life: 0.8, size0: 0.4, size1: 1.4, color0: [0.85, 0.85, 0.88, 0.5 * strength], color1: [1, 1, 1, 0],
      });
    }
  }

  /** Camera keeps the key-art angle and translates to follow the helicopter (with lag + shake). */
  updateCamera(dt, snap = false) {
    const follow = GameConfig.camera.followStrength;
    const desired = v1.copy(this.cameraBase);
    desired.x += (this.heli.position.x - this.heliAnchor.x) * follow;
    desired.z += (this.heli.position.z - this.heliAnchor.z) * follow * 0.8;
    if (snap) this.cameraSmooth = desired.clone();
    this.cameraSmooth ??= desired.clone();
    this.cameraSmooth.lerp(desired, 1 - Math.exp(-3.5 * dt));
    this.camera.position.copy(this.cameraSmooth);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const s = this.shake * this.shake * 0.45;
      this.camera.position.x += rnd.spread(s);
      this.camera.position.y += rnd.spread(s);
    }
  }

  /** Fixed-step friendly simulation tick. */
  step(dt) {
    this.input.update();
    const playing = this.state === GameState.PLAYING;
    const pilot = this.input.pilot;
    let move;
    if (playing && !this.input.dragging) {
      // Keyboard: move in the helicopter's own frame (nose = forward, body side = strafe).
      const sy = Math.sin(this.heli.yaw);
      const cy = Math.cos(this.heli.yaw);
      move = {
        x: -sy * pilot.forward + cy * pilot.strafe,
        z: -cy * pilot.forward - sy * pilot.strafe,
      };
      this.heli.faceMovement = false;
      this.heli.turnInput = pilot.turn;
    } else {
      // Touch drag / attract mode: screen-relative joystick, nose follows the direction.
      move = this.toCameraRelative(playing ? this.input.move : this.demoMove(dt));
      this.heli.faceMovement = true;
      this.heli.turnInput = 0;
    }
    if (this.heli.alive) this.heli.update(dt, move);
    if (playing || this.state === GameState.TITLE || this.options.poster) this.updateWeapons(dt);

    if (this.state === GameState.DEAD) {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) {
        if (this.lives > 0) {
          this.heli.respawn();
          this.hud.setHealth(1);
          this.state = GameState.PLAYING;
        } else {
          this.state = GameState.OVER;
          this.hud.showGameOver(this.score);
        }
      }
    }

    // The same train loops until its gem is destroyed (0%); then the next wave brings a new one.
    if (!this.train || this.train.finished) {
      this.trainTimer -= dt;
      if (this.trainTimer <= 0) {
        if (this.train && !this.train.destroyed) {
          this.train.restartLap();
          if (!this.options.poster) this.hud.toast(`THE TRAIN IS BACK - ${Math.round(this.train.integrity * 100)}%`);
        } else {
          this.spawnTrain();
        }
        this.trainTimer = GameConfig.train.respawnDelay;
      }
    }
    this.train?.update(dt, this.heli.position, this.heli.alive);
    this.checkTrainCollision();
    this.restockFarSide();

    this.blocks.update(dt);
    this.mines.update(dt);
    this.projectiles.update(dt);
    this.powerups.update(dt);
    this.supplies.update(dt, this.heli.position, this.heli.alive && this.state === GameState.PLAYING);
    this.hud.setSkills(this.powerups.active);
    this.hud.updateTrain(this.train);
    this.updateReticle(dt);
    this.updateDamageSmoke(dt);
    this.effects.update(dt);
    this.world.update(dt);
    this.world.railSnow.update(dt, this.train, this.effects);
    this.updateCamera(dt);
  }

  /** Maps stick input (screen up/right) onto the floor plane using the camera yaw. */
  /**
   * Maps stick/keyboard input (screen right = +x, screen down = +z) to a world XZ direction that
   * moves the helicopter exactly that way ON SCREEN: the screen offset is unprojected through the
   * real camera (perspective + yaw + lens) onto the helicopter's flight plane. So W is always
   * straight up the screen, D straight right, diagonals at 45 degrees.
   */
  toCameraRelative(move) {
    const mag = Math.min(1, Math.hypot(move.x, move.z));
    if (mag < 1e-3) return { x: 0, z: 0 };
    const cam = this.camera;
    cam.updateMatrixWorld();
    const h = this.heli.position;
    const lens = this.pipeline.lensPass;
    // Heli on screen (as displayed, i.e. after the lens warp).
    const p = v1.copy(h).project(cam);
    const shown = lens ? this.distortNdc(p.x, p.y) : [p.x, p.y];
    const step = 0.05;
    const aspect = cam.aspect;
    let tx = shown[0] + (move.x / mag) * step / aspect;
    let ty = shown[1] - (move.z / mag) * step;
    if (lens) [tx, ty] = lens.undistort(tx, ty);
    // Ray through the target pixel, intersected with the heli's altitude plane.
    const d = v2.set(tx, ty, 0.5).unproject(cam).sub(cam.position).normalize();
    const t = (h.y - cam.position.y) / d.y;
    const hitX = cam.position.x + d.x * t - h.x;
    const hitZ = cam.position.z + d.z * t - h.z;
    const len = Math.hypot(hitX, hitZ) || 1;
    return { x: (hitX / len) * mag, z: (hitZ / len) * mag };
  }

  /** Inverse of LensPass.undistort (fixed-point iteration), NDC in -> displayed NDC out. */
  distortNdc(x, y) {
    const lens = this.pipeline.lensPass;
    let dx = x;
    let dy = y;
    for (let i = 0; i < 8; i++) {
      const [ux, uy] = lens.undistort(dx, dy);
      dx += x - ux;
      dy += y - uy;
    }
    return [dx, dy];
  }

  /** Attract-mode autopilot used behind the title screen. */
  demoMove() {
    const t = this.clock.elapsedTime;
    return { x: Math.sin(t * 0.5) * 0.6, z: Math.sin(t * 0.33) * 0.35 };
  }

  start() {
    const loop = () => {
      const dt = Math.min(this.clock.getDelta(), 1 / 20);
      if (!this.paused) {
        this.step(dt);
        this.pipeline.render(dt);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /**
   * Poster mode: stages the key-art moment deterministically and renders a still frame.
   * Used by tools/screenshot.mjs to compare against the reference image.
   */
  renderPoster({ logo = false, hideHeli = false } = {}) {
    if (logo) {
      this.hud.showLogoOnly();
    } else {
      this.hud.hideOverlay();
      this.hud.root.style.display = 'none';
    }
    this.spawnTrain();
    this.train.cruise = this.train.speed = this.train.baseSpeed;
    this.train.stopAtZ = null;
    this.heli.position.copy(this.heliAnchor);
    const dt = 1 / 30;
    // Train arrives at the poster position; simulate the last seconds so smoke and shots are mid-flight.
    this.train.setHeadZ(GameConfig.train.posterHeadZ - this.train.speed * 3.2);
    this.updateCamera(dt, true);
    // Show the power-up look in the hero frame: triple fire on, a few crates on the floor.
    this.powerups.activate('T', 999);
    for (const [type, x, z] of [['T', -4.6, -2.2], ['G', -2.2, -5.4], ['H', -7.4, 3.4]]) {
      const crate = this.supplies.spawn(type, v1.set(x, 0.62, z));
      crate.landed = true;
      crate.vel.set(0, 0, 0);
    }
    const debrisColors = Object.values(Palette.blocks);
    for (let i = 0; i < 96; i++) {
      this.heli.position.copy(this.heliAnchor);
      // Key art: a cloud of shattered cubes hanging between the heli and the train.
      if (i === 84 || i === 89) {
        for (const [x, y, z] of [[-1.5, 2.2, -3], [0.8, 2.6, -1.0], [-3.5, 2.4, -2.0], [2.0, 2.0, 2.5], [-0.5, 2.0, 1.5]]) {
          this.effects.shatter(v1.set(x + rnd.spread(1), y, z + rnd.spread(1)), rnd.pick(debrisColors), 7, 1.1, [0.16, 0.36]);
        }
      }
      this.step(dt);
    }
    // A couple of extra explosions for the hero frame.
    this.effects.explosion(new THREE.Vector3(1.2, 1.8, -1.2), 1.0);
    this.effects.explosion(new THREE.Vector3(-8.25, 1.6, 0.9), 0.7);
    for (let i = 0; i < 4; i++) this.step(dt);
    if (hideHeli) this.heli.object3d.visible = false;
    this.pipeline.render(dt);
    window.__posterReady = true;
  }
}

/** Four rotating corner brackets for the smart-aim lock. */
function reticleTexture() {
  const S = 128;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  for (const [color, width] of [['rgba(0,0,0,0.55)', 9], ['#ffffff', 4]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(S / 2 + sx * 46, S / 2 + sy * 20);
      ctx.lineTo(S / 2 + sx * 46, S / 2 + sy * 46);
      ctx.lineTo(S / 2 + sx * 20, S / 2 + sy * 46);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#ff4d4d';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 5, 0, Math.PI * 2);
  ctx.fill();
  return canvasToTexture(canvas, { srgb: true });
}
