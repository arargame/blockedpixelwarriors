// Exports meshes, textures, fonts and scene data from the running Three.js game into the MonoGame
// project (MonoGame/BlockedPixelWarriors.Shared/Content), plus half-size textures for mobile
// (Content.Mobile). Run after changing art in the web version:  node tools/export-monogame.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const root = path.resolve('MonoGame/BlockedPixelWarriors.Shared');
const content = path.join(root, 'Content');
const mobile = path.join(root, 'Content.Mobile');
const server = await createServer({ server: { port: 5210, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let files = 0;
await page.exposeFunction('bpwSave', (rel, base64) => {
  const out = path.join(content, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(base64, 'base64'));
  files++;
});
await page.goto('http://127.0.0.1:5210/?quality=high&fixedres');
await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
const report = await page.evaluate(async () => {
  window.__game.paused = true; // stop the render loop: the export only reads the scene
  const { exportAll } = await import('/tools/monogame-export/exporter.js');
  return exportAll(window.__game, (p, b) => window.bpwSave(p, b));
});
await browser.close();
await server.close();

// Mobile textures: half size (min 32 px), same names. Fonts and UI art stay full size.
fs.mkdirSync(path.join(mobile, 'Textures'), { recursive: true });
const py = `
import sys, os
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
for f in os.listdir(src):
    if not f.endswith('.png') or f.startswith('.'): continue
    im = Image.open(os.path.join(src, f))
    if f.startswith('ui_'):
        im.save(os.path.join(dst, f)); continue
    w, h = im.size
    im = im.resize((max(32, w // 2), max(32, h // 2)), Image.LANCZOS)
    im.save(os.path.join(dst, f), optimize=True)
`;
execFileSync('python3', ['-c', py, path.join(content, 'Textures'), path.join(mobile, 'Textures')]);
console.log(JSON.stringify(report.models, null, 1));
console.log(`${files} files, ${report.textures.length} textures`, errors);
