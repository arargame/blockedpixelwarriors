/**
 * Base class of everything the player shoots at (Template Method): the armored train / Block
 * Hauler, the board and channel blocks, the fighter plane. Subclasses override the hooks:
 *
 *   isAlive()          still a valid target
 *   aimPoint(out)      world point weapons aim at (smart aim, homing missiles)
 *   onDamaged(a, at)   feedback for a hit that did not kill
 *   onDeath(at)        explosion / drops / score (called once)
 *
 * `harmsPlayer` says whether the enemy can hurt the player at all: blocks are targets only (they
 * never damage the heli or the tank), trains and the fighter shoot back.
 */
export class Enemy {
  constructor({ hp = 1, harmsPlayer = false, kind = 'enemy' } = {}) {
    this.hp = hp;
    this.maxHp = hp;
    this.alive = true;
    this.harmsPlayer = harmsPlayer;
    this.kind = kind;
  }

  isAlive() {
    return this.alive;
  }

  /** @param {import('three').Vector3} out */
  aimPoint(out) {
    return out;
  }

  /** Applies damage; returns true when this hit killed the enemy. */
  takeDamage(amount, at = null) {
    if (!this.isAlive()) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.alive = false;
      this.onDeath(at);
      return true;
    }
    this.onDamaged(amount, at);
    return false;
  }

  onDamaged() {}

  onDeath() {}

  update() {}

  /** Homing-missile target adapter ({alive(), position(out)}) used by the projectile systems. */
  asTarget() {
    this.target ??= { alive: () => this.isAlive(), position: (out) => this.aimPoint(out) };
    return this.target;
  }
}
