// Upgrade cards: train down -> ash-grey world (not paused) + 2 cards. The first two offers always
// include CARGO CHOPPER / FIELD ENGINEER. Engineer drop-off, DOUBLE ROW dock, HOMING ROCKETS supply
// unlock, SURPRISE EGG balls, GEM MINE and the gem effects.
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
await page.waitForFunction(() => !!window.__game && window.__game.cards.loaded, null, { timeout: 120000 });
const out = {};
const killTrain = () => page.evaluate(() => {
  const g = window.__game; const dt = 1 / 30;
  for (let i = 0; i < 900 && (!g.train || g.train.finished || g.train.destroyed || g.train.headZ < 2); i++) g.step(dt);
  const t = g.train; const loco = t.cars[0]; const gem = loco.targets.find((x) => x.kind === 'gem');
  for (const car of t.cars) for (const x of car.targets) if (x.kind === 'turret' && x.alive) t.damage(car, x, 999, g.heli.position.clone());
  t.damage(loco, gem, 999, g.heli.position.clone());
  for (let i = 0; i < 75; i++) g.step(1 / 30);
  return g.cards.cards.map((c) => c.def.id);
});
const pickCard = (id) => page.evaluate((id) => {
  const g = window.__game; const i = g.cards.cards.findIndex((c) => c.def.id === id);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: `Digit${i + 1}` }));
  for (let k = 0; k < 40; k++) g.step(1 / 30);
  return [...g.takenCards];
}, id);
await page.evaluate(() => {
  const g = window.__game; g.paused = true; g.hud.overlayEl.style.transition = 'none'; g.handleStartInput();
  g.heli.takeDamage = () => false;
});
// Statistics of the guaranteed slot over many simulated first offers.
out.firstOfferStats = await page.evaluate(() => {
  const g = window.__game; const seen = {}; let withCargo = 0;
  const show = g.cards.show.bind(g.cards);
  g.cards.show = (defs) => { for (const d of defs) seen[d.id] = (seen[d.id] ?? 0) + 1; if (defs.some((d) => d.id === 'cargoChopper')) withCargo++; };
  for (let i = 0; i < 200; i++) { g.offersMade = 0; g.offerCards(); }
  g.cards.show = show; g.offersMade = 0;
  return { withCargo: `${withCargo}/200`, seen };
});
out.offer1 = await killTrain();
await page.evaluate(() => window.__game.pipeline.render(1 / 60));
await page.screenshot({ path: 'captures/cards_offer.png', timeout: 120000 });
out.taken1 = await pickCard('cargoChopper');
out.chopperHudAfterCargoOnly = await page.evaluate(() => !document.querySelector('[data-chopper]').classList.contains('off'));
out.offer2 = await killTrain();
out.taken2 = await pickCard('engineer');
out.engineer = await page.evaluate(() => {
  const g = window.__game; const L = g.logistics; let t = 0;
  while (t < 40 && !L.enabled) { g.step(1 / 30); t += 1 / 30; }
  return { enabled: L.enabled, countdownActive: L.countdownActive, chopperHud: !document.querySelector('[data-chopper]').classList.contains('off'), timer: Math.round(L.timer) };
});
out.doubleRow = await page.evaluate(() => {
  const g = window.__game; const B = g.blocks; const L = g.logistics;
  B.placeBlock(1, 4, 'yellow', { type: 'normal' }); B.placeBlock(1, 7, 'red', { type: 'normal', cargo: true });
  g.applyCard({ id: 'doubleRow' }); g.takenCards.add('doubleRow');
  const col1Blocks = B.blocks.filter((b) => b.alive && b.c === 1).length;
  for (let i = 0; i < 20; i++) g.step(1 / 30);
  return { capacity: L.dock.capacity, dockCols: B.dockColumns, col1Blocks, cargoPacked: L.dock.hasAt(1, 7), hud: document.querySelector('[data-dock]').textContent };
});
out.homing = await page.evaluate(() => {
  const g = window.__game; const count = (pool) => { let r = 0; const sp = g.supplies.spawn.bind(g.supplies); g.supplies.spawn = (t) => { if (t === 'R') r++; return { landed: true, vel: { set() {} } }; }; for (let i = 0; i < 2000; i++) g.supplies.spawnRandom(g.heli.position, pool); g.supplies.spawn = sp; return r; };
  const before = count(g.supplyPool);
  g.takenCards.add('homing');
  const after = count(g.supplyPool);
  return { rBefore: before, rAfter: after };
});
out.surpriseEgg = await page.evaluate(() => {
  const g = window.__game; const B = g.blocks; const M = g.mines;
  g.takenCards.add('surpriseEgg'); g.trainTimer = 1e9; if (g.train) g.train.finished = true;
  for (const b of B.blocks) if (b.alive && !b.cargo) B.takeBlock(b);
  for (let i = 0; i < 10; i++) g.step(1 / 30);
  const eggs = M.mines.filter((m) => m.egg);
  const falling = eggs.filter((m) => m.falling).length;
  for (let i = 0; i < 60; i++) g.step(1 / 30);
  return { eggsDropped: eggs.length, fallingAtFirst: falling, rollingAfter2s: M.mines.filter((m) => m.egg && !m.falling && m.alive).length };
});
await page.evaluate(() => window.__game.pipeline.render(1 / 60));
await page.screenshot({ path: 'captures/surprise_eggs.png', timeout: 120000 });
out.eggSupplies = await page.evaluate(() => {
  const g = window.__game; const M = g.mines; let supplies = 0; let balls = 0;
  const sp = g.supplies.spawnRandom.bind(g.supplies); g.supplies.spawnRandom = (...a) => { supplies++; return sp(...a); };
  for (let wave = 0; wave < 40; wave++) {
    g.eggTimer = 0; for (let i = 0; i < 70; i++) g.step(1 / 30);
    for (const m of M.mines) if (m.egg && m.alive && !m.falling) { balls++; g.resolveHit({ def: { owner: 'player', damage: 99 }, damage: 99, kind: 'tracer', aimed: true, life: 1 }, m.pos.clone()); }
  }
  g.supplies.spawnRandom = sp;
  return { ballsKilled: balls, supplies, rate: (supplies / Math.max(1, balls) * 100).toFixed(0) + '%' };
});
out.gemMine = await page.evaluate(() => {
  const g = window.__game;
  g.applyCard({ id: 'gemMine' });
  return { gemDrops: g.gemDrops, pool: g.supplyPool };
});
out.flickerAndRush = await page.evaluate(() => {
  const g = window.__game; const h = g.heli; const L = g.logistics;
  delete h.takeDamage; // restore the real method (prototype)
  h.invulnerable = 0; h.hp = 100; h.takeDamage(4); const base = h.invulnerable;
  g.applyCard({ id: 'flicker' }); g.takenCards.add('flicker');
  h.invulnerable = 0; h.takeDamage(4); const doubled = h.invulnerable;
  const hp = h.hp; const blocked = h.takeDamage(4) === false && h.hp === hp;
  L.timer = 100; const before = L.interval;
  g.applyCard({ id: 'cargoTime' });
  h.takeDamage = () => false;
  return { flickerBase: base, flickerWithCard: doubled, hitDuringFlickerBlocked: blocked, intervalBefore: before, intervalAfter: L.interval, timerScaled: Math.round(L.timer) };
});
console.log(JSON.stringify(out, null, 1));
console.log('errors', errors);
await browser.close();
await server.close();
