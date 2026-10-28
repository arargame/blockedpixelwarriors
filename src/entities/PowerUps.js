import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { createCanvas, canvasToTexture } from '../textures/CanvasUtils.js';
import { VoxelModelBuilder } from '../util/VoxelModelBuilder.js';

/**
 * Supply catalogue. Every entry is part of the drop pool and types are picked uniformly
 * (5 types = 20% each). `timed` supplies run for 8-15 s and appear in the skill feed;
 * the others act instantly.
 */
export const POWERUPS = Object.freeze({
  T: { name: 'TRIPLE FIRE', css: '#ffd23f', color: 0xf2c230, timed: true },
  D: { name: '8-WAY BURST', css: '#4fd8ff', color: 0x27b9e0, timed: true },
  R: { name: 'HOMING ROCKETS', css: '#ff6a4a', color: 0xe0442a, timed: true },
  H: { name: 'REPAIR KIT', css: '#ff4d5e', color: 0xe8303c, timed: false },
  G: { name: 'GEM POWER', css: '#ffffff', color: 0xffffff, timed: true },
});

/**
 * Gems (Blocked's colour ammo). While a gem is active every shot takes its colour and effect:
 *   blue   RAPID FIRE  - guns fire twice as fast
 *   green  ACID        - hit blocks turn green and melt: they lose HP every second
 *   red    POWER SHOT  - heavy fiery bolts (x2.5 damage)
 *   black  CRITICAL    - 20% of shots crit for x3 damage with a "CRITICAL!" pop-up
 * They only drop from blocks once the GEM MINE card is taken.
 */
export const GEMS = Object.freeze({
  blue: { name: 'RAPID FIRE', color: 0x3f8cff, css: '#5ab8ff', glow: 0x4f9cff, damageMul: 1.2, rateMul: 2 },
  green: { name: 'ACID', color: 0x55e04a, css: '#7be86a', glow: 0x62e153, damageMul: 1, rateMul: 1, acid: true },
  red: { name: 'POWER SHOT', color: 0xf43745, css: '#ff6b6b', glow: 0xff4a3a, damageMul: 2.5, rateMul: 1, power: true },
  black: { name: 'CRITICAL', color: 0x1c1a22, css: '#c9b8ff', glow: 0x8a6cff, damageMul: 1.5, rateMul: 1, critChance: 0.2, critMul: 3 },
});
export const GEM_KINDS = Object.freeze(Object.keys(GEMS));
/** @deprecated kept for older call sites: gem body colours. */
export const GEM_COLORS = Object.freeze(GEM_KINDS.map((k) => GEMS[k].color));

const cssOf = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

/**
 * Active timed power-ups. Each pickup lasts a random 8-15 s; picking up the same type again
 * restarts it with a fresh duration. Different types stack. The gem stores its colour.
 */
export class PowerUpSystem {
  constructor() {
    /** @type {Map<string, {remaining:number, duration:number, color?:number, css?:string}>} */
    this.active = new Map();
  }

  activate(type, duration = null, extra = {}) {
    const cfg = GameConfig.supply;
    const d = duration ?? cfg.durationMin + Math.random() * (cfg.durationMax - cfg.durationMin);
    this.active.set(type, { remaining: d, duration: d, ...extra });
  }

  has(type) {
    return this.active.has(type);
  }

  /** Current gem tint (THREE.Color hex) or null. */
  get gemColor() {
    return this.active.get('G')?.color ?? null;
  }

  /** Active gem definition (GEMS entry + kind) or null. */
  get gem() {
    const g = this.active.get('G');
    return g?.gem ? { kind: g.gem, ...GEMS[g.gem] } : null;
  }

  update(dt) {
    for (const [type, p] of this.active) {
      p.remaining -= dt;
      if (p.remaining <= 0) this.active.delete(type);
    }
  }

  clear() {
    this.active.clear();
  }
}

const tmp = new THREE.Vector3();
const toHeli = new THREE.Vector3();

/**
 * Supply drops: letter crates (T/D/R), a 3D first-aid kit (H) and a faceted gem (G).
 * They pop out of a destroyed block, drop to the floor and hover. Within the magnet radius
 * they are pulled toward the helicopter like in Blocked: constant acceleration toward the
 * player + light damping, so they curve in on a short orbit rather than snapping.
 */
