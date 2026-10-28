import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { TrainModelFactory } from './TrainModels.js';

const local = new THREE.Vector3();
const world = new THREE.Vector3();
const aim = new THREE.Vector3();

/**
 * Armored train that rolls along the railway (+Z), fires its turrets at the
 * helicopter and carries destructible cargo. Its weak spot is the red gem
 * on the locomotive front.
 */
export class Train {
  /**
   * @param {object} deps
   * @param {import('../world/Track.js').Track} deps.track
   * @param {import('../fx/EffectsManager.js').EffectsManager} deps.effects
   * @param {TrainModelFactory} deps.factory
   */
  constructor({ track, effects, factory, wave = 1, seed = 1 }) {
    this.track = track;
    this.effects = effects;
    this.wave = wave;
    this.group = new THREE.Group();
    this.baseSpeed = GameConfig.train.speed * (1 + (wave - 1) * 0.08);
    this.speed = this.baseSpeed;
    /** +1: runs from the far end toward the camera (A->B); -1: the return trip (B->A). */
    this.dir = 1;
    this.lap = 1;
    this.cars = [];
    this.smokeTimer = 0;
    this.destroyed = false;
    this.finished = false;
    this.onTargetDestroyed = null;
    this.onFire = null;

    const cars = [factory.buildLocomotive()];
    // Key-art order: locomotive, armoured car, cargo, armoured car, cargo, cargo...
    const pattern = ['armored', 'cargo', 'armored', 'cargo', 'cargo', 'armored', 'cargo'];
    for (let i = 0; i < GameConfig.train.wagonCount; i++) {
      cars.push(pattern[i % pattern.length] === 'armored' ? factory.buildArmoredWagon(seed * 31 + i) : factory.buildCargoWagon(seed * 17 + i, 0.6));
    }
    let offset = 0;
    for (const car of cars) {
      const z = -offset - car.length / 2;
      car.offsetZ = z;
      car.group.position.set(0, 0, z);
      this.group.add(car.group);
      this.cars.push(car);
      offset += car.length + 0.35;
    }
    this.scale = 1.6;
    this.group.scale.setScalar(this.scale);
    this.totalLength = offset * this.scale;
    this.headZ = track.startZ + this.totalLength;
    this.group.position.set(track.x, track.railTop - 0.05, this.headZ);
    this.planTrip();

    // Red glow from the power gem onto the rails and nearby blocks.
    this.gemLight = new THREE.PointLight(0xff0a1e, 4, 5, 2);
    this.gemLight.position.set(0, 1.4, 2.9);
    this.gemLight.layers.enableAll();
    this.locomotive.group.add(this.gemLight);
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = o.castShadow !== false;
      }
    });
  }

  get locomotive() {
    return this.cars[0];
  }

  /**
   * The same train comes round again: back to the start of the line, cargo wagons reloaded
   * with fresh cubes, but destroyed turrets and gem damage stay as they were.
   */
  restartLap() {
    this.lap += 1;
    this.finished = false;
    // Goods train between A and B: every trip goes back the other way.
    this.dir = -this.dir;
    this.group.rotation.y = this.dir > 0 ? 0 : Math.PI;
    this.setHeadZ(this.dir > 0 ? this.track.startZ + this.totalLength : this.track.endZ - this.totalLength);
    this.planTrip();
    for (const car of this.cars) {
      for (const t of car.targets) {
        if (t.kind !== 'cargo') continue;
        t.alive = true;
        t.hp = t.maxHp;
        t.mesh.visible = true;
      }
    }
  }

  /**
   * Speed plan for this trip: FAST (never stops), NORMAL or SLOW (each may halt for 3 s on the
   * board while its turrets fire faster).
   */
  planTrip() {
    const r = Math.random();
    const cfg = GameConfig.train;
    this.mode = r < cfg.fastChance ? 'FAST' : r < cfg.fastChance + cfg.slowChance ? 'SLOW' : 'NORMAL';
    this.cruise = this.baseSpeed * (this.mode === 'FAST' ? cfg.fastMul : this.mode === 'SLOW' ? cfg.slowMul : 1);
    this.speed = this.cruise;
    this.stopTimer = 0;
    // Where the locomotive halts (somewhere over the board), or never.
    const b = GameConfig.board;
    this.stopAtZ = this.mode !== 'FAST' && Math.random() < cfg.stopChance ? b.minZ + 3 + Math.random() * (b.maxZ - b.minZ - 6) : null;
  }

  get stopped() {
    return this.stopTimer > 0;
  }

  /** World Z extent of the whole train. */
  get minZ() {
    return this.dir > 0 ? this.headZ - this.totalLength : this.headZ;
  }

  get maxZ() {
    return this.dir > 0 ? this.headZ : this.headZ + this.totalLength;
  }

  /** Health of the persistent parts (gem + turrets), 0..1. Cargo reloads every lap. */
  get integrity() {
    let hp = 0;
    let max = 0;
    for (const car of this.cars) {
      for (const t of car.targets) {
        if (t.kind === 'cargo' || t.kind === 'hull') continue;
        max += t.maxHp;
        hp += t.alive ? Math.max(0, t.hp) : 0;
      }
    }
    return this.destroyed ? 0 : hp / Math.max(1, max);
  }

  updateSpeed(dt) {
    if (this.destroyed) {
      // Wrecked: the burning train lurches off and runs out of the scene fast.
      this.stopTimer = 0;
      this.speed = Math.min(GameConfig.train.wreckSpeed, Math.max(this.speed, 2) + GameConfig.train.wreckAccel * dt);
      return;
    }
    if (this.stopTimer > 0) {
      this.stopTimer -= dt;
      this.speed = 0;
      return;
    }
    let target = this.cruise;
    if (this.stopAtZ !== null) {
      const ahead = (this.stopAtZ - this.headZ) * this.dir;
      if (ahead < 0.05) {
        // Arrived: halt for a few seconds.
        this.stopAtZ = null;
        this.stopTimer = GameConfig.train.stopDuration;
        this.speed = 0;
        this.onStop?.();
        return;
      }
      // Brake smoothly into the stop.
      target = Math.min(target, Math.sqrt(2 * 2.2 * ahead));
    }
    // Ease toward the target speed (accelerate after a stop, cruise otherwise).
    this.speed += Math.sign(target - this.speed) * Math.min(Math.abs(target - this.speed), 2.4 * dt);
  }

  /** Places the train with its head at a given z (used by the poster/screenshot mode). */
  setHeadZ(z) {
    this.headZ = z;
    this.group.position.z = z;
  }

  update(dt, heliPosition, heliAlive) {
    this.updateSpeed(dt);
    this.headZ += this.dir * this.speed * dt;
    this.group.position.z = this.headZ;
    this.group.updateMatrixWorld(true);
    if (this.dir > 0 ? this.minZ > this.track.endZ : this.maxZ < this.track.startZ) this.finished = true;

    // Chimney smoke from every car (thick billowing column like the key art).
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = this.destroyed ? 0.03 : 0.035;
      if (this.destroyed) {
        // Fires on the wreck while it leaves.
        const car = this.cars[Math.floor(Math.random() * this.cars.length)];
        car.group.localToWorld(world.set((Math.random() - 0.5) * 1.6, 2 + Math.random(), (Math.random() - 0.5) * 3));
        this.effects.fire.emit({ x: world.x, y: world.y, z: world.z, vy: 2, life: 0.5, size0: 1.2, size1: 0.4, color0: [4, 1.8, 0.4, 1], color1: [1.5, 0.3, 0.05, 0] });
        this.effects.chimneySmoke(world, 0.8);
      }
      for (const car of this.cars) {
        for (const c of car.chimneys) {
          if (Math.random() < (car === this.locomotive ? 0.9 : 0.55)) {
            world.copy(c);
            car.group.localToWorld(world);
            this.effects.chimneySmoke(world, this.destroyed ? 0.6 : 1);
          }
        }
      }
    }
    // Brass side cannons: every so often a random cannon on the helicopter's side of the train
    // fires an aimed shell at it (within range); otherwise it just booms for show.
    if (!this.destroyed) {
      this.cannonTimer = (this.cannonTimer ?? 1) - dt;
      if (this.cannonTimer <= 0) {
        const cfg = GameConfig.train;
        this.cannonTimer = cfg.cannonIntervalMin + Math.random() * (cfg.cannonIntervalMax - cfg.cannonIntervalMin);
        const options = [];
        for (const car of this.cars) {
          for (const cannon of car.cannons ?? []) {
            car.group.localToWorld(world.copy(cannon.muzzle));
            aim.copy(cannon.dir).transformDirection(car.group.matrixWorld);
            const toHeli = new THREE.Vector3().subVectors(heliPosition, world);
            const d = toHeli.length();
            // Facing the heli's side and close enough to reach it.
            if (heliAlive && d < cfg.cannonRange && toHeli.x * aim.x + toHeli.z * aim.z > 0 && world.z > GameConfig.board.minZ - 4 && world.z < GameConfig.board.maxZ + 2) {
              options.push({ car, cannon, muzzle: world.clone(), dir: aim.clone() });
            }
          }
        }
        const pick = options[Math.floor(Math.random() * options.length)];
        if (pick) {
          this.onCannonFire?.(pick.muzzle, heliPosition);
          world.copy(pick.muzzle);
          aim.copy(pick.dir);
        }
        const car = pick?.car ?? this.cars[Math.floor(Math.random() * this.cars.length)];
        const cannon = pick?.cannon ?? car.cannons?.[Math.floor(Math.random() * car.cannons.length)];
        if (cannon) {
          if (!pick) {
            car.group.localToWorld(world.copy(cannon.muzzle));
            aim.copy(cannon.dir).transformDirection(car.group.matrixWorld);
          }
          this.effects.muzzleFlash(world, aim, [5, 2.6, 0.8, 1], 1.4);
          this.effects.flash(world, 0xffa040, 18, 0.15, 6);
          for (let i = 0; i < 4; i++) {
            this.effects.smoke.emit({
              x: world.x, y: world.y, z: world.z, vx: aim.x * 3 + (Math.random() - 0.5), vy: 0.8 + Math.random(), vz: aim.z * 3 + (Math.random() - 0.5), drag: 1.5,
              life: 1.0, size0: 0.4, size1: 1.6, color0: [0.85, 0.85, 0.87, 0.7], color1: [1, 1, 1, 0],
            });
          }
        }
      }
    }

    // Turrets track the helicopter and fire when it is roughly in range.
    for (const car of this.cars) {
      for (const turret of car.turrets) {
        if (!turret.alive || this.destroyed) continue;
        turret.group.getWorldPosition(world);
        aim.subVectors(heliPosition, world);
        const desired = Math.atan2(aim.x, aim.z) - this.group.rotation.y;
        turret.yaw.rotation.y = lerpAngle(turret.yaw.rotation.y, desired, 1 - Math.exp(-5 * dt));
        turret.cooldown -= dt;
        const inBoard = world.z > GameConfig.board.minZ - 4 && world.z < GameConfig.board.maxZ;
        if (turret.cooldown <= 0 && heliAlive && inBoard && aim.length() < 26) {
          // Halted trains are sitting ducks - and they fight back harder.
          const rage = this.stopped ? GameConfig.train.stoppedFireMul : 1;
          turret.cooldown = GameConfig.train.turretFireInterval * rage * (0.75 + Math.random() * 0.5) / (1 + (this.wave - 1) * 0.1);
          const muzzle = turret.muzzles[turret.nextMuzzle++ % turret.muzzles.length].clone();
          turret.yaw.localToWorld(muzzle);
          this.onFire?.(muzzle, heliPosition);
        }
      }
    }
  }

  /**
   * Point hit test against every live target.
   * @returns {{car:any, target:any}|null}
   */
  hitTest(point, exact = false) {
    if (point.z > this.maxZ + 3.5 || point.z < this.minZ - 3.5) return null;
    if (Math.abs(point.x - this.group.position.x) > 1.6 * this.scale) return null;
    for (const car of this.cars) {
      car.group.worldToLocal(local.copy(point));
      for (const target of car.targets) {
        if (!target.alive) continue;
        const b = target.box;
        // Forgiving in Y: from the top-down camera, shots that visually cross a target should hit it.
        if (local.x >= b.min.x && local.x <= b.max.x && local.z >= b.min.z && local.z <= b.max.z && local.y <= b.max.y + (exact ? 0.2 : 1.6) && local.y >= b.min.y - (exact ? 0.2 : 0.5)) {
          return { car, target };
        }
      }
    }
    return null;
  }

  /**
   * @returns {string|null} kind of target destroyed, if any
   */
  damage(car, target, amount, hitPoint) {
    if (target.kind === 'hull') {
      this.effects.impact(hitPoint, [3, 3.2, 3.6, 1]);
      return null;
    }
    target.hp -= amount;
    if (target.kind === 'gem') {
      this.effects.impact(hitPoint, [5, 0.8, 0.5, 1]);
      this.effects.flash(hitPoint, 0xff2010, 25, 0.12, 6);
    } else {
      this.effects.impact(hitPoint);
    }
    if (target.hp > 0) return null;

    target.alive = false;
    car.group.localToWorld(world.copy(target.box.getCenter(local)));
    if (target.kind === 'cargo') {
      // The cube is knocked off the train and falls onto the board as a new block
      // (or shatters if there is no free cell nearby).
      target.mesh.visible = false;
      this.effects.impact(world);
      if (!this.onCargoKnocked?.(world.clone(), target.colorKey)) {
        this.effects.explosion(world, 0.7, null, 0);
        this.effects.shatter(world, target.color, 14, 1.1, [0.18, 0.42]);
      }
    } else if (target.kind === 'turret') {
      target.turret.alive = false;
      target.turret.yaw.visible = false;
      this.effects.explosion(world, 1.0, 0x3a3d42, 10);
    } else if (target.kind === 'gem') {
      this.gemLight.intensity = 0;
      this.destroy();
    }
    this.onTargetDestroyed?.(target.kind, world.clone());
    return target.kind;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const car of this.cars) {
      car.group.getWorldPosition(world);
      world.y += 1.5;
      this.effects.explosion(world, 1.6, 0x4c5056, 18);
      for (const t of car.targets) {
        if (t.kind === 'cargo' && t.alive) {
          t.alive = false;
          t.mesh.visible = false;
          car.group.localToWorld(local.copy(t.box.getCenter(new THREE.Vector3())));
          this.effects.shatter(local, t.color, 8, 1.4);
        }
      }
      for (const turret of car.turrets) turret.alive = false;
    }
  }

  dispose() {
    this.group.removeFromParent();
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
