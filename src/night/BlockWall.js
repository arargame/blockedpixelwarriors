import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GameConfig } from '../config/GameConfig.js';
import { NIGHT_BLOCKS as COLORS, NIGHT_BLOCK_KEYS as BLOCK_COLOR_KEYS } from './NightColors.js';
import { fxRandom as rnd } from '../util/Random.js';
import { Enemy } from '../combat/Enemy.js';
import { ObjectPool } from '../core/ObjectPool.js';

/** One block of the wall: a target only (it never shoots). Pooled; `serial` changes on reuse. */
export class WallBlock extends Enemy {
  constructor() {
    super({ hp: 1, harmsPlayer: false, kind: 'block' });
    this.serial = 0;
  }

  reset(row, col, color, hp, type = 'normal') {
    this.serial += 1;
    Object.assign(this, { row, col, color, hp, maxHp: hp, type, level: row.level ?? 1, alive: true, flash: 0, rise: 0, shake: 0, doomed: false, acid: 0, acidTick: 0 });
    return this;
  }
}

const dummy = new THREE.Object3D();
const col3 = new THREE.Color();
const hot = new THREE.Color();
const tmp = new THREE.Vector3();
const MAX = 12 * 40;

/**
 * The wall of coloured blocks rolling down the tray toward the near edge (Blocked's waves):
 *   - rows of `cols` blocks, contiguous, all moving together; a new row rises at the far end of
 *     the tray (`top`) whenever there is room, `stageRows` per stage;
 *   - every row has a Blocked level: L = 1 + (global row / 10), so the run's 1000 rows walk
 *     through Blocked's 100 levels; block type and HP follow Blocked's LevelManager.SpawnRow
 *     (10 % supply, 5 % explosive, 15 % tanky, 5 % tough, the rest normal; HP x the in-cycle
 *     multiplier 1.8 - 0.15 x ((L - 1) mod 10)), scaled by GameConfig.night.hpScale;
 *   - colours come in clusters (a cell copies its left or lower neighbour now and then), so
 *     same-colour groups form for the chain reaction;
 *   - damage(b, amount, at, o): the level works the amount out (shell power x2 on its own
 *     colour); an ACID shell turns the block green and eats it for a few seconds;
 *   - a destroyed block sets off its same-coloured neighbours (up / down / left / right), one
 *     ring after another (chainDelay s), Blocked GDD 4.3; an explosive block also blasts the
 *     eight around it;
 *   - a row reaching the near edge of the tray gets past the tank (onBreach: the tank pays).
 * Rendering: one instanced mesh per colour (wet clear-coated plastic with the cracked block
 * texture); tanky blocks are darker, explosive ones flicker hot, supply ones shimmer; damage
 * darkens a block and a hit flashes it.
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
        color: new THREE.Color(COLORS[key]).multiplyScalar(0.86),
        map,
        normalMap,
        normalScale: new THREE.Vector2(1.2, 1.2),
        roughness: 0.3,
        metalness: 0,
        clearcoat: 0.75,
        clearcoatRoughness: 0.08,
        envMapIntensity: 0.55,
        emissive: new THREE.Color(COLORS[key]),
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

  /**
   * A fresh wall for a stage: `rows` rows to come (global rows from `rowBase` on, for the
   * levels), spawning at the tray's far end `maxZ`.
   */
  reset({ rows = GameConfig.night.stages[0], rowBase = 0, maxZ = GameConfig.night.maxZ } = {}) {
    for (const r of this.rows) for (const b of r.cells) if (b) this.pool.release(b);
    this.rows.length = 0;
    this.chain.length = 0;
    this.spawned = 0;
    this.stageRows = rows;
    this.rowBase = rowBase;
    this.maxZ = maxZ;
    this.speed = GameConfig.night.speed;
    this.paused = false;
    const N = GameConfig.night;
    const top = maxZ - this.size / 2;
    for (let i = N.startRows - 1; i >= 0; i--) this.addRow(top - i * this.size, true);
  }

  /** Blocked level of the next row (1..100 over the run's 1000 rows). */
  get level() {
    return Math.min(100, 1 + Math.floor((this.rowBase + this.spawned) / 10));
  }

  /** Blocked's block type and HP for level L (LevelManager.SpawnRow). */
  roll(L) {
    const mult = Math.max(0.5, 1.8 - ((L - 1) % 10) * 0.15) * GameConfig.night.hpScale;
    const R = (a, b) => a + Math.floor(rnd.next() * (b - a));
    const p = rnd.next();
    let type = 'normal';
    let hp;
    if (rnd.next() < 0.1) {
      type = 'supply';
      hp = (R(1, 10) + Math.floor(L / 2)) * mult;
    } else if (p < 0.05) {
      type = 'explosive';
      hp = R(1, 11) * mult;
    } else if (p < 0.2) {
      type = 'tanky';
      hp = (R(20, 31) + L * 3) * mult;
    } else if (p < 0.25) {
      type = 'tough';
      hp = (R(10, 21) + L) * mult;
    } else hp = (R(2, 11) + L * 2) * mult;
    return { type, hp: Math.max(1, Math.round(hp)) };
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
    const key = { R: 'red', G: 'green', T: 'blue', Y: 'yellow', B: 'beige' };
    this.maxZ = N.maxZ;
    this.stageRows = map.length;
    this.rowBase = 0;
    for (let r = map.length - 1; r >= 0; r--) {
      const z = N.maxZ - this.size / 2 - r * this.size;
      const row = { z, cells: new Array(N.cols).fill(null), rise: 1, index: r };
      [...map[r]].forEach((ch, j) => {
        const c = N.cols - 1 - j;
        if (key[ch]) row.cells[c] = this.pool.acquire().reset(row, c, key[ch], 10);
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
    const level = this.level;
    const row = { z, cells: new Array(N.cols).fill(null), rise: instant ? 1 : 0, index: this.spawned++, level };
    for (let c = 0; c < N.cols; c++) {
      let color;
      const left = row.cells[c - 1]?.color;
      const down = below?.cells[c]?.color;
      const r = rnd.next();
      if (left && r < 0.42) color = left;
      else if (down && r < 0.68) color = down;
      else color = BLOCK_COLOR_KEYS[Math.floor(rnd.next() * BLOCK_COLOR_KEYS.length)];
      const { type, hp } = this.roll(level);
      row.cells[c] = this.pool.acquire().reset(row, c, color, hp, type);
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

  /**
   * `amount` damage to `b` (the level has worked out the shell's power and the colour bonus).
   * `acid`: the block turns green and keeps losing 2-5 HP a second for `acid` seconds.
   * Returns true if it broke.
   */
  damage(b, amount, at, { acid = 0, tint = null } = {}) {
    if (!b.alive || b.doomed) return false;
    b.hp -= amount;
    b.flash = 1;
    b.shake = 0.25;
    if (acid > 0) {
      b.acid = Math.max(b.acid, acid);
      b.color = 'green';
    }
    this.effects.shatter(at, tint ?? COLORS[b.color], amount >= 5 ? 7 : 3, 0.7, [0.1, 0.24]);
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
    // A light blast (no fireballs, no smoke: a chain of 30 blocks used to stack 30 explosions).
    this.effects.blast(at, depth > 0 ? 0.55 : 0.8);
    this.effects.shatter(at, COLORS[b.color], depth > 0 ? 6 : 10, 1.05, [0.18, 0.46]);
    const row = b.row;
    const i = this.rows.indexOf(row);
    if (b.type === 'explosive') {
      // Blocked's explosive block: the eight around it take a blast.
      this.effects.blast(at, 1.2);
      const blast = Math.max(8, Math.round((10 + b.level) * GameConfig.night.hpScale * 2));
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const n = this.rows[i + dr]?.cells[b.col + dc];
          if (n && n !== b && n.alive && !n.doomed) this.chain.push({ b: n, serial: n.serial, t: 0.08, depth: depth + 1, id: { size: 0, color: n.color }, blast });
        }
      }
    }
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
        if (c.blast) {
          if (!c.b.doomed) this.damage(c.b, c.blast, this.center(c.b, tmp).clone());
          continue;
        }
        c.b.doomed = false;
        this.destroy(c.b, c.depth, c.id);
      }
    }
    // Acid eats the blocks it touched (2-5 HP a second).
    for (const r of this.rows) {
      for (const b of r.cells) {
        if (!b || !b.alive || b.doomed || b.acid <= 0) continue;
        b.acid -= dt;
        b.acidTick -= dt;
        if (b.acidTick <= 0) {
          b.acidTick = 0.5;
          const at = this.center(b, tmp).clone();
          at.y += this.size * 0.5;
          this.effects.fire.emit({ x: at.x, y: at.y, z: at.z, vy: 0.8, life: 0.6, size0: 0.5, size1: 0.1, color0: [0.4, 2.2, 0.3, 0.9], color1: [0.1, 0.6, 0.1, 0] });
          this.damage(b, (2 + Math.floor(rnd.next() * 4)) / 2, at, { tint: 0x7bff5a });
        }
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
    const top = this.maxZ - this.size / 2;
    const last = this.rows[this.rows.length - 1];
    if (this.spawned < this.stageRows && (!last || last.z <= top - this.size)) this.addRow(last ? last.z + this.size : top);
    // Breach: the front row slides off the near edge of the tray, past the tank.
    const front = this.rows[0];
    if (front && front.z - this.size / 2 <= N.minZ) {
      const hit = front.cells.filter((b) => b);
      for (const b of hit) {
        b.alive = false;
        const at = this.center(b, tmp);
        this.effects.blast(at, 0.8);
        this.effects.shatter(at, COLORS[b.color], 6, 1.2, [0.2, 0.45]);
        this.pool.release(b);
      }
      front.cells.fill(null);
      this.rows.shift();
      if (hit.length) this.onBreach?.(hit);
    }
    return this.render(dt);
  }

  get finished() {
    return this.spawned >= this.stageRows && this.alive === 0 && this.chain.length === 0;
  }

  render(dt = 0) {
    this.time = (this.time ?? 0) + dt;
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
        // Damage darkens the block; a hit flashes it white. Tanky blocks are darker, explosive
        // ones flicker hot, supply ones shimmer, acid ones glow green.
        const health = Math.max(0, b.hp / b.maxHp);
        const dark = 0.55 + 0.45 * health;
        col3.setRGB(dark, dark, dark);
        if (b.type === 'tanky') col3.multiplyScalar(0.62);
        else if (b.type === 'tough') col3.multiplyScalar(0.8);
        else if (b.type === 'explosive') {
          const f = 1 + 0.35 * Math.sin(this.time * 14 + b.col);
          col3.multiply(hot.setRGB(1.5 * f, 0.75 * f, 0.4 * f));
        } else if (b.type === 'supply') col3.multiplyScalar(1.2 + 0.3 * Math.sin(this.time * 4 + b.col * 0.7));
        if (b.acid > 0) col3.multiply(hot.setRGB(0.8, 1.35, 0.7));
        col3.lerp(hot.setRGB(3, 3, 3), b.flash * 0.6);
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