export class SupplyCrates {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../fx/EffectsManager.js').EffectsManager} effects
   * @param {import('../textures/TextureFactory.js').TextureFactory} textures
   * @param {import('../textures/MaterialLibrary.js').MaterialLibrary} materials
   */
  constructor(scene, effects, textures, materials) {
    this.scene = scene;
    this.effects = effects;
    this.items = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.crateGeometry = new THREE.BoxGeometry(0.85, 0.85, 0.85);
    this.crateMaterials = {};
    for (const type of ['T', 'D', 'R']) {
      const def = POWERUPS[type];
      const map = letterTexture(type, def.css);
      this.crateMaterials[type] = new THREE.MeshStandardMaterial({
        map, roughness: 0.45, metalness: 0.1, emissive: new THREE.Color(def.color), emissiveMap: map, emissiveIntensity: 0.12,
      });
    }
    this.firstAid = buildFirstAidKit(materials);
    this.gemGeometry = buildGemGeometry();
    this.glowMaterial = new THREE.SpriteMaterial({ map: textures.glow(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    /** @type {(type: string, item: any) => void} */
    this.onPickup = null;
  }

  /**
   * Spawns a supply of a uniformly random type (used when a supply block is destroyed).
   * Gems (G) and homing rockets (R) only join the pool with the GEM MINE / HOMING ROCKETS cards.
   */
  spawnRandom(position, { gems = true, homing = true } = {}) {
    const types = Object.keys(POWERUPS).filter((t) => (gems || t !== 'G') && (homing || t !== 'R'));
    return this.spawn(types[Math.floor(Math.random() * types.length)], position);
  }

  spawn(type, position, gemKind = null) {
    let gem = null;
    let mesh;
    let color = POWERUPS[type].color;
    if (type === 'H') {
      mesh = this.firstAid.clone();
    } else if (type === 'G') {
      gem = gemKind ?? GEM_KINDS[Math.floor(Math.random() * GEM_KINDS.length)];
      const def = GEMS[gem];
      color = def.color;
      const black = gem === 'black';
      mesh = new THREE.Mesh(this.gemGeometry, new THREE.MeshPhysicalMaterial({
        color, emissive: black ? 0x3a2a66 : color, emissiveIntensity: black ? 0.5 : 0.18, roughness: 0.04, metalness: black ? 0.6 : 0.35,
        clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: black ? 3 : 2.2, flatShading: true,
      }));
      mesh.scale.set(0.62, 1.25, 0.62);
    } else {
      mesh = new THREE.Mesh(this.crateGeometry, this.crateMaterials[type]);
    }
    mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const glow = new THREE.Sprite(this.glowMaterial.clone());
    glow.material.color.set(gem ? GEMS[gem].glow : color).multiplyScalar(type === 'G' ? 1.1 : 1.4);
    glow.scale.setScalar(type === 'G' ? 2.6 : 2.2);
    const item = {
      type, mesh, glow, color, gem,
      pos: position.clone(),
      vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, 5.5, (Math.random() - 0.5) * 1.5),
      landed: false, pulled: false, age: 0, spin: Math.random() * 6,
    };
    this.group.add(mesh, glow);
    this.items.push(item);
    return item;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} heliPos
   * @param {boolean} canPickup
   */
  update(dt, heliPos, canPickup) {
    const cfg = GameConfig.supply;
    const hover = 0.62;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      toHeli.subVectors(heliPos, it.pos);
      const dist = toHeli.length();
      const inField = canPickup && it.age > 0.35 && dist < cfg.magnetRadius;
      if (inField) {
        // Magnet (Blocked): constant pull toward the player, light damping -> short orbit.
        it.pulled = true;
        it.landed = false;
        it.vel.addScaledVector(toHeli.divideScalar(Math.max(dist, 1e-3)), cfg.magnetAccel * dt);
        it.vel.multiplyScalar(Math.exp(-cfg.magnetDamping * dt));
        it.pos.addScaledVector(it.vel, dt);
      } else if (!it.landed) {
        it.vel.y -= 16 * dt;
        it.vel.x *= Math.exp(-2 * dt);
        it.vel.z *= Math.exp(-2 * dt);
        it.pos.addScaledVector(it.vel, dt);
        if (it.pos.y <= hover && it.vel.y < 0) {
          it.pos.y = hover;
          it.vel.set(0, 0, 0);
          it.landed = true;
          it.pulled = false;
          this.effects.snowPuff(tmp.set(it.pos.x, 0.2, it.pos.z), 4);
        }
      }
      const bob = it.landed ? Math.sin(it.age * 3) * 0.12 : 0;
      it.spin += dt * (it.pulled ? 6 : 1.6);
      it.mesh.position.set(it.pos.x, it.pos.y + bob, it.pos.z);
      it.mesh.rotation.set(it.type === 'G' ? 0.3 : 0.35, it.spin, it.type === 'G' ? 0 : 0.2);
      it.glow.position.copy(it.mesh.position);
      it.glow.material.opacity = (0.55 + Math.sin(it.age * 6) * 0.2) * (it.type === 'G' ? 0.35 : 1);
      // Glow sits under the supply so it halos the floor instead of washing out the model.
      it.glow.position.y = 0.25;
      // Magnet trail sparkles.
      if (it.pulled && Math.random() < 0.6) {
        const c = new THREE.Color(it.gem ? GEMS[it.gem].glow : it.color);
        this.effects.fire.emit({ x: it.pos.x, y: it.pos.y, z: it.pos.z, life: 0.25, size0: 0.35, size1: 0.05, color0: [c.r * 3, c.g * 3, c.b * 3, 1], color1: [c.r, c.g, c.b, 0] });
      }
      // Blink during the last seconds (not while being pulled in).
      const left = cfg.crateLifetime - it.age;
      it.mesh.visible = it.pulled || left > 4 || Math.floor(left * 8) % 2 === 0;
      if (canPickup && dist < cfg.pickupRadius) {
        this.effects.sparkBurst(it.mesh.position, 26, 7, [3, 3, 3, 1]);
        this.effects.flash(it.mesh.position, it.color, 30, 0.3, 6);
        this.onPickup?.(it.type, it);
        this.remove(i);
      } else if (left <= 0 && !it.pulled) {
        this.remove(i);
      }
    }
  }

  remove(i) {
    const it = this.items[i];
    this.group.remove(it.mesh, it.glow);
    it.glow.material.dispose();
    if (it.type === 'G') it.mesh.material.dispose();
    this.items.splice(i, 1);
  }
}

/** Crate face: coloured voxel panel with bevelled rim and a big white letter. */
function letterTexture(letter, css) {
  const S = 128;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, 0, S, 10);
  ctx.fillRect(0, 0, 10, S);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, S - 10, S, 10);
  ctx.fillRect(S - 10, 0, 10, S);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, S - 28, S - 28);
  ctx.font = '900 84px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#1b1d21';
  ctx.strokeText(letter, S / 2, S / 2 + 4);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(letter, S / 2, S / 2 + 4);
  return canvasToTexture(canvas, { srgb: true });
}

