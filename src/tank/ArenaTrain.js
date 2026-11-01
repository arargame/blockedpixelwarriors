import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';

const w = new THREE.Vector3();

/**
 * A goods train crossing the rail at the far end of the tank channel (locomotive + cargo wagons
 * from TrainModelFactory, the armored train's look). As each wagon passes over a lane it may drop
 * a block into it (sometimes none - a gap -, sometimes two back to back). Trains alternate
 * direction; the level decides when the next one comes and how many blocks are still allowed.
 */
export class ArenaTrain {
  constructor(factory, effects, railY, dir, wagons, seed) {
    const A = GameConfig.tankArena;
    this.effects = effects;
    this.dir = dir;
    this.group = new THREE.Group();
    this.cars = [factory.buildLocomotive()];
    for (let i = 0; i < wagons; i++) this.cars.push(factory.buildCargoWagon(seed * 17 + i, 0.5));
    let offset = 0;
    for (const car of this.cars) {
      car.group.position.set(0, 0, -offset - car.length / 2);
      this.group.add(car.group);
      offset += car.length + 0.35;
      car.lastLane = -2;
    }
    this.scale = 1.6;
    this.length = offset * this.scale;
    this.group.scale.setScalar(this.scale);
    // Facing +x (dir 1) or -x: the cars trail behind the locomotive.
    this.group.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.x = -dir * (A.block * A.lanes / 2 + 40);
    this.group.position.set(this.x, railY + 0.18, A.railZ);
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.smokeTimer = 0;
    this.done = false;
    /** (lane, from) => void : a wagon over a lane drops a block. */
    this.onDrop = null;
    this.endX = dir * (A.block * A.lanes / 2 + 40 + this.length);
  }

  update(dt, laneAt) {
    const A = GameConfig.tankArena;
    this.x += this.dir * A.trainSpeed * dt;
    this.group.position.x = this.x;
    this.group.updateMatrixWorld(true);
    // Wagons over a new lane: drop (or not).
    for (let i = 1; i < this.cars.length; i++) {
      const car = this.cars[i];
      car.group.getWorldPosition(w);
      const lane = laneAt(w.x);
      if (lane !== car.lastLane) {
        car.lastLane = lane;
        if (lane >= 0) this.onDrop?.(lane, w.clone().setY(w.y + 2.4));
      }
    }
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.09;
      const loco = this.cars[0];
      for (const c of loco.chimneys) {
        loco.group.localToWorld(w.copy(c));
        this.effects.chimneySmoke(w, 0.8);
      }
    }
    if (this.dir * (this.x - this.endX) > 0) this.done = true;
  }

  dispose() {
    this.group.removeFromParent();
  }
}
