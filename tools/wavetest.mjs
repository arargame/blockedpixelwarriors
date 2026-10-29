// No spiked balls before the SURPRISE EGG card; the train grows by one wagon per wave.
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 5203, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5203/?quality=low');
await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
const out = await page.evaluate(() => {
  const g = window.__game; g.paused = true; g.hud.overlayEl.style.transition = 'none'; g.handleStartInput(); g.heli.takeDamage = () => false;
  const res = { ballsAtStart: g.mines.mines.length };
  // Clear the board without the card: still no balls.
  for (const b of g.blocks.blocks) if (b.alive) g.blocks.takeBlock(b);
  for (let i = 0; i < 90; i++) g.step(1 / 30);
  res.ballsEmptyBoardNoCard = g.mines.mines.length;
  g.takenCards.add('surpriseEgg');
  for (let i = 0; i < 30; i++) g.step(1 / 30);
  res.ballsWithCard = g.mines.mines.filter((m) => m.alive).length;
  // Board refilled -> no new eggs while blocks remain.
  res.wagons = [];
  for (let w = 0; w < 10; w++) { g.spawnTrain(); res.wagons.push(g.train.cars.length - 1); }
  g.spawnTrain = g.spawnTrain; g.step(1 / 30);
  res.panelCars = document.querySelectorAll('.train-cars .car').length;
  const r = document.querySelector('.train-panel').getBoundingClientRect();
  res.panelFits = r.left >= 0 && r.right <= innerWidth;
  return res;
});
await page.screenshot({ path: 'captures/long_train_hud.png', timeout: 120000 });
console.log(JSON.stringify(out), errors);
await browser.close(); await server.close();
