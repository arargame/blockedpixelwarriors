// Renders only the voxel logo to a PNG for quick iteration.
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 5197, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
await page.goto('http://127.0.0.1:5197/tools/logo.html');
await page.waitForFunction(() => window.__done === true);
await page.screenshot({ path: process.argv[2] ?? 'captures/tmp/logo.png' });
await browser.close(); await server.close();
