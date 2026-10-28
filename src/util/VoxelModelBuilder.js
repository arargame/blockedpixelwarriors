import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

/**
 * Builder pattern for chunky voxel models made of bevelled boxes and simple primitives.
 * Parts are grouped by "channel" (body, glow, glass, ...) and merged into one draw call
 * per channel. Vertex colors carry the part colors.
 */
export class VoxelModelBuilder {
  constructor({ bevel = 0.045, segments = 2 } = {}) {
    this.defaultBevel = bevel;
    this.segments = segments;
    /** @type {Map<string, THREE.BufferGeometry[]>} */
    this.channels = new Map();
  }

  /**
   * Adds a bevelled box.
   * @param {number[]} center [x,y,z]
   * @param {number[]} size [w,h,d]
   * @param {number|THREE.Color} color
   * @param {{channel?: string, bevel?: number, rotation?: number[], shade?: number}} [opts]
   */
  box(center, size, color, opts = {}) {
    const [w, h, d] = size;
    const bevel = Math.min(opts.bevel ?? this.defaultBevel, Math.min(w, h, d) * 0.45);
    const geometry = bevel > 0.001 ? new RoundedBoxGeometry(w, h, d, this.segments, bevel) : new THREE.BoxGeometry(w, h, d);
    return this.add(geometry, center, color, opts);
  }

  cylinder(center, radius, height, color, opts = {}) {
    const geometry = new THREE.CylinderGeometry(radius, opts.radiusBottom ?? radius, height, opts.radialSegments ?? 12, 1);
    return this.add(geometry, center, color, opts);
  }

  sphere(center, radius, color, opts = {}) {
    const geometry = new THREE.IcosahedronGeometry(radius, opts.detail ?? 1);
    return this.add(geometry, center, color, opts);
  }

  octahedron(center, radius, color, opts = {}) {
    const geometry = new THREE.OctahedronGeometry(radius, 0);
    return this.add(geometry, center, color, opts);
  }

  /**
   * Adds any geometry with a transform and color.
   * @param {THREE.BufferGeometry} geometry
   */
  add(geometry, center, color, { channel = 'body', rotation = null, scale = null, shade = 1, order = 'XYZ' } = {}) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    // Keep only the attributes every part has so geometries are mergeable.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    tmpEuler.set(...(rotation ?? [0, 0, 0]), order);
    tmpQuat.setFromEuler(tmpEuler);
    const s = scale ?? [1, 1, 1];
    tmpMatrix.compose(new THREE.Vector3(...center), tmpQuat, new THREE.Vector3(...s));
    g.applyMatrix4(tmpMatrix);

    tmpColor.set(color).multiplyScalar(shade);
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    if (!this.channels.has(channel)) this.channels.set(channel, []);
    this.channels.get(channel).push(g);
    return this;
  }

  /** Mirrors a box/part across X (convenient for symmetric vehicles). */
  mirroredBox(center, size, color, opts = {}) {
    this.box(center, size, color, opts);
    this.box([-center[0], center[1], center[2]], size, color, opts);
    return this;
  }

  /**
   * Merges each channel into a single geometry.
   * @returns {Map<string, THREE.BufferGeometry>}
   */
  buildGeometries() {
    const result = new Map();
    for (const [channel, parts] of this.channels) {
      const merged = mergeGeometries(parts, false);
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      result.set(channel, merged);
      parts.forEach((p) => p.dispose());
    }
    this.channels.clear();
    return result;
  }

  /**
   * Builds a Group with one mesh per channel.
   * @param {Record<string, THREE.Material>} materials channel -> material
   */
  buildGroup(materials, { castShadow = true, receiveShadow = true } = {}) {
    const group = new THREE.Group();
    for (const [channel, geometry] of this.buildGeometries()) {
      const material = materials[channel] ?? materials.body;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = channel;
      mesh.castShadow = castShadow && channel !== 'glow';
      mesh.receiveShadow = receiveShadow;
      group.add(mesh);
    }
    return group;
  }
}
