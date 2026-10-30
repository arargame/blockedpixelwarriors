import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';

/**
 * Checkpoint gate over the bridge at the terrace entrance: a glowing hoop on two posts the heli
 * flies through. Touching it saves the run (stage 2 start) and turns the hoop green.
 */
export class Checkpoint {
  constructor(effects) {
    this.effects = effects;
    const [x, z] = GameConfig.stages.checkpoint;
    const y = GameConfig.heli.altitude;
    this.position = new THREE.Vector3(x, y, z);
    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    this.ringMaterial = new THREE.MeshStandardMaterial({ color: 0xffd34a, emissive: 0xffb020, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.4 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.16, 12, 48), this.ringMaterial);
    this.group.add(ring);
    this.inner = new THREE.Group();
    const chevron = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0b0, emissiveIntensity: 1.6, roughness: 0.4, transparent: true, opacity: 0.85 });
    this.chevronMaterial = chevron;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.06), chevron);
      tick.position.set(Math.cos(a) * 1.95, Math.sin(a) * 1.95, 0);
      tick.rotation.z = a;
      this.inner.add(tick);
    }
    this.group.add(this.inner);
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.8 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, y + 0.4, 10), postMaterial);
      post.position.set(side * 2.45, -(y + 0.4) / 2 + 0.2, 0);
      post.castShadow = true;
      this.group.add(post);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.7), this.ringMaterial);
      flag.position.set(side * 2.45, 0.9, 0.36);
      this.group.add(flag);
    }
    this.light = new THREE.PointLight(0xffc040, 0, 7, 2);
    this.light.layers.enableAll();
    this.group.add(this.light);
    this.reached = false;
    this.fade = 1;
    this.time = 0;
    this.group.visible = false;
  }

  /** Shown once the depot is cleared (and hidden again after it was reached). */
  show(on) {
    this.group.visible = on;
    if (on) {
      this.reached = false;
      this.fade = 1;
      this.group.scale.setScalar(1);
      this.ringMaterial.color.set(0xffd34a);
      this.ringMaterial.emissive.set(0xffb020);
    }
  }

  /** @returns {boolean} true the moment the heli passes through */
  update(dt, heliPosition) {
    if (!this.group.visible) return false;
    this.time += dt;
    this.inner.rotation.z += dt * 1.4;
    this.light.intensity = this.reached ? 0 : 6 + Math.sin(this.time * 5) * 2;
    if (this.reached) {
      this.fade = Math.max(0, this.fade - dt * 0.8);
      this.group.scale.setScalar(1 + (1 - this.fade) * 0.4);
      this.chevronMaterial.opacity = this.fade * 0.85;
      if (this.fade <= 0) this.group.visible = false;
      return false;
    }
    // Through the hoop or past its line (the heli can't get round it on the bridge).
    if (heliPosition.z < this.position.z + 1.0) {
      this.reached = true;
      this.ringMaterial.color.set(0x7be86a);
      this.ringMaterial.emissive.set(0x40d040);
      this.effects.sparkBurst(this.position, 50, 8, [1.2, 4, 1.2, 1]);
      this.effects.flash(this.position, 0x60ff60, 40, 0.4, 10);
      return true;
    }
    return false;
  }
}
