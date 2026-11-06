import * as THREE from 'three';
import { Palette } from '../config/Palette.js';

/**
 * Shell colours in wheel order. `block` is the block colour key a shell beats (Palette.blocks);
 * BLACK (the black wedge) is the plain shell: it beats nothing in particular but never runs out.
 * `wedge` is the Blender wedge (build_color_wheel.py) that stands for it.
 */
export const SHELL_COLORS = Object.freeze([
  Object.freeze({ id: 'black', block: null, hex: 0xf2f4fa, chip: 0x2a2d33, name: 'PLAIN', wedge: 'black' }),
  Object.freeze({ id: 'red', block: 'red', hex: Palette.blocks.red, chip: Palette.blocks.red, name: 'RED', wedge: 'red' }),
  Object.freeze({ id: 'yellow', block: 'yellow', hex: Palette.blocks.yellow, chip: Palette.blocks.yellow, name: 'YELLOW', wedge: 'yellow' }),
  Object.freeze({ id: 'green', block: 'green', hex: Palette.blocks.green, chip: Palette.blocks.green, name: 'GREEN', wedge: 'green' }),
  Object.freeze({ id: 'teal', block: 'teal', hex: Palette.blocks.teal, chip: 0x1f6fe0, name: 'BLUE', wedge: 'blue' }),
]);

const shellOf = (id) => SHELL_COLORS.find((c) => c.id === id);

// Wedge colours sampled off the key art's dial (red 197,34,51; amber 226,151,48; ...).
const WEDGE_HEX = Object.freeze({ black: 0x19202f, red: 0xc52233, yellow: 0xe29a30, green: 0x08a241, blue: 0x027af8 });

/**
 * The colour wheel of Blocked's colour system (AIRepos/Blocked: GDD 4.1, WheelPhysics), for the
 * night level:
 *   - the wheel offers the plain shell (black wedge, endless) plus every colour that still has
 *     ammo, in a fixed order;
 *   - the selected colour is kept by identity: a colour that runs dry falls back to plain, one
 *     that gets ammo again simply reappears in its slot;
 *   - next() / prev() step through what is on offer, select(id) picks one directly;
 *   - a shell of the selected colour costs one round of it (plain costs nothing).
 * The 3D dial (assets/models/color_wheel.glb, the toy dial on the desk in the key art) lights the
 * selected wedge (a pulse and a pop when it changes), dims the wedges without ammo, and spills a
 * light of the selected colour onto the wet desk. The dial turns in its steel bezel: it clicks
 * round so the selected wedge sits at the top, and it can be dragged round by hand (mouse or
 * finger) - letting go selects the wedge nearest the top.
 */
