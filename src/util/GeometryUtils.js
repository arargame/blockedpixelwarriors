import * as THREE from 'three';

/**
 * Box-projects world-space UVs onto a (transformed) geometry so tiling textures keep a
 * constant texel density regardless of the mesh size. U follows the dominant axis.
 * @param {THREE.BufferGeometry} geometry already positioned in world/local space
 * @param {number} scale world units per texture repeat
 */
export function applyBoxWorldUVs(geometry, scale = 4, offset = new THREE.Vector3(), longAxis = 'x') {
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offset.x;
    const y = pos.getY(i) + offset.y;
    const z = pos.getZ(i) + offset.z;
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    let u;
    let v;
    if (ny >= nx && ny >= nz) {
      u = longAxis === 'x' ? x : z;
      v = longAxis === 'x' ? z : x;
    } else if (nx >= nz) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv[i * 2] = u / scale;
    uv[i * 2 + 1] = v / scale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}
