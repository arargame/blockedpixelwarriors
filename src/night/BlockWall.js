import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GameConfig } from '../config/GameConfig.js';
import { Palette, BLOCK_COLOR_KEYS } from '../config/Palette.js';
import { fxRandom as rnd } from '../util/Random.js';
import { Enemy } from '../combat/Enemy.js';
import { ObjectPool } from '../core/ObjectPool.js';

/** One block of the wall: a target only (it never shoots). Pooled; `serial` changes on reuse. */
export class WallBlock extends Enemy {
  constructor() {
    super({ hp: 1, harmsPlayer: false, kind: 'block' });
    this.serial = 0;
  }

  reset(row, col, color, hp) {
    this.serial += 1;
    Object.assign(this, { row, col, color, hp, maxHp: hp, alive: true, flash: 0, rise: 0, shake: 0, doomed: false });
    return this;
  }
}

const dummy = new THREE.Object3D();
const col3 = new THREE.Color();
const tmp = new THREE.Vector3();
const MAX = 12 * 34;

/**
 * The wall of coloured blocks rolling down the night arena toward the tank (Blocked's waves):
 *   - rows of `cols` blocks, contiguous (1 block apart), all moving together at `speed`;
 *   - a new row rises out of the floor at the top whenever there is room (until totalRows);
 *   - colours come in clusters (a cell copies its left or lower neighbour now and then), so
 *     same-colour groups form for the chain reaction;
 *   - damage(): a shell of the block's colour deals matchDamage, anything else plainDamage;
 *   - a destroyed block sets off its same-coloured neighbours (up / down / left / right), one
 *     ring after another (chainDelay s), Blocked GDD 4.3;
 *   - the front row reaching the deadline breaks on the tank's line (onBreach).
 * Rendering: one instanced mesh per colour (wet clear-coated plastic with the cracked block
 * texture); hit blocks flash and crack darker.
 */
export class BlockWall {
  constructor(textures, effects, nightTextures = null) {
    const N = GameConfig.night;
    this.effects = effects;
    this.group = new THREE.Group();
    this.rows = [];
    this.chain = [];
    this.pool = new ObjectPool(() => new WallBlock(), 200);
    this.onDestroyed = null; // (block, depth, at, chainSize) => void
    this.onBreach = null; // (blocks) => void
    // The key art's cracked mosaic faces (night textures), else the heli game's blocks.
    const { map, normalMap } = nightTextures ? nightTextures.cracked() : textures.blockSurface();
    const geo = new RoundedBoxGeometry(1, 1, 1, 3, 0.06);
    this.meshes = {};
    for (const key of BLOCK_COLOR_KEYS) {
      const m = new THREE.MeshPhysicalMaterial({
        // Deep, saturated wet cubes (the art's), not washed pastel under the lamp and the sky.
        color: new THREE.Color(Palette.blocks[key]).multiplyScalar(0.86),
        map,
        normalMap,
        normalScale: new THREE.Vector2(1.2, 1.2),
        roughness: 0.3,
        metalness: 0,
        clearcoat: 0.75,
        clearcoatRoughness: 0.08,
        envMapIntensity: 0.55,
        emissive: new THREE.Color(Palette.blocks[key]),
        emissiveIntensity: 0.06,
      });
      const mesh = new THREE.InstancedMesh(geo, m, MAX);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      for (let i = 0; i < MAX; i++) mesh.setColorAt(i, col3.setRGB(1, 1, 1));
      this.meshes[key] = mesh;
      this.group.add(mesh);
    }
    this.reset();
  }

  get size() {
    return GameConfig.night.block;
  }

  reset() {
    for (const r of this.rows) for (const b of r.cells) if (b) this.pool.release(b);
    this.rows.length = 0;
    this.chain.length = 0;
    this.spawned = 0;
    this.speed = GameConfig.night.speed;
    this.paused = false;
    const N = GameConfig.night;
    const top = N.maxZ - this.size / 2;
    for (let i = N.startRows - 1; i >= 0; i--) this.addRow(top - i * this.size, true);
  }

