// Gem ammo effects (Blocked rules). Formerly part of cardtest.
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 5200, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://127.0.0.1:5200/?quality=high&fixedres');
await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
const out = {};
await page.evaluate(() => { const g = window.__game; g.paused = true; g.hud.overlayEl.style.transition = 'none'; g.handleStartInput(); g.heli.takeDamage = () => false; g.applyCard({ id: 'gemMine' }); });
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
