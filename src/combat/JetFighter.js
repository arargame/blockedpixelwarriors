import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { Enemy } from './Enemy.js';
import { JetBullet, AerialBomb } from './Projectiles.js';
import { fxRandom as rnd } from '../util/Random.js';

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

/**
 * The Blocked Pixel Panzer "FighterJet" enemy (a WW2 prop fighter, assets/models/fighter.glb from
 * tools/blender/build_fighter.py) making a strafing pass over the tank:
 *
 *   - comes in from one side of the screen, crosses over the tank's position and leaves on the
 *     other side (slightly diagonal, a shallow dive during the attack);
 *   - fires its wing guns at the tank for 3-4 s on the way in (aimed where the tank is when each
 *     round leaves the barrel: keep moving and they miss);
 *   - releases its bomb so it lands where the tank is at that moment (stand still and it hits);
 *   - can be shot down (homing missiles): it rolls over, trails fire and smoke and crashes.
 */
export class JetFighter extends Enemy {
  /** @param {THREE.Object3D} template the glTF root "Fighter" */
  constructor(template) {
    const F = GameConfig.fighter;
    super({ hp: F.hp, harmsPlayer: true, kind: 'fighter' });
    this.root = template.clone(true);
    this.root.scale.setScalar(F.scale);
    this.prop = this.root.getObjectByName('FighterProp');
    this.disc = this.root.getObjectByName('FighterPropDisc');
    this.bomb = this.root.getObjectByName('FighterBomb');
    this.guns = [this.root.getObjectByName('FighterGunL'), this.root.getObjectByName('FighterGunR')];
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });
    if (this.disc) {
      this.disc.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.depthWrite = false;
          o.renderOrder = 5;
        }
      });
    }
    this.dir = new THREE.Vector3(1, 0, 0);
    this.pass = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.done = false;
  }

  /** Starts a pass over `target` (tank position) from the left (side -1) or the right (+1). */
  start(target, side) {
    const F = GameConfig.fighter;
    this.dir.set(-side, 0, rnd.spread(0.35)).normalize();
    this.pass.set(target.x + rnd.spread(F.passOffset), 0, target.z + rnd.spread(F.passOffset));
    this.s = -F.approach;
    this.strafe = rnd.range(F.strafeMin, F.strafeMax);
    this.fireTimer = 0;
    this.gun = 0;
    this.bombDropped = false;
    this.hp = this.maxHp;
    this.alive = true;
    this.done = false;
    this.falling = false;
    this.roll = 0;
    this.smokeTimer = 0;
    if (this.bomb) this.bomb.visible = true;
    this.place(0);
    return this;
  }

  /** A target while flying (not once it is shot down and falling, or gone). */
  isAlive() {
    return this.alive && !this.done && !this.falling;
  }

  aimPoint(out) {
    return out.copy(this.root.position);
  }

  hitTest(p) {
    const r = GameConfig.fighter.hitRadius;
    return p.distanceToSquared(this.root.position) < r * r;
  }

  get position() {
    return this.root.position;
  }

  /** Altitude along the pass: a shallow dive toward the target, climbing away after. */
  altitude(s) {
    const F = GameConfig.fighter;
    const k = Math.exp(-(((s + F.speed * 0.8) / (F.speed * 2.4)) ** 2));
    return F.altitude - F.dive * k;
  }

  place(dt) {
    const F = GameConfig.fighter;
    const p = this.root.position;
    const prev = v2.copy(p);
    p.copy(this.pass).addScaledVector(this.dir, this.s);
    p.y = this.altitude(this.s);
    if (dt > 0) this.vel.subVectors(p, prev).divideScalar(dt);
    else this.vel.copy(this.dir).multiplyScalar(F.speed);
    // Nose along the flight path, banking a little (more once past the target).
    const yaw = Math.atan2(this.dir.x, this.dir.z);
    const pitch = -Math.atan2(this.vel.y, Math.hypot(this.vel.x, this.vel.z));
    const bank = this.s > 0 ? Math.min(0.6, this.s / 40) * Math.sign(this.dir.z || 1) : Math.sin(this.s * 0.05) * 0.08;
    this.root.rotation.set(pitch, yaw, bank + this.roll, 'YXZ');
  }

  /**
   * @param {number} dt
   * @param {{ projectiles: import('./Projectiles.js').ProjectileManager, effects: any, tankPosition: THREE.Vector3, floorAt: Function }} ctx
   */
  update(dt, ctx) {
    if (this.done) return;
    const F = GameConfig.fighter;
    if (this.prop) this.prop.rotation.z += dt * 46;
    if (this.disc) this.disc.rotation.z -= dt * 3;
    if (this.falling) {
      this.crash(dt, ctx);
      return;
    }
    this.s += F.speed * dt;
    this.place(dt);
    this.root.updateMatrixWorld(true);
    const tank = ctx.tankPosition;
    // Strafe: the last `strafe` seconds before the pass point.
    const tLeft = -this.s / F.speed;
    if (ctx.armed && tLeft > 0.15 && tLeft < this.strafe + 0.15) {
      this.fireTimer -= dt;
      while (this.fireTimer <= 0) {
        this.fireTimer += 1 / F.fireRate;
        this.fire(ctx, tank);
      }
    }
    // Bomb: released so that it lands on the tank's current position.
    if (ctx.armed && !this.bombDropped && this.bomb) {
      this.bomb.getWorldPosition(v1);
      const h = v1.y - ctx.floorAt(tank.x, tank.z);
      const T = Math.sqrt((2 * Math.max(h, 1)) / F.bombGravity);
      const ahead = v2.subVectors(tank, v1).setY(0).dot(this.dir);
      if (ahead <= F.speed * T) {
        this.bombDropped = true;
        this.bomb.visible = false;
        const vel = v2.set((tank.x - v1.x) / T, 0, (tank.z - v1.z) / T);
        ctx.projectiles.spawn(AerialBomb, v1, vel);
        ctx.onBombAway?.();
      }
    }
    // Damaged: black smoke from the engine.
    if (this.hp < this.maxHp * 0.5) this.smoke(dt, ctx, 0.05);
    if (this.s > F.exit) this.done = true;
  }

  fire(ctx, tank) {
    const F = GameConfig.fighter;
    const g = this.guns[this.gun++ % 2];
    if (!g) return;
    g.getWorldPosition(v1);
    v2.set(tank.x + rnd.spread(F.spread), tank.y + 1.1 + rnd.spread(0.4), tank.z + rnd.spread(F.spread)).sub(v1).normalize();
    ctx.projectiles.spawn(JetBullet, v1, v2.multiplyScalar(F.bulletSpeed));
    ctx.effects.muzzleFlash(v1, v2.normalize(), [5, 3.4, 1.2, 1], 0.7);
  }

  smoke(dt, ctx, every) {
    this.smokeTimer -= dt;
    if (this.smokeTimer > 0) return;
    this.smokeTimer = every;
    this.root.localToWorld(v1.set(0, 0.1, 1.6));
    ctx.effects.smoke.emit({
      x: v1.x, y: v1.y, z: v1.z, vx: rnd.spread(0.4), vy: rnd.range(0.2, 0.8), vz: rnd.spread(0.4), drag: 0.8,
      life: rnd.range(1.2, 2), size0: 0.8, size1: rnd.range(2.4, 3.4), color0: [0.12, 0.11, 0.1, 0.85], color1: [0.3, 0.3, 0.3, 0],
    });
  }

  /** Shot down: rolls over, trails fire, hits the ground and explodes. */
  onDeath() {
    // Stays in the scene (the level keeps updating it until `done`) while it falls.
    this.falling = true;
    this.vel.copy(this.dir).multiplyScalar(GameConfig.fighter.speed * 0.9);
    this.vel.y = 2;
  }

  crash(dt, ctx) {
    this.vel.y -= 14 * dt;
    this.root.position.addScaledVector(this.vel, dt);
    this.roll += dt * 4;
    const yaw = Math.atan2(this.dir.x, this.dir.z);
    this.root.rotation.set(-Math.atan2(this.vel.y, Math.hypot(this.vel.x, this.vel.z)), yaw, this.roll, 'YXZ');
    this.smoke(dt, ctx, 0.025);
    this.root.localToWorld(v1.set(0, 0, 1.2));
    ctx.effects.fire.emit({ x: v1.x, y: v1.y, z: v1.z, vx: rnd.spread(1), vy: rnd.range(0, 1), vz: rnd.spread(1), life: 0.3, size0: 1.1, size1: 0.3, color0: [5, 2.2, 0.5, 1], color1: [2, 0.4, 0.1, 0] });
    const p = this.root.position;
    if (p.y <= ctx.floorAt(p.x, p.z) + 0.5) {
      ctx.crashAt?.(p);
      this.done = true;
    }
  }

  dispose() {
    this.root.removeFromParent();
  }
}

