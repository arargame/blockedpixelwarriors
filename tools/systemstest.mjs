// Checks block types, same-colour chain explosions, cargo -> board drops, the looping train
// (cargo reload, turrets stay dead), supply blocks, homing rockets and the arrow-key turning.
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 5192, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5192/?quality=low');
await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = window.__game; g.paused = true; g.hud.overlayEl.style.transition = 'none'; g.handleStartInput();
  const out = {}; const B = g.blocks; const dt = 1 / 60; const h0 = g.heli.position;
  const alive = () => B.blocks.filter((b) => b.alive).length;
  out.types = B.blocks.reduce((m, b) => ((m[b.type] = (m[b.type] ?? 0) + 1), m), {});
  // Chain: find a block with a same-colour neighbour.
  let pair = null;
  for (const b of B.blocks) { for (const [dc, dr] of [[1, 0], [0, 1]]) { const n = B.cells.get(B.key(b.c + dc, b.r + dr)); if (n && n.alive && n.color === b.color) { pair = [b, n]; break; } } if (pair) break; }
  const before = alive();
  B.damage(pair[0], 999, pair[0].mesh.position);
  for (let i = 0; i < 40; i++) B.update(dt);
  out.chain = { color: pair[0].color, neighbourDestroyed: !pair[1].alive, blocksDestroyed: before - alive() };
  // Supply block -> supply spawns.
  const sb = B.blocks.find((b) => b.alive && b.type === 'supply');
  const s0 = g.supplies.items.length; if (sb) B.damage(sb, 999, sb.mesh.position);
  out.supplyBlockDropped = g.supplies.items.length > s0;
  // Train: bring it onto the board, knock off a cargo cube.
  for (let i = 0; i < 400 && (!g.train || g.train.headZ < 2); i++) g.step(1 / 30);
  for (let i = 0; i < 600 && !g.train.cars.some((c) => c.targets.some((t) => t.kind === 'cargo' && t.alive && c.group.localToWorld(t.box.getCenter(new h0.constructor())).z > -6)); i++) g.step(1 / 30);
  const pickCar = g.train.cars.find((c) => c.targets.some((t) => t.kind === 'cargo' && t.alive && c.group.localToWorld(t.box.getCenter(new h0.constructor())).z > -6));
  const car = pickCar; const cube = car.targets.find((t) => t.kind === 'cargo' && t.alive);
  const a0 = alive();
  g.train.damage(car, cube, 999, g.train.group.position.clone());
  for (let i = 0; i < 60; i++) B.update(dt);
  out.cargoLandedOnBoard = alive() - a0;
  // Kill a turret, finish the lap, check reload.
  const tur = g.train.cars.flatMap((c) => c.targets.map((t) => [c, t])).find(([, t]) => t.kind === 'turret');
  g.train.damage(tur[0], tur[1], 999, g.train.group.position.clone());
  const integ = g.train.integrity;
  g.train.finished = true; g.trainTimer = 0; g.step(dt);
  out.lap = { lap: g.train.lap, cubeBack: cube.alive && cube.mesh.visible, turretStillDead: !tur[1].alive, integrityKept: g.train.integrity === integ, integrity: Math.round(integ * 100) + '%' };
  // Homing rockets.
  g.powerups.activate('R', 20); let maxLife = 0; let fired = 0;
  for (let i = 0; i < 120; i++) { g.step(dt); for (const p of g.projectiles.items) if (p.kind === 'missile') { maxLife = Math.max(maxLife, p.life); } }
  out.rocketsMaxFlight = maxLife.toFixed(2) + 's';
  out.rocketMeshes = g.projectiles.models?.missile?.meshes.length ?? 0;
  // Keys.
  const h = g.heli; h.velocity.set(0, 0, 0); const y0 = h.yaw; const p0 = h.position.clone();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' })); for (let i = 0; i < 30; i++) g.step(dt); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
  out.arrowLeftTurnDeg = Math.round((h.yaw - y0) * 57.3);
  for (let i = 0; i < 60; i++) g.step(dt); const p1 = h.position.clone();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' })); for (let i = 0; i < 30; i++) g.step(dt); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp' }));
  out.arrowUpMoved = h.position.distanceTo(p1).toFixed(2);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })); for (let i = 0; i < 30; i++) g.step(dt); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  out.wMoved = h.position.distanceTo(p1).toFixed(2);
  g.heli.hp = 62; g.hud.setHealth(0.62);
  g.pipeline.render(dt);
  return out;
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'captures/tmp/systems.png' });
console.log(JSON.stringify(r, null, 1));
console.log('errors', errors);
await browser.close(); await server.close();