  /**
   * Lays the wall out from a map (rows top to bottom; characters R G T Y, '.' = empty; columns
   * from the screen's left, i.e. +x, to its right) - the key-art moment.
   */
  stage(map) {
    const N = GameConfig.night;
    for (const r of this.rows) for (const b of r.cells) if (b) this.pool.release(b);
    this.rows.length = 0;
    this.chain.length = 0;
    const key = { R: 'red', G: 'green', T: 'teal', Y: 'yellow' };
    for (let r = map.length - 1; r >= 0; r--) {
      const z = N.maxZ - this.size / 2 - r * this.size;
      const row = { z, cells: new Array(N.cols).fill(null), rise: 1, index: r };
      [...map[r]].forEach((ch, j) => {
        const c = N.cols - 1 - j;
        if (key[ch]) row.cells[c] = this.pool.acquire().reset(row, c, key[ch], N.blockHp);
      });
      if (!this.rows.length && row.cells.every((b) => !b)) continue;
      this.rows.push(row);
    }
    this.spawned = map.length;
    this.render();
  }

  colX(c) {
    const N = GameConfig.night;
    return N.minX + (c + 0.5) * this.size;
  }

  /** A new row at z: colours copied from the left / lower neighbour now and then (clusters). */
  addRow(z, instant = false) {
    const N = GameConfig.night;
    const below = this.rows[this.rows.length - 1];
    const row = { z, cells: new Array(N.cols).fill(null), rise: instant ? 1 : 0, index: this.spawned++ };
    for (let c = 0; c < N.cols; c++) {
      let color;
      const left = row.cells[c - 1]?.color;
      const down = below?.cells[c]?.color;
      const r = rnd.next();
      if (left && r < 0.42) color = left;
      else if (down && r < 0.68) color = down;
      else color = BLOCK_COLOR_KEYS[Math.floor(rnd.next() * BLOCK_COLOR_KEYS.length)];
      row.cells[c] = this.pool.acquire().reset(row, c, color, N.blockHp);
    }
    this.rows.push(row);
    return row;
  }

  get alive() {
    let n = 0;
    for (const r of this.rows) for (const b of r.cells) if (b) n++;
    return n;
  }

  /** Front-most (lowest z) block of each column: what the tank can see. */
  exposed(out = []) {
    out.length = 0;
    const N = GameConfig.night;
    for (let c = 0; c < N.cols; c++) {
      for (const r of this.rows) {
        const b = r.cells[c];
        if (b && !b.doomed && r.rise > 0.6) {
          out.push(b);
          break;
        }
      }
    }
    return out;
  }

  /** Block whose cell contains (x, z), or null. */
  blockAt(x, z) {
    const N = GameConfig.night;
    const c = Math.floor((x - N.minX) / this.size);
    if (c < 0 || c >= N.cols || !this.rows.length) return null;
    const i = Math.round((z - this.rows[0].z) / this.size);
    const r = this.rows[i];
    if (!r || Math.abs(z - r.z) > this.size / 2) return null;
    const b = r.cells[c];
    return b && !b.doomed ? b : null;
  }

  center(b, out) {
    return out.set(this.colX(b.col), this.size * 0.5 * b.row.rise, b.row.z);
  }

  /** A shell of shell colour `shell` (a block key, or null for white) hits `b`. */
  damage(b, shell, at) {
    const N = GameConfig.night;
    if (!b.alive || b.doomed) return false;
    const match = shell === b.color;
    b.hp -= match ? N.matchDamage : N.plainDamage;
    b.flash = 1;
    b.shake = 0.25;
    this.effects.shatter(at, match ? Palette.blocks[b.color] : 0xd8dde6, match ? 6 : 3, 0.7, [0.1, 0.24]);
    if (b.hp <= 0) {
      this.destroy(b, 0, null);
      return true;
    }
    return false;
  }

