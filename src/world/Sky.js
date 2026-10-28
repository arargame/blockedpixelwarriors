import * as THREE from 'three';
import { Palette } from '../config/Palette.js';

/**
 * Gradient sky dome with a warm sun halo. The artistic horizon sits below the
 * true horizon so the steep top-down camera still sees blue sky at the top of
 * the frame, as in the key art.
 */
export class Sky {
  /**
   * @param {THREE.Vector3} sunDirection normalized direction toward the visual sun
   */
  constructor(sunDirection) {
    this.uniforms = {
      uTop: { value: new THREE.Color(Palette.skyTop) },
      uMid: { value: new THREE.Color(Palette.skyMid) },
      uHorizon: { value: new THREE.Color(Palette.skyHorizon) },
      uBottom: { value: new THREE.Color(Palette.cloudSea) },
      uSunDir: { value: sunDirection.clone().normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.92, 0.75) },
      uHorizonOffset: { value: -0.52 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = vec4(p.xy, p.w * 0.9999, p.w);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        uniform vec3 uBottom;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uHorizonOffset;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y - uHorizonOffset;
          vec3 col;
          if (h > 0.0) {
            col = mix(uHorizon, uMid, smoothstep(0.0, 0.35, h));
            col = mix(col, uTop, smoothstep(0.35, 1.1, h));
          } else {
            col = mix(uHorizon, uBottom, smoothstep(0.0, 0.25, -h));
          }
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunColor * (pow(s, 6.0) * 0.55 + pow(s, 60.0) * 1.2 + pow(s, 900.0) * 18.0);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), material);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  /** Keeps the dome centered on the camera. */
  update(camera) {
    this.mesh.position.copy(camera.position);
  }
}
