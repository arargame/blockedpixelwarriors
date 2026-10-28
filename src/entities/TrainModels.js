import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { VoxelModelBuilder } from '../util/VoxelModelBuilder.js';
import { Palette, BLOCK_COLOR_KEYS } from '../config/Palette.js';

const TB = Palette.trainBody;
const TBL = Palette.trainBodyLight;
const TD = Palette.trainDark;
const TBK = Palette.trainBlack;
const TR = Palette.trainRed;
const BR = Palette.trainBrass;
const RED_LIGHT = 0xff1a2a;

/**
 * Factory for the armored train's voxel cars, modelled on the key art: a long, low, dark
 * gunmetal train made of chunky bevelled plates with light edges, a stone-armoured locomotive
 * front with the ruby, red heraldic banners, brass side cannons, red-rimmed wheels, red light
 * strips, smoking chimneys and flatcars stacked with coloured cubes.
 *
 * All cars face +Z, origin at the car centre on rail-top height.
 * Each build returns { group, length, targets, turrets, chimneys, cannons }.
 */
export class TrainModelFactory {
  constructor(materials, textures) {
    this.materials = materials;
    this.textures = textures;
    // Metal plates: subtle mottling, no grid seams (the plate geometry makes the seams).
    this.bodyMaterial = materials.voxel('trainMetal', { voxelSize: 0.16, jitter: 0.12, seam: 0.0, params: { roughness: 0.42, metalness: 0.45, envMapIntensity: 1.3 } });
    this.stoneMaterial = materials.voxel('trainStone', { voxelSize: 0.09, jitter: 0.22, seam: 0.0, params: { roughness: 0.62, metalness: 0.25, envMapIntensity: 1.2 } });
    this.glowMaterial = materials.glow(1.7);
    // Kept below the tone-mapper's orange shift so reds stay crimson.
    this.redGlowMaterial = materials.glow(1.15);
    this.gemMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xb0000e,
      emissive: 0xd8001c,
      emissiveIntensity: 0.5,
      roughness: 0.04,
      metalness: 0.25,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 2.4,
      flatShading: true,
    });
    this.bannerMaterial = new THREE.MeshStandardMaterial({ map: textures.banner(), roughness: 0.75, side: THREE.DoubleSide, alphaTest: 0.5 });
    this.cargoGeometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.07);
    this.snowMaterial = materials.snow();
    this.snowGeometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.35);
  }

  channelMaterials() {
    return { body: this.bodyMaterial, stone: this.stoneMaterial, glow: this.glowMaterial, red: this.redGlowMaterial, gem: this.gemMaterial };
  }

  // ---------------------------------------------------------------------------
  // Shared parts
  // ---------------------------------------------------------------------------

  /** Chassis beam, side skirts with red marker lights and red-rimmed spoked wheels. */
  addUndercarriage(b, L, wheelZs, radius = 0.44) {
    b.box([0, 0.56, 0], [1.9, 0.3, L], TBK);
    b.mirroredBox([1.0, 0.72, 0], [0.12, 0.36, L - 0.5], TD);
    b.mirroredBox([1.05, 0.9, 0], [0.06, 0.06, L - 0.6], BR, { bevel: 0.02 });
    const lights = Math.max(2, Math.round(L / 1.3));
    for (let i = 0; i < lights; i++) {
      const z = -L / 2 + 0.6 + (i * (L - 1.2)) / Math.max(1, lights - 1);
      b.mirroredBox([1.07, 0.7, z], [0.03, 0.09, 0.14], RED_LIGHT, { channel: 'red', bevel: 0.01 });
    }
    for (const z of wheelZs) {
      for (const side of [-1, 1]) {
        b.cylinder([side * 0.86, radius, z], radius + 0.03, 0.06, TR, { rotation: [0, 0, Math.PI / 2], radialSegments: 18 });
        b.cylinder([side * 0.92, radius, z], radius - 0.02, 0.14, TBK, { rotation: [0, 0, Math.PI / 2], radialSegments: 18 });
        for (let k = 0; k < 3; k++) {
          b.box([side * 1.0, radius, z], [0.03, radius * 1.6, 0.07], TD, { rotation: [(k * Math.PI) / 3, 0, 0], bevel: 0.01 });
        }
        b.cylinder([side * 1.01, radius, z], radius * 0.28, 0.05, TR, { rotation: [0, 0, Math.PI / 2], radialSegments: 10 });
      }
    }
    if (wheelZs.length > 1) {
      // Brass coupling rods.
      const zMid = (wheelZs[0] + wheelZs[wheelZs.length - 1]) / 2;
      const len = Math.abs(wheelZs[wheelZs.length - 1] - wheelZs[0]);
      b.mirroredBox([1.05, radius * 0.75, zMid], [0.04, 0.07, len], BR, { bevel: 0.015 });
    }
  }

  /**
   * Armoured hull: a dark core with protruding side plates (gaps between them read as seams),
   * a light top rim, rivet rows and a lighter edge cap on every plate.
   */
  addHull(b, { z0, z1, y0, y1, width = 2.0, plates = 3 }) {
    const L = z1 - z0;
    const cz = (z0 + z1) / 2;
    const cy = (y0 + y1) / 2;
    const h = y1 - y0;
    b.box([0, cy, cz], [width, h, L], TD);
    b.box([0, y1 + 0.05, cz], [width + 0.06, 0.1, L + 0.04], TBL);
    const pl = L / plates;
    for (let i = 0; i < plates; i++) {
      const pz = z0 + pl * (i + 0.5);
      for (const side of [-1, 1]) {
        b.box([side * (width / 2 + 0.03), cy, pz], [0.08, h - 0.12, pl - 0.07], TB, { bevel: 0.035 });
        b.box([side * (width / 2 + 0.05), y1 - 0.1, pz], [0.05, 0.06, pl - 0.12], TBL, { bevel: 0.015 });
        for (const ry of [y0 + 0.14, y1 - 0.22]) {
          for (const rz of [-pl / 2 + 0.14, pl / 2 - 0.14]) b.box([side * (width / 2 + 0.08), ry, pz + rz], [0.04, 0.06, 0.06], TBL, { bevel: 0.012 });
        }
      }
    }
  }

  /** Chimney with red band and dark lip; returns the smoke emitter point. */
  addChimney(b, x, y, z, h, r = 0.22) {
    b.cylinder([x, y + h / 2, z], r, h, TBK, { radialSegments: 12 });
    b.cylinder([x, y + h * 0.62, z], r + 0.04, 0.12, TR, { radialSegments: 12 });
    b.cylinder([x, y + h, z], r + 0.07, 0.12, TD, { radialSegments: 12 });
    return new THREE.Vector3(x, y + h + 0.08, z);
  }

  /** Brass side cannon pointing outward (and slightly forward). Returns muzzle + direction. */
  addSideCannon(b, side, y, z) {
    b.box([side * 1.08, y, z], [0.3, 0.44, 0.5], TD);
    const dir = new THREE.Vector3(side, 0, 0.35).normalize();
    const yaw = Math.atan2(dir.x, dir.z);
    const c = (d) => [side * 1.08 + dir.x * d, y, z + dir.z * d];
    // Cylinders are Y-up; tip them onto the horizontal plane, then aim along `dir`.
    const rot = [Math.PI / 2, yaw, 0];
    b.cylinder(c(0.42), 0.14, 0.6, BR, { rotation: rot, order: 'YXZ', radialSegments: 12 });
    b.cylinder(c(0.74), 0.17, 0.1, BR, { rotation: rot, order: 'YXZ', radialSegments: 12 });
    b.cylinder(c(0.8), 0.08, 0.04, 0x0c0c0e, { rotation: rot, order: 'YXZ', radialSegments: 10 });
    return { muzzle: new THREE.Vector3(...c(0.85)), dir };
  }

  /** Red swallow-tail banner hung on both flanks. */
  addBanner(group, x, y, z, w, h) {
    for (const side of [-1, 1]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.bannerMaterial);
      banner.position.set(side * x, y, z);
      banner.rotation.y = side * Math.PI / 2;
      banner.receiveShadow = true;
      group.add(banner);
    }
  }

  addBannerPoles(b, x, y, z, w) {
    b.mirroredBox([x, y, z], [0.08, 0.08, w + 0.2], BR, { bevel: 0.02 });
  }

  /**
   * Covers a vertical front face (facing +Z at depth `z`) with rows of irregular stone-metal
   * bricks: random widths, staggered joints, depth/colour variation and chipped bevels.
   */
  addMasonry(b, { x0, x1, y0, y1, z, seed, skip = null }) {
    const rand = mulberry(seed);
    const tones = [0x8c8f95, 0x979aa0, 0x82858b, 0xa3a6ab, 0x8f9298];
    let y = y0;
    let row = 0;
    while (y < y1 - 0.05) {
      const h = Math.min(y1 - y, 0.3 + rand() * 0.14);
      let x = x0 - (row % 2 ? 0.18 + 0.15 * rand() : 0);
      while (x < x1 - 0.04) {
        const w = Math.min(x1 - x, 0.36 + rand() * 0.38);
        const xa = Math.max(x0, x);
        const xb = Math.min(x1, x + w);
        const ww = xb - xa;
        const cx = (xa + xb) / 2;
        const cy = y + h / 2;
        if (ww > 0.08 && !(skip && skip(cx, cy))) {
          const d = 0.07 + rand() * 0.14;
          b.box([cx, cy, z + d / 2], [ww - 0.035, h - 0.035, d], tones[Math.floor(rand() * tones.length)], { channel: 'stone', bevel: 0.035 + rand() * 0.02 });
        }
        x += w;
      }
      y += h;
      row++;
    }
  }

  // ---------------------------------------------------------------------------
  // Cars
  // ---------------------------------------------------------------------------

  buildLocomotive() {
    const b = new VoxelModelBuilder({ bevel: 0.06 });
    const L = 5.2;
    this.addUndercarriage(b, L, [-1.9, -0.75, 0.45, 1.6], 0.46);

    // Long armoured hull behind the front block.
    this.addHull(b, { z0: -2.5, z1: 1.4, y0: 0.82, y1: 2.15, plates: 3 });

    // Stone-armoured front block with the ruby in a crimson diamond bezel.
    b.box([0, 1.5, 1.95], [2.3, 2.0, 1.1], TD);
    b.mirroredBox([1.08, 1.5, 1.95], [0.18, 2.04, 1.14], TB, { bevel: 0.05 });
    this.addMasonry(b, { x0: -1.17, x1: 1.17, y0: 0.62, y1: 2.42, z: 2.5, seed: 5 });
    b.box([0, 1.5, 2.64], [1.06, 1.06, 0.08], 0x2a0d0e, { rotation: [0, 0, Math.PI / 4], bevel: 0.03 });
    b.box([0, 1.5, 2.67], [0.92, 0.92, 0.06], 0x6b1414, { rotation: [0, 0, Math.PI / 4], bevel: 0.025 });
    for (const [x, y] of [[0, 2.32], [0, 0.68], [-0.82, 1.5], [0.82, 1.5]]) b.box([x, y, 2.65], [0.13, 0.13, 0.06], TBK, { bevel: 0.03 });
    b.octahedron([0, 1.5, 2.69], 0.6, 0xffffff, { channel: 'gem', scale: [1, 1.08, 0.45] });
    b.octahedron([0, 1.5, 2.83], 0.24, 0xff1430, { channel: 'red', scale: [1, 1.1, 0.4] });
    b.box([0, 1.5, 2.89], [0.5, 0.025, 0.01], 0xffe0e4, { channel: 'red', bevel: 0 });
    b.box([0, 1.5, 2.89], [0.025, 0.56, 0.01], 0xffe0e4, { channel: 'red', bevel: 0 });
    // Bumper: stone beam, dark lamp sockets, red light row and the glowing under-plate.
    b.box([0, 0.44, 2.62], [2.2, 0.36, 0.38], 0x8d9096, { channel: 'stone' });
    b.box([0, 0.44, 2.8], [1.5, 0.22, 0.04], TBK);
    for (let i = 0; i < 5; i++) b.box([-0.6 + i * 0.3, 0.44, 2.83], [0.14, 0.12, 0.03], RED_LIGHT, { channel: 'red' });
    for (const side of [-1, 1]) {
      b.cylinder([side * 0.92, 0.44, 2.81], 0.12, 0.04, TBK, { rotation: [Math.PI / 2, 0, 0], radialSegments: 12 });
      b.cylinder([side * 0.92, 0.44, 2.835], 0.06, 0.02, 0x9aa0a8, { rotation: [Math.PI / 2, 0, 0], radialSegments: 10 });
    }
    b.box([0, 0.24, 2.72], [1.9, 0.05, 0.22], RED_LIGHT, { channel: 'red' });

    // Head on top of the front: stone face, glaring red eyes, flanking cannons.
    b.box([0, 2.85, 1.65], [1.5, 0.8, 1.0], TD);
    b.box([0, 3.29, 1.62], [1.58, 0.1, 1.06], TBL);
    b.box([0, 3.37, 1.5], [1.1, 0.08, 0.6], TB);
    b.mirroredBox([0.77, 2.85, 1.62], [0.07, 0.72, 0.92], TB, { bevel: 0.03 });
    this.addMasonry(b, { x0: -0.76, x1: 0.76, y0: 2.45, y1: 3.25, z: 2.15, seed: 9, skip: (x, y) => Math.abs(y - 2.85) < 0.16 && Math.abs(x) < 0.62 });
    b.box([0, 2.85, 2.17], [1.2, 0.3, 0.06], TBK);
    b.mirroredBox([0.3, 2.85, 2.21], [0.32, 0.16, 0.04], RED_LIGHT, { channel: 'red' });
    b.box([0, 2.85, 2.21], [0.12, 0.22, 0.05], TD);
    for (const side of [-1, 1]) {
      b.box([side * 0.88, 2.82, 1.7], [0.3, 0.36, 0.6], TB);
      b.cylinder([side * 0.88, 2.82, 2.2], 0.11, 0.7, TBK, { rotation: [Math.PI / 2, 0, 0], radialSegments: 10 });
      b.cylinder([side * 0.88, 2.82, 2.56], 0.125, 0.05, TR, { rotation: [Math.PI / 2, 0, 0], radialSegments: 12 });
      b.cylinder([side * 0.88, 2.82, 2.585], 0.07, 0.02, RED_LIGHT, { rotation: [Math.PI / 2, 0, 0], radialSegments: 10, channel: 'red' });
    }

    // Raised command tower at the back with the orange searchlight and red-banded cap.
    b.box([0, 2.85, -1.55], [1.75, 1.3, 1.7], TD);
    for (const side of [-1, 1]) b.box([side * 0.9, 2.85, -1.55], [0.08, 1.18, 1.56], TB, { bevel: 0.035 });
    b.box([0, 3.55, -1.55], [1.85, 0.12, 1.8], TBL);
    b.box([0, 3.85, -1.1], [0.8, 0.5, 0.7], TB);
    b.box([0, 3.85, -0.74], [0.3, 0.26, 0.04], 0xffa030, { channel: 'glow' });
    b.box([0, 3.85, -0.76], [0.42, 0.38, 0.03], TBK);
    b.box([0, 4.18, -1.1], [0.86, 0.16, 0.76], TR);
    b.box([0, 4.3, -1.1], [0.72, 0.1, 0.62], TBK);
    b.mirroredBox([0.55, 3.2, -0.69], [0.4, 0.15, 0.04], RED_LIGHT, { channel: 'red' });

    // Chimneys between the head and the tower.
    const chimneys = [this.addChimney(b, 0, 2.2, 0.6, 0.95), this.addChimney(b, 0.45, 2.2, -0.05, 0.75, 0.18), this.addChimney(b, -0.45, 2.2, -0.15, 0.7, 0.18)];

    // Brass side cannons, low at the front (key art: firing out of the flank).
    const cannons = [this.addSideCannon(b, -1, 1.12, 0.85), this.addSideCannon(b, 1, 1.12, 0.85)];
    this.addBannerPoles(b, 1.12, 2.08, -0.45, 1.0);

    const group = b.buildGroup(this.channelMaterials());
    this.addBanner(group, 1.13, 1.45, -0.45, 1.0, 1.25);
    this.addBanner(group, 0.97, 2.85, -1.55, 0.8, 1.05);
    const turret = this.buildTurret();
    turret.group.position.set(0, 3.62, -2.05);
    group.add(turret.group);

    return {
      group,
      length: L,
      chimneys,
      cannons,
      turrets: [turret],
      targets: [
        { kind: 'gem', box: new THREE.Box3(new THREE.Vector3(-0.75, 0.7, 1.9), new THREE.Vector3(0.75, 2.35, 3.0)), hp: 40, maxHp: 40, alive: true },
        { kind: 'turret', turret, box: new THREE.Box3(new THREE.Vector3(-0.55, 3.5, -2.6), new THREE.Vector3(0.55, 4.4, -1.5)), hp: 14, maxHp: 14, alive: true },
        { kind: 'hull', box: new THREE.Box3(new THREE.Vector3(-1.2, 0.2, -L / 2), new THREE.Vector3(1.2, 4.3, L / 2 + 0.3)), hp: Infinity, alive: true },
      ],
    };
  }

  /** Second-locomotive style armoured car: hull, red-eyed brow, chimneys, banner, cannon, turret. */
  buildArmoredWagon(seed) {
    const rand = mulberry(seed);
    const b = new VoxelModelBuilder({ bevel: 0.06 });
    const L = 4.4;
    this.addUndercarriage(b, L, [-1.4, 1.4], 0.42);
    this.addHull(b, { z0: -L / 2 + 0.1, z1: L / 2 - 0.1, y0: 0.82, y1: 2.2, plates: 3 });
    // Front brow with two red eyes (key art: the second car glares too).
    b.box([0, 2.55, 1.55], [1.5, 0.6, 0.9], TB);
    b.box([0, 2.55, 2.01], [1.2, 0.26, 0.04], TBK);
    b.mirroredBox([0.3, 2.55, 2.04], [0.3, 0.14, 0.03], RED_LIGHT, { channel: 'red' });
    b.box([0, 2.9, 1.55], [1.6, 0.1, 1.0], TBL);
    const chimneys = [this.addChimney(b, -0.35, 2.25, 0.35, 0.85, 0.2), this.addChimney(b, 0.35, 2.25, -0.25, 0.7, 0.18)];
    const cannons = [this.addSideCannon(b, -1, 1.15, 0.9)];
    this.addBannerPoles(b, 1.12, 2.13, -0.55, 1.0);
    const group = b.buildGroup(this.channelMaterials());
    this.addBanner(group, 1.13, 1.5, -0.55, 1.0, 1.25);
    const turret = this.buildTurret();
    turret.group.position.set(0, 2.25, -1.25);
    group.add(turret.group);
    const targets = [
      this.addCargoCube(group, 0.45, 2.25 + 0.4, 0.5, 0.8, BLOCK_COLOR_KEYS[Math.floor(rand() * 4)], rand() < 0.6),
      { kind: 'turret', turret, box: new THREE.Box3(new THREE.Vector3(-0.55, 2.15, -1.8), new THREE.Vector3(0.55, 3.0, -0.7)), hp: 14, maxHp: 14, alive: true },
      { kind: 'hull', box: new THREE.Box3(new THREE.Vector3(-1.1, 0.2, -L / 2), new THREE.Vector3(1.1, 2.9, L / 2)), hp: Infinity, alive: true },
    ];
    return { group, length: L, chimneys, cannons, turrets: [turret], targets };
  }

  /** Flatcar carrying stacks of coloured cubes (2 wide x 3 long, 1-3 high) with snow on top. */
  buildCargoWagon(seed, stackChance = 0.6) {
    const b = new VoxelModelBuilder({ bevel: 0.05 });
    const L = 3.9;
    this.addUndercarriage(b, L, [-1.25, 1.25], 0.4);
    b.box([0, 0.86, 0], [2.1, 0.18, L], TB);
    b.box([0, 0.97, 0], [2.14, 0.05, L + 0.04], TBL);
    for (const side of [-1, 1]) {
      for (const z of [-L / 2 + 0.12, 0, L / 2 - 0.12]) b.box([side * 1.02, 1.25, z], [0.1, 0.6, 0.1], TD);
      b.box([side * 1.02, 1.5, 0], [0.08, 0.08, L - 0.1], TD);
    }
    const group = b.buildGroup(this.channelMaterials());
    const targets = [];
    const rand = mulberry(seed);
    const s = 0.88;
    const color = BLOCK_COLOR_KEYS[Math.floor(rand() * 4)];
    for (const x of [-0.47, 0.47]) {
      for (const z of [-1.05, 0, 1.05]) {
        const layers = 1 + (rand() < stackChance ? 1 : 0) + (rand() < stackChance * 0.35 ? 1 : 0);
        const c = rand() < 0.7 ? color : BLOCK_COLOR_KEYS[Math.floor(rand() * 4)];
        for (let l = 0; l < layers; l++) {
          targets.push(this.addCargoCube(group, x, 1.0 + s * 0.5 + l * s, z, s, c, l === layers - 1 && rand() < 0.55));
        }
      }
    }
    targets.push({ kind: 'hull', box: new THREE.Box3(new THREE.Vector3(-1.05, 0.2, -L / 2), new THREE.Vector3(1.05, 1.1, L / 2)), hp: Infinity, alive: true });
    return { group, length: L, chimneys: [], cannons: [], turrets: [], targets };
  }

  addCargoCube(group, x, y, z, size, colorKey, snow = false) {
    const mesh = new THREE.Mesh(this.cargoGeometry, this.materials.block(colorKey));
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(size);
    mesh.rotation.y = Math.floor(Math.random() * 4) * (Math.PI / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (snow) {
      // Soft snow pillow on the top cube; hidden together with the cube when it is destroyed.
      const cap = new THREE.Mesh(this.snowGeometry, this.snowMaterial);
      cap.scale.set(0.82, 0.16, 0.7);
      cap.position.set(0.04, 0.55, -0.05);
      mesh.add(cap);
    }
    const h = size / 2;
    return {
      kind: 'cargo',
      mesh,
      colorKey,
      color: Palette.blocks[colorKey],
      box: new THREE.Box3(new THREE.Vector3(x - h, y - h, z - h), new THREE.Vector3(x + h, y + h, z + h)),
      hp: 2,
      maxHp: 2,
      alive: true,
    };
  }

  buildTurret() {
    const b = new VoxelModelBuilder({ bevel: 0.05 });
    b.box([0, 0.12, 0], [0.95, 0.24, 0.95], TD);
    const head = new VoxelModelBuilder({ bevel: 0.05 });
    head.box([0, 0.42, 0], [0.78, 0.42, 0.88], TB);
    head.box([0, 0.66, -0.05], [0.6, 0.08, 0.6], TBL);
    head.mirroredBox([0.16, 0.44, 0.72], [0.13, 0.13, 0.75], TBK);
    head.mirroredBox([0.16, 0.44, 1.08], [0.17, 0.17, 0.12], TD);
    head.box([0, 0.5, 0.45], [0.36, 0.08, 0.02], RED_LIGHT, { channel: 'red' });
    const group = b.buildGroup(this.channelMaterials());
    const yaw = head.buildGroup(this.channelMaterials());
    group.add(yaw);
    return {
      group,
      yaw,
      muzzles: [new THREE.Vector3(-0.16, 0.44, 1.2), new THREE.Vector3(0.16, 0.44, 1.2)],
      cooldown: 1 + Math.random(),
      alive: true,
      nextMuzzle: 0,
    };
  }
}

/** Tiny seeded RNG for cargo layout. */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
