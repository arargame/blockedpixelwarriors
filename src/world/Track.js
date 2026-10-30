import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GameConfig } from '../config/GameConfig.js';
import { Palette } from '../config/Palette.js';
import { applyBoxWorldUVs } from '../util/GeometryUtils.js';
import { Random } from '../util/Random.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Straight railway running along Z through the board: gravel bed, instanced
 * wooden sleepers and two steel rails. Beyond the board it continues on a
 * floating causeway so the train can arrive from and leave into the clouds.
 */
export class Track {
  /** @param {import('../textures/MaterialLibrary.js').MaterialLibrary} materials */
  constructor(materials) {
    const t = GameConfig.track;
    this.x = t.x;
    this.startZ = t.startZ;
    this.endZ = t.endZ;
    this.railTop = 0.42;
    this.group = new THREE.Group();
    // The rails run on far past the stage-1 line (terrace, Block Hauler approach).
    const z0 = t.meshStartZ ?? t.startZ;
    const length = t.endZ - z0;
    const centerZ = (z0 + t.endZ) / 2;

    const bedGeometry = new RoundedBoxGeometry(3.2, 0.5, length, 2, 0.15);
    bedGeometry.translate(t.x, 0.04, centerZ);
    applyBoxWorldUVs(bedGeometry, 3, new THREE.Vector3(), 'z');
    const bed = new THREE.Mesh(bedGeometry, materials.gravel());
    bed.receiveShadow = true;
    this.group.add(bed);

    // Sleepers.
    const spacing = 0.72;
    const count = Math.floor(length / spacing);
    const sleeperGeometry = new RoundedBoxGeometry(2.8, 0.18, 0.4, 1, 0.04);
    const sleepers = new THREE.InstancedMesh(sleeperGeometry, materials.sleeper(), count);
    const dummy = new THREE.Object3D();
    const rng = new Random(99);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      dummy.position.set(t.x + rng.spread(0.04), 0.33, z0 + i * spacing + spacing / 2);
      dummy.rotation.set(0, rng.spread(0.03), 0);
      dummy.updateMatrix();
      sleepers.setMatrixAt(i, dummy.matrix);
      sleepers.setColorAt(i, color.set(Palette.sleeper).multiplyScalar(rng.range(0.85, 1.15)));
    }
    sleepers.computeBoundingSphere();
    sleepers.castShadow = true;
    sleepers.receiveShadow = true;
    this.group.add(sleepers);

    // Rails.
    const railGeometry = new THREE.BoxGeometry(0.13, 0.16, length);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeometry, materials.rail());
      rail.position.set(t.x + side * t.gauge * 0.5, this.railTop - 0.04, centerZ);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.group.add(rail);
    }

    // Wooden trestle bridges where the line crosses open sky between the platforms.
    const b = GameConfig.board;
    const tr = GameConfig.stages.terrace;
    this.addTrestle(materials, tr.maxZ + 0.6, b.minZ - 1.2);
    this.addTrestle(materials, z0 + 1, tr.minZ - 0.6);
  }

  /**
   * Plank deck under the gravel bed, side stringers with a low railing, and bents (paired posts
   * with X bracing) every few metres dropping into the cloud sea.
   */
  addTrestle(materials, zA, zB) {
    const t = GameConfig.track;
    const len = zB - zA;
    if (len <= 1) return;
    const cz = (zA + zB) / 2;
    const parts = [];
    const add = (geo, x, y, z, rx = 0, rz = 0) => {
      geo.rotateX(rx);
      geo.rotateZ(rz);
      geo.translate(x, y, z);
      applyBoxWorldUVs(geo, 8, new THREE.Vector3(), 'z');
      parts.push(geo);
    };
    add(new RoundedBoxGeometry(3.9, 0.28, len, 2, 0.06), t.x, -0.36, cz);
    for (const side of [-1, 1]) {
      add(new RoundedBoxGeometry(0.34, 0.5, len, 2, 0.08), t.x + side * 1.95, -0.32, cz);
      add(new RoundedBoxGeometry(0.16, 0.16, len, 1, 0.04), t.x + side * 2.0, 0.62, cz);
    }
    const spacing = 5.2;
    const n = Math.max(1, Math.floor(len / spacing));
    for (let i = 0; i <= n; i++) {
      const z = zA + (i * len) / n;
      for (const side of [-1, 1]) {
        add(new RoundedBoxGeometry(0.42, 9, 0.42, 1, 0.08), t.x + side * 1.55, -5, z, 0, side * 0.06);
        add(new RoundedBoxGeometry(0.14, 0.62, 0.14, 1, 0.03), t.x + side * 2.0, 0.24, z);
      }
      add(new RoundedBoxGeometry(3.6, 0.32, 0.32, 1, 0.06), t.x, -1.1, z);
      add(new RoundedBoxGeometry(3.6, 0.28, 0.28, 1, 0.05), t.x, -5.5, z);
      // X bracing between the posts.
      for (const s of [-1, 1]) add(new RoundedBoxGeometry(0.16, 4.6, 0.16, 1, 0.03), t.x, -3.3, z, 0, s * 0.62);
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), materials.wood());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }
}
