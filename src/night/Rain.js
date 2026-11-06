import * as THREE from 'three';

export const MAX_RAIN_LIGHTS = 8;

const LIGHTING = /* glsl */ `
  uniform vec4 uLights[${MAX_RAIN_LIGHTS}];
  uniform vec3 uLightCol[${MAX_RAIN_LIGHTS}];
  uniform vec3 uAmbient;
  uniform float uFlash;
  vec3 rainLight(vec3 p) {
    vec3 c = uAmbient * (1.0 + uFlash * 6.0);
    for (int i = 0; i < ${MAX_RAIN_LIGHTS}; i++) {
      vec4 L = uLights[i];
      float d = length(p - L.xyz) / max(L.w, 0.001);
      float k = clamp(1.0 - d, 0.0, 1.0);
      c += uLightCol[i] * k * k;
    }
    return c;
  }
`;

/**
 * Rain for the night level, all on the GPU (no per-drop CPU work):
 *   streaks   instanced quads falling through a box round the arena, slanted by the wind,
 *             billboarded about the fall axis; each one glints in the street lamps it passes
 *             (up to MAX_RAIN_LIGHTS lights: position + reach, colour) and in lightning flashes
 *   ripples   instanced rings on the ground, each spreading and fading, then reappearing at a new
 *             hashed spot - the rain hitting the wet street, lit the same way
 * setLights() feeds the lamp list; update() moves time and the box centre.
 */
export class Rain {
  /**
   * @param {THREE.Scene} scene
   * @param {{ drops?: number, ripples?: number, box?: THREE.Vector3, ground?: number }} [o]
   */
  constructor(scene, { drops = 9000, ripples = 900, box = new THREE.Vector3(70, 34, 66), ground = 0.02 } = {}) {
    this.lights = Array.from({ length: MAX_RAIN_LIGHTS }, () => new THREE.Vector4(0, -100, 0, 0.001));
    this.lightCol = Array.from({ length: MAX_RAIN_LIGHTS }, () => new THREE.Color(0, 0, 0));
    this.uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: box },
      uWind: { value: new THREE.Vector2(0.18, -0.08) },
      uSpeed: { value: 26 },
      uLen: { value: 0.75 },
      uWidth: { value: 0.013 },
      uLights: { value: this.lights },
      uLightCol: { value: this.lightCol },
      uAmbient: { value: new THREE.Color(0.05, 0.065, 0.1) },
      uFlash: { value: 0 },
      uGround: { value: ground },
    };
    this.streaks = this.buildStreaks(drops);
    this.ripples = this.buildRipples(ripples);
    scene.add(this.streaks, this.ripples);
  }

  buildStreaks(count) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seed[i * 4] = Math.random();
      seed[i * 4 + 1] = Math.random();
      seed[i * 4 + 2] = Math.random();
      seed[i * 4 + 3] = 0.7 + Math.random() * 0.6;
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = count;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uBox;
        uniform vec2 uWind;
        uniform float uSpeed;
        uniform float uLen;
        uniform float uWidth;
        uniform float uGround;
        varying vec2 vUv;
        varying vec3 vLight;
        varying float vFade;
        ${LIGHTING}
        void main() {
          float fall = uSpeed * aSeed.w;
          float y01 = fract(aSeed.z - uTime * fall / uBox.y);
          vec3 dir = normalize(vec3(uWind.x * fall, -fall, uWind.y * fall));
          float h = y01 * uBox.y;
          vec3 base = uCenter + vec3((aSeed.x - 0.5) * uBox.x, uGround + h, (aSeed.y - 0.5) * uBox.z);
          base.xz -= dir.xz / max(-dir.y, 0.2) * h;
          vec3 toCam = normalize(cameraPosition - base);
          vec3 side = normalize(cross(dir, toCam));
          float len = uLen * aSeed.w;
          vec3 p = base + side * position.x * uWidth * (0.8 + aSeed.w * 0.4) - dir * position.y * len;
          vUv = uv;
          vLight = rainLight(base);
          // Fade near the box edges and right at the ground.
          vec2 e = abs(vec2(aSeed.x, aSeed.y) - 0.5) * 2.0;
          vFade = (1.0 - smoothstep(0.75, 1.0, max(e.x, e.y))) * smoothstep(0.0, 0.03, y01);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vLight;
        varying float vFade;
        void main() {
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float along = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
          float a = across * across * along * vFade;
          gl_FragColor = vec4(vLight * a * 1.6, a);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    return mesh;
  }

  buildRipples(count) {
    const base = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seed[i * 4] = Math.random() * 100;
      seed[i * 4 + 1] = Math.random() * 100;
      seed[i * 4 + 2] = Math.random();
      seed[i * 4 + 3] = 0.6 + Math.random() * 0.8;
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = count;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uBox;
        uniform float uGround;
        varying vec2 vUv;
        varying float vT;
        varying vec3 vLight;
        ${LIGHTING}
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          float cyc = uTime * 1.6 * aSeed.w + aSeed.z;
          float n = floor(cyc);
          vT = fract(cyc);
          vec2 h = vec2(hash(aSeed.xy + n), hash(aSeed.yx + n * 1.37));
          vec3 c = uCenter + vec3((h.x - 0.5) * uBox.x * 0.75, uGround, (h.y - 0.5) * uBox.z * 0.75);
          float s = mix(0.08, 0.55, vT) * (0.7 + aSeed.w * 0.4);
          vUv = uv;
          vLight = rainLight(c + vec3(0.0, 0.6, 0.0));
          gl_Position = projectionMatrix * viewMatrix * vec4(c + position * s, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vT;
        varying vec3 vLight;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.62, 0.86, r) * (1.0 - smoothstep(0.86, 1.0, r));
          float dot0 = (1.0 - smoothstep(0.0, 0.35, r)) * (1.0 - smoothstep(0.0, 0.18, vT));
          float a = (ring * (1.0 - vT) + dot0 * 1.5) * 0.85;
          gl_FragColor = vec4(vLight * a * 1.8, a);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 19;
    return mesh;
  }

  /** Lamps lighting the rain: [{ position: Vector3, reach: number, color: Color (HDR) }]. */
  setLights(list) {
    for (let i = 0; i < MAX_RAIN_LIGHTS; i++) {
      const L = list[i];
      if (L) {
        this.lights[i].set(L.position.x, L.position.y, L.position.z, L.reach);
        this.lightCol[i].copy(L.color);
      } else {
        this.lights[i].set(0, -100, 0, 0.001);
        this.lightCol[i].setRGB(0, 0, 0);
      }
    }
  }

  update(dt, center, flash = 0) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uCenter.value.copy(center);
    this.uniforms.uFlash.value = flash;
  }

  set visible(v) {
    this.streaks.visible = v;
    this.ripples.visible = v;
  }
}
