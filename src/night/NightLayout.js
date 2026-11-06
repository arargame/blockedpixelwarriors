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
 *          the piece's origin, rotation about y, uniform scale; measured by projecting the art's
 *          pixels back onto the desk
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
  { name: 'DeskLamp', pos: [15.0, DESK_Y, 8.4], rotY: 0, scale: 0.75 },
  { name: 'Mug', pos: [12.5, DESK_Y, 2.4], rotY: 0.54, scale: 1 },
  { name: 'Crate', pos: [-14.1, DESK_Y, 2.7], rotY: 0.22, scale: 1 },
  { name: 'Crate', pos: [-16.2, DESK_Y, 7.4], rotY: -0.08, scale: 1.3 },
  { name: 'SketchPaper', pos: [-12.4, DESK_Y + 0.01, -6.0], rotY: 0.3, scale: 1 },
  { name: 'Pencil', pos: [-18.95, DESK_Y + 0.05, -1.37], rotY: 0.4, scale: 1 },
  { name: 'Plant', pos: [-14.6, DESK_Y, 9.6], rotY: 0.6, scale: 1.0, layer: 'fore' },
  // Foreground plant at the bottom left, out of focus (blurred layer).
  { name: 'Plant', pos: [12.8, DESK_Y, -5.8], rotY: 2.2, scale: 0.72, layer: 'fore' },
]);

/** The colour wheel lies on the desk right of the tray, tilted up toward the camera. */
export const NIGHT_WHEEL = Object.freeze({ pos: [-11.9, 0.9, -1.3], tiltX: -0.65, rotY: 0.1, scale: 1.46 });

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
  mines: Object.freeze([[6.1, -0.9], [-6.9, -3.5]]),
  gem: Object.freeze({ color: 'red', x: -3.2, z: 0.9 }),
  tank: Object.freeze({ x: 0.2, z: -3.3, heading: 0 }),
});
