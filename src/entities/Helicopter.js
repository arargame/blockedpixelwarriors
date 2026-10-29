import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { buildHelicopterModel } from './HelicopterModel.js';
import { buildHelicopterFromGltf } from './HelicopterGltf.js';

const tmp = new THREE.Vector3();
const prevVel = new THREE.Vector3();
const accel = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Player helicopter: arcade flight inside the board bounds with banking,
 * rotor animation, hover bob, damage state and weapon hardpoints.
 */
export class Helicopter {
  constructor(materials, textures, board, gltf = null) {
    this.board = board;
    // Blender model when available (assets/models/helicopter.glb), procedural model otherwise.
    const model = gltf ? buildHelicopterFromGltf(gltf, materials) : buildHelicopterModel(materials, textures);
    if (gltf) this.addRotorBlur(model, textures);
    this.model = model;
    this.object3d = new THREE.Group();
    this.object3d.add(model.root);
    model.root.scale.setScalar(gltf ? 0.74 : 0.95);

    this.position = new THREE.Vector3();
    /** Spawn point; the Game sets it from the camera framing. */
    this.spawn = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    // Nose points slightly right of screen-up, toward the railway (key-art pose).
    this.defaultYaw = -0.42;
    this.yaw = this.defaultYaw;
    /** When true the heading follows the movement input (disabled for the fixed poster pose). */
    this.steerable = true;
    /** true: nose turns toward the movement (touch joystick); false: keyboard pilot mode. */
    this.faceMovement = true;
    /** Keyboard yaw input, +1 = turn left (Q), -1 = turn right (E). */
    this.turnInput = 0;
    /** Heading the heli turns toward. */
    this.targetYaw = this.defaultYaw;
    this.yawRate = 0;
    this.tiltPitch = 0;
    this.tiltRoll = 0;
    this.object3d.rotation.order = 'YXZ';
    this.hp = GameConfig.heli.maxHp;
    this.time = 0;
    this.hitFlash = 0;
    this.invulnerable = 0;
    /** FLICKER card: multiplies every post-hit / respawn flicker (invulnerability) window. */
    this.flickerMul = 1;
    this.alive = true;
    this.radius = 1.3;
    this.object3d.position.copy(this.position);
  }

