import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GameConfig } from '../config/GameConfig.js';
import { Palette } from '../config/Palette.js';
import { BlockField } from './BlockField.js';
import { fxRandom as rnd } from '../util/Random.js';

/**
 * Cargo logistics on the board:
 *
 *  - Engineer: a soldier (peaked cap, uniform, boots) on a yellow forklift (Blender model,
 *    assets/models/forklift.glb). He drives around the yard (board cells left of the railway),
 *    picks up the red / green / blue cubes shot off the train one by one and lines them up in the
 *    leftmost column (the dock), where they turn into ribboned gift packages (two high).
 *  - Gift packages can't be shot (bullets pass through) and wait for pick-up.
 *  - CH-47F Chinook (assets/models/chinook.glb) arrives from the left every 2 minutes, flies down
 *    the dock column and winches up the packages in order, then leaves. Each delivered package
 *    counts toward the mission: 100 red + 100 green + 100 blue.
 */
const PKG = 1.25;
const FORK_SCALE = 0.8;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

/** Colour key on the board -> mission bucket. */
export const MISSION_KEY = Object.freeze({ red: 'red', green: 'green', teal: 'blue' });

/** Yaw that turns a -Z-forward model to face (dx, dz). */
const yawFor = (dx, dz) => Math.atan2(-dx, -dz);

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// -------------------------------------------------------------------------------------------------
// Gift packages
// -------------------------------------------------------------------------------------------------
class GiftFactory {
  constructor() {
    this.box = new RoundedBoxGeometry(PKG, PKG, PKG, 3, 0.08);
    const band = 0.2;
    this.bandA = new THREE.BoxGeometry(band, PKG + 0.03, PKG + 0.03);
    this.bandB = new THREE.BoxGeometry(PKG + 0.03, PKG + 0.03, band);
    this.loop = new THREE.TorusGeometry(0.2, 0.065, 8, 16);
    this.knot = new THREE.SphereGeometry(0.1, 10, 8);
    this.ribbon = new THREE.MeshStandardMaterial({ color: 0xffd34a, roughness: 0.3, metalness: 0.55, emissive: 0x3a2600, emissiveIntensity: 0.6 });
    this.materials = {};
  }

  material(color) {
    this.materials[color] ??= new THREE.MeshStandardMaterial({ color: Palette.blocks[color], roughness: 0.42, metalness: 0.05, emissive: Palette.blocks[color], emissiveIntensity: 0.08 });
    return this.materials[color];
  }

  build(color) {
    const g = new THREE.Group();
    const add = (geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    add(this.box, this.material(color));
    add(this.bandA, this.ribbon);
    add(this.bandB, this.ribbon);
    // Bow: two tilted loops and a knot on top.
    for (const s of [-1, 1]) {
      const loop = add(this.loop, this.ribbon, s * 0.17, PKG / 2 + 0.14, 0);
      loop.rotation.set(0, Math.PI / 2, s * 0.5);
    }
    add(this.knot, this.ribbon, 0, PKG / 2 + 0.06, 0);
    return g;
  }
}

// -------------------------------------------------------------------------------------------------
// Engineer on the forklift
// -------------------------------------------------------------------------------------------------
class Engineer {
  constructor(gltf, blocks, materials) {
    this.blocks = blocks;
    this.root = new THREE.Group();
    const model = gltf?.scene ?? fallbackForklift();
    model.scale.setScalar(FORK_SCALE);
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.root.add(model);
    this.forks = model.getObjectByName('Forks') ?? new THREE.Group();
    this.forksBase = this.forks.position.y;
    this.beacon = new THREE.PointLight(0xff8a1c, 0, 3, 2);
    this.beacon.position.set(0.3, 2.2, 0.6);
    this.root.add(this.beacon);
    // Crate carried on the forks (shown at a slightly smaller size than a board block).
    this.crate = new THREE.Mesh(new RoundedBoxGeometry(1, 1, 1, 3, 0.06), materials.block('red'));
    this.crate.scale.setScalar(1.15 / FORK_SCALE);
    this.crate.position.set(0, 0.32 + 0.575 / FORK_SCALE, -1.38);
    this.crate.castShadow = true;
    this.crate.visible = false;
    this.forks.add(this.crate);
    this.materials = materials;

    const start = blocks.cellCenter(2, 6);
    this.cell = [2, 6];
    this.root.position.set(start.x, 0, start.z);
    this.yaw = 0;
    this.state = 'idle';
    this.path = [];
    this.carry = null;
    this.think = 0;
    this.action = null;
    this.lift = 0; // forks height (world units above rest)
    this.time = 0;
  }

