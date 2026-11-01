import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GameConfig } from '../config/GameConfig.js';
import { Palette, BLOCK_COLOR_KEYS } from '../config/Palette.js';
import { fxRandom as rnd } from '../util/Random.js';
import { armorTexture, supplyTexture } from '../entities/BlockField.js';

const dummy = new THREE.Object3D();
const tmp = new THREE.Vector3();
const white = new THREE.Color(1, 1, 1);
const MAX = 520;

/**
 * Blocks sliding down the channel lanes (grid + push, Blocked Pixel Panzer style):
 *   - every block sits in a lane (x fixed) and slides toward the dam at one constant speed;
 *   - a block never overlaps the one in front of it: a block landing on a lane pushes the ones
 *     below it down, and a block held up (by the tank pinned at the bottom) holds up the line;
 *   - the tank is pushed by the blocks touching it;
 *   - destroyed blocks blow up their same-coloured neighbours (same lane back to back, or side
 *     by side in the next lane), one after another;
 *   - types: weak (1 hit, lighter), normal, strong (steel cage), supply (star, drops a power-up).
 * Blocks passing the dam lip are handed to onDrain. Rendering: one instanced mesh per colour +
 * the cage / star overlays.
 */
export class BlockFlow {
  constructor(materials, effects, arena) {
    const A = GameConfig.tankArena;
    this.effects = effects;
    this.arena = arena;
    this.size = A.block;
    this.lanes = Array.from({ length: A.lanes }, () => []);
    this.airborne = [];
    this.chain = [];
    this.group = new THREE.Group();
    const geo = new RoundedBoxGeometry(1, 1, 1, 3, 0.07);
    this.meshes = {};
    for (const key of BLOCK_COLOR_KEYS) {
      const m = new THREE.InstancedMesh(geo, materials.block(key), MAX);
      this.prep(m, true);
      for (let i = 0; i < MAX; i++) m.setColorAt(i, white);
      this.meshes[key] = m;
    }
    const overlay = new THREE.BoxGeometry(1.012, 1.012, 1.012);
    this.cage = this.prep(new THREE.InstancedMesh(overlay, new THREE.MeshStandardMaterial({ map: armorTexture(), transparent: true, alphaTest: 0.4, roughness: 0.35, metalness: 0.75, envMapIntensity: 1.4 }), MAX), true);
    const star = supplyTexture();
    this.star = this.prep(new THREE.InstancedMesh(overlay, new THREE.MeshStandardMaterial({ map: star, emissiveMap: star, emissive: new THREE.Color(1, 0.85, 0.4), emissiveIntensity: 0.9, transparent: true, alphaTest: 0.3, roughness: 0.3, metalness: 0.4 }), MAX), false);
    this.onDrain = null;
    this.onDestroyed = null;
    /** (block) => residual push the tank could not take (the block is held back by it). */
    this.resolveTank = null;
    this.reset();
  }

  prep(m, cast) {
    m.castShadow = cast;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    this.group.add(m);
    return m;
  }

  reset() {
    for (const l of this.lanes) l.length = 0;
    this.airborne.length = 0;
    this.chain.length = 0;
  }

  laneX(i) {
    const A = GameConfig.tankArena;
    return (i - (A.lanes - 1) / 2) * A.block;
  }

  laneAt(x) {
    const A = GameConfig.tankArena;
    const i = Math.round(x / A.block + (A.lanes - 1) / 2);
    return i >= 0 && i < A.lanes ? i : -1;
  }

  get count() {
    let n = this.airborne.length;
    for (const l of this.lanes) n += l.length;
    return n;
  }

  /** Random type by the configured odds. */
  static rollType() {
    const o = GameConfig.tankArena.odds;
    const r = Math.random();
    if (r < o.supply) return 'supply';
    if (r < o.supply + o.strong) return 'strong';
    if (r < o.supply + o.strong + o.weak) return 'weak';
    return 'normal';
  }

  /** A block thrown from a train wagon at `from`, landing on `lane` at z. */
  drop(lane, z, from, color = BLOCK_COLOR_KEYS[Math.floor(Math.random() * 4)], type = BlockFlow.rollType()) {
    const hp = GameConfig.tankArena.hp[type];
    const b = { lane, x: this.laneX(lane), z, color, type, hp, maxHp: hp, flash: 0, chainAt: 0, alive: true, rot: Math.floor(Math.random() * 4) * (Math.PI / 2) };
    this.airborne.push({ b, from: from.clone(), t: 0, dur: 0.7 + Math.random() * 0.15, spin: rnd.spread(6) });
  }

  /** Puts a landed block on its lane at b.z and shoves the blocks it lands on down the lane. */
  land(b) {
    const lane = this.lanes[b.lane];
    lane.push(b);
    lane.sort((a, c) => a.z - c.z);
    const S = this.size;
    // From the top down: nothing overlaps the block above it.
    for (let i = lane.length - 2; i >= 0; i--) {
      if (lane[i].z > lane[i + 1].z - S) lane[i].z = lane[i + 1].z - S;
    }
    this.effects.snowPuff(tmp.set(b.x, this.arena.floorHeight(b.z) + 0.3, b.z), 6);
  }

  blockAt(x, z) {
    const lane = this.laneAt(x);
    if (lane < 0) return null;
    const h = this.size / 2;
    for (const b of this.lanes[lane]) if (b.alive && Math.abs(b.z - z) <= h) return b;
    return null;
  }

