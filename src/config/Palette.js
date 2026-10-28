/**
 * Central color palette. All art colors live here so the look can be tuned
 * from one place (values are sRGB hex, Three converts them to linear).
 */
export const Palette = Object.freeze({
  // Destructible voxel blocks (saturated candy colors from the key art).
  blocks: Object.freeze({
    red: 0xe01d22,
    green: 0x36c225,
    teal: 0x0ea2a8,
    yellow: 0xf6bd10,
  }),

  snow: 0xffffff,
  snowShade: 0xd7ecff,

  // Attack helicopter.
  heliGreen: 0x2e4a30,
  heliGreenDark: 0x1b2d1c,
  heliGreenLight: 0x44673f,
  heliOlive: 0x55682c,
  heliGunmetal: 0x3b4046,
  heliGlass: 0x10202e,
  heliStar: 0xf4f4ee,

  // Armored train.
  trainBody: 0x5c6067,
  trainBodyLight: 0x9a9fa6,
  trainDark: 0x3c3f45,
  trainBlack: 0x26292e,
  trainRed: 0xd31f1c,
  trainGlow: 0xff1424,
  trainBrass: 0xc9973d,

  // Environment.
  wood: 0xd8a465,
  woodDark: 0xa8733c,
  rail: 0x8e949b,
  sleeper: 0x6b4a2f,
  gravel: 0x7d776f,
  rock: 0xa49a88,
  rockDark: 0x6e675d,
  grass: 0x6db83a,
  grassDark: 0x4a8a2a,
  pine: 0x2a5e2a,
  pineDark: 0x173d1c,
  pineLight: 0x5c9a36,
  trunk: 0x6a4527,

  skyTop: 0x1456c8,
  skyMid: 0x3f97ee,
  skyHorizon: 0xb9defc,
  cloudSea: 0xcfe2f6,
  fog: 0xd8eeff,

  plasma: 0xff3cf0,
  tracer: 0xffb347,
  fire: 0xff8a1e,
});

/** Ordered list of block color keys, used for random picks. */
export const BLOCK_COLOR_KEYS = Object.freeze(['red', 'green', 'teal', 'yellow']);
