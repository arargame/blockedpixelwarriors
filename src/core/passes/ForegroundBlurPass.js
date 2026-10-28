import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const BLUR_SHADER = {
  uniforms: {
    tInput: { value: null },
    uDirection: { value: new THREE.Vector2(1, 0) },
    uTexel: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tInput;
    uniform vec2 uDirection;
    uniform vec2 uTexel;
    varying vec2 vUv;
    void main() {
      // 9-tap gaussian on premultiplied RGBA.
      vec2 o = uDirection * uTexel;
      vec4 c = texture2D(tInput, vUv) * 0.2270270270;
      c += texture2D(tInput, vUv + o * 1.3846153846) * 0.3162162162;
      c += texture2D(tInput, vUv - o * 1.3846153846) * 0.3162162162;
      c += texture2D(tInput, vUv + o * 3.2307692308) * 0.0702702703;
      c += texture2D(tInput, vUv - o * 3.2307692308) * 0.0702702703;
      gl_FragColor = c;
    }
  `,
};

const COMPOSITE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tForeground: { value: null },
  },
  vertexShader: BLUR_SHADER.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tForeground;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec4 fg = texture2D(tForeground, vUv);
      gl_FragColor = vec4(fg.rgb + base.rgb * (1.0 - fg.a), 1.0);
    }
  `,
};

/**
 * Renders objects on a dedicated layer (big foreground trees close to the lens),
 * blurs them heavily and composites them on top of the frame. This is a cheap,
 * stable stand-in for a full depth-of-field pass and reproduces the key art's
 * blurred foreground framing.
 */
export class ForegroundBlurPass extends Pass {
  constructor(scene, camera, layer, { resolutionScale = 0.5, iterations = 3, radius = 1.6 } = {}) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.layer = layer;
    this.resolutionScale = resolutionScale;
    this.iterations = iterations;
    this.radius = radius;

    const options = { type: THREE.HalfFloatType, depthBuffer: true };
    this.targetA = new THREE.WebGLRenderTarget(1, 1, options);
    this.targetB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });

    this.blurMaterial = new THREE.ShaderMaterial({ ...BLUR_SHADER, uniforms: THREE.UniformsUtils.clone(BLUR_SHADER.uniforms), depthTest: false, depthWrite: false });
    this.compositeMaterial = new THREE.ShaderMaterial({ ...COMPOSITE_SHADER, uniforms: THREE.UniformsUtils.clone(COMPOSITE_SHADER.uniforms), depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.blurMaterial);
    this.clearColor = new THREE.Color(0, 0, 0);
  }

  setSize(width, height) {
    const w = Math.max(1, Math.round(width * this.resolutionScale));
    const h = Math.max(1, Math.round(height * this.resolutionScale));
    this.targetA.setSize(w, h);
    this.targetB.setSize(w, h);
    this.blurMaterial.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  render(renderer, writeBuffer, readBuffer) {
    const oldLayers = this.camera.layers.mask;
    const oldBackground = this.scene.background;
    const oldAutoShadow = renderer.shadowMap.autoUpdate;
    const oldClearColor = renderer.getClearColor(new THREE.Color());
    const oldClearAlpha = renderer.getClearAlpha();

    // 1) Foreground layer only, transparent background.
    this.camera.layers.set(this.layer);
    this.scene.background = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(this.clearColor, 0);
    renderer.setRenderTarget(this.targetA);
    renderer.clear(true, true, true);
    renderer.render(this.scene, this.camera);

    this.camera.layers.mask = oldLayers;
    this.scene.background = oldBackground;
    renderer.shadowMap.autoUpdate = oldAutoShadow;
    renderer.setClearColor(oldClearColor, oldClearAlpha);

    // 2) Separable blur ping-pong.
    this.quad.material = this.blurMaterial;
    for (let i = 0; i < this.iterations; i++) {
      const spread = this.radius * (i + 1);
      this.blurMaterial.uniforms.tInput.value = this.targetA.texture;
      this.blurMaterial.uniforms.uDirection.value.set(spread, 0);
      renderer.setRenderTarget(this.targetB);
      this.quad.render(renderer);
      this.blurMaterial.uniforms.tInput.value = this.targetB.texture;
      this.blurMaterial.uniforms.uDirection.value.set(0, spread);
      renderer.setRenderTarget(this.targetA);
      this.quad.render(renderer);
    }

    // 3) Composite over the main frame.
    this.compositeMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    this.compositeMaterial.uniforms.tForeground.value = this.targetA.texture;
    this.quad.material = this.compositeMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.targetA.dispose();
    this.targetB.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
    this.quad.dispose();
  }
}
