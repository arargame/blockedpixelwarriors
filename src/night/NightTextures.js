import * as THREE from 'three';
import { paintPixels, canvasToTexture, heightToNormalCanvas } from '../textures/CanvasUtils.js';
import { ValueNoise2D, clamp } from '../util/Noise.js';
import { Random } from '../util/Random.js';

/**
 * Procedural ground textures for the night level (tileable, generated once):
 *   field    dark steel deck plates on the block grid (2 x 2 plates per tile), grooved seams,
 *            corner rivets, scuffs - the floor of the arena tray
 *   asphalt  wet black asphalt: aggregate specks, tar patches, hairline cracks
 *   paving   square sidewalk slabs with dark joints
 *   wet      large soft blobs: where the puddles lie (red channel, linear)
 * Each ground texture comes with a normal map built from its height field.
 */
export class NightTextures {
  constructor() {
    this.cache = {};
  }

  get(key, make) {
    return (this.cache[key] ??= make());
  }

  build(S, colorAt, heightAt, strength) {
    const heights = new Float32Array(S * S);
    const color = paintPixels(S, S, (x, y, out) => {
      const h = heightAt(x, y);
      heights[y * S + x] = h;
      colorAt(x, y, h, out);
    });
    const map = canvasToTexture(color, { repeat: true });
    const normalMap = canvasToTexture(heightToNormalCanvas(heights, S, S, strength), { srgb: false, repeat: true });
    return { map, normalMap };
  }

