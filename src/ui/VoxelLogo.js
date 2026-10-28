/**
 * Paints the "BLOCKED / PIXEL / WARRIORS" title as chunky voxel lettering on a canvas:
 * bold pixel glyphs, per-cell bevels, a deep extruded side, dark outline, gradient faces
 * and floating decor cubes (key-art logo). Pure 2D canvas, no assets needed.
 */

// Bold 6x7 pixel glyphs (2-px strokes). '1' = filled cell.
const GLYPHS = {
  B: ['111110', '110011', '110011', '111110', '110011', '110011', '111110'],
  L: ['110000', '110000', '110000', '110000', '110000', '111111', '111111'],
  O: ['011110', '110011', '110011', '110011', '110011', '110011', '011110'],
  C: ['011111', '110000', '110000', '110000', '110000', '110000', '011111'],
  K: ['110011', '110110', '111100', '111000', '111100', '110110', '110011'],
  E: ['111111', '110000', '110000', '111110', '110000', '110000', '111111'],
  D: ['111110', '110011', '110011', '110011', '110011', '110011', '111110'],
  P: ['111110', '110011', '110011', '111110', '110000', '110000', '110000'],
  I: ['1111', '0110', '0110', '0110', '0110', '0110', '1111'],
  X: ['110011', '110011', '011110', '001100', '011110', '110011', '110011'],
  A: ['011110', '110011', '110011', '111111', '110011', '110011', '110011'],
  N: ['110011', '111011', '111111', '110111', '110011', '110011', '110011'],
  Z: ['111111', '000011', '000110', '001100', '011000', '110000', '111111'],
  R: ['111110', '110011', '110011', '111110', '111100', '110110', '110011'],
  W: ['11000011', '11000011', '11000011', '11011011', '11011011', '11111111', '01100110'],
  S: ['011111', '110000', '110000', '011110', '000011', '000011', '111110'],
};

const LINES = [
  { text: 'BLOCKED', cell: 15, top: '#fffdf6', bottom: '#eadbbd', side: '#9b7a55', sideDark: '#5d452c' },
  { text: 'PIXEL', cell: 13, top: '#fff06a', bottom: '#ff9418', side: '#b4560c', sideDark: '#6e2f04' },
  { text: 'WARRIORS', cell: 14, top: '#aef25a', bottom: '#3c9c22', side: '#2a6a16', sideDark: '#163d0a' },
];

const OUTLINE = '#21180f';

function layoutLine(text) {
  const cells = [];
  let x = 0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    g.forEach((row, r) => [...row].forEach((v, c) => v === '1' && cells.push({ c: x + c, r, ch })));
    x += g[0].length + 1;
  }
  return { cells, cols: x - 1 };
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** Small isometric voxel cube used as floating decor around the logo. */
function drawCube(ctx, x, y, s, color) {
  const h = s * 0.5;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, s * 0.12);
  ctx.strokeStyle = OUTLINE;
  const faces = [
    { pts: [[x, y - h], [x + s, y - h * 2], [x + s * 2, y - h], [x + s, y]], f: 1.25 },
    { pts: [[x, y - h], [x + s, y], [x + s, y + s], [x, y + s - h]], f: 0.95 },
    { pts: [[x + s, y], [x + s * 2, y - h], [x + s * 2, y + s - h], [x + s, y + s]], f: 0.7 },
  ];
  for (const face of faces) {
    ctx.beginPath();
    face.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = shade(color, face.f);
    ctx.fill();
    ctx.stroke();
  }
}

/** Tank silhouette tucked into the counter of the A (as in the key art). */
function drawTank(ctx, cx, cy, s) {
  ctx.fillStyle = '#1d3a10';
  ctx.fillRect(cx - s * 0.9, cy, s * 1.8, s * 0.45);
  ctx.fillRect(cx - s * 0.5, cy - s * 0.4, s, s * 0.45);
  ctx.fillRect(cx, cy - s * 0.3, s * 1.0, s * 0.16);
  for (let i = 0; i < 4; i++) ctx.fillRect(cx - s * 0.8 + i * s * 0.48, cy + s * 0.45, s * 0.3, s * 0.18);
}

/**
 * @param {number} [scale=2] device pixels per logical pixel
 * @returns {HTMLCanvasElement}
 */
