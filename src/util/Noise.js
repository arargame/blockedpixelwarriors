/**
 * Tileable value noise + fBm used by the procedural texture generators.
 */
export class ValueNoise2D {
  /**
   * @param {import('./Random.js').Random} random
   * @param {number} period lattice size (noise tiles every `period` units)
   */
  constructor(random, period = 64) {
    this.period = period;
    this.values = new Float32Array(period * period);
    for (let i = 0; i < this.values.length; i++) this.values[i] = random.next();
  }

  lattice(ix, iy) {
    const p = this.period;
    const x = ((ix % p) + p) % p;
    const y = ((iy % p) + p) % p;
    return this.values[y * p + x];
  }

  sample(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = this.lattice(ix, iy);
    const b = this.lattice(ix + 1, iy);
    const c = this.lattice(ix, iy + 1);
    const d = this.lattice(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  /** Fractal sum, result roughly in [0, 1]. */
  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amplitude = 0.5;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amplitude * this.sample(x * frequency, y * frequency);
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }
}

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