  get carrying() {
    return this.carry !== null;
  }

  /** Cells the forklift occupies or is about to (no block may fall there). */
  reserved(c, r) {
    if (!this.active) return false;
    if (this.cell[0] === c && this.cell[1] === r) return true;
    const next = this.path[0];
    return !!next && next[0] === c && next[1] === r;
  }

  walkable(c, r, dock) {
    const B = this.blocks;
    if (c < 0 || r < 0 || r >= B.rows || c >= B.cols) return false;
    if (!B.isYardCell(c) && !B.isDockCell(c)) return false;
    if (B.isDockCell(c) && dock.hasAt(c, r)) return false;
    const l = B.cells.get(B.key(c, r));
    return !(l && l.alive);
  }

  /** Flood fill: every free cell (block-field key) the forklift can drive to from where it is. */
  reachable(dock) {
    const B = this.blocks;
    const seen = new Set([B.key(this.cell[0], this.cell[1])]);
    const queue = [this.cell];
    while (queue.length) {
      const [c, r] = queue.shift();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = [c + dc, r + dr];
        const k = B.key(n[0], n[1]);
        if (seen.has(k) || !this.walkable(n[0], n[1], dock)) continue;
        seen.add(k);
        queue.push(n);
      }
    }
    return seen;
  }

  /**
   * BFS over free cells to the nearest cell in `goals` (Map key -> payload).
   * @returns {{path: number[][], goal: any}|null}
   */
  bfs(goals, dock) {
    const B = this.blocks;
    const start = this.cell;
    const k = (c, r) => c * 1000 + r;
    const prev = new Map([[k(start[0], start[1]), null]]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      const ck = k(cur[0], cur[1]);
      if (goals.has(ck)) {
        const path = [];
        for (let n = cur; n && !(n[0] === start[0] && n[1] === start[1]); n = prev.get(k(n[0], n[1]))) path.unshift(n);
        return { path, goal: goals.get(ck) };
      }
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = [cur[0] + dc, cur[1] + dr];
        const nk = k(n[0], n[1]);
        if (prev.has(nk) || !this.walkable(n[0], n[1], dock)) continue;
        prev.set(nk, cur);
        queue.push(n);
      }
    }
    return null;
  }

  /** Next job: deliver what we carry, or fetch the nearest cargo cube. */
  plan(dock) {
    const B = this.blocks;
    const goals = new Map();
    if (this.carry) {
      // Stand next to a free dock cell (normally right of it), facing it.
      for (const slot of dock.freeSlots()) {
        for (const [dc, dr] of [[1, 0], [0, -1], [0, 1], [-1, 0]]) {
          const c = slot.c + dc;
          const r = slot.r + dr;
          const here = this.cell[0] === c && this.cell[1] === r;
          if (!here && !this.walkable(c, r, dock)) continue;
          const key = c * 1000 + r;
          if (!goals.has(key)) goals.set(key, { kind: 'drop', slot, face: [-dc, -dr] });
        }
      }
    } else {
      for (const l of B.blocks) {
        if (!l.alive || !l.cargo || l.drop > 0) continue;
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const c = l.c + dc;
          const r = l.r + dr;
          const here = this.cell[0] === c && this.cell[1] === r;
          if (!here && !this.walkable(c, r, dock)) continue;
          const key = c * 1000 + r;
          if (!goals.has(key)) goals.set(key, { kind: 'pick', block: l, face: [-dc, -dr] });
        }
      }
    }
    if (!goals.size) return false;
    const found = this.bfs(goals, dock);
    if (!found) return false;
    this.path = found.path;
    this.job = found.goal;
    this.state = 'drive';
    return true;
  }

  /** Puts the forklift into service on `cell` (after the chopper set it down). */
  activate(cell) {
    const c = this.blocks.cellCenter(cell[0], cell[1]);
    this.cell = cell;
    this.root.position.set(c.x, 0, c.z);
    this.root.rotation.set(0, this.yaw, 0);
    this.state = 'idle';
    this.path = [];
    this.carry = null;
    this.crate.visible = false;
    this.think = 0.6;
    this.active = true;
  }

  update(dt, dock, effects, onPlaced) {
    if (!this.active) return;
    this.time += dt;
    const B = this.blocks;
    const speed = GameConfig.logistics.forkliftSpeed;
    // Beacon blinks while working.
    this.beacon.intensity = this.state === 'idle' ? 0 : (Math.sin(this.time * 9) > 0 ? 3 : 0.4);

    if (this.state === 'idle') {
      this.think -= dt;
      if (this.think <= 0) {
        this.think = 0.4;
        this.plan(dock);
      }
    }

    if (this.state === 'drive') {
      // Job still valid?
      if (this.job.kind === 'pick' && (!this.job.block.alive || this.job.block.drop > 0)) {
        this.state = 'idle';
        this.path = [];
      } else if (this.job.kind === 'drop' && !dock.isFree(this.job.slot)) {
        this.state = 'idle';
        this.path = [];
      } else if (this.path.length === 0) {
        this.state = 'align';
      } else {
        const [nc, nr] = this.path[0];
        if (!this.walkable(nc, nr, dock)) {
          this.state = 'idle'; // something landed in the way: re-plan
          this.path = [];
        } else {
          const target = B.cellCenter(nc, nr);
          const dx = target.x - this.root.position.x;
          const dz = target.z - this.root.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.05) {
            this.root.position.set(target.x, 0, target.z);
            this.cell = [nc, nr];
            this.path.shift();
          } else {
            const want = yawFor(dx, dz);
            const diff = wrap(want - this.yaw);
            this.yaw += Math.sign(diff) * Math.min(Math.abs(diff), 5 * dt);
            if (Math.abs(diff) < 0.35) {
              const step = Math.min(dist, speed * dt);
              this.root.position.x += (dx / dist) * step;
              this.root.position.z += (dz / dist) * step;
              // Cell switches half way.
              if (dist - step < 0.75) this.cell = [nc, nr];
            }
          }
        }
      }
    }

    if (this.state === 'align') {
      const [fx, fz] = this.job.face;
      const diff = wrap(yawFor(fx, fz) - this.yaw);
      this.yaw += Math.sign(diff) * Math.min(Math.abs(diff), 4.5 * dt);
      if (Math.abs(diff) < 0.01) {
        this.state = 'work';
        this.action = { t: 0, kind: this.job.kind, done: false };
      }
    }

    if (this.state === 'work') {
      const a = this.action;
      a.t += dt;
      const [fx, fz] = this.job.face;
      const home = B.cellCenter(this.cell[0], this.cell[1]);
      const D = 1.8; // seconds
      const u = Math.min(1, a.t / D);
      // Nudge in (forks under the crate), lift / set down, back out.
      const nudge = Math.sin(u * Math.PI) * 0.3;
      this.root.position.set(home.x + fx * nudge, 0, home.z + fz * nudge);
      if (a.kind === 'pick') {
        if (!a.done && u > 0.45) {
          if (!this.job.block.alive) {
            this.state = 'idle';
          } else {
            a.done = true;
            const l = this.job.block;
            B.takeBlock(l);
            this.carry = l.color;
            this.crate.material = this.materials.block(l.color);
            this.crate.visible = true;
            effects.snowPuff(tmp.set(l.x, 0.3, l.z), 6);
          }
        }
        this.lift = u > 0.45 ? THREE.MathUtils.lerp(0, 0.35, Math.min(1, (u - 0.45) * 4)) : 0;
      } else {
        const slot = this.job.slot;
        const top = 0.2;
        this.lift = u < 0.5 ? Math.min(top, this.lift + dt * 1.6) : Math.max(0, this.lift - dt * 1.4);
        if (!a.done && u > 0.5) {
          a.done = true;
          if (dock.isFree(slot)) {
            dock.place(slot, this.carry, effects);
            onPlaced?.(this.carry);
            this.carry = null;
            this.crate.visible = false;
          } else {
            this.state = 'idle';
          }
        }
      }
      if (u >= 1) {
        this.root.position.set(home.x, 0, home.z);
        this.state = 'idle';
        this.think = 0.15;
      }
    } else if (this.state !== 'work') {
      // Carry height while driving.
      const want = this.carry ? 0.35 : 0;
      this.lift += Math.sign(want - this.lift) * Math.min(Math.abs(want - this.lift), dt * 1.2);
    }
    this.forks.position.y = this.forksBase + this.lift / FORK_SCALE;
    // Little bounce of the cab while driving.
    this.root.rotation.set(this.state === 'drive' ? Math.sin(this.time * 20) * 0.01 : 0, this.yaw, 0);
  }
}

