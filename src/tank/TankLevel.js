import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { EffectsManager } from '../fx/EffectsManager.js';
import { PlayerTank } from './PlayerTank.js';
import { createCanvas, canvasToTexture } from '../textures/CanvasUtils.js';
import { fxRandom as rnd } from '../util/Random.js';

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const GRAVITY = 18;

/**
 * Tank level (menu card "IRON TRACKS"): for now an empty test range with only the player's tank.
 *   W/S (arrows)  drive forward / back      A/D  turn the hull
 *   mouse         aims the turret            click / SPACE  fire (barrel recoils, shell lands where aimed)
 *   ESC           pause menu (back to the main menu from there)
 * It has its own scene and camera; the game's render pipeline is pointed at them while it runs.
 */
export class TankLevel {
  /**
   * @param {{ gltf:any, textures:any, renderer:THREE.WebGLRenderer, input:any, quality:any }} deps
   */
  constructor({ gltf, textures, renderer, input, quality }) {
    this.input = input;
    this.element = renderer.domElement;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fb6d8);
    this.scene.fog = new THREE.Fog(0x8fb6d8, 70, 150);
    const cfg = GameConfig.tank.camera;
    this.camera = new THREE.PerspectiveCamera(cfg.fov, 16 / 9, 0.5, 400);
    this.camera.userData.baseFov = cfg.fov;

    // Light: soft sky + a warm sun with shadows that follow the tank.
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x5a6448, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    const sm = quality?.shadowMapSize ?? 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 90;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(buildGround());

