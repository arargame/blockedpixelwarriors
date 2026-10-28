// Logistics: engineer forklift collects train cargo into the dock as gift packages, cargo is never
// auto-targeted, the CH-47F collects packages in order, HUD countdown + mission complete.
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 5195, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://127.0.0.1:5195/?quality=low&fixedres');
await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
const out = {};
out.setup = await page.evaluate(() => {
  const g = window.__game; g.paused = true; g.hud.overlayEl.style.transition = 'none'; g.handleStartInput();
  g.heli.takeDamage = () => false;
  g.trainTimer = 1e9; // no train: keep the scene calm
  g.weaponTimers.main = 1e9; g.updateWeapons = () => {};
  const L = g.logistics; const B = g.blocks;
  const V = g.heli.position.constructor;
  // The engineer only comes with the FIELD ENGINEER card: hire him and wait for the drop-off.
  L.hireEngineer(); L.enableChopper();
  for (let i = 0; i < 30 * 40 && !L.enabled; i++) g.step(1 / 30);
  // Six cubes "knocked off the train" at various rows.
  const colors = ['red', 'green', 'teal', 'red', 'yellow', 'teal'];
  colors.forEach((c, i) => B.dropFromTrain(new V(3, 3, -7 + i * 3), c));
  for (let i = 0; i < 30; i++) g.step(1 / 30);
  const cargo = B.blocks.filter((b) => b.alive && b.cargo);
  const targeted = g.collectTargets(40).filter((q) => q.kind === 'block').length;
  return { cargoOnBoard: cargo.length, cargoCols: cargo.map((b) => b.c), dockColBlocks: B.blocks.filter((b) => b.alive && b.c === 0).length, autoTargetsBlocks: targeted, aliveBlocks: B.blocks.filter((b) => b.alive && !b.cargo).length };
});
// Run until all 5 cargo cubes are on the dock (cap 120 s).
out.forklift = await page.evaluate(() => {
  const g = window.__game; const L = g.logistics; let t = 0; let shot = null;
  while (t < 120 && L.dock.count < 5) {
    g.step(1 / 30); t += 1 / 30;
    if (!shot && L.engineer.carrying && L.engineer.state === 'drive') { shot = t; break; }
  }
  return { carryingAt: shot?.toFixed(1), dock: L.dock.count };
});
await page.evaluate(() => { const g = window.__game; g.pipeline.render(1 / 60); });
await page.screenshot({ path: 'captures/forklift_carry.png', timeout: 120000 });
out.forklift2 = await page.evaluate(() => {
  const g = window.__game; const L = g.logistics; let t = 0;
  while (t < 150 && L.dock.count < 5) { g.step(1 / 30); t += 1 / 30; }
  return { seconds: t.toFixed(1), dock: L.dock.count, packages: L.dock.ordered().map((p) => `${p.color}@r${p.r}L${p.level}`), cargoLeft: g.blocks.blocks.filter((b) => b.alive && b.cargo).length, engineer: L.engineer.state, timer: L.timer.toFixed(1) };
});
out.countdown = await page.evaluate(() => {
  const g = window.__game; const L = g.logistics;
  L.timer = 9.5; g.step(1 / 30);
  const el = document.querySelector('[data-chopper]');
  return { urgent: el.classList.contains('urgent'), text: el.textContent.replace(/\s+/g, ' ').trim() };
});
await page.screenshot({ path: 'captures/hud_countdown.png', timeout: 120000 });
out.chopper = await page.evaluate(() => {
  const g = window.__game; const L = g.logistics; let t = 0; let winchAt = null;
  while (t < 15 && !L.chinook.active) { g.step(1 / 30); t += 1 / 30; }
  const arrivedAt = t;
  while (t < 40 && L.chinook.state !== 'winch') { g.step(1 / 30); t += 1 / 30; }
  for (let i = 0; i < 20; i++) g.step(1 / 30);
  winchAt = t;
  return { arrivedAt: arrivedAt.toFixed(1), winchAt: winchAt.toFixed(1), state: L.chinook.state };
});
await page.evaluate(() => { const g = window.__game; g.pipeline.render(1 / 60); });
await page.screenshot({ path: 'captures/chinook_winch.png', timeout: 120000 });
out.chopper2 = await page.evaluate(() => {
  const g = window.__game; const L = g.logistics; let t = 0;
  while (t < 90 && L.chinook.active) { g.step(1 / 30); t += 1 / 30; }
  return { seconds: t.toFixed(1), delivered: L.delivered, dock: L.dock.count, timer: L.timer.toFixed(0), score: g.score, mission: document.querySelector('[data-mission]').textContent.replace(/\s+/g, ' ').trim() };
});
out.win = await page.evaluate(() => {
  const g = window.__game; const L = g.logistics; const B = g.blocks; const V = g.heli.position.constructor;
  L.delivered = { red: 100, green: 100, blue: 99 };
  B.dropFromTrain(new V(3, 3, 0), 'teal');
  let t = 0;
  while (t < 120 && L.dock.count < 1) { g.step(1 / 30); t += 1 / 30; }
  L.callChopper();
  while (t < 240 && g.state !== 'won') { g.step(1 / 30); t += 1 / 30; }
  return { state: g.state, overlay: document.querySelector('[data-overlay]').textContent.replace(/\s+/g, ' ').trim().slice(0, 80) };
});
console.log(JSON.stringify(out, null, 1));
console.log('errors', errors);
await browser.close();
await server.close();
