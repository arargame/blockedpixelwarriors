import * as THREE from 'three';
import { BillboardBatch } from '../fx/BillboardBatch.js';

/**
 * Sprite-based cumulus clouds (sea of clouds below the board, puffs between
 * islands and soft wisps drifting over the board). Back-to-front sorted once
 * against the camera; drift is a slow horizontal offset with wrap-around.
 */
export class CloudLayer {
  /**
   * @param {import('../textures/TextureFactory.js').TextureFactory} textures
   * @param {Array<{x:number,y:number,z:number,size:number,alpha?:number,tint?:number,variant?:number,drift?:number}>} clouds
   */
  constructor(textures, clouds, { renderOrder = 5 } = {}) {
    this.group = new THREE.Group();
    this.variants = [0, 1, 2].map((variant) => {
      const batch = new BillboardBatch(textures.cloudPuff(variant), clouds.length, { additive: false, renderOrder });
      this.group.add(batch.mesh);
      return { batch, items: [] };
    });
    for (const c of clouds) this.variants[(c.variant ?? 0) % 3].items.push({ ...c, offset: 0 });
    this.sorted = false;
  }

  update(dt, camera) {
    for (const { batch, items } of this.variants) {
      if (!this.sorted) {
        items.sort((a, b) => camera.position.distanceToSquared(new THREE.Vector3(b.x, b.y, b.z)) - camera.position.distanceToSquared(new THREE.Vector3(a.x, a.y, a.z)));
      }
      batch.begin();
      for (const c of items) {
        c.offset += (c.drift ?? 0.25) * dt;
        const span = c.wrap ?? 0;
        let x = c.x + c.offset;
        if (span > 0) x = c.x + (((c.offset + span * 0.5) % span) + span) % span - span * 0.5;
        const tint = c.tint ?? 1;
        batch.push(x, c.y, c.z, c.size, c.size * (c.aspect ?? 1), tint, tint, tint, c.alpha ?? 1, 0);
      }
      batch.end();
    }
    this.sorted = true;
  }
}
