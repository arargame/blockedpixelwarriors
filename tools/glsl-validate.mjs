// Compiles the MonoGame port's generated GLSL (EffectPacker --dump <dir>) with WebGL 1 / GLSL ES 1.00
// in headless Chromium (ANGLE's strict validator) to catch shader errors before they hit phones.
// Usage: node tools/glsl-validate.mjs <dumpDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.vert') || f.endsWith('.frag'));
const sources = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const results = await page.evaluate((src) => {
  const gl = document.getElementById('c').getContext('webgl');
  gl.getExtension('OES_standard_derivatives');
  const out = {};
  for (const [name, code] of Object.entries(src)) {
    const sh = gl.createShader(name.endsWith('.vert') ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER);
    gl.shaderSource(sh, code);
    gl.compileShader(sh);
    out[name] = gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? 'ok' : gl.getShaderInfoLog(sh);
  }
  return out;
}, sources);
let bad = 0;
for (const [name, r] of Object.entries(results)) {
  if (r !== 'ok') bad++;
  console.log(r === 'ok' ? `ok    ${name}` : `FAIL  ${name}\n${r}`);
}
await browser.close();
process.exit(bad ? 1 : 0);
