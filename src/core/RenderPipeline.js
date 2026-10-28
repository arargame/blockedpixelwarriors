import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ForegroundBlurPass } from './passes/ForegroundBlurPass.js';
import { GradePass } from './passes/GradePass.js';
import { LensPass } from './passes/LensPass.js';
import { GameConfig } from '../config/GameConfig.js';

export const LAYERS = Object.freeze({ WORLD: 0, FOREGROUND: 1 });

/** Quality presets: desktop gets everything, mobile trades resolution and MSAA for frame rate. */
export const QUALITY = Object.freeze({
  high: { pixelRatioCap: 2, msaa: 4, shadowMap: 4096, bloom: true, foregroundBlur: true },
  medium: { pixelRatioCap: 1.5, msaa: 4, shadowMap: 2048, bloom: true, foregroundBlur: true },
  low: { pixelRatioCap: 1, msaa: 0, shadowMap: 1024, bloom: true, foregroundBlur: false },
});

/**
 * Owns the WebGL renderer and the post-processing chain:
 * Scene (MSAA, HDR) -> Foreground blur -> Bloom -> Grade -> ACES tone map + sRGB.
 */
export class RenderPipeline {
  /**
   * @param {HTMLElement} container
   * @param {keyof QUALITY} qualityName
   * @param {{ preserveDrawingBuffer?: boolean }} [options]
   */
  constructor(container, qualityName = 'high', options = {}) {
    this.quality = QUALITY[qualityName] ?? QUALITY.high;
    this.lensK = options.lensK;
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: !!options.preserveDrawingBuffer,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.composer = null;
  }

  /**
   * Builds the pass chain once the scene and camera exist.
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   */
  init(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    const size = this.getSize();
    const target = new THREE.WebGLRenderTarget(size.width, size.height, {
      type: THREE.HalfFloatType,
      samples: this.quality.msaa,
    });
    this.composer = new EffectComposer(this.renderer, target);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    if (this.quality.foregroundBlur) {
      this.foregroundPass = new ForegroundBlurPass(scene, camera, LAYERS.FOREGROUND, { resolutionScale: 0.5, iterations: 2, radius: 0.75 });
      this.composer.addPass(this.foregroundPass);
    }

    if (this.quality.bloom) {
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.38, 0.45, 1.35);
      this.composer.addPass(this.bloomPass);
    }

    this.gradePass = new GradePass();
    this.composer.addPass(this.gradePass);
    this.lensPass = new LensPass(this.lensK ?? GameConfig.camera.lensK ?? 0);
    this.composer.addPass(this.lensPass);
    this.composer.addPass(new OutputPass());

    this.resize();
  }

  getSize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    return { width, height };
  }

  resize() {
    const { width, height } = this.getSize();
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(width, height);
    }
    if (this.camera) {
      const aspect = width / height;
      this.camera.aspect = aspect;
      // Keep the 16:9 horizontal field of view on narrower screens (tablets/portrait), capped.
      const base = this.camera.userData.baseFov;
      if (base) {
        const ref = 16 / 9;
        const hTan = Math.tan(THREE.MathUtils.degToRad(base / 2)) * ref;
        this.camera.fov = aspect < ref ? Math.min(100, THREE.MathUtils.radToDeg(2 * Math.atan(hTan / aspect))) : base;
      }
      this.camera.updateProjectionMatrix();
    }
    this.gradePass?.setAspect(width / height);
    this.lensPass?.setAspect(width / height);
  }

  render(deltaTime) {
    this.composer.render(deltaTime);
    // Overlays drawn on top of the graded frame (upgrade cards keep their full colour).
    if (this.overlay) {
      const r = this.renderer;
      const auto = r.autoClear;
      r.autoClear = false;
      r.clearDepth();
      this.overlay(r, deltaTime);
      r.autoClear = auto;
    }
    this.adaptResolution(deltaTime);
  }

  /**
   * Dynamic resolution: if the average frame time stays above budget, lower the pixel
   * ratio in steps (and raise it again when there is headroom). Keeps phones smooth.
   */
  adaptResolution(deltaTime) {
    if (this.adaptive === false || !deltaTime) return;
    this.frameTimes ??= [];
    this.frameTimes.push(deltaTime);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const maxRatio = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap);
    const current = this.renderer.getPixelRatio();
    let next = current;
    if (avg > 1 / 45) next = Math.max(0.6, current - 0.15);
    else if (avg < 1 / 58 && current < maxRatio) next = Math.min(maxRatio, current + 0.1);
    if (Math.abs(next - current) > 0.01) {
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }
}
