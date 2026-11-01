import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const p = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * The player's tank (assets/models/tank.glb, built in Blender by tools/blender/build_tank.py).
 *
 *   hull     drives on the ground: W/S throttle, A/D turn on the spot or while moving
 *   tracks   one link template instanced round both loops; each side runs at its own speed, so
 *            the links visibly roll (opposite ways when the tank turns on the spot)
 *   turret   turns toward the aim point at a limited rate
 *   barrel   kicks back along its axis on every shot and springs home
 *   lamps    red tail lamps and the amber turret lamps blink (materials TankRed / TankAmber)
 */
export class PlayerTank {
  /** @param {import('three/addons/loaders/GLTFLoader.js').GLTF} gltf */
  constructor(gltf) {
    const cfg = GameConfig.tank;
    this.root = gltf.scene.getObjectByName('Tank').clone(true);
    this.root.position.set(0, 0, 0);
    this.turret = this.root.getObjectByName('TankTurret');
    this.barrel = this.root.getObjectByName('TankBarrel');
    this.muzzle = this.root.getObjectByName('TankMuzzle');
    this.barrelHome = this.barrel.position.clone();
    // Barrel axis in turret space (the pitch is baked into the barrel mesh; the muzzle empty sits
    // on the axis at the tip).
    this.barrelAxis = this.muzzle.position.clone().applyQuaternion(this.barrel.quaternion).normalize();
    // The barrel elevates / depresses about its base (turret x axis) toward the target; the model's
    // own (raised) pitch is elevation0.
    this.barrelQuat0 = this.barrel.quaternion.clone();
    this.elevation0 = Math.asin(THREE.MathUtils.clamp(this.barrelAxis.y, -1, 1));
    this.elevation = -0.12;
    this.aimElevation = -0.12;
    this.track = JSON.parse(this.root.userData.track ?? gltf.scene.getObjectByName('Tank').userData.track);
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    // Blinking lamps: own material instances so the glow can be driven per tank.
    this.lamps = { red: [], amber: [] };
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      list.forEach((mat, i) => {
        const key = mat.name === 'TankRed' ? 'red' : mat.name === 'TankAmber' ? 'amber' : null;
        if (!key) return;
        const own = mat.clone();
        own.userData.baseIntensity = mat.emissiveIntensity || 1;
        if (Array.isArray(o.material)) o.material[i] = own;
        else o.material = own;
        this.lamps[key].push(own);
      });
    });
    // Track links: hide the template, instance each of its meshes round both loops.
    const link = this.root.getObjectByName('TankLink');
    link.visible = false;
    link.updateMatrixWorld(true);
    const linkInv = new THREE.Matrix4().copy(link.matrixWorld).invert();
    this.linkMeshes = [];
    link.traverse((o) => {
      if (!o.isMesh) return;
      // Bake the mesh's offset inside the link node into its geometry.
      const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(linkInv, o.matrixWorld));
      const inst = new THREE.InstancedMesh(g, o.material, this.track.count * 2);
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      this.root.add(inst);
      this.linkMeshes.push(inst);
    });
    this.trackOffset = [0, 0];

    this.heading = 0;
    this.speed = 0;
    this.turnRate = 0;
    this.turretYaw = 0;
    this.aimYaw = 0;
    this.recoil = 0;
    this.recoilVel = 0;
    this.cooldown = 0;
    this.time = 0;
    this.maxSpeed = cfg.speed;
    /** Drivable area and ground height (set by the level). */
    this.bounds = { minX: -cfg.bounds, maxX: cfg.bounds, minZ: -cfg.bounds, maxZ: cfg.bounds };
    this.heightAt = null;
    /** Collision box half size (hull footprint, tank space) and the level's collision hook. */
    this.half = { x: 2.0, z: 2.25 };
    this.collide = null;
    /** (x, z, heading) => can the hull footprint stand there (set by the level). */
    this.canStand = null;
    this.updateTracks(0, 0, 0);
  }

  get position() {
    return this.root.position;
  }

  /** World yaw the barrel points at (hull heading + turret yaw). */
  get gunYaw() {
    return this.heading + this.turretYaw;
  }

  /**
   * @param {number} dt
   * @param {{throttle:number, turn:number}} drive -1..1 each
   * @param {THREE.Vector3|null} aim world point to aim the turret at
   */
  update(dt, drive, aim) {
    const cfg = GameConfig.tank;
    this.time += dt;
    // Hull: accelerate toward the throttle, turn (a little slower at full speed).
    const target = drive.throttle * cfg.speed * (drive.throttle < 0 ? cfg.reverseMul : 1);
    const acc = Math.abs(target) > Math.abs(this.speed) ? cfg.accel : cfg.brake;
    this.speed += THREE.MathUtils.clamp(target - this.speed, -acc * dt, acc * dt);
    const turnTarget = -drive.turn * cfg.turnSpeed * (Math.abs(this.speed) > 0.1 && this.speed < 0 ? -1 : 1);
    this.turnRate += (turnTarget - this.turnRate) * (1 - Math.exp(-8 * dt));
    const p = this.root.position;
    const ox = p.x;
    const oz = p.z;
    const oh = this.heading;
    this.heading += this.turnRate * dt;
    let nx = ox + Math.sin(this.heading) * this.speed * dt;
    let nz = oz + Math.cos(this.heading) * this.speed * dt;
    // Where the level says the hull cannot stand (walls, trees, a closed gate) it slides along
    // the obstacle on one axis or stops.
    if (this.canStand && !this.canStand(nx, nz, this.heading)) {
      if (this.canStand(nx, oz, this.heading)) nz = oz;
      else if (this.canStand(ox, nz, this.heading)) nx = ox;
      else {
        nx = ox;
        nz = oz;
        if (!this.canStand(ox, oz, this.heading)) this.heading = oh;
      }
    }
    p.x = nx;
    p.z = nz;
    this.clampToBounds();
    // Blocks are solid: the level pushes the hull back out of them (never into a wall).
    if (this.collide) {
      this.collide();
      this.clampToBounds();
      if (this.canStand && !this.canStand(p.x, p.z, this.heading)) {
        p.x = nx;
        p.z = nz;
      }
    }
    if (this.heightAt) p.y = this.heightAt(p.x, p.z);
    this.root.rotation.y = this.heading;
    // Slight pitch with acceleration (nose lifts pulling away, dips braking).
    this.root.rotation.x = THREE.MathUtils.lerp(this.root.rotation.x, -THREE.MathUtils.clamp((target - this.speed) * 0.012, -0.04, 0.04), 1 - Math.exp(-6 * dt));

    // Turret: turn toward the aim point at a limited rate.
    if (aim) {
      this.aimYaw = Math.atan2(aim.x - this.root.position.x, aim.z - this.root.position.z) - this.heading;
    }
    let d = wrap(this.aimYaw - this.turretYaw);
    const step = cfg.turretSpeed * dt;
    this.turretYaw = wrap(this.turretYaw + THREE.MathUtils.clamp(d, -step, step));
    this.turret.rotation.y = this.turretYaw;

    // Barrel recoil: a damped spring pulling it home along its axis.
    this.recoilVel += (-this.recoil * cfg.recoilSpring - this.recoilVel * cfg.recoilDamping) * dt;
    this.recoil = Math.max(0, this.recoil + this.recoilVel * dt);
    // Barrel elevation toward aimElevation at a limited rate, then the recoil along its axis.
    const de = THREE.MathUtils.clamp(this.aimElevation - this.elevation, -cfg.elevationSpeed * dt, cfg.elevationSpeed * dt);
    this.elevation = THREE.MathUtils.clamp(this.elevation + de, cfg.elevationMin, cfg.elevationMax);
    this.barrel.quaternion.setFromAxisAngle(X_AXIS, this.elevation0 - this.elevation).multiply(this.barrelQuat0);
    this.barrelAxis.copy(this.muzzle.position).applyQuaternion(this.barrel.quaternion).normalize();
    this.barrel.position.copy(this.barrelHome).addScaledVector(this.barrelAxis, -this.recoil);
    this.cooldown = Math.max(0, this.cooldown - dt);

    // Tracks: each side moves with the hull plus its share of the turn.
    // (A point at hull x moves at speed - turnRate * x along the hull while turning.)
    this.updateTracks(dt, this.speed - this.turnRate * this.track.x[0], this.speed - this.turnRate * this.track.x[1]);

    // Lamps: tail lamps blink (steady while reversing), amber lamps alternate.
    const blink = (phase) => (Math.sin(this.time * Math.PI * 2 * cfg.blinkHz + phase) > 0 ? 1 : 0.12);
    const reversing = this.speed < -0.2;
    for (const m of this.lamps.red) m.emissiveIntensity = m.userData.baseIntensity * (reversing ? 1.4 : blink(0));
    this.lamps.amber.forEach((m) => { m.emissiveIntensity = m.userData.baseIntensity * blink(Math.PI); });
  }

  /** Keeps the hull footprint inside `bounds` ({minX, maxX, minZ, maxZ}); true if it had to be moved. */
  clampToBounds() {
    const b = this.bounds;
    if (!b) return false;
    const p = this.root.position;
    // The whole (turned) hull footprint stays inside.
    const c = Math.abs(Math.cos(this.heading));
    const sn = Math.abs(Math.sin(this.heading));
    const ex = c * this.half.x + sn * this.half.z;
    const ez = sn * this.half.x + c * this.half.z;
    const x = THREE.MathUtils.clamp(p.x, b.minX + ex, b.maxX - ex);
    const z = THREE.MathUtils.clamp(p.z, b.minZ + ez, b.maxZ - ez);
    const moved = x !== p.x || z !== p.z;
    p.x = x;
    p.z = z;
    return moved;
  }

  /** Places every link round both loops; left / right offsets advance by their own speeds. */
  updateTracks(dt, leftSpeed, rightSpeed) {
    const t = this.track;
    const per = t.perimeter;
    this.trackOffset[0] = (this.trackOffset[0] + leftSpeed * dt) % per;
    this.trackOffset[1] = (this.trackOffset[1] + rightSpeed * dt) % per;
    const straight = 2 * t.zc;
    const arc = Math.PI * t.r;
    let i = 0;
    for (let side = 0; side < 2; side++) {
      const x = t.x[side];
      // Links on the ground run backward relative to the hull as it drives forward.
      const off = -this.trackOffset[side];
      for (let k = 0; k < t.count; k++) {
        let dd = ((k * per) / t.count + off) % per;
        if (dd < 0) dd += per;
        let z;
        let y;
        let ang;
        if (dd < straight) {
          z = -t.zc + dd; y = t.yc - t.r; ang = 0;
        } else if (dd < straight + arc) {
          const a = (dd - straight) / t.r;
          z = t.zc + Math.sin(a) * t.r; y = t.yc - Math.cos(a) * t.r; ang = a;
        } else if (dd < 2 * straight + arc) {
          z = t.zc - (dd - straight - arc); y = t.yc + t.r; ang = Math.PI;
        } else {
          const a = (dd - 2 * straight - arc) / t.r;
          z = -t.zc - Math.sin(a) * t.r; y = t.yc + Math.cos(a) * t.r; ang = Math.PI + a;
        }
        e.set(-ang, 0, 0);
        q.setFromEuler(e);
        m4.compose(p.set(x, y, z), q, one);
        for (const mesh of this.linkMeshes) mesh.setMatrixAt(i, m4);
        i++;
      }
    }
    for (const mesh of this.linkMeshes) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Fires if the gun is ready: kicks the barrel back. Returns the shot (muzzle + direction) or null. */
  fire(reloadMul = 1) {
    if (this.cooldown > 0) return null;
    const cfg = GameConfig.tank;
    this.reloadTime = cfg.reload * reloadMul;
    this.cooldown = this.reloadTime;
    this.recoilVel = cfg.recoilKick;
    this.root.updateMatrixWorld(true);
    const muzzle = this.muzzle.getWorldPosition(new THREE.Vector3());
    const dir = this.barrelAxis.clone().transformDirection(this.turret.matrixWorld).normalize();
    return { muzzle, dir };
  }
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
