import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Barrel lens distortion + subtle chromatic fringe. Bends straight lines outward the
 * way the key art's wide-angle "diorama" lens does. The model must match
 * tools/fitCamera3.mjs: src = dst * s * (1 + k * (x^2 + y^2 / aspect^2)), with s chosen
 * so the frame corners still sample inside the rendered image.
 */
export class LensPass extends ShaderPass {
  constructor(k = 0.15) {
    super({
      uniforms: {
        tDiffuse: { value: null },
        uK: { value: k },
        uAspect: { value: 16 / 9 },
        uFringe: { value: 0.0025 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uK;
        uniform float uAspect;
        uniform float uFringe;
        varying vec2 vUv;
        vec2 warp(vec2 ndc, float k) {
          float s = 1.0 / (1.0 + k * (1.0 + 1.0 / (uAspect * uAspect)));
          float r2 = ndc.x * ndc.x + ndc.y * ndc.y / (uAspect * uAspect);
          return ndc * s * (1.0 + k * r2);
        }
        void main() {
          vec2 ndc = vUv * 2.0 - 1.0;
          vec2 g = warp(ndc, uK) * 0.5 + 0.5;
          float r2 = dot(ndc, ndc);
          vec2 off = (g - 0.5) * uFringe * r2;
          vec3 c;
          c.r = texture2D(tDiffuse, g + off).r;
          c.g = texture2D(tDiffuse, g).g;
          c.b = texture2D(tDiffuse, g - off).b;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
  }

  setAspect(aspect) {
    this.uniforms.uAspect.value = aspect;
  }

  /** Maps a distorted screen NDC back to the undistorted render NDC (for picking/UI). */
  undistort(x, y) {
    const k = this.uniforms.uK.value;
    const a = this.uniforms.uAspect.value;
    const s = 1 / (1 + k * (1 + 1 / (a * a)));
    const f = s * (1 + k * (x * x + (y * y) / (a * a)));
    return [x * f, y * f];
  }
}
