/**
 * Scenario 03 NEON RAIN: where everything sits, measured off the key art
 * (assets/textures/menu/night.jpg, 1672 x 941) - one table for the game and the comparison
 * tools (tools/night/*). World units: the tray field is 18 x 15 (12 x 10 blocks of 1.5); three.js
 * axes, the camera looks toward +z, screen right is -x; the deck of the tray is y = 0 and the desk
 * top y = -0.32.
 *
 * camera   solved from the four inner corners of the tray's beam tops in the art (OpenCV
 *          solvePnP with the field 18 x 15 and the beams' top at y = 1.05): position,
 *          orientation (with the art's slight dutch roll) and vertical field of view
 * props    the desk pieces (night_desk.glb / color_wheel.glb / gem.glb node names): position of
 *          the piece's origin, rotation about y (or a quaternion), uniform scale; measured by
 *          projecting the art's pixels back onto the desk
 * poster   the key-art moment: block layout (rows top to bottom, columns screen-left to right:
 *          R G T Y, . = empty), loose cubes, the mines, the gem, the tank
 */
export const NIGHT_CAMERA = Object.freeze({
  position: Object.freeze([0.1685, 26.915, -18.1358]),
  quaternion: Object.freeze([-0.035874, 0.894539, 0.444841, 0.025081]),
  fov: 28.391,
});

export const DESK_Y = -0.32;

export const NIGHT_PROPS = Object.freeze([
  { name: 'DeskLamp', pos: [15.015, DESK_Y, 8.563], rotY: 0, scale: 1 },
  // The mug and the crates are fitted to the art from its camera (the art draws them from a
  // lower eye point than the tray's, so they lean back to read as drawn): `quat` (x, y, z, w)
  // replaces rotY.
  { name: 'Mug', pos: [13.537, 0.674, 1.901], quat: [0.225, 0.2551, 0.1853, 0.9219], scale: 0.99 },
  { name: 'CrateStack', pos: [-14.835, 0.087, 2.092], quat: [0.0633, -0.5021, -0.1079, 0.8557], scale: 1 },
  // (The sketch on the paper is baked for exactly this transform.)
  { name: 'SketchPaper', pos: [-12.13, DESK_Y, -7.78], rotY: -0.73, scale: 1 },
  { name: 'Pencil', pos: [-18.83, -0.316, -0.41], rotY: 0.5, scale: 1 },
  // Pothos in a wooden planter behind the crates (top right, out of focus).
  { name: 'PlantBox', pos: [-13.55, DESK_Y, 8.04], rotY: 0.5, scale: 0.5, layer: 'fore' },
  // Foreground plant at the bottom left, out of focus (blurred layer).
  { name: 'Plant', pos: [12.8, DESK_Y, -5.8], rotY: 2.2, scale: 0.72, layer: 'fore' },
]);

/**
 * The colour wheel lies flat on the desk right of the tray, its face to the sky like the board's,
 * clear of the beam (nearest rim x -10.94, the beam's outer face is at -10.25); the puck's flat
 * bottom (model y -0.62) rests on the desk top. `radius` is the bezel's outer radius in world
 * units (the model is scaled to it).
 */
export const NIGHT_WHEEL = Object.freeze({ pos: [-12.55, 0.4007, -1.65], tiltX: 0, rotY: 0, radius: 1.61 });

/** Cubes lying on the desk round the tray (colour, x, z, size, rotation about y). */
export const DESK_CUBES = Object.freeze([
  ['green', 11.6, 7.6, 1.3, 0.25],
  ['red', -11.1, 1.9, 1.05, 0.4],
  ['teal', -11.0, 3.3, 0.8, 0.1],
  ['green', -9.6, -3.0, 0.55, 0.6],
]);

/** Window behind the desk (bokeh city), as a backdrop plane. */
export const NIGHT_WINDOW = Object.freeze({ z: 11.6, width: 90, height: 11, bottom: DESK_Y });

/** The key-art moment (poster / comparison): rows top (z = 8.25) to bottom, columns screen left (x = +8.25) to right. */
export const NIGHT_POSTER = Object.freeze({
  rows: Object.freeze([
    'RGYYGRTGYTRG',
    'YTGGYTGRTTYY',
    'TRYYRT.RGTRR',
    'RT.Y......GG',
    'TT.......YTG',
    'TY........TR',
    'Y..........R',
    'R...........',
    '............',
    '............',
  ]),
  // Loose cubes knocked about the field: colour, x, y, z, size, rotation (x, y, z).
  loose: Object.freeze([
    ['yellow', 8.4, 0.0, -5.0, 1.45, [0, 0.35, 0]],
    ['teal', 6.8, 0.0, -5.7, 1.2, [0, 0.2, 0]],
    ['green', 4.3, 0.0, -5.4, 1.15, [0, -0.3, 0]],
    ['green', 7.1, 0.0, -4.4, 1.0, [0, 0.5, 0]],
    ['yellow', 4.2, 1.6, 4.0, 1.3, [0.5, 0.6, 0.3]],
    ['yellow', -3.9, 1.2, 4.1, 1.2, [0.4, 0.9, 0.2]],
    ['red', 6.7, 0.9, 2.9, 0.8, [0.6, 0.2, 0.9]],
    ['red', -7.8, 0.0, -0.4, 1.25, [0, 0.3, 0]],
    ['green', -7.2, 0.0, 1.1, 0.7, [0, 0.8, 0]],
    ['teal', 3.4, 0.0, 2.2, 0.55, [0, 0.4, 0]],
    ['red', 2.9, 0.4, 3.6, 0.5, [0.3, 0.4, 0.2]],
    ['green', 3.0, 0.0, 1.6, 0.5, [0, 0.2, 0]],
    ['teal', 6.9, 0.0, -1.8, 0.7, [0, 0.6, 0]],
  ]),
  mines: Object.freeze([[6.06, -0.57], [-6.98, -3.33]]),
  // Shots and blasts, art px projected to world (x, z) at the shot height y = 1.1.
  orbs: Object.freeze([[1.45, 1.97], [-1.16, 1.93], [0.01, 0.66], [2.22, 0.1], [-2.14, -0.28], [-4.84, -0.24], [1.42, -1.12], [-1.34, -1.33]]),
  // Flak comets: x, z, size (art widths 99, 57, 44, 81, 136 px).
  comets: Object.freeze([[4.1, -1.06, 1.23], [2.13, -2.79, 0.72], [-1.48, -3.2, 0.55], [-3.22, -2.21, 1.02], [-4.37, -4.93, 1.7]]),
  // Blocks blowing apart: x, y, z, size, shard colour (art cores at px (1210, 345) and (430, 465)).
  bursts: Object.freeze([[-7.13, 1.4, 3.23, 1.1, 'red'], [6.74, 1.6, 1.88, 0.95, 'yellow']]),
  gem: Object.freeze({ color: 'red', x: -3.2, z: 0.9 }),
  tank: Object.freeze({ x: 0.2, z: -3.3, heading: 0 }),
});
