import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GameConfig } from '../config/GameConfig.js';
import { Palette, BLOCK_COLOR_KEYS } from '../config/Palette.js';
import { Random, fxRandom as rnd } from '../util/Random.js';
import { VoxelModelBuilder } from '../util/VoxelModelBuilder.js';
import { createCanvas, canvasToTexture } from '../textures/CanvasUtils.js';

const dummy = new THREE.Object3D();
const white = new THREE.Color(1, 1, 1);
const flashColor = new THREE.Color(2.4, 2.4, 2.4);
const tmp = new THREE.Vector3();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** Block types: normal, armored (more HP, steel cage) and supply (always drops a supply). */
export const BlockType = Object.freeze({ NORMAL: 'normal', ARMORED: 'armored', SUPPLY: 'supply' });

/**
 * Grid of destructible voxel blocks on the board ("balcony").
 *
 * Every grid cell owns a fixed instance slot in each instanced mesh (one mesh per colour plus
 * snow caps and the armored / supply overlays), so blocks can appear at runtime: when the
 * player shoots a cube off the train it falls onto the nearest free cell. Destroyed blocks do
 * NOT respawn on their own. A destroyed block also blows up every same-coloured block touching
 * it (flood fill, cascading outward).
 */
export class BlockField {
  /**
   * @param {import('../textures/MaterialLibrary.js').MaterialLibrary} materials
   * @param {import('../fx/EffectsManager.js').EffectsManager} effects
   */
  constructor(materials, effects) {
    this.effects = effects;
    const b = GameConfig.board;
    this.size = GameConfig.blockSize;
    this.originX = b.minX;
    this.originZ = b.minZ;
    this.cols = Math.floor((b.maxX - this.originX) / this.size);
    this.rows = Math.floor((b.maxZ - this.originZ) / this.size);
    this.capacity = this.cols * this.rows;
    this.group = new THREE.Group();
    /** @type {Map<number, any>} cell key -> block record (alive or not) */
    this.cells = new Map();
    /** All block records (iterate and check `alive`). */
    this.blocks = [];
    /** Pending chain explosions. */
    this.chain = [];
    this.onBlockDestroyed = null;
    this.rng = new Random(2026);

    const geometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.06);
    this.meshes = {};
    for (const key of BLOCK_COLOR_KEYS) this.meshes[key] = this.instanced(geometry, materials.block(key), true);
    for (const m of Object.values(this.meshes)) for (let i = 0; i < this.capacity; i++) m.setColorAt(i, white);

