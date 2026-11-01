import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { EffectsManager } from '../fx/EffectsManager.js';
import { PlayerTank } from './PlayerTank.js';
import { TankArena } from './TankArena.js';
import { BlockFlow } from './BlockFlow.js';
import { DrainPile } from './DrainPile.js';
import { ArenaTrain } from './ArenaTrain.js';
import { TankSupplies, SUPPLY_COLORS } from './TankSupplies.js';
import { CARD_DEFS } from '../ui/UpgradeCards.js';
import { PickupSfx } from '../audio/PickupSfx.js';
import { fxRandom as rnd } from '../util/Random.js';
import { reticleTexture } from '../ui/Reticle.js';
import { ProjectileManager, TankShell, HomingMissile, JetBullet, AerialBomb } from '../combat/Projectiles.js';
import { JetFighter } from '../combat/JetFighter.js';

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Tank power-ups from supply blocks (the heli game's crates, tank meanings). */
const POWER_NAMES = Object.freeze({ T: 'TRIPLE SHELLS', D: 'RAPID FIRE', R: 'HOMING MISSILES', H: 'REPAIR · DRAIN PUMP', G: 'RAPID FIRE' });
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
/** Kill-feed colours (as in the heli game's log). */
const FEED = Object.freeze({ tank: '#7be86a', enemy: '#ff6b6b', grey: '#c9ced6', gold: '#ffd34a' });
/** Score: per broken block, per fighter shot down. */
const SCORE = Object.freeze({ block: 10, fighter: 500 });

/**
 * Tank level (menu card IRON TRACKS), phase 1. The tank drives in a sloped concrete channel with
 * shallow flowing water. Trains cross the rail at the far end and drop blocks into the lanes;
 * the blocks slide down toward the dam (pushing each other, and pushing the tank) and whatever
 * gets past the lip tumbles into the oval drain and piles up there (physics).
 *   1000 blocks come in phase 1: break 900. 100 blocks in the drain loses.
 *   Same-coloured neighbours chain-explode; weak / normal / strong (caged) / supply (star) blocks.
 *   Supplies: T triple shells, D rapid fire, R homing missiles (like the heli's), H repair + drain
 *   pump (-10 blocks).
 * The tank starts in a round base among the trees at the bottom left and drives in along a dirt
 * road through a gap in the left wall. Every 7-20 s the Blocked Pixel Panzer fighter makes a pass:
 * 3-4 s of machine-gun fire and a bomb aimed where the tank is (keep moving). Winning the phase
 * opens the fence gate in the right wall; the road behind it leads on to phase 2.
 * Enemies (src/combat/Enemy.js): channel blocks (targets only, never hurt the tank), the trains
 * and the fighter. Projectiles (src/combat/Projectiles.js): TankShell, HomingMissile, JetBullet,
 * AerialBomb - pooled, one InstancedMesh set per class.
 * The tank is solid: blocks sliding into it stop in front of it (and hold up their lane), and it
 * cannot drive through them.
 * Aiming (auto aim, like the heli's gunner): the turret locks onto the best block by itself
 * (reticle), swings onto it, depresses the barrel and fires when on target. Not the block you
 * want? Q / E (left / right arrows, the touch buttons) turn the turret; when let go, the block
 * nearest the gun is the new lock. The mouse does not aim. Shells fly straight and hit the first
 * block in their path.
 * Skill cards every 200 broken blocks: HOMING ROCKETS (R crates drop), CHAIN REACTION.
 * Controls: W/S drive, A/D turn the hull, Q/E or left/right arrows turn the barrel (arrows never
 * move the hull); phones: left stick drives (screen-relative), two buttons turn the barrel. SPACE / click fires,
 * ENTER restarts a finished phase, ESC pause menu. Own scene and camera.
 */
export class TankLevel {
  /**
   * @param {{ gltf:any, textures:any, materials:any, trainFactory:any, renderer:THREE.WebGLRenderer, input:any, quality:any, settings:any }} deps
   */
  constructor({ gltf, textures, materials, trainFactory, renderer, input, quality, settings, environment, rocketGltf, fighterGltf, supplyGltf, cards, hud }) {
    this.cards = cards ?? null;
    /** The heli game's HUD (src/ui/Hud.js), shared: score, phase, HP, log, objectives, power-ups. */
    this.ui = hud ?? null;
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
    this.effects = new EffectsManager(this.scene, textures, debris, (x, z) => this.arena.floorAt(x, z), { flashLights: 3 });
    this.blocks = new BlockFlow(materials, this.effects, this.arena);
    this.scene.add(this.blocks.group);
    this.pile = new DrainPile(materials, this.effects, this.arena);
    this.scene.add(this.pile.group);
    this.supplies = new TankSupplies(this.scene, this.effects, supplyGltf, (x, z) => this.arena.floorAt(x, z));
    this.supplies.onPickup = (type, item) => this.onPickup(type, item);

    this.tank = new PlayerTank(gltf);
    this.scene.add(this.tank.root);
    const A = GameConfig.tankArena;
    const halfW = (A.block * A.lanes) / 2;
    // Where the hull may stand: the channel, the wall gaps, the roads, the base (TankArena.walkable).
    this.tank.bounds = null;
    this.tank.canStand = (x, z, heading) => this.canStand(x, z, heading);
    this.tank.heightAt = (x, z) => this.arena.floorAt(x, z);
    this.tank.collide = () => this.collideTank();
    this.blocks.resolveTank = (b) => this.holdBlock(b);
    this.blocks.onDrain = (b) => this.onDrain(b);
    this.blocks.onDestroyed = (b, depth, at) => this.onBlockDestroyed(b, depth, at);

    this.lock = null;
    this.manualAim = 0;
    this.time = 0;
    this.reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleTexture(), depthTest: false, transparent: true }));
    this.reticle.renderOrder = 30;
    this.reticle.visible = false;
    this.reticleSpin = 0;
    this.scene.add(this.reticle);

    // Projectiles: pooled class hierarchy, one instanced mesh set per class.
    this.projectiles = new ProjectileManager(this.scene);
    const shellGeo = new THREE.CapsuleGeometry(0.13, 0.5, 4, 8).rotateX(Math.PI / 2);
    this.projectiles.register(TankShell, new THREE.Mesh(shellGeo, new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffa040, emissiveIntensity: 2.2, roughness: 0.3 })), { max: 24, shadow: false });
    this.projectiles.register(HomingMissile, rocketGltf?.scene ?? null, { forward: new THREE.Vector3(0, 0, -1), scale: 1.6, max: 32 });
    const tracerGeo = new THREE.CapsuleGeometry(0.06, 0.9, 2, 6).rotateX(Math.PI / 2);
    this.projectiles.register(JetBullet, new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3, 1.2), toneMapped: false })), { max: 96, shadow: false, prewarm: 48 });
    this.fighterTemplate = fighterGltf?.scene.getObjectByName('Fighter') ?? null;
    const bombNode = this.fighterTemplate?.getObjectByName('FighterBomb') ?? null;
    if (bombNode) {
      // Bomb template: the fighter's bomb at the fighter's scale, centred on its own origin.
      const bomb = bombNode.clone(true);
      bomb.position.set(0, 0, 0);
      bomb.scale.setScalar(GameConfig.fighter.scale);
      const holder = new THREE.Group();
      holder.add(bomb);
      this.projectiles.register(AerialBomb, holder, { max: 6 });
    } else {
      this.projectiles.register(AerialBomb, new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.2, 4, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5e5a2e })), { max: 6 });
    }
    this.fighter = this.fighterTemplate ? new JetFighter(this.fighterTemplate) : null;
    this.world = this.combatWorld();
    this.aim = new THREE.Vector3(0, 0, 20);
    this.pointer = null;
    this.shake = 0;
    this.camPos = new THREE.Vector3();
    this.active = false;
    this.dustTimer = 0;
    this.powers = { T: 0, D: 0, R: 0 };
    this.hp = GameConfig.tank.hp;
    this.buildHud();

    // The mouse never aims: a left click just fires (the turret aims and fires by itself).
    this.onPointerMove = () => {};
    this.onPointerDown = (e) => {
      if (!this.active || this.paused || this.cards?.active) return;
      if (e.pointerType === 'mouse' && e.button === 0) this.fireQueued = true;
    };
    this.touch = { left: false, right: false };
  }

  buildHud() {
    const el = document.createElement('div');
    el.className = 'tank-hud';
    el.innerHTML = `
      <div class="th-banner" data-banner></div>
      <div class="th-keys"><b>W S</b> drive · <b>A D</b> turn hull · <b>← →</b> / <b>Q E</b> turn barrel · auto aim &amp; fire · <b>ESC</b> menu</div>
      <div class="th-touch">
        <button class="th-btn" data-tl aria-label="turret left">&#9664;</button>
        <button class="th-btn" data-tr aria-label="turret right">&#9654;</button>
      </div>
      <div class="th-stick" data-stick><i></i></div>
      <div class="th-reload"><i></i></div>`;
    Object.assign(el.style, { display: 'none' });
    this.hud = el;
    this.reloadBar = el.querySelector('.th-reload i');
    this.hudEl = { banner: el.querySelector('[data-banner]'), keys: el.querySelector('.th-keys'), stick: el.querySelector('[data-stick]') };
    (this.element.parentElement ?? document.body).appendChild(el);
    // Phones: turret left / right and FIRE buttons (like the heli's turn buttons); the drag
    // joystick drives the hull.
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

  /** Starts (or restarts) phase 1: tank at the bottom of the channel, everything cleared. */
  start() {
    this.active = true;
    this.paused = false;
    const t = this.tank;
    const B = GameConfig.tankArena.base;
    // In the base, facing the road (toward the channel).
    t.root.position.set(B.x, 0, B.z);
    t.heading = -Math.sign(B.x) * Math.PI / 2;
    t.elevation = t.aimElevation = -0.12;
    this.lock = null;
    this.manualAim = 0;
    t.speed = 0;
    t.turnRate = 0;
    t.turretYaw = 0;
    t.recoil = 0;
    t.recoilVel = 0;
    t.cooldown = 0;
    this.projectiles.clear();
    this.lock = null;
    this.manualAim = 0;
    this.time = 0;
    this.hp = GameConfig.tank.hp;
    this.homingTimer = 0;
    this.hitFlash = 0;
    this.fighter?.dispose();
    this.fighterActive = false;
    this.fighterTimer = GameConfig.fighter.firstDelay;
    this.fighterSide = 1;
    this.arena.setGateOpen(false);
    this.arena.gateT = 0;
    this.arena.update(0);
    this.blocks.reset();
    this.pile.reset();
    this.supplies.clear();
    // Skill cards: none taken, the first offer at cardEvery broken blocks.
    this.skills = new Set();
    this.blocks.chainEnabled = false;
    this.nextCardAt = GameConfig.tankArena.cardEvery;
    this.cards?.cancel();
    this.train?.dispose();
    this.train = null;
    this.trainTimer = 1.5;
    this.trainDir = 1;
    this.trainCount = 0;
    this.dropped = 0;
    this.broken = 0;
    this.powers = { T: 0, D: 0, R: 0 };
    this.state = 'playing';
    this.score = 0;
    this.drainWarned = 0;
    this.hudEl.banner.className = 'th-banner';
    this.hudEl.keys.classList.remove('faded');
    const ui = this.ui;
    if (ui) {
      ui.clearLog();
      ui.setLives(0);
      ui.setWaveLabel('PHASE');
      ui.setWave(1);
      ui.setSkills(new Map());
      ui.toast(`PHASE 1 - BREAK ${GameConfig.tankArena.breakGoal} BLOCKS`);
    }
    this.aim.set(B.x - Math.sign(B.x) * 20, 0, B.z + 4);
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
    // Choosing a skill card: the level waits.
    if (this.cards?.active) {
      this.fireQueued = false;
      return;
    }
    if ((this.state === 'lost' || this.state === 'phase2') && k('Enter', 'NumpadEnter')) {
      keys.delete('Enter');
      this.start();
      return;
    }
    const playing = this.state === 'playing';
    const driving = playing || this.state === 'won';
    // Hull: W / S drive, A / D turn (the arrow keys never move the hull). Turret: Q / E or the
    // left / right arrows (phones: the two buttons on the right). Phones: the left stick drives.
    const drive = driving ? {
      throttle: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
      turn: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0),
      turret: (k('KeyQ', 'ArrowLeft') || this.touch.left ? 1 : 0) - (k('KeyE', 'ArrowRight') || this.touch.right ? 1 : 0),
    } : { throttle: 0, turn: 0, turret: 0 };
    if (driving && this.input.dragging && !drive.throttle && !drive.turn) Object.assign(drive, this.stickDrive(this.input.move.x, this.input.move.z));
    this.step(dt, drive, driving && (this.fireQueued || keys.has('Space')));
    this.fireQueued = false;
  }

  /**
   * Left stick (like the heli's): screen-relative - the hull turns toward the stick direction and
   * drives forward once it roughly faces it (turns on the spot first for a sharp change).
   * @param {number} sx stick right (+1) / left (-1)
   * @param {number} sy stick down (+1) / up (-1)
   */
  stickDrive(sx, sy) {
    const mag = Math.min(1, Math.hypot(sx, sy));
    if (mag < 0.12) return { throttle: 0, turn: 0 };
    // Camera looks up the channel (+z = screen up), +x is the screen's left.
    const want = Math.atan2(-sx, -sy);
    let err = want - this.tank.heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    return {
      throttle: mag * Math.max(0, Math.cos(err)) ** 2,
      turn: -THREE.MathUtils.clamp(err * 2.5, -1, 1),
    };
  }

  /** One simulation step (also driven by test scripts). */
  step(dt, drive, fire) {
    const t = this.tank;
    this.time += dt;
    // Auto aim (like the heli's gunner): the turret swings onto the best block by itself, the
    // barrel depresses toward it and the gun fires whenever it is on target. Q / E (arrows, touch
    // buttons) take the turret over; the block nearest the gun when they are let go is the new lock.
    const engaged = this.state === 'playing' || this.state === 'won';
    const manual = !!drive.turret;
    this.manualAim = manual ? GameConfig.tank.manualHold : Math.max(0, this.manualAim - dt);
    this.aim.set(t.position.x + Math.sin(t.gunYaw) * 20, 0, t.position.z + Math.cos(t.gunYaw) * 20);
    const auto = this.manualAim <= 0;
    const lock = engaged ? this.lockedTarget(auto) : null;
    const lockPoint = lock ? this.blockCenter(lock, v3) : null;
    t.update(dt, drive, drive.aim ?? (auto ? lockPoint : null));
    this.aim.set(t.position.x + Math.sin(t.gunYaw) * 20, 0, t.position.z + Math.cos(t.gunYaw) * 20);
    const target = lockPoint ?? this.freeAimPoint(v3);
    this.aimBarrel(target);
    this.updateReticle(dt, lock, target);
    // On target: the gunner fires by himself (SPACE / click / FIRE still fire at will).
    if (lock && auto && engaged) {
      const off = Math.abs(wrap(Math.atan2(lockPoint.x - t.position.x, lockPoint.z - t.position.z) - t.gunYaw));
      if (off < GameConfig.tank.autoFireAngle) fire = true;
    }
    for (const key of Object.keys(this.powers)) this.powers[key] = Math.max(0, this.powers[key] - dt);
    if (fire) this.fire();
    if (this.state === 'playing') {
      this.updateTrains(dt);
      this.updateHoming(dt);
    }
    this.updateFighter(dt);
    this.blocks.update(dt);
    this.pile.update(dt);
    this.projectiles.update(dt, this.world);
    this.supplies.update(dt, v1.copy(t.position).setY(t.position.y + 1.2), this.state === 'playing');
    this.updateDust(dt);
    this.arena.update(dt);
    this.effects.update(dt);
    this.blocks.render();
    this.pile.render();
    this.updateCamera(dt);
    this.checkEnd();
    this.updateHud(dt);
  }

  // ---- Combat world (what the projectiles see) -------------------------------------------------

  combatWorld() {
    const self = this;
    return {
      effects: this.effects,
      blockAt: (x, z) => this.blocks.blockAt(x, z),
      blockTop: (b) => this.arena.floorHeight(b.z) + b.height,
      damageBlock: (b, amount, at) => this.blocks.damage(b, amount, at),
      floorAt: (x, z) => this.arena.floorAt(x, z),
      wallAt: (p) => this.arena.wallAt(p),
      isWater: (x, z) => this.arena.isWater(x, z),
      tankHit: (p) => this.tankHit(p),
      damageTank: (amount, at) => this.damageTank(amount, at),
      bombBlast: (p, radius, damage) => this.bombBlast(p, radius, damage),
      flyingEnemies: () => (this.fighterActive && this.fighter.isAlive() ? [this.fighter] : []),
      closestEnemy: (p) => this.closestEnemy(p),
      shakeAt(p, amount) {
        const d = p.distanceTo(self.tank.position);
        self.shake = Math.max(self.shake, THREE.MathUtils.clamp(amount - d * 0.01, 0.06, amount));
      },
    };
  }

  /** The hull as a box: footprint (oriented) and 0..2.8 above the ground. */
  tankHit(p) {
    const t = this.tank;
    const q = t.position;
    if (p.y < q.y - 0.2 || p.y > q.y + 2.8) return false;
    const dx = p.x - q.x;
    const dz = p.z - q.z;
    const c = Math.cos(t.heading);
    const sn = Math.sin(t.heading);
    return Math.abs(dx * c - dz * sn) <= t.half.x + 0.1 && Math.abs(dx * sn + dz * c) <= t.half.z + 0.1;
  }

  damageTank(amount, at) {
    if (this.state !== 'playing' && this.state !== 'won') return;
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlash = Math.min(1, this.hitFlash + amount / 25);
    this.ui?.damageFlash(Math.min(1, 0.35 + amount / 20));
    this.shake = Math.max(this.shake, Math.min(0.5, 0.08 + amount / 60));
    if (this.hp <= 0 && this.state === 'playing') {
      this.state = 'lost';
      const p = this.tank.position;
      this.effects.explosion(v1.set(p.x, p.y + 1.5, p.z), 2.4, 0x3c4a2a, 22);
      this.effects.flash(v1, 0xff8040, 120, 0.5, 18);
      this.showBanner('TANK DESTROYED', 'The fighter got you - keep moving under fire · ENTER to try again', 'lost');
      this.ui?.kill('FIGHTER', FEED.enemy, 'TANK', FEED.tank, ['☠', '#ff6b6b']);
    }
  }

  /** A bomb (or the crashing fighter): fireball, crater dust, the tank and blocks in reach hurt. */
  bombBlast(p, radius, damage) {
    const fx = this.effects;
    fx.explosion(p, 2.2, 0x6a5a40, 18);
    fx.explosion(v2.set(p.x + rnd.spread(1), p.y + 0.8, p.z + rnd.spread(1)), 1.4, null, 0);
    fx.flash(p, 0xff9040, 140, 0.45, 20);
    const wet = this.arena.isWater(p.x, p.z);
    for (let i = 0; i < 26; i++) {
      fx.smoke.emit({
        x: p.x + rnd.spread(1.5), y: p.y + 0.2, z: p.z + rnd.spread(1.5), vx: rnd.spread(6), vy: rnd.range(4, 11), vz: rnd.spread(6), drag: 1.4, gravity: 10,
        life: rnd.range(0.8, 1.5), size0: 0.6, size1: rnd.range(1.8, 2.8),
        color0: wet ? [1.2, 1.32, 1.42, 0.9] : [0.55, 0.47, 0.36, 0.85], color1: wet ? [1.1, 1.2, 1.3, 0] : [0.65, 0.6, 0.52, 0],
      });
    }
    const d = Math.hypot(p.x - this.tank.position.x, p.z - this.tank.position.z);
    if (d < radius) this.damageTank(damage * Math.pow(1 - d / radius, 0.6), p);
    for (const lane of this.blocks.lanes) {
      for (const b of [...lane]) {
        if (Math.hypot(b.x - p.x, b.z - p.z) < radius * 0.7) this.blocks.damage(b, 2, v2.set(b.x, p.y + 1, b.z));
      }
    }
    this.shake = Math.max(this.shake, THREE.MathUtils.clamp(0.9 - d * 0.02, 0.2, 0.9));
  }

  closestEnemy(p) {
    let best = null;
    let bd = GameConfig.tank.homingRange;
    for (const lane of this.blocks.lanes) {
      for (const b of lane) {
        const d = Math.hypot(b.x - p.x, b.z - p.z);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
    }
    return best;
  }

  /** Footprint corners (and edge midpoints) on walkable ground. */
  canStand(x, z, heading) {
    const t = this.tank;
    const c = Math.cos(heading);
    const sn = Math.sin(heading);
    for (const [u, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const lx = u * t.half.x;
      const lz = w * t.half.z;
      if (!this.arena.walkable(x + lx * c + lz * sn, z - lx * sn + lz * c)) return false;
    }
    return true;
  }

  // ---- Fighter ---------------------------------------------------------------------------------

  updateFighter(dt) {
    const F = GameConfig.fighter;
    const f = this.fighter;
    if (!f) return;
    if (this.fighterActive) {
      f.update(dt, {
        projectiles: this.projectiles, effects: this.effects, tankPosition: this.tank.position,
        floorAt: (x, z) => this.arena.floorAt(x, z), armed: this.state === 'playing',
        crashAt: (p) => {
          this.bombBlast(p, F.bombRadius * 0.8, F.bombDamage * 0.5);
          this.score += SCORE.fighter;
          this.ui?.kill('TANK', FEED.tank, 'FIGHTER', FEED.enemy, [`+${SCORE.fighter}`, FEED.gold]);
        },
      });
      if (f.done) {
        this.fighterActive = false;
        f.dispose();
        this.fighterTimer = rnd.range(F.gapMin, F.gapMax);
      }
      return;
    }
    if (this.state !== 'playing') return;
    this.fighterTimer -= dt;
    if (this.fighterTimer > 0) return;
    f.start(this.tank.position, this.fighterSide);
    this.fighterSide = -this.fighterSide;
    this.scene.add(f.root);
    this.fighterActive = true;
    this.ui?.log([['▲ ENEMY FIGHTER INBOUND - KEEP MOVING', '#ff8a7a']], { kind: 'event' });
  }

  // ---- R: homing missiles ------------------------------------------------------------------------

  updateHoming(dt) {
    if (this.powers.R <= 0) return;
    this.homingTimer -= dt;
    if (this.homingTimer > 0) return;
    const cfg = GameConfig.tank;
    const p = this.tank.position;
    const targets = [];
    for (const lane of this.blocks.lanes) for (const b of lane) if (Math.hypot(b.x - p.x, b.z - p.z) < cfg.homingRange) targets.push(b);
    if (this.fighterActive && this.fighter.isAlive() && this.fighter.position.distanceTo(p) < cfg.homingRange * 1.4) {
      // The fighter is the favourite target while it is in reach.
      for (let i = 0; i < 4; i++) targets.push(this.fighter);
    }
    this.homingTimer = targets.length ? cfg.homingInterval : 0.2;
    if (!targets.length) return;
    const pick = targets[Math.floor(rnd.next() * targets.length)];
    // Launch off a turret side, up and out, then curve down onto the target.
    const t = this.tank;
    const side = (this.homingSide = -(this.homingSide ?? 1));
    t.turret.updateWorldMatrix(true, false);
    const muzzle = t.turret.localToWorld(v1.set(side * 1.1, 1.0, -0.4));
    const dir = v2.set(side * 0.7 + rnd.spread(0.5), 1.5, rnd.spread(0.6)).applyAxisAngle(UP, t.gunYaw).normalize();
    this.projectiles.spawn(HomingMissile, muzzle, dir.multiplyScalar(cfg.missileSpeed * 0.7), { target: pick, damage: cfg.missileDamage });
    this.effects.muzzleFlash(muzzle, dir.normalize(), [5, 2.4, 0.6, 1], 0.6);
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
    this.score += SCORE.block;
    if (this.broken % 100 === 0) this.ui?.kill('TANK', FEED.tank, `${this.broken} BLOCKS`, FEED.grey, [`/ ${GameConfig.tankArena.breakGoal}`, FEED.gold]);
    this.shake = Math.max(this.shake, depth > 0 ? 0.12 : 0.18);
    if (b.type === 'supply' && this.state === 'playing') {
      // T triple, D rapid, H repair; R (homing rockets) only after its skill card.
      const pool = this.skills.has('tankHoming') ? ['T', 'D', 'H', 'R', 'R'] : ['T', 'D', 'H'];
      this.supplies.spawn(pool[Math.floor(rnd.next() * pool.length)], at);
    }
    if (this.broken >= this.nextCardAt) {
      this.nextCardAt += GameConfig.tankArena.cardEvery;
      this.offerCards();
    }
  }

  /** Every cardEvery broken blocks: pick one of the tank skill cards not taken yet. */
  offerCards() {
    if (!this.cards || this.state !== 'playing') return;
    const pool = CARD_DEFS.filter((d) => d.level === 'tank' && !this.skills.has(d.id));
    if (!pool.length) return;
    this.cards.show(pool.slice(0, 2), (def) => this.applySkill(def), { heading: 'CHOOSE A SKILL', sub: `${this.broken} blocks broken` });
  }

  applySkill(def) {
    this.skills.add(def.id);
    if (def.id === 'tankChain') this.blocks.chainEnabled = true;
    this.ui?.toast(def.id === 'tankHoming' ? 'HOMING ROCKETS UNLOCKED - LOOK FOR R SUPPLIES' : 'CHAIN REACTION - SAME COLOURS GO TOGETHER');
  }

  onPickup(type, item) {
    const s = this.settings;
    PickupSfx.play(s ? (s.master / 10) * (s.sfx / 10) : 0.64, 0, type === 'H' ? -0.1 : 0);
    if (type === 'H') {
      this.pile.remove(10);
      this.hp = Math.min(GameConfig.tank.hp, this.hp + 25);
    } else {
      const key = type === 'G' ? 'D' : type;
      this.powers[key] = GameConfig.tankArena.powerTime;
    }
    this.ui?.kill('TANK', FEED.tank, POWER_NAMES[type] ?? type, css(SUPPLY_COLORS[type] ?? 0xffffff));
    if (type === 'H') this.ui?.notice('+25 ARMOR · DRAIN -10', '#7be86a');
    this.effects.sparkBurst(item.obj.position, 26, 6, [3, 3, 3, 1]);
  }

  checkEnd() {
    const A = GameConfig.tankArena;
    if (this.state === 'won' && this.tank.position.x * Math.sign(A.base.x) < -A.phase2X) {
      this.state = 'phase2';
      this.showBanner('PHASE 2', 'Coming soon · ENTER to replay phase 1', 'won');
      return;
    }
    if (this.state !== 'playing') return;
    if (this.pile.count >= A.drainLimit) {
      this.state = 'lost';
      this.showBanner('DRAIN OVERFLOW', 'The drain is full · ENTER to try again', 'lost');
    } else if (this.dropped >= A.phaseBlocks && !this.train && this.blocks.count === 0) {
      const won = this.broken >= A.breakGoal;
      this.state = won ? 'won' : 'lost';
      if (won) {
        // The gate in the right wall opens: the road behind it leads on to phase 2.
        this.arena.setGateOpen(true);
        this.ui?.toast('PHASE 1 CLEAR - THE GATE IS OPEN', '#ffd34a');
        this.showBanner('PHASE 1 CLEAR!', `${this.broken} blocks broken · the gate on the right is open - drive out`, 'won');
      }
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

  /** The shared HUD: score, phase, HP (armour), the channel panel, objectives and power-ups. */
  updateHud(dt = 0) {
    const A = GameConfig.tankArena;
    const t = this.tank;
    this.hitFlash = Math.max(0, (this.hitFlash ?? 0) - dt * 1.8);
    // Key help fades after the first seconds.
    if (this.time > 12) this.hudEl.keys.classList.add('faded');
    // Phones: the drag joystick shows where it was put down and where the thumb is.
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
    this.reloadBar.style.width = `${Math.round((1 - t.cooldown / (t.reloadTime || GameConfig.tank.reload)) * 100)}%`;
    const ui = this.ui;
    if (!ui) return;
    ui.setScore(this.score);
    ui.setHealth(this.hp / GameConfig.tank.hp);
    const drain = this.pile.count;
    ui.setTankPanel({
      title: this.state === 'won' || this.state === 'phase2' ? 'THE CHANNEL · CLEAR' : 'THE CHANNEL',
      broken: this.broken, goal: A.breakGoal, drain, drainLimit: A.drainLimit, incoming: Math.max(0, A.phaseBlocks - this.dropped),
    });
    // Drain warnings at 50 / 75 / 90 %.
    for (const f of [0.5, 0.75, 0.9]) {
      if (drain >= A.drainLimit * f && this.drainWarned < f && this.state === 'playing') {
        this.drainWarned = f;
        ui.notice(`DRAIN ${drain}/${A.drainLimit}!`, '#ff6b6b');
      }
    }
    ui.setObjectives(this.objectives());
    const active = new Map();
    for (const [k, v] of Object.entries(this.powers)) {
      if (v > 0) active.set(k, { remaining: v, duration: A.powerTime, name: POWER_NAMES[k], css: css(SUPPLY_COLORS[k] ?? 0xffffff) });
    }
    ui.setSkills(active);
  }

  /** Objective checklist (bottom left, like the heli stages). */
  objectives() {
    const A = GameConfig.tankArena;
    const won = this.state === 'won' || this.state === 'phase2';
    return {
      title: 'PHASE 1 · THE CHANNEL',
      items: [
        { text: `Break ${A.breakGoal} blocks`, done: this.broken >= A.breakGoal, progress: `${Math.min(this.broken, A.breakGoal)}/${A.breakGoal}` },
        { text: `Keep the drain under ${A.drainLimit}`, done: won, progress: `${this.pile.count}/${A.drainLimit}`, swatch: 'blue' },
        { text: 'Survive the fighter', done: won },
        { text: 'Drive out through the gate', done: this.state === 'phase2' },
      ],
    };
  }

  // ---- Aiming (smart aim) ---------------------------------------------------------------------

  /**
   * The locked block (refreshed every lockRefresh s), or null.
   *   auto   (the gunner): any block in range, scored by how far the turret has to swing and the
   *          distance; the current lock is kept while it lives (no hopping between neighbours).
   *   manual (Q / E held): only within aimCone around the gun, so the player sees what the turret
   *          will settle on when the keys are let go.
   */
  lockedTarget(auto = true) {
    const cfg = GameConfig.tank;
    const L = this.lock;
    const held = L && L.block.serial === L.serial && L.block.alive;
    if (held && L.auto === auto && this.time - L.at < cfg.lockRefresh) return L.block;
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
        if (!auto && ang > cfg.aimCone) continue;
        const mine = held && L.block === b;
        const score = auto
          ? ang * cfg.autoSwingWeight + d * 0.3 - (mine ? cfg.autoKeep : 0)
          : ang * 12 + d * 0.35 - (mine ? 0.6 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = b;
        }
      }
    }
    this.lock = best ? { block: best, serial: best.serial, at: this.time, auto } : null;
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
    out.y = this.arena.floorAt(out.x, out.z) + 0.9;
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
    r.visible = this.state === 'playing' || this.state === 'won';
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
    const lock = this.lock && this.lock.block.serial === this.lock.serial && this.lock.block.alive ? this.lock.block : null;
    const aimDir = lock ? this.blockCenter(lock, new THREE.Vector3()).sub(muzzle).normalize() : dir.clone();
    // Point blank: a block between the barrel's base and the muzzle (pressed against the hull)
    // takes the hit at once.
    const pivot = this.tank.turret.localToWorld(v3.copy(this.tank.barrelHome));
    const close = this.traceBlock(pivot, muzzle);
    if (close) {
      this.blocks.damage(close, cfg.shellDamage, close.aimPoint(v1));
      this.effects.explosion(v1, 0.9, null, 0);
      return;
    }
    const spreads = this.powers.T > 0 ? [-0.12, 0, 0.12] : [0];
    for (const off of spreads) {
      const vel = v2.copy(aimDir).applyAxisAngle(UP, off).multiplyScalar(cfg.shellSpeed);
      this.projectiles.spawn(TankShell, muzzle, vel, { damage: cfg.shellDamage });
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

  /** Spray behind the tracks while driving (shallow water). */
  updateDust(dt) {
    const t = this.tank;
    const moving = Math.abs(t.speed) + Math.abs(t.turnRate) * 1.5;
    this.dustTimer -= dt * moving;
    if (this.dustTimer > 0) return;
    this.dustTimer = 0.3;
    for (const x of t.track.x) {
      v1.set(x, 0.2, -2.3 * Math.sign(t.speed || 1)).applyMatrix4(t.root.matrixWorld);
      const wet = this.arena.isWater(v1.x, v1.z);
      this.effects.smoke.emit({
        x: v1.x + rnd.spread(0.3), y: this.arena.floorAt(v1.x, v1.z) + 0.3, z: v1.z + rnd.spread(0.3), vx: rnd.spread(0.8), vy: rnd.range(0.8, 1.8), vz: rnd.spread(0.8), drag: 1.8, gravity: wet ? 4 : 0.5,
        life: rnd.range(0.5, 0.9) * (wet ? 1 : 1.5), size0: 0.4, size1: rnd.range(1.2, 1.8) * (wet ? 1 : 1.4),
        color0: wet ? [1.15, 1.3, 1.4, 0.6] : [0.62, 0.53, 0.4, 0.55], color1: wet ? [1.1, 1.2, 1.3, 0] : [0.7, 0.64, 0.55, 0],
      });
    }
  }

  /** Follow camera from behind the tank's start heading (looking up the channel). */
  updateCamera(dt, snap = false) {
    const cfg = GameConfig.tank.camera;
    const p = this.tank.position;
    const A = GameConfig.tankArena;
    const halfW = (A.block * A.lanes) / 2;
    // In the channel follow x only partly (keep it framed); out on the roads / in the base follow.
    const ax = Math.abs(p.x);
    const camX = ax <= halfW ? p.x * 0.4 : Math.sign(p.x) * (halfW * 0.4 + (ax - halfW) * 0.9);
    v1.set(camX, cfg.height, p.z * cfg.follow - cfg.back);
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
