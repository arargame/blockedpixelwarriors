import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { ObjectPool } from '../core/ObjectPool.js';
import { fxRandom as rnd } from '../util/Random.js';

const tmp = new THREE.Vector3();
const quat = new THREE.Quaternion();
const mat = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Projectile class hierarchy of the tank level (Template Method): the base class moves the
 * projectile in sub-steps (no tunnelling through a block), asks the subclass whether it hit
 * something, and lets it react. Subclasses only fill in the hooks:
 *
 *   init(opts)            per-launch state (damage, target, ...)
 *   integrate(h)          motion (straight, homing, ballistic)
 *   collide(world)        what it hit at the current position, or null
 *   impact(world, hit)    damage + effects; the projectile is then spent
 *   trail(dt, world)      smoke / glow while flying
 *
 * The world is the level (CombatWorld interface): blockAt, blockTop, damageBlock, floorAt, wallAt,
 * tankHit, damageTank, enemiesNear, effects. Instances come from per-class pools (ObjectPool) and
 * are drawn as one InstancedMesh set per class (ProjectileManager).
 */
export class Projectile {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.age = 0;
    this.trailTimer = 0;
  }

  /** Life time (s) and sub-step length (units). */
  get maxLife() {
    return 3;
  }

  get stepLength() {
    return 0.45;
  }

  launch(pos, vel, opts = {}) {
    this.pos.copy(pos);
    this.vel.copy(vel);
    this.age = 0;
    this.trailTimer = 0;
    this.init(opts);
    return this;
  }

  init() {}

  /** Advances the projectile; returns false once it is spent (hit something or timed out). */
  update(dt, world) {
    this.age += dt;
    const speed = this.vel.length();
    const n = Math.max(1, Math.ceil((speed * dt) / this.stepLength));
    const h = dt / n;
    for (let k = 0; k < n; k++) {
      this.integrate(h, world);
      const hit = this.collide(world);
      if (hit) {
        this.impact(world, hit);
        return false;
      }
    }
    if (this.age > this.maxLife) {
      this.expire(world);
      return false;
    }
    this.trail(dt, world);
    return true;
  }

  integrate(h) {
    this.pos.addScaledVector(this.vel, h);
  }

  collide() {
    return null;
  }

  impact() {}

  expire() {}

  trail() {}

  /** Orientation for drawing: the model's forward axis along the velocity. */
  orient(out, forward) {
    return out.setFromUnitVectors(forward, tmp.copy(this.vel).normalize());
  }

  /** Shared hit test for player weapons: a channel block, a wall or the ground. */
  static groundHit(world, pos) {
    const b = world.blockAt(pos.x, pos.z);
    if (b && pos.y <= world.blockTop(b)) return { kind: 'block', block: b };
    if (world.wallAt(pos)) return { kind: 'wall' };
    if (pos.y <= world.floorAt(pos.x, pos.z) + 0.05) return { kind: 'floor' };
    return null;
  }
}

/** The tank's main gun: straight, fast, one block per shell. */
export class TankShell extends Projectile {
  get maxLife() {
    return GameConfig.tank.shellRange / GameConfig.tank.shellSpeed;
  }

  init({ damage = GameConfig.tank.shellDamage } = {}) {
    this.damage = damage;
  }

  collide(world) {
    return Projectile.groundHit(world, this.pos);
  }

  impact(world, hit) {
    if (hit.block) world.damageBlock(hit.block, this.damage, this.pos);
    const fx = world.effects;
    fx.explosion(this.pos, 0.9, hit.block ? null : hit.kind === 'wall' ? 0xb9b6ad : 0x7a6a52, hit.block ? 0 : 6);
    if (hit.kind === 'floor') fx.snowPuff(tmp.copy(this.pos).setY(this.pos.y + 0.1), 6);
    world.shakeAt?.(this.pos, 0.4);
  }

  expire(world) {
    world.effects.explosion(this.pos, 0.6, null, 0);
  }

  trail(dt, world) {
    world.effects.fire.emit({ x: this.pos.x, y: this.pos.y, z: this.pos.z, life: 0.12, size0: 0.45, size1: 0.1, color0: [3, 1.8, 0.6, 1], color1: [1, 0.4, 0.1, 0] });
  }
}

/**
 * R power-up: a homing missile (the heli's Blender rocket) launched up and out of the turret,
 * curving onto its target (any Enemy: a channel block or the fighter). Splash on the neighbours.
 */
export class HomingMissile extends Projectile {
  get maxLife() {
    return 4;
  }

  get stepLength() {
    return 0.35;
  }

  init({ target = null, damage = 2 } = {}) {
    this.target = target;
    this.damage = damage;
  }