// -------------------------------------------------------------------------------------------------
// Dock (leftmost column): packages stacked two high
// -------------------------------------------------------------------------------------------------
class Dock {
  constructor(blocks, scene, gifts) {
    this.blocks = blocks;
    this.gifts = gifts;
    this.group = new THREE.Group();
    scene.add(this.group);
    /** key "c:r" -> package (one package per dock cell, no stacking: a full row is full). */
    this.slots = new Map();
    /** Dock columns from the left edge: 1, or 2 with the DOUBLE ROW card. */
    this.columns = 1;
    this.markings = [];
    this.addFloorMarking(GameConfig.logistics.dockCol);
    this.time = 0;
  }

  /** Hazard-striped loading lane painted on a dock column. */
  addFloorMarking(c) {
    const B = this.blocks;
    const x = B.cellCenter(c, 0).x;
    const z0 = B.originZ;
    const len = B.rows * B.size;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64 * B.rows;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Yellow/black chevron borders on both long edges, a dashed slot outline per row.
    for (const side of [0, 56]) {
      for (let y = -64; y < canvas.height; y += 16) {
        ctx.fillStyle = '#f2b51c';
        ctx.beginPath();
        ctx.moveTo(side, y);
        ctx.lineTo(side + 8, y + 8);
        ctx.lineTo(side + 8, y + 16);
        ctx.lineTo(side, y + 8);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(20,20,20,0.55)';
      ctx.fillRect(side, 0, 1, canvas.height);
    }
    ctx.strokeStyle = 'rgba(242, 181, 28, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    for (let r = 0; r < B.rows; r++) ctx.strokeRect(13, r * 64 + 5, 38, 54);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(B.size, len),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.012, z0 + len / 2);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.markings.push(mesh);
  }

  /** DOUBLE ROW card: a second dock column right of the first one. */
  widen(effects) {
    if (this.columns >= 2) return;
    this.columns = 2;
    const c = GameConfig.logistics.dockCol + 1;
    this.addFloorMarking(c);
    const B = this.blocks;
    for (let r = 0; r < B.rows; r++) {
      const p = B.cellCenter(c, r);
      effects.sparkBurst(tmp.set(p.x, 0.2, p.z), 4, 3, [4, 3.4, 1.4, 1]);
    }
  }

  /** Back to a single dock column (new run). */
  narrow() {
    this.columns = 1;
    while (this.markings.length > 1) this.markings.pop().removeFromParent();
  }

  key(c, r) {
    return `${c}:${r}`;
  }

  hasAt(c, r) {
    return this.slots.has(this.key(c, r));
  }

  isFree(slot) {
    return !this.slots.has(this.key(slot.c, slot.r));
  }

  /** Free dock cells: the first column fills before the second one opens up. */
  freeSlots() {
    const c0 = GameConfig.logistics.dockCol;
    for (let k = 0; k < this.columns; k++) {
      const out = [];
      for (let r = 0; r < this.blocks.rows; r++) if (this.isFree({ c: c0 + k, r })) out.push({ c: c0 + k, r, level: 0 });
      if (out.length) return out;
    }
    return [];
  }

  get count() {
    return this.slots.size;
  }

  get capacity() {
    return this.blocks.rows * this.columns;
  }

  place(slot, color, effects) {
    const B = this.blocks;
    const { x, z } = B.cellCenter(slot.c, slot.r);
    const object = this.gifts.build(color);
    object.position.set(x, PKG / 2, z);
    object.rotation.y = (Math.random() - 0.5) * 0.12;
    object.scale.setScalar(0.01);
    this.group.add(object);
    const pkg = { c: slot.c, r: slot.r, level: 0, color, object, pop: 0 };
    this.slots.set(this.key(slot.c, slot.r), pkg);
    effects.sparkBurst(object.position, 18, 4, [4, 3.4, 1.4, 1]);
    return pkg;
  }

  /** Packages in pick-up order: far end first, outer column before inner. */
  ordered() {
    return [...this.slots.values()].sort((a, b) => a.r - b.r || a.c - b.c);
  }

  remove(pkg) {
    this.slots.delete(this.key(pkg.c, pkg.r));
  }

  clear() {
    for (const p of this.slots.values()) p.object.removeFromParent();
    this.slots.clear();
  }

  update(dt, effects) {
    this.time += dt;
    for (const p of this.slots.values()) {
      if (p.pop < 1) {
        // Gift "pops" into place.
        p.pop = Math.min(1, p.pop + dt * 3);
        const e = 1 + Math.sin(p.pop * Math.PI) * 0.25;
        p.object.scale.setScalar(p.pop * e);
      }
      if (!p.lifting && Math.random() < dt * 0.25) {
        effects.fire.emit({
          x: p.object.position.x + rnd.spread(0.5), y: p.object.position.y + PKG * 0.55, z: p.object.position.z + rnd.spread(0.5),
          vy: 0.6, life: 0.6, size0: 0.22, size1: 0.02, color0: [4, 3.4, 1.4, 1], color1: [2, 1.4, 0.4, 0],
        });
      }
    }
  }
}

// -------------------------------------------------------------------------------------------------
// CH-47F Chinook cargo chopper
// -------------------------------------------------------------------------------------------------
class Chinook {
  constructor(gltf, scene) {
    this.root = new THREE.Group();
    const model = gltf?.scene ?? fallbackChinook();
    model.scale.setScalar(0.55);
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.root.add(model);
    this.rotors = [model.getObjectByName('RotorFront'), model.getObjectByName('RotorRear')].filter(Boolean);
    this.root.visible = false;
    scene.add(this.root);
    // Winch cable.
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.cable = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x1a1a1a }));
    this.cable.visible = false;
    this.cable.frustumCulled = false;
    scene.add(this.cable);
    this.state = 'away';
    this.vel = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.yaw = 0;
    this.wantYaw = 0;
    this.time = 0;
    this.hoverY = 4.3;
  }

  get active() {
    return this.state !== 'away';
  }

  /** Starts a visit: enters from the left, heading +X toward the first package's row. */
  arrive(dock, blocks) {
    const first = dock.ordered()[0];
    const r = first ? first.r : Math.floor(blocks.rows / 2);
    const z = blocks.cellCenter(0, r).z;
    this.dockX = blocks.cellCenter(GameConfig.logistics.dockCol, 0).x;
    this.root.position.set(this.dockX - 30, 12, z);
    this.vel.set(10, 0, 0);
    this.yaw = this.wantYaw = yawFor(1, 0);
    this.target.set(this.dockX, this.hoverY, z);
    this.state = 'approach';
    this.mission = 'pickup';
    this.root.visible = true;
    this.loaded = 0;
    this.lift = null;
    this.waitTimer = 0;
  }

  /**
   * Special run: brings `cargo` (the engineer's forklift) slung under the belly and lowers it
   * onto the board at `spot`, then leaves. `onDropped` fires when it touches down.
   */
  deliver(cargo, spot, blocks, onDropped) {
    this.dockX = blocks.cellCenter(GameConfig.logistics.dockCol, 0).x;
    this.root.position.set(spot.x - 32, 13, spot.z);
    this.vel.set(10, 0, 0);
    this.yaw = this.wantYaw = yawFor(1, 0);
    this.target.set(spot.x, this.hoverY + 1.2, spot.z);
    this.state = 'dApproach';
    this.mission = 'delivery';
    this.root.visible = true;
    this.loaded = 0;
    this.sling = { cargo, spot, onDropped, t: 0 };
  }

  /** Critically damped move toward `target`. */
  steer(dt, stiffness = 1.6) {
    const p = this.root.position;
    tmp.subVectors(this.target, p).multiplyScalar(stiffness * stiffness);
    tmp.addScaledVector(this.vel, -2 * stiffness);
    this.vel.addScaledVector(tmp, dt);
    p.addScaledVector(this.vel, dt);
    return this.target.distanceTo(p);
  }

  update(dt, dock, effects, onDelivered, onLeft) {
    if (this.state === 'away') return;
    this.time += dt;
    for (const [i, r] of this.rotors.entries()) r.rotation.y += (i ? -1 : 1) * dt * 26;
    const p = this.root.position;

    if (this.sling && (this.state === 'dApproach' || this.state === 'dLower')) {
      const s = this.sling;
      const belly = p.y + 0.15;
      let hookY;
      if (this.state === 'dApproach') {
        const d = this.steer(dt, 0.9);
        hookY = belly - 1.0;
        if (d < 0.4 && this.vel.length() < 0.8) this.state = 'dLower';
      } else {
        this.steer(dt, 1.8);
        s.t += dt;
        const u = Math.min(1, s.t / 2.4);
        hookY = THREE.MathUtils.lerp(belly - 1.0, 2.0, u * u * (3 - 2 * u));
        if (u >= 1) {
          s.cargo.position.set(s.spot.x, 0, s.spot.z);
          effects.snowPuff(tmp2.set(s.spot.x, 0.2, s.spot.z), 14);
          effects.shatter(tmp2.set(s.spot.x, 0.25, s.spot.z), 0xcfc4b0, 8, 0.6, [0.08, 0.16]);
          this.sling = null;
          this.cable.visible = false;
          s.onDropped?.();
          this.state = 'depart';
          this.wantYaw = yawFor(-1, 0);
        }
      }
      if (this.sling) {
        // Forklift hangs 2 units below the hook, swinging a little.
        s.cargo.position.set(p.x + Math.sin(this.time * 1.7) * 0.06, hookY - 2.0, p.z);
        s.cargo.rotation.set(0, this.yaw + Math.sin(this.time * 1.1) * 0.08, Math.sin(this.time * 1.7) * 0.03);
        const pos = this.cable.geometry.attributes.position;
        pos.setXYZ(0, p.x, belly, p.z);
        pos.setXYZ(1, s.cargo.position.x, hookY, s.cargo.position.z);
        pos.needsUpdate = true;
        this.cable.visible = true;
      }
    } else if (this.state === 'approach') {
      const d = this.steer(dt, 0.9);
      if (d < 0.6) {
        this.state = 'turn';
        this.wantYaw = yawFor(0, 1); // nose toward the camera, flying down the dock lane
      }
    } else if (this.state === 'turn') {
      this.steer(dt, 1.4);
      if (Math.abs(wrap(this.wantYaw - this.yaw)) < 0.05) this.state = 'next';
    } else if (this.state === 'next') {
      const next = dock.ordered()[0];
      if (!next) {
        this.waitTimer += dt;
        this.steer(dt, 1.4);
        if (this.waitTimer > (this.loaded ? 0.6 : 2.5)) {
          this.state = 'depart';
          this.wantYaw = yawFor(-1, 0);
          this.target.set(this.dockX - 40, 15, p.z);
          onLeft?.(this.loaded);
        }
      } else {
        this.waitTimer = 0;
        this.pkg = next;
        this.target.set(next.object.position.x, this.hoverY, next.object.position.z);
        this.state = 'position';
      }
    } else if (this.state === 'position') {
      const d = this.steer(dt, 1.8);
      if (d < 0.12 && this.vel.length() < 0.6) {
        this.state = 'winch';
        this.pkg.lifting = true;
        this.winchT = 0;
        this.pkgStart = this.pkg.object.position.y;
      }
    } else if (this.state === 'winch') {
      this.steer(dt, 1.8);
      this.winchT += dt;
      const belly = p.y + 0.15;
      const u = Math.min(1, this.winchT / 1.4);
      const o = this.pkg.object;
      // Hook goes down (0..0.3), then the package rides up into the belly.
      const hookY = u < 0.3 ? THREE.MathUtils.lerp(belly, this.pkgStart + PKG / 2, u / 0.3) : THREE.MathUtils.lerp(this.pkgStart + PKG / 2, belly, (u - 0.3) / 0.7);
      if (u >= 0.3) {
        o.position.set(p.x, hookY - PKG / 2, p.z);
        o.rotation.y += dt * 1.5;
        if (u > 0.85) o.scale.setScalar(Math.max(0.01, (1 - u) / 0.15));
      }
      const pos = this.cable.geometry.attributes.position;
      pos.setXYZ(0, p.x, belly, p.z);
      pos.setXYZ(1, p.x, hookY, p.z);
      pos.needsUpdate = true;
      this.cable.visible = true;
      if (u >= 1) {
        this.cable.visible = false;
        o.removeFromParent();
        dock.remove(this.pkg);
        this.loaded++;
        effects.sparkBurst(tmp2.set(p.x, belly, p.z), 10, 3, [4, 3.4, 1.4, 1]);
        onDelivered?.(this.pkg.color);
        this.state = 'next';
      }
    } else if (this.state === 'depart') {
      // Accelerate away to the left and up.
      this.vel.x -= dt * 7;
      this.vel.y += dt * 1.5;
      this.vel.z *= Math.exp(-dt);
      p.addScaledVector(this.vel, dt);
      if (p.x < this.dockX - 38) {
        this.state = 'away';
        this.root.visible = false;
      }
    }
    // Yaw + attitude: pitch into the velocity, bank a little.
    this.yaw += wrap(this.wantYaw - this.yaw) * (1 - Math.exp(-2.2 * dt));
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const forward = this.vel.x * fx + this.vel.z * fz;
    const side = this.vel.x * fz - this.vel.z * fx;
    this.root.rotation.set(0, 0, 0);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = this.yaw;
    this.root.rotation.x = THREE.MathUtils.clamp(-forward * 0.025, -0.3, 0.3);
    this.root.rotation.z = THREE.MathUtils.clamp(side * 0.02, -0.25, 0.25) + Math.sin(this.time * 1.3) * 0.015;
    // Rotor wash dust on the floor when low.
    if (p.y < 7 && Math.random() < dt * 20) {
      const a = Math.random() * Math.PI * 2;
      const rr = 2 + Math.random() * 2.5;
      effects.smoke.emit({
        x: p.x + Math.cos(a) * rr, y: 0.2, z: p.z + Math.sin(a) * rr, vx: Math.cos(a) * 4, vy: 0.4, vz: Math.sin(a) * 4, drag: 1.6,
        life: 0.9, size0: 0.4, size1: 1.5, color0: [1.25, 1.28, 1.34, 0.4], color1: [1.2, 1.25, 1.3, 0],
      });
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Facade
// -------------------------------------------------------------------------------------------------
export class Logistics {
  /**
   * @param {{scene:THREE.Scene, blocks:BlockField, materials:any, effects:any, forkliftGltf?:any, chinookGltf?:any}} deps
   */
  constructor({ scene, blocks, materials, effects, forkliftGltf = null, chinookGltf = null }) {
    this.blocks = blocks;
    this.effects = effects;
    this.gifts = new GiftFactory();
    this.dock = new Dock(blocks, scene, this.gifts);
    this.engineer = new Engineer(forkliftGltf, blocks, materials);
    scene.add(this.engineer.root);
    this.chinook = new Chinook(chinookGltf, scene);
    blocks.isReserved = (c, r) => this.engineer.reserved(c, r);
    blocks.reachableCells = () => this.engineer.reachable(this.dock);
    // Train cargo only becomes protected, collectable cargo once the engineer is on duty.
    blocks.cargoEnabled = () => this.enabled;
    this.onDelivered = null;
    this.onChinookLeft = null;
    this.onPackaged = null;
    this.reset();
  }

  /** Back to the start of a run: no engineer yet (he comes with the FIELD ENGINEER card). */
  reset() {
    this.delivered = { red: 0, green: 0, blue: 0 };
    this.intervalMul = 1;
    this.timer = this.interval;
    this.enabled = false;
    this.hiring = false;
    // The chopper only comes for packages with the CARGO CHOPPER card.
    this.chopperEnabled = false;
    this.dock.narrow();
    this.blocks.dockColumns = 1;
    this.engineer.active = false;
    this.engineer.root.visible = false;
    this.dock.clear();
    const ch = this.chinook;
    ch.state = 'away';
    ch.root.visible = false;
    ch.cable.visible = false;
    ch.sling = null;
  }

  /**
   * FIELD ENGINEER card: the cargo chopper flies the forklift in and lowers it onto a free yard
   * cell near the middle of the board; from then on the engineer works and the chopper's
   * 2-minute schedule starts.
   */
  hireEngineer() {
    if (this.enabled || this.hiring) return;
    this.hiring = true;
    const B = this.blocks;
    let best = [2, 6];
    let bestD = Infinity;
    for (let c = 1; c < B.cols; c++) {
      if (!B.isYardCell(c)) continue;
      for (let r = 1; r < B.rows - 1; r++) {
        const l = B.cells.get(B.key(c, r));
        if (l && l.alive) continue;
        const d = (c - 3) ** 2 + (r - 6) ** 2;
        if (d < bestD) { bestD = d; best = [c, r]; }
      }
    }
    const spot = B.cellCenter(best[0], best[1]);
    const e = this.engineer;
    e.root.visible = true;
    e.yaw = yawFor(1, 0);
    this.chinook.deliver(e.root, spot, B, () => {
      e.activate(best);
      this.enabled = true;
      this.hiring = false;
      this.timer = this.interval;
      this.onEngineerReady?.();
    });
  }

  get missionComplete() {
    const goal = GameConfig.logistics.goal;
    return Object.keys(goal).every((k) => this.delivered[k] >= goal[k]);
  }

  /** Seconds between chopper visits (RUSH DELIVERY card: 30% shorter). */
  get interval() {
    return GameConfig.logistics.chinookInterval * (this.intervalMul ?? 1);
  }

  /** RUSH DELIVERY card: the chopper comes sooner, the running countdown shrinks with it. */
  speedUpChopper(mul) {
    this.intervalMul = mul;
    this.timer *= mul;
  }

  /** The 2-minute pick-up schedule runs once there is an engineer AND the cargo chopper contract. */
  get countdownActive() {
    return this.enabled && this.chopperEnabled;
  }

  /** CARGO CHOPPER card: from now on the Chinook comes every 2 minutes for the packages. */
  enableChopper() {
    if (this.chopperEnabled) return;
    this.chopperEnabled = true;
    this.timer = this.interval;
  }

  /**
   * DOUBLE ROW card: the dock gets a second column. Blocks standing there are cleared away;
   * cargo cubes on it are packed straight into gift packages.
   */
  widenDock() {
    if (this.dock.columns >= 2) return;
    const B = this.blocks;
    const c = GameConfig.logistics.dockCol + 1;
    for (let r = 0; r < B.rows; r++) {
      const l = B.cells.get(B.key(c, r));
      if (!l || !l.alive) continue;
      B.takeBlock(l);
      if (l.cargo) {
        this.dock.place({ c, r }, l.color, this.effects);
      } else {
        this.effects.shatter(tmp.set(l.x, 0.7, l.z), Palette.blocks[l.color], 10, 0.8, [0.12, 0.3]);
        this.effects.snowPuff(tmp.set(l.x, 0.3, l.z), 6);
      }
    }
    // Engineer parked on the new lane is fine: dock cells are walkable while empty.
    B.dockColumns = 2;
    this.dock.widen(this.effects);
    this.onPackaged?.();
  }

  /** Calls the chopper right now (tests / debugging). */
  callChopper() {
    this.timer = 0;
  }

  /**
   * @param {number} dt
   * @param {boolean} clockRunning whether the chopper countdown runs (only while playing)
   */
  update(dt, clockRunning) {
    this.engineer.update(dt, this.dock, this.effects, (color) => this.onPackaged?.(color));
    this.dock.update(dt, this.effects);
    if (this.countdownActive && !this.chinook.active && clockRunning) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.chinook.arrive(this.dock, this.blocks);
        this.onChinookArrive?.(this.dock.count);
      }
    }
    this.chinook.update(dt, this.dock, this.effects, (color) => {
      const key = MISSION_KEY[color];
      if (key) this.delivered[key] += 1;
      this.onDelivered?.(color, key);
    }, (loaded) => {
      this.timer = this.interval;
      this.onChinookLeft?.(loaded);
    });
  }

  /** Rotor wash / wheels push settled floor snow away. */
  snowClearers(out) {
    const e = this.engineer.root.position;
    if (this.engineer.active) out.push({ x: e.x, z: e.z, r: 0.9, rate: 4 });
    if (this.chinook.active) {
      const p = this.chinook.root.position;
      if (p.y < 8) out.push({ x: p.x, z: p.z, r: 4.5, rate: 2.2 * (1 - p.y / 8) + 0.6, puffs: true });
    }
  }
}

/** Plain stand-in if forklift.glb failed to load. */
function fallbackForklift() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xf2b51c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.8, 2), m);
  body.position.set(0, 0.6, 0.2);
  g.add(body);
  const forks = new THREE.Group();
  forks.name = 'Forks';
  const f = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 1), new THREE.MeshStandardMaterial({ color: 0x777777 }));
  f.position.set(0, 0.24, -1.2);
  forks.add(f);
  g.add(forks);
  return g;
}

function fallbackChinook() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 9), new THREE.MeshStandardMaterial({ color: 0xd8b83a }));
  body.position.y = 1.5;
  g.add(body);
  return g;
}

export { BlockField };
