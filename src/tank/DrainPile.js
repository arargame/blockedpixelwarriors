import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GameConfig } from '../config/GameConfig.js';
import { BLOCK_COLOR_KEYS } from '../config/Palette.js';
import { fxRandom as rnd } from '../util/Random.js';

const dummy = new THREE.Object3D();
const d = new THREE.Vector3();
const axis = new THREE.Vector3();
const dq = new THREE.Quaternion();
const MAX = 140;
const GRAVITY = 24;

/**
 * The drain basin's pile: every block that gets past the dam lip tumbles in and stays. A small
 * position-based physics solver (no library, ported 1:1 to MonoGame): each block is a sphere
 * of the block's half size for contacts, plus a spinning orientation for the cube it draws.
 *   - gravity, the basin floor and its oval wall (below the rim);
 *   - block-block contacts pushed apart (equal shares), a few iterations per substep;
 *   - velocity from the position change (Verlet), damping, extra drag and a splash in the water,
 *     friction and spin damping in contact so the pile settles into a heap.
 */
export class DrainPile {
  constructor(materials, effects, arena) {
    this.effects = effects;
    this.arena = arena;
    this.bodies = [];
    this.group = new THREE.Group();
    const geo = new RoundedBoxGeometry(1, 1, 1, 3, 0.07);
    this.meshes = {};
    for (const key of BLOCK_COLOR_KEYS) {
      const m = new THREE.InstancedMesh(geo, materials.block(key), MAX);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      this.group.add(m);
      this.meshes[key] = m;
    }
    this.r = GameConfig.tankArena.block * 0.5;
  }

  get count() {
    return this.bodies.length;
  }

  reset() {
    this.bodies.length = 0;
  }

  /** A block falls over the lip at (x, y, z) moving down the channel. */
  add(x, y, z, color) {
    const A = GameConfig.tankArena;
    if (this.bodies.length >= MAX) return;
    const p = new THREE.Vector3(x, y, z);
    const v = new THREE.Vector3(rnd.spread(0.6), 0.5, -A.slideSpeed * 1.6 - Math.random() * 1.2);
    this.bodies.push({
      p, prev: p.clone().addScaledVector(v, -1 / 60), color,
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.floor(Math.random() * 4) * (Math.PI / 2), 0)),
      w: new THREE.Vector3(-2.5 - Math.random() * 2, rnd.spread(2), rnd.spread(1.5)),
      wet: false, contact: false,
    });
  }

  /** DRAIN PUMP power-up: the top `n` blocks are flushed away. */
  remove(n) {
    this.bodies.sort((a, b) => a.p.y - b.p.y);
    for (let i = 0; i < n && this.bodies.length; i++) {
      const b = this.bodies.pop();
      this.effects.snowPuff(b.p, 8);
    }
  }

  update(dt) {
    const D = GameConfig.tankArena.drain;
    const r = this.r;
    const floorY = -D.depth + r;
    const surface = -D.depth + D.water;
    const ex = D.rx - r;
    const ez = D.rz - r;
    const sub = 2;
    const h = Math.min(dt, 1 / 30) / sub;
    const B = this.bodies;
    for (let s = 0; s < sub; s++) {
      for (const b of B) {
        // Verlet step with gravity.
        d.subVectors(b.p, b.prev);
        b.prev.copy(b.p);
        d.multiplyScalar(b.wet ? 0.96 : 0.995);
        b.p.add(d);
        b.p.y -= GRAVITY * h * h;
        b.contact = false;
      }
      for (let it = 0; it < 3; it++) {
        for (let i = 0; i < B.length; i++) {
          const a = B[i];
          for (let j = i + 1; j < B.length; j++) {
            const c = B[j];
            d.subVectors(c.p, a.p);
            const l2 = d.lengthSq();
            if (l2 >= 4 * r * r || l2 < 1e-8) continue;
            const l = Math.sqrt(l2);
            const push = (2 * r - l) * 0.5;
            d.multiplyScalar(push / l);
            a.p.sub(d);
            c.p.add(d);
            a.contact = c.contact = true;
          }
        }
        for (const b of B) {
          if (b.p.y < floorY) {
            b.p.y = floorY;
            b.contact = true;
          }
          // The oval wall only holds what is below the rim.
          if (b.p.y < 0.2) {
            const x = b.p.x;
            const z = b.p.z - D.z;
            const k = (x / ex) ** 2 + (z / ez) ** 2;
            if (k > 1) {
              const f = 1 / Math.sqrt(k);
              b.p.x = x * f;
              b.p.z = D.z + z * f;
              b.contact = true;
            }
          }
        }
      }
      for (const b of B) {
        if (b.contact) {
          // Friction: the horizontal motion since the last step is mostly lost.
          b.prev.x = THREE.MathUtils.lerp(b.prev.x, b.p.x, 0.25);
          b.prev.z = THREE.MathUtils.lerp(b.prev.z, b.p.z, 0.25);
        }
        const wet = b.p.y < surface;
        if (wet && !b.wet) this.splash(b);
        b.wet = wet;
      }
    }
    // Spin: tumbling while falling, damped hard once resting on something.
    for (const b of B) {
      b.w.multiplyScalar(Math.exp(-(b.contact ? 6 : 0.6) * dt));
      const ang = b.w.length() * dt;
      if (ang > 1e-5) {
        dq.setFromAxisAngle(axis.copy(b.w).normalize(), ang);
        b.q.premultiply(dq);
      }
    }
  }

  splash(b) {
    const D = GameConfig.tankArena.drain;
    const y = -D.depth + D.water + 0.1;
    for (let i = 0; i < 10; i++) {
      this.effects.smoke.emit({
        x: b.p.x + rnd.spread(0.6), y, z: b.p.z + rnd.spread(0.6), vx: rnd.spread(2.5), vy: rnd.range(2, 5), vz: rnd.spread(2.5), drag: 1.6, gravity: 9,
        life: rnd.range(0.5, 0.9), size0: 0.35, size1: rnd.range(0.9, 1.4), color0: [1.2, 1.35, 1.45, 0.9], color1: [1.1, 1.2, 1.3, 0],
      });
    }
  }

  render() {
    const S = GameConfig.tankArena.block * 0.95;
    const counts = {};
    for (const key of BLOCK_COLOR_KEYS) counts[key] = 0;
    for (const b of this.bodies) {
      dummy.position.copy(b.p);
      dummy.quaternion.copy(b.q);
      dummy.scale.setScalar(S);
      dummy.updateMatrix();
      this.meshes[b.color].setMatrixAt(counts[b.color]++, dummy.matrix);
    }
    for (const key of BLOCK_COLOR_KEYS) {
      const m = this.meshes[key];
      m.count = counts[key];
      m.instanceMatrix.needsUpdate = true;
    }
  }
}

