import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GameConfig } from '../config/GameConfig.js';
import { Palette } from '../config/Palette.js';
import { applyBoxWorldUVs } from '../util/GeometryUtils.js';
import { Random } from '../util/Random.js';

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
    const length = t.endZ - t.startZ;
    const centerZ = (t.startZ + t.endZ) / 2;

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
      dummy.position.set(t.x + rng.spread(0.04), 0.33, t.startZ + i * spacing + spacing / 2);
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
  }
}
