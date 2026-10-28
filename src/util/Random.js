/**
 * Small deterministic PRNG (mulberry32) so procedural content is identical
 * on every run (important for screenshot comparisons and for debugging).
 */
export class Random {
  /** @param {number} seed */
  constructor(seed = 1) {
    this.state = seed >>> 0;
  }

  /** @returns {number} float in [0, 1) */
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  int(min, maxInclusive) {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }

  chance(probability) {
    return this.next() < probability;
  }

  /** Symmetric random in [-amount, amount]. */
  spread(amount) {
    return (this.next() * 2 - 1) * amount;
  }
}

/** Shared runtime RNG for gameplay effects (non-deterministic content is fine there). */
export const fxRandom = new Random(Date.now() & 0xffffffff);