export function createVoxelLogo(scale = 2) {
  const laid = LINES.map((l) => ({ ...l, ...layoutLine(l.text) }));
  const width = Math.max(...laid.map((l) => l.cols * l.cell)) + 160;
  const gap = 10;
  let height = 70;
  for (const l of laid) height += l.cell * 7 + l.cell * 0.55 + gap;
  height += 20;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.style.aspectRatio = `${width} / ${height}`;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  let y = 52;
  const linesDrawn = [];
  for (const l of laid) {
    const cs = l.cell;
    const x0 = (width - l.cols * cs) / 2;
    const depth = Math.round(cs * 0.85);
    const ox = cs * 0.22;
    const outline = Math.max(3, cs * 0.3);
    const cellAt = (cell, dx = 0, dy = 0) => [x0 + cell.c * cs + dx, y + cell.r * cs + dy];

    // 1) Outline silhouette behind face + extrusion.
    ctx.fillStyle = OUTLINE;
    for (const cell of l.cells) {
      const [px, py] = cellAt(cell);
      ctx.fillRect(px - outline, py - outline, cs + outline * 2 + ox, cs + outline * 2 + depth);
    }
    // 2) Extruded side (stacked 1px slices from dark to mid).
    for (let d = depth; d >= 1; d--) {
      const t = d / depth;
      ctx.fillStyle = t > 0.6 ? l.sideDark : l.side;
      for (const cell of l.cells) {
        const [px, py] = cellAt(cell, ox * t, d);
        ctx.fillRect(px, py, cs, cs);
      }
    }
    // 3) Faces: line gradient + per-cell bevel so every pixel reads as a voxel.
    const grad = ctx.createLinearGradient(0, y, 0, y + cs * 7);
    grad.addColorStop(0, l.top);
    grad.addColorStop(1, l.bottom);
    for (const cell of l.cells) {
      const [px, py] = cellAt(cell);
      ctx.fillStyle = grad;
      ctx.fillRect(px, py, cs, cs);
      // Bevel only where the neighbour cell is empty, so strokes read as solid chunky blocks.
      const has = (dc, dr) => l.cells.some((o) => o.c === cell.c + dc && o.r === cell.r + dr);
      const b = Math.max(2, cs * 0.2);
      if (!has(0, -1)) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(px, py, cs, b); }
      if (!has(-1, 0)) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(px, py, b * 0.8, cs); }
      if (!has(0, 1)) { ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(px, py + cs - b * 0.8, cs, b * 0.8); }
      if (!has(1, 0)) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(px + cs - b * 0.7, py, b * 0.7, cs); }
      // Faint per-voxel variation.
      const n = Math.sin(cell.c * 12.9898 + cell.r * 78.233) * 43758.5453;
      ctx.fillStyle = `rgba(${n - Math.floor(n) > 0.5 ? '255,255,255' : '0,0,0'},0.05)`;
      ctx.fillRect(px, py, cs, cs);
    }
    linesDrawn.push({ l, x0, y, cs });
    y += cs * 7 + depth + gap;
  }

  // Tank in the A of WARRIORS.
  const panzer = linesDrawn[2];
  if (panzer) {
    const aStart = Math.min(...panzer.l.cells.filter((c) => c.ch === 'A').map((c) => c.c));
    drawTank(ctx, panzer.x0 + (aStart + 3) * panzer.cs, panzer.y + 4.55 * panzer.cs, panzer.cs * 0.95);
  }
  // Floating decor cubes (blue/red) like the key art.
  const first = linesDrawn[0];
  drawCube(ctx, first.x0 + first.cs * 3.2, first.y - first.cs * 1.2, first.cs * 1.5, '#2f63e8');
  drawCube(ctx, first.x0 - first.cs * 3.4, first.y + first.cs * 5.6, first.cs * 1.2, '#e8302a');
  drawCube(ctx, first.x0 + first.cols * first.cs - first.cs * 9, first.y - first.cs * 0.8, first.cs * 1.0, '#e8302a');
  const second = linesDrawn[1];
  drawCube(ctx, second.x0 + second.cols * second.cs + second.cs * 1.4, second.y + second.cs * 3.2, second.cs * 1.3, '#2f63e8');
  return canvas;
}
