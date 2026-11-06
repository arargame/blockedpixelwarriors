import * as THREE from 'three';
import { Palette } from '../config/Palette.js';
import { fxRandom as rnd } from '../util/Random.js';
import { createCanvas, canvasToTexture } from '../textures/CanvasUtils.js';

const v1 = new THREE.Vector3();

/** Glowing target ring under a hovering gem (the key art's pink halo), painted once. */
function ringTexture() {
  const S = 256;
  const c = createCanvas(S, S);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.35)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.06)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.fillRect(S / 2 + Math.cos(a) * S * 0.44 - 4, S / 2 + Math.sin(a) * S * 0.44 - 4, 8, 8);
  }
  return canvasToTexture(c, { srgb: false });
}

/**
 * Ammo gems (Blocked's ColorAmmoSupply): the Blender jewel (assets/models/gem.glb) in the colour
 * of the block it came out of. It pops out, settles hovering over the deck in front of the wall
 * inside a glowing ring (the key art's red gem), then homes on the tank: onCollect(colorKey).
 */
export class Gems {
  constructor(scene, effects, gltf) {
    this.scene = scene;
    this.effects = effects;
    this.items = [];
    this.onCollect = null;
    this.geometry = gltf?.scene.getObjectByName('Gem')?.geometry ?? new THREE.OctahedronGeometry(0.5, 0);
    this.materials = {};
    this.ringTex = ringTexture();
    this.ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  }

  material(color) {
    if (!this.materials[color]) {
      const c = new THREE.Color(Palette.blocks[color]);
      this.materials[color] = {
        gem: new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.9), emissive: c, emissiveIntensity: 0.9, roughness: 0.04, metalness: 0.45, flatShading: true, envMapIntensity: 3 }),
        ring: new THREE.MeshBasicMaterial({ map: this.ringTex, color: new THREE.Color(0xff3aa8).lerp(c, 0.35).multiplyScalar(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      };
    }
    return this.materials[color];
  }

  /** A gem of `color` out of a block at `at`, settling at (hoverX, hoverZ). */
  spawn(color, at, hoverX, hoverZ, { hover = 2.2, frozen = false } = {}) {
    const mats = this.material(color);
    const m = new THREE.Mesh(this.geometry, mats.gem);
    m.scale.setScalar(1.55);
    m.position.copy(at);
    m.castShadow = true;
    const ring = new THREE.Mesh(this.ringGeo, mats.ring);
    ring.position.set(hoverX, 0.03, hoverZ);
    ring.scale.setScalar(0.01);
    ring.renderOrder = 15;
    this.scene.add(m, ring);
    const g = { m, ring, color, age: 0, start: at.clone(), hover: new THREE.Vector3(hoverX, 1.0, hoverZ), hoverTime: hover, vel: new THREE.Vector3(), frozen };
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
      if (g.age < popT) {
        // Arc from the block to the hover spot.
        const t = g.age / popT;
        p.lerpVectors(g.start, g.hover, t);
        p.y += Math.sin(Math.PI * t) * 2.2;
      } else if (g.age < popT + g.hoverTime || g.frozen) {
        p.copy(g.hover);
        p.y += Math.sin(g.age * 3) * 0.12;
        g.ring.scale.setScalar(Math.min(2.6, g.ring.scale.x + dt * 9) || 2.6);
        g.ring.rotation.y += dt * 0.8;
        if (g.frozen) g.ring.scale.setScalar(2.6);
      } else {
        g.ring.scale.multiplyScalar(Math.exp(-dt * 8));
        v1.set(tankPos.x, tankPos.y + 1.4, tankPos.z).sub(p);
        const d = v1.length();
        const speed = 8 + (g.age - popT - g.hoverTime) * 24;
        g.vel.lerp(v1.multiplyScalar(speed / Math.max(d, 1e-3)), 1 - Math.exp(-6 * dt));
        p.addScaledVector(g.vel, dt);
        if (d < 1.2) {
          this.effects.sparkBurst(p, 18, 6, [3, 3, 3, 1]);
          this.effects.flash(p, Palette.blocks[g.color], 24, 0.25, 6);
          g.m.removeFromParent();
          g.ring.removeFromParent();
          this.items.splice(i, 1);
          this.onCollect?.(g.color);
          continue;
        }
      }
      // Upright jewel leaning back toward the camera (the key art's icon view), swaying.
      g.m.rotation.set(-0.7, Math.sin(g.age * 1.7) * 0.4, 0);
      if (!g.frozen && Math.random() < dt * 12) {
        this.effects.fire.emit({
          x: p.x + rnd.spread(0.35), y: p.y + rnd.spread(0.35), z: p.z + rnd.spread(0.3), vy: 0.4,
          life: rnd.range(0.25, 0.45), size0: 0.22, size1: 0.02, color0: [3, 2.6, 3, 1], color1: [1.5, 1, 1.8, 0],
        });
      }
    }
  }

  clear() {
    for (const g of this.items) {
      g.m.removeFromParent();
      g.ring.removeFromParent();
    }
    this.items.length = 0;
  }
}