  /**
   * Spinning blades read as a blur: blades turn semi-transparent and a motion-blur disc with
   * yellow tips is added to the rotor hub (as in the key art).
   */
  addRotorBlur(model, textures) {
    model.rotor.traverse((o) => {
      if (o.isMesh && o.material.name === 'BladeGrey') {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.7;
        o.material.depthWrite = false;
        o.renderOrder = 19;
      }
    });
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(3.62, 64),
      new THREE.MeshBasicMaterial({ map: textures.rotorDisc(), transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.03;
    disc.renderOrder = 20;
    model.rotor.add(disc);
    model.disc = disc;
  }

  /** Rotates a heli-local direction (nose = -Z) into world space around Y. */
  toWorldDirection(direction) {
    return direction.applyAxisAngle(UP, this.yaw);
  }

  /** World position of a named hardpoint. */
  hardpoint(name, target = new THREE.Vector3()) {
    target.copy(this.model.hardpoints[name]);
    return this.model.root.localToWorld(target);
  }

  /**
   * @param {number} dt
   * @param {{x:number, z:number}} move normalized input direction in world XZ
   */
  update(dt, move) {
    const cfg = GameConfig.heli;
    this.time += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);

    // Inertial flight: velocity builds up and bleeds off smoothly (no instant stops/starts).
    tmp.set(move.x, 0, move.z).multiplyScalar(cfg.speed);
    const k = 1 - Math.exp(-cfg.accel * dt);
    prevVel.copy(this.velocity);
    this.velocity.lerp(tmp, k);
    this.position.addScaledVector(this.velocity, dt);

    const b = this.board.bounds;
    const m = cfg.margin;
    this.position.x = THREE.MathUtils.clamp(this.position.x, b.minX + m, b.maxX - m);
    this.position.z = THREE.MathUtils.clamp(this.position.z, b.minZ + m + 2, b.maxZ - m - 0.6);
    this.position.y = cfg.altitude + Math.sin(this.time * 2.1) * 0.12;
    this.object3d.position.copy(this.position);

    // Heading: the nose turns toward the stick direction with a limited, eased yaw rate.
    // Pulling back (input roughly opposite the nose) makes it back up first and only slowly
    // swing its nose around, like a real helicopter - no instant 180 degree flips.
    let desiredRate = 0;
    const input = Math.hypot(move.x, move.z);
    if (this.steerable && !this.faceMovement) {
      // Pilot (keyboard) mode: heading changes only with the turn keys.
      desiredRate = this.turnInput * cfg.keyTurnRate;
    } else if (this.steerable && input > 0.2) {
      this.targetYaw = Math.atan2(-move.x, -move.z);
      let dYaw = this.targetYaw - this.yaw;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
      const reversing = Math.abs(dYaw) > cfg.reverseAngle;
      const maxRate = reversing ? cfg.reverseTurnRate : cfg.turnRate;
      desiredRate = THREE.MathUtils.clamp(dYaw * 2.6, -maxRate, maxRate) * Math.min(1, input * 1.3);
    } else if (!this.steerable) {
      let dYaw = this.targetYaw - this.yaw;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
      desiredRate = dYaw * 4;
    }
    this.yawRate += (desiredRate - this.yawRate) * (1 - Math.exp(-cfg.yawAccel * dt));
    this.yaw += this.yawRate * dt;

    // Attitude from motion in the heli's own frame: nose dips when flying forward and lifts when
    // backing up or braking; it banks into strafes and into turns. Smoothed for weight.
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const forwardSpeed = this.velocity.x * -sinY + this.velocity.z * -cosY;
    const rightSpeed = this.velocity.x * cosY + this.velocity.z * -sinY;
    accel.subVectors(this.velocity, prevVel).divideScalar(Math.max(dt, 1e-3));
    const forwardAccel = accel.x * -sinY + accel.z * -cosY;
    const rightAccel = accel.x * cosY + accel.z * -sinY;
    const targetPitch = -THREE.MathUtils.clamp(forwardSpeed / cfg.speed * 0.2 + forwardAccel * 0.012, -0.4, 0.4);
    const targetRoll = -THREE.MathUtils.clamp(rightSpeed / cfg.speed * 0.26 + rightAccel * 0.012 - this.yawRate * 0.1, -0.5, 0.5);
    const ease = 1 - Math.exp(-5 * dt);
    this.tiltPitch += (targetPitch - this.tiltPitch) * ease;
    this.tiltRoll += (targetRoll - this.tiltRoll) * ease;
    // The poster keeps the key-art attack pose; in play the heli hovers level.
    const basePitch = this.steerable ? -0.05 : -0.3;
    const baseRoll = this.steerable ? 0 : 0.16;
    this.object3d.rotation.set(this.tiltPitch + basePitch, this.yaw + Math.sin(this.time * 0.7) * 0.015, this.tiltRoll + baseRoll);

    // Blink while invulnerable after a hit (damage feedback).
    this.object3d.visible = this.invulnerable <= 0 || Math.floor(this.invulnerable * 16) % 2 === 0;
    this.model.rotor.rotation.y += dt * 38;
    this.model.tailRotor.rotation.x += dt * 55;
  }

  /** @returns {boolean} true if the hit was applied */
  takeDamage(amount) {
    if (!this.alive || this.invulnerable > 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlash = 0.15;
    this.invulnerable = 0.25 * this.flickerMul;
    if (this.hp <= 0) this.alive = false;
    return true;
  }

  respawn() {
    this.hp = GameConfig.heli.maxHp;
    this.alive = true;
    this.invulnerable = 2.5 * this.flickerMul;
    this.position.copy(this.spawn);
    this.velocity.set(0, 0, 0);
    this.yaw = this.targetYaw = this.defaultYaw;
    this.yawRate = 0;
    this.object3d.visible = true;
  }
}
