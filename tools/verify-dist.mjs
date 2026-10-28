// Opens dist/index.html straight from disk (file://), renders the poster frame and reports page errors.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('file://' + process.cwd() + '/dist/index.html?poster&logo&quality=high');
await page.waitForFunction(() => window.__posterReady === true, null, { timeout: 240000 });
await page.screenshot({ path: 'captures/final_poster.png' });
console.log('errors', errs);
await browser.close();
