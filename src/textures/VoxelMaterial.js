import * as THREE from 'three';

/**
 * MeshStandardMaterial extended with an object-space "micro voxel" pattern:
 * every surface is split into small square cells with a subtle per-cell
 * brightness jitter and darker seams. This gives hand-built models the
 * chunky pixel-voxel look of the key art without needing textures.
 *
 * @param {object} options
 * @param {number} [options.voxelSize=0.16] cell size in object units
 * @param {number} [options.jitter=0.16] per-cell brightness variation
 * @param {number} [options.seam=0.22] seam darkening (0 = none)
 * @param {THREE.MeshStandardMaterialParameters} [options.params]
 */
export function createVoxelMaterial({ voxelSize = 0.16, jitter = 0.16, seam = 0.22, params = {} } = {}) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.0, ...params });
  const uniforms = {
    uVoxelSize: { value: voxelSize },
    uVoxelJitter: { value: jitter },
    uVoxelSeam: { value: seam },
  };
  material.userData.voxelUniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVoxPos;\nvarying vec3 vVoxNrm;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 voxP = position;
        vec3 voxN = normal;
        #ifdef USE_INSTANCING
          voxP = (instanceMatrix * vec4(position, 1.0)).xyz;
          voxN = mat3(instanceMatrix) * normal;
        #endif
        vVoxPos = voxP;
        vVoxNrm = voxN;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vVoxPos;
        varying vec3 vVoxNrm;
        uniform float uVoxelSize;
        uniform float uVoxelJitter;
        uniform float uVoxelSeam;
        float voxHash(vec3 p) {
          p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 an = abs(normalize(vVoxNrm));
          vec3 q = vVoxPos / uVoxelSize;
          vec2 p;
          float depthCell;
          if (an.x > an.y && an.x > an.z) { p = q.yz; depthCell = floor(q.x + 0.5); }
          else if (an.y > an.z) { p = q.xz; depthCell = floor(q.y + 0.5); }
          else { p = q.xy; depthCell = floor(q.z + 0.5); }
          vec2 cell = floor(p);
          vec2 f = fract(p);
          float h = voxHash(vec3(cell, depthCell));
          float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
          float seamMask = 1.0 - smoothstep(0.0, 0.07, e);
          diffuseColor.rgb *= (1.0 - uVoxelJitter * 0.5 + uVoxelJitter * h) * (1.0 - seamMask * uVoxelSeam);
        }`
      );
  };
  material.customProgramCacheKey = () => 'voxel-v1';
  return material;
}