  field() {
    return this.get('field', () => {
      const S = 512;
      const n = new ValueNoise2D(new Random(41), 32);
      const tint = new Random(42);
      const plates = Array.from({ length: 4 }, () => 0.85 + tint.next() * 0.3);
      const cell = S / 2;
      return this.build(S, (x, y, h, out) => {
        const px = Math.floor(x / cell);
        const py = Math.floor(y / cell);
        const k = plates[py * 2 + px];
        const g = n.fbm(x / 22, y / 22, 4);
        const fine = n.sample(x / 3, y / 3);
        let v = (0.13 + g * 0.08 + fine * 0.025) * k;
        // Scuffs: lighter streaks along the plates.
        v += Math.max(0, n.sample(x / 60, y / 4) - 0.72) * 0.25;
        v *= 0.75 + 0.25 * h;
        out[0] = v * 0.92;
        out[1] = v * 0.97;
        out[2] = v * 1.08;
      }, (x, y) => {
        const fx = (x % cell) / cell;
        const fy = (y % cell) / cell;
        const edge = Math.min(fx, 1 - fx, fy, 1 - fy) * cell;
        let h = 0.6 + 0.4 * clamp(edge / 3, 0, 1);
        // Corner rivets.
        for (const [cx, cy] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]]) {
          const d = Math.hypot(fx - cx, fy - cy) * cell;
          if (d < 6) h = Math.max(h, 1.25 - d / 12);
        }
        return h;
      }, 2.2);
    });
  }

  /**
   * The key art's cracked block face: a mosaic of chipped cells split by dark cracks, each cell
   * a little domed (normal map), a dark rim round the face. Grey, tinted by the block material.
   */
  cracked() {
    return this.get('cracked', () => {
      const S = 256;
      const r = new Random(91);
      const seeds = [];
      const n = 15;
      for (let i = 0; i < n; i++) seeds.push([r.next() * S, r.next() * S, 0.82 + r.next() * 0.2]);
      // Tile the seeds (wrap) so the face edges match.
      const pts = [];
      for (const [x, y, v] of seeds) for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) pts.push([x + ox, y + oy, v]);
      const cell = new Float32Array(S * S);
      const edge = new Float32Array(S * S);
      const val = new Float32Array(S * S);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          let d1 = 1e9;
          let d2 = 1e9;
          let v = 1;
          for (const p of pts) {
            const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
            if (d < d1) {
              d2 = d1;
              d1 = d;
              v = p[2];
            } else if (d < d2) d2 = d;
          }
          const e = Math.sqrt(d2) - Math.sqrt(d1);
          const i = y * S + x;
          edge[i] = e;
          val[i] = v;
          cell[i] = Math.sqrt(d1);
        }
      }
      const noise = new ValueNoise2D(new Random(92), 32);
      return this.build(S, (x, y, h, out) => {
        const i = y * S + x;
        const e = edge[i];
        const rim = Math.min(x, y, S - 1 - x, S - 1 - y);
        let v = val[i] * (0.9 + 0.1 * noise.sample(x / 6, y / 6));
        if (e < 2.2) v *= 0.22 + 0.25 * (e / 2.2);
        else if (e < 4) v *= 1.08;
        if (rim < 5) v *= 0.45 + rim * 0.1;
        out[0] = out[1] = out[2] = v;
      }, (x, y) => {
        const i = y * S + x;
        const e = edge[i];
        return Math.min(1, e / 6) * (0.85 + 0.15 * noise.sample(x / 9, y / 9)) - Math.max(0, 1 - cell[i] / 60) * 0.05;
      }, 3.2);
    });
  }

  asphalt() {
    return this.get('asphalt', () => {
      const S = 512;
      const n = new ValueNoise2D(new Random(51), 64);
      const r = new Random(52);
      const specks = new Float32Array(S * S);
      for (let i = 0; i < 9000; i++) specks[Math.floor(r.next() * S * S)] = 0.4 + r.next() * 0.6;
      return this.build(S, (x, y, h, out) => {
        const g = n.fbm(x / 40, y / 40, 4);
        const patch = n.sample(x / 90 + 7, y / 90) > 0.62 ? 0.65 : 1;
        let v = (0.07 + g * 0.05 + specks[y * S + x] * 0.08) * patch;
        const crack = Math.abs(n.sample(x / 26, y / 26) - 0.5) < 0.012 ? 0.45 : 1;
        v *= crack;
        out[0] = v;
        out[1] = v * 1.02;
        out[2] = v * 1.08;
      }, (x, y) => n.sample(x / 2, y / 2) * 0.4 + specks[y * S + x] * 0.6, 1.4);
    });
  }

  paving() {
    return this.get('paving', () => {
      const S = 256;
      const n = new ValueNoise2D(new Random(61), 32);
      const r = new Random(62);
      const slab = Array.from({ length: 16 }, () => 0.8 + r.next() * 0.35);
      const c = S / 4;
      return this.build(S, (x, y, h, out) => {
        const k = slab[Math.floor(y / c) * 4 + Math.floor(x / c)];
        const v = (0.2 + n.fbm(x / 20, y / 20, 3) * 0.09) * k * (0.35 + 0.65 * h);
        out[0] = v;
        out[1] = v * 0.99;
        out[2] = v * 0.97;
      }, (x, y) => {
        const fx = (x % c) / c;
        const fy = (y % c) / c;
        return clamp(Math.min(fx, 1 - fx, fy, 1 - fy) * c / 3, 0, 1);
      }, 2);
    });
  }

  wet() {
    return this.get('wet', () => {
      const S = 256;
      const n = new ValueNoise2D(new Random(71), 16);
      const c = paintPixels(S, S, (x, y, out) => {
        const v = n.fbm(x / 48, y / 48, 4) * 0.8 + n.sample(x / 9, y / 9) * 0.2;
        out[0] = out[1] = out[2] = v;
      });
      const t = canvasToTexture(c, { srgb: false, repeat: true });
      return t;
    });
  }

  /** Soft radial glow (light pools, cone fades). */
  glow() {
    return this.get('glow', () => {
      const S = 128;
      const c = paintPixels(S, S, (x, y, out) => {
        const d = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2);
        const v = Math.max(0, 1 - d) ** 2;
        out[0] = out[1] = out[2] = v;
        out[3] = v;
      });
      return canvasToTexture(c, { srgb: false });
    });
  }
}

