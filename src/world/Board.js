import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GameConfig } from '../config/GameConfig.js';
import { applyBoxWorldUVs } from '../util/GeometryUtils.js';
import { createTileFloorMaterial } from '../textures/TileFloorMaterial.js';

/**
 * The floating play area: a chunky wooden frame around a "sky floor" made of
 * clouds. Exposes the playable bounds and ground height queries.
 */
export class Board {
  /** @param {import('../textures/MaterialLibrary.js').MaterialLibrary} materials */
  /**
   * @param {import('../textures/MaterialLibrary.js').MaterialLibrary} materials
   * @param {THREE.Texture|null} [floorTexture] marble photo for the tiled floor (cloud floor if null)
   */
  constructor(materials, floorTexture = null, spec = GameConfig.board) {
    const b = spec;
    this.bounds = { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
    this.group = new THREE.Group();

    // Floor: polished marble porcelain tiles laid in rows/columns on the block grid
    // (falls back to the old sky/cloud floor if no texture was provided).
    const width = b.maxX - b.minX;
    const depth = b.maxZ - b.minZ;
    let floorMaterial;
    if (floorTexture) {
      floorMaterial = createTileFloorMaterial(floorTexture, {
        origin: new THREE.Vector2(b.minX, b.minZ),
        tileSize: GameConfig.floor.tileSize,
      });
      floorMaterial.userData.tileUniforms.uImageAspect.value = floorTexture.image.width / floorTexture.image.height;
    } else {
      floorMaterial = materials.cloudFloor();
      floorMaterial.map.repeat.set(width / 14, depth / 14);
    }
    this.floorMaterial = floorMaterial;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    floor.receiveShadow = true;
    this.group.add(floor);

    // Underside slab so the board reads as a floating object from any angle.
    const under = new THREE.Mesh(new THREE.BoxGeometry(width + 1.6, 0.6, depth + 1.6), materials.wood());
    under.position.set(floor.position.x, -0.62, floor.position.z);
    under.receiveShadow = true;
    this.group.add(under);

    this.group.add(this.buildFrame(materials, b));
  }

  buildFrame(materials, b) {
    const fw = b.frameWidth;
    const top = b.frameHeight * 0.55;
    const bottom = -0.95;
    const h = top - bottom;
    const cy = (top + bottom) / 2;
    const trackX = GameConfig.track.x;
    const gap = 2.2; // opening for the railway at both ends
    const beams = [];
    const addBeam = (x0, x1, z0, z1, longAxis) => {
      const g = new RoundedBoxGeometry(x1 - x0, h, z1 - z0, 2, 0.12);
      g.translate((x0 + x1) / 2, cy, (z0 + z1) / 2);
      applyBoxWorldUVs(g, 8, new THREE.Vector3(), longAxis);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 4);
      beams.push(g);
    };
    const x0 = b.minX - fw;
    const x1 = b.maxX + fw;
    // Far and near beams are split around the railway.
    addBeam(x0, trackX - gap, b.minZ - fw, b.minZ, 'x');
    addBeam(trackX + gap, x1, b.minZ - fw, b.minZ, 'x');
    addBeam(x0, trackX - gap, b.maxZ, b.maxZ + fw, 'x');
    addBeam(trackX + gap, x1, b.maxZ, b.maxZ + fw, 'x');
    addBeam(x0, b.minX, b.minZ, b.maxZ, 'z');
    addBeam(b.maxX, x1, b.minZ, b.maxZ, 'z');

    // Inner lip trim (darker, slightly lower) adds a second bevel step like a crate.
    const lip = [];
    const addLip = (lx0, lx1, lz0, lz1) => {
      const g = new RoundedBoxGeometry(lx1 - lx0, 0.35, lz1 - lz0, 2, 0.08);
      g.translate((lx0 + lx1) / 2, 0.12, (lz0 + lz1) / 2);
      applyBoxWorldUVs(g, 8, new THREE.Vector3(), Math.abs(lx1 - lx0) > Math.abs(lz1 - lz0) ? 'x' : 'z');
      lip.push(g);
    };
    const l = 0.28;
    addLip(b.minX, trackX - gap, b.minZ, b.minZ + l);
    addLip(trackX + gap, b.maxX, b.minZ, b.minZ + l);
    addLip(b.minX, b.minX + l, b.minZ, b.maxZ);
    addLip(b.maxX - l, b.maxX, b.minZ, b.maxZ);
    addLip(b.minX, trackX - gap, b.maxZ - l, b.maxZ);
    addLip(trackX + gap, b.maxX, b.maxZ - l, b.maxZ);

    const group = new THREE.Group();
    const frame = new THREE.Mesh(mergeGeometries(beams), materials.wood());
    frame.castShadow = true;
    frame.receiveShadow = true;
    group.add(frame);
    const lipMaterial = materials.wood().clone();
    lipMaterial.color = new THREE.Color(0.78, 0.68, 0.58);
    const lipMesh = new THREE.Mesh(mergeGeometries(lip), lipMaterial);
    lipMesh.receiveShadow = true;
    lipMesh.castShadow = true;
    group.add(lipMesh);
    return group;
  }

  contains(x, z, margin = 0) {
    const b = this.bounds;
    return x >= b.minX + margin && x <= b.maxX - margin && z >= b.minZ + margin && z <= b.maxZ - margin;
  }

  /** Floor height inside the board (0), or null outside (things fall into the sky). */
  groundHeightAt(x, z) {
    return this.contains(x, z) ? 0 : null;
  }
}