/**
 * Blocked's first-aid kit in 3D: glossy red case with a seam line, raised white cross on
 * both faces and a grey carry handle.
 */
function buildFirstAidKit(materials) {
  const b = new VoxelModelBuilder({ bevel: 0.07, segments: 3 });
  b.box([0, 0, 0], [1.0, 0.72, 0.42], 0xd8222c);
  b.box([0, 0, 0], [1.03, 0.04, 0.45], 0x8c1218, { bevel: 0.01 });
  for (const z of [0.215, -0.215]) {
    b.box([0, 0.02, z], [0.36, 0.11, 0.03], 0xffffff, { bevel: 0.012 });
    b.box([0, 0.02, z], [0.11, 0.36, 0.03], 0xffffff, { bevel: 0.012 });
  }
  b.box([-0.26, 0.47, 0], [0.07, 0.22, 0.09], 0x8d9096, { bevel: 0.025 });
  b.box([0.26, 0.47, 0], [0.07, 0.22, 0.09], 0x8d9096, { bevel: 0.025 });
  b.box([0, 0.57, 0], [0.6, 0.07, 0.09], 0x9ea2a8, { bevel: 0.025 });
  const material = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12 });
  const group = b.buildGroup({ body: material });
  group.scale.setScalar(0.95);
  return group;
}

/** Octagonal crystal (Blocked Pixel Panzer 3D Mesh3D.CreateGem): pavilion, girdle, crown. */
function buildGemGeometry() {
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a0 = (Math.PI * 2 * i) / N;
    const a1 = (Math.PI * 2 * (i + 1)) / N;
    const ring = (a) => [Math.cos(a) * 0.5, 0.04, Math.sin(a) * 0.5];
    const crown = (a) => [Math.cos(a) * 0.27, 0.32, Math.sin(a) * 0.27];
    tri([0, -0.5, 0], ring(a1), ring(a0));
    tri(ring(a0), ring(a1), crown(a1));
    tri(ring(a0), crown(a1), crown(a0));
    tri(crown(a0), crown(a1), [0, 0.5, 0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export { cssOf };
