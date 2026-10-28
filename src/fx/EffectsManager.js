import * as THREE from 'three';
import { ParticleSystem } from './ParticleSystem.js';
import { DebrisSystem } from './DebrisSystem.js';
import { fxRandom as rnd } from '../util/Random.js';

const v = new THREE.Vector3();
const c = new THREE.Color();

/**
 * Facade over every visual effect system (particles, debris, flash lights).
 * Gameplay code only calls intent-level methods such as explosion() or muzzleFlash().
 */
export class EffectsManager {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../textures/TextureFactory.js').TextureFactory} textures
   * @param {THREE.Material} debrisMaterial
   * @param {(x:number,z:number)=>number|null} groundHeightAt
   * @param {{ flashLights?: number }} [options]
   */
  constructor(scene, textures, debrisMaterial, groundHeightAt, options = {}) {
    this.smoke = new ParticleSystem(textures.smokePuff(), 2000, { additive: false, renderOrder: 11 });
    this.fire = new ParticleSystem(textures.glow(), 1400, { additive: true, renderOrder: 12 });
    this.sparks = new ParticleSystem(textures.streak(), 1200, { additive: true, renderOrder: 13 });
    this.fireballs = new ParticleSystem(textures.fireball(), 500, { additive: false, renderOrder: 12 });
    this.debris = new DebrisSystem(debrisMaterial, 420, groundHeightAt);
    for (const s of [this.smoke, this.fireballs, this.fire, this.sparks]) scene.add(s.object3d);
    scene.add(this.debris.mesh);

    this.lights = [];
    const lightCount = options.flashLights ?? 4;
    for (let i = 0; i < lightCount; i++) {
      const light = new THREE.PointLight(0xffa040, 0, 9, 1.6);
      light.layers.enableAll();
      scene.add(light);
      this.lights.push({ light, life: 0, maxLife: 1, peak: 0 });
    }
    this.nextLight = 0;
  }

  update(dt) {
    this.smoke.update(dt);
    this.fireballs.update(dt);
    this.fire.update(dt);
    this.sparks.update(dt);
    this.debris.update(dt);
    for (const l of this.lights) {
      if (l.life < l.maxLife) {
        l.life += dt;
        const t = Math.min(1, l.life / l.maxLife);
        l.light.intensity = l.peak * (1 - t) * (1 - t);
      } else {
        l.light.intensity = 0;
      }
    }
  }

  flash(position, color = 0xffa040, intensity = 60, duration = 0.35, distance = 9) {
    if (this.lights.length === 0) return;
    const l = this.lights[this.nextLight];
    this.nextLight = (this.nextLight + 1) % this.lights.length;
    l.light.position.copy(position);
    l.light.color.set(color);
    l.light.distance = distance;
    l.peak = intensity;
    l.life = 0;
    l.maxLife = duration;
  }

  /** Big fiery explosion with smoke, sparks and an optional voxel debris burst. */
  explosion(position, scale = 1, debrisColor = null, debrisCount = 0) {
    const p = position;
    for (let i = 0; i < 14 * scale; i++) {
      v.set(rnd.spread(1), rnd.range(0.2, 1), rnd.spread(1)).normalize().multiplyScalar(rnd.range(1, 4.5) * scale);
      this.fireballs.emit({
        x: p.x + rnd.spread(0.3 * scale), y: p.y + rnd.spread(0.3 * scale), z: p.z + rnd.spread(0.3 * scale),
        vx: v.x, vy: v.y, vz: v.z, drag: 3,
        life: rnd.range(0.4, 0.8), size0: rnd.range(1.3, 2.2) * scale, size1: rnd.range(2.6, 4.0) * scale,
        color0: [2.4, 2.1, 1.9, 1], color1: [0.9, 0.5, 0.35, 0], rotVel: rnd.spread(2),
      });
    }
    this.fire.emit({ x: p.x, y: p.y, z: p.z, life: 0.16, size0: 2.2 * scale, size1: 4.4 * scale, color0: [2.6, 1.8, 0.9, 1], color1: [1.4, 0.5, 0.1, 0] });
    for (let i = 0; i < 12 * scale; i++) {
      this.smoke.emit({
        x: p.x + rnd.spread(0.6 * scale), y: p.y + rnd.range(0, 0.6), z: p.z + rnd.spread(0.6 * scale),
        vx: rnd.spread(1.2), vy: rnd.range(1.2, 2.6), vz: rnd.spread(1.2), drag: 1.2,
        life: rnd.range(1.2, 2.2), size0: rnd.range(0.8, 1.3) * scale, size1: rnd.range(2.4, 3.6) * scale,
        color0: [0.2, 0.19, 0.18, 0.9], color1: [0.55, 0.55, 0.57, 0], rotVel: rnd.spread(0.8),
      });
    }
    this.sparkBurst(p, 22 * scale, 13 * scale, [4, 2.4, 0.8, 1]);
    if (debrisColor !== null && debrisCount > 0) this.shatter(p, debrisColor, debrisCount, 1);
    this.flash(p, 0xff9a3c, 45 * scale, 0.45, 9 * scale);
  }

