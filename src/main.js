import { Game } from './core/Game.js';
import { loadHelicopterGltf } from './entities/HelicopterGltf.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import rocketUrl from '../assets/models/rocket.glb?url';
import bulletUrl from '../assets/models/bullet.glb?url';
import forkliftUrl from '../assets/models/forklift.glb?url';
import chinookUrl from '../assets/models/chinook.glb?url';
import cardUrl from '../assets/models/card.glb?url';
import haulerUrl from '../assets/models/hauler.glb?url';
import plasmaUrl from '../assets/models/plasma.glb?url';
import * as THREE from 'three';
import { Settings } from './core/Settings.js';
import marbleUrl from '../assets/textures/marble_tile.jpg?url';
import terraceTileUrl from '../assets/textures/terrace_tile.jpg?url';

/**
 * Entry point. URL options:
 *   ?quality=high|medium|low   rendering preset (auto: low on phones)
 *   ?poster                    stage and render the key-art moment (used by the capture tool)
 */
const params = new URLSearchParams(window.location.search);
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const quality = Settings.startupQuality(params.get('quality'), isMobile);
const settings = new Settings();
const poster = params.has('poster');

// ?cam=x,y,z,pitchDeg,yawDeg,fov,lensK  (art-direction override used while matching the key art)
const camOverride = params.get('cam')?.split(',').map(Number);

(async () => {
  // Blender helicopter (falls back to the procedural one with ?procedural or on load failure).
  // Blender props: rocket, turret bullet, engineer's forklift, CH-47F cargo chopper.
  const load = (url) => new GLTFLoader().loadAsync(url).catch(() => null);
  const [heliGltf, floorTexture, rocketGltf, bulletGltf, forkliftGltf, chinookGltf, cardGltf, haulerGltf, terraceFloorTexture, plasmaGltf] = await Promise.all([
    params.has('procedural') ? null : loadHelicopterGltf(),
    new THREE.TextureLoader().loadAsync(marbleUrl).catch(() => null),
    load(rocketUrl),
    load(bulletUrl),
    load(forkliftUrl),
    load(chinookUrl),
    load(cardUrl),
    load(haulerUrl),
    // Stage 2 terrace tiles: beige marble with white veins.
    new THREE.TextureLoader().loadAsync(terraceTileUrl).catch(() => null),
    load(plasmaUrl),
  ]);
  const game = new Game(document.getElementById('app'), { quality, settings, poster, camOverride, heliGltf, floorTexture, terraceFloorTexture, forkliftGltf, chinookGltf, cardGltf, haulerGltf });
  if (poster || params.has('fixedres')) game.pipeline.adaptive = false;
  window.__game = game;
  game.projectiles.setMissileModel(rocketGltf?.scene ?? null);
  // Turret bullet at the barrels' calibre (train is scaled x1.6).
  game.projectiles.setModel('shell', bulletGltf?.scene ?? null, { scale: 1.6 });
  // T / D power-up bolts: 3D Blender plasma (crystal head, rings, twisted fins), rolling in flight.
  const bolt = (name) => plasmaGltf?.scene.getObjectByName(name) ?? null;
  game.projectiles.setModel('plasma', bolt('PlasmaBolt'), { scale: 1.7, roll: true, max: 200, emissive: 0.75, shadow: false });
  game.projectiles.setModel('nova', bolt('NovaBolt'), { scale: 1.4, roll: true, max: 200, emissive: 0.75, shadow: false });

  if (poster) {
    game.renderPoster({ logo: params.has('logo'), hideHeli: params.has('noheli') });
  } else {
    game.start();
  }
})();