  integrate(h, world) {
    const t = this.target;
    if (t && t.isAlive()) {
      t.aimPoint(tmp).sub(this.pos);
      const dist = tmp.length();
      tmp.normalize().multiplyScalar(GameConfig.tank.missileSpeed * (1 + this.age * 0.6));
      this.vel.lerp(tmp, Math.min(1, h * 5 * (dist < 3 ? 2.5 : 1)));
    } else if (this.age > 0.4) {
      // Target gone: pick the nearest other one.
      this.target = world.closestEnemy?.(this.pos) ?? null;
      if (!this.target) this.vel.y -= 6 * h;
    }
    super.integrate(h);
  }

  collide(world) {
    if (this.age < 0.25) return null;
    for (const e of world.flyingEnemies?.() ?? []) {
      if (e.isAlive() && e.hitTest(this.pos)) return { kind: 'air', enemy: e };
    }
    return Projectile.groundHit(world, this.pos);
  }

  impact(world, hit) {
    const fx = world.effects;
    if (hit.enemy) {
      hit.enemy.takeDamage(this.damage, this.pos);
      fx.explosion(this.pos, 0.8, null, 0);
      return;
    }
    if (hit.block) world.damageBlock(hit.block, this.damage, this.pos);
    // Splash: the four neighbours take a hit.
    const S = GameConfig.tankArena.block;
    for (const [dx, dz] of [[S, 0], [-S, 0], [0, S], [0, -S]]) {
      const n = world.blockAt(this.pos.x + dx, this.pos.z + dz);
      if (n && n !== hit.block) world.damageBlock(n, 1, tmp.set(n.x, this.pos.y, n.z));
    }
    fx.explosion(this.pos, 1.1, hit.block ? null : 0x7a6a52, hit.block ? 0 : 6);
    world.shakeAt?.(this.pos, 0.3);
  }

  expire(world) {
    world.effects.explosion(this.pos, 0.6, null, 0);
  }

  trail(dt, world) {
    this.trailTimer -= dt;
    if (this.trailTimer > 0) return;
    this.trailTimer = 0.016;
    const fx = world.effects;
    tmp.copy(this.vel).normalize();
    const tx = this.pos.x - tmp.x * 0.45;
    const ty = this.pos.y - tmp.y * 0.45;
    const tz = this.pos.z - tmp.z * 0.45;
    fx.smoke.emit({ x: tx, y: ty, z: tz, vx: rnd.spread(0.25), vy: rnd.range(0.1, 0.4), vz: rnd.spread(0.25), drag: 1, life: rnd.range(0.9, 1.3), size0: 0.3, size1: 1.3, color0: [0.95, 0.95, 0.97, 0.75], color1: [1, 1, 1, 0] });
    fx.fire.emit({ x: tx, y: ty, z: tz, vx: -tmp.x * 3, vy: -tmp.y * 3, vz: -tmp.z * 3, life: 0.08, size0: 0.65, size1: 0.2, color0: [5, 2.4, 0.6, 1], color1: [2, 0.5, 0.1, 0] });
  }
}

/** The fighter's machine-gun round: a tracer that hurts the tank and kicks up water / dust. */
export class JetBullet extends Projectile {
  get maxLife() {
    return 1.6;
  }

  get stepLength() {
    return 0.6;
  }

  init({ damage = GameConfig.fighter.bulletDamage } = {}) {
    this.damage = damage;
  }

  collide(world) {
    if (world.tankHit(this.pos)) return { kind: 'tank' };
    if (this.pos.y <= world.floorAt(this.pos.x, this.pos.z) + 0.05) return { kind: 'floor' };
    const b = world.blockAt(this.pos.x, this.pos.z);
    if (b && this.pos.y <= world.blockTop(b)) return { kind: 'block' };
    return null;
  }

  impact(world, hit) {
    const fx = world.effects;
    if (hit.kind === 'tank') {
      world.damageTank(this.damage, this.pos);
      fx.sparkBurst(this.pos, 6, 5, [4, 3, 1.5, 1]);
      return;
    }
    if (hit.kind === 'block') {
      fx.sparkBurst(this.pos, 3, 3, [3, 2.4, 1.4, 1]);
      return;
    }
    // Ground: a spurt of water in the channel, dust outside.
    const wet = world.isWater?.(this.pos.x, this.pos.z);
    for (let i = 0; i < 3; i++) {
      fx.smoke.emit({
        x: this.pos.x, y: this.pos.y + 0.1, z: this.pos.z, vx: rnd.spread(1), vy: rnd.range(2, 4.5), vz: rnd.spread(1), drag: 1.5, gravity: 9,
        life: rnd.range(0.35, 0.6), size0: 0.2, size1: rnd.range(0.6, 0.9),
        color0: wet ? [1.2, 1.35, 1.45, 0.85] : [0.62, 0.55, 0.44, 0.7], color1: wet ? [1.1, 1.2, 1.3, 0] : [0.7, 0.64, 0.55, 0],
      });
    }
  }

