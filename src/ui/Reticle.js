import { createCanvas, canvasToTexture } from '../textures/CanvasUtils.js';

/** Four rotating corner brackets for the smart-aim lock. */
export function reticleTexture() {
  const S = 128;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  for (const [color, width] of [['rgba(0,0,0,0.55)', 9], ['#ffffff', 4]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(S / 2 + sx * 46, S / 2 + sy * 20);
      ctx.lineTo(S / 2 + sx * 46, S / 2 + sy * 46);
      ctx.lineTo(S / 2 + sx * 20, S / 2 + sy * 46);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#ff4d4d';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 5, 0, Math.PI * 2);
  ctx.fill();
  return canvasToTexture(canvas, { srgb: true });
}
