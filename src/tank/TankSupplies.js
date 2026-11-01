import * as THREE from 'three';
import { fxRandom as rnd } from '../util/Random.js';

const v1 = new THREE.Vector3();

/** Crate paint per supply letter (the Blender crate's paint is near-white and tinted). */
export const SUPPLY_COLORS = Object.freeze({ T: 0xff8a1e, D: 0x2f7ff0, R: 0xd8302a, H: 0x36b84a, G: 0x9a4ae0 });

const MAGNET_RADIUS = 6.5;
const MAGNET_ACCEL = 34;
const PICKUP_RADIUS = 2.6;
const LIFETIME = 18;
const SCALE = 1.4;

/**
 * Tank-level supplies: the Blender crate (assets/models/supply.glb, tools/blender/build_supply.py)
 * in the type's colour with its glowing letter, smaller than a block. A destroyed supply block
 * throws one up; it lands on the floor, bobs and sparkles, is pulled toward the tank when it comes
 * close and collected on contact. Unpicked crates blink and vanish after LIFETIME seconds.
 */
export class TankSupplies {
  /**
   * @param {THREE.Scene} scene
   * @param {any} effects
   * @param {any} gltf supply.glb
   * @param {(x:number, z:number) => number} floorAt
   */
  constructor(scene, effects, gltf, floorAt) {
    this.scene = scene;
    this.effects = effects;
    this.floorAt = floorAt;
    this.template = gltf?.scene.getObjectByName('SupplyCrate') ?? null;
    this.items = [];
    this.materials = {};
    /** (type, item) => void */
    this.onPickup = null;
    if (this.template) {
      this.template.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
    }
  }

  /** Paint material of a type (the crate's near-white paint times the type colour). */
  paint(type, base) {
    if (!this.materials[type]) {
      const m = base.clone();
      m.color = new THREE.Color(SUPPLY_COLORS[type] ?? 0xffffff);
      this.materials[type] = m;
    }
    return this.materials[type];
  }

  build(type) {
    if (!this.template) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.56, 0.64), new THREE.MeshStandardMaterial({ color: SUPPLY_COLORS[type] ?? 0xffffff, emissive: 0x222222 }));
      m.castShadow = true;
      return m;
    }
    const obj = this.template.clone(true);
    obj.traverse((o) => {
      if (o.name.startsWith('SupplyLetter')) o.visible = o.name === `SupplyLetter${type}`;
      if (o.isMesh && o.material?.name === 'SupplyPaint') o.material = this.paint(type, o.material);
    });
    return obj;
  }

  /** A crate of `type` thrown up out of a destroyed block at `at`. */
  spawn(type, at) {
    const obj = this.build(type);
    obj.scale.setScalar(SCALE);
    obj.position.copy(at);
    this.scene.add(obj);
    const item = {
      type, obj, age: 0, landed: false, pulled: false, spin: rnd.spread(0.6),
      vel: new THREE.Vector3(rnd.spread(1.5), 6.5, rnd.spread(1.5)), sparkle: 0,
    };
    this.items.push(item);
    this.effects.sparkBurst(at, 14, 5, [3, 2.6, 1.6, 1]);
    return item;
  }

  update(dt, tankPos, canPickup) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const p = it.obj.position;
      it.age += dt;
      const dx = tankPos.x - p.x;
      const dz = tankPos.z - p.z;
      const dist = Math.hypot(dx, dz);
      const floor = this.floorAt(p.x, p.z) + 0.33 * SCALE;
      if (canPickup && it.age > 0.4 && dist < MAGNET_RADIUS) {
        // Magnet: drawn toward the tank, hopping a little.
        it.pulled = true;
        it.landed = false;
        it.vel.x += (dx / Math.max(dist, 1e-3)) * MAGNET_ACCEL * dt;
        it.vel.z += (dz / Math.max(dist, 1e-3)) * MAGNET_ACCEL * dt;
        it.vel.multiplyScalar(Math.exp(-1.2 * dt));
        it.vel.y += ((tankPos.y + 1.6 - p.y) * 6 - it.vel.y) * Math.min(1, dt * 4);
        p.addScaledVector(it.vel, dt);
      } else if (!it.landed) {
        it.vel.y -= 16 * dt;
        it.vel.x *= Math.exp(-1.5 * dt);
        it.vel.z *= Math.exp(-1.5 * dt);
        p.addScaledVector(it.vel, dt);
        if (p.y <= floor && it.vel.y < 0) {
          p.y = floor;
          it.vel.set(0, 0, 0);
          it.landed = true;
          it.pulled = false;
          this.effects.snowPuff(v1.set(p.x, floor - 0.2, p.z), 5);
        }
      }
      const bob = it.landed ? Math.sin(it.age * 3) * 0.12 + 0.12 : 0;
      it.obj.position.y = it.landed ? floor + bob : p.y;
      it.obj.rotation.set(it.landed ? 0 : Math.sin(it.age * 5) * 0.3, it.spin + Math.sin(it.age * 1.4) * 0.35, it.landed ? 0 : Math.cos(it.age * 4) * 0.2);
      // Sparkles round the glowing letter.
      it.sparkle -= dt;
      if (it.sparkle <= 0) {
        it.sparkle = 0.12;
        this.effects.fire.emit({
          x: p.x + rnd.spread(0.6), y: it.obj.position.y + 0.4, z: p.z + rnd.spread(0.5), vy: rnd.range(0.6, 1.4),
          life: rnd.range(0.4, 0.7), size0: 0.28, size1: 0.02, color0: [3, 2.7, 1.8, 1], color1: [1.5, 1, 0.4, 0],
        });
      }
      const left = LIFETIME - it.age;
      it.obj.visible = it.pulled || left > 4 || Math.floor(left * 8) % 2 === 0;
      if (canPickup && dist < PICKUP_RADIUS && Math.abs(it.obj.position.y - tankPos.y - 1) < 3) {
        this.effects.sparkBurst(it.obj.position, 26, 7, [3, 3, 3, 1]);
        this.effects.flash(it.obj.position, SUPPLY_COLORS[it.type] ?? 0xffffff, 30, 0.3, 6);
        it.obj.removeFromParent();
        this.items.splice(i, 1);
        this.onPickup?.(it.type, it);
      } else if (left <= 0 && !it.pulled) {
        it.obj.removeFromParent();
        this.items.splice(i, 1);
      }
    }
  }

  clear() {
    for (const it of this.items) it.obj.removeFromParent();
    this.items.length = 0;
  }
}