  sparkBurst(position, count, speed, color = [4, 2.6, 0.9, 1]) {
    for (let i = 0; i < count; i++) {
      v.set(rnd.spread(1), rnd.range(-0.2, 1), rnd.spread(1)).normalize().multiplyScalar(rnd.range(0.35, 1) * speed);
      this.sparks.emit({
        x: position.x, y: position.y, z: position.z, vx: v.x, vy: v.y, vz: v.z,
        gravity: 14, drag: 1.5, life: rnd.range(0.25, 0.6), size0: 0.11, size1: 0.05, aspect: 2, stretch: 0.045,
        color0: color, color1: [color[0] * 0.6, color[1] * 0.3, color[2] * 0.1, 0],
      });
    }
  }

  /** Voxel chunks flying off a block/cargo of a given color. */
  shatter(position, color, count, power = 1, sizeRange = [0.18, 0.42]) {
    for (let i = 0; i < count; i++) {
      v.set(rnd.spread(1), rnd.range(0.4, 1.3), rnd.spread(1)).multiplyScalar(rnd.range(3, 8) * power);
      c.set(color).multiplyScalar(rnd.range(1.1, 1.45));
      this.debris.spawn({
        position: v.clone().multiplyScalar(0.04).add(position),
        velocity: v,
        size: rnd.range(sizeRange[0], sizeRange[1]),
        color: c,
        life: rnd.range(2.5, 4.5),
      });
    }
  }

  /** Short muzzle flash at a barrel tip. */
  muzzleFlash(position, direction, color = [4, 2.6, 0.9, 1], size = 0.7) {
    this.fire.emit({ x: position.x, y: position.y, z: position.z, life: 0.07, size0: size, size1: size * 1.6, color0: color, color1: [color[0], color[1] * 0.5, color[2] * 0.2, 0] });
    this.sparks.emit({
      x: position.x, y: position.y, z: position.z, vx: direction.x * 12, vy: direction.y * 12, vz: direction.z * 12,
      life: 0.06, size0: size * 0.8, size1: size * 0.5, aspect: 1.5, stretch: 0.06, color0: color, color1: [color[0], color[1], color[2], 0],
    });
  }

  /** Small impact: sparks + puff, no debris. */
  impact(position, tint = [4, 2.4, 0.8, 1]) {
    this.sparkBurst(position, 7, 7, tint);
    this.fire.emit({ x: position.x, y: position.y, z: position.z, life: 0.14, size0: 0.6, size1: 1.3, color0: tint, color1: [tint[0] * 0.4, tint[1] * 0.2, tint[2] * 0.1, 0] });
  }

  /** Puffs of chimney smoke (called continuously by the locomotive). */
  chimneySmoke(position, intensity = 1) {
    this.smoke.emit({
      x: position.x + rnd.spread(0.1), y: position.y, z: position.z + rnd.spread(0.1),
      vx: rnd.spread(0.5), vy: rnd.range(2.4, 3.6) * intensity, vz: rnd.range(-1.6, -0.6), drag: 0.45,
      life: rnd.range(3.6, 5.2), size0: rnd.range(1.2, 1.8), size1: rnd.range(8, 12),
      color0: [0.3, 0.3, 0.31, 1], color1: [0.86, 0.86, 0.88, 0], rotVel: rnd.spread(0.6),
    });
  }

  /** White powder puff (snow knocked off blocks). */
  snowPuff(position, amount = 6) {
    for (let i = 0; i < amount; i++) {
      this.smoke.emit({
        x: position.x + rnd.spread(0.4), y: position.y + rnd.spread(0.2), z: position.z + rnd.spread(0.4),
        vx: rnd.spread(1.5), vy: rnd.range(0.5, 2), vz: rnd.spread(1.5), drag: 2, gravity: 0.6,
        life: rnd.range(0.6, 1.1), size0: 0.4, size1: rnd.range(1.0, 1.6), color0: [1.3, 1.35, 1.4, 0.9], color1: [1.2, 1.25, 1.3, 0],
      });
    }
  }
}