export class ColorWheel {
  constructor(gltf, scene) {
    this.ammo = {};
    this.selected = 'black';
    this.onChange = null;
    this.root = null;
    this.kick = 0;
    this.time = 0;
    // Dial spin (radians about the dial's axis): eased toward `spinTarget`, which brings the
    // selected wedge to the top; a drag holds it under the finger (`dragging`).
    this.spin = 0;
    this.spinVel = 0;
    this.spinTarget = 0;
    this.dragging = false;
    this.spinHeld = false;
    const src = gltf?.scene.getObjectByName('ColorWheel');
    if (src) {
      this.root = new THREE.Group();
      this.dial = src.clone(true);
      this.root.add(this.dial);
      this.wedgeMats = {};
      this.dial.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        const list = Array.isArray(o.material) ? o.material : [o.material];
        const own = list.map((m) => {
          // Rain drops on the dial: only their glints show (a black gloss added on top - no white
          // beads, and no glTF transmission pass).
          if (m.name === 'WaterDrop') return new THREE.MeshStandardMaterial({ name: 'WaterDrop', color: 0x000000, roughness: 0.02, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, envMapIntensity: 1.6 });
          const c = m.clone();
          // The bezel is polished steel: it reads by what it mirrors (the night room is dim).
          if (/^Wheel(Steel|Chrome)/.test(c.name)) c.envMapIntensity = 2.6;
          const w = /^Wedge(Red|Yellow|Green|Blue|Black)$/.exec(m.name)?.[1]?.toLowerCase();
          if (w) {
            c.color.setHex(WEDGE_HEX[w]);
            c.emissive.setHex(w === 'black' ? 0x8a93a6 : WEDGE_HEX[w]);
            c.roughness = 0.1;
            this.wedgeMats[w] = c;
          }
          return c;
        });
        o.material = Array.isArray(o.material) ? own : own[0];
      });
      // The turning part of the dial (wedges + hub) and where each wedge sits on it.
      this.spinners = ['WheelWedges', 'WheelHub'].map((n) => this.dial.getObjectByName(n)).filter(Boolean);
      let wedges = this.dial.getObjectByName('WheelWedges')?.userData.wedges;
      try {
        if (typeof wedges === 'string') wedges = JSON.parse(wedges);
      } catch {
        wedges = null;
      }
      this.wedgeAngle = {};
      for (const w of Array.isArray(wedges) ? wedges : []) this.wedgeAngle[w.color] = w.angle;
      this.light = new THREE.PointLight(0xffffff, 0, 8, 1.7);
      this.light.position.set(0, 1.2, 0);
      this.dial.add(this.light);
      scene.add(this.root);
    }
  }

  reset(startAmmo) {
    for (const c of SHELL_COLORS) if (c.block) this.ammo[c.id] = startAmmo;
    this.selected = 'black';
    this.changed();
  }

  get offered() {
    return SHELL_COLORS.filter((c) => !c.block || this.ammo[c.id] > 0).map((c) => c.id);
  }

  get color() {
    return SHELL_COLORS.find((c) => c.id === this.selected);
  }

  next(dir = 1) {
    const list = this.offered;
    const i = list.indexOf(this.selected);
    this.select(list[(i + dir + list.length) % list.length]);
  }

  prev() {
    this.next(-1);
  }

  select(id) {
    const c = SHELL_COLORS.find((s) => s.id === id);
    if (!c || (c.block && !(this.ammo[id] > 0))) return false;
    if (id === this.selected) return true;
    this.selected = id;
    this.kick = 1;
    this.changed();
    return true;
  }

  spend(id) {
    const c = SHELL_COLORS.find((s) => s.id === id);
    if (!c?.block) return;
    this.ammo[id] = Math.max(0, (this.ammo[id] ?? 0) - 1);
    if (this.ammo[id] === 0 && this.selected === id) this.selected = 'black';
    this.changed();
  }

  add(id, n) {
    this.ammo[id] = (this.ammo[id] ?? 0) + n;
    this.changed();
  }

  changed() {
    if (!this.dragging && !this.spinHeld) this.aimSpin();
    this.onChange?.(this.selected);
  }

  /** Spin target that brings the selected wedge to the top, by the shortest way round. */
  aimSpin() {
    const a = this.wedgeAngle?.[shellOf(this.selected).wedge];
    if (a === undefined) return;
    let t = -a;
    while (t - this.spin > Math.PI) t -= Math.PI * 2;
    while (t - this.spin < -Math.PI) t += Math.PI * 2;
    this.spinTarget = t;
  }

  /** Holds the dial at a fixed turn (the key-art moment: red at the top), or releases it. */
  holdSpin(angle) {
    this.spinHeld = angle !== null;
    if (this.spinHeld) {
      // (A still: no pop of the selection light on the hub.)
      this.kick = 0;
      this.spin = this.spinTarget = angle;
      this.spinVel = 0;
      this.applySpin();
    } else this.aimSpin();
  }

  /** Dial-plane angle (atan2(x, z) in the dial's frame) of a world point, for dragging. */
  angleAt(world) {
    const p = this.dial.worldToLocal(world.clone());
    return Math.atan2(p.x, p.z);
  }

  /** The dial plane in world space (for a drag ray). */
  plane(out = new THREE.Plane()) {
    this.dial.updateMatrixWorld(true);
    const n = new THREE.Vector3(0, 1, 0).transformDirection(this.dial.matrixWorld);
    return out.setFromNormalAndCoplanarPoint(n, this.dial.getWorldPosition(new THREE.Vector3()));
  }

  beginDrag() {
    this.dragging = true;
    this.dragStart = this.spin;
  }

  /** Turns the dial `delta` radians from where the drag began (it follows the finger). */
  dragTo(delta) {
    this.spin = this.spinTarget = this.dragStart + delta;
    this.spinVel = 0;
  }

  /** Lets go: the wedge nearest the top (among those on offer) is selected and clicks into place. */
  endDrag() {
    this.dragging = false;
    let best = null;
    let bestD = Infinity;
    for (const id of this.offered) {
      const a = this.wedgeAngle?.[shellOf(id).wedge];
      if (a === undefined) continue;
      let d = (a + this.spin) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < bestD) {
        bestD = Math.abs(d);
        best = id;
      }
    }
    if (best && best !== this.selected) {
      this.selected = best;
      this.kick = 1;
    }
    this.changed();
  }

  applySpin() {
    for (const o of this.spinners ?? []) o.rotation.y = this.spin;
  }

  /** On the desk: centre, tilt toward the camera (about x), turn (about y), and either a scale or
   * the bezel's outer `radius` in world units. */
  place({ pos, tiltX, rotY, scale, radius }) {
    if (!this.root) return;
    this.root.position.set(...pos);
    this.root.rotation.set(0, rotY, 0);
    this.dial.rotation.set(tiltX, 0, 0);
    if (radius) {
      const body = this.dial.getObjectByName('WheelBody') ?? this.dial;
      const b = new THREE.Box3();
      body.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.computeBoundingBox();
        b.union(o.geometry.boundingBox);
      });
      const r = Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z);
      scale = radius / (r > 0 ? r : 1);
    }
    this.root.scale.setScalar(scale ?? 1);
  }

  update(dt) {
    this.time += dt;
    if (!this.root) return;
    this.kick = Math.max(0, this.kick - dt * 3);
    for (const c of SHELL_COLORS) {
      const m = this.wedgeMats?.[c.wedge];
      if (!m) continue;
      const has = !c.block || this.ammo[c.id] > 0;
      const on = this.selected === c.id;
      // Lit like the key art (the wedges glow), the selected one pulsing brighter.
      m.emissiveIntensity = on ? 0.4 + Math.sin(this.time * 6) * 0.08 + this.kick * 0.6 : has ? 0.24 : 0.04;
      if (c.wedge === 'black') m.emissiveIntensity *= 0.35;
      m.color.setHex(WEDGE_HEX[c.wedge]).multiplyScalar(has ? 1 : 0.25);
    }
    // The dial clicks round to the selected wedge (a spring with a little overshoot).
    if (!this.dragging && !this.spinHeld) {
      const k = 90;
      this.spinVel += ((this.spinTarget - this.spin) * k - this.spinVel * 2 * Math.sqrt(k) * 0.72) * Math.min(dt, 0.05);
      this.spin += this.spinVel * Math.min(dt, 0.05);
    }
    this.applySpin();
    this.light.color.setHex(this.color.hex);
    this.light.intensity = 0.35 + this.kick * 4;
  }
}
