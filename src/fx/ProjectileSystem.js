import * as THREE from 'three';
import { BillboardBatch } from './BillboardBatch.js';
import { fxRandom as rnd } from '../util/Random.js';

/** Visual + gameplay definitions per projectile kind (Strategy-like data table). */
export const PROJECTILE_KINDS = Object.freeze({
  plasma: { speed: 17, damage: 1.4, life: 1.6, radius: 0.25, owner: 'player' },
  tracer: { speed: 36, damage: 0.8, life: 1.0, radius: 0.15, owner: 'player' },
  nova: { speed: 22, damage: 1.2, life: 0.8, radius: 0.2, owner: 'player' },
  rocket: { speed: 15, damage: 3.5, life: 2.2, radius: 0.3, owner: 'player', splash: 2.4 },
  shell: { speed: 17, damage: 4, life: 2.2, radius: 0.25, owner: 'enemy' },
  cannonball: { speed: 11, damage: 10, life: 3.2, radius: 0.35, owner: 'enemy', gravity: 1.2 },
  missile: { speed: 10, damage: 2.4, life: 4.0, radius: 0.2, owner: 'player', homing: 5 },
});

/**
 * Moves projectiles, renders them as additive billboards and resolves hits
 * through an injected collision handler (keeps this system decoupled from entities).
 */
const aimTmp = new THREE.Vector3();
const rocketQuat = new THREE.Quaternion();
const rocketDir = new THREE.Vector3();
const rocketMat = new THREE.Matrix4();
const FORWARD = new THREE.Vector3(0, 0, -1);
const ONE = new THREE.Vector3(1, 1, 1);
const spinQuat = new THREE.Quaternion();
const SPIN_AXIS = new THREE.Vector3(1, 0.3, 0).normalize();
const def = (p) => p.def;

