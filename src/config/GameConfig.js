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
    // The rails continue far up the line (stage 2 terrace, the Block Hauler's approach).
    meshStartZ: -205,
    gauge: 1.9,
    // How much snow piles up between the rails (1 = the original drifts).
    railSnow: 0.1,
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
    // The train grows by one wagon every `growEvery` waves (wave 1: 6, wave 2: 7, ...), up to maxWagons.
    growEvery: 1,
    maxWagons: 14,
    respawnDelay: 4,
    // A train comes in from just off screen and its trip ends as soon as it has left the screen.
    // Visible part of the line relative to the camera z (measured with the key-art camera), plus
    // a margin so the train starts / ends out of sight.
    viewBottom: -1.2,
    viewTop: -53.1,
    viewMargin: 3,
    // Wait between leaving the screen and coming back: this share of what it used to be (the old
    // trips ran on out of sight to the end of the line, then waited respawnDelay).
    returnFactor: 0.8,
    // "Train incoming" warning (toast + edge marker) this many seconds before it comes in.
    warnLead: 2.5,
    // Cargo cubes drop onto what is below when a cube under them is shot away (car units / s^2).
    cargoGravity: 30,
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
    goal: Object.freeze({ red: 20, green: 20, blue: 20 }),
  }),

  /**
   * Stages. 1 "Depot": the board above (ship the packages). Then the camera follows the heli up
   * the tracks over a trestle bridge to stage 2 "Terrace": a wide platform with balconies on
   * both sides of the railway, a checkpoint at its entrance and the BLOCK HAULER train.
   */
  stages: Object.freeze({
    terrace: Object.freeze({ minX: -15, maxX: 21, minZ: -84, maxZ: -58, frameHeight: 1.35, frameWidth: 0.9 }),
    // Checkpoint gate over the bridge just before the terrace (heli flies through it).
    checkpoint: Object.freeze([3, -55.5]),
    // Cubes shot off a train up here bounce onto the terrace and break open: this share leaves a
    // supply crate (weapons, repair kit...).
    dropSupplyChance: 0.6,
    // Clusters of shootable blocks already waiting on the terrace when stage 2 starts.
    terraceBlocks: 14,
    // Exactly one cargo cube in this many (counted over every train on the terrace) is a CRT
    // comm device; stage 2 asks for crtGoal of them.
    crtEvery: 100,
    crtGoal: 15,
    // Block Hauler line: comes from far beyond the terrace, leaves behind the camera.
    haulerPath: Object.freeze({ startZ: -200, endZ: -20 }),
    // Swinging wrecking balls: hit damage, chain length (train units), crane cab HP.
    ballDamage: 20,
    chainLength: 2.3,
    craneHp: 24,
    saveKey: 'bpw.checkpoint',
  }),

  /** Tank level (src/tank/): the player's Blender tank (driving, turret, shells, follow camera). */
  tank: Object.freeze({
    speed: 7,              // forward top speed (units / s)
    reverseMul: 0.6,
    accel: 9,
    brake: 14,
    turnSpeed: 1.6,        // hull turn rate (rad / s)
    turretSpeed: 2.4,      // turret traverse (rad / s)
    reload: 0.5,           // seconds between shots
    recoilKick: 7.5,       // barrel kick-back speed on a shot (units / s)
    recoilSpring: 140,
    recoilDamping: 15,
    shellSpeed: 52,
    shellRange: 60,
    blinkHz: 1.4,          // tail / amber lamp blink rate
    bounds: 90,            // half size of the drivable range
    // Follow camera: z = tank z * follow - back, looking `ahead` up the channel (the drain stays in view).
    camera: Object.freeze({ height: 40, back: 28, follow: 0.5, ahead: 44, fov: 46 }),
    shellDamage: 1,
    // Direct fire: the barrel depresses / elevates toward the locked block (rad, rad/s).
    elevationMin: -0.36,
    elevationMax: 0.12,
    elevationSpeed: 1.4,
    // Smart aim (like the heli): within this cone around the turret's aim direction the best
    // block is locked (reticle) and the shell flies straight at its centre.
    aimCone: 0.32,
    lockRefresh: 0.12,
    // Auto aim: the turret swings onto the best block by itself (swing angle weighs autoSwingWeight
    // per rad against 0.3 per unit of distance; the current lock gets an autoKeep bonus) and fires
    // once within autoFireAngle of it. Q / E take over; manualHold s after release the auto lock
    // resumes from where the gun points.
    autoSwingWeight: 5,
    autoKeep: 4,
    autoFireAngle: 0.07,
    manualHold: 0.35,
    // Armour (the fighter's guns and bombs are the only things that hurt the tank).
    hp: 100,
    // R power-up: homing missiles (like the heli's), launched off the turret at this interval.
    homingInterval: 0.42,
    homingRange: 44,
    missileSpeed: 14,
    missileDamage: 2,
  }),

  /**
   * The Blocked Pixel Panzer fighter (src/combat/JetFighter.js, Blender model fighter.glb): a
   * strafing pass every 7-20 s, 3-4 s of machine-gun fire, then a bomb aimed at the tank.
   */
  fighter: Object.freeze({
    scale: 1.8,
    altitude: 15,
    dive: 4,               // the attack run dips this much lower
    speed: 21,
    approach: 105,         // starts this far before the pass point, leaves this far after it
    exit: 110,
    passOffset: 1.5,       // how far from the tank the pass point may be
    gapMin: 7,
    gapMax: 20,
    firstDelay: 9,
    hp: 6,
    hitRadius: 3.4,
    strafeMin: 3,
    strafeMax: 4,
    fireRate: 11,          // rounds per second (both wing packs alternate)
    bulletSpeed: 62,
    bulletDamage: 0.7,
    spread: 1.8,           // aim scatter round the tank (units)
    bombGravity: 18,
    bombRadius: 5.5,
    bombDamage: 30,        // at the centre of the blast, falling off with the distance
  }),

  /**
   * Tank level arena (src/tank/): a sloped concrete channel with shallow flowing water. Trains
   * cross the rail at the far end and drop blocks into its lanes; the blocks slide down at a
   * constant speed (pushing each other) and fall over the dam lip into the oval drain basin.
   * Phase 1: 1000 blocks come, break 900 of them; 100 in the drain loses.
   */
  tankArena: Object.freeze({
    block: 2.0,            // lane / block size
    lanes: 13,             // channel width = lanes * block
    topZ: 64,              // far end of the channel (blocks land just below it)
    slope: 0.03,           // floor rise per unit of z
    slideSpeed: 1.15,      // constant downhill speed of the blocks
    railZ: 69,             // rail across the far end
    trainSpeed: 9,
    trainGap: 2.5,         // seconds between trains
    trainCars: [4, 6],     // cargo wagons per train
    dropChance: 0.45,      // a wagon drops a block over a lane with this chance (gaps otherwise)
    doubleChance: 0.25,    // ... two blocks back to back
    phaseBlocks: 1000,
    breakGoal: 900,
    drainLimit: 100,
    // Block types: weak (1 hit), normal, strong (steel cage), supply (star, drops a power-up).
    hp: Object.freeze({ weak: 1, normal: 2, strong: 4, supply: 2 }),
    odds: Object.freeze({ weak: 0.3, strong: 0.18, supply: 0.08 }),
    chainDelay: 0.09,
    // Drain basin: an oval pit below the dam lip.
    drain: Object.freeze({ z: -6.2, rx: 14, rz: 5.2, depth: 5, water: 1.2 }),
    powerTime: 12,         // seconds a T / D / R power-up lasts
    // The way in and out (src/tank/TankArena.js). The camera looks up the channel (+z), so +x is
    // the screen's LEFT: a round base among the trees at the bottom left (+x), a dirt road into a
    // gap in the left wall; a gap in the right wall (-x) with a fence gate that opens when phase 1
    // is won, a road on to phase 2.
    // The land round the channel lies higher than the water: a concrete ramp runs down from road
    // level through each wall gap (rampLength long, outside the wall).
    groundY: 2.3,
    rampLength: 10,
    gap: Object.freeze({ z0: 2.2, z1: 11.4 }),
    base: Object.freeze({ x: 48, z: 4, r: 10 }),
    roadWidth: 9.5,
    roadIn: Object.freeze([[24.6, 6.8], [30, 6.6], [35, 5.6], [39.5, 4.6]]),
    roadOut: Object.freeze([[-24.6, 6.8], [-30, 7.2], [-38, 9.4], [-48, 13], [-60, 16], [-80, 20], [-105, 22], [-140, 25]]),
    phase2X: 58,           // driving this far out along the way out (-x) ends phase 1
    // Skill cards (UpgradeCards.js, level 'tank'): one pick every `cardEvery` broken blocks.
    cardEvery: 200,
  }),

  /** Upgrade cards (src/ui/UpgradeCards.js). */
  // Scenario 03 NEON RAIN: the tank in a wooden toy tray on a wet desk by a rainy window at
  // midnight (the key art, assets/textures/menu/night.jpg). A wall of coloured blocks rolls
  // toward the tank and the colour wheel (Blocked's casino wheel) picks the shell colour. Field
  // and tray: keep in step with tools/blender/build_night_desk.py.
  night: Object.freeze({
    cols: 12,
    block: 1.5,
    minX: -9,
    maxX: 9,
    minZ: -6,
    maxZ: 9,
    // Where the tank may drive (its hull stays inside) and the line the wall must not cross.
    // The tank drives anywhere on the tray; the blocks are solid (NightLevel.canStand / collideTank).
    tankZone: Object.freeze({ minX: -9, maxX: 9, minZ: -5.9, maxZ: 9 }),
    deadline: -0.9,
    tankScale: 0.42,
    // The wall: rows of `cols` blocks, `startRows` on the field at the start; it rolls toward the
    // tank at `speed` m/s (+ `speedGrowth` per broken block, up to `speedMax`) and a new row rises
    // at the top whenever there is room, `totalRows` in all.
    startRows: 4,
    totalRows: 42,
    speed: 0.09,
    speedGrowth: 0.0004,
    speedMax: 0.26,
    // Every block has `blockHp`; a shell of the block's colour deals `matchDamage` (one shot),
    // a plain (black wedge) or wrong-colour shell `plainDamage`. A destroyed block takes its
    // same-coloured neighbours (up / down / left / right) with it (`chainDelay` s apart).
    blockHp: 3,
    matchDamage: 3,
    plainDamage: 1,
    chainDelay: 0.06,
    goal: 360,
    // A row reaching the deadline breaks on the tank's line: `breachDamage` armour per block.
    breachDamage: 4,
    // Colour wheel ammo: plain shells are endless, colours start with `startAmmo`, a gem adds
    // `gemAmmo`.
    startAmmo: 10,
    gemAmmo: 8,
    gemChance: 0.16,
    shellSpeed: 40,
    reload: 0.42,
    // Supplies (as in the heli level): a broken block drops a T or D crate now and then.
    //   T  TRIPLE FIRE  every shot goes out three ways (spread `tripleSpread` rad)
    //   D  8-WAY BURST  plasma orbs fly out all round the tank every `burstInterval` s
    // Each runs for GameConfig.supply.durationMin..durationMax s.
    supplyChance: 0.045,
    tripleSpread: 0.26,
    burstInterval: 0.42,
    // Spike mines rolling out of the wall now and then (the key art's black balls).
    mine: Object.freeze({ first: 14, every: [11, 20], speed: 1.1, hp: 3, damage: 12, radius: 0.95 }),
  }),

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
    // FLICKER: post-hit invulnerability (flicker) x2. RUSH DELIVERY: chopper interval x0.7.
    flickerMul: 2,
    cargoTimeMul: 0.7,
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
    // No roaming balls at the start: they only come from the SURPRISE EGG card.
    count: 0,
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
