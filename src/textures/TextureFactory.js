import * as THREE from 'three';
import { Random } from '../util/Random.js';
import { ValueNoise2D, clamp, smoothstep, lerp } from '../util/Noise.js';
import { createCanvas, canvasToTexture, paintPixels, heightToNormalCanvas } from './CanvasUtils.js';

/**
 * Procedural texture generator (Flyweight cache: every texture is generated once).
 * No external image assets are needed, so the game ships as a single file.
 */
export class TextureFactory {
  constructor(renderer) {
    this.maxAnisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
    /** @type {Map<string, any>} */
    this.cache = new Map();
  }

  get(key, build) {
    if (!this.cache.has(key)) this.cache.set(key, build());
    return this.cache.get(key);
  }

  // ---------------------------------------------------------------------------
  // Voxel block surface: chunky 2x2 plates with Voronoi cracks (key-art look).
  // Albedo is a *linear multiplier* (0.75 = base color), tinted by material color.
  // ---------------------------------------------------------------------------
  blockSurface() {
    return this.get('blockSurface', () => {
      const S = 256;
      const rng = new Random(1337);
      const noise = new ValueNoise2D(rng, 32);
      const tiles = 2;
      const tileSize = S / tiles;
      const seeds = [];
      for (let ty = 0; ty < tiles; ty++) {
        for (let tx = 0; tx < tiles; tx++) {
          const list = [];
          const count = rng.int(3, 5);
          for (let i = 0; i < count; i++) {
            list.push({
              x: tx * tileSize + rng.range(14, tileSize - 14),
              y: ty * tileSize + rng.range(14, tileSize - 14),
              tone: rng.spread(0.07),
            });
          }
          seeds.push(list);
        }
      }

      const height = new Float32Array(S * S);
      const albedo = new Float32Array(S * S);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const tx = Math.floor(x / tileSize);
          const ty = Math.floor(y / tileSize);
          const lx = x - tx * tileSize;
          const ly = y - ty * tileSize;
          const edge = Math.min(lx, ly, tileSize - 1 - lx, tileSize - 1 - ly);

          // Domain-warped Voronoi for organic cracks.
          const wx = x + (noise.fbm(x * 0.045, y * 0.045, 3) - 0.5) * 18;
          const wy = y + (noise.fbm(x * 0.045 + 17, y * 0.045 + 9, 3) - 0.5) * 18;
          let d1 = 1e9;
          let d2 = 1e9;
          let tone = 0;
          for (const s of seeds[ty * tiles + tx]) {
            const d = Math.hypot(wx - s.x, wy - s.y);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              tone = s.tone;
            } else if (d < d2) {
              d2 = d;
            }
          }
          const crack = d2 - d1;
          const bump = noise.fbm(x * 0.09, y * 0.09, 4) - 0.5;

          let h = 1.0;
          h -= (1 - smoothstep(0, 12, edge)) * 0.55;
          h -= (1 - smoothstep(0, 4.5, crack)) * 0.5;
          h += bump * 0.22;
          height[y * S + x] = h;

          let a = 0.74 + tone + bump * 0.12;
          a *= 0.3 + 0.7 * smoothstep(0.4, 3.2, crack);
          a *= 0.36 + 0.64 * smoothstep(0, 5, edge);
          // Lit rim on plate edges (fake bevel highlight).
          const rim = smoothstep(3.2, 6, crack) * (1 - smoothstep(6, 11, crack));
          a += rim * 0.06;
          if (rng.chance(0.012)) a *= 0.72;
          albedo[y * S + x] = a;
        }
      }

