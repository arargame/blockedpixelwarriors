// NEON RAIN comparison centre: renders the night level's key-art moment (?poster&night) at the
// key art's size (1672 x 941) and compares it with assets/textures/menu/night.jpg
// (tools/night/compare_art.py: side by side, 50/50 blend, art edges over the render, scored
// regions).
//
//   node tools/night/compare.mjs [out_dir=captures/night] [tag=cmp] [extraQuery]
//   (PORT=5214 node ... to run two comparisons side by side)
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const out = process.argv[2] ?? 'captures/night';
const tag = process.argv[3] ?? 'cmp';
const extra = process.argv[4] ?? '';
fs.mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 5213);
const server = await createServer({ server: { port, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/?poster&night&quality=high&fixedres${extra}`);
await page.waitForFunction(() => window.__posterReady === true, null, { timeout: 600000 });
// Freeze the game loop and grab the staged frame straight off the canvas (render + read in one
// task, so the drawing buffer is still there): slow software GL never has to composite a frame
// for a page screenshot.
const render = path.join(out, `${tag}_render.png`);
const png = await page.evaluate(() => {
  const g = window.__game;
  g.paused = true;
  g.pipeline.render(1 / 60);
  return g.pipeline.renderer.domElement.toDataURL('image/png');
});
fs.writeFileSync(render, Buffer.from(png.split(',')[1], 'base64'));
console.log(`rendered ${render} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const l of logs.slice(0, 20)) console.log(l);
await browser.close();
await server.close();
console.log(execFileSync('python3', [path.join(path.dirname(new URL(import.meta.url).pathname), 'compare_art.py'), render, out, '--name', tag]).toString());