  damage(b, amount, hitPoint) {
    if (!b.alive) return false;
    b.hp -= amount;
    b.flash = 0.08;
    if (b.hp <= 0) {
      this.destroy(b, 0);
      return true;
    }
    this.effects.shatter(hitPoint, b.type === 'strong' ? 0x8a9099 : Palette.blocks[b.color], 4, 0.6, [0.12, 0.26]);
    if (b.type === 'strong') this.effects.sparkBurst(hitPoint, 5, 6, [4, 3.6, 3, 1]);
    return false;
  }

  destroy(b, depth) {
    if (!b.alive) return;
    b.alive = false;
    b.chainAt = 0;
    const y = this.arena.floorHeight(b.z) + this.size / 2;
    tmp.set(b.x, y, b.z);
    this.effects.explosion(tmp, depth > 0 ? 0.75 : 0.9, null, 0);
    this.effects.shatter(tmp, Palette.blocks[b.color], depth > 0 ? 10 : 16, 1.1, [0.2, 0.5]);
    if (b.type === 'strong') this.effects.shatter(tmp, 0x6f757e, 8, 1.2, [0.15, 0.3]);
    const lane = this.lanes[b.lane];
    lane.splice(lane.indexOf(b), 1);
    this.onDestroyed?.(b, depth, tmp.clone());
    // Same-coloured neighbours: back to back in the lane, or side by side in the next lane.
    const S = this.size;
    for (const dl of [-1, 0, 1]) {
      const other = this.lanes[b.lane + dl];
      if (!other) continue;
      for (const n of other) {
        if (!n.alive || n.color !== b.color || n.chainAt > 0) continue;
        const dz = Math.abs(n.z - b.z);
        if ((dl === 0 && dz <= S * 1.08) || (dl !== 0 && dz <= S * 0.6)) {
          n.chainAt = GameConfig.tankArena.chainDelay;
          n.chainDepth = depth + 1;
          this.chain.push(n);
        }
      }
    }
  }

  update(dt) {
    const A = GameConfig.tankArena;
    const S = this.size;
    // Chain reaction.
    for (let i = this.chain.length - 1; i >= 0; i--) {
      const n = this.chain[i];
      n.chainAt -= dt;
      if (n.chainAt <= 0) {
        this.chain.splice(i, 1);
        if (n.alive) this.destroy(n, n.chainDepth);
      }
    }
    // Airborne blocks land on their lane.
    for (let i = this.airborne.length - 1; i >= 0; i--) {
      const a = this.airborne[i];
      a.t += dt;
      if (a.t >= a.dur) {
        this.airborne.splice(i, 1);
        this.land(a.b);
      }
    }
    // Slide: front block first; each keeps a block's length behind the one in front of it.
    const step = A.slideSpeed * dt;
    for (const lane of this.lanes) {
      for (let i = 0; i < lane.length; i++) {
        const b = lane[i];
        let z = b.z - step;
        if (i > 0) z = Math.max(z, lane[i - 1].z + S);
        b.z = z;
        // The tank takes the push; if it cannot move any further the block is held up.
        const held = this.resolveTank?.(b) ?? 0;
        if (held > 0) b.z += held;
        b.flash = Math.max(0, b.flash - dt);
      }
      // Over the dam lip: into the drain.
      while (lane.length && lane[0].z < -S * 0.15) {
        const b = lane.shift();
        b.drained = true;
        this.onDrain?.(b);
      }
    }
  }

  /** Instance matrices for every block (lanes + airborne arcs). */
  render() {
    const S = this.size * 0.95;
    const counts = {};
    for (const key of BLOCK_COLOR_KEYS) counts[key] = 0;
    let cages = 0;
    let stars = 0;
    const put = (b, x, y, z, rx, ry, scale) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(rx, ry, 0);
      dummy.scale.setScalar(S * scale);
      dummy.updateMatrix();
      const m = this.meshes[b.color];
      const i = counts[b.color]++;
      m.setMatrixAt(i, dummy.matrix);
      const k = (b.type === 'weak' ? 1.35 : 1) * (1 + b.flash * 12);
      m.setColorAt(i, tmp.set(k, k, k));
      if (b.type === 'strong') this.cage.setMatrixAt(cages++, dummy.matrix);
      if (b.type === 'supply') this.star.setMatrixAt(stars++, dummy.matrix);
    };
    for (const lane of this.lanes) {
      for (const b of lane) {
        const s = b.type === 'weak' ? 0.9 : 1;
        put(b, b.x, this.arena.floorHeight(b.z) + (S * s) / 2, b.z, 0, b.rot, s);
      }
    }
    for (const a of this.airborne) {
      const t = Math.min(1, a.t / a.dur);
      const e = t * t;
      const b = a.b;
      const s = b.type === 'weak' ? 0.9 : 1;
      const x = THREE.MathUtils.lerp(a.from.x, b.x, t);
      const z = THREE.MathUtils.lerp(a.from.z, b.z, t);
      const y = THREE.MathUtils.lerp(a.from.y, this.arena.floorHeight(b.z) + (S * s) / 2, e) + Math.sin(t * Math.PI) * 1.4;
      put(b, x, y, z, a.spin * (1 - t), b.rot + a.spin * (1 - t), s);
    }
    for (const key of BLOCK_COLOR_KEYS) {
      const m = this.meshes[key];
      m.count = counts[key];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.cage.count = cages;
    this.star.count = stars;
    this.cage.instanceMatrix.needsUpdate = true;
    this.star.instanceMatrix.needsUpdate = true;
  }
}

