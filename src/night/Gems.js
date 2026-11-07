import * as THREE from 'three';
import { GEMS, buildGemGeometry } from '../entities/PowerUps.js';
import { fxRandom as rnd } from '../util/Random.js';

const v1 = new THREE.Vector3();
// The heli level's gem, a touch bigger for the night tray's 1.5-unit blocks.
const GEM_SCALE = new THREE.Vector3(0.62, 1.25, 0.62).multiplyScalar(1.1);

/**
 * Ammo gems (Blocked's ColorAmmoSupply) - the very gems of the helicopter level
 * (entities/PowerUps.js: the octagonal crystal, its glossy faceted material and its soft glow
 * sprite, in GEMS' colours). It pops out of a block, hovers over the deck, then homes on the
 * tank: onCollect(colorKey).
 */
export class Gems {
  constructor(scene, effects, textures) {
    this.scene = scene;
    this.effects = effects;
    this.items = [];
    this.onCollect = null;
    this.geometry = buildGemGeometry();
    this.glowTex = textures?.glow?.() ?? null;
    this.materials = {};
  }

  material(color) {
    if (!this.materials[color]) {
      const def = GEMS[color] ?? GEMS.blue;
      const black = color === 'black';
      this.materials[color] = {
        // Exactly the heli gem's material (SupplyCrates.spawn 'G').
        gem: new THREE.MeshPhysicalMaterial({
          color: def.color, emissive: black ? 0x3a2a66 : def.color, emissiveIntensity: black ? 0.5 : 0.18, roughness: 0.04, metalness: black ? 0.6 : 0.35,
          clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: black ? 3 : 2.2, flatShading: true,
        }),
        glow: new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color(def.glow).multiplyScalar(1.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }),
        hex: def.glow,
      };
    }
    return this.materials[color];
  }

  /** A gem of `color` out of a block at `at`, settling at (hoverX, hoverZ). */
  spawn(color, at, hoverX, hoverZ, { hover = 2.2, frozen = false } = {}) {
    const mats = this.material(color);
    const m = new THREE.Mesh(this.geometry, mats.gem);
    m.scale.copy(GEM_SCALE);
    m.position.copy(at);
    m.castShadow = true;
    const glow = new THREE.Sprite(mats.glow);
    glow.scale.setScalar(2.8);
    glow.renderOrder = 14;
    this.scene.add(m, glow);
    const g = { m, glow, color, age: 0, start: at.clone(), hover: new THREE.Vector3(hoverX, 1.0, hoverZ), hoverTime: hover, vel: new THREE.Vector3(), frozen, spin: rnd.next() * 6 };
    if (frozen) {
      g.age = 0.6;
      m.position.copy(g.hover);
    }
    this.items.push(g);
    if (!frozen) this.effects.sparkBurst(at, 10, 4, [3, 3, 3, 1]);
    return g;
  }

  update(dt, tankPos) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const g = this.items[i];
      g.age += g.frozen ? 0 : dt;
      const p = g.m.position;
      const popT = 0.6;
      let pulled = false;
      if (g.age < popT) {
        // Arc from the block to the hover spot.
        const t = g.age / popT;
        p.lerpVectors(g.start, g.hover, t);
        p.y += Math.sin(Math.PI * t) * 2.2;
      } else if (g.age < popT + g.hoverTime || g.frozen) {
        p.copy(g.hover);
        p.y += Math.sin(g.age * 3) * 0.12;
      } else {
        pulled = true;
        v1.set(tankPos.x, tankPos.y + 1.4, tankPos.z).sub(p);
        const d = v1.length();
        const speed = 8 + (g.age - popT - g.hoverTime) * 24;
        g.vel.lerp(v1.multiplyScalar(speed / Math.max(d, 1e-3)), 1 - Math.exp(-6 * dt));
        p.addScaledVector(g.vel, dt);
        if (d < 1.2) {
          this.effects.sparkBurst(p, 18, 6, [3, 3, 3, 1]);
          this.effects.flash(p, this.material(g.color).hex, 24, 0.25, 6);
          g.m.removeFromParent();
          g.glow.removeFromParent();
          this.items.splice(i, 1);
          this.onCollect?.(g.color);
          continue;
        }
      }
      // The heli gem's turn: tipped 0.3 rad, spinning about its axis (faster when pulled in).
      if (!g.frozen) g.spin += dt * (pulled ? 6 : 1.6);
      g.m.rotation.set(0.3, g.spin, 0);
      g.glow.position.copy(p);
      g.glow.material.opacity = 0.45 + Math.sin(g.age * 6) * 0.12;
      // Magnet trail sparkles, in the gem's glow colour.
      if (pulled && Math.random() < 0.6) {
        const c = g.glow.material.color;
        this.effects.fire.emit({ x: p.x, y: p.y, z: p.z, life: 0.25, size0: 0.35, size1: 0.05, color0: [c.r * 3, c.g * 3, c.b * 3, 1], color1: [c.r, c.g, c.b, 0] });
      }
    }
  }

  clear() {
    for (const g of this.items) {
      g.m.removeFromParent();
      g.glow.removeFromParent();
    }
    this.items.length = 0;
  }
}
