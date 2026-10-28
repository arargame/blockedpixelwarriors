// Smart aim vs train cargo, ramming damage + flicker, alternating trips, speed modes / halts,
// and far-side restocking. Captures a frame with the red damage vignette.
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 5191, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5191/?quality=low');
await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = window.__game; g.paused = true; g.hud.overlayEl.style.transition = 'none'; g.handleStartInput();
  const out = {}; const dt = 1 / 30; const h = g.heli;
  // Bring a NORMAL-speed train onto the board and park the heli beside it facing the cars.
  for (let i = 0; i < 600 && (!g.train || g.train.headZ < 6); i++) g.step(dt);
  const t = g.train; t.cruise = t.speed = t.baseSpeed; t.stopAtZ = null;
  const cargoBefore = t.cars.flatMap((c) => c.targets).filter((x) => x.kind === 'cargo' && x.alive).length;
  let hits = 0;
  const orig = t.damage.bind(t);
  t.damage = (car, target, ...a) => { if (target.kind === 'cargo' || target.kind === 'turret') hits++; return orig(car, target, ...a); };
  for (let i = 0; i < 90; i++) {
    h.position.set(-1.5, h.position.y, 0); h.velocity.set(0, 0, 0);
    h.yaw = h.targetYaw = -Math.PI / 2; // nose toward +X (the train)
    g.step(dt);
  }
  const cargoAfter = t.cars.flatMap((c) => c.targets).filter((x) => x.kind === 'cargo' && x.alive).length;
  out.smartAim = { gemHp: t.cars[0].targets[0].hp.toFixed(1), trainPartHits: hits, cargoShotOff: cargoBefore - cargoAfter, locked: !!g.lockedTarget() };
  // Ramming.
  h.invulnerable = 0; const hp0 = h.hp; h.position.set(t.group.position.x, h.position.y, (t.minZ + t.maxZ) / 2);
  g.step(dt);
  let blinkOff = 0; for (let i = 0; i < 20; i++) { g.step(dt); if (!h.object3d.visible) blinkOff++; }
  out.ram = { hp0, hpAfter: h.hp, alive: h.alive, state: g.state, damage: hp0 - h.hp, invulnerable: h.invulnerable.toFixed(2), flickerFramesHidden: blinkOff, vignette: Number(getComputedStyle(document.querySelector('.damage-vignette')).opacity).toFixed(2) };
  // Trips alternate direction; modes vary; halts happen.
  const trips = []; let halts = 0;
  t.onStop = () => halts++;
  for (let k = 0; k < 6; k++) {
    trips.push(`${t.dir > 0 ? 'A->B' : 'B->A'}:${t.mode}${t.stopAtZ !== null ? '+stop' : ''}`);
    t.finished = true; g.trainTimer = 0; g.step(dt);
  }
  out.trips = trips.join('  ');
  // Run one NORMAL trip with a stop over the board and measure the halt.
  t.mode = 'NORMAL'; t.cruise = t.baseSpeed; t.stopAtZ = -2; t.speed = t.cruise; t.dir = 1; t.group.rotation.y = 0; t.setHeadZ(-20);
  g.heli.alive = false; g.heli.object3d.visible = false; // keep the guns quiet so the train survives
  let haltTime = 0; for (let i = 0; i < 400; i++) { g.step(dt); if (t.stopped) haltTime += dt; }
  out.halt = { seconds: haltTime.toFixed(1), haltsCounted: halts };
  // Restock: clear far-side cells, run the train past.
  t.destroyed = false; const B = g.blocks; let cleared = 0;
  for (const b of B.blocks) if (b.alive && b.x > 3 + 1.6) { b.alive = false; B.writeMatrix(b); cleared++; }
  t.restartLap(); t.dir = 1; t.group.rotation.y = 0; t.setHeadZ(-25); t.cruise = t.speed = 6; t.stopAtZ = null; g.restock = null;
  for (let i = 0; i < 300; i++) g.step(dt);
  out.restock = { cleared, refilled: B.blocks.filter((b) => b.alive && b.x > 4.6).length };
  // Vignette frame.
  g.heli.respawn(); g.state = 'playing'; h.hp = 40; g.hud.setHealth(0.4); g.hud.damageFlash(1);
  g.pipeline.render(dt);
  return out;
});
await page.waitForTimeout(150);
await page.screenshot({ path: 'captures/tmp/traintest.png' });
console.log(JSON.stringify(r, null, 1));
console.log('errors', errors);
await browser.close(); await server.close();