export class ProjectileSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../textures/TextureFactory.js').TextureFactory} textures
   * @param {import('./EffectsManager.js').EffectsManager} effects
   */
  constructor(scene, textures, effects) {
    this.effects = effects;
    this.scene = scene;
    this.items = [];
    this.comets = new BillboardBatch(textures.plasmaBolt(), 400, { additive: false, anchorTop: true, renderOrder: 16 });
    this.tracerBolts = new BillboardBatch(textures.tracerBolt(), 400, { additive: false, anchorTop: true, renderOrder: 15 });
    this.glows = new BillboardBatch(textures.glow(), 600, { additive: true, renderOrder: 15 });
    this.orbs = new BillboardBatch(textures.orb(), 400, { additive: false, renderOrder: 16 });
    this.tracerBodies = new BillboardBatch(textures.streak(), 400, { additive: false, anchorTop: true, renderOrder: 14 });
    this.streaks = new BillboardBatch(textures.streak(), 600, { additive: true, anchorTop: true, renderOrder: 14 });
    scene.add(this.comets.mesh, this.glows.mesh, this.streaks.mesh, this.orbs.mesh, this.tracerBodies.mesh, this.tracerBolts.mesh);
    /** @type {(p:any, point:THREE.Vector3) => boolean} returns true when consumed */
    this.collisionHandler = () => false;
  }

  /**
   * @param {string} kind
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3} direction
   * @param {{alive: () => boolean, position: (out: THREE.Vector3) => THREE.Vector3}} [target] homing target
   */
  spawn(kind, position, direction, target = null, { tint = null, damageMul = 1, aimed = false, gem = null, crit = false } = {}) {
    const def = PROJECTILE_KINDS[kind];
    this.items.push({
      target,
      aimed,
      gem,
      crit,
      tint: tint ? new THREE.Color(tint) : null,
      damage: def.damage * damageMul,
      kind,
      def,
      pos: position.clone(),
      prev: position.clone(),
      vel: direction.clone().normalize().multiplyScalar(def.speed),
      life: 0,
      trailTimer: 0,
      seed: rnd.next() * 10,
    });
  }

  update(dt) {
    const fx = this.effects;
    let write = 0;
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      p.life += dt;
      p.prev.copy(p.pos);
      if (p.target && def(p).homing) {
        // Steer toward the target (it may move: train cars); keeps flying straight if it died.
        if (p.target.alive()) {
          p.target.position(aimTmp).sub(p.pos);
          const dist = aimTmp.length();
          aimTmp.normalize().multiplyScalar(p.def.speed * (1 + p.life * 0.6));
          p.vel.lerp(aimTmp, Math.min(1, dt * p.def.homing * (dist < 3 ? 2.5 : 1)));
        }
      } else if (p.kind === 'rocket') {
        p.vel.multiplyScalar(1 + dt * 1.6); // rockets accelerate
        p.vel.y -= dt * 1.5;
      } else if (p.def.gravity) {
        p.vel.y -= p.def.gravity * dt; // heavy cannonballs drop in a shallow arc
      }
      // Sub-step so fast projectiles don't tunnel through thin targets.
      const steps = Math.max(1, Math.ceil((p.vel.length() * dt) / 0.35));
      let consumed = false;
      for (let s = 0; s < steps && !consumed; s++) {
        p.pos.addScaledVector(p.vel, dt / steps);
        consumed = this.collisionHandler(p, p.pos);
      }
      if (consumed || p.life > p.def.life || p.pos.y < -2) continue;

      p.trailTimer -= dt;
      if (p.trailTimer <= 0) {
        if (p.gem === 'red' || p.gem === 'green') {
          // Power shots trail embers, acid shots drip green droplets.
          p.trailTimer = 0.03;
          const acid = p.gem === 'green';
          fx.fire.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: rnd.spread(0.5), vy: acid ? -1.5 : rnd.spread(0.5), vz: rnd.spread(0.5), life: acid ? 0.35 : 0.25, size0: acid ? 0.22 : 0.35, size1: 0.04, color0: acid ? [0.6, 3, 0.4, 1] : [5, 1.8, 0.3, 1], color1: acid ? [0.2, 1, 0.1, 0] : [2, 0.4, 0.05, 0] });
        }
        if (p.kind === 'plasma') {
          p.trailTimer = 0.03;
          fx.fire.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: rnd.spread(0.4), vy: rnd.spread(0.4), vz: rnd.spread(0.4), life: 0.25, size0: 0.32, size1: 0.05, color0: [0.6, 0.9, 2.6, 1], color1: [0.9, 0.2, 1.6, 0] });
        } else if (p.kind === 'rocket') {
          p.trailTimer = 0.02;
          fx.smoke.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: rnd.spread(0.3), vy: rnd.range(0.2, 0.6), vz: rnd.spread(0.3), life: 0.9, size0: 0.3, size1: 1.1, color0: [0.9, 0.9, 0.92, 0.7], color1: [1, 1, 1, 0] });
          fx.fire.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, life: 0.08, size0: 0.55, size1: 0.2, color0: [5, 2.6, 0.6, 1], color1: [2, 0.6, 0.1, 0] });
        } else if (p.kind === 'missile') {
          p.trailTimer = 0.016;
          aimTmp.copy(p.vel).normalize();
          const tx = p.pos.x - aimTmp.x * 0.45, ty = p.pos.y - aimTmp.y * 0.45, tz = p.pos.z - aimTmp.z * 0.45;
          fx.smoke.emit({ x: tx, y: ty, z: tz, vx: rnd.spread(0.25), vy: rnd.range(0.1, 0.4), vz: rnd.spread(0.25), drag: 1, life: rnd.range(0.9, 1.3), size0: 0.25, size1: 1.1, color0: [0.95, 0.95, 0.97, 0.75], color1: [1, 1, 1, 0] });
          fx.fire.emit({ x: tx, y: ty, z: tz, vx: -aimTmp.x * 3, vy: -aimTmp.y * 3, vz: -aimTmp.z * 3, life: 0.08, size0: 0.55, size1: 0.2, color0: [5, 2.4, 0.6, 1], color1: [2, 0.5, 0.1, 0] });
        } else if (p.kind === 'shell') {
          p.trailTimer = 0.03;
          fx.smoke.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vy: 0.2, life: 0.35, size0: 0.14, size1: 0.4, color0: [0.9, 0.9, 0.92, 0.35], color1: [1, 1, 1, 0] });
        } else if (p.kind === 'cannonball') {
          p.trailTimer = 0.025;
          fx.smoke.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: rnd.spread(0.2), vy: rnd.range(0.1, 0.4), vz: rnd.spread(0.2), drag: 1, life: 0.8, size0: 0.3, size1: 0.9, color0: [0.55, 0.55, 0.58, 0.55], color1: [0.9, 0.9, 0.92, 0] });
        }
      }
      this.items[write++] = p;
    }
    this.items.length = write;
    this.render();
  }

  /**
   * Gives a projectile kind a real mesh (one InstancedMesh per glTF primitive), oriented along the
   * velocity each frame. Model forward is -Z (glTF export of Blender +Y).
   *   missile    -> Blender rocket (assets/models/rocket.glb)
   *   shell      -> Blender grey turret bullet (assets/models/bullet.glb)
   *   cannonball -> round iron ball
   * @param {string} kind
   * @param {THREE.Object3D|null} model
   * @param {{scale?: number, spin?: boolean, max?: number}} [opts]
   */
  setModel(kind, model, { scale = 1, spin = false, roll = false, max = 96, emissive = 3, shadow = true } = {}) {
    if (!model) return;
    this.models ??= {};
    const meshes = [];
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      g.scale(scale, scale, scale);
      const m = o.material.clone();
      if (m.emissiveIntensity !== undefined && m.emissive?.getHex()) m.emissiveIntensity = emissive;
      const inst = new THREE.InstancedMesh(g, m, max);
      inst.count = 0;
      inst.castShadow = shadow;
      inst.frustumCulled = false;
      meshes.push(inst);
      this.scene.add(inst);
    });
    this.models[kind] = { meshes, spin, roll, max };
  }

  /** Back-compat: homing missiles use the Blender rocket. */
  setMissileModel(model) {
    this.setModel('missile', model, { scale: 1.25, max: 64 });
  }

  renderModels() {
    if (!this.models) return;
    for (const [kind, set] of Object.entries(this.models)) {
      let n = 0;
      for (const p of this.items) {
        if (p.kind !== kind || n >= set.max) continue;
        // Gem-tinted shots keep their coloured streak look.
        if (p.tint && (kind === 'plasma' || kind === 'nova')) continue;
        rocketQuat.setFromUnitVectors(FORWARD, rocketDir.copy(p.vel).normalize());
        if (set.spin) rocketQuat.multiply(spinQuat.setFromAxisAngle(SPIN_AXIS, p.life * 14 + p.seed));
        // Roll about the flight axis (plasma bolts: fins and rings turn).
        if (set.roll) rocketQuat.multiply(spinQuat.setFromAxisAngle(FORWARD, p.life * 11 + p.seed));
        rocketMat.compose(p.pos, rocketQuat, ONE);
        for (const m of set.meshes) m.setMatrixAt(n, rocketMat);
        n++;
      }
      for (const m of set.meshes) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
      }
    }
  }

  render() {
    this.renderModels();
    this.comets.begin();
    this.tracerBolts.begin();
    this.orbs.begin();
    this.tracerBodies.begin();
    this.glows.begin();
    this.streaks.begin();
    for (const p of this.items) {
      const v = p.vel;
      const x = p.pos.x;
      const y = p.pos.y;
      const z = p.pos.z;
      if (p.tint && (p.kind === 'tracer' || p.kind === 'plasma' || p.kind === 'nova')) {
        const c = p.tint;
        const big = (p.kind === 'plasma' ? 1.5 : p.kind === 'nova' ? 1.2 : 1) * (p.gem === 'red' ? 1.6 : 1) * (p.crit ? 1.3 : 1);
        if (p.gem === 'black') {
          // Obsidian bolt: dark core (normal blending) inside a violet halo; crits flare red.
          this.tracerBodies.push(x, y, z, 0.34 * big, 1.9 * big, 0.04, 0.03, 0.06, 1, 0, v.x, v.y, v.z);
          this.glows.push(x, y, z, 1.0 * big, 1.0 * big, p.crit ? 3 : 1.2, p.crit ? 0.4 : 0.6, p.crit ? 0.6 : 2.6, 1);
          continue;
        }
        if (p.gem === 'red') {
          // Power shot: fat flame bolt with a hot white core.
          this.streaks.push(x, y, z, 0.5 * big, 2.2 * big, 5, 1.6, 0.4, 1, 0, v.x, v.y, v.z);
          this.glows.push(x, y, z, 1.1 * big, 1.1 * big, 4, 1.2, 0.3, 1);
          this.glows.push(x, y, z, 0.4 * big, 0.4 * big, 5, 4, 3, 1);
          continue;
        }
        this.streaks.push(x, y, z, 0.42 * big, 1.9 * big, c.r * 4, c.g * 4, c.b * 4, 1, 0, v.x, v.y, v.z);
        this.glows.push(x, y, z, 0.95 * big, 0.95 * big, c.r * 3, c.g * 3, c.b * 3, 1);
        this.glows.push(x, y, z, 0.32 * big, 0.32 * big, 4, 4, 4, 1);
        continue;
      }
      switch (p.kind) {
        case 'plasma': {
          const pulse = 1 + Math.sin(p.life * 40 + p.seed) * 0.12;
          if (this.models?.plasma) {
            // 3D Blender bolt (plasma.glb) + a soft magenta halo for the bloom.
            this.glows.push(x, y, z, 1.25 * pulse, 1.25 * pulse, 1.2, 0.12, 1.1, 0.55);
          } else {
            this.glows.push(x, y, z, 1.6 * pulse, 1.6 * pulse, 1.4, 0.15, 1.3, 0.9);
            this.comets.push(x, y, z, 0.95, 3.0, 1.8, 1.8, 1.9, 1, 0, v.x, v.y, v.z);
          }
          break;
        }
        case 'tracer':
          this.tracerBolts.push(x, y, z, 0.3, 2.0, 2.6, 2.2, 1.8, 1, 0, v.x, v.y, v.z);
          this.glows.push(x, y, z, 0.7, 0.7, 2.6, 1.2, 0.3, 0.7);
          break;
        case 'rocket':
          this.streaks.push(x, y, z, 0.32, 1.2, 4.5, 3.2, 1.6, 1, 0, v.x, v.y, v.z);
          this.glows.push(x, y, z, 0.9, 0.9, 4, 2, 0.6, 1);
          break;
        case 'nova':
          if (this.models?.nova) this.glows.push(x, y, z, 0.8, 0.8, 0.4, 1.6, 2.6, 0.6);
          else {
            this.streaks.push(x, y, z, 0.42, 1.6, 1.2, 3.2, 4.2, 1, 0, v.x, v.y, v.z);
            this.glows.push(x, y, z, 0.9, 0.9, 0.6, 2.2, 3.4, 0.9);
          }
          break;
        case 'missile':
          if (!this.models?.missile) this.streaks.push(x, y, z, 0.22, 0.8, 4.5, 3.0, 1.4, 1, 0, v.x, v.y, v.z);
          this.glows.push(x, y, z, 0.6, 0.6, 4, 2, 0.5, 1);
          break;
        case 'cannonball':
          if (!this.models?.cannonball) this.glows.push(x, y, z, 1.0, 1.0, 1.2, 1.1, 1, 1);
          break;
        case 'shell':
          if (!this.models?.shell) this.glows.push(x, y, z, 0.95, 0.95, 4.5, 1.8, 0.4, 1);
          else this.streaks.push(x, y, z, 0.12, 0.9, 1.4, 1.3, 1.2, 0.5, 0, v.x, v.y, v.z);
          break;
        default:
          break;
      }
    }
    this.comets.end();
    this.tracerBolts.end();
    this.orbs.end();
    this.tracerBodies.end();
    this.glows.end();
    this.streaks.end();
  }

  clear() {
    this.items.length = 0;
    this.render();
  }
}

