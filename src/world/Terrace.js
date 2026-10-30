import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GameConfig } from '../config/GameConfig.js';
import { Board } from './Board.js';
import { applyBoxWorldUVs } from '../util/GeometryUtils.js';
import { Random } from '../util/Random.js';

/**
 * Stage 2 "Terrace": a wide tiled platform the railway runs straight through, with stone
 * balconies (balustrades on three sides, corbels underneath) jutting out over the clouds on
 * the left and the right, lamp posts and a few crate stacks. Shores / pines around it are
 * added by World together with the stage-1 shores.
 */
export class Terrace {
  constructor(materials, floorTexture) {
    const spec = GameConfig.stages.terrace;
    this.bounds = { minX: spec.minX, maxX: spec.maxX, minZ: spec.minZ, maxZ: spec.maxZ };
    this.board = new Board(materials, floorTexture, spec);
    this.group = new THREE.Group();
    this.group.add(this.board.group);
    const stone = materials.voxel('balustrade', { voxelSize: 0.18, jitter: 0.1, seam: 0.12, params: { color: 0xe4dccb, roughness: 0.78, metalness: 0, vertexColors: false } });
    const parts = [];
    const add = (geo, x, y, z) => {
      geo.translate(x, y, z);
      parts.push(geo);
    };
    const fw = spec.frameWidth;
    const top = spec.frameHeight * 0.55;
    const rng = new Random(2077);
    // Two balconies per side, each a slab sticking out past the frame.
    const depth = 3.4;
    const width = 6.5;
    const zs = [spec.minZ + (spec.maxZ - spec.minZ) * 0.3, spec.minZ + (spec.maxZ - spec.minZ) * 0.72];
    this.balconies = [];
    for (const side of [-1, 1]) {
      const edge = side < 0 ? spec.minX - fw : spec.maxX + fw;
      for (const z of zs) {
        const cx = edge + side * depth / 2;
        this.balconies.push({ x: cx, z, w: depth, d: width });
        add(new RoundedBoxGeometry(depth + 0.2, 0.55, width, 2, 0.12), cx - side * 0.1, -0.27, z);
        add(new RoundedBoxGeometry(depth + 0.4, 0.16, width + 0.3, 2, 0.06), cx - side * 0.05, 0.04, z);
        // Corbels underneath.
        for (let i = 0; i < 4; i++) {
          const cz = z - width / 2 + 0.7 + (i * (width - 1.4)) / 3;
          for (let k = 0; k < 3; k++) {
            const w = 0.9 - k * 0.25;
            add(new RoundedBoxGeometry(w * depth * 0.4, 0.42, 0.5, 1, 0.08), edge + side * (w * depth * 0.2), -0.75 - k * 0.42, cz);
          }
        }
        // Balustrade: balusters + handrail on the outer side and both ends.
        const rail = (x0, z0, x1, z1) => {
          const len = Math.hypot(x1 - x0, z1 - z0);
          const n = Math.max(2, Math.round(len / 0.42));
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            const g = new THREE.CylinderGeometry(0.09, 0.12, 0.62, 8);
            add(g, x0 + (x1 - x0) * t, 0.43, z0 + (z1 - z0) * t);
          }
          const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
          add(new RoundedBoxGeometry(along ? len + 0.3 : 0.3, 0.16, along ? 0.3 : len + 0.3, 2, 0.05), (x0 + x1) / 2, 0.8, (z0 + z1) / 2);
          add(new RoundedBoxGeometry(along ? len + 0.2 : 0.26, 0.1, along ? 0.26 : len + 0.2, 1, 0.03), (x0 + x1) / 2, 0.1, (z0 + z1) / 2);
        };
        const outer = edge + side * (depth - 0.15);
        rail(outer, z - width / 2 + 0.15, outer, z + width / 2 - 0.15);
        rail(edge + side * 0.2, z - width / 2 + 0.15, outer, z - width / 2 + 0.15);
        rail(edge + side * 0.2, z + width / 2 - 0.15, outer, z + width / 2 - 0.15);
        // Corner posts.
        for (const [px, pz] of [[outer, z - width / 2 + 0.15], [outer, z + width / 2 - 0.15]]) add(new RoundedBoxGeometry(0.4, 1.05, 0.4, 2, 0.06), px, 0.42, pz);
      }
    }
    const balconyGeometry = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
    applyBoxWorldUVs(balconyGeometry, 4, new THREE.Vector3(), 'z');
    const balconies = new THREE.Mesh(balconyGeometry, stone);
    balconies.castShadow = true;
    balconies.receiveShadow = true;
    this.group.add(balconies);