    const debris = new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.9 });
    this.effects = new EffectsManager(this.scene, textures, debris, () => 0, { flashLights: 2 });
    this.tank = new PlayerTank(gltf);
    this.scene.add(this.tank.root);
    this.shells = [];
    this.shellGeometry = new THREE.CapsuleGeometry(0.13, 0.5, 4, 8).rotateX(Math.PI / 2);
    this.shellMaterial = new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffa040, emissiveIntensity: 2.2, roughness: 0.3 });
    this.aim = new THREE.Vector3(0, 0, 12);
    this.pointer = null;
    this.shake = 0;
    this.camPos = new THREE.Vector3();
    this.active = false;
    this.dustTimer = 0;
    this.buildHud();

    this.onPointerMove = (e) => {
      const r = this.element.getBoundingClientRect();
      this.pointer = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
    };
    this.onPointerDown = (e) => {
      if (!this.active || this.paused) return;
      this.onPointerMove(e);
      if (e.button === 0 || e.pointerType !== 'mouse') this.fireQueued = true;
    };
  }

  buildHud() {
    const el = document.createElement('div');
    el.className = 'tank-hud';
    el.innerHTML = `<div class="th-title">IRON TRACKS <small>TEST RANGE · PROTOTYPE</small></div>
      <div class="th-keys"><b>W S</b> drive · <b>A D</b> turn · <b>MOUSE</b> aim · <b>CLICK / SPACE</b> fire · <b>ESC</b> menu</div>
      <div class="th-reload"><i></i></div>`;
    Object.assign(el.style, { display: 'none' });
    this.hud = el;
    this.reloadBar = el.querySelector('.th-reload i');
    (this.element.parentElement ?? document.body).appendChild(el);
  }

  /** Enters the level: tank back at the start, listeners on, HUD shown. */
  start() {
    this.active = true;
    this.paused = false;
    const t = this.tank;
    t.root.position.set(0, 0, 0);
    t.heading = 0;
    t.speed = 0;
    t.turnRate = 0;
    t.turretYaw = 0;
    t.recoil = 0;
    t.recoilVel = 0;
    for (const s of this.shells) s.mesh.removeFromParent();
    this.shells = [];
    this.aim.set(0, 0, 14);
    this.pointer = null;
    this.updateCamera(0, true);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.hud.style.display = '';
  }

  stop() {
    this.active = false;
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.hud.style.display = 'none';
  }

  update(dt) {
    const keys = this.input.keys;
    const k = (...codes) => codes.some((c) => keys.has(c));
    const drive = {
      throttle: (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0),
      turn: (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0),
    };
    // Aim: the ground point under the pointer (keeps the last one when the pointer is still).
    if (this.pointer) {
      ndc.set(this.pointer.x, this.pointer.y);
      ray.setFromCamera(ndc, this.camera);
      if (ray.ray.intersectPlane(ground, v1)) this.aim.copy(v1);
    }
    const t = this.tank;
    t.update(dt, drive, this.aim);
    if (this.fireQueued || keys.has('Space')) this.fire();
    this.fireQueued = false;
    this.updateShells(dt);
    this.updateDust(dt);
    this.effects.update(dt);
    this.updateCamera(dt);
    this.reloadBar.style.width = `${Math.round((1 - t.cooldown / GameConfig.tank.reload) * 100)}%`;
  }

  /** Shot: barrel kick, muzzle flash + smoke ring, a shell lobbed to land on the aim point. */
  fire() {
    const shot = this.tank.fire();
    if (!shot) return;
    const cfg = GameConfig.tank;
    const { muzzle, dir } = shot;
    this.effects.muzzleFlash(muzzle, dir, [4, 2.6, 0.9, 1], 1.6);
    this.effects.flash(muzzle, 0xffb060, 70, 0.25, 12);
    for (let i = 0; i < 10; i++) {
      this.effects.smoke.emit({
        x: muzzle.x + dir.x * 0.4, y: muzzle.y + dir.y * 0.4, z: muzzle.z + dir.z * 0.4,
        vx: dir.x * rnd.range(2, 6) + rnd.spread(1.6), vy: dir.y * rnd.range(2, 6) + rnd.range(0, 1), vz: dir.z * rnd.range(2, 6) + rnd.spread(1.6), drag: 2.4,
        life: rnd.range(0.6, 1.2), size0: rnd.range(0.5, 0.8), size1: rnd.range(1.8, 2.6),
        color0: [0.7, 0.68, 0.64, 0.8], color1: [0.85, 0.85, 0.86, 0], rotVel: rnd.spread(1),
      });
    }
    this.shake = Math.max(this.shake, 0.35);
    // Landing point: the aim point, kept within range in the gun's direction.
    const yaw = this.tank.gunYaw;
    const p = this.tank.position;
    let dist = Math.hypot(this.aim.x - p.x, this.aim.z - p.z);
    dist = THREE.MathUtils.clamp(dist, 6, cfg.shellRange);
    const target = v2.set(p.x + Math.sin(yaw) * dist, 0, p.z + Math.cos(yaw) * dist);
    const hDist = Math.hypot(target.x - muzzle.x, target.z - muzzle.z);
    const T = Math.max(0.2, hDist / cfg.shellSpeed);
    const vel = new THREE.Vector3((target.x - muzzle.x) / T, (target.y - muzzle.y + 0.5 * GRAVITY * T * T) / T, (target.z - muzzle.z) / T);
    const mesh = new THREE.Mesh(this.shellGeometry, this.shellMaterial);
    mesh.position.copy(muzzle);
    this.scene.add(mesh);
    this.shells.push({ mesh, vel });
  }

  updateShells(dt) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.vel.y -= GRAVITY * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.lookAt(v1.copy(s.mesh.position).add(s.vel));
      this.effects.fire.emit({ x: s.mesh.position.x, y: s.mesh.position.y, z: s.mesh.position.z, life: 0.12, size0: 0.45, size1: 0.1, color0: [3, 1.8, 0.6, 1], color1: [1, 0.4, 0.1, 0] });
      if (s.mesh.position.y <= 0.05) {
        s.mesh.position.y = 0.1;
        this.effects.explosion(s.mesh.position, 1.1, 0x7a6a52, 10);
        s.mesh.removeFromParent();
        this.shells.splice(i, 1);
        const d = s.mesh.position.distanceTo(this.tank.position);
        this.shake = Math.max(this.shake, THREE.MathUtils.clamp(0.5 - d * 0.01, 0.1, 0.5));
      }
    }
  }

  /** Dust kicked up behind the tracks while driving / turning. */
  updateDust(dt) {
    const t = this.tank;
    const moving = Math.abs(t.speed) + Math.abs(t.turnRate) * 1.5;
    this.dustTimer -= dt * moving;
    if (this.dustTimer > 0) return;
    this.dustTimer = 0.35;
    for (const x of t.track.x) {
      v1.set(x, 0.2, -2.3 * Math.sign(t.speed || 1)).applyMatrix4(t.root.matrixWorld);
      this.effects.smoke.emit({
        x: v1.x + rnd.spread(0.3), y: 0.25, z: v1.z + rnd.spread(0.3), vx: rnd.spread(0.6), vy: rnd.range(0.4, 1), vz: rnd.spread(0.6), drag: 1.5,
        life: rnd.range(0.8, 1.4), size0: 0.5, size1: rnd.range(1.6, 2.4), color0: [0.62, 0.56, 0.45, 0.55], color1: [0.7, 0.66, 0.58, 0],
      });
    }
  }

  /** Fixed-angle follow camera behind the start heading, with a little shake on shots. */
  updateCamera(dt, snap = false) {
    const cfg = GameConfig.tank.camera;
    const p = this.tank.position;
    v1.set(p.x, cfg.height, p.z - cfg.back);
    if (snap) this.camPos.copy(v1);
    else this.camPos.lerp(v1, 1 - Math.exp(-4 * dt));
    this.camera.position.copy(this.camPos);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    if (this.shake > 0) this.camera.position.add(v2.set(rnd.spread(1), rnd.spread(1), rnd.spread(1)).multiplyScalar(this.shake * 0.35));
    this.camera.lookAt(this.camPos.x, 0, this.camPos.z + cfg.back + 2.5);
    this.sun.position.set(p.x - 14, 30, p.z - 10);
    this.sun.target.position.set(p.x, 0, p.z);
  }
}

/** Empty test range: a big field of worn concrete pads with seams and faint lane markings. */
export function buildGround() {
  const S = 512;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8f9a7e';
  ctx.fillRect(0, 0, S, S);
  const r = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 2600; i++) {
    const g = r(-18, 18);
    ctx.fillStyle = `rgba(${120 + g},${130 + g},${105 + g},${r(0.15, 0.4)})`;
    const s = r(2, 14);
    ctx.fillRect(r(0, S), r(0, S), s, s);
  }
  ctx.strokeStyle = 'rgba(55,60,48,0.55)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * S / 4, 0); ctx.lineTo(i * S / 4, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * S / 4); ctx.lineTo(S, i * S / 4); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(240,210,90,0.35)';
  ctx.fillRect(S / 2 - 3, 20, 6, S / 4 - 40);
  ctx.fillRect(S / 2 - 3, S / 2 + 20, 6, S / 4 - 40);
  const tex = canvasToTexture(canvas, { srgb: true });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(25, 25);
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}
