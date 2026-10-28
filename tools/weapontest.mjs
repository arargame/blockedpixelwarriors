// Train weapons: twin turret bullets along the barrel, cannonballs along the cannon barrel (not aimed),
// turrets breakable by the player (they break apart), gem shield until every turret is down.
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 5192, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://127.0.0.1:5192/?quality=low');
await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = window.__game; g.paused = true; g.hud.overlayEl.style.transition = 'none'; g.handleStartInput();
  const out = {}; const dt = 1 / 30; const h = g.heli;
  for (let i = 0; i < 600 && (!g.train || g.train.headZ < 4); i++) g.step(dt);
  const t = g.train; t.cruise = t.speed = 0.0001; t.stopAtZ = null;
  h.hp = 1e9;
  // Record enemy shots.
  const shells = []; const balls = [];
  const spawn = g.projectiles.spawn.bind(g.projectiles);
  g.projectiles.spawn = (kind, pos, d, ...a) => {
    if (kind === 'shell') shells.push({ t: g.clock.elapsedTime, frame: frame, d: d.clone().normalize() });
    if (kind === 'cannonball') balls.push({ pos: pos.clone(), d: d.clone().normalize() });
    return spawn(kind, pos, d, ...a);
  };
  let frame = 0;
  for (; frame < 300; frame++) { h.position.set(-3, h.position.y, 0); h.velocity.set(0, 0, 0); h.yaw = 0; g.step(dt); }
  // Shells come in pairs (same frame).
  const perFrame = {}; shells.forEach((s) => perFrame[s.frame] = (perFrame[s.frame] ?? 0) + 1);
  const counts = Object.values(perFrame);
  out.turretShots = { shells: shells.length, volleys: counts.length, allPairs: counts.every((c) => c % 2 === 0) };
  // Cannonballs: direction mostly sideways (x) and not toward the heli in particular.
  out.cannonballs = balls.map((b) => `${b.d.x.toFixed(2)},${b.d.y.toFixed(2)},${b.d.z.toFixed(2)}`).slice(0, 6);
  out.cannonModel = !!g.projectiles.models?.cannonball && !!g.projectiles.models?.shell;
  // Gem shielded: damage to gem very small.
  const gem = t.cars[0].targets.find((x) => x.kind === 'gem');
  const gemHp0 = gem.hp;
  t.damage(t.cars[0], gem, 10, t.cars[0].group.localToWorld(gem.box.getCenter(new h.position.constructor())));
  out.shielded = { shielded: t.gemShielded, gemLost: +(gemHp0 - gem.hp).toFixed(2) };
  // Shoot turrets with the player's straight guns, parking the heli beside each turret, nose to the train.
  const turrets = t.cars.flatMap((c) => c.targets.filter((x) => x.kind === 'turret').map((x) => ({ car: c, x })));
  let shieldToast = false; t.onShieldDown = () => (shieldToast = true);
  const res = [];
  for (const { car, x } of turrets) {
    let f = 0;
    t.group.updateMatrixWorld(true);
    const p0 = car.group.localToWorld(x.box.getCenter(new h.position.constructor()));
    t.setHeadZ(t.headZ - p0.z);
    for (; f < 600 && x.alive; f++) {
      const p = car.group.localToWorld(x.box.getCenter(new h.position.constructor()));
      h.position.set(t.group.position.x - 4.5, h.position.y, p.z); h.velocity.set(0, 0, 0);
      h.yaw = -Math.PI / 2;
      g.step(dt);
    }
    res.push(`${x.alive ? "ALIVE" : "down"}@${(f * dt).toFixed(1)}s hp=${x.hp.toFixed(1)} heli=${h.alive} state=${g.state} z=${h.position.z.toFixed(1)} tz=${car.group.localToWorld(x.box.getCenter(new h.position.constructor())).z.toFixed(1)}`);
  }
  out.turretsKilled = res;
  out.wreckage = t.wreckage.length;
  out.afterShield = { shielded: t.gemShielded, shieldToast, shieldVisible: t.gemShield.visible };
  const g1 = gem.hp; t.damage(t.cars[0], gem, 10, h.position.clone());
  out.afterShield.gemLost = +(g1 - gem.hp).toFixed(2);
  for (let i = 0; i < 20; i++) g.step(dt);
  return out;
});
console.log(JSON.stringify(r, null, 1));
await page.evaluate(() => { const g = window.__game; g.paused = false; });
await page.waitForTimeout(200);
await page.screenshot({ path: 'captures/weapontest.png', timeout: 120000 });
console.log('errors', errors);
await browser.close();
await server.close();
