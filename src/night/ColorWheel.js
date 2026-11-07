import * as THREE from 'three';
import { SHELL_COLORS, shellOf } from './NightColors.js';

export { SHELL_COLORS };

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Blocked's WheelTuning (detents, friction, flick, wind-up and fountain). */
const WT = Object.freeze({
  detent: 90, freeRipple: 0.22, captureSpeedMul: 1.7, captureDamping: 34, viscous: 1.1, coulomb: 1.6,
  flickGain: 1.15, maxSpeed: 46, settle: 0.09, windGain: 0.85, windDecay: 0.35, windMin: 0.15,
  windReleaseSpeed: 40, windReverseCost: 1.8, fountainMinSpeed: 7, fountainRateMax: 34,
});

// Wedge colours sampled off the key art's dial (red 197,34,51; green; blue); the art's amber
// wedge carries Blocked's white normal shot.
// Blocked's wheel: white, red, light blue, green and a true black (no violet cast).
const WEDGE_HEX = Object.freeze({ black: 0x0a0a0c, red: 0xc52233, yellow: 0xe8ebf0, green: 0x08a241, blue: 0x2aa8ff });

/**
 * The colour wheel of Blocked's colour system (AIRepos/Blocked: GDD 4.1, WheelPhysics), for the
 * night level:
 *   - the wheel offers the white normal shell (endless) plus every colour that still has ammo
 *     (red POWER, green ACID, blue RAPID, black CRITICAL - NightColors.js), in a fixed order;
 *   - the selected colour is kept by identity: a colour that runs dry falls back to white, one
 *     that gets ammo again simply reappears in its slot;
 *   - next() / prev() step through what is on offer, select(id) picks one directly;
 *   - a shell of the selected colour costs one round of it (white costs nothing);
 *   - the needle at the top of the bezel (WheelNeedle) marks the wedge in play.
 * The 3D dial (assets/models/color_wheel.glb, the toy dial on the desk in the key art) lights the
 * selected wedge (a pulse and a pop when it changes), dims the wedges without ammo, and spills a
 * light of the selected colour onto the wet desk. The dial turns in its steel bezel: it clicks
 * round so the selected wedge sits at the top, and it can be dragged round by hand (mouse or
 * finger) - letting go selects the wedge nearest the top.
 */
