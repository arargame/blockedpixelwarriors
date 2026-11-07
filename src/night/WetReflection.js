import * as THREE from 'three';

const q = new THREE.Vector4();
const clip = new THREE.Vector4();
const plane = new THREE.Plane();
const normal = new THREE.Vector3(0, 1, 0);
const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const target = new THREE.Vector3();
const rot = new THREE.Matrix4();
const point = new THREE.Vector3();

/**
 * Wet-ground reflections for the night level: the scene is rendered from the camera mirrored in
 * the ground plane (y = `height`, oblique near plane so nothing below the ground leaks in) into a
 * half-resolution HDR target with mipmaps. Ground materials made wet with `wet(material)` sample
 * it in screen-projected space: sharp in the puddles, blurred (higher mip) on the damp asphalt,
 * rippled by the rain and stronger at grazing angles. Objects in `hidden` (the ground itself, the
 * rain) are left out of the mirror pass.
 */
export class WetReflection {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{ height?: number, scale?: number, enabled?: boolean }} [opts]
   */
  constructor(renderer, { height = 0, scale = 0.5, enabled = true } = {}) {
    this.renderer = renderer;
    this.height = height;
    this.scale = scale;
    this.enabled = enabled;
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.camera = new THREE.PerspectiveCamera();
    this.matrix = new THREE.Matrix4();
    this.hidden = [];
    this.uniforms = {
      tReflect: { value: this.target.texture },
      uReflectMatrix: { value: this.matrix },
      uReflectOn: { value: enabled ? 1 : 0 },
      uTime: { value: 0 },
    };
  }

  /** Renders the mirror view for `camera` (call once per frame before the main render). */
  update(scene, camera, time) {
    this.uniforms.uTime.value = time;
    if (!this.enabled) return;
    // The mirror is blurred and rippled: refreshing it every other frame is invisible and halves
    // its cost (it renders the whole desk scene a second time). `every = 1` forces each frame.
    this.frame = (this.frame ?? 0) + 1;
    if (this.frame % (this.every ?? 2) !== 0 && this.target.width > 4) return;
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(4, Math.round(size.x * this.scale));
    const h = Math.max(4, Math.round(size.y * this.scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    // Mirror camera (three.js Reflector, for a horizontal plane at y = height).
    point.set(0, this.height, 0);
    camPos.setFromMatrixPosition(camera.matrixWorld);
    // Eye and look-at point mirrored in the plane.
    const view = new THREE.Vector3(camPos.x, 2 * this.height - camPos.y, camPos.z);
    rot.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.set(lookAt.x, 2 * this.height - lookAt.y, lookAt.z);
    const vc = this.camera;
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(rot);
    vc.up.y = -vc.up.y;
    vc.lookAt(target);
    vc.far = camera.far;
    vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.matrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);

    // Oblique near plane = the ground (Lengyel).
    plane.setFromNormalAndCoplanarPoint(normal, point).applyMatrix4(vc.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = vc.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + e[8]) / e[0];
    q.y = (Math.sign(clip.y) + e[9]) / e[5];
    q.z = -1;
    q.w = (1 + e[10]) / e[14];
    clip.multiplyScalar(2 / clip.dot(q));
    e[2] = clip.x;
    e[6] = clip.y;
    e[10] = clip.z + 1 - 0.003;
    e[14] = clip.w;

    for (const o of this.hidden) {
      o.userData.wasVisible = o.visible;
      o.visible = false;
    }
    const prevTarget = r.getRenderTarget();
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.target);
    r.state.buffers.depth.setMask(true);
    r.clear();
    r.render(scene, vc);
    r.setRenderTarget(prevTarget);
    r.shadowMap.autoUpdate = prevShadow;
    for (const o of this.hidden) o.visible = o.userData.wasVisible;
  }

  /**
   * Makes a MeshStandardMaterial wet: darker and glossier where `wetMap` (red channel, tiled every
   * `wetScale` world units) says puddle, with the mirror view added on top.
   * @param {THREE.MeshStandardMaterial} material
   * `sheen` (a colour) is the water film's own cold glow, added under the reflection.
   * @param {{ wetMap: THREE.Texture, wetScale?: number, strength?: number, puddle?: number, darken?: number, sheen?: THREE.Color }} o
   */
  wet(material, { wetMap, wetScale = 0.08, strength = 1, puddle = 1, darken = 1, sheen = null }) {
    const u = this.uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u, {
        tWet: { value: wetMap },
        uWetScale: { value: wetScale },
        uReflectStrength: { value: strength },
        uPuddle: { value: puddle },
        uDarken: { value: darken },
        uSheen: { value: sheen ?? new THREE.Color(0, 0, 0) },
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWetWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWetWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWetWorld;
          uniform sampler2D tReflect;
          uniform sampler2D tWet;
          uniform mat4 uReflectMatrix;
          uniform float uReflectOn;
          uniform float uTime;
          uniform float uWetScale;
          uniform float uReflectStrength;
          uniform float uPuddle;
          uniform float uDarken;
          uniform vec3 uSheen;
          float wetMask() {
            float w = texture2D(tWet, vWetWorld.xz * uWetScale).r;
            return smoothstep(0.35, 0.75, w) * uPuddle;
          }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          float wetK = wetMask();
          diffuseColor.rgb *= 1.0 - uDarken * mix(0.22, 0.58, wetK);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor * 0.75, 0.04, wetK);`)
        .replace('#include <opaque_fragment>', `
          {
            // Rain ripples: a few travelling sine sets in world space.
            vec2 wp = vWetWorld.xz;
            vec2 rip = vec2(sin(wp.x * 5.1 + uTime * 3.3) * sin(wp.y * 4.3 - uTime * 2.1),
                            sin(wp.y * 5.7 + uTime * 2.7) * sin(wp.x * 3.9 + uTime * 3.6));
            vec4 rc = uReflectMatrix * vec4(vWetWorld, 1.0);
            vec2 ruv = rc.xy / rc.w + (normal.xy * 0.035 + rip * 0.006) * (1.0 - 0.6 * wetK);
            float lod = mix(4.5, 0.6, wetK);
            vec3 refl = textureLod(tReflect, clamp(ruv, 0.001, 0.999), lod).rgb;
            float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
            float fres = 0.22 + 0.78 * pow(1.0 - ndv, 3.0);
            outgoingLight += refl * uReflectOn * uReflectStrength * mix(0.28, 1.0, wetK) * fres;
            // The water film's cold sheen (the night sky over the glass, the key art's blue floor).
            outgoingLight += uSheen * mix(0.6, 1.0, wetK) * (0.35 + 0.65 * fres);
          }
          #include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'wet-ground';
    return material;
  }
}