    const overlayGeometry = new THREE.BoxGeometry(1.012, 1.012, 1.012);
    this.armorMesh = this.instanced(overlayGeometry, new THREE.MeshStandardMaterial({
      map: armorTexture(), transparent: true, alphaTest: 0.4, roughness: 0.35, metalness: 0.75, envMapIntensity: 1.4,
    }), true);
    const supplyTex = supplyTexture();
    this.supplyMesh = this.instanced(overlayGeometry, new THREE.MeshStandardMaterial({
      map: supplyTex, emissiveMap: supplyTex, emissive: new THREE.Color(1, 0.85, 0.4), emissiveIntensity: 0.9,
      transparent: true, alphaTest: 0.3, roughness: 0.3, metalness: 0.4,
    }), false);
    this.snowMeshes = [this.buildSnowCap(3), this.buildSnowCap(8), this.buildSnowCap(15)].map((g) => this.instanced(g, materials.snow(), true));
    // Train cargo waiting for the engineer: shipping label + "this way up" arrows on every face.
    this.cargoMesh = this.instanced(overlayGeometry, new THREE.MeshStandardMaterial({
      map: cargoLabelTexture(), transparent: true, alphaTest: 0.35, roughness: 0.6,
    }), false);
    // Acid (green gem): glowing lime film over melting blocks.
    this.acidMaterial = new THREE.MeshBasicMaterial({ color: 0x7dff4a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    this.acidMesh = this.instanced(new RoundedBoxGeometry(1.04, 1.04, 1.04, 2, 0.08), this.acidMaterial, false);
    this.acidTime = 0;
    /** Cells the engineer's forklift occupies or is driving into (no blocks may land there). */
    this.isReserved = () => false;
    /** Set of free cell keys the forklift can drive to (cargo prefers to land there), or null. */
    this.reachableCells = () => null;
    /** Whether red / green / blue train cubes land as protected cargo (engineer on duty). */
    this.cargoEnabled = () => true;
    /** Dock columns from the left edge (2 with the DOUBLE ROW card). */
    this.dockColumns = 1;

    this.createLayout();
    this.flushMatrices();
  }

  instanced(geometry, material, castShadow) {
    const mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    for (let i = 0; i < this.capacity; i++) mesh.setMatrixAt(i, HIDDEN);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  key(c, r) {
    return c * 1000 + r;
  }

  slot(c, r) {
    return c * this.rows + r;
  }

  cellCenter(c, r) {
    return { x: this.originX + (c + 0.5) * this.size, z: this.originZ + (r + 0.5) * this.size };
  }

  isTrackCell(c) {
    return Math.abs(this.cellCenter(c, 0).x - GameConfig.track.x) < 1.6;
  }

  /** Leftmost column: the loading dock where the gift packages wait for the cargo chopper. */
  isDockCell(c) {
    const c0 = GameConfig.logistics.dockCol;
    return c >= c0 && c < c0 + this.dockColumns;
  }

  /** Board cells on the engineer's side of the railway (left of the track, dock excluded). */
  isYardCell(c) {
    return !this.isDockCell(c) && !this.isTrackCell(c) && this.cellCenter(c, 0).x < GameConfig.track.x;
  }

  /** Cargo colours the mission asks for (red, green, blue = teal blocks). */
  static isGoalColor(color) {
    return color === 'red' || color === 'green' || color === 'teal';
  }

  /** Random block type using the configured odds. */
  rollType() {
    const cfg = GameConfig.blocks;
    const r = Math.random();
    if (r < cfg.supplyChance) return BlockType.SUPPLY;
    if (r < cfg.supplyChance + cfg.armoredChance) return BlockType.ARMORED;
    return BlockType.NORMAL;
  }

  /**
   * Creates (or revives) the block in a cell.
   * @returns {any} the block record
   */
  placeBlock(c, r, color, { type = this.rollType(), snow = -1, from = null, cargo = false } = {}) {
    const k = this.key(c, r);
    let l = this.cells.get(k);
    if (!l) {
      const { x, z } = this.cellCenter(c, r);
      l = { c, r, x, z, slot: this.slot(c, r) };
      this.cells.set(k, l);
      this.blocks.push(l);
    }
    if (l.mesh && l.mesh !== this.meshes[color]) l.mesh.setMatrixAt(l.slot, HIDDEN);
    const hp = type === BlockType.ARMORED ? GameConfig.blocks.armoredHp : GameConfig.blocks.hp;
    Object.assign(l, {
      color, type, hp, maxHp: hp, alive: true, flash: 0, drop: 0, chainAt: 0, cargo, acid: null,
      mesh: this.meshes[color], snow,
      snowMesh: snow >= 0 ? this.snowMeshes[snow] : null,
      rotY: this.rng.int(0, 3) * (Math.PI / 2),
      jitter: this.rng.spread(0.03),
      fall: from ? { from: from.clone(), t: 0, dur: 0.75 } : null,
    });
    if (l.fall) l.drop = 1;
    this.writeMatrix(l);
    return l;
  }

  /** Hand-authored opening layout matching the key art (row 0 = far wall, col 0 = left wall). */
  createLayout() {
    // R/G/T/Y = block color, '.' = empty. Columns 8-9 are the railway, 2-4 the heli lane.
    const MAP = [
      '..........GY',
      '.....Y....TR',
      '......G...YG',
      '..........RT',
      'R.........GY',
      'GG........TR',
      'TY........YG',
      'R.........RT',
      'Y......G..GY',
      'TT....YY..YR',
      '.....GGY..TG',
      '......RR..RY',
      '.....RR...GT',
    ];
    const colorOf = { R: 'red', G: 'green', T: 'teal', Y: 'yellow' };
    MAP.forEach((line, r) => {
      [...line].forEach((ch, c) => {
        const color = colorOf[ch];
        if (!color || c >= this.cols || r >= this.rows || this.isTrackCell(c) || this.isDockCell(c)) return;
        this.placeBlock(c, r, color, { snow: this.rng.chance(0.72) ? this.rng.int(0, 2) : -1 });
      });
    });
  }

  /**
   * A cube knocked off the train falls onto the nearest free cell on the engineer's side of the
   * railway (left of the track, never on the dock or under the forklift). Red / green / blue cubes
   * become protected cargo the engineer collects; yellow ones land as ordinary blocks.
   * @param {THREE.Vector3} from world position of the cube
   * @param {string} color block colour key
   * @returns {boolean} false if there was no free cell nearby (caller shatters it instead)
   */
  dropFromTrain(from, color) {
    const cargo = BlockField.isGoalColor(color) && this.cargoEnabled();
    // Cargo lands where the forklift can get at it (closest such cell), else the closest free one.
    const reach = cargo ? this.reachableCells() : null;
    let best = null;
    let bestD = Infinity;
    for (let c = 0; c < this.cols; c++) {
      if (!this.isYardCell(c)) continue;
      for (let r = 0; r < this.rows; r++) {
        const l = this.cells.get(this.key(c, r));
        if ((l && l.alive) || this.isReserved(c, r)) continue;
        const { x, z } = this.cellCenter(c, r);
        let d = (x - from.x) ** 2 + (z - from.z) ** 2;
        if (reach && !reach.has(this.key(c, r))) d += 1000;
        if (d < bestD) { bestD = d; best = [c, r]; }
      }
    }
    if (!best || (bestD >= 1000 ? bestD - 1000 : bestD) > GameConfig.blocks.maxDropDistance ** 2) return false;
    this.placeBlock(best[0], best[1], color, { from, cargo, type: cargo ? BlockType.NORMAL : this.rollType() });
    return true;
  }

  /**
   * Green gem (Blocked's acid): the block turns green - so it now chains with green neighbours -
   * glows lime, slowly sinks and loses HP every second until it melts away. Cargo is immune.
   */
  applyAcid(block) {
    if (!block.alive || block.cargo || block.acid || block.drop > 0) return;
    block.acid = { timer: GameConfig.blocks.acidTick };
    if (block.color !== 'green') {
      block.mesh.setMatrixAt(block.slot, HIDDEN);
      block.color = 'green';
      block.mesh = this.meshes.green;
    }
    block.snowMesh = null;
    this.effects.sparkBurst(tmp.set(block.x, this.size, block.z), 10, 3, [0.8, 4, 0.6, 1]);
    this.writeMatrix(block);
    this.flushMatrices();
  }

  /** The engineer lifts a cargo block off the board (no explosion, no score). */
  takeBlock(block) {
    if (!block.alive) return false;
    block.alive = false;
    block.chainAt = 0;
    this.writeMatrix(block);
    this.flushMatrices();
    return true;
  }

  buildSnowCap(seed) {
    const rng = new Random(seed);
    const b = new VoxelModelBuilder({ bevel: 0.03, segments: 3 });
    const cx = rng.chance(0.5) ? 1 : -1;
    const cz = rng.chance(0.5) ? 1 : -1;
    const alongX = rng.chance(0.5);
    const pillows = rng.int(4, 6);
    for (let i = 0; i < pillows; i++) {
      const t = i / pillows;
      const r = rng.range(0.11, 0.17) * (1 - t * 0.35);
      const along = rng.spread(0.36);
      const inset = 0.5 - r * 0.8 - rng.range(0, 0.1) - t * 0.12;
      const px = alongX ? along : cx * inset;
      const pz = alongX ? cz * inset : along;
      const h = r * rng.range(0.32, 0.45);
      b.sphere([px, h * 0.35, pz], 1, Palette.snow, { detail: 2, scale: [r * rng.range(1.1, 1.6), h, r * rng.range(1.0, 1.4)], rotation: [0, rng.range(0, 3), 0] });
    }
    // Rolled lip over the edge + drips down the side face.
    const lipLen = rng.range(0.55, 0.95);
    const lipPos = alongX ? [rng.spread(0.08), -0.005, cz * 0.49] : [cx * 0.49, -0.005, rng.spread(0.08)];
    b.box(lipPos, alongX ? [lipLen, 0.1, 0.09] : [0.09, 0.1, lipLen], Palette.snow, { bevel: 0.042 });
    const drips = rng.int(1, 3);
    for (let i = 0; i < drips; i++) {
      const o = rng.spread(lipLen * 0.4);
      const dh = rng.range(0.08, 0.18);
      const p = alongX ? [lipPos[0] + o, -0.03 - dh * 0.5, cz * 0.505] : [cx * 0.505, -0.03 - dh * 0.5, lipPos[2] + o];
      b.box(p, alongX ? [0.075, dh, 0.06] : [0.06, dh, 0.075], Palette.snow, { bevel: 0.028 });
    }
    return b.buildGeometries().get('body');
  }

  writeMatrix(l) {
    const s = this.size * 0.985;
    if (!l.alive) {
      l.mesh.setMatrixAt(l.slot, HIDDEN);
      this.armorMesh.setMatrixAt(l.slot, HIDDEN);
      this.supplyMesh.setMatrixAt(l.slot, HIDDEN);
      this.cargoMesh.setMatrixAt(l.slot, HIDDEN);
      this.acidMesh.setMatrixAt(l.slot, HIDDEN);
      for (const m of this.snowMeshes) m.setMatrixAt(l.slot, HIDDEN);
      return;
    }
    let px = l.x;
    let py = s * 0.5;
    let pz = l.z;
    let spin = 0;
    if (l.fall) {
      // Arc from the train down onto the cell, tumbling.
      const t = Math.min(1, l.fall.t / l.fall.dur);
      const e = t * t * (3 - 2 * t);
      px = THREE.MathUtils.lerp(l.fall.from.x, l.x, e);
      pz = THREE.MathUtils.lerp(l.fall.from.z, l.z, e);
      py = THREE.MathUtils.lerp(l.fall.from.y, s * 0.5, t * t) + Math.sin(t * Math.PI) * 1.6;
      spin = (1 - t) * 4;
    }
    // Melting under acid: the block slumps as its HP drains.
    let sy = s;
    if (l.acid) {
      sy = s * (0.45 + 0.55 * Math.max(0, l.hp / l.maxHp));
      py = sy * 0.5;
    }
    dummy.position.set(px, py, pz);
    dummy.rotation.set(spin * 0.6, l.rotY + l.jitter + spin, 0);
    dummy.scale.set(s, sy, s);
    dummy.updateMatrix();
    this.acidMesh.setMatrixAt(l.slot, l.acid ? dummy.matrix : HIDDEN);
    l.mesh.setMatrixAt(l.slot, dummy.matrix);
    this.armorMesh.setMatrixAt(l.slot, l.type === BlockType.ARMORED ? dummy.matrix : HIDDEN);
    this.supplyMesh.setMatrixAt(l.slot, l.type === BlockType.SUPPLY ? dummy.matrix : HIDDEN);
    this.cargoMesh.setMatrixAt(l.slot, l.cargo ? dummy.matrix : HIDDEN);
    for (const m of this.snowMeshes) m.setMatrixAt(l.slot, HIDDEN);
    if (l.snowMesh && l.hp === l.maxHp && !l.fall) {
      dummy.position.set(l.x, s, l.z);
      dummy.rotation.set(0, l.rotY + l.jitter, 0);
      dummy.updateMatrix();
      l.snowMesh.setMatrixAt(l.slot, dummy.matrix);
    }
  }

  flushMatrices() {
    for (const m of [...Object.values(this.meshes), this.armorMesh, this.supplyMesh, this.cargoMesh, this.acidMesh, ...this.snowMeshes]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** Returns the live, landed block occupying a world point, or null. */
  blockAt(x, y, z) {
    if (y > this.size || y < -0.2) return null;
    const c = Math.floor((x - this.originX) / this.size);
    const r = Math.floor((z - this.originZ) / this.size);
    const l = this.cells.get(this.key(c, r));
    return l && l.alive && l.drop <= 0 ? l : null;
  }

  /**
   * Applies damage to a block.
   * @returns {boolean} true when the block was destroyed
   */
  damage(block, amount, hitPoint) {
    if (!block.alive) return false;
    const hadSnow = block.hp === block.maxHp && block.snowMesh;
    block.hp -= amount;
    block.flash = 0.08;
    if (hadSnow) this.effects.snowPuff(tmp.set(block.x, this.size + 0.1, block.z), 7);
    if (block.hp <= 0) {
      this.destroyBlock(block, 0);
      return true;
    }
    const color = block.type === BlockType.ARMORED ? 0x8a9099 : Palette.blocks[block.color];
    this.effects.shatter(hitPoint, color, 3, 0.6, [0.12, 0.26]);
    if (block.type === BlockType.ARMORED) this.effects.sparkBurst(hitPoint, 4, 6, [4, 3.6, 3, 1]);
    this.writeMatrix(block);
    this.flushMatrices();
    return false;
  }

  /** Destroys a block and queues its same-coloured neighbours (chain reaction). */
  destroyBlock(block, depth) {
    if (!block.alive) return;
    block.alive = false;
    block.chainAt = 0;
    const color = Palette.blocks[block.color];
    const center = tmp.set(block.x, this.size * 0.5, block.z);
    this.effects.explosion(center, depth > 0 ? 0.65 : 0.8, null, 0);
    this.effects.shatter(center, color, depth > 0 ? 10 : 16, 1, [0.2, 0.5]);
    if (block.type === BlockType.ARMORED) this.effects.shatter(center, 0x6f757e, 8, 1.2, [0.15, 0.3]);
    this.writeMatrix(block);
    this.flushMatrices();
    this.onBlockDestroyed?.(block, depth);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.cells.get(this.key(block.c + dc, block.r + dr));
      if (n && n.alive && n.drop <= 0 && !n.cargo && !block.cargo && n.color === block.color && n.chainAt === 0) {
        n.chainAt = GameConfig.blocks.chainDelay;
        n.chainDepth = depth + 1;
        this.chain.push(n);
      }
    }
  }

  update(dt) {
    let dirty = false;
    // Chain reaction: neighbours pop one after another.
    for (let i = this.chain.length - 1; i >= 0; i--) {
      const n = this.chain[i];
      n.chainAt -= dt;
      if (n.chainAt <= 0) {
        this.chain.splice(i, 1);
        if (n.alive) this.destroyBlock(n, n.chainDepth);
      }
    }
    // Acid: damage ticks every second, lime bubbles and drips all the time.
    this.acidTime += dt;
    this.acidMaterial.opacity = 0.28 + Math.sin(this.acidTime * 7) * 0.1;
    for (const l of this.blocks) {
      if (!l.alive || !l.acid) continue;
      l.acid.timer -= dt;
      if (Math.random() < dt * 9) {
        const top = this.size * (0.45 + 0.55 * Math.max(0, l.hp / l.maxHp));
        this.effects.fire.emit({
          x: l.x + rnd.spread(0.65), y: top + 0.05, z: l.z + rnd.spread(0.65), vy: rnd.range(0.3, 0.9),
          life: rnd.range(0.4, 0.7), size0: rnd.range(0.15, 0.3), size1: 0.03, color0: [0.7, 3.2, 0.5, 1], color1: [0.2, 1.2, 0.1, 0],
        });
      }
      if (l.acid.timer <= 0) {
        l.acid.timer += GameConfig.blocks.acidTick;
        const [lo, hi] = GameConfig.blocks.acidDamage;
        this.damage(l, lo + Math.random() * (hi - lo), tmp.set(l.x, this.size * 0.6, l.z));
        if (l.alive) {
          this.writeMatrix(l);
          dirty = true;
        }
      }
    }
    this.sparkleTimer = (this.sparkleTimer ?? 0) - dt;
    const sparkle = this.sparkleTimer <= 0;
    if (sparkle) this.sparkleTimer = 0.25;
    for (const l of this.blocks) {
      if (!l.alive) continue;
      if (l.flash > 0) {
        l.flash -= dt;
        l.mesh.setColorAt(l.slot, l.flash > 0 ? flashColor : white);
        dirty = true;
      }
      if (l.fall) {
        l.fall.t += dt;
        if (l.fall.t >= l.fall.dur) {
          l.fall = null;
          l.drop = 0;
          this.effects.snowPuff(tmp.set(l.x, 0.2, l.z), 6);
          this.effects.shatter(tmp.set(l.x, 0.3, l.z), 0xcfc4b0, 5, 0.5, [0.08, 0.16]);
        }
        this.writeMatrix(l);
        dirty = true;
      }
      // Supply blocks twinkle so they stand out.
      if (sparkle && l.type === BlockType.SUPPLY && !l.fall && rnd.chance(0.5)) {
        this.effects.fire.emit({
          x: l.x + rnd.spread(0.7), y: this.size + 0.05, z: l.z + rnd.spread(0.7), vy: rnd.range(0.4, 1),
          life: 0.6, size0: 0.25, size1: 0.02, color0: [4, 3.4, 1.4, 1], color1: [2, 1.4, 0.4, 0],
        });
      }
    }
    if (dirty) this.flushMatrices();
  }
}

/** Steel cage overlay for armored blocks: thick riveted frame + diagonal brace, transparent centre. */
function armorTexture() {
  const S = 128;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const steel = ctx.createLinearGradient(0, 0, S, S);
  steel.addColorStop(0, '#c9ced6');
  steel.addColorStop(1, '#6d737c');
  ctx.fillStyle = steel;
  const w = 20;
  ctx.fillRect(0, 0, S, w);
  ctx.fillRect(0, S - w, S, w);
  ctx.fillRect(0, 0, w, S);
  ctx.fillRect(S - w, 0, w, S);
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-S * 0.7, -6, S * 1.4, 12);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(w - 1.5, w - 1.5, S - 2 * w + 3, S - 2 * w + 3);
  ctx.strokeRect(1.5, 1.5, S - 3, S - 3);
  ctx.fillStyle = '#3a3e44';
  for (const [x, y] of [[10, 10], [S - 10, 10], [10, S - 10], [S - 10, S - 10], [S / 2, 10], [S / 2, S - 10], [10, S / 2], [S - 10, S / 2]]) {
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvasToTexture(canvas, { srgb: true });
}

/** Supply overlay: glowing golden frame with a star badge in the middle of each face. */
function supplyTexture() {
  const S = 128;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = '#ffd34a';
  ctx.lineWidth = 9;
  ctx.strokeRect(8, 8, S - 16, S - 16);
  ctx.strokeStyle = '#fff6c8';
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, S - 16, S - 16);
  ctx.fillStyle = '#ffd34a';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 34 : 14;
    ctx.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#7a4a00';
  ctx.lineWidth = 3;
  ctx.stroke();
  return canvasToTexture(canvas, { srgb: true });
}

/** Cargo overlay: white shipping label with a barcode, and "this way up" arrows. */
function cargoLabelTexture() {
  const S = 128;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  // Brown packing-tape band across the face.
  ctx.fillStyle = 'rgba(196, 150, 86, 0.95)';
  ctx.fillRect(0, S / 2 - 9, S, 18);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.fillRect(0, S / 2 - 9, S, 3);
  // Label.
  ctx.fillStyle = '#f7f3e8';
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 3;
  ctx.fillRect(70, 68, 46, 40);
  ctx.strokeRect(70, 68, 46, 40);
  ctx.fillStyle = '#1b1b1b';
  for (let i = 0; i < 11; i++) ctx.fillRect(74 + i * 3.6, 84, i % 3 === 0 ? 2.4 : 1.4, 18);
  ctx.fillRect(74, 72, 30, 4);
  // "This way up" arrows.
  ctx.fillStyle = '#1b1b1b';
  for (const x of [22, 40]) {
    ctx.beginPath();
    ctx.moveTo(x, 14);
    ctx.lineTo(x + 8, 26);
    ctx.lineTo(x + 3, 26);
    ctx.lineTo(x + 3, 38);
    ctx.lineTo(x - 3, 38);
    ctx.lineTo(x - 3, 26);
    ctx.lineTo(x - 8, 26);
    ctx.closePath();
    ctx.fill();
  }
  return canvasToTexture(canvas, { srgb: true });
}
