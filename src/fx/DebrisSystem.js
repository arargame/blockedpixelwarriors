import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const dummy = new THREE.Object3D();
const color = new THREE.Color();

/**
 * Flying voxel chunks from destroyed blocks and cargo. One InstancedMesh,
 * simple rigid-body-ish motion with ground bounce and spin.
 */
export class DebrisSystem {
  /**
   * @param {THREE.Material} material instanced voxel material (uses instanceColor)
   * @param {number} capacity
   * @param {(x:number, z:number) => number|null} groundHeightAt returns floor height or null (falls forever)
   */
  constructor(material, capacity, groundHeightAt) {
    this.capacity = capacity;
    this.groundHeightAt = groundHeightAt;
    const geometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, color.setRGB(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    /** @type {Array<{pos:THREE.Vector3, vel:THREE.Vector3, rot:THREE.Euler, spin:THREE.Vector3, size:number, life:number, maxLife:number, color:THREE.Color, resting:boolean}>} */
    this.items = [];
  }

  spawn({ position, velocity, size = 0.3, life = 3.5, color: c, spin = 10 }) {
    if (this.items.length >= this.capacity) this.items.shift();
    this.items.push({
      pos: position.clone(),
      vel: velocity.clone(),
      rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      spin: new THREE.Vector3((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin),
      size,
      life: 0,
      maxLife: life * (0.75 + Math.random() * 0.5),
      color: new THREE.Color(c),
      resting: false,
    });
  }

  update(dt) {
    const items = this.items;
    let write = 0;
    for (let i = 0; i < items.length; i++) {
      const d = items[i];
      d.life += dt;
      if (d.life >= d.maxLife || d.pos.y < -60) continue;
      if (!d.resting) {
        d.vel.y -= 22 * dt;
        d.pos.addScaledVector(d.vel, dt);
        d.rot.x += d.spin.x * dt;
        d.rot.y += d.spin.y * dt;
        d.rot.z += d.spin.z * dt;
        const ground = this.groundHeightAt(d.pos.x, d.pos.z);
        if (ground !== null && d.pos.y - d.size * 0.5 < ground && d.vel.y < 0) {
          d.pos.y = ground + d.size * 0.5;
          d.vel.y *= -0.35;
          d.vel.x *= 0.6;
          d.vel.z *= 0.6;
          d.spin.multiplyScalar(0.5);
          if (Math.abs(d.vel.y) < 1.2) {
            d.resting = true;
            d.rot.x = Math.round(d.rot.x / (Math.PI / 2)) * (Math.PI / 2);
            d.rot.z = Math.round(d.rot.z / (Math.PI / 2)) * (Math.PI / 2);
          }
        }
      }
      const fade = 1 - Math.max(0, (d.life - d.maxLife + 0.5) / 0.5);
      dummy.position.copy(d.pos);
      dummy.rotation.copy(d.rot);
      dummy.scale.setScalar(d.size * Math.max(0.001, fade));
      dummy.updateMatrix();
      this.mesh.setMatrixAt(write, dummy.matrix);
      this.mesh.setColorAt(write, d.color);
      items[write++] = d;
    }
    items.length = write;
    this.mesh.count = write;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
