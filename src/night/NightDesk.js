import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GameConfig } from '../config/GameConfig.js';
import { LAYERS } from '../core/RenderPipeline.js';
import { Random } from '../util/Random.js';
import { createCanvas, canvasToTexture } from '../textures/CanvasUtils.js';
import { NIGHT_PROPS, DESK_CUBES, NIGHT_WINDOW, DESK_Y } from './NightLayout.js';

const v1 = new THREE.Vector3();

/**
 * The key art's desk diorama round the night arena (assets/models/night_desk.glb from
 * tools/blender/build_night_desk.py, placed by NightLayout.js):
 *   tray      the varnished wooden tray with its corner posts and dome bolts; the deck inside
 *             (wet slate, reflections) is the field
 *   desk      the dark walnut desk top, wet (WetReflection), water beading on it and the beams
 *   props     the brass desk lamp (the key light), the coffee mug, the steel ammo crates, the
 *             pencil on the sketch, the pothos plants (the front one out of focus), cubes
 *   window    the rainy window behind the desk: a painted bokeh city (cyan / blue / pink neon)
 *   lights    the lamp's warm spot (shadows) over the tray's top-left corner, the cold window
 *             light from the back right, a pink neon spill over the field, a dim blue sky
 * rainLights lists the light sources for the rain shader.
 */
export class NightDesk {
  constructor(gltf, nightTextures, reflection, materials, { shadowMap = 2048 } = {}) {
    this.group = new THREE.Group();
    this.kit = gltf?.scene ?? new THREE.Group();
    this.textures = nightTextures;
    this.reflection = reflection;
    this.materials = materials;
    this.rng = new Random(77);
    this.floors = [];
    this.rainLights = [];
    this.time = 0;
    this.flash = 0;
    this.lightningTimer = 7;
    this.lightningSeq = [];
    this.tune();
    this.buildTray();
    this.buildDesk();
    this.buildProps();
    this.buildCubes();
    this.buildWindow();
    this.buildDroplets();
    this.buildLights(shadowMap);
  }

