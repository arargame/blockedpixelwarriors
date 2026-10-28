/**
 * Gameplay and world layout constants. World units: 1 unit ~ one small voxel tile,
 * a destructible block is BLOCK_SIZE units wide. +Y is up, -Z is "forward" (away from camera).
 */
export const GameConfig = Object.freeze({
  board: Object.freeze({
    minX: -10.5,
    maxX: 7.5,
    minZ: -9,
    maxZ: 10.5,
    frameHeight: 1.35,
    frameWidth: 0.9,
  }),

  blockSize: 1.5,

  blocks: Object.freeze({
    hp: 5,
    // Armored blocks (steel cage) take ~3x the hits.
    armoredHp: 14,
    // Odds for each new block: 20% supply block (always drops a supply), 20% armored, rest normal.
    supplyChance: 0.2,
    armoredChance: 0.2,
    // Delay between links of a same-colour chain explosion (s).
    chainDelay: 0.09,
    // A cube shot off the train lands on the nearest free cell within this distance.
    maxDropDistance: 7,
    // Green gem acid: damage every `acidTick` seconds, random in [min, max] (block HP is 5).
    acidTick: 1,
    acidDamage: [1, 2],
  }),

  floor: Object.freeze({
    // Marble tiles: same size as a block so tiles line up with the block grid (12 x 13 tiles).
    tileSize: 1.5,
  }),

  track: Object.freeze({
    x: 3.0,
    startZ: -95,
    endZ: 55,
    gauge: 1.9,
  }),

  heli: Object.freeze({
    altitude: 2.7,
    speed: 10,
    accel: 4.5,
    // Yaw: max turn rate (rad/s) and yaw acceleration. When the stick points behind the nose
    // (more than reverseAngle away) the heli flies BACKWARDS keeping its heading, so you can
    // retreat while firing; reverseTurnRate 0 = never turn around on its own. To turn around,
    // steer sideways first (the nose follows A/D), then pull back.
    turnRate: 7,
    // Keyboard Q/E yaw speed (rad/s).
    keyTurnRate: 2.6,
    yawAccel: 16,
    reverseAngle: 1.75,
    reverseTurnRate: 0,
    maxHp: 100,
    fireInterval: 0.11,
    plasmaInterval: 0.32,
    rocketInterval: 1.6,
    // Default gun: single straight shots, alternating left/right pod.
    mainInterval: 0.13,
    // Smart aim: lock targets within this cone around the nose (rad) and range.
    aimCone: 0.3,
    aimRange: 18,
    // Power-up weapons (see PowerUps.js): T triple fire, D 8-way burst, R homing rockets.
    tripleInterval: 0.28,
    burstInterval: 0.42,
    burstRange: 10,
    homingInterval: 0.22,
    homingRange: 12,
    // Heli can roam the board interior minus a margin.
    margin: 1.4,
  }),

  train: Object.freeze({
    speed: 3.2,
    wagonCount: 6,
    respawnDelay: 4,
    turretFireInterval: 1.4,
    // Per-trip speed plan: FAST trips never stop; NORMAL / SLOW may halt once on the board.
    fastChance: 0.3,
    slowChance: 0.3,
    fastMul: 1.9,
    slowMul: 0.55,
    stopChance: 0.65,
    stopDuration: 3,
    // Turret fire interval multiplier while halted (lower = faster fire).
    stoppedFireMul: 0.4,
    // Brass under-cannons: a random one fires a round cannonball straight along its barrel
    // (not aimed) every 1.2-2.8 s.
    cannonIntervalMin: 1.2,
    cannonIntervalMax: 2.8,
    // Twin turret bullets: damage per bullet (2 per volley).
    turretBulletDamage: 4,
    // While any turret lives the gem is shielded: damage taken is multiplied by this.
    gemShieldMul: 0.05,
    // A destroyed train accelerates out of the scene.
    wreckSpeed: 14,
    wreckAccel: 6,
    // Ramming the train costs this much heli HP (then a short invulnerability with flicker).
    collisionDamage: 25,
    // Chance per empty cell right of the track that the passing train restocks it.
    restockChance: 0.6,
    // Head position of the locomotive in the poster frame (gem at the key-art spot).
    posterHeadZ: 2.8,
  }),

  /**
   * Logistics: the engineer's forklift gathers the cargo cubes shot off the train and lines them up
   * as gift packages in the dock column (leftmost); the CH-47F cargo chopper collects them.
   */
  logistics: Object.freeze({
    dockCol: 0,
    forkliftSpeed: 3.4,
    // Cargo chopper visit period (s) and the mission goal per box colour.
    chinookInterval: 120,
    goal: Object.freeze({ red: 100, green: 100, blue: 100 }),
  }),

  /** Upgrade cards (src/ui/UpgradeCards.js). */
  cards: Object.freeze({
    // Seconds after a train is destroyed before the cards come up.
    offerDelay: 1.6,
    // GEM MINE: chance that an ordinary destroyed block drops a gem.
    gemDropChance: 0.14,
    // The first offers always include the first of these the player hasn't taken yet (the mission
    // needs the cargo chopper and the engineer).
    guaranteedOffers: 2,
    mustHave: Object.freeze(['cargoChopper', 'engineer']),
    // SURPRISE EGG: balls per wave when the board is empty, wait between waves, supply chance per ball.
    eggCount: 3,
    eggCooldown: 4,
    eggSupplyChance: 0.2,
  }),

  supply: Object.freeze({
    // Supplies come from supply blocks (GameConfig.blocks.supplyChance); the type is uniform
    // over all entries in POWERUPS (5 types: T, D, R, H, G = 20% each).
    durationMin: 8,
    durationMax: 15,
    // 3D distance to the heli at which a supply is collected.
    pickupRadius: 1.25,
    crateLifetime: 18,
    // Magnet (same feel as Blocked: radius ~30% of the board width, constant pull + damping).
    magnetRadius: 5.2,
    magnetAccel: 30,
    magnetDamping: 1.05,
    // H: health restored. G: damage multiplier while the gem colour is active.
    healAmount: 35,
    gemDamageMul: 1.25,
  }),

  mines: Object.freeze({
    count: 3,
    speed: 1.6,
    radius: 0.62,
    damage: 18,
  }),

  camera: Object.freeze({
    // Tuned against the key art with tools/overlay.mjs: wide lens from the near-left, yawed right,
    // plus a barrel lens distortion that bends the frame like the poster's wide-angle look.
    fov: 60,
    position: Object.freeze([-8.6, 11.7, 13.8]),
    pitchDeg: 42,
    yawDeg: 19,
    rollDeg: 0,
    lensK: 0.18,
    // Backdrop (sky/islands) is seen this many degrees shallower than the board.
    backdropTiltDeg: 17,
    // Key-art pixel (1672x941) where the helicopter sits when the camera is at `position`.
    heliScreen: Object.freeze([850, 690]),
    followStrength: 0.2,
  }),
});