  trail(dt, world) {
    world.effects.fire.emit({ x: this.pos.x, y: this.pos.y, z: this.pos.z, life: 0.05, size0: 0.35, size1: 0.12, color0: [4, 3, 1.2, 1], color1: [2, 0.8, 0.2, 0] });
  }

  orient(out, forward) {
    return out.setFromUnitVectors(forward, tmp.copy(this.vel).normalize());
  }
}

/**
 * The fighter's WW2 bomb: falls (gravity) with the throw it got at release, nose pitching down
 * along the flight path; a big blast where it lands that hurts the tank (falling off with the
 * distance) and every block in reach.
 */
export class AerialBomb extends Projectile {
  get maxLife() {
    return 6;
  }

  get stepLength() {
    return 0.3;
  }

  init() {
    this.spin = rnd.spread(2);
  }

  integrate(h) {
    this.vel.y -= GameConfig.fighter.bombGravity * h;
    super.integrate(h);
  }

  collide(world) {
    const b = world.blockAt(this.pos.x, this.pos.z);
    if (b && this.pos.y <= world.blockTop(b)) return { kind: 'block' };
    if (world.tankHit(this.pos)) return { kind: 'tank' };
    if (this.pos.y <= world.floorAt(this.pos.x, this.pos.z) + 0.1) return { kind: 'floor' };
    return null;
  }

  impact(world) {
    const F = GameConfig.fighter;
    world.bombBlast(this.pos, F.bombRadius, F.bombDamage);
  }

  trail(dt, world) {
    this.trailTimer -= dt;
    if (this.trailTimer > 0) return;
    this.trailTimer = 0.05;
    world.effects.smoke.emit({ x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z, vy: 0.3, life: 0.6, size0: 0.2, size1: 0.6, color0: [0.8, 0.8, 0.82, 0.35], color1: [1, 1, 1, 0] });
  }

  orient(out, forward) {
    // Nose along the velocity (it starts level and tips down as it falls).
    const v = tmp.copy(this.vel);
    if (v.lengthSq() < 1e-6) v.copy(DOWN);
    return out.setFromUnitVectors(forward, v.normalize());
  }
}

/**
 * Owns the pools and the active list; one InstancedMesh set per projectile class.
 */
export class ProjectileManager {
  constructor(scene) {
    this.scene = scene;
    this.kinds = new Map();
    this.active = [];
  }

  /**
   * @param {typeof Projectile} Class
   * @param {THREE.Object3D|null} model template (meshes baked into instanced copies)
   * @param {{forward?: THREE.Vector3, scale?: number, max?: number, shadow?: boolean}} [opts]
   */
  register(Class, model, { forward = new THREE.Vector3(0, 0, 1), scale = 1, max = 64, shadow = true, prewarm = 16 } = {}) {
    const meshes = [];
    if (model) {
      model.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
      model.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        g.scale(scale, scale, scale);
        const inst = new THREE.InstancedMesh(g, o.material, max);
        inst.count = 0;
        inst.castShadow = shadow;
        inst.frustumCulled = false;
        meshes.push(inst);
        this.scene.add(inst);
      });
    }
    this.kinds.set(Class, { pool: new ObjectPool(() => new Class(), prewarm), meshes, forward, max });
  }

  /** A pooled projectile of `Class`, launched at pos with velocity vel. */
  spawn(Class, pos, vel, opts) {
    const k = this.kinds.get(Class);
    const p = k.pool.acquire();
    p.launch(pos, vel, opts);
    this.active.push(p);
    return p;
  }

  update(dt, world) {
    let write = 0;
    for (let i = 0; i < this.active.length; i++) {
      const p = this.active[i];
      if (p.update(dt, world)) this.active[write++] = p;
      else this.release(p);
    }
    this.active.length = write;
    this.render();
  }

  release(p) {
    p.target = null;
    this.kinds.get(p.constructor).pool.release(p);
  }

  render() {
    for (const [Class, k] of this.kinds) {
      let n = 0;
      for (const p of this.active) {
        if (p.constructor !== Class || n >= k.max) continue;
        p.orient(quat, k.forward);
        mat.compose(p.pos, quat, ONE);
        for (const m of k.meshes) m.setMatrixAt(n, mat);
        n++;
      }
      for (const m of k.meshes) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
      }
    }
  }

  clear() {
    for (const p of this.active) this.release(p);
    this.active.length = 0;
    this.render();
  }

  count(Class) {
    let n = 0;
    for (const p of this.active) if (p.constructor === Class) n++;
    return n;
  }
}

