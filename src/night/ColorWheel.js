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

const WEDGE_HEX = Object.freeze({ black: 0x1a1c20, red: 0xe0201c, yellow: 0xf2b812, green: 0x2fb82a, blue: 0x1f6fe0 });

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
 * light of the selected colour onto the wet desk.
 */
export class ColorWheel {
  constructor(gltf, scene) {
    this.ammo = {};
    this.selected = 'black';
    this.onChange = null;
    this.root = null;
    this.kick = 0;
    this.time = 0;
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
          const c = m.clone();
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
    this.onChange?.(this.selected);
  }

  /** On the desk: centre, tilt toward the camera (about x), turn (about y), scale. */
  place({ pos, tiltX, rotY, scale }) {
    if (!this.root) return;
    this.root.position.set(...pos);
    this.root.rotation.set(0, rotY, 0);
    this.dial.rotation.set(tiltX, 0, 0);
    this.root.scale.setScalar(scale);
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
      m.emissiveIntensity = on ? 0.6 + Math.sin(this.time * 6) * 0.1 + this.kick * 0.6 : has ? 0.32 : 0.04;
      if (c.wedge === 'black') m.emissiveIntensity *= 0.35;
      m.color.setHex(WEDGE_HEX[c.wedge]).multiplyScalar(has ? 1 : 0.25);
    }
    this.light.color.setHex(this.color.hex);
    this.light.intensity = 1 + this.kick * 5;
  }
}
