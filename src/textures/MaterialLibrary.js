import * as THREE from 'three';
import { Palette } from '../config/Palette.js';
import { createVoxelMaterial } from './VoxelMaterial.js';

/**
 * Owns every shared material (Flyweight). Entities request materials by name
 * instead of creating their own, so draw-state changes and GPU programs stay minimal.
 */
export class MaterialLibrary {
  /** @param {import('./TextureFactory.js').TextureFactory} textures */
  constructor(textures) {
    this.textures = textures;
    this.cache = new Map();
  }

  get(key, build) {
    if (!this.cache.has(key)) this.cache.set(key, build());
    return this.cache.get(key);
  }

  /** Vertex-colored voxel material for vehicles. */
  voxel(key = 'default', options = {}) {
    return this.get(`voxel:${key}`, () => createVoxelMaterial(options));
  }

  /** Unlit HDR emissive (values > 1 feed the bloom pass). */
  glow(intensity = 3) {
    return this.get(`glow:${intensity}`, () => {
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
      m.color.setScalar(intensity);
      return m;
    });
  }

  glass() {
    return this.get('glass', () =>
      new THREE.MeshStandardMaterial({
        color: Palette.heliGlass,
        roughness: 0.08,
        metalness: 0.35,
        envMapIntensity: 1.6,
      })
    );
  }

  /** Destructible block material for one color key. */
  block(colorKey) {
    return this.get(`block:${colorKey}`, () => {
      const { map, normalMap } = this.textures.blockSurface();
      const color = new THREE.Color(Palette.blocks[colorKey]).multiplyScalar(1.12);
      return new THREE.MeshStandardMaterial({
        color,
        map,
        normalMap,
        normalScale: new THREE.Vector2(1.6, 1.6),
        roughness: 0.5,
        metalness: 0.0,
      });
    });
  }

  snow() {
    return this.get('snow', () =>
      new THREE.MeshStandardMaterial({
        color: 0xf4f8ff,
        roughness: 0.75,
        metalness: 0,
        normalMap: this.textures.snowNormal(),
        normalScale: new THREE.Vector2(0.6, 0.6),
        emissive: new THREE.Color(0x9ec9f0),
        emissiveIntensity: 0.05,
      })
    );
  }

  wood() {
    return this.get('wood', () => {
      const { map, normalMap } = this.textures.woodPlanks();
      return new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.68, metalness: 0 });
    });
  }

  gravel() {
    return this.get('gravel', () => {
      const { map, normalMap } = this.textures.gravel();
      return new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.95 });
    });
  }

  rail() {
    return this.get('rail', () => new THREE.MeshStandardMaterial({ color: Palette.rail, roughness: 0.32, metalness: 0.85 }));
  }

  sleeper() {
    return this.get('sleeper', () => createVoxelMaterial({ voxelSize: 0.2, jitter: 0.2, seam: 0.15, params: { roughness: 0.9, vertexColors: false } }));
  }

  /** Instanced-cube material for terrain and trees (uses instanceColor). */
  terrain() {
    return this.get('terrain', () =>
      createVoxelMaterial({ voxelSize: 0.45, jitter: 0.14, seam: 0.0, params: { vertexColors: false, roughness: 0.88 } })
    );
  }

  cliff() {
    return this.get('cliff', () => {
      const { map, normalMap } = this.textures.cliff();
      return new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.9, vertexColors: true });
    });
  }

  cloudFloor() {
    return this.get('cloudFloor', () =>
      new THREE.MeshStandardMaterial({
        map: this.textures.cloudFloor(),
        roughness: 1,
        metalness: 0,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: this.textures.cloudFloor(),
        emissiveIntensity: 0.16,
      })
    );
  }

  ironBall() {
    return this.get('iron', () => {
      const { map, normalMap } = this.textures.blockSurface();
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x6b6f76).multiplyScalar(1.25),
        map,
        normalMap,
        normalScale: new THREE.Vector2(1.4, 1.4),
        roughness: 0.5,
        metalness: 0.45,
      });
    });
  }
}
