import * as THREE from 'three';
import { VoxelModelBuilder } from '../util/VoxelModelBuilder.js';
import { Palette } from '../config/Palette.js';
import { Random } from '../util/Random.js';

/**
 * Builds chunky voxel pine trees (Factory). Trees are shared geometries rendered
 * through InstancedMesh, so hundreds of trees cost a couple of draw calls.
 */
export class PineTreeFactory {
  /** @param {import('../textures/MaterialLibrary.js').MaterialLibrary} materials */
  constructor(materials) {
    this.material = materials.voxel('pine', { voxelSize: 0.22, jitter: 0.22, seam: 0.18, params: { roughness: 0.85 } });
    this.geometries = [
      this.buildPine(7, { tiers: 7, height: 2.8, width: 1.15, branches: 5 }),
      this.buildPine(19, { tiers: 8, height: 3.2, width: 1.25, branches: 6 }),
      this.buildPine(41, { tiers: 6, height: 2.5, width: 1.3, branches: 5 }),
      this.buildPine(77, { tiers: 10, height: 4.2, width: 1.6, branches: 6 }),
    ];
  }

  /** One tree variant, base at y=0, roughly 1 unit wide and 2.6 tall. */
  buildGeometry(seed, tiers, heightScale = 1) {
    const rng = new Random(seed);
    const b = new VoxelModelBuilder({ bevel: 0.035 });
    b.box([0, 0.25, 0], [0.22, 0.5, 0.22], Palette.trunk);
    const dark = new THREE.Color(Palette.pineDark);
    const mid = new THREE.Color(Palette.pine);
    const light = new THREE.Color(Palette.pineLight);
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const w = THREE.MathUtils.lerp(1.15, 0.28, t);
      const y = 0.45 + i * ((2.0 * heightScale) / tiers);
      const h = (2.0 * heightScale) / tiers + 0.08;
      const rot = rng.spread(0.25);
      const base = mid.clone().lerp(dark, 0.35 + rng.next() * 0.2);
      b.box([0, y + h * 0.5, 0], [w, h, w], base, { rotation: [0, rot, 0] });
      // Lighter "needles" ledge on top of each tier.
      b.box([0, y + h * 0.92, 0], [w * 0.82, h * 0.22, w * 0.82], mid.clone().lerp(light, 0.4), { rotation: [0, rot + 0.785, 0] });
      // Jagged side voxels for an irregular silhouette.
      for (let k = 0; k < 3; k++) {
        const a = rng.range(0, Math.PI * 2);
        const r = w * 0.5;
        const s = w * rng.range(0.22, 0.32);
        b.box([Math.cos(a) * r, y + h * rng.range(0.2, 0.6), Math.sin(a) * r], [s, s * 0.8, s], dark.clone().lerp(mid, rng.next()), { rotation: [0, a, 0] });
      }
    }
    b.box([0, 0.45 + 2.0 * heightScale + 0.1, 0], [0.16, 0.3, 0.16], light);
    const geometry = b.buildGeometries().get('body');
    return geometry;
  }

  /**
   * Voxel pine in the key-art style: stepped tiers alternating 45 degrees, drooping branch tips
   * all around each tier, sunlit yellow-green tips on the sun side, darker shaded core,
   * slight lean and a snow-dusted top. Base at y=0.
   * @param {number} seed
   * @param {{tiers?: number, height?: number, width?: number, branches?: number}} [o]
   */
  buildPine(seed, { tiers = 8, height = 3.6, width = 1.4, branches = 5 } = {}) {
    const rng = new Random(seed);
    const b = new VoxelModelBuilder({ bevel: 0.04, segments: 1 });
    const dark = new THREE.Color(0x163818);
    const mid = new THREE.Color(0x2a6427);
    const lit = new THREE.Color(0x8cbc3e);
    const trunkH = height * 0.16;
    b.box([0, trunkH * 0.5, 0], [width * 0.17, trunkH, width * 0.17], 0x5b3a1f);
    const step = (height - trunkH) / tiers;
    const lean = rng.spread(0.06);
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const w = THREE.MathUtils.lerp(width, width * 0.18, Math.pow(t, 0.9)) * rng.range(0.92, 1.08);
      const y = trunkH * 0.7 + i * step;
      const ox = lean * i;
      const rot = (i % 2) * 0.785 + rng.spread(0.18);
      const h = step * 1.05;
      b.box([ox, y + h * 0.5, 0], [w, h, w], dark.clone().lerp(mid, 0.3 + rng.next() * 0.3), { rotation: [0, rot, 0] });
      b.box([ox, y + h * 0.95, 0], [w * 0.7, h * 0.24, w * 0.7], mid.clone().lerp(lit, 0.3 + t * 0.35), { rotation: [0, rot + 0.39, 0] });
      for (let k = 0; k < branches; k++) {
        const a = (k / branches) * Math.PI * 2 + rng.spread(0.5) + i;
        const r = w * 0.56;
        const s = w * rng.range(0.24, 0.32);
        const sunny = Math.cos(a - 3.9) > 0.1;
        const color = sunny ? mid.clone().lerp(lit, 0.45 + rng.next() * 0.35) : dark.clone().lerp(mid, rng.next() * 0.4);
        b.box([ox + Math.cos(a) * r, y + h * 0.15, Math.sin(a) * r], [s, s * 0.5, s * 0.75], color, { rotation: [0.3, -a, 0], bevel: 0 });
      }
    }
    b.box([lean * tiers, trunkH * 0.7 + tiers * step + 0.12, 0], [width * 0.1, 0.3, width * 0.1], lit);
    b.box([lean * tiers, trunkH * 0.7 + tiers * step - 0.02, 0], [width * 0.22, 0.08, width * 0.22], 0xf2f7ff); // snow dusting
    return b.buildGeometries().get('body');
  }

  /**
   * Creates instanced forests.
   * @param {Array<{x:number,y:number,z:number,scale:number,rot?:number,variant?:number}>} placements
   * @returns {THREE.Group}
   */
  createForest(placements, { castShadow = true, layer = null, tint = 1 } = {}) {
    const group = new THREE.Group();
    const dummy = new THREE.Object3D();
    this.geometries.forEach((geometry, variant) => {
      const list = placements.filter((p) => (p.variant ?? 0) % this.geometries.length === variant);
      if (list.length === 0) return;
      let material = this.material;
      if (tint !== 1) {
        material = this.material.clone();
        material.onBeforeCompile = this.material.onBeforeCompile;
        material.customProgramCacheKey = this.material.customProgramCacheKey;
        material.color.multiplyScalar(tint);
      }
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rot ?? 0, 0);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      if (layer !== null) mesh.layers.set(layer);
      group.add(mesh);
    });
    return group;
  }
}
