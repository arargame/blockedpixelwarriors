import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Linear-HDR color grade applied before tone mapping: saturation, contrast,
 * warm sun bloom in screen space, sky haze toward the top and a soft vignette.
 */
export class GradePass extends ShaderPass {
  constructor() {
    super({
      uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: 0.9 },
        uSaturation: { value: 1.5 },
        uContrast: { value: 1.26 },
        uVignette: { value: 0.75 },
        uSunPos: { value: new THREE.Vector2(0.08, 0.95) },
        uSunColor: { value: new THREE.Color(1.0, 0.86, 0.6) },
        uSunStrength: { value: 0.16 },
        uAspect: { value: 16 / 9 },
        uHaze: { value: new THREE.Color(0.75, 0.88, 1.0) },
        uHazeStrength: { value: 0.0 },
        uTint: { value: new THREE.Color(1.04, 1.0, 0.95) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uExposure;
        uniform float uSaturation;
        uniform float uContrast;
        uniform float uVignette;
        uniform vec2 uSunPos;
        uniform vec3 uSunColor;
        uniform float uSunStrength;
        uniform float uAspect;
        uniform vec3 uHaze;
        uniform float uHazeStrength;
        uniform vec3 uTint;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure * uTint;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, uSaturation);
          c = max((c - 0.18) * uContrast + 0.18, vec3(0.0));

          vec2 d = (vUv - uSunPos) * vec2(uAspect, 1.0);
          float dist = length(d);
          c += uSunColor * (exp(-dist * 2.4) * 0.8 + exp(-dist * 7.0) * 0.6) * uSunStrength;

          c = mix(c, uHaze * max(l, 0.6), smoothstep(0.55, 1.0, vUv.y) * uHazeStrength);

          vec2 v = vUv - 0.5;
          c *= 1.0 - dot(v, v) * uVignette;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
  }

  setAspect(aspect) {
    this.uniforms.uAspect.value = aspect;
  }
}
