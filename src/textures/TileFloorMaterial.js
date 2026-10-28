import * as THREE from 'three';

/**
 * Polished porcelain floor tiles ("kalebodur") made from one marble photo.
 * The floor is split into square tiles in world XZ (rows and columns aligned with the block
 * grid). Each tile shows a different square crop of the marble image, randomly rotated by a
 * multiple of 90 degrees, with a slight per-tile tone shift, thin grout joints and a tiny
 * bevel highlight/shadow on the edges, so the floor reads as individually laid tiles.
 *
 * @param {THREE.Texture} marble the marble photo (any aspect ratio)
 * @param {{ origin: THREE.Vector2, tileSize: number, grout?: number }} options
 */
export function createTileFloorMaterial(marble, { origin, tileSize, grout = 0.022 }) {
  marble.colorSpace = THREE.SRGBColorSpace;
  marble.wrapS = marble.wrapT = THREE.RepeatWrapping;
  marble.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map: marble, roughness: 0.32, metalness: 0.0, envMapIntensity: 0.9 });
  const uniforms = {
    uTileOrigin: { value: origin },
    uTileSize: { value: tileSize },
    uGrout: { value: grout },
    uGroutColor: { value: new THREE.Color(0xa69a88) },
    // Fraction of the image width one tile covers (tile crop size).
    uCrop: { value: 0.6 },
    uImageAspect: { value: 0.5 }, // width / height of the photo
  };
  material.userData.tileUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTileWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTileWorld = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vTileWorld;
        uniform vec2 uTileOrigin;
        uniform float uTileSize;
        uniform float uGrout;
        uniform vec3 uGroutColor;
        uniform float uCrop;
        uniform float uImageAspect;
        float tileHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec2 t = (vTileWorld - uTileOrigin) / uTileSize;
          vec2 cell = floor(t);
          vec2 f = fract(t);
          float h1 = tileHash(cell);
          float h2 = tileHash(cell + 17.3);
          float h3 = tileHash(cell + 41.7);
          // Random 90-degree rotation of the tile.
          float r = floor(h3 * 4.0);
          vec2 q = f - 0.5;
          if (r == 1.0) q = vec2(-q.y, q.x);
          else if (r == 2.0) q = -q;
          else if (r == 3.0) q = vec2(q.y, -q.x);
          q += 0.5;
          // Random square crop of the photo (crop is uCrop of the width, square in pixels).
          vec2 cropSize = vec2(uCrop, uCrop * uImageAspect);
          vec2 cropOrigin = vec2(h1, h2) * (vec2(1.0) - cropSize);
          vec2 uv = cropOrigin + q * cropSize;
          vec4 texel = texture2D(map, uv);
          // Gentle tone variation tile to tile (natural stone batches).
          texel.rgb *= 0.86 + 0.1 * tileHash(cell + 7.1);
          // Grout joint + bevel: darker rim, lighter inner lip.
          float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
          float groutMask = 1.0 - smoothstep(uGrout * 0.6, uGrout, e);
          float bevel = smoothstep(uGrout, uGrout * 2.6, e);
          texel.rgb *= mix(0.86, 1.0, bevel);
          texel.rgb = mix(texel.rgb, uGroutColor, groutMask);
          diffuseColor *= texel;
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          vec2 tf = fract((vTileWorld - uTileOrigin) / uTileSize);
          float te = min(min(tf.x, 1.0 - tf.x), min(tf.y, 1.0 - tf.y));
          roughnessFactor = mix(0.9, roughnessFactor, smoothstep(uGrout * 0.6, uGrout, te));
        }`
      );
  };
  material.customProgramCacheKey = () => 'tile-floor-v1';
  return material;
}
