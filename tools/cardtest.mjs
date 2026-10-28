// Upgrade cards: first train down -> ash-grey world (not paused) + 2 cards; picking FIELD ENGINEER
// brings the forklift in on the Chinook; next train offers GEM MINE; gem effects (blue rapid
// fire, green acid, red power, black critical).
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 5199, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://127.0.0.1:5199/?quality=high&fixedres');
await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
const out = {};
const killTrain = () => page.evaluate(() => {
  const g = window.__game; const dt = 1 / 30;
  for (let i = 0; i < 900 && (!g.train || g.train.finished || g.train.destroyed || g.train.headZ < 2); i++) g.step(dt);
  const t = g.train; const loco = t.cars[0]; const gem = loco.targets.find((x) => x.kind === 'gem');
  for (const car of t.cars) for (const x of car.targets) if (x.kind === 'turret' && x.alive) t.damage(car, x, 999, g.heli.position.clone());
  t.damage(loco, gem, 999, g.heli.position.clone());
  return t.destroyed;
});
out.start = await page.evaluate(() => {
  const g = window.__game; g.paused = true; g.hud.overlayEl.style.transition = 'none'; g.handleStartInput();
  g.heli.takeDamage = () => false;
  return { engineerVisible: g.logistics.engineer.root.visible, missionHidden: document.querySelector('[data-mission]').classList.contains('off') };
});
out.trainKilled = await killTrain();
out.offer = await page.evaluate(() => {
  const g = window.__game; const t0 = g.time; const p0 = g.heli.position.clone();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  for (let i = 0; i < 75; i++) g.step(1 / 30);
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  g.pipeline.render(1 / 60);
  return { active: g.cards.active, cards: g.cards.cards.map((c) => c.def.id), ash: +g.pipeline.gradePass.uniforms.uAsh.value.toFixed(2), gameTimeAdvanced: +(g.time - t0).toFixed(1), heliMoved: +g.heli.position.distanceTo(p0).toFixed(1) };
});
await page.screenshot({ path: 'captures/cards_offer.png', timeout: 120000 });
// Hover the first card (pointer over its centre), render.
await page.evaluate(() => {
  const g = window.__game; const c = g.cards.cards[0];
  const p = c.object.getWorldPosition(c.object.position.clone()).project(g.cards.camera);
  g.cards.pointer.set(p.x + 0.02, p.y + 0.05);
  for (let i = 0; i < 20; i++) g.step(1 / 30);
  g.pipeline.render(1 / 60);
});
await page.screenshot({ path: 'captures/cards_hover.png', timeout: 120000 });
out.pick = await page.evaluate(() => {
  const g = window.__game;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1' }));
  for (let i = 0; i < 40; i++) g.step(1 / 30);
  const L = g.logistics;
  let t = 0; let lowering = false;
  while (t < 30 && !L.enabled) { g.step(1 / 30); t += 1 / 30; if (!lowering && L.chinook.state === 'dLower') { lowering = true; for (let i = 0; i < 30; i++) g.step(1 / 30); break; } }
  g.pipeline.render(1 / 60);
  return { taken: [...g.takenCards], ash: +g.pipeline.gradePass.uniforms.uAsh.value.toFixed(2), chinook: L.chinook.state, lowering };
});
await page.screenshot({ path: 'captures/engineer_dropoff.png', timeout: 120000 });
out.engineer = await page.evaluate(() => {
  const g = window.__game; const L = g.logistics; let t = 0;
  while (t < 30 && !L.enabled) { g.step(1 / 30); t += 1 / 30; }
  return { enabled: L.enabled, engineerActive: L.engineer.active, cell: L.engineer.cell, missionShown: !document.querySelector('[data-mission]').classList.contains('off'), timer: L.timer.toFixed(0) };
});
out.trainKilled2 = await killTrain();
out.offer2 = await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 75; i++) g.step(1 / 30);
  const cards = g.cards.cards.map((c) => c.def.id);
  g.pipeline.render(1 / 60);
  return { cards };
});
await page.screenshot({ path: 'captures/cards_single.png', timeout: 120000 });
out.gemMine = await page.evaluate(() => {
  const g = window.__game;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1' }));
  for (let i = 0; i < 45; i++) g.step(1 / 30);
  // Blocks now drop gems.
  let gems = 0; const sp = g.supplies.spawn.bind(g.supplies);
  g.supplies.spawn = (type, ...a) => { if (type === 'G') gems++; return sp(type, ...a); };
  const B = g.blocks; let n = 0;
  for (const b of B.blocks) if (b.alive && !b.cargo && n < 60) { n++; B.destroyBlock(b, 0); }
  for (let i = 0; i < 10; i++) g.step(1 / 30);
  g.supplies.spawn = sp;
  return { gemDrops: g.gemDrops, destroyed: n, gemsDropped: gems };
});
out.gems = await page.evaluate(() => {
  const g = window.__game; const B = g.blocks; const res = {};
  const count = (kind, secs) => { let c = 0; const sp = g.projectiles.spawn.bind(g.projectiles); g.projectiles.spawn = (k, ...a) => { if (k === kind) c++; return sp(k, ...a); }; for (let i = 0; i < secs * 30; i++) g.step(1 / 30); g.projectiles.spawn = sp; return c; };
  g.powerups.clear();
  res.tracersPerSecNormal = count('tracer', 2) / 2;
  g.powerups.activate('G', 60, { gem: 'blue', name: 'RAPID FIRE' });
  res.tracersPerSecBlue = count('tracer', 2) / 2;
  // Acid: place a block, acidify it, watch it melt (guns off so only the acid hurts it).
  const uw = g.updateWeapons; g.updateWeapons = () => {};
  B.placeBlock(3, 3, 'red', { type: 'normal' });
  const l = B.cells.get(B.key(3, 3)); B.applyAcid(l);
  const hp0 = l.hp; let melt = 0; while (l.alive && melt < 12) { g.step(1 / 30); melt += 1 / 30; }
  res.acid = { turnedGreen: l.color === 'green', hp0, meltedAfter: melt.toFixed(1) + 's', alive: l.alive };
  g.updateWeapons = uw;
  // Red / black damage + crit pop-ups.
  g.powerups.activate('G', 60, { gem: 'red', name: 'POWER SHOT' });
  res.redDamage = g.shotStyle().damageMul;
  g.powerups.activate('G', 60, { gem: 'black', name: 'CRITICAL' });
  let crits = 0; for (let i = 0; i < 400; i++) if (g.shotStyle().crit) crits++;
  res.blackCritRate = (crits / 400 * 100).toFixed(0) + '%';
  g.gemImpact({ gem: 'black', crit: true }, g.heli.position.clone().setY(1), null);
  res.critText = document.querySelectorAll('.float-text').length;
  g.pipeline.render(1 / 60);
  return res;
});
await page.screenshot({ path: 'captures/gem_critical.png', timeout: 120000 });
console.log(JSON.stringify(out, null, 1));
console.log('errors', errors);
await browser.close();
await server.close();