    // Lamp posts along the balcony rails (warm glowing lanterns) and crate stacks as cover.
    const lampParts = [];
    const glowParts = [];
    for (const b of this.balconies) {
      for (const dz of [-b.d / 2 + 0.15, b.d / 2 - 0.15]) {
        const outerX = b.x + Math.sign(b.x - 3) * (b.w / 2 - 0.15);
        const post = new THREE.CylinderGeometry(0.07, 0.09, 2.1, 8);
        post.translate(outerX, 1.0 + top * 0, b.z + dz);
        lampParts.push(post);
        const cap = new RoundedBoxGeometry(0.34, 0.12, 0.34, 1, 0.03);
        cap.translate(outerX, 2.35, b.z + dz);
        lampParts.push(cap);
        const lantern = new THREE.BoxGeometry(0.24, 0.3, 0.24);
        lantern.translate(outerX, 2.15, b.z + dz);
        glowParts.push(lantern);
      }
    }
    const lamps = new THREE.Mesh(mergeGeometries(lampParts.map((g) => (g.index ? g.toNonIndexed() : g))), materials.rail());
    lamps.castShadow = true;
    this.group.add(lamps);
    const glow = new THREE.Mesh(mergeGeometries(glowParts), new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb860, emissiveIntensity: 2.2, roughness: 0.4 }));
    this.group.add(glow);
    // Stone planters with pines in the corners (trees are placed by World).
    this.treePlacements = [];
    const planterParts = [];
    const tx = GameConfig.track.x;
    for (const [x, z] of [[spec.minX + 2.4, spec.minZ + 2.4], [spec.maxX - 2.4, spec.minZ + 2.4], [spec.minX + 2.4, spec.maxZ - 2.6], [spec.maxX - 2.4, spec.maxZ - 2.6], [tx - 6.5, (spec.minZ + spec.maxZ) / 2], [tx + 6.5, (spec.minZ + spec.maxZ) / 2]]) {
      const g = new RoundedBoxGeometry(2.2, 0.8, 2.2, 2, 0.1);
      g.translate(x, 0.4, z);
      planterParts.push(g);
      const soil = new RoundedBoxGeometry(1.8, 0.1, 1.8, 1, 0.03);
      soil.translate(x, 0.78, z);
      planterParts.push(soil);
      this.treePlacements.push({ x, y: 0.8, z, scale: 0.9 + rng.next() * 0.25, rot: rng.next() * 6, variant: Math.floor(rng.next() * 3) });
    }
    const planterGeometry = mergeGeometries(planterParts);
    applyBoxWorldUVs(planterGeometry, 4, new THREE.Vector3(), 'x');
    const planters = new THREE.Mesh(planterGeometry, stone);
    planters.castShadow = true;
    planters.receiveShadow = true;
    this.group.add(planters);
    const crateParts = [];
    for (const [x, z, h] of [[-11, -62, 2], [-12.4, -62.4, 1], [17.5, -80, 2], [18.2, -78.5, 1], [-11.6, -80.5, 1], [16.8, -61.5, 1]]) {
      for (let k = 0; k < h; k++) {
        const g = new RoundedBoxGeometry(1.2, 1.2, 1.2, 2, 0.08);
        g.rotateY(rng.spread(0.3));
        g.translate(x + rng.spread(0.1), 0.6 + k * 1.2, z + rng.spread(0.1));
        crateParts.push(g);
      }
    }
    const crateGeometry = mergeGeometries(crateParts);
    applyBoxWorldUVs(crateGeometry, 3, new THREE.Vector3(), 'x');
    const crates = new THREE.Mesh(crateGeometry, materials.wood());
    crates.castShadow = true;
    crates.receiveShadow = true;
    this.group.add(crates);
  }

  /** Rock shelves with pines tucked around the terrace (world space). */
  static shoreSpecs() {
    const t = GameConfig.stages.terrace;
    return [
      { x: t.minX - 6.5, y: -1.2, z: t.minZ - 4, radius: 5, depth: 7, cell: 1, seed: 611, waterfalls: 1, treeDensity: 0.55, treeScale: 1.1, mesa: 0.6, cliff: true },
      { x: t.maxX + 6.5, y: -1.4, z: t.minZ + 2, radius: 4.6, depth: 6, cell: 1, seed: 613, waterfalls: 1, treeDensity: 0.55, treeScale: 1.1, mesa: 0.6, cliff: true },
      { x: t.maxX + 5, y: -1.0, z: t.maxZ + 3.5, radius: 3.4, depth: 5, cell: 1, seed: 617, waterfalls: 0, treeDensity: 0.6, treeScale: 1.0, mesa: 0.5, cliff: true },
      { x: t.minX - 4, y: -0.8, z: t.maxZ + 4.5, radius: 3.2, depth: 5, cell: 1, seed: 619, waterfalls: 1, treeDensity: 0.5, treeScale: 1.0, mesa: 0.5, cliff: true },
      { x: 3 + 7.5, y: -1.6, z: (t.maxZ + GameConfig.board.minZ) / 2, radius: 3.6, depth: 6, cell: 1, seed: 621, waterfalls: 1, treeDensity: 0.5, treeScale: 1.0, mesa: 0.5, cliff: true },
      { x: 3 - 8, y: -2, z: (t.maxZ + GameConfig.board.minZ) / 2 - 10, radius: 4, depth: 6, cell: 1, seed: 623, waterfalls: 1, treeDensity: 0.5, treeScale: 1.0, mesa: 0.5, cliff: true },
    ];
  }
}
