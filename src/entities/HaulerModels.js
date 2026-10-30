import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { BLOCK_COLOR_KEYS } from '../config/Palette.js';

/** Car lengths (train units) as built by tools/blender/build_hauler.py. */
export const HAULER_LENGTHS = Object.freeze({ HaulerLoco: 5.6, HaulerHopper: 4.4, HaulerCrane: 4.6, HaulerCage: 4.2, HaulerOre: 3.9 });

/** Stage-2 train order: locomotive, hopper, crane, cage, hopper, crane, ore hopper. */
export const HAULER_ORDER = Object.freeze(['HaulerLoco', 'HaulerHopper', 'HaulerCrane', 'HaulerCage', 'HaulerHopper', 'HaulerCrane', 'HaulerOre']);

/**
 * Builds the BLOCK HAULER's cars from the Blender model (assets/models/hauler.glb) in the same
 * shape the armored train uses: { group, length, targets, turrets, chimneys, cannons } plus
 * `cranes` (slewing crane with a chain and a wrecking ball). Turrets and cargo cubes come from
 * the armored train's factory so they look and behave the same.
 */
export class HaulerModelFactory {
  /**
   * @param {any} gltf loaded hauler.glb
   * @param {import('./TrainModels.js').TrainModelFactory} armored
   */
  constructor(gltf, armored) {
    this.armored = armored;
    this.roots = {};
    for (const child of gltf.scene.children) this.roots[child.name] = child;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const m = o.material;
      // Lamps / furnace glow above the tone mapper's knee like the other train's lights.
      if (m.emissiveIntensity !== undefined && m.emissive && m.emissive.getHex() !== 0) m.emissiveIntensity = Math.max(m.emissiveIntensity, 1.4);
      if (m.name === 'HlSteel' || m.name === 'HlBall' || m.name === 'HlChain') m.envMapIntensity = 1.6;
    });
  }

  get ready() {
    return HAULER_ORDER.every((n) => this.roots[n]);
  }

  /** Clone of a car root, reset to the origin (cars face +Z, rail-top origin). */
  clone(name) {
    const g = this.roots[name].clone(true);
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    g.updateMatrixWorld(true);
    return g;
  }

  find(group, prefix) {
    let out = null;
    group.traverse((o) => {
      if (!out && o.name.startsWith(prefix)) out = o;
    });
    return out;
  }

  /** Position of a named node in car space. */
  local(group, node) {
    group.updateMatrixWorld(true);
    return group.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
  }

  addTurret(car, at) {
    const turret = this.armored.buildTurret();
    turret.group.position.copy(at);
    car.group.add(turret.group);
    car.turrets.push(turret);
    car.targets.push({
      kind: 'turret', turret, hp: 14, maxHp: 14, alive: true,
      box: new THREE.Box3(new THREE.Vector3(at.x - 0.55, at.y - 0.1, at.z - 0.55), new THREE.Vector3(at.x + 0.55, at.y + 0.85, at.z + 0.55)),
    });
  }

  build(name, rand) {
    const group = this.clone(name);
    const L = HAULER_LENGTHS[name];
    const car = { group, length: L, targets: [], turrets: [], chimneys: [], cannons: [], cranes: [], kind: name };
    const hull = (h) => car.targets.push({ kind: 'hull', box: new THREE.Box3(new THREE.Vector3(-1.2, 0.2, -L / 2), new THREE.Vector3(1.2, h, L / 2 + 0.2)), hp: Infinity, alive: true });
    if (name === 'HaulerLoco') {
      const core = this.find(group, 'Core');
      const c = this.local(group, core);
      car.core = c;
      car.targets.push({ kind: 'gem', hp: 40, maxHp: 40, alive: true, box: new THREE.Box3(new THREE.Vector3(-0.75, c.y - 0.65, c.z - 0.5), new THREE.Vector3(0.75, c.y + 0.65, c.z + 0.45)) });
      for (const n of ['Chimney0', 'Chimney1']) {
        const e = this.find(group, n);
        if (e) car.chimneys.push(this.local(group, e));
      }
      const mount = this.find(group, 'TurretMount');
      if (mount) this.addTurret(car, this.local(group, mount));
      hull(3.6);
    } else if (name === 'HaulerHopper') {
      const deck = this.local(group, this.find(group, 'CargoDeck'));
      const s = 0.88;
      const color = BLOCK_COLOR_KEYS[Math.floor(rand() * 4)];
      for (const x of [-0.47, 0.47]) {
        for (const z of [-1.5, -0.5, 0.5, 1.5]) {
          const layers = 1 + (rand() < 0.55 ? 1 : 0);
          const k = rand() < 0.6 ? color : BLOCK_COLOR_KEYS[Math.floor(rand() * 4)];
          for (let l = 0; l < layers; l++) car.targets.push(this.armored.addCargoCube(group, x, deck.y + s * 0.5 + l * s, z, s, k, l === layers - 1 && rand() < 0.4));
        }
      }
      hull(2.1);
    } else if (name === 'HaulerCrane') {
      const slew = this.find(group, 'CraneSlew');
      const tip = this.find(group, 'CraneTip');
      const chain = this.find(group, 'CraneChain');
      const ball = this.find(group, 'WreckingBall');
      chain.removeFromParent();
      ball.removeFromParent();
      chain.position.set(0, 0, 0);
      ball.position.set(0, 0, 0);
      chain.rotation.set(0, 0, 0);
      chain.scale.set(1, 1, 1);
      const pivot = slew.position.clone();
      const crane = { slew, tip, chain, ball, alive: true, phase: rand() * Math.PI * 2, amp: 1.25 + rand() * 0.2, speed: 0.5 + rand() * 0.15, time: 0 };
      car.cranes.push(crane);
      const target = {
        kind: 'crane', crane, hp: GameConfig.stages.craneHp, maxHp: GameConfig.stages.craneHp, alive: true,
        box: new THREE.Box3(new THREE.Vector3(pivot.x - 0.95, 1.1, pivot.z - 1.6), new THREE.Vector3(pivot.x + 0.95, 3.0, pivot.z + 0.7)),
      };
      crane.target = target;
      car.targets.push(target);
      hull(1.2);
    } else if (name === 'HaulerCage') {
      const mount = this.find(group, 'TurretMount');
      if (mount) this.addTurret(car, this.local(group, mount));
      hull(2.5);
    } else {
      this.addTurret(car, new THREE.Vector3(0, 2.25, 1.2));
      hull(2.3);
    }
    return car;
  }

  /** The whole train (front first). */
  buildTrain(seed) {
    const rand = mulberry(seed * 977 + 13);
    return HAULER_ORDER.map((n) => this.build(n, rand));
  }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
