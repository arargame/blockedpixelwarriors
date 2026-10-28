// Presses real keys and reports movement RELATIVE TO THE HELICOPTER'S NOSE
// (0 = forward, 90 = to its right, 180 = backward, -90 = to its left) plus heading change.
// Runs twice: with the default heading and with the heli pre-rotated 90 degrees to the right.
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 5195, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://127.0.0.1:5195/?quality=low');
await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
await page.evaluate(() => { const g = window.__game; g.paused = true; g.handleStartInput(); });
const keysets = [['KeyW'], ['KeyS'], ['KeyA'], ['KeyD'], ['ArrowUp'], ['ArrowLeft'], ['KeyW', 'KeyD'], ['KeyQ'], ['KeyE']];
for (const startTurn of [0, -90]) {
  console.log(`--- start heading: ${startTurn === 0 ? 'default' : 'rotated 90 deg right'}`);
  for (const keys of keysets) {
    const r = await page.evaluate(([keys, startTurn]) => {
      const g = window.__game; const h = g.heli;
      h.respawn(); h.position.set(-2, h.position.y, 2); h.velocity.set(0, 0, 0);
      h.yaw += startTurn / 57.3; const yaw0 = h.yaw; const w0 = h.position.clone();
      for (const k of keys) window.dispatchEvent(new KeyboardEvent('keydown', { code: k }));
      for (let i = 0; i < 60; i++) g.step(1 / 60);
      for (const k of keys) window.dispatchEvent(new KeyboardEvent('keyup', { code: k }));
      const dx = h.position.x - w0.x; const dz = h.position.z - w0.z;
      // Heli frame at the start: forward = (-sin, -cos), right = (cos, -sin).
      const fwd = dx * -Math.sin(yaw0) + dz * -Math.cos(yaw0);
      const right = dx * Math.cos(yaw0) + dz * -Math.sin(yaw0);
      const out = { rel: Math.round(Math.atan2(right, fwd) * 57.3), dist: Math.hypot(dx, dz).toFixed(1), turn: Math.round((h.yaw - yaw0) * 57.3) };
      for (let i = 0; i < 90; i++) g.step(1 / 60);
      return out;
    }, [keys, startTurn]);
    console.log(keys.join('+').padEnd(16), `move vs nose=${r.rel}°  dist=${r.dist}  heading change=${r.turn}°`);
  }
}
await browser.close(); await server.close();
