// Calibration capture for the MonoGame port: the initial scene right after loading (no simulation
// step: no train, heli at the anchor), HUD hidden. Usage: node tools/staticshot.mjs out.png [w] [h]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] ?? 'captures/static.png';
const width = Number(process.argv[3] ?? 1672);
const height = Number(process.argv[4] ?? 941);
const server = await createServer({ server: { port: 5198, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height } });
await page.goto('http://127.0.0.1:5198/?quality=high&fixedres');
await page.waitForFunction(() => !!window.__game, null, { timeout: 240000 });
// Read the canvas in the same task as the render (no preserveDrawingBuffer needed).
const dataUrl = await page.evaluate(() => {
  const g = window.__game;
  g.paused = true;
  g.world.update(0);
  g.pipeline.render(0);
  return g.pipeline.renderer.domElement.toDataURL('image/png');
});
fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(`saved ${out}`);
await browser.close();
await server.close();
