// Headless capture tool: starts a Vite dev server, renders the poster frame and saves a PNG.
// Usage: node tools/screenshot.mjs [out.png] [width] [height] [extraQuery]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const out = process.argv[2] ?? 'captures/poster.png';
const width = Number(process.argv[3] ?? 1672);
const height = Number(process.argv[4] ?? 941);
const extra = process.argv[5] ?? '';

const server = await createServer({ server: { port: 5199, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(`http://127.0.0.1:5199/?poster&quality=high${extra}`);
try {
  await page.waitForFunction(() => window.__posterReady === true, null, { timeout: 240000 });
} catch (e) {
  console.error('Timed out waiting for poster', e.message);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out, timeout: 300000 });
console.log(`saved ${out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const l of logs.filter((l) => !l.includes('[vite]')).slice(0, 30)) console.log(l);
await browser.close();
await server.close();
