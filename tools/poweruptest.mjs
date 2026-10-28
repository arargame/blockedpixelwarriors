// Gameplay check for supplies: drop statistics, magnet pull, pickups (T/D/R/H/G), gem-tinted
// shots, heal amount, low-HP smoke and the HUD (skill feed + top HP + train damage panel).
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 5194, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5194/?quality=low');
await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = window.__game; g.paused = true; g.hud.overlayEl.style.transition = 'none'; g.handleStartInput();
  const out = {};
  // 1) Drop statistics.
  const counts = { T: 0, D: 0, R: 0, H: 0, G: 0 }; const N = 40000; let drops = 0;
  const spawn = g.supplies.spawn.bind(g.supplies);
  g.supplies.spawn = (type) => { counts[type]++; return {}; };
  // Supply blocks always drop one supply of a uniformly random type.
  for (let i = 0; i < N; i++) { g.supplies.spawnRandom(g.heli.position); drops++; }
  g.supplies.spawn = spawn;
  out.dropRate = (drops / N * 100).toFixed(1) + '%';
  out.typeShare = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, (v / drops * 100).toFixed(1) + '%']));
  // 2) Magnet: crate 4 units away on the floor gets pulled in and collected.
  const h = g.heli.position;
  const c = g.supplies.spawn('T', h.clone().setY(0.62).add(new h.constructor(4, 0, 0)));
  c.landed = true; c.vel.set(0, 0, 0); c.age = 1;
  let t = 0; const trace = [];
  while (g.supplies.items.includes(c) && t < 4) { g.step(1 / 60); t += 1 / 60; if (Math.round(t * 60) % 15 === 0) trace.push(c.pos.distanceTo(h).toFixed(1)); }
  out.magnet = { collectedAfter: t.toFixed(2) + 's', distanceTrace: trace.join(' > '), tripleActive: g.powerups.has('T') };
  // 3) Outside the magnet radius nothing moves.
  const far = g.supplies.spawn('D', h.clone().setY(0.62).add(new h.constructor(0, 0, -9)));
  far.landed = true; far.vel.set(0, 0, 0); far.age = 1;
  const p0 = far.pos.clone(); for (let i = 0; i < 30; i++) g.step(1 / 60);
  out.farCrateMoved = far.pos.distanceTo(p0).toFixed(2);
  // 4) Health kit.
  g.heli.hp = 20; const before = g.heli.hp;
  const hk = g.supplies.spawn('H', h.clone()); hk.age = 1; g.step(1 / 60);
  out.heal = `${before} -> ${g.heli.hp}`;
  // 5) Gem: shots tinted + stronger.
  const gem = g.supplies.spawn('G', h.clone()); gem.age = 1; g.step(1 / 60);
  for (let i = 0; i < 20; i++) g.step(1 / 60);
  const shot = g.projectiles.items.findLast((p) => p.kind === 'tracer');
  out.gem = { active: g.powerups.has('G'), color: '#' + (g.powerups.gemColor ?? 0).toString(16), shotTinted: !!shot?.tint, shotDamage: shot?.damage };
  // 6) Low HP smoke (hp 20 -> heal made it 55; force low again).
  g.heli.hp = 15; const s0 = g.effects.smoke.count; for (let i = 0; i < 30; i++) g.step(1 / 60);
  out.lowHpSmokeParticles = g.effects.smoke.count - s0;
  g.hud.setHealth(g.heli.hp / 100);
  // 7) Train HUD.
  for (let i = 0; i < 60; i++) g.step(1 / 60);
  out.trainCars = document.querySelectorAll('.train-cars .car').length;
  out.trainTicks = document.querySelectorAll('.train-cars .tick').length;
  out.hpSegmentsLit = document.querySelectorAll('.seg-bar i.on').length;
  g.pipeline.render(1 / 60);
  return out;
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'captures/tmp/powerups.png' });
console.log(JSON.stringify(r, null, 1));
console.log('errors', errors);
await browser.close(); await server.close();
