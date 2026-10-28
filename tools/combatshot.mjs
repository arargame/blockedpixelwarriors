// Combat frame: train halted on the board, twin turret bullets + a cannonball in flight,
// one turret breaking apart, the gem shield up.
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 5197, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5197/?quality=high&fixedres');
await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
await page.evaluate(() => {
  const g = window.__game; g.paused = true; g.hud.overlayEl.style.transition = 'none'; g.handleStartInput();
  g.heli.takeDamage = () => false;
  const dt = 1 / 30;
  for (let i = 0; i < 600 && (!g.train || g.train.headZ < 1); i++) g.step(dt);
  const t = g.train; t.cruise = t.speed = 0.0001; t.stopAtZ = null; t.setHeadZ(6);
  t.cannonTimer = 0.3;
  for (let i = 0; i < 70; i++) { g.heli.position.set(-2.5, 2.75, 1); g.heli.velocity.set(0, 0, 0); g.heli.yaw = -1.2; g.step(dt); }
  // Break the locomotive turret right now.
  const loco = t.cars[0]; const tur = loco.targets.find((x) => x.kind === 'turret');
  t.damage(loco, tur, 100, g.heli.position.clone());
  t.cannonTimer = 0;
  for (let i = 0; i < 9; i++) { g.heli.position.set(-2.5, 2.75, 1); g.heli.velocity.set(0, 0, 0); g.step(dt); }
  g.pipeline.render(dt);
});
await page.screenshot({ path: 'captures/combat_train_weapons.png', timeout: 120000 });
console.log('errors', errors);
await browser.close();
await server.close();
