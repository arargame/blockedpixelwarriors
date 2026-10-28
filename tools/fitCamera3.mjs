// Fits camera + barrel distortion so the planned board layout lands where objects sit in the key art.
import * as THREE from 'three';
const W = 1672, H = 941, A = W / H;
const mkPts = (p) => [
  { w: [-10.5, 0.74, -9], s: [505, 240], wt: 2 },      // far-left frame corner
  { w: [-9.75, 1.5, p[8]], s: [535, 325], wt: 1 },    // strip col0 row0
  { w: [-9.75, 1.5, p[8] + 7.5], s: [470, 690], wt: 1 },    // strip col0 row5
  { w: [-8.25, 1.5, p[8] + 1.5], s: [630, 400], wt: 1 },    // strip col1 row1
  { w: [0.75 + p[9], 1.5, -0.75 + p[10]], s: [1450, 560], wt: 0.7 },  // cluster
  { w: [-0.75 + p[9], 1.5, 2.25 + p[10]], s: [1300, 745], wt: 0.7 },
  { w: [0.75 + p[9], 1.5, 3.75 + p[10]], s: [1420, 840], wt: 0.5 },
];
const mkLines = (p) => [{ x: p[11], y: 0.42, pts: [[1000, 25], [1260, 280], [1520, 540]], wt: 1 }];
const cam = new THREE.PerspectiveCamera(50, A, 0.1, 1000);
function setup(p) {
  cam.fov = p[5]; cam.updateProjectionMatrix();
  cam.position.set(p[0], p[1], p[2]); cam.rotation.order = 'YXZ'; cam.rotation.set(-p[3], -p[4], p[7] ?? 0); cam.updateMatrixWorld(true);
}
const lensScale = (k) => 1 / (1 + k * (A * A + 1) / (A * A));
function proj(p, w) {
  const v = new THREE.Vector3(...w).project(cam); if (v.z > 1) return null;
  const k = p[6], s = lensScale(k); let dx = v.x * A, dy = v.y; const ux = dx, uy = dy;
  for (let i = 0; i < 12; i++) { const f = s * (1 + k * (dx * dx + dy * dy) / (A * A)); dx = ux / f; dy = uy / f; }
  return [(dx / A + 1) / 2 * W, (1 - dy) / 2 * H];
}
function err(p) {
  setup(p); let e = 0; const pts = mkPts(p), lines = mkLines(p);
  if (p[8] < -8.25) e += 1e4 * (p[8] + 8.25) ** 2;
  for (const q of pts) { const s = proj(p, q.w); if (!s) return 1e12; e += q.wt * ((s[0] - q.s[0]) ** 2 + (s[1] - q.s[1]) ** 2); }
  for (const l of lines) {
    const samp = []; for (let z = -40; z <= 10; z += 0.5) { const s = proj(p, [l.x, l.y, z]); if (s) samp.push(s); }
    for (const t of l.pts) { let b = Infinity; for (const s of samp) b = Math.min(b, (s[0] - t[0]) ** 2 + (s[1] - t[1]) ** 2); e += l.wt * b; }
  }
  return e;
}
const KMAX = +(process.argv.find((a) => a.startsWith('--k='))?.slice(4) ?? 0.3);
const fixRoll = process.argv.includes('--roll') ? null : 0;
let best = [-6.9, 10.7, 6.4, 0.76, 0.15, 64, 0.15, 0, -7, 0, 0, 4.5], bestE = err(best);
const steps = [1, 1, 1, 0.04, 0.04, 2, 0.02, 0.02, 0.3, 0.3, 0.3, 0.3];
const clamp = (c) => { c[5] = Math.min(75, Math.max(25, c[5])); c[6] = Math.min(KMAX, Math.max(0, c[6])); if (fixRoll !== null) c[7] = 0; c[7] = Math.max(-0.2, Math.min(0.2, c[7])); return c; };
for (let r = 0; r < 8; r++) {
  let cur = r === 0 ? best.slice() : clamp(best.map((v, i) => v + (Math.random() - 0.5) * steps[i] * 6)); let ce = err(cur);
  for (let it = 0; it < 30000; it++) { const sc = 1 - it / 32000; const c = clamp(cur.map((v, i) => v + (Math.random() - 0.5) * 2 * steps[i] * sc)); const e = err(c); if (e < ce) { cur = c; ce = e; } }
  if (ce < bestE) { best = cur; bestE = ce; }
}
console.log('rms', Math.sqrt(bestE / 10).toFixed(1), best.map((v) => +v.toFixed(3)));
console.log('pitchDeg', (best[3] * 57.2958).toFixed(2), 'yawDeg', (best[4] * 57.2958).toFixed(2), 'rollDeg', (best[7] * 57.2958).toFixed(2));
setup(best);
for (const q of mkPts(best)) console.log(q.w.join(','), proj(best, q.w).map((n) => n.toFixed(0)).join(','), 'target', q.s.join(','));
const show = (lbl, w) => console.log(lbl, w.join(','), '->', proj(best, w)?.map((n) => n.toFixed(0)).join(','));
show('nearLeft', [-10.5, 0.74, 4.5]); show('nearRight', [9, 0.74, 4.5]); show('farRight', [9, 0.74, -9]); show('heli?', [-3.5, 3.2, 1.0]);
const a = proj(best, [-4, 3.2, 1]), b = proj(best, [-3, 3.2, 1]); console.log('px/unit at heli', Math.hypot(a[0] - b[0], a[1] - b[1]).toFixed(0));