export class ColorWheel {
  constructor(gltf, scene) {
    this.ammo = {};
    this.selected = 'white';
    this.onChange = null;
    this.root = null;
    this.kick = 0;
    this.time = 0;
    // Dial spin (radians about the dial's axis) and how it moves: 'settled', 'reflow' (an eased
    // turn onto a picked wedge), 'drag' (under the finger), 'coast' / 'unwind' (free).
    this.spin = 0;
    this.spinVel = 0;
    this.mode = 'settled';
    this.reflow = null;
    this.press = null;
    this.windCharge = 0;
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
          // Brake-disc steel: light machined grey that reads by its own colour, not only by
          // what it mirrors (a full mirror goes black in the dark room).
          if (/^Wheel(Steel|Disc)$/.test(c.name)) {
            c.color.setHex(c.name === 'WheelSteel' ? 0xa7abb1 : 0x7d8188);
            c.metalness = 0.55;
            c.roughness = Math.max(c.roughness, 0.32);
            c.envMapIntensity = 1.1;
          }
          if (c.name === 'WheelChrome') c.envMapIntensity = 1.3;
          const w = /^Wedge(Red|Yellow|Green|Blue|Black)$/.exec(m.name)?.[1]?.toLowerCase();
          if (w) {
            c.color.setHex(WEDGE_HEX[w]);
            c.emissive.setHex(w === 'black' ? 0x2c2c32 : WEDGE_HEX[w]);
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
    for (const c of SHELL_COLORS) if (!c.infinite) this.ammo[c.id] = startAmmo;
    this.selected = 'white';
    this.mode = 'settled';
    this.press = null;
    this.spinVel = 0;
    this.changed(true);
  }

  get offered() {
    return SHELL_COLORS.filter((c) => c.infinite || this.ammo[c.id] > 0).map((c) => c.id);
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
    if (!c || (!c.infinite && !(this.ammo[id] > 0))) return false;
    if (id === this.selected) return true;
    this.selected = id;
    this.kick = 1;
    this.changed(true);
    return true;
  }

  spend(id) {
    const c = SHELL_COLORS.find((s) => s.id === id);
    if (!c || c.infinite) return;
    this.ammo[id] = Math.max(0, (this.ammo[id] ?? 0) - 1);
    if (this.ammo[id] === 0 && this.selected === id) {
      // Out of that colour: back to white (unless the dial is spinning free - it settles itself).
      this.selected = 'white';
      this.changed();
    } else this.onChange?.(this.selected);
  }

  add(id, n) {
    this.ammo[id] = (this.ammo[id] ?? 0) + n;
    this.onChange?.(this.selected);
  }

  /**
   * The selection changed: turn the dial onto it - at once when `force` (a key, a tap, a chip),
   * otherwise only while it rests (a spinning or dragged dial is left to settle by itself).
   */
  changed(force = false) {
    if (!this.spinHeld && (force ? this.mode !== 'drag' : this.mode === 'settled' || this.mode === 'reflow')) this.aimSpin();
    this.onChange?.(this.selected);
  }

  /**
   * Brings the selected wedge under the needle (Blocked's WheelPhysics.SelectIndex): a short
   * eased turn (`reflow`) by the shortest way round.
   */
  aimSpin() {
    const a = this.wedgeAngle?.[shellOf(this.selected).wedge];
    if (a === undefined) return;
    let t = -a;
    while (t - this.spin > Math.PI) t -= Math.PI * 2;
    while (t - this.spin < -Math.PI) t += Math.PI * 2;
    if (Math.abs(t - this.spin) < 1e-4) return;
    this.reflow = { from: this.spin, to: t, t: 0 };
    this.spinVel = 0;
    this.mode = 'reflow';
  }

  /** Holds the dial at a fixed turn (the key-art moment: red at the top), or releases it. */
  holdSpin(angle) {
    this.spinHeld = angle !== null;
    if (this.spinHeld) {
      // (A still: no pop of the selection light on the hub.)
      this.kick = 0;
      this.spin = angle;
      this.spinVel = 0;
      this.mode = 'settled';
      this.applySpin();
    } else this.aimSpin();
  }

  /** Dial-plane angle (atan2(x, z) in the dial's frame) of a world point, for dragging. */
  angleAt(world) {
    const p = this.dial.worldToLocal(world.clone());
    return Math.atan2(p.x, p.z);
  }

  /** Distance of a world point from the dial's axis, as a share of the bezel's radius. */
  radiusAt(world) {
    const p = this.dial.worldToLocal(world.clone());
    return Math.hypot(p.x, p.z) / (this.localRadius || 1);
  }

  /** The dial plane in world space (for a drag ray). */
  plane(out = new THREE.Plane()) {
    this.dial.updateMatrixWorld(true);
    const n = new THREE.Vector3(0, 1, 0).transformDirection(this.dial.matrixWorld);
    return out.setFromNormalAndCoplanarPoint(n, this.dial.getWorldPosition(new THREE.Vector3()));
  }

  // ---- Blocked's wheel input (WheelPhysics / ColorWheel.UpdateFlat) ---------------------------
  //   drag the rim       the dial follows the finger; dragging on the same way WINDS it up
  //   let go (wound)     it unwinds the other way, fast - the gun sprays while it spins (fountain)
  //   let go (flick)     it coasts with the flick's speed, clicking over the detents, and settles
  //   tap the hub        next colour        tap a wedge     that colour, at once
  //   scroll / SPACE     one wedge on

  /** A press on the dial at plane angle `a`; `hub` when it landed in the middle. */
  beginPress(a, hub) {
    this.press = { hub, last: a, samples: [], wind: 0, windDir: 0 };
    if (hub) return;
    this.mode = 'drag';
    this.spinVel = 0;
    this.reflow = null;
  }

  /** The finger moved to plane angle `a` (dt since the last move). */
  movePress(a, dt) {
    const P = this.press;
    if (!P || P.hub) return;
    let d = a - P.last;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    P.last = a;
    this.spin += d;
    P.samples.push([d, Math.max(dt, 1e-4)]);
    if (P.samples.length > 10) P.samples.shift();
    const sd = Math.sign(d);
    if (Math.abs(d) > 1e-5) {
      if (!P.windDir) P.windDir = sd;
      if (sd === P.windDir) P.wind = Math.min(1, P.wind + Math.abs(d) * WT.windGain);
      else {
        P.wind -= Math.abs(d) * WT.windGain * WT.windReverseCost;
        if (P.wind <= 0) {
          P.wind = 0;
          P.windDir = sd;
        }
      }
    }
    P.wind = Math.max(0, P.wind - WT.windDecay * dt * 0.3);
    this.windCharge = P.wind;
    this.applySpin();
  }

  /**
   * The finger lifted. `tap`: a short, still press - on the hub the next colour, on a wedge that
   * wedge (plane angle `a`). Otherwise a flick or a wound-up release.
   */
  endPress(tap, a) {
    const P = this.press;
    this.press = null;
    this.windCharge = 0;
    if (!P) return;
    if (P.hub) {
      this.mode = 'settled';
      this.next();
      return;
    }
    if (tap) {
      // The wedge under the finger: plane angle a = wedge angle + spin.
      let best = null;
      let bestD = Infinity;
      for (const c of SHELL_COLORS) {
        const w = this.wedgeAngle?.[c.wedge];
        if (w === undefined) continue;
        const d = Math.abs(wrapPi(a - (w + this.spin)));
        if (d < bestD) {
          bestD = d;
          best = c.id;
        }
      }
      this.mode = 'settled';
      if (!best || !this.select(best)) this.aimSpin();
      return;
    }
    let sum = 0;
    let sumDt = 0;
    for (const [d, dt] of P.samples) {
      sum += d;
      sumDt += dt;
    }
    const flick = sumDt > 1e-4 ? (sum / sumDt) * WT.flickGain : 0;
    if (P.wind >= WT.windMin && P.windDir) {
      const e = P.wind * P.wind * (3 - 2 * P.wind);
      this.spinVel = -P.windDir * WT.windReleaseSpeed * e;
      this.mode = 'unwind';
    } else {
      this.spinVel = THREE.MathUtils.clamp(flick, -WT.maxSpeed, WT.maxSpeed);
      this.mode = 'coast';
    }
    this.peak = Math.abs(this.spinVel);
  }

  /** True while a wound-up release spins the dial fast (Blocked's fountain fire). */
  get fountaining() {
    return this.mode === 'unwind' && Math.abs(this.spinVel) >= WT.fountainMinSpeed;
  }

  /** How fast the dial turns, 0..1. */
  get speedNorm() {
    return Math.min(1, Math.abs(this.spinVel) / WT.maxSpeed);
  }

  /**
   * The free dial (coasting / unwinding): detents pull it onto a wedge (strongly once it is
   * slow), viscous + dry friction, then it settles on the wedge under the needle - or, if that
   * colour is out of ammo, turns on to the nearest one that has some.
   */
  updateFree(dt) {
    const n = SHELL_COLORS.length;
    const seg = (Math.PI * 2) / n;
    const ref = this.wedgeAngle?.[SHELL_COLORS[0].wedge] ?? 0;
    const escape = 2 * Math.sqrt(WT.detent / n);
    const capture = Math.max(0.5, escape * WT.captureSpeedMul);
    const steps = THREE.MathUtils.clamp(Math.ceil((Math.abs(this.spinVel) * dt) / (seg * 0.3)), 1, 16);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      let cap = THREE.MathUtils.clamp(1 - Math.abs(this.spinVel) / capture, 0, 1);
      cap *= cap;
      const weight = WT.freeRipple + (1 - WT.freeRipple) * cap;
      this.spinVel += -WT.detent * Math.sin(n * (this.spin + ref)) * weight * h;
      this.spinVel *= Math.exp(-(WT.viscous + WT.captureDamping * cap) * h);
      const cou = WT.coulomb * h;
      this.spinVel = Math.abs(this.spinVel) <= cou ? 0 : this.spinVel - Math.sign(this.spinVel) * cou;
      this.spinVel = THREE.MathUtils.clamp(this.spinVel, -WT.maxSpeed, WT.maxSpeed);
      this.spin += this.spinVel * h;
    }
    if (this.mode === 'unwind' && Math.abs(this.spinVel) < WT.fountainMinSpeed * 0.5) this.mode = 'coast';
    if (Math.abs(this.spinVel) < WT.settle) {
      const target = Math.round((this.spin + ref) / seg) * seg - ref;
      this.spin = THREE.MathUtils.lerp(this.spin, target, 1 - Math.exp(-28 * dt));
      if (Math.abs(target - this.spin) < 0.0025) {
        this.spin = target;
        this.spinVel = 0;
        this.mode = 'settled';
        this.kick = Math.min(1, (this.peak ?? 0) / (WT.maxSpeed * 0.5));
        // The wedge under the needle.
        let id = null;
        for (const c of SHELL_COLORS) {
          const w = this.wedgeAngle?.[c.wedge];
          if (w !== undefined && Math.abs(wrapPi(w + this.spin)) < seg / 2) id = c.id;
        }
        if (id && this.select(id)) this.changed();
        else this.settleOnOffered();
      }
    }
  }

