// Card readability: cards stay sharp while the game renders at a low pixel ratio; pointing at the
// picture fades banner + text to show the whole painting; toasts fly into the log feed.
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 5201, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://127.0.0.1:5201/?quality=high');
await page.waitForFunction(() => !!window.__game && window.__game.cards.loaded, null, { timeout: 120000 });
const out = {};
await page.evaluate(() => {
  const g = window.__game; g.paused = true; g.hud.overlayEl.style.transition = 'none'; g.handleStartInput();
  g.heli.takeDamage = () => false;
  g.pipeline.adaptive = false; g.pipeline.renderer.setPixelRatio(0.6); g.pipeline.resize();
  for (let i = 0; i < 60; i++) g.step(1 / 30);
  // A few feed events.
  g.hud.kill('HELI', '#7be86a', 'TURRET', '#c9ced6', ['+100', '#ffd34a']);
  g.hud.kill('ENGINEER', '#ffcf6a', 'RED PACKAGE', '#ff6b6b', ['→ dock', 'rgba(255,255,255,0.6)']);
  g.hud.kill('HELI', '#7be86a', 'BLUE GEM · RAPID FIRE', '#5ab8ff');
  g.hud.toast('TRAIN DESTROYED! +500');
});
await page.waitForTimeout(2900); // toast flies into the log
out.feed = await page.evaluate(() => [...document.querySelectorAll('.log-line')].map((l) => l.textContent));
await page.evaluate(async () => {
  const g = window.__game;
  const { CARD_DEFS } = await import('/src/ui/UpgradeCards.js');
  await g.cards.show([CARD_DEFS.find((d) => d.id === 'cargoChopper'), CARD_DEFS.find((d) => d.id === 'surpriseEgg')], () => {});
  for (let i = 0; i < 60; i++) g.step(1 / 30);
  g.pipeline.render(1 / 60);
});
await page.screenshot({ path: 'captures/cards_sharp.png', timeout: 120000 });
// Point at the picture of the first card -> inspect.
out.inspect = await page.evaluate(() => {
  const g = window.__game; const c = g.cards.cards[0];
  const p = c.object.localToWorld(c.object.position.clone().set(0, 0.2, 0)).project(g.cards.camera);
  g.cards.pointer.set(p.x, p.y);
  for (let i = 0; i < 30; i++) g.step(1 / 30);
  g.pipeline.render(1 / 60);
  return { onArt: g.cards.hoverOnArt, reveal: +c.reveal.value.toFixed(2), other: +g.cards.cards[1].reveal.value.toFixed(2) };
});
await page.screenshot({ path: 'captures/cards_inspect.png', timeout: 120000 });
out.backToText = await page.evaluate(() => {
  const g = window.__game; const c = g.cards.cards[0];
  const p = c.object.localToWorld(c.object.position.clone().set(0, -0.32, 0)).project(g.cards.camera);
  g.cards.pointer.set(p.x, p.y);
  for (let i = 0; i < 30; i++) g.step(1 / 30);
  return { onArt: g.cards.hoverOnArt, reveal: +c.reveal.value.toFixed(2) };
});
console.log(JSON.stringify(out, null, 1));
console.log('errors', errors);
await browser.close();
await server.close();
