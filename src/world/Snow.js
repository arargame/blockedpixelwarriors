import * as THREE from 'three';
import { BillboardBatch } from '../fx/BillboardBatch.js';
import { VoxelModelBuilder } from '../util/VoxelModelBuilder.js';
import { Palette } from '../config/Palette.js';
import { Random, fxRandom as rnd } from '../util/Random.js';

/**
 * Shared weather state: light snowfall that comes and goes in slow waves.
 * `intensity` (0..1) drives both the falling flakes and how fast snow builds up on the rails.
 */
export class SnowWeather {
  constructor() {
    this.time = 0;
    this.intensity = 0.6;
    /** 0..1 snow burst: every so often the snowfall suddenly thickens and speeds up. */
    this.gust = 0;
    this.gustTimer = 12 + Math.random() * 15;
    this.gustLength = 0;
  }

  update(dt) {
    this.time += dt;
    // Two slow overlapping waves -> snow showers that thicken, ease off and return.
    const w = Math.sin(this.time * 0.05) * 0.6 + Math.sin(this.time * 0.13 + 1.3) * 0.4;
    const base = THREE.MathUtils.clamp(0.45 + w * 0.55, 0, 1);
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustLength = 5 + Math.random() * 7;
      this.gustTimer = this.gustLength + 15 + Math.random() * 25;
    }
    this.gustLength -= dt;
    this.gust += ((this.gustLength > 0 ? 1 : 0) - this.gust) * (1 - Math.exp(-1.2 * dt));
    this.intensity = Math.max(base, this.gust);
  }
}

/**
 * Very light snowfall: small soft flakes drifting down through a volume around the board,
 * swaying sideways; flakes wrap to the top when they fall below the board.
 */
export class SnowFall {
  /**
   * @param {THREE.Texture} texture soft round sprite
   * @param {SnowWeather} weather
   * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds board bounds
   * @param {number} count
   */
  constructor(texture, weather, bounds, count = 700) {
    this.weather = weather;
    this.batch = new BillboardBatch(texture, count, { additive: false, renderOrder: 17 });
    this.object3d = this.batch.mesh;
    const rng = new Random(4242);
    this.box = { x0: bounds.minX - 8, x1: bounds.maxX + 8, z0: bounds.minZ - 8, z1: bounds.maxZ + 6, y0: -2, y1: 14 };
    this.flakes = Array.from({ length: count }, () => ({
      x: rng.range(this.box.x0, this.box.x1),
      y: rng.range(this.box.y0, this.box.y1),
      z: rng.range(this.box.z0, this.box.z1),
      speed: rng.range(0.6, 1.3),
      size: rng.range(0.08, 0.15),
      phase: rng.range(0, 6.28),
      sway: rng.range(0.2, 0.6),
      threshold: rng.next(),
    }));
    this.time = 0;
  }

  update(dt) {
    this.time += dt;
    const b = this.box;
    const visible = this.weather.intensity;
    this.batch.begin();
    for (const f of this.flakes) {
      const gust = this.weather.gust;
      f.y -= f.speed * (1 + gust * 2.2) * dt;
      f.x += gust * 2.5 * dt;
      f.x += Math.sin(this.time * 0.8 + f.phase) * f.sway * dt + 0.15 * dt;
      f.z += Math.cos(this.time * 0.6 + f.phase) * f.sway * 0.5 * dt;
      if (f.y < b.y0) {
        f.y = b.y1;
        f.x = b.x0 + Math.random() * (b.x1 - b.x0);
        f.z = b.z0 + Math.random() * (b.z1 - b.z0);
      }
      if (f.x > b.x1) f.x = b.x0;
      // Only a fraction of the flakes show at low intensity (keeps it "very light").
      if (f.threshold > visible) continue;
      this.batch.push(f.x, f.y, f.z, f.size, f.size, 1.25, 1.28, 1.35, 0.85);
    }
    this.batch.end();
  }
}

/**
 * Snow lying on the railway inside the board. Each sleeper span holds a snow depth (0..1)
 * that builds up while it snows and slowly melts when it stops. The train plows it away:
 * spans under the cars are cleared and the locomotive throws a snow spray off the rails.
 */
export class RailSnow {
  /**
   * @param {import('../textures/MaterialLibrary.js').MaterialLibrary} materials
   * @param {SnowWeather} weather
   * @param {{x:number, railTop:number}} track
   * @param {number} z0 first span (board far edge)
   * @param {number} z1 last span (board near edge)
   */
  constructor(materials, weather, track, z0, z1) {
    this.weather = weather;
    this.track = track;
    this.spacing = 0.72;
    const count = Math.floor((z1 - z0) / this.spacing);
    const rng = new Random(9090);
    // Patchy snow: each span has its own random cap (some stay bare), so the track never looks
    // uniformly white. Neighbouring spans share a slow random wave so drifts form in patches.
    const patch = (i) => Math.sin(i * 0.37 + rng.next() * 0.4) * 0.5 + Math.sin(i * 0.11 + 2.1) * 0.35 + rng.range(-0.3, 0.3);
    this.rng = rng;
    this.spans = Array.from({ length: count }, (_, i) => ({
      z: z0 + (i + 0.5) * this.spacing,
      cap: THREE.MathUtils.clamp(0.35 + patch(i), 0, 1),
      depth: 0,
      cooldown: 0,
      rate: rng.range(0.4, 1.4),
      variant: rng.int(0, 2),
      rot: rng.chance(0.5) ? 0 : Math.PI,
    }));
    const geometries = [this.buildMound(11), this.buildMound(23), this.buildMound(37)];
    this.meshes = geometries.map((g) => {
      const mesh = new THREE.InstancedMesh(g, materials.snow(), count);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      return mesh;
    });
    this.group = new THREE.Group();
    this.meshes.forEach((m) => this.group.add(m));
    this.dummy = new THREE.Object3D();
    this.sprayTimer = 0;
    for (const sp of this.spans) sp.depth = sp.cap * rng.range(0.3, 0.9);
    this.write();
  }

