/**
 * NEON RAIN's colours, after Blocked (AIRepos/Blocked: GDD 4.1-4.3, DIAMONDS_SYSTEM.md,
 * LevelManager.SpawnRow):
 *
 * blocks   red, green, blue, yellow and beige - Blocked's block colours (60 % red / green / blue /
 *          yellow, the rest also beige). A shell of the block's own colour does double damage.
 * shells   the colour wheel: WHITE is the normal shot (endless); the other four cost one round each
 *          and are refilled by gems:
 *            white  NORMAL    1 damage
 *            red    POWER     5 damage (a heavy red beam)
 *            green  ACID      2 damage, the block turns green and keeps losing HP for a while
 *            blue   RAPID     3 damage, the gun fires twice as fast
 *            black  CRITICAL  10 damage (a black wedge; its skull shot glows violet)
 *                              - the skull shot, "CRITICAL!" and a little screen shake
 */
export const NIGHT_BLOCKS = Object.freeze({
  red: 0xe01d22,
  green: 0x36c225,
  blue: 0x2a9ff2, // light blue (Blocked's wheel), not navy
  yellow: 0xf6bd10,
  beige: 0xd9c49a,
});
export const NIGHT_BLOCK_KEYS = Object.freeze(Object.keys(NIGHT_BLOCKS));

/**
 * Wheel order and what each shell does. `block`: the block colour it matches (x2); `wedge`: the
 * Blender wedge standing for it (the white shell sits in the old amber wedge, recoloured);
 * `gem`: ammo a gem of that colour gives (Blocked: blue 80, the others 20; a rare acid gem 80).
 */
export const SHELL_COLORS = Object.freeze([
  Object.freeze({ id: 'white', infinite: true, block: null, hex: 0xf4f6fb, chip: 0xe9edf4, name: 'NORMAL', wedge: 'yellow', damage: 1 }),
  Object.freeze({ id: 'red', block: 'red', hex: NIGHT_BLOCKS.red, chip: NIGHT_BLOCKS.red, name: 'POWER', wedge: 'red', damage: 5, gem: 20 }),
  Object.freeze({ id: 'green', block: 'green', hex: NIGHT_BLOCKS.green, chip: NIGHT_BLOCKS.green, name: 'ACID', wedge: 'green', damage: 2, acid: true, gem: 20 }),
  Object.freeze({ id: 'blue', block: 'blue', hex: NIGHT_BLOCKS.blue, chip: NIGHT_BLOCKS.blue, name: 'RAPID', wedge: 'blue', damage: 3, rate: 2, gem: 80 }),
  Object.freeze({ id: 'black', block: null, hex: 0x8a4cff, chip: 0x0d0d10, name: 'CRITICAL', wedge: 'black', damage: 10, critical: true, gem: 20 }),
]);

export const shellOf = (id) => SHELL_COLORS.find((c) => c.id === id);

/** Gem colours (the wheel's ammo colours). */
export const GEM_COLORS = Object.freeze(SHELL_COLORS.filter((c) => !c.infinite).map((c) => c.id));

/** Display colour of a gem / ammo colour (black gems glow violet). */
export const gemHex = (id) => (id === 'black' ? 0x6a3cff : shellOf(id)?.hex ?? 0xffffff);
