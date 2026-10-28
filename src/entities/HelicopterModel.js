import * as THREE from 'three';
import { VoxelModelBuilder } from '../util/VoxelModelBuilder.js';
import { Palette } from '../config/Palette.js';

/**
 * Builds the voxel attack helicopter (nose points to -Z). Returns the root group
 * plus references to animated parts and weapon hardpoints.
 */
export function buildHelicopterModel(materials, textures) {
  const G = Palette.heliGreen;
  const GD = Palette.heliGreenDark;
  const GL = Palette.heliGreenLight;
  const OL = Palette.heliOlive;
  const GM = Palette.heliGunmetal;
  const DK = 0x24272b;

  const b = new VoxelModelBuilder({ bevel: 0.07 });
  const POD = 0x2b2e33;
  const TEAL = 0x2aa8bd;
  // Cabin + engine deck (chunky olive blocks like the key art).
  b.box([0, 0, 0.2], [1.25, 1.1, 2.2], G);
  b.box([0, 0.62, 0.45], [1.02, 0.18, 1.6], GL);
  b.box([0, -0.52, 0.1], [1.1, 0.22, 2.0], GD);
  b.mirroredBox([0.64, 0.05, 0.2], [0.04, 0.9, 1.9], GD, { bevel: 0.015 }); // side panel seam
  // Engine nacelles with glowing exhausts at the back.
  b.mirroredBox([0.7, 0.48, 0.65], [0.46, 0.56, 1.3], G);
  b.mirroredBox([0.7, 0.78, 0.65], [0.36, 0.08, 1.1], GL);
  b.mirroredBox([0.7, 0.48, 1.33], [0.38, 0.38, 0.12], DK);
  b.mirroredBox([0.7, 0.48, 1.395], [0.22, 0.22, 0.02], 0xff8a2a, { channel: 'glow' });
  // Nose, gunner station and chin gun.
  b.box([0, -0.05, -1.3], [1.02, 0.88, 1.05], G);
  b.box([0, -0.18, -1.98], [0.72, 0.62, 0.5], GD);
  b.box([0, -0.64, -1.85], [0.42, 0.34, 0.42], GM);
  b.box([0, -0.68, -2.2], [0.12, 0.12, 0.6], DK, { bevel: 0.02 });
  // Tandem canopies.
  b.box([0, 0.4, -1.45], [0.78, 0.36, 0.72], Palette.heliGlass, { channel: 'glass' });
  b.box([0, 0.7, -0.68], [0.86, 0.46, 0.82], Palette.heliGlass, { channel: 'glass' });
  b.box([0, 0.48, -1.06], [0.9, 0.14, 0.14], GD);
  // Rotor mast + hub + big radar box on top.
  b.box([0, 1.02, -0.05], [0.36, 0.62, 0.36], GM);
  b.box([0, 1.36, -0.05], [0.64, 0.2, 0.64], DK);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    b.box([Math.cos(a) * 0.42, 1.36, Math.sin(a) * 0.42 - 0.05], [0.42, 0.14, 0.2], DK, { rotation: [0, -a, 0] });
  }
  b.box([0, 1.72, -0.05], [0.18, 0.4, 0.18], DK);
  b.box([0, 2.1, -0.05], [0.64, 0.52, 0.64], G);
  b.box([0, 2.38, -0.05], [0.52, 0.06, 0.52], GL);
  // Dorsal hump behind the mast: stacked armour blocks + ammo boxes (key art: blocky back).
  b.box([0, 0.86, 0.55], [0.78, 0.36, 0.72], G);
  b.box([-0.2, 1.08, 0.5], [0.34, 0.2, 0.42], GL);
  b.box([0.22, 1.06, 0.62], [0.32, 0.18, 0.38], GD);
  b.box([0, 0.82, 1.05], [0.6, 0.3, 0.36], GD);
  b.mirroredBox([0.36, 0.95, 0.12], [0.18, 0.18, 0.3], GL);
  b.box([0.28, 1.05, 0.95], [0.16, 0.12, 0.2], 0xc0412a);
  b.box([-0.26, 0.9, 1.18], [0.22, 0.16, 0.16], DK);
  // Side armour plates (break up the flat flanks into chunky blocks).
  for (const side of [-1, 1]) {
    b.box([side * 0.66, 0.2, -0.35], [0.1, 0.42, 0.55], GL);
    b.box([side * 0.66, -0.18, 0.55], [0.1, 0.36, 0.7], GD);
    b.box([side * 0.66, 0.28, 0.75], [0.08, 0.3, 0.4], G);
  }
  // Stub wings (dark metal).
  b.mirroredBox([1.05, 0.05, 0.05], [1.05, 0.16, 0.72], GM);
  // Inner gatling guns (4 barrels).
  for (const side of [-1, 1]) {
    const x = side * 0.98;
    b.box([x, -0.3, 0.0], [0.36, 0.36, 0.9], DK);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      b.cylinder([x + Math.cos(a) * 0.09, -0.3 + Math.sin(a) * 0.09, -0.72], 0.05, 0.55, POD, { rotation: [Math.PI / 2, 0, 0], radialSegments: 6 });
    }
    b.cylinder([x, -0.3, -0.5], 0.17, 0.08, GM, { rotation: [Math.PI / 2, 0, 0], radialSegments: 10 });
  }
  // Outer rocket pods: black tubes with a cluster of launch holes and an orange-hot rear ring.
  for (const side of [-1, 1]) {
    const x = side * 1.5;
    b.cylinder([x, -0.24, -0.05], 0.31, 1.25, POD, { rotation: [Math.PI / 2, 0, 0], radialSegments: 14 });
    b.cylinder([x, -0.24, -0.66], 0.33, 0.1, GM, { rotation: [Math.PI / 2, 0, 0], radialSegments: 14 });
    b.cylinder([x, -0.24, 0.56], 0.33, 0.1, GM, { rotation: [Math.PI / 2, 0, 0], radialSegments: 14 });
    for (let k = 0; k < 7; k++) {
      const a = (k / 6) * Math.PI * 2;
      const r = k === 6 ? 0 : 0.17;
      b.cylinder([x + Math.cos(a) * r, -0.24 + Math.sin(a) * r, -0.715], 0.06, 0.02, 0x0c0d0f, { rotation: [Math.PI / 2, 0, 0], radialSegments: 8 });
    }
    b.cylinder([x, -0.24, 0.62], 0.22, 0.02, 0xff9a30, { rotation: [Math.PI / 2, 0, 0], radialSegments: 12, channel: 'glow' });
    b.box([x, 0.0, -0.05], [0.12, 0.14, 0.5], GM); // pylon
  }
  // Main landing gear.
  b.mirroredBox([0.45, -0.72, -0.75], [0.14, 0.4, 0.14], DK);
  b.mirroredBox([0.45, -0.92, -0.75], [0.16, 0.3, 0.3], DK, { bevel: 0.1 });
  // Tail boom, stabilizer with teal end-plate fin, vertical fin and tail wheel.
  b.box([0, 0.25, 2.1], [0.56, 0.52, 2.2], G);
  b.box([0, 0.53, 2.0], [0.38, 0.08, 1.9], GL);
  b.box([0, 0.25, 3.25], [0.44, 0.46, 0.5], G);
  b.box([0, 0.8, 3.38], [0.2, 1.05, 0.6], G);
  b.box([0, 0.36, 3.32], [1.75, 0.15, 0.52], G);
  b.box([-0.86, 0.62, 3.32], [0.15, 0.62, 0.5], G);
  b.box([-0.86, 0.98, 3.32], [0.17, 0.26, 0.52], TEAL);
  b.box([0, -0.12, 3.2], [0.12, 0.36, 0.12], DK);
  b.cylinder([0, -0.32, 3.2], 0.15, 0.12, DK, { rotation: [0, 0, Math.PI / 2], radialSegments: 10 });
  // Navigation lights (glow channel).
  b.box([-1.82, -0.24, -0.05], [0.06, 0.08, 0.12], 0xff2a2a, { channel: 'glow' });
  b.box([1.82, -0.24, -0.05], [0.06, 0.08, 0.12], 0x2aff5a, { channel: 'glow' });
  b.box([0, 1.36, 3.38], [0.1, 0.08, 0.1], 0xff3030, { channel: 'glow' });

  const root = new THREE.Group();
  const body = b.buildGroup({
    body: materials.voxel('heli', { voxelSize: 0.4, jitter: 0.26, seam: 0.26, params: { roughness: 0.6, metalness: 0.08 } }),
    glass: materials.glass(),
    glow: materials.glow(4),
  });
  root.add(body);

  // Star decals on both sides of the boom and fuselage.
  const starMaterial = new THREE.MeshStandardMaterial({ map: textures.starDecal(), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const side of [-1, 1]) {
    const star = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.56), starMaterial);
    star.position.set(side * 0.632, 0.08, 0.45);
    star.rotation.y = side * Math.PI / 2;
    root.add(star);
    const star2 = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), starMaterial);
    star2.position.set(side * 0.286, 0.25, 2.35);
    star2.rotation.y = side * Math.PI / 2;
    root.add(star2);
  }
  const topStar = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), starMaterial);
  topStar.rotation.x = -Math.PI / 2;
  topStar.position.set(0, 0.575, 2.35);
  root.add(topStar);

  // Main rotor: 4 voxel blades + translucent blur disc.
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.5, -0.05);
  // Short blade roots stay solid; the rest of each blade is a motion-blurred disc texture.
  const bladeBuilder = new VoxelModelBuilder({ bevel: 0.03 });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    bladeBuilder.box([Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55], [0.8, 0.07, 0.26], 0x2e3236, { rotation: [0, -a, 0] });
  }
  const blades = bladeBuilder.buildGroup({ body: materials.voxel('blade', { voxelSize: 0.3, jitter: 0.05, seam: 0.05, params: { roughness: 0.4, metalness: 0.3 } }) }, { receiveShadow: false });
  rotor.add(blades);
  // Full-length blades, slightly see-through to suggest motion blur.
  const longBlades = new VoxelModelBuilder({ bevel: 0.025 });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + 0.3;
    longBlades.box([Math.cos(a) * 1.75, 0.01, Math.sin(a) * 1.75], [2.9, 0.05, 0.4], 0x2b2f34, { rotation: [0, -a, 0] });
    longBlades.box([Math.cos(a) * 3.12, 0.012, Math.sin(a) * 3.12], [0.18, 0.055, 0.33], 0xf2c230, { rotation: [0, -a, 0] });
  }
  const bladeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2, transparent: true, opacity: 0.85, depthWrite: false });
  const longBladeMesh = longBlades.buildGroup({ body: bladeMaterial }, { castShadow: true, receiveShadow: false });
  longBladeMesh.children.forEach((m) => (m.renderOrder = 19));
  rotor.add(longBladeMesh);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(3.3, 64),
    new THREE.MeshBasicMaterial({ map: textures.rotorDisc(), transparent: true, depthWrite: false, side: THREE.DoubleSide })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.02;
  disc.renderOrder = 20;
  rotor.add(disc);
  root.add(rotor);

  // Tail rotor.
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.14, 0.85, 3.5);
  const tb = new VoxelModelBuilder({ bevel: 0.02 });
  tb.box([0, 0, 0], [0.05, 1.0, 0.14], 0x2e3236);
  tb.box([0, 0, 0], [0.05, 0.14, 1.0], 0x2e3236);
  tb.box([0, 0, 0], [0.12, 0.16, 0.16], DK);
  tailRotor.add(tb.buildGroup({ body: materials.voxel('blade') }, { receiveShadow: false }));
  root.add(tailRotor);

  // Hardpoints in model space.
  const hardpoints = {
    chinGun: new THREE.Vector3(0, -0.66, -2.42),
    gunL: new THREE.Vector3(-0.98, -0.3, -1.0),
    gunR: new THREE.Vector3(0.98, -0.3, -1.0),
    podL: new THREE.Vector3(-1.5, -0.24, -0.75),
    podR: new THREE.Vector3(1.5, -0.24, -0.75),
    podRearL: new THREE.Vector3(-1.5, -0.24, 0.66),
    podRearR: new THREE.Vector3(1.5, -0.24, 0.66),
    exhaustL: new THREE.Vector3(-0.7, 0.48, 1.42),
    exhaustR: new THREE.Vector3(0.7, 0.48, 1.42),
  };

  return { root, rotor, tailRotor, disc, hardpoints };
}
