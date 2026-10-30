import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Palette } from '../config/Palette.js';
import { GameConfig } from '../config/GameConfig.js';
import { LAYERS } from '../core/RenderPipeline.js';
import { Random } from '../util/Random.js';
import { Sky } from './Sky.js';
import { Board } from './Board.js';
import { Track } from './Track.js';
import { CloudLayer } from './CloudLayer.js';
import { FloatingIslands } from './FloatingIslands.js';
import { PineTreeFactory } from './PineTreeFactory.js';
import { BillboardBatch } from '../fx/BillboardBatch.js';
import { SnowWeather, SnowFall, RailSnow, FloorSnow } from './Snow.js';
import { Terrace } from './Terrace.js';

/**
 * Static environment composition (Facade): lighting, sky, clouds, islands, forests,
 * the board and the railway. Gameplay entities are added by the Game.
 */
export class World {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.WebGLRenderer} renderer
   * @param {import('../textures/TextureFactory.js').TextureFactory} textures
   * @param {import('../textures/MaterialLibrary.js').MaterialLibrary} materials
   */
  constructor(scene, camera, renderer, textures, materials, { shadowMapSize = 4096, floorTexture = null, terraceFloorTexture = null } = {}) {
    this.scene = scene;
    this.camera = camera;
    scene.fog = new THREE.Fog(Palette.fog, 140, 520);

    // Image-based light for metal/glass reflections.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    pmrem.dispose();

    this.setupLights(shadowMapSize);

    // Backdrop (sky, islands, cloud sea) is tilted about the camera so it reads as if seen from a
    // much shallower angle than the board: horizon + cliff faces in view while the board stays
    // steep. This is the key art's "diorama" perspective cheat.
    this.backdrop = new THREE.Group();
    this.setupBackdropTilt(THREE.MathUtils.degToRad(GameConfig.camera.backdropTiltDeg ?? 0));
    scene.add(this.backdrop);

    const sunDir = this.computeVisualSunDirection();
    const sunLocal = sunDir.clone().applyQuaternion(this.backdropInverse);
    this.sky = new Sky(sunLocal);
    this.backdrop.add(this.sky.mesh);
    this.sunGlare = new BillboardBatch(textures.sunGlare(), 2, { additive: true, renderOrder: 1 });
    const sunPos = camera.position.clone().addScaledVector(sunLocal, 600);
    this.sunGlare.begin();
    this.sunGlare.push(sunPos.x, sunPos.y, sunPos.z, 190, 190, 2.0, 1.8, 1.5, 1);
    this.sunGlare.end();
    // Drawn over the far clouds (the sun sits in front of them in the key art).
    this.sunGlare.mesh.material.depthTest = false;
    this.sunGlare.mesh.renderOrder = 8;
    this.backdrop.add(this.sunGlare.mesh);

    this.board = new Board(materials, floorTexture);
    scene.add(this.board.group);
    // Stage 2 platform up the line.
    this.terrace = new Terrace(materials, terraceFloorTexture ?? floorTexture);
    scene.add(this.terrace.group);
    this.track = new Track(materials);
    scene.add(this.track.group);

    // Light snowfall + snow lying on the rails that the train plows away.
    this.weather = new SnowWeather();
    this.snowFall = new SnowFall(textures.glow(), this.weather, this.board.bounds);
    scene.add(this.snowFall.object3d);
    this.railSnow = new RailSnow(materials, this.weather, this.track, GameConfig.track.startZ + 1, GameConfig.track.endZ - 1);
    scene.add(this.railSnow.group);
    // Light snow settling and melting on the tile floor.
    this.floorSnow = new FloorSnow(this.weather, GameConfig.board);
    this.floorSnow.attach(this.board.floorMaterial);

    // Islands are placed by key-art screen position (px on 1672x941) + distance from the camera,
    // so the composition survives camera tweaks.
    this.islands = new FloatingIslands(materials, textures, [
      // Near-left mesas with waterfalls.
      { at: [190, 210, 66], radius: 6.5, depth: 19, cell: 1.35, seed: 11, waterfalls: 2, treeDensity: 0.5, treeScale: 1.35, mesa: 1.2, cliff: true },
      { at: [280, 460, 52], radius: 4.6, depth: 15, cell: 1.35, seed: 37, waterfalls: 1, treeDensity: 0.5, treeScale: 1.35, mesa: 1, cliff: true },
      { at: [40, 70, 90], radius: 8.5, depth: 19, cell: 1.35, seed: 23, waterfalls: 2, treeDensity: 0.45, treeScale: 1.35, mesa: 1.2, cliff: true },
      { at: [70, 540, 44], radius: 4, depth: 12, cell: 1.35, seed: 71, waterfalls: 1, treeDensity: 0.45, treeScale: 1.35, mesa: 1, cliff: true },
      // Far islands near the horizon (visible above the board, drifting clouds pass in front).
      { at: [380, 120, 150], radius: 9, depth: 16, cell: 2, seed: 83, waterfalls: 2, treeDensity: 0.35, treeScale: 2, mesa: 1, cliff: true },
      { at: [1580, 60, 70], radius: 10, depth: 11, cell: 1.35, seed: 41, waterfalls: 0, treeDensity: 0.55, treeScale: 1.35, mesa: 1 },
      { at: [820, -10, 100], radius: 12, depth: 12, cell: 1.35, seed: 67, waterfalls: 1, treeDensity: 0.45, treeScale: 1.35, mesa: 1 },
    ].map((spec) => this.placeOnScreen(spec)));
    this.backdrop.add(this.islands.group);

    // Grassy rock shelves beside the board (world space) so board-side pines stand on ground.
    this.shores = new FloatingIslands(materials, textures, [...this.shoreSpecs(), ...Terrace.shoreSpecs()]);
    scene.add(this.shores.group);

    this.trees = new PineTreeFactory(materials);
    this.backdrop.add(this.trees.createForest(this.islands.treePlacements));
    scene.add(this.trees.createForest(this.terrace.treePlacements));
    scene.add(this.trees.createForest(this.shores.treePlacements));
    this.foreground = this.trees.createForest(this.foregroundTrees(), { castShadow: false, layer: LAYERS.FOREGROUND, tint: 0.85 });
    scene.add(this.foreground);

    this.clouds = new CloudLayer(textures, this.cloudSpecs(), { renderOrder: 5 });
    this.backdrop.add(this.clouds.group);
    this.boardClouds = new CloudLayer(textures, this.boardCloudSpecs(), { renderOrder: 6 });
    scene.add(this.boardClouds.group);

    // The camera follows the heli up the line in stage 2: sky, horizon, cloud sea, sun shadow
    // box and the snowfall volume travel with it (things at "infinity" stay put on screen).
    this.cameraHome = camera.position.clone();
    this.backdropHome = this.backdrop.position.clone();
    this.sunHome = this.sun.position.clone();
    this.sunTargetHome = this.sun.target.position.clone();
    this.travel = new THREE.Vector3();
  }

  /** Moves the "at infinity" parts by how far the camera travelled from its home position. */
  follow() {
    this.travel.subVectors(this.camera.position, this.cameraHome);
    this.travel.y = 0;
    this.backdrop.position.copy(this.backdropHome).add(this.travel);
    // Shadow box: snap to whole units so shadow texels don't crawl while moving.
    const sx = Math.round(this.travel.x);
    const sz = Math.round(this.travel.z);
    this.sun.position.set(this.sunHome.x + sx, this.sunHome.y, this.sunHome.z + sz);
    this.sun.target.position.set(this.sunTargetHome.x + sx, this.sunTargetHome.y, this.sunTargetHome.z + sz);
    this.sun.target.updateMatrixWorld();
    this.snowFall.offset = this.travel;
  }

  setupLights(shadowMapSize) {
    const hemi = new THREE.HemisphereLight(0xa9d2ff, 0xd9c09a, 0.62);
    hemi.layers.enableAll();
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffdcae, 4.1);
    sun.position.set(-16, 26, -9);
    sun.target.position.set(-1, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const cam = sun.shadow.camera;
    cam.left = -28;
    cam.right = 28;
    cam.top = 26;
    cam.bottom = -26;
    cam.near = 1;
    cam.far = 90;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    sun.layers.enableAll();
    this.scene.add(sun, sun.target);
    this.sun = sun;

    // Cool fill from the camera side so shadowed faces stay readable (no crushed blacks).
    const fill = new THREE.DirectionalLight(0xbfdcff, 0.35);
    fill.position.set(6, 10, 20);
    fill.layers.enableAll();
    this.scene.add(fill);
  }

  /** Rotation of the backdrop about the camera's right axis, pivoting at the camera. */
  setupBackdropTilt(angle) {
    this.camera.updateMatrixWorld();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const q = new THREE.Quaternion().setFromAxisAngle(right, -angle);
    const c = this.camera.position;
    this.backdrop.quaternion.copy(q);
    this.backdrop.position.copy(c).sub(c.clone().applyQuaternion(q));
    this.backdropInverse = q.clone().invert();
  }

  /**
   * Resolves an `at: [px, py, distance]` key-art screen placement into backdrop-local x/y/z,
   * so the object lands on that pixel after the tilt and its up axis leans toward the camera.
   */
  placeOnScreen(spec) {
    if (!spec.at) return spec;
    const [px, py, dist] = spec.at;
    this.camera.updateMatrixWorld();
    const d = new THREE.Vector3(px / 1672 * 2 - 1, 1 - py / 941 * 2, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const c = this.camera.position;
    const p = d.multiplyScalar(dist).applyQuaternion(this.backdropInverse).add(c);
    return { ...spec, x: p.x, y: p.y, z: p.z };
  }

  /** Direction from the camera toward the top-left of the frame, where the sun sits in the key art. */
  computeVisualSunDirection() {
    this.camera.updateMatrixWorld();
    const p = new THREE.Vector3(-0.86, 0.9, 0.5).unproject(this.camera);
    return p.sub(this.camera.position).normalize();
  }

  /** Rock shelves with pines hugging the board's far-right side and far edge (key art top-right). */
  shoreSpecs() {
    const b = GameConfig.board;
    return [
      { x: b.maxX + 4.2, y: -0.2, z: b.minZ + 1, radius: 4.2, depth: 6, cell: 1, seed: 501, waterfalls: 1, treeDensity: 0.55, treeScale: 1.1, mesa: 0.6, cliff: true },
      { x: b.maxX + 2.5, y: -0.5, z: b.minZ - 5.5, radius: 3.6, depth: 5, cell: 1, seed: 503, waterfalls: 0, treeDensity: 0.6, treeScale: 1.1, mesa: 0.6, cliff: true },
      { x: b.minX + 7, y: -0.6, z: b.minZ - 5, radius: 3.4, depth: 5, cell: 1, seed: 507, waterfalls: 1, treeDensity: 0.5, treeScale: 1.0, mesa: 0.5, cliff: true },
    ];
  }

  /**
   * Big out-of-focus pines framing the shot, placed in screen space relative to the
   * base camera so they stay in the corners like the key art.
   */
  foregroundTrees() {
    const spots = [
      { ndc: [-0.97, -0.08], depth: 18, scale: 1.7, variant: 3 },
      { ndc: [-0.8, -0.32], depth: 15, scale: 1.45, variant: 3 },
      { ndc: [-0.93, -0.7], depth: 12, scale: 1.3, variant: 3 },
      { ndc: [-0.66, -0.82], depth: 12.5, scale: 1.05, variant: 3 },
      { ndc: [0.97, -0.62], depth: 14, scale: 1.4, variant: 3 },
    ];
    this.camera.updateMatrixWorld();
    return spots.map((s, i) => {
      const p = new THREE.Vector3(s.ndc[0], s.ndc[1], 0.5).unproject(this.camera).sub(this.camera.position).normalize();
      p.multiplyScalar(s.depth).add(this.camera.position);
      return { x: p.x, y: p.y - s.scale * 2.4, z: p.z, scale: s.scale, rot: i * 1.3, variant: s.variant };
    });
  }

  cloudSpecs() {
    const rng = new Random(808);
    const out = [];
    // Sea of clouds below and around the board.
    for (let i = 0; i < 70; i++) {
      out.push({
        x: rng.range(-85, 85), y: rng.range(-26, -12), z: rng.range(-95, 35),
        size: rng.range(26, 46), variant: rng.int(0, 2), drift: rng.range(0.2, 0.6), tint: rng.range(0.95, 1.08),
      });
    }
    // Distant cloud bank along the horizon: big puffs drifting slowly across the sky (wrap around).
    for (let i = 0; i < 26; i++) {
      const dist = rng.range(130, 260);
      const p = this.placeOnScreen({ at: [rng.range(-200, 1872), rng.range(60, 330), dist] });
      out.push({ x: p.x, y: p.y, z: p.z, size: dist * rng.range(0.14, 0.26), variant: rng.int(0, 2), drift: rng.range(0.8, 2.2), wrap: 320, tint: rng.range(1.0, 1.1) });
    }
    // Puffs floating between the islands and toward the horizon.
    for (let i = 0; i < 26; i++) {
      const left = rng.chance(0.65);
      out.push({
        x: left ? rng.range(-60, -26) : rng.range(18, 60), y: rng.range(-10, -2), z: rng.range(-90, 10),
        size: rng.range(10, 20), variant: rng.int(0, 2), drift: rng.range(0.2, 0.5), tint: 1.04,
      });
    }
    return out;
  }

  boardCloudSpecs() {
    const rng = new Random(909);
    const b = GameConfig.board;
    const out = [];
    // Clouds spilling over the left and near frame (like the key art).
    for (let i = 0; i < 8; i++) {
      out.push({ x: b.minX - rng.range(2.5, 6), y: rng.range(-3.4, -2.0), z: rng.range(b.minZ - 2, b.maxZ), size: rng.range(2.5, 4), variant: rng.int(0, 2), drift: 0, tint: 1.065 });
    }
    for (let i = 0; i < 10; i++) {
      out.push({ x: rng.range(b.minX + 2, b.maxX + 2), y: rng.range(-2.6, -1.4), z: b.maxZ + rng.range(1.5, 3.5), size: rng.range(3, 4.5), variant: rng.int(0, 2), drift: 0, tint: 1.065 });
    }
    // Cloud sea under the trestle bridge and the terrace (stage 2): low, wide puffs in world space
    // so the open sky under the bridge reads as clouds, not as empty haze.
    const r3 = new Random(929);
    for (let x = -30; x <= 36; x += 8.5) {
      for (let z = -100; z <= -16; z += 8.5) {
        out.push({ x: x + r3.spread(3), y: r3.range(-12, -8.5), z: z + r3.spread(3), size: r3.range(10, 15), variant: r3.int(0, 2), drift: 0, tint: r3.range(1.0, 1.06) });
      }
    }
    // Puffs around the terrace (stage 2), well clear of the bridge and the platform.
    const t = GameConfig.stages.terrace;
    const r2 = new Random(919);
    for (let i = 0; i < 16; i++) {
      const left = r2.chance(0.5);
      out.push({ x: left ? t.minX - r2.range(8, 13) : t.maxX + r2.range(8, 13), y: r2.range(-4.5, -3), z: r2.range(t.minZ - 2, t.maxZ + 2), size: r2.range(3, 5), variant: r2.int(0, 2), drift: 0, tint: 1.065 });
    }
    return out;
  }

  update(dt) {
    this.follow();
    this.sky.update(this.camera);
    this.clouds.update(dt, this.camera, Math.min(1, this.travel.length() / 12));
    this.boardClouds.update(dt, this.camera);
    this.weather.update(dt);
    this.snowFall.update(dt);
    this.islands.update(dt);
    this.shores.update(dt);
  }
}