  /** Settled on an empty wedge: on to the nearest wedge that has ammo (white always does). */
  settleOnOffered() {
    let best = 'white';
    let bestD = Infinity;
    for (const id of this.offered) {
      const w = this.wedgeAngle?.[shellOf(id).wedge];
      if (w === undefined) continue;
      const d = Math.abs(wrapPi(w + this.spin));
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    this.selected = best;
    this.aimSpin();
    this.onChange?.(this.selected);
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
      this.localRadius = r;
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
      const has = c.infinite || this.ammo[c.id] > 0;
      const on = this.selected === c.id;
      // Lit like the key art (the wedges glow), the selected one pulsing brighter.
      m.emissiveIntensity = on ? 0.4 + Math.sin(this.time * 6) * 0.08 + this.kick * 0.6 : has ? 0.24 : 0.04;
      if (c.wedge === 'black') m.emissiveIntensity *= 0.5;
      if (c.wedge === 'yellow') m.emissiveIntensity *= 0.45;
      m.color.setHex(WEDGE_HEX[c.wedge]).multiplyScalar(has ? 1 : 0.25);
    }
    // The dial: eased turns to a picked wedge, free spinning after a flick or a wound release.
    if (!this.spinHeld) {
      if (this.mode === 'reflow' && this.reflow) {
        const R = this.reflow;
        R.t = Math.min(1, R.t + dt / 0.18);
        const u = R.t * R.t * (3 - 2 * R.t);
        this.spin = R.from + (R.to - R.from) * u;
        if (R.t >= 1) this.mode = 'settled';
      } else if (this.mode === 'coast' || this.mode === 'unwind') this.updateFree(Math.min(dt, 0.05));
    }
    this.applySpin();
    this.light.color.setHex(this.color.hex);
    this.light.intensity = 0.12 + this.kick * 2;
  }
}
