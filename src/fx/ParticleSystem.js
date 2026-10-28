import { BillboardBatch } from './BillboardBatch.js';

const STRIDE = 24;
// Layout of one particle record inside the Float32Array pool.
const P = Object.freeze({
  x: 0, y: 1, z: 2, vx: 3, vy: 4, vz: 5,
  life: 6, maxLife: 7, size0: 8, size1: 9, aspect: 10,
  r0: 11, g0: 12, b0: 13, a0: 14, r1: 15, g1: 16, b1: 17, a1: 18,
  rot: 19, rotVel: 20, gravity: 21, drag: 22, stretch: 23,
});

/**
 * CPU-simulated particle pool rendered through one BillboardBatch (one draw call).
 * Records are packed in a flat Float32Array and removed with swap-delete (no GC churn).
 */
export class ParticleSystem {
  /**
   * @param {import('three').Texture} texture
   * @param {number} capacity
   * @param {object} batchOptions forwarded to BillboardBatch
   */
  constructor(texture, capacity, batchOptions = {}) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    this.count = 0;
    this.batch = new BillboardBatch(texture, capacity, batchOptions);
    this.object3d = this.batch.mesh;
  }

  /**
   * Spawns a particle. Unspecified fields fall back to sensible defaults.
   * @param {object} p
   */
  emit(p) {
    if (this.count >= this.capacity) return;
    const o = this.count++ * STRIDE;
    const d = this.data;
    d[o + P.x] = p.x;
    d[o + P.y] = p.y;
    d[o + P.z] = p.z;
    d[o + P.vx] = p.vx ?? 0;
    d[o + P.vy] = p.vy ?? 0;
    d[o + P.vz] = p.vz ?? 0;
    d[o + P.life] = 0;
    d[o + P.maxLife] = p.life ?? 1;
    d[o + P.size0] = p.size0 ?? p.size ?? 1;
    d[o + P.size1] = p.size1 ?? p.size ?? 1;
    d[o + P.aspect] = p.aspect ?? 1;
    const c0 = p.color0 ?? [1, 1, 1, 1];
    const c1 = p.color1 ?? [c0[0], c0[1], c0[2], 0];
    d[o + P.r0] = c0[0];
    d[o + P.g0] = c0[1];
    d[o + P.b0] = c0[2];
    d[o + P.a0] = c0[3];
    d[o + P.r1] = c1[0];
    d[o + P.g1] = c1[1];
    d[o + P.b1] = c1[2];
    d[o + P.a1] = c1[3];
    d[o + P.rot] = p.rot ?? Math.random() * Math.PI * 2;
    d[o + P.rotVel] = p.rotVel ?? 0;
    d[o + P.gravity] = p.gravity ?? 0;
    d[o + P.drag] = p.drag ?? 0;
    d[o + P.stretch] = p.stretch ?? 0;
  }

  update(dt) {
    const d = this.data;
    const batch = this.batch;
    batch.begin();
    let i = 0;
    while (i < this.count) {
      const o = i * STRIDE;
      d[o + P.life] += dt;
      if (d[o + P.life] >= d[o + P.maxLife]) {
        // swap-remove
        const last = (this.count - 1) * STRIDE;
        if (last !== o) d.copyWithin(o, last, last + STRIDE);
        this.count--;
        continue;
      }
      const drag = Math.max(0, 1 - d[o + P.drag] * dt);
      d[o + P.vx] *= drag;
      d[o + P.vy] = d[o + P.vy] * drag - d[o + P.gravity] * dt;
      d[o + P.vz] *= drag;
      d[o + P.x] += d[o + P.vx] * dt;
      d[o + P.y] += d[o + P.vy] * dt;
      d[o + P.z] += d[o + P.vz] * dt;
      d[o + P.rot] += d[o + P.rotVel] * dt;

      const t = d[o + P.life] / d[o + P.maxLife];
      const size = d[o + P.size0] + (d[o + P.size1] - d[o + P.size0]) * t;
      const r = d[o + P.r0] + (d[o + P.r1] - d[o + P.r0]) * t;
      const g = d[o + P.g0] + (d[o + P.g1] - d[o + P.g0]) * t;
      const b = d[o + P.b0] + (d[o + P.b1] - d[o + P.b0]) * t;
      const a = d[o + P.a0] + (d[o + P.a1] - d[o + P.a0]) * t;
      const stretch = d[o + P.stretch];
      if (stretch > 0) {
        const vx = d[o + P.vx];
        const vy = d[o + P.vy];
        const vz = d[o + P.vz];
        const speed = Math.hypot(vx, vy, vz);
        batch.push(d[o + P.x], d[o + P.y], d[o + P.z], size, size * d[o + P.aspect] + speed * stretch, r, g, b, a, 0, vx, vy, vz);
      } else {
        batch.push(d[o + P.x], d[o + P.y], d[o + P.z], size, size * d[o + P.aspect], r, g, b, a, d[o + P.rot]);
      }
      i++;
    }
    batch.end();
  }

  clear() {
    this.count = 0;
    this.batch.begin();
    this.batch.end();
  }
}
