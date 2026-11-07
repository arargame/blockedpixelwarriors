import * as THREE from 'three';
import { fxRandom as rnd } from '../util/Random.js';
import { POWERUPS, letterTexture } from '../entities/PowerUps.js';

const v1 = new THREE.Vector3();

/**
 * Crate colour per supply letter: the helicopter level's letter crates (POWERUPS css / colour),
 * plus NEON RAIN's B (bouncing balls), in its neon pink.
 */
const CRATE_CSS = Object.freeze({ ...Object.fromEntries(Object.entries(POWERUPS).map(([k, d]) => [k, d.css])), B: '#ff7ad9' });
export const SUPPLY_COLORS = Object.freeze({ ...Object.fromEntries(Object.entries(POWERUPS).map(([k, d]) => [k, d.color])), B: 0xf04fc4 });

const MAGNET_RADIUS = 6.5;
const MAGNET_ACCEL = 34;
const PICKUP_RADIUS = 2.6;
const LIFETIME = 18;
const SCALE = 1.4;
const CRATE = 0.85;

/**
 * Tank-level supplies: the helicopter level's crates (entities/PowerUps.js SupplyCrates - a
 * coloured voxel box with a bevelled rim and the big white letter on every face), smaller than a
 * block. A destroyed supply block throws one up; it lands on the floor, bobs and sparkles, is
 * pulled toward the tank when it comes close and collected on contact. Unpicked crates blink and
 * vanish after LIFETIME seconds.
 */
export class TankSupplies {
  /**
   * @param {THREE.Scene} scene
   * @param {any} effects
   * @param {any} _gltf unused (the old Blender crate); kept so call sites stay the same
   * @param {(x:number, z:number) => number} floorAt
   * @param {{ scale?: number, magnetRadius?: number, pickupRadius?: number, glow?: number, puff?: boolean }} [o]
   *   sizes for smaller boards (the NEON RAIN tray); defaults are the tank arena's. `glow`: the
   *   letter's emissive strength (the heli level's 0.12; a dark scene wants more); `puff`: a dust puff
   *   where a crate lands
   */
  constructor(scene, effects, _gltf, floorAt, { scale = SCALE, magnetRadius = MAGNET_RADIUS, pickupRadius = PICKUP_RADIUS, glow = 0.12, puff = true } = {}) {
    this.puff = puff;
    this.scale = scale;
    this.magnetRadius = magnetRadius;
    this.pickupRadius = pickupRadius;
    this.glow = glow;
    this.scene = scene;
    this.effects = effects;
    this.floorAt = floorAt;
    this.geometry = new THREE.BoxGeometry(CRATE, CRATE, CRATE);
    this.items = [];
    this.materials = {};
    /** (type, item) => void */
    this.onPickup = null;
  }

  /** The letter crate material of a type (made once, shared). */
  material(type) {
    if (!this.materials[type]) {
      const map = letterTexture(type, CRATE_CSS[type] ?? '#cccccc');
      this.materials[type] = new THREE.MeshStandardMaterial({
        map, roughness: 0.45, metalness: 0.1, emissive: new THREE.Color(SUPPLY_COLORS[type] ?? 0xffffff), emissiveMap: map, emissiveIntensity: this.glow,
      });
    }
    return this.materials[type];
  }

  build(type) {
    const m = new THREE.Mesh(this.geometry, this.material(type));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /** A crate of `type` thrown up out of a destroyed block at `at`. */
  spawn(type, at) {
    const obj = this.build(type);
    obj.scale.setScalar(this.scale);
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
      const floor = this.floorAt(p.x, p.z) + (CRATE / 2) * this.scale;
      if (canPickup && it.age > 0.4 && dist < this.magnetRadius) {
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
          if (this.puff) this.effects.snowPuff(v1.set(p.x, floor - 0.2, p.z), 5);
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
      if (canPickup && dist < this.pickupRadius && Math.abs(it.obj.position.y - tankPos.y - 1) < 3) {
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
