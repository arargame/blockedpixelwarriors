import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import heliUrl from '../../assets/models/helicopter.glb?url';

/**
 * Loads the Blender-made helicopter (assets/models/helicopter.glb, built by
 * tools/blender/build_heli.py). Resolves to the parsed glTF or null if loading fails, in which
 * case the game falls back to the procedural model.
 * @returns {Promise<import('three/addons/loaders/GLTFLoader.js').GLTF|null>}
 */
export function loadHelicopterGltf() {
  return new Promise((resolve) => {
    new GLTFLoader().load(heliUrl, resolve, undefined, (err) => {
      console.warn('helicopter.glb failed to load, using procedural model', err);
      resolve(null);
    });
  });
}

/** Material names from the .blend that become the game's voxel-shaded paint. */
const PAINT = new Set(['HeliGreen', 'HeliGreenDark', 'HeliGreenLight', 'HeliCamo', 'Teal']);
const EMISSIVE = { GlowOrange: 3.2, NavRed: 3 };
/**
 * In-game paint colours. The game's sun and saturation grade are hotter than Blender's, so the
 * paint is authored a little darker and bluer here to land on the key-art green on screen.
 */
const GAME_PAINT = { HeliGreen: 0x3a6c45, HeliGreenDark: 0x24462a, HeliGreenLight: 0x4f8a52, HeliCamo: 0x1c3520, Teal: 0x2a9fb0 };

/**
 * Builds the helicopter from the glTF: swaps materials for game ones, extracts the spinning
 * parts and the HP_* hardpoint empties. Same return shape as the procedural builder.
 * @param {import('three/addons/loaders/GLTFLoader.js').GLTF} gltf
 * @param {import('../textures/MaterialLibrary.js').MaterialLibrary} materials
 */
export function buildHelicopterFromGltf(gltf, materials) {
  const scene = gltf.scene.clone(true);
  const cache = new Map();
  const convert = (m) => {
    if (cache.has(m.name)) return cache.get(m.name);
    let out;
    if (PAINT.has(m.name)) {
      out = materials.voxel(`gltf:${m.name}`, {
        voxelSize: 0.34,
        jitter: 0.2,
        seam: 0.22,
        params: { vertexColors: false, color: new THREE.Color(GAME_PAINT[m.name] ?? m.color.getHex()), roughness: 0.62, metalness: 0.0 },
      });
    } else if (EMISSIVE[m.name]) {
      out = new THREE.MeshBasicMaterial({ color: m.color.clone().multiplyScalar(EMISSIVE[m.name]) });
    } else if (m.name === 'Glass') {
      out = materials.glass();
    } else {
      out = m;
      out.envMapIntensity = 1.2;
    }
    cache.set(m.name, out);
    return out;
  };

  const hardpoints = {};
  let rotor = null;
  let tailRotor = null;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (o.isMesh) {
      o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
      o.castShadow = true;
      o.receiveShadow = true;
    }
    if (o.name === 'HeliRotor') rotor = o;
    if (o.name === 'HeliTailRotor') tailRotor = o;
    if (o.name.startsWith('HP_')) {
      hardpoints[o.name.slice(3)] = o.getWorldPosition(new THREE.Vector3());
    }
  });
  // Rotor meshes may be multi-primitive groups; spinning the node works either way.
  rotor.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  const root = new THREE.Group();
  root.add(scene);
  return { root, rotor, tailRotor, rotorAxis: 'y', tailAxis: 'x', hardpoints };
}
