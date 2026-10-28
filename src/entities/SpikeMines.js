import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { Random } from '../util/Random.js';

/**
 * Rolling spiked iron balls that wander the board floor. They bounce off the
 * frame and blocks, can be shot (they respawn later) and hurt the helicopter
 * only when it hovers right above them... they are mostly ambient hazards that
 * reward clean shooting.
 */
export class SpikeMines {
  constructor(materials, board, blockField, effects) {
    this.board = board;
    this.blockField = blockField;
    this.effects = effects;
    this.group = new THREE.Group();
    this.mines = [];
    const rng = new Random(5);
    const cfg = GameConfig.mines;
    const geometry = this.buildGeometry(cfg.radius);
    this.geometry = geometry;
    this.material = materials.ironBall();
    const spawnPoints = [
      [-8.25, 2.3],
      [-1.8, 3.8],
      [-3.6, 6.4],
    ];
    for (let i = 0; i < cfg.count; i++) {
      const mesh = new THREE.Mesh(geometry, materials.ironBall());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const [x, z] = spawnPoints[i % spawnPoints.length];
      const angle = rng.range(0, Math.PI * 2);
      const mine = {
        mesh,
        pos: new THREE.Vector3(x, cfg.radius, z),
        vel: new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(cfg.speed),
        hp: 5,
        alive: true,
        respawn: 0,
        home: new THREE.Vector3(x, cfg.radius, z),
      };
      mesh.position.copy(mine.pos);
      this.group.add(mesh);
      this.mines.push(mine);
    }
  }

  buildGeometry(radius) {
    // Chunky rounded "cube-sphere" so the cracked plate texture maps cleanly on six faces.
    const core = new THREE.BoxGeometry(1, 1, 1, 6, 6, 6);
    const pos = core.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const len = v.length();
      v.normalize().multiplyScalar(radius * (0.82 + 0.18 * Math.min(1, len / 0.75)));
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    core.computeVertexNormals();
    return core;
  }

  /**
   * SURPRISE EGG card: `count` extra balls drop out of the sky onto free floor spots, bounce and
   * start rolling around like the others. They don't respawn; shot down they may drop a supply.
   */
  dropEggs(count, isFree) {
    const cfg = GameConfig.mines;
    const b = this.board.bounds;
    const r = cfg.radius;
    let made = 0;
    for (let tries = 0; tries < 200 && made < count; tries++) {
      const x = b.minX + 2 + Math.random() * (b.maxX - b.minX - 4);
      const z = b.minZ + 2 + Math.random() * (b.maxZ - b.minZ - 4);
      if (this.isTrack(x) || this.blockField.blockAt(x, 0.5, z) || !isFree(x, z)) continue;
      if (this.mines.some((m) => m.alive && Math.hypot(m.pos.x - x, m.pos.z - z) < 2.5)) continue;
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const angle = Math.random() * Math.PI * 2;
      const mine = {
        mesh,
        pos: new THREE.Vector3(x, 14 + made * 2.5, z),
        vel: new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(cfg.speed),
        vy: 0,
        falling: true,
        hp: 5,
        alive: true,
        egg: true,
        respawn: 0,
        home: new THREE.Vector3(x, r, z),
      };
      mesh.position.copy(mine.pos);
      this.group.add(mesh);
      this.mines.push(mine);
      made++;
    }
    return made;
  }

  /** Balls from the sky still alive (falling or rolling). */
  get eggsAlive() {
    return this.mines.filter((m) => m.egg && m.alive).length;
  }

  /** Removes all sky balls (new run). */
  clearEggs() {
    for (const m of this.mines) if (m.egg) m.mesh.removeFromParent();
    this.mines = this.mines.filter((m) => !m.egg);
  }

  update(dt) {
    const r = GameConfig.mines.radius;
    for (const m of this.mines) {
      if (m.alive && m.falling) {
        // Drop out of the sky, spinning; bounce twice, then roll off.
        m.vy -= 22 * dt;
        m.pos.y += m.vy * dt;
        m.mesh.rotation.x += dt * 4;
        if (m.pos.y <= r) {
          m.pos.y = r;
          if (Math.abs(m.vy) > 4) {
            this.effects.snowPuff(m.pos, 10);
            this.effects.shatter(m.pos, 0xcfc4b0, 6, 0.6, [0.08, 0.16]);
            m.vy = -m.vy * 0.38;
          } else {
            m.vy = 0;
            m.falling = false;
          }
        }
        m.mesh.position.copy(m.pos);
        continue;
      }
      if (!m.alive) {
        if (m.egg) continue;
        m.respawn -= dt;
        if (m.respawn <= 0) {
          m.alive = true;
          m.hp = 5;
          m.pos.copy(m.home);
          m.mesh.visible = true;
          this.effects.snowPuff(m.pos, 6);
        }
        continue;
      }
      const next = m.pos.clone().addScaledVector(m.vel, dt);
      const b = this.board.bounds;
      if (next.x < b.minX + r || next.x > b.maxX - r || this.blockField.blockAt(next.x, 0.5, m.pos.z) || this.isTrack(next.x)) m.vel.x *= -1;
      if (next.z < b.minZ + r || next.z > b.maxZ - r || this.blockField.blockAt(m.pos.x, 0.5, next.z)) m.vel.z *= -1;
      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);
      // Roll: rotate around the axis perpendicular to the velocity.
      const speed = m.vel.length();
      if (speed > 0) {
        const axis = new THREE.Vector3(m.vel.z, 0, -m.vel.x).normalize();
        m.mesh.rotateOnWorldAxis(axis, (speed * dt) / r);
      }
    }
  }

  isTrack(x) {
    return Math.abs(x - GameConfig.track.x) < 1.6;
  }

  /** @returns {object|null} */
  hitTest(point) {
    const r = GameConfig.mines.radius + 0.15;
    for (const m of this.mines) {
      if (m.alive && !m.falling && m.pos.distanceToSquared(point) < r * r) return m;
    }
    return null;
  }

  damage(mine, amount, hitPoint) {
    mine.hp -= amount;
    this.effects.impact(hitPoint, [3, 3, 3.4, 1]);
    if (mine.hp <= 0) {
      mine.alive = false;
      mine.mesh.visible = false;
      mine.respawn = 12;
      if (mine.egg) mine.mesh.removeFromParent();
      this.effects.explosion(mine.pos, 1.0, 0x55585e, 10);
      return true;
    }
    return false;
  }
}
