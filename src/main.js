import { Game } from './core/Game.js';
import { loadHelicopterGltf } from './entities/HelicopterGltf.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import rocketUrl from '../assets/models/rocket.glb?url';
import * as THREE from 'three';
import marbleUrl from '../assets/textures/marble_tile.jpg?url';

/**
 * Entry point. URL options:
 *   ?quality=high|medium|low   rendering preset (auto: low on phones)
 *   ?poster                    stage and render the key-art moment (used by the capture tool)
 */
const params = new URLSearchParams(window.location.search);
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const quality = params.get('quality') ?? (isMobile ? 'medium' : 'high');
const poster = params.has('poster');

// ?cam=x,y,z,pitchDeg,yawDeg,fov,lensK  (art-direction override used while matching the key art)
const camOverride = params.get('cam')?.split(',').map(Number);

(async () => {
  // Blender helicopter (falls back to the procedural one with ?procedural or on load failure).
  const [heliGltf, floorTexture, rocketGltf] = await Promise.all([
    params.has('procedural') ? null : loadHelicopterGltf(),
    new THREE.TextureLoader().loadAsync(marbleUrl).catch(() => null),
    new GLTFLoader().loadAsync(rocketUrl).catch(() => null),
  ]);
  const game = new Game(document.getElementById('app'), { quality, poster, camOverride, heliGltf, floorTexture });
  if (poster || params.has('fixedres')) game.pipeline.adaptive = false;
  window.__game = game;
  game.projectiles.setMissileModel(rocketGltf?.scene ?? null);

  if (poster) {
    game.renderPoster({ logo: params.has('logo'), hideHeli: params.has('noheli') });
  } else {
    game.start();
  }
})();