      const albedoCanvas = paintPixels(S, S, (x, y, out) => {
        const v = albedo[y * S + x];
        out[0] = out[1] = out[2] = v;
      });
      const normalCanvas = heightToNormalCanvas(height, S, S, 3.2, false);
      return {
        map: canvasToTexture(albedoCanvas, { srgb: false, anisotropy: this.maxAnisotropy }),
        normalMap: canvasToTexture(normalCanvas, { srgb: false, anisotropy: this.maxAnisotropy }),
      };
    });
  }

  /** Light wood planks for the board frame (world-UV mapped, tiles along U). */
  woodPlanks() {
    return this.get('wood', () => {
      const W = 512;
      const H = 128;
      const rng = new Random(77);
      const noise = new ValueNoise2D(rng, 64);
      const height = new Float32Array(W * H);
      const base = new THREE.Color(0xdcaa6c);
      const dark = new THREE.Color(0xa9733e);
      const light = new THREE.Color(0xf0c88d);
      const plankLen = 256;
      const color = paintPixels(W, H, (x, y, out) => {
        const plankRow = Math.floor(y / 32);
        const offset = (plankRow * 97) % plankLen;
        const px = (x + offset) % plankLen;
        const seam = Math.min(px, plankLen - px, (y % 32), 32 - (y % 32));
        const grain = noise.fbm(x * 0.012, y * 0.22 + plankRow * 3, 4);
        const ring = Math.sin(grain * 40 + y * 0.15) * 0.5 + 0.5;
        let t = 0.45 + (grain - 0.5) * 0.8 + ring * 0.18;
        t = clamp(t, 0, 1);
        const c = base.clone().lerp(dark, 1 - t).lerp(light, Math.max(0, t - 0.65));
        const seamShade = 0.55 + 0.45 * smoothstep(0, 2.5, seam);
        out[0] = c.r * seamShade;
        out[1] = c.g * seamShade;
        out[2] = c.b * seamShade;
        height[y * W + x] = smoothstep(0, 2.5, seam) * 0.8 + ring * 0.08;
      });
      const normal = heightToNormalCanvas(height, W, H, 2.5, true);
      return {
        map: canvasToTexture(color, { srgb: true, repeat: true, anisotropy: this.maxAnisotropy }),
        normalMap: canvasToTexture(normal, { srgb: false, repeat: true, anisotropy: this.maxAnisotropy }),
      };
    });
  }

  /** Sky-and-cloud floor of the board (tileable). */
  cloudFloor() {
    return this.get('cloudFloor', () => {
      const S = 512;
      const rng = new Random(4242);
      const noise = new ValueNoise2D(rng, 16);
      const blue = new THREE.Color(0x8fcaf6);
      const deepBlue = new THREE.Color(0x6aaee9);
      const white = new THREE.Color(0xffffff);
      const shade = new THREE.Color(0xc9def2);
      const scale = 16 / S;
      const canvas = paintPixels(S, S, (x, y, out) => {
        const n = noise.fbm(x * scale, y * scale, 5);
        const nLit = noise.fbm((x - 6) * scale, (y - 6) * scale, 5);
        const cloud = smoothstep(0.34, 0.56, n);
        const lit = clamp((n - nLit) * 9 + 0.5, 0, 1);
        const sky = blue.clone().lerp(deepBlue, noise.fbm(x * scale * 0.5 + 3, y * scale * 0.5, 2));
        const cloudColor = shade.clone().lerp(white, lit);
        const c = sky.lerp(cloudColor, cloud);
        out[0] = c.r;
        out[1] = c.g;
        out[2] = c.b;
      });
      return canvasToTexture(canvas, { srgb: true, repeat: true, anisotropy: this.maxAnisotropy });
    });
  }

  /**
   * Cartoon cumulus puff: a union of shaded spheres ("cauliflower" lumps) lit from
   * the top-left with a soft blue-grey underside. RGBA sprite.
   */
  cloudPuff(variant = 0) {
    return this.get(`cloudPuff${variant}`, () => {
      const S = 256;
      const rng = new Random(900 + variant * 31);
      const noise = new ValueNoise2D(rng, 32);
      const spheres = [];
      // Base row (flat bottom) then smaller lumps stacked into a dome.
      const baseCount = 4 + variant;
      for (let i = 0; i < baseCount; i++) {
        const t = i / (baseCount - 1);
        spheres.push({ x: lerp(0.22, 0.78, t) + rng.spread(0.03), y: 0.62 + rng.spread(0.02), r: rng.range(0.13, 0.17) });
      }
      const upper = 4 + variant;
      for (let i = 0; i < upper; i++) {
        const t = (i + 0.5) / upper + rng.spread(0.06);
        const dome = Math.sin(t * Math.PI);
        spheres.push({ x: lerp(0.28, 0.72, t), y: 0.56 - dome * rng.range(0.12, 0.2), r: rng.range(0.13, 0.19) * (0.75 + dome * 0.45) });
      }
      const L = new THREE.Vector3(-0.5, -0.72, 0.55).normalize();
      const light = new THREE.Color(0xffffff);
      const mid = new THREE.Color(0xe6f0fb);
      const shadow = new THREE.Color(0xb9cce2);
      const canvas = paintPixels(S, S, (x, y, out) => {
        const u = x / S;
        const v = y / S;
        const wobble = (noise.fbm(u * 14, v * 14, 3) - 0.5) * 0.025;
        let best = -1;
        let bh = -1e9;
        let edge = 0;
        for (let i = 0; i < spheres.length; i++) {
          const sp = spheres[i];
          const d = Math.hypot(u - sp.x, v - sp.y);
          const r = sp.r + wobble;
          if (d < r) {
            const h = Math.sqrt(r * r - d * d) - (sp.y - 0.5) * 0.15;
            if (h > bh) {
              bh = h;
              best = i;
              edge = r - d;
            }
          }
        }
        if (best < 0 || v > 0.74) {
          out[3] = 0;
          return;
        }
        const sp = spheres[best];
        const r = sp.r + wobble;
        // Blend the lump normal with a broad dome normal so lumps read softly.
        const gx = (u - 0.5) / 0.42;
        const gy = (v - 0.45) / 0.42;
        let nx = ((u - sp.x) / r) * 0.6 + gx * 0.4;
        let ny = ((v - sp.y) / r) * 0.6 + gy * 0.4;
        const nl = Math.hypot(nx, ny);
        if (nl > 0.98) {
          nx *= 0.98 / nl;
          ny *= 0.98 / nl;
        }
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const diffuse = clamp(nx * L.x + ny * L.y + nz * L.z, 0, 1);
        const wrap = clamp(diffuse * 0.7 + 0.38, 0, 1);
        const underside = smoothstep(0.55, 0.74, v);
        const c = shadow.clone().lerp(mid, smoothstep(0.15, 0.6, wrap)).lerp(light, smoothstep(0.6, 0.95, wrap));
        c.lerp(shadow, underside * 0.55);
        // Thin bright rim where the lump silhouette faces the sun.
        const rim = Math.pow(1 - nz, 3) * clamp(-(nx * 0.5 + ny * 0.8), 0, 1);
        out[0] = Math.min(1, c.r + rim * 0.15);
        out[1] = Math.min(1, c.g + rim * 0.15);
        out[2] = Math.min(1, c.b + rim * 0.12);
        out[3] = smoothstep(0, 0.03, edge) * (1 - smoothstep(0.66, 0.74, v));
      });
      return canvasToTexture(canvas, { srgb: true });
    });
  }

  /** Soft smoke puff (white, tinted per particle). */
  smokePuff() {
    return this.get('smoke', () => {
      const S = 128;
      const noise = new ValueNoise2D(new Random(55), 16);
      const canvas = paintPixels(S, S, (x, y, out) => {
        const u = x / S - 0.5;
        const v = y / S - 0.5;
        const r = Math.hypot(u, v) * 2;
        const n = noise.fbm(x / 14, y / 14, 4);
        const a = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.6);
        const shade = 0.75 + (0.5 - v) * 0.45 + (n - 0.5) * 0.3;
        out[0] = out[1] = out[2] = clamp(shade, 0, 1);
        out[3] = a;
      });
      return canvasToTexture(canvas, { srgb: true });
    });
  }

  /** Radial glow for additive particles. */
  glow() {
    return this.get('glow', () => {
      const S = 128;
      const canvas = paintPixels(S, S, (x, y, out) => {
        const r = Math.hypot(x / S - 0.5, y / S - 0.5) * 2;
        const core = Math.exp(-r * r * 18);
        const halo = Math.pow(Math.max(0, 1 - r), 2.2);
        const v = clamp(core + halo * 0.55, 0, 1);
        out[0] = out[1] = out[2] = v;
        out[3] = v;
      });
      return canvasToTexture(canvas, { srgb: false });
    });
  }

  /**
   * Plasma head with baked colors: white-hot core, saturated magenta ring and a dark
   * violet outline so it reads on bright cloud backgrounds (alpha blended).
   */
  orb() {
    return this.get('orb', () => {
      const S = 128;
      const core = new THREE.Color(1, 1, 1);
      const ring = new THREE.Color(1.0, 0.22, 0.92);
      const edge = new THREE.Color(0.45, 0.05, 0.55);
      const canvas = paintPixels(S, S, (x, y, out) => {
        const r = Math.hypot(x / S - 0.5, y / S - 0.5) * 2;
        const c = edge.clone().lerp(ring, smoothstep(0.98, 0.8, r)).lerp(core, smoothstep(0.55, 0.3, r));
        out[0] = c.r;
        out[1] = c.g;
        out[2] = c.b;
        out[3] = smoothstep(1.0, 0.9, r);
      });
      return canvasToTexture(canvas, { srgb: true });
    });
  }

  /** Billowy fireball with baked yellow core -> orange -> deep red rim (additive). */
  fireball(variant = 0) {
    return this.get(`fireball${variant}`, () => {
      const S = 128;
      const noise = new ValueNoise2D(new Random(321 + variant), 16);
      const core = new THREE.Color(1.0, 0.92, 0.55);
      const mid = new THREE.Color(1.0, 0.55, 0.12);
      const rim = new THREE.Color(0.75, 0.16, 0.03);
      const canvas = paintPixels(S, S, (x, y, out) => {
        const u = x / S - 0.5;
        const v = y / S - 0.5;
        const n = noise.fbm(x / 18, y / 18, 4);
        const r = Math.hypot(u, v) * 2 + (n - 0.5) * 0.55;
        const heat = clamp(1 - r, 0, 1);
        const c = rim.clone().lerp(mid, smoothstep(0.05, 0.45, heat)).lerp(core, smoothstep(0.45, 0.85, heat));
        out[0] = c.r;
        out[1] = c.g;
        out[2] = c.b;
        out[3] = smoothstep(0.0, 0.3, heat);
      });
      return canvasToTexture(canvas, { srgb: true });
    });
  }

  /** Elongated streak used for sparks and tracers (long axis = V). */
  streak() {
    return this.get('streak', () => {
      const W = 32;
      const H = 128;
      const canvas = paintPixels(W, H, (x, y, out) => {
        const u = Math.abs(x / (W - 1) - 0.5) * 2;
        const v = y / (H - 1);
        const across = Math.exp(-u * u * 7);
        const along = smoothstep(0, 0.25, v) * smoothstep(1, 0.75, v);
        const core = Math.exp(-u * u * 40) * along;
        const a = clamp(across * along * 0.8 + core, 0, 1);
        out[0] = out[1] = out[2] = a;
        out[3] = a;
      });
      return canvasToTexture(canvas, { srgb: false });
    });
  }

  /**
   * Plasma comet: bright round head at the top with a white core, tapering tail below.
   * Tinted by the particle color in the additive shader.
   */
  comet() {
    return this.get('comet', () => {
      const W = 64;
      const H = 256;
      const canvas = paintPixels(W, H, (x, y, out) => {
        const u = (x / (W - 1) - 0.5) * 2;
        const v = y / (H - 1); // 0 = head (top of image)
        const headY = 0.13;
        const dh = Math.hypot(u, (v - headY) * (H / W));
        const head = Math.exp(-dh * dh * 3.2);
        const core = Math.exp(-dh * dh * 14);
        const tailWidth = lerp(0.55, 0.05, smoothstep(headY, 1, v));
        const tail = v > headY ? Math.exp(-(u * u) / (tailWidth * tailWidth) * 1.4) * smoothstep(1, headY, v) : 0;
        const a = clamp(head + tail * 0.75, 0, 1);
        // Store core in RGB as white-hot, rest becomes tinted.
        out[0] = clamp(a * 0.75 + core, 0, 1);
        out[1] = clamp(a * 0.75 + core, 0, 1);
        out[2] = clamp(a * 0.75 + core, 0, 1);
        out[3] = a;
      });
      return canvasToTexture(canvas, { srgb: false });
    });
  }

  /**
   * Key-art plasma bolt with baked colors (alpha blended, HDR-tinted by the batch):
   * white core + hot magenta ring with a dark violet rim, trailing a spiky blue/cyan flame.
   * Head at the top of the image (v = 0), tail toward v = 1.
   */
  plasmaBolt() {
    return this.get('plasmaBolt', () => {
      const W = 96;
      const H = 320;
      const noise = new ValueNoise2D(new Random(77), 16);
      const white = new THREE.Color(1, 1, 1);
      const magenta = new THREE.Color(1.0, 0.18, 0.88);
      const violet = new THREE.Color(0.32, 0.02, 0.45);
      const cyan = new THREE.Color(0.55, 0.92, 1.0);
      const blue = new THREE.Color(0.12, 0.38, 1.0);
      const deep = new THREE.Color(0.08, 0.12, 0.6);
      const headR = 0.52; // in units of half-width
      const headY = 0.15;
      const canvas = paintPixels(W, H, (x, y, out) => {
        const u = (x / (W - 1) - 0.5) * 2;
        const v = y / (H - 1);
        const dy = (v - headY) * (H / W) * 2;
        const dh = Math.hypot(u, dy) / headR;
        let c = null;
        let a = 0;
        // Tail: tapered flame with jagged, flickering edges.
        if (v > headY - 0.02) {
          const t = clamp((v - headY) / (1 - headY), 0, 1);
          const jag = (noise.fbm(u * 3 + 11, v * 22, 2) - 0.5) * 0.5 + Math.sin(v * 70 + Math.abs(u) * 4) * 0.08;
          const width = lerp(0.6, 0.03, Math.pow(t, 0.7)) * (1 + jag);
          const across = Math.abs(u) / Math.max(width, 0.02);
          if (across < 1) {
            const inner = 1 - across;
            c = deep.clone().lerp(blue, smoothstep(0.0, 0.35, inner)).lerp(cyan, smoothstep(0.45, 0.8, inner) * (1 - t * 0.6)).lerp(white, smoothstep(0.82, 1.0, inner) * (1 - t));
            a = smoothstep(0, 0.25, inner) * smoothstep(1, 0.55, t) * 0.95;
          }
        }
        // Head ring on top of the tail.
        if (dh < 1.18) {
          const hc = violet.clone().lerp(magenta, smoothstep(1.15, 0.92, dh)).lerp(white, smoothstep(0.62, 0.38, dh));
          const ha = smoothstep(1.18, 1.05, dh);
          c = c ? c.lerp(hc, ha) : hc;
          a = Math.max(a, ha);
        }
        if (!c) { out[3] = 0; return; }
        out[0] = c.r; out[1] = c.g; out[2] = c.b; out[3] = a;
      });
      return canvasToTexture(canvas, { srgb: true });
    });
  }

  /** Orange tracer bullet: white-yellow core, orange body, fading trail (alpha blended, baked color). */
  tracerBolt() {
    return this.get('tracerBolt', () => {
      const W = 48;
      const H = 256;
      const white = new THREE.Color(1, 0.98, 0.85);
      const yellow = new THREE.Color(1, 0.82, 0.25);
      const orange = new THREE.Color(1, 0.42, 0.06);
      const canvas = paintPixels(W, H, (x, y, out) => {
        const u = Math.abs(x / (W - 1) - 0.5) * 2;
        const v = y / (H - 1);
        const headY = 0.1;
        const width = v < headY ? Math.sqrt(Math.max(0, 1 - ((headY - v) / headY) ** 2)) * 0.75 : lerp(0.75, 0.08, smoothstep(headY, 1, v));
        const across = u / Math.max(width, 0.01);
        if (across >= 1) { out[3] = 0; return; }
        const inner = 1 - across;
        const fade = smoothstep(1, 0.35, v);
        const c = orange.clone().lerp(yellow, smoothstep(0.2, 0.6, inner)).lerp(white, smoothstep(0.65, 0.95, inner) * smoothstep(0.7, 0.1, v));
        out[0] = c.r; out[1] = c.g; out[2] = c.b;
        out[3] = smoothstep(0, 0.3, inner) * fade;
      });
      return canvasToTexture(canvas, { srgb: true });
    });
  }

  /** Motion-blurred rotor: four smeared blades with yellow tips over a faint disc. */
  rotorDisc() {
    return this.get('rotorDisc', () => {
      const S = 512;
      const blades = 4;
      const canvas = paintPixels(S, S, (x, y, out) => {
        const u = x / S - 0.5;
        const v = y / S - 0.5;
        const r = Math.hypot(u, v) * 2;
        if (r > 1 || r < 0.06) {
          out[3] = 0;
          return;
        }
        const ang = Math.atan2(v, u);
        const sector = (Math.PI * 2) / blades;
        // Distance behind the nearest blade along the rotation direction.
        let phase = ((ang % sector) + sector) % sector;
        const width = 0.13 / Math.max(r, 0.3);
        const core = Math.exp(-((phase / width) ** 2)) + Math.exp(-(((sector - phase) / width) ** 2));
        const tail = Math.exp(-phase / 0.6) * 0.62;
        const blade = Math.min(1, core * 0.9 + tail);
        const tip = smoothstep(0.88, 0.9, r) * smoothstep(0.99, 0.95, r);
        const disc = 0.07 + tip * 0.1;
        const a = clamp(disc + blade * (0.8 + tip * 0.2), 0, 0.97) * smoothstep(1.0, 0.97, r);
        out[0] = lerp(0.1, 1.0, tip);
        out[1] = lerp(0.11, 0.78, tip);
        out[2] = lerp(0.12, 0.12, tip);
        out[3] = a;
      });
      return canvasToTexture(canvas, { srgb: true });
    });
  }

  /** White five-point star decal. */
  starDecal() {
    return this.get('star', () => {
      const S = 128;
      const canvas = createCanvas(S, S);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, S, S);
      ctx.fillStyle = '#f6f6f0';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? S * 0.46 : S * 0.19;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const px = S / 2 + Math.cos(a) * r;
        const py = S / 2 + Math.sin(a) * r * 1.0;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      return canvasToTexture(canvas, { srgb: true });
    });
  }

  /** Red banner with a white faction emblem (diamond + wings) for the train. */
  banner() {
    return this.get('banner', () => {
      const W = 128;
      const H = 192;
      const canvas = createCanvas(W, H);
      const ctx = canvas.getContext('2d');
      // Swallow-tail silhouette (transparent notch at the bottom; material uses alphaTest).
      const shape = (inset) => {
        ctx.beginPath();
        ctx.moveTo(inset, inset);
        ctx.lineTo(W - inset, inset);
        ctx.lineTo(W - inset, H - inset);
        ctx.lineTo(W / 2, H - 34 + inset * 0.6);
        ctx.lineTo(inset, H - inset);
        ctx.closePath();
      };
      shape(0);
      ctx.fillStyle = '#d8a43c'; // gold trim
      ctx.fill();
      shape(9);
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#c0161c');
      grad.addColorStop(1, '#7c0a10');
      ctx.fillStyle = grad;
      ctx.fill();
      // Dark top hem (where it hangs from the pole).
      ctx.fillStyle = '#3a0d0e';
      ctx.fillRect(9, 9, W - 18, 10);
      // White heraldic emblem: four-armed cross-flower with a centre diamond.
      ctx.fillStyle = '#f6f2ea';
      const cx = W / 2;
      const cy = H / 2 - 8;
      const arm = (dx, dy) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * 34 - dy * 10, cy + dy * 34 - dx * 10);
        ctx.lineTo(cx + dx * 44, cy + dy * 44);
        ctx.lineTo(cx + dx * 34 + dy * 10, cy + dy * 34 + dx * 10);
        ctx.closePath();
        ctx.fill();
      };
      arm(1, 0); arm(-1, 0); arm(0, 1); arm(0, -1);
      ctx.fillRect(cx - 8, cy - 22, 16, 44);
      ctx.fillRect(cx - 22, cy - 8, 44, 16);
      ctx.fillStyle = '#9c1016';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 10);
      ctx.lineTo(cx + 10, cy);
      ctx.lineTo(cx, cy + 10);
      ctx.lineTo(cx - 10, cy);
      ctx.closePath();
      ctx.fill();
      return canvasToTexture(canvas, { srgb: true });
    });
  }

  /** Vertical foamy streaks for waterfalls (tiles along V). */
  waterfall() {
    return this.get('waterfall', () => {
      const W = 64;
      const H = 256;
      const noise = new ValueNoise2D(new Random(808), 32);
      const canvas = paintPixels(W, H, (x, y, out) => {
        const n = noise.fbm((x / W) * 16, (y / H) * 3, 4);
        const streak = smoothstep(0.35, 0.75, n);
        const edge = Math.min(x, W - 1 - x) / (W * 0.5);
        const a = smoothstep(0, 0.35, edge) * (0.55 + streak * 0.45);
        const c = lerp(0.78, 1.0, streak);
        out[0] = c * 0.93;
        out[1] = c * 0.97;
        out[2] = c;
        out[3] = a;
      });
      return canvasToTexture(canvas, { srgb: true, repeat: true });
    });
  }

  /** Gravel bed for the railway (world-UV mapped). */
  gravel() {
    return this.get('gravel', () => {
      const S = 256;
      const rng = new Random(616);
      const noise = new ValueNoise2D(rng, 64);
      const height = new Float32Array(S * S);
      const map = paintPixels(S, S, (x, y, out) => {
        const n = noise.fbm(x * 0.25, y * 0.25, 2);
        const n2 = noise.fbm(x * 0.06, y * 0.06, 3);
        const pebble = smoothstep(0.45, 0.6, n);
        const v = 0.42 + pebble * 0.22 + (n2 - 0.5) * 0.2;
        out[0] = v * 1.02;
        out[1] = v * 0.98;
        out[2] = v * 0.93;
        height[y * S + x] = pebble;
      });
      const normal = heightToNormalCanvas(height, S, S, 2.0, true);
      return {
        map: canvasToTexture(map, { srgb: true, repeat: true, anisotropy: this.maxAnisotropy }),
        normalMap: canvasToTexture(normal, { srgb: false, repeat: true, anisotropy: this.maxAnisotropy }),
      };
    });
  }

  /** Bumpy snow normal map (tileable). */
  snowNormal() {
    return this.get('snowNormal', () => {
      const S = 128;
      const noise = new ValueNoise2D(new Random(31), 16);
      const h = new Float32Array(S * S);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) h[y * S + x] = noise.fbm((x / S) * 16, (y / S) * 16, 4);
      }
      return canvasToTexture(heightToNormalCanvas(h, S, S, 4, true), { srgb: false, repeat: true });
    });
  }

  /** Sun glare with anamorphic rays. */
  sunGlare() {
    return this.get('sunGlare', () => {
      const S = 512;
      const canvas = paintPixels(S, S, (x, y, out) => {
        const u = x / S - 0.5;
        const v = y / S - 0.5;
        const r = Math.hypot(u, v) * 2;
        const ang = Math.atan2(v, u);
        const core = Math.exp(-r * r * 60);
        const halo = Math.exp(-r * 4.5) * 0.55;
        const rays = Math.pow(Math.abs(Math.cos(ang * 6 + 0.3)), 60) * Math.exp(-r * 3.2) * 0.7;
        const rays2 = Math.pow(Math.abs(Math.cos(ang * 9 + 1.1)), 90) * Math.exp(-r * 2.4) * 0.45;
        const a = clamp(core + halo + rays + rays2, 0, 1) * smoothstep(1, 0.8, r);
        out[0] = a;
        out[1] = a * 0.95;
        out[2] = a * 0.82;
        out[3] = a;
      });
      return canvasToTexture(canvas, { srgb: false });
    });
  }

  /** Simple tileable rock strata texture for floating-island cliffs. */
  cliff() {
    return this.get('cliff', () => {
      const S = 256;
      const rng = new Random(2024);
      const noise = new ValueNoise2D(rng, 32);
      const height = new Float32Array(S * S);
      const map = paintPixels(S, S, (x, y, out) => {
        const strata = noise.fbm(x * 0.01, y * 0.08, 3);
        const vert = noise.fbm(x * 0.12, y * 0.012, 3);
        const blocks = Math.min((x % 64), (y % 48));
        const crack = 1 - smoothstep(0, 2, blocks + (noise.fbm(x * 0.1, y * 0.1, 2) - 0.5) * 6);
        let v = 0.78 + (strata - 0.5) * 0.25 + (vert - 0.5) * 0.3;
        v *= 1 - crack * 0.35;
        out[0] = v;
        out[1] = v * 0.96;
        out[2] = v * 0.9;
        height[y * S + x] = v - crack * 0.3;
      });
      const normal = heightToNormalCanvas(height, S, S, 3, true);
      return {
        map: canvasToTexture(map, { srgb: true, repeat: true, anisotropy: this.maxAnisotropy }),
        normalMap: canvasToTexture(normal, { srgb: false, repeat: true, anisotropy: this.maxAnisotropy }),
      };
    });
  }
}
