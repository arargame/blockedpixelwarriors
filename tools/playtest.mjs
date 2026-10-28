// Headless gameplay smoke test. Rendering every frame is too slow on a software GPU,
// so the loop is paused and the simulation is stepped manually with scripted input.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';

const server = await createServer({ server: { port: 5197, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`); });
await page.goto('http://127.0.0.1:5197/?quality=low');
await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
await page.evaluate(() => { window.__game.paused = true; });
fs.mkdirSync('captures/tmp', { recursive: true });

const run = (script) => page.evaluate(script);
await run(() => {
  const g = window.__game;
  g.hud.overlayEl.style.transition = 'none';
  g.handleStartInput();
  const dt = 1 / 30;
  const seq = [[0, -1, 60], [1, 0, 60], [0, 0, 120], [-1, 0.3, 90], [0, 0, 300]];
  for (const [x, z, n] of seq) {
    for (let i = 0; i < n; i++) {
      g.input.dragVector = { x, y: z };
      g.step(dt);
    }
  }
  g.input.dragVector = { x: 0, y: 0 };
  g.pipeline.render(dt);
});
await page.screenshot({ path: 'captures/tmp/play_1.png' });
const state = await run(() => {
  const g = window.__game;
  const info = g.pipeline.renderer.info;
  return {
    state: g.state, score: g.score, hp: g.heli.hp, lives: g.lives, wave: g.wave,
    heli: g.heli.position.toArray().map((v) => +v.toFixed(2)), trainHeadZ: g.train && +g.train.headZ.toFixed(1),
    blocksAlive: g.blocks.blocks.filter((b) => b.alive).length, blocksTotal: g.blocks.blocks.length,
    projectiles: g.projectiles.items.length, debris: g.effects.debris.items.length,
    drawCalls: info.render.calls, triangles: info.render.triangles, programs: info.programs.length,
  };
});
console.log(JSON.stringify(state, null, 1));
console.log('errors:', errors.slice(0, 20));
await browser.close();
await server.close();
