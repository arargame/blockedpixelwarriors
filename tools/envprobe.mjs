// Measures the RoomEnvironment (PMREM, sigma 0.04) lighting the web build uses, so the MonoGame
// port can reproduce it: diffuse irradiance per normal direction and specular radiance per roughness.
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { port: 5197, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
await page.goto('http://127.0.0.1:5197/index.html');
const result = await page.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const { RoomEnvironment } = await import('/node_modules/three/examples/jsm/environments/RoomEnvironment.js');
  const renderer = new THREE.WebGLRenderer();
  renderer.toneMapping = THREE.NoToneMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType });
  const out = {};
  const probe = (normal, rough, metal) => {
    // A tiny plane facing `normal`, seen head-on (view = normal) by an orthographic camera.
    const scene = new THREE.Scene();
    scene.environment = env;
    scene.environmentIntensity = 1;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: metal });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    const n = new THREE.Vector3(...normal).normalize();
    plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    scene.add(plane);
    const cam = new THREE.OrthographicCamera(-0.1, 0.1, 0.1, -0.1, 0.1, 10);
    cam.position.copy(n).multiplyScalar(2);
    cam.up.set(n.y > 0.9 || n.y < -0.9 ? 0 : 0, n.y > 0.9 || n.y < -0.9 ? 0 : 1, n.y > 0.9 || n.y < -0.9 ? 1 : 0);
    cam.lookAt(0, 0, 0);
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    const px = new Float32Array(4);
    renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, px);
    return [px[0], px[1], px[2]].map((v) => Math.round(v * 1000) / 1000);
  };
  for (const [name, n] of Object.entries({ up: [0, 1, 0], down: [0, -1, 0], px: [1, 0, 0], nx: [-1, 0, 0], pz: [0, 0, 1], nz: [0, 0, -1] })) {
    out[`diffuse_${name}`] = probe(n, 1, 0);
  }
  for (const r of [0.05, 0.2, 0.35, 0.5, 0.75, 1]) {
    out[`metal_r${r}_up`] = probe([0, 1, 0], r, 1);
    out[`metal_r${r}_y80`] = probe([0, 5.67, 1], r, 1);
    out[`metal_r${r}_y60`] = probe([0, 1.732, 1], r, 1);
    out[`metal_r${r}_y45`] = probe([0, 1, 1], r, 1);
    out[`metal_r${r}_y20`] = probe([0, 0.364, 1], r, 1);
    out[`metal_r${r}_pz`] = probe([0, 0, 1], r, 1);
    out[`metal_r${r}_px`] = probe([1, 0, 0], r, 1);
    out[`metal_r${r}_down`] = probe([0, -1, 0], r, 1);
  }
  return out;
});
console.log(JSON.stringify(result, null, 1));
await browser.close();
await server.close();