  /** Lumpy snow drift for one sleeper span (unit length along Z, ~2.8 wide), base at y=0. */
  buildMound(seed) {
    const rng = new Random(seed);
    const b = new VoxelModelBuilder({ bevel: 0.03, segments: 2 });
    // Drifts pile against the outside of each rail and fill the gauge between them.
    for (const x of [-1.25, -0.55, 0, 0.55, 1.25]) {
      const n = rng.int(1, 2);
      for (let i = 0; i < n; i++) {
        const r = rng.range(0.28, 0.42) * (Math.abs(x) > 1 ? 0.8 : 1);
        b.sphere([x + rng.spread(0.12), r * 0.15, rng.spread(0.25)], 1, Palette.snow, { detail: 2, scale: [r, r * rng.range(0.38, 0.55), r * rng.range(0.9, 1.3)] });
      }
    }
    return b.buildGeometries().get('body');
  }

  /**
   * @param {number} dt
   * @param {import('../entities/Train.js').Train|null} train
   * @param {import('../fx/EffectsManager.js').EffectsManager} effects
   */
  update(dt, train, effects) {
    const snowing = this.weather.intensity;
    // Without snowfall only a thin random dusting stays; heavier showers fill spans to their cap.
    const capScale = 0.18 + 0.82 * THREE.MathUtils.smoothstep(snowing, 0.1, 0.8);
    const build = 0.01 + 0.04 * snowing;
    let headZ = -Infinity;
    let tailZ = -Infinity;
    if (train) {
      headZ = train.maxZ + (train.dir > 0 ? 0.6 : 0);
      tailZ = train.minZ - (train.dir < 0 ? 0.6 : 0);
    }
    let plowed = 0;
    for (const s of this.spans) {
      if (s.z <= headZ && s.z >= tailZ) {
        // Under the train: the hot wheels and plow melt / throw the snow off the span.
        const before = s.depth;
        s.depth = s.depth < 0.04 ? 0 : s.depth * Math.exp(-11 * dt);
        s.cooldown = this.rng.range(2, 9);
        if (train.dir > 0 ? s.z > headZ - 1.6 : s.z < tailZ + 1.6) plowed += before - s.depth;
        if (before > 0.05 && Math.random() < dt * 3) effects.smoke.emit({
          x: this.track.x + (Math.random() - 0.5) * 2, y: 0.5, z: s.z, vy: 1.2, drag: 1,
          life: 0.9, size0: 0.4, size1: 1.3, color0: [1.2, 1.22, 1.26, 0.5], color1: [1.2, 1.2, 1.25, 0],
        });
      } else if (s.cooldown > 0) {
        s.cooldown -= dt;
        // Each refill draws a new random amount, so the pattern changes after every train.
        if (s.cooldown <= 0) s.cap = THREE.MathUtils.clamp(s.cap + this.rng.range(-0.35, 0.35), 0, 1);
      } else {
        const target = s.cap * capScale;
        if (s.depth < target) s.depth = Math.min(target, s.depth + build * s.rate * dt);
        else s.depth = Math.max(target, s.depth - 0.02 * dt); // slow melt back to the dusting
      }
    }
    // Plow spray: snow thrown off both sides of the locomotive front, scaled by what it cleared.
    this.sprayTimer -= dt;
    if (train && plowed > 0.002 && this.sprayTimer <= 0) {
      this.sprayTimer = 0.03;
      const n = Math.min(6, 1 + Math.floor(plowed * 140));
      for (let i = 0; i < n; i++) {
        const side = rnd.chance(0.5) ? -1 : 1;
        effects.smoke.emit({
          x: this.track.x + side * rnd.range(0.9, 1.5), y: 0.45, z: train.headZ + train.dir * rnd.range(0.2, 0.9),
          vx: side * rnd.range(2.5, 5), vy: rnd.range(1.5, 3.5), vz: train.dir * (train.speed + rnd.range(0.5, 2)), drag: 1.6, gravity: 2.5,
          life: rnd.range(0.5, 0.9), size0: 0.3, size1: rnd.range(0.9, 1.5), color0: [1.3, 1.34, 1.4, 0.95], color1: [1.25, 1.3, 1.35, 0],
        });
      }
    }
    this.write();
  }

  write() {
    const counts = [0, 0, 0];
    const d = this.dummy;
    for (const s of this.spans) {
      if (s.depth < 0.04) continue;
      const mesh = this.meshes[s.variant];
      d.position.set(this.track.x, 0.3, s.z);
      d.rotation.set(0, s.rot, 0);
      d.scale.set(0.55 + s.depth * 0.45, 0.25 + s.depth * 1.1, 0.75 + s.depth * 0.25);
      d.updateMatrix();
      mesh.setMatrixAt(counts[s.variant]++, d.matrix);
    }
    this.meshes.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
    });
  }
}
