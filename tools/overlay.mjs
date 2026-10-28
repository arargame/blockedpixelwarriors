// Draws the projected board layout (walls, track, block grid) over the key art for camera tuning.
// Usage: node tools/overlay.mjs x,y,z,pitchDeg,yawDeg,fov,k out.png
import * as THREE from 'three';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const [px, py, pz, pitch, yaw, fov, k] = process.argv[2].split(',').map(Number);
const out = process.argv[3] ?? 'captures/tmp/overlay.png';
const W = 1672, H = 941, A = W / H;
const cam = new THREE.PerspectiveCamera(fov, A, 0.1, 1000);
cam.position.set(px, py, pz); cam.rotation.order = 'YXZ';
cam.rotation.set(-pitch * Math.PI / 180, -yaw * Math.PI / 180, 0); cam.updateMatrixWorld(true);
const s = 1 / (1 + k * (A * A + 1) / (A * A));
function proj(w) {
  const v = new THREE.Vector3(...w).project(cam); if (v.z > 1) return null;
  let dx = v.x * A, dy = v.y; const ux = dx, uy = dy;
  for (let i = 0; i < 12; i++) { const f = s * (1 + k * (dx * dx + dy * dy) / (A * A)); dx = ux / f; dy = uy / f; }
  return [(dx / A + 1) / 2 * W, (1 - dy) / 2 * H];
}
const B = { minX: -10.5, maxX: 7.5, minZ: -9, maxZ: 10.5, trackX: 3 };
const polys = [];
const line = (a, b, color, n = 40) => { const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; const p = proj(a.map((v, j) => v + (b[j] - v) * t)); if (p) pts.push(p); } polys.push({ color, pts }); };
const T = 0.74;
line([B.minX, T, B.minZ], [B.maxX, T, B.minZ], 'orange'); line([B.minX, T, B.maxZ], [B.maxX, T, B.maxZ], 'orange');
line([B.minX, T, B.minZ], [B.minX, T, B.maxZ], 'orange'); line([B.maxX, T, B.minZ], [B.maxX, T, B.maxZ], 'orange');
line([B.trackX, 0.42, -40], [B.trackX, 0.42, 20], 'cyan', 80);
const MAP = JSON.parse(fs.readFileSync(new URL('./layout.json', import.meta.url)));
MAP.forEach((row, r) => [...row].forEach((ch, c) => {
  if (ch === '.') return; const x0 = B.minX + c * 1.5, z0 = B.minZ + r * 1.5, y = 1.5;
  const col = { R: 'red', G: 'lime', T: 'teal', Y: 'yellow' }[ch];
  line([x0 + .1, y, z0 + .1], [x0 + 1.4, y, z0 + .1], col, 2); line([x0 + 1.4, y, z0 + .1], [x0 + 1.4, y, z0 + 1.4], col, 2);
  line([x0 + 1.4, y, z0 + 1.4], [x0 + .1, y, z0 + 1.4], col, 2); line([x0 + .1, y, z0 + 1.4], [x0 + .1, y, z0 + .1], col, 2);
}));
fs.writeFileSync('/tmp/overlay_polys.json', JSON.stringify(polys));
execFileSync('python3', ['-c', `
import json
from PIL import Image, ImageDraw
im=Image.open('captures/ref/keyart.png').convert('RGB'); d=ImageDraw.Draw(im)
for p in json.load(open('/tmp/overlay_polys.json')):
    pts=[tuple(q) for q in p['pts']]
    if len(pts)>1: d.line(pts, fill=p['color'], width=3)
im.save('${out}')`]);
console.log('saved', out);