  /** Destroys b now and queues its same-coloured neighbours (the chain reaction). */
  destroy(b, depth, chainId) {
    if (!b.alive) return;
    const id = chainId ?? { size: 0, color: b.color };
    b.alive = false;
    b.doomed = true;
    id.size += 1;
    const at = this.center(b, tmp).clone();
    this.effects.explosion(at, depth > 0 ? 0.6 : 0.85, null, 0);
    this.effects.shatter(at, Palette.blocks[b.color], depth > 0 ? 9 : 14, 1.05, [0.18, 0.46]);
    this.effects.flash(at, Palette.blocks[b.color], depth > 0 ? 18 : 30, 0.25, 7);
    const row = b.row;
    const i = this.rows.indexOf(row);
    const nb = [this.rows[i - 1]?.cells[b.col], this.rows[i + 1]?.cells[b.col], row.cells[b.col - 1], row.cells[b.col + 1]];
    for (const n of nb) {
      if (n && n.alive && !n.doomed && n.color === b.color) {
        n.doomed = true;
        this.chain.push({ b: n, serial: n.serial, t: GameConfig.night.chainDelay, depth: depth + 1, id });
      }
    }
    row.cells[b.col] = null;
    this.onDestroyed?.(b, depth, at, id);
    this.pool.release(b);
  }

  update(dt, onlyChains = false) {
    const N = GameConfig.night;
    // Chain reaction queue.
    for (let k = this.chain.length - 1; k >= 0; k--) {
      const c = this.chain[k];
      c.t -= dt;
      if (c.t > 0) continue;
      this.chain.splice(k, 1);
      if (c.b.alive && c.b.serial === c.serial) {
        c.b.doomed = false;
        this.destroy(c.b, c.depth, c.id);
      }
    }
    if (onlyChains || this.paused) return this.render(dt);
    // Roll toward the tank.
    for (const r of this.rows) {
      r.z -= this.speed * dt;
      r.rise = Math.min(1, r.rise + dt * 1.6);
    }
    // Empty rows at the front leave the list (indices stay contiguous behind them).
    while (this.rows.length && this.rows[0].cells.every((b) => !b)) this.rows.shift();
    // A new row at the top when there is room.
    const top = N.maxZ - this.size / 2;
    const last = this.rows[this.rows.length - 1];
    if (this.spawned < N.totalRows && (!last || last.z <= top - this.size)) this.addRow(last ? last.z + this.size : top);
    // Breach: the front row reaches the tank's line.
    const front = this.rows[0];
    if (front && front.z - this.size / 2 <= N.deadline) {
      const hit = front.cells.filter((b) => b);
      for (const b of hit) {
        b.alive = false;
        const at = this.center(b, tmp);
        this.effects.explosion(at, 0.9, null, 0);
        this.effects.shatter(at, Palette.blocks[b.color], 10, 1.2, [0.2, 0.45]);
        this.pool.release(b);
      }
      front.cells.fill(null);
      this.rows.shift();
      if (hit.length) this.onBreach?.(hit);
    }
    return this.render(dt);
  }

  get finished() {
    return this.spawned >= GameConfig.night.totalRows && this.alive === 0 && this.chain.length === 0;
  }

  render(dt = 0) {
    const s = this.size * 0.985;
    const counts = {};
    for (const key of BLOCK_COLOR_KEYS) counts[key] = 0;
    for (const r of this.rows) {
      for (const b of r.cells) {
        if (!b) continue;
        const m = this.meshes[b.color];
        const i = counts[b.color]++;
        if (i >= MAX) continue;
        b.flash = Math.max(0, b.flash - dt * 5);
        b.shake = Math.max(0, b.shake - dt);
        const rise = r.rise;
        const k = b.shake > 0 ? Math.sin(b.shake * 80) * b.shake * 0.25 : 0;
        dummy.position.set(this.colX(b.col) + k, s * 0.5 - s * (1 - rise), r.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        // Damage darkens the block; a hit flashes it white.
        const health = b.hp / b.maxHp;
        const dark = 0.55 + 0.45 * health;
        col3.setRGB(dark, dark, dark).lerp(col3.clone().setRGB(3, 3, 3), b.flash * 0.6);
        m.setColorAt(i, col3);
      }
    }
    for (const key of BLOCK_COLOR_KEYS) {
      const m = this.meshes[key];
      m.count = Math.min(MAX, counts[key]);
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
