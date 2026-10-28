// Flight-model check: pull the stick back from a forward heading and log yaw / velocity / attitude.
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 5196, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto('http://127.0.0.1:5196/?quality=low');
await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
const log = await page.evaluate(() => {
  const g = window.__game; g.paused = true; g.handleStartInput();
  const out = []; const dt = 1 / 60; const h = g.heli;
  const run = (x, y, secs, label) => {
    for (let i = 0; i < secs * 60; i++) {
      g.input.dragVector = { x, y }; g.step(dt);
      if (i % 15 === 14) {
        const fwd = h.velocity.x * -Math.sin(h.yaw) + h.velocity.z * -Math.cos(h.yaw);
        out.push(`${label} t=${((i + 1) / 60).toFixed(2)} yawDeg=${(h.yaw * 57.3).toFixed(0)} fwdSpeed=${fwd.toFixed(2)} pitch=${h.tiltPitch.toFixed(2)} roll=${h.tiltRoll.toFixed(2)}`);
      }
    }
  };
  run(0, -1, 1.0, 'forward');
  run(0, 1, 3.0, 'back');
  run(1, 0, 1.5, 'right');
  run(0, 0, 1.0, 'release');
  return out;
});
console.log(log.join('\n'));
await browser.close(); await server.close();
