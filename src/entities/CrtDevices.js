import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';

const box = new THREE.Box3();
const size = new THREE.Vector3();
const center = new THREE.Vector3();
const hidden = new THREE.MeshBasicMaterial({ visible: false });

/**
 * Stage 2 CRT comm devices (Blocked Pixel Panzer's CRT supply, rebuilt in Blender:
 * assets/models/crt.glb). Exactly one train cargo cube in every `crtEvery` loaded on the terrace
 * is a CRT radio instead of a coloured cube: the cubes are counted over every train and every
 * trip, and each run of `crtEvery` cubes gets one at a random place in it. Shot off the train
 * (or left on a destroyed one) it drops onto the terrace as a pickup.
 */
export class CrtDevices {
  /** @param {THREE.Object3D|null} model root of crt.glb (CrtRadio) */
  constructor(model) {
    this.template = model ? CrtDevices.normalize(model) : null;
    this.reset();
  }

  /** Centres the radio in a unit cube (it replaces a cargo cube of size 1 in car space). */
  static normalize(model, fit = 0.98) {
    const root = new THREE.Group();
    const m = model.clone(true);
    box.setFromObject(m);
    box.getSize(size);
    box.getCenter(center);
    const s = fit / Math.max(size.x, size.y, size.z);
    m.position.sub(center).multiplyScalar(s);
    m.scale.multiplyScalar(s);
    m.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    root.add(m);
    return root;
  }

  /** New run: counting starts again. */
  reset() {
    this.loaded = 0;
    this.slot = this.rollSlot();
  }

  rollSlot() {
    return Math.floor(Math.random() * GameConfig.stages.crtEvery);
  }

  /** Counts one freshly loaded cube; true when it is this run's CRT. */
  next() {
    const n = GameConfig.stages.crtEvery;
    const hit = this.loaded % n === this.slot;
    this.loaded += 1;
    if (this.loaded % n === 0) this.slot = this.rollSlot();
    return hit;
  }

  /** Every live cargo cube of a train (or of one car) is counted; the chosen one becomes a CRT. */
  load(cars) {
    for (const car of cars) {
      for (const t of car.targets) {
        if (t.kind !== 'cargo' || !t.alive) continue;
        this.mark(t, !!this.template && this.next());
      }
    }
  }

  /** Turns a cargo cube into a CRT radio (or back into a plain cube). */
  mark(t, on) {
    if (on === !!t.crt) return;
    t.crt = on;
    if (on) {
      t.cubeMaterial ??= t.mesh.material;
      t.mesh.material = hidden;
      t.crtNode ??= this.template.clone(true);
      t.mesh.add(t.crtNode);
      for (const c of t.mesh.children) if (c !== t.crtNode) c.visible = false;
    } else {
      t.mesh.material = t.cubeMaterial;
      t.crtNode?.removeFromParent();
      for (const c of t.mesh.children) c.visible = true;
    }
  }

  /** A pickup copy of the radio (the size of a supply crate). */
  pickupMesh() {
    const m = this.template.clone(true);
    m.scale.setScalar(1.15);
    return m;
  }
}