  piece(name) {
    const src = this.kit.getObjectByName(name);
    if (!src) return new THREE.Group();
    const o = src.clone(true);
    o.traverse((m) => {
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return o;
  }

  /** Game-side material strengths (Blender's emission and gloss read differently in three.js). */
  tune() {
    this.kit.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || m.userData.tuned) continue;
        m.userData.tuned = true;
        if (m.name === 'LampBulb') m.emissiveIntensity = 14;
        if (m.name === 'ShadeInside') m.emissiveIntensity = 2.6;
        if (/^(LampBulb|ShadeInside|ShadeEnamel)$/.test(m.name)) m.side = THREE.DoubleSide;
        if (m.name === 'TrayWood') {
          m.roughness = 0.3;
          m.envMapIntensity = 0.7;
        }
        if (m.name === 'DeskWood') {
          m.roughness = 0.28;
          this.deskMaterial = m;
        }
        if (m.name === 'MugEnamel') m.roughness = 0.14;
      }
    });
    if (this.deskMaterial) this.reflection.wet(this.deskMaterial, { wetMap: this.textures.wet(), wetScale: 1 / 18, strength: 0.9, puddle: 0.9, darken: 0.35 });
  }

  buildTray() {
    const N = GameConfig.night;
    this.tray = this.piece('NightTray');
    this.group.add(this.tray);
    const field = this.textures.field();
    const fw = N.maxX - N.minX;
    const fd = N.maxZ - N.minZ;
    const m = new THREE.MeshStandardMaterial({ color: 0xb4c8ea, roughness: 0.28, metalness: 0.15, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.8 });
    m.map = field.map.clone();
    m.map.repeat.set(fw / (2 * N.block), fd / (2 * N.block));
    m.map.needsUpdate = true;
    m.normalMap = field.normalMap.clone();
    m.normalMap.repeat.copy(m.map.repeat);
    m.normalMap.needsUpdate = true;
    this.reflection.wet(m, { wetMap: this.textures.wet(), wetScale: 1 / 9, strength: 1.3, puddle: 1, darken: 0.55 });
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd).rotateX(-Math.PI / 2), m);
    deck.position.set((N.minX + N.maxX) / 2, 0, (N.minZ + N.maxZ) / 2);
    deck.receiveShadow = true;
    this.floors.push(deck);
    this.group.add(deck);
  }

  buildDesk() {
    this.desk = this.piece('DeskTop');
    this.desk.traverse((o) => {
      if (o.isMesh) this.floors.push(o);
    });
    this.group.add(this.desk);
  }

  buildProps() {
    for (const p of NIGHT_PROPS) {
      const o = this.piece(p.name);
      o.position.set(...p.pos);
      o.rotation.y = p.rotY ?? 0;
      o.scale.setScalar(p.scale ?? 1);
      if (p.layer === 'fore') {
        o.traverse((m) => {
          m.layers.set(LAYERS.FOREGROUND);
          if (m.isMesh) m.castShadow = false;
        });
      }
      this.group.add(o);
      if (p.name === 'DeskLamp') this.lamp = o;
    }
  }

  buildCubes() {
    const geo = new RoundedBoxGeometry(1, 1, 1, 3, 0.07);
    this.cubes = [];
    for (const [color, x, z, s, r] of DESK_CUBES) {
      const m = new THREE.Mesh(geo, this.materials.block(color));
      m.userData.color = color;
      this.cubes.push(m);
      m.scale.setScalar(s);
      m.position.set(x, DESK_Y + s / 2, z);
      m.rotation.y = r;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  /** The rainy window: night city bokeh behind streaming glass, painted once into a canvas. */
  buildWindow() {
    const W = 2048;
    const H = 256;
    const c = createCanvas(W, H);
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#081226');
    bg.addColorStop(0.6, '#0c1e40');
    bg.addColorStop(1, '#0a1530');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    const r = this.rng;
    const glow = (x, y, rad, col, a) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, col.replace('A', a));
      gr.addColorStop(1, col.replace('A', 0));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    };
    // Far city: soft blobs of window light.
    for (let i = 0; i < 110; i++) {
      const pick = r.next();
      const col = pick < 0.45 ? 'rgba(60,150,255,A)' : pick < 0.7 ? 'rgba(40,230,255,A)' : pick < 0.88 ? 'rgba(255,60,190,A)' : 'rgba(255,190,110,A)';
      glow(r.next() * W, H * (0.1 + r.next() * 0.85), 6 + r.next() * 22, col, 0.15 + r.next() * 0.35);
    }
    // Neon bars (the art's cyan strip top-left of centre and the pink signs on the right).
    const bar = (x, y, w, h, col, a) => {
      g.save();
      g.shadowColor = col.replace('A', 1);
      g.shadowBlur = 40;
      g.fillStyle = col.replace('A', a);
      g.fillRect(x, y, w, h);
      g.restore();
    };
    bar(W * 0.3, H * 0.55, W * 0.14, 6, 'rgba(70,220,255,A)', 0.9);
    bar(W * 0.6, H * 0.25, 10, H * 0.5, 'rgba(255,70,200,A)', 0.85);
    bar(W * 0.63, H * 0.3, 8, H * 0.4, 'rgba(255,90,170,A)', 0.7);
    bar(W * 0.66, H * 0.7, W * 0.06, 5, 'rgba(120,170,255,A)', 0.8);
    bar(W * 0.48, H * 0.2, W * 0.04, 5, 'rgba(255,80,220,A)', 0.7);
    // Window mullions.
    g.fillStyle = '#04060b';
    for (const x of [0.25, 0.75]) g.fillRect(W * x - 8, 0, 16, H);
    // Rain running down the glass.
    g.strokeStyle = 'rgba(190,220,255,0.22)';
    for (let i = 0; i < 900; i++) {
      const x = r.next() * W;
      const y = r.next() * H;
      const L = 8 + r.next() * 40;
      g.lineWidth = 0.6 + r.next() * 1.4;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + r.spread(4), y + L);
      g.stroke();
    }
    const tex = canvasToTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.4, 2.4, 2.4), fog: false, toneMapped: true });
    const w = NIGHT_WINDOW;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w.width, w.height), mat);
    // Faces the camera (-z).
    plane.rotation.y = Math.PI;
    plane.position.set(0, w.bottom + w.height / 2, w.z);
    this.group.add(plane);
    this.window = plane;
  }

  /** Water beading on the beam tops and the desk round the tray. */
  buildDroplets() {
    const N = GameConfig.night;
    const geo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6f8296, roughness: 0.02, metalness: 0.2, envMapIntensity: 2.5, transparent: true, opacity: 0.55 });
    const spots = [];
    const r = this.rng;
    const beam = 1.25;
    for (let i = 0; i < 420; i++) {
      // Beam tops (all four beams).
      const side = Math.floor(r.next() * 4);
      let x;
      let z;
      if (side < 2) {
        x = (side ? 1 : -1) * (N.maxX + 0.12 + r.next() * (beam - 0.24));
        z = N.minZ - 1 + r.next() * (N.maxZ - N.minZ + 2);
      } else {
        x = N.minX - 1 + r.next() * (N.maxX - N.minX + 2);
        z = side === 2 ? N.minZ - 0.12 - r.next() * (beam - 0.24) : N.maxZ + 0.12 + r.next() * (beam - 0.24);
      }
      spots.push([x, 1.05, z, 0.025 + r.next() ** 3 * 0.1]);
    }
    for (let i = 0; i < 420; i++) {
      const x = (r.next() * 2 - 1) * 20;
      const z = -10 + r.next() * 22;
      if (Math.abs(x) < N.maxX + 1.4 && z > N.minZ - 1.4 && z < N.maxZ + 1.4) continue;
      spots.push([x, DESK_Y, z, 0.03 + r.next() ** 3 * 0.12]);
    }
    const inst = new THREE.InstancedMesh(geo, mat, spots.length);
    const d = new THREE.Object3D();
    spots.forEach(([x, y, z, s], i) => {
      d.position.set(x, y, z);
      d.scale.set(s, s * 0.7, s);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
    });
    this.group.add(inst);
  }

  buildLights(shadowMap) {
    this.hemi = new THREE.HemisphereLight(0x4a6aa8, 0x1a120c, 0.6);
    // Lamp: the warm key light, from the shade toward the tray's top-left corner.
    this.lamp?.updateMatrixWorld(true);
    const bulb = this.lamp?.getObjectByName('LampLight')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(9.4, 7.6, 4);
    // (LampAim is where the shade opening faces; the light itself falls on the tray's left half.)
    const aim = new THREE.Vector3(3.5, 0, 4.5);
    this.key = new THREE.SpotLight(0xffbe72, 190, 60, 0.95, 0.7, 1.35);
    this.key.position.copy(bulb);
    this.key.target.position.copy(aim);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(shadowMap, shadowMap);
    this.key.shadow.bias = -0.0003;
    this.key.shadow.normalBias = 0.03;
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = 50;
    this.bulbLight = new THREE.PointLight(0xffb05a, 14, 14, 1.6);
    this.bulbLight.position.copy(bulb);
    // Cold window light from the back right, and the neon's pink over the field.
    this.cold = new THREE.SpotLight(0x6cc0ff, 160, 80, 0.75, 0.9, 1.4);
    this.cold.position.set(-14, 16, 16);
    this.cold.target.position.set(-2, 0, 2);
    this.pink = new THREE.PointLight(0xff3aa8, 22, 14, 1.6);
    this.pink.position.set(2.5, 5, 0.5);
    this.blue = new THREE.PointLight(0x2f8cff, 34, 22, 1.5);
    this.blue.position.set(-4, 4.5, -2.5);
    // Soft fill from the room behind the camera (the art's desk and front beam are not black).
    this.fill = new THREE.DirectionalLight(0xffd2b0, 1.4);
    this.fill.position.set(6, 20, -30);
    this.bolt = new THREE.DirectionalLight(0xc8d8ff, 0);
    this.bolt.position.set(-10, 30, 30);
    // Soft light on the crates and the dial (window glow from the right).
    this.side = new THREE.PointLight(0x9ab4ff, 22, 16, 1.6);
    // Warm lamp spill on the desk round the mug and the lamp's foot.
    this.deskWarm = new THREE.PointLight(0xffa860, 30, 14, 1.5);
    this.deskWarm.position.set(11, 3, 4.5);
    this.side.position.set(-12.5, 5, -1);
    this.group.add(this.deskWarm, this.side, this.fill, this.hemi, this.key, this.key.target, this.bulbLight, this.cold, this.cold.target, this.pink, this.blue, this.bolt);
    this.rainLights.push(
      { position: bulb.clone().add(v1.set(-1.5, -3, -1)), reach: 9, color: new THREE.Color(0xffa24a).multiplyScalar(1.4) },
      { position: new THREE.Vector3(-8, 8, 10), reach: 14, color: new THREE.Color(0x58b8ff).multiplyScalar(0.8) },
      { position: new THREE.Vector3(2.5, 5, 0.5), reach: 8, color: new THREE.Color(0xff3aa8).multiplyScalar(0.6) },
      { position: new THREE.Vector3(-4, 4.5, -2.5), reach: 8, color: new THREE.Color(0x2f8cff).multiplyScalar(0.6) },
    );
  }

  update(dt) {
    this.time += dt;
    // Lightning: two or three quick flickers every 10 - 22 s.
    this.lightningTimer -= dt;
    if (this.lightningTimer <= 0) {
      this.lightningTimer = 10 + this.rng.next() * 12;
      let t = 0;
      const n = 2 + Math.floor(this.rng.next() * 2);
      for (let i = 0; i < n; i++) {
        this.lightningSeq.push({ at: t, power: 0.5 + this.rng.next() * 0.5 });
        t += 0.08 + this.rng.next() * 0.12;
      }
      this.lightningClock = 0;
    }
    if (this.lightningSeq.length) {
      this.lightningClock += dt;
      while (this.lightningSeq.length && this.lightningSeq[0].at <= this.lightningClock) this.flash = Math.max(this.flash, this.lightningSeq.shift().power);
    }
    this.flash = Math.max(0, this.flash - dt * 6);
    this.bolt.intensity = this.flash * 4;
    this.hemi.intensity = 0.6 + this.flash * 2;
    this.window.material.color.setScalar(2.4 + this.flash * 3);
    // Neon flicker on the pink spill.
    this.pink.intensity = 26 * (0.9 + 0.1 * Math.sin(this.time * 7.3) * Math.sin(this.time * 2.1));
  }
}

