/**
 * Generic object pool: acquire() hands out a recycled instance (or a new one from the factory),
 * release() returns it. Projectiles, channel blocks and enemy bullets come from pools so a long
 * fight does not churn the garbage collector.
 */
export class ObjectPool {
  /**
   * @param {() => any} factory
   * @param {number} [prewarm] instances created up front
   */
  constructor(factory, prewarm = 0) {
    this.factory = factory;
    this.free = [];
    this.created = 0;
    for (let i = 0; i < prewarm; i++) this.free.push(this.make());
  }

  make() {
    this.created += 1;
    return this.factory();
  }

  acquire() {
    return this.free.pop() ?? this.make();
  }

  release(obj) {
    this.free.push(obj);
  }

  get available() {
    return this.free.length;
  }
}
