import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GameConfig } from '../config/GameConfig.js';
import { LAYERS } from '../core/RenderPipeline.js';
import { Random } from '../util/Random.js';
import { createCanvas, canvasToTexture } from '../textures/CanvasUtils.js';
import { COFFEE_TIME, rippleCoffee } from './CoffeeRipples.js';
import { NIGHT_PROPS, DESK_CUBES, NIGHT_WINDOW, DESK_Y, NIGHT_CAMERA } from './NightLayout.js';

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
        if (m.name === 'LampBulb') m.emissiveIntensity = 7;
        if (m.name === 'ShadeInside') m.emissiveIntensity = 0.8;
        if (/^(LampBulb|ShadeInside|ShadeEnamel)$/.test(m.name)) m.side = THREE.DoubleSide;
        if (m.name === 'TrayWood') {
          // The Blender roughness map drives it (three.js multiplies the factor in).
          m.roughness = m.roughnessMap ? 1 : 0.3;
          m.envMapIntensity = 0.7;
        }
        if (m.name === 'DeskWood') {
          m.roughness = m.roughnessMap ? 1 : 0.28;
          this.deskMaterial = m;
        }
        if (m.name === 'MugEnamel') m.roughness = 0.14;
        // The art's sketch paper is a warm grey in the shade, not white.
        if (m.name === 'SketchPaper') m.color.setRGB(0.72, 0.62, 0.5);
        if (/^Brass/.test(m.name)) m.envMapIntensity = 1.8;
        // Rain drops on the props: only their glints show - a black gloss added on top (no
        // white beads, no glTF transmission pass).
        if (m.name === 'WaterDrop') {
          if ('transmission' in m) m.transmission = 0;
          m.color.set(0x000000);
          m.map = null;
          m.roughness = 0.02;
          m.metalness = 0;
          m.transparent = true;
          m.opacity = 1;
          m.blending = THREE.AdditiveBlending;
          m.depthWrite = false;
          m.envMapIntensity = 1.6;
        }
        // Rain rings on the coffee (radius of the Blender coffee disc).
        if (m.name === 'Coffee') {
          o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox;
          rippleCoffee(m, { radius: (b.max.x - b.min.x) / 2 || 1.28 });
        }
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
    // The art's deck reads blue-cyan under its water film (mean ~74,115,149): a cold sheen.
    this.reflection.wet(m, { wetMap: this.textures.wet(), wetScale: 1 / 9, strength: 1.3, puddle: 1, darken: 0.4, sheen: new THREE.Color(0.07, 0.15, 0.25) });
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd).rotateX(-Math.PI / 2), m);
    deck.position.set((N.minX + N.maxX) / 2, 0, (N.minZ + N.maxZ) / 2);
    deck.receiveShadow = true;
    this.floors.push(deck);
    this.group.add(deck);
    this.deck = deck;
    // Stage 2 on: the long tray (Blender NightTrayLong) and its deck, scaled out from the near
    // end while it stretches.
    const beam = 1.25;
    const near = N.minZ - beam;
    const src = this.kit.getObjectByName('NightTrayLong');
    if (src) {
      this.trayLong = this.piece('NightTrayLong');
      this.trayLongPivot = new THREE.Group();
      this.trayLongPivot.position.z = near;
      this.trayLong.position.z -= near;
      this.trayLongPivot.add(this.trayLong);
      this.group.add(this.trayLongPivot);
      this.trayLong.visible = false;
      this.trayShortRatio = (N.maxZ - N.minZ + 2 * beam) / (N.longMaxZ - N.minZ + 2 * beam);
    }
    const ld = N.longMaxZ - N.minZ;
    const ml = m.clone();
    ml.map = m.map.clone();
    ml.map.repeat.set(fw / (2 * N.block), ld / (2 * N.block));
    ml.map.needsUpdate = true;
    ml.normalMap = m.normalMap.clone();
    ml.normalMap.repeat.copy(ml.map.repeat);
    ml.normalMap.needsUpdate = true;
    this.reflection.wet(ml, { wetMap: this.textures.wet(), wetScale: 1 / 9, strength: 1.3, puddle: 1, darken: 0.4, sheen: new THREE.Color(0.07, 0.15, 0.25) });
    this.deckLong = new THREE.Mesh(new THREE.PlaneGeometry(fw, ld).rotateX(-Math.PI / 2).translate(0, 0, ld / 2), ml);
    this.deckLong.position.set((N.minX + N.maxX) / 2, 0, N.minZ);
    this.deckLong.receiveShadow = true;
    this.deckLong.visible = false;
    this.floors.push(this.deckLong);
    this.group.add(this.deckLong);
  }

  buildDesk() {
    this.desk = this.piece('DeskTop');
    this.desk.traverse((o) => {
      if (o.isMesh) this.floors.push(o);
    });
    this.group.add(this.desk);
    // The longer desk under the stretched tray (Blender DeskTopLong).
    if (this.kit.getObjectByName('DeskTopLong')) {
      this.deskLong = this.piece('DeskTopLong');
      this.deskLong.traverse((o) => {
        if (o.isMesh) this.floors.push(o);
      });
      this.deskLong.visible = false;
      this.group.add(this.deskLong);
    }
  }

  buildProps() {
    for (const p of NIGHT_PROPS) {
      const o = this.piece(p.name);
      o.position.set(...p.pos);
      if (p.quat) o.quaternion.set(...p.quat);
      else o.rotation.y = p.rotY ?? 0;
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
      // (The level puts the wall's wet cracked material on these.)
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x888888 }));
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

  /**
   * The street outside on the window plane, projected from the art camera so that from the game
   * camera it lines up pixel for pixel (the wet reflections see the same street mirrored):
   *   top     the art's own street (tools/night/build_art_plate.py: the key art with its logo,
   *           lamp and plant filled in, the Blender plate below the window line);
   *   street  the frame below it (build_night_backdrop.py, lens shifted down one frame): the
   *           lower floors and the wet street, where the shader drives traffic - head and tail
   *           lights gliding along the lanes as soft bokeh.
   * Rain falls over it all (three layers of streaks, lulls with the rain). `uPan` (0..1) slides
   * the view down toward the street as the camera follows the tank up the long tray; `uShift`
   * moves the projector with the window when the tray stretches.
   */
  setBackdrop(texture, street = null) {
    for (const t of [texture, street]) if (t) t.colorSpace = THREE.SRGBColorSpace;
    this.artCam = new THREE.PerspectiveCamera(NIGHT_CAMERA.fov, 1672 / 941, 0.1, 400);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uStreet: { value: street ?? texture },
        uHasStreet: { value: street ? 1 : 0 },
        uViewProj: { value: new THREE.Matrix4() },
        uGain: { value: 0.72 },
        uTime: { value: 0 },
        uPan: { value: 0 },
        uRain: { value: 1 },
      },
      vertexShader: /* glsl */ `
        uniform mat4 uViewProj;
        varying vec4 vArt;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vArt = uViewProj * w;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform sampler2D uStreet;
        uniform float uHasStreet;
        uniform float uGain;
        uniform float uTime;
        uniform float uPan;
        uniform float uRain;
        varying vec4 vArt;
        float rainHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
        // Rain over the street: three layers of thin falling streaks (far ones finer, slower and
        // dimmer), each lit by what is behind it - the plate itself stays still, the rain moves.
        float streetRain(vec2 uv) {
          float r = 0.0;
          for (int k = 0; k < 3; k++) {
            float fk = float(k);
            float cols = 110.0 + fk * 70.0;
            vec2 p = vec2(uv.x + uv.y * 0.035, uv.y);
            float id = floor(p.x * cols);
            float h = rainHash(id + fk * 31.7);
            if (h < 1.0 - 0.65 * uRain) continue;
            float fx = abs(fract(p.x * cols) - 0.5);
            float line = 1.0 - smoothstep(0.04, 0.16, fx);
            float speed = (1.1 + h * 0.9) * (1.0 - fk * 0.22);
            float seg = fract(p.y * (2.2 + h * 1.5) + uTime * speed + h * 9.0);
            float drop = smoothstep(0.0, 0.03, seg) * (1.0 - smoothstep(0.03, 0.22, seg));
            r += line * drop * (1.0 - fk * 0.28);
          }
          return r;
        }
        // Traffic on the street plate (u, v: 0..1 over that frame): four lanes sloping with the
        // camera's roll (v = centre + 0.166 (u - 0.5), build_night_backdrop.py), soft light discs
        // in pairs gliding along them - head lights left to right on the near two, red tail
        // lights right to left on the far two - each with its smear on the wet asphalt.
        vec3 traffic(vec2 q) {
          vec3 c = vec3(0.0);
          for (int i = 0; i < 4; i++) {
            float fi = float(i);
            float vc = i == 0 ? 0.607 : i == 1 ? 0.712 : i == 2 ? 0.81 : 0.904;
            float dir = i < 2 ? 1.0 : -1.0;
            vec3 tint = i < 2 ? vec3(1.0, 0.9, 0.72) : vec3(1.0, 0.14, 0.1);
            float size = mix(1.0, 0.85, fi / 3.0);
            for (int k = 0; k < 3; k++) {
              float fk = float(k);
              float x = fract(fk * 0.37 + fi * 0.21 + dir * uTime * (0.028 + 0.009 * fk + 0.004 * fi));
              float lane = vc + 0.166 * (x - 0.5);
              for (int e = 0; e < 2; e++) {
                vec2 d = (q - vec2(x + float(e) * 0.008 * size, lane)) / size;
                c += tint * exp(-dot(d * vec2(1.0, 1.8), d * vec2(1.0, 1.8)) * 30000.0) * 1.4;
              }
              vec2 r2 = (q - vec2(x + 0.004, lane - 0.03 * size)) / size * vec2(1.6, 0.3);
              c += tint * exp(-dot(r2, r2) * 30000.0) * 0.4;
            }
          }
          return c;
        }
        void main() {
          vec2 uv = vArt.xy / vArt.w * 0.5 + 0.5;
          uv.y -= uPan * 0.6;
          vec3 c;
          if (uv.y >= 0.0 || uHasStreet < 0.5) {
            c = texture2D(uMap, clamp(uv, 0.002, 0.998)).rgb;
          } else {
            vec2 q = vec2(uv.x, uv.y + 1.0);
            c = texture2D(uStreet, clamp(q, 0.002, 0.998)).rgb + traffic(q);
          }
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c += vec3(0.62, 0.72, 0.9) * streetRain(uv) * (0.06 + l * 0.9) * uRain;
          gl_FragColor = vec4(c * uGain, 1.0);
          #include <colorspace_fragment>
        }
      `,
      depthWrite: true,
    });
    this.window.material.dispose();
    this.window.material = mat;
    this.backdrop = mat;
    this.aimProjector(0);
  }

  /** The projector: the art camera moved back with the window by `dz`. */
  aimProjector(dz) {
    if (!this.artCam) return;
    const cam = this.artCam;
    cam.position.set(...NIGHT_CAMERA.position);
    cam.position.z += dz;
    cam.quaternion.set(...NIGHT_CAMERA.quaternion);
    cam.updateMatrixWorld(true);
    this.backdrop.uniforms.uViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  }

  /**
   * The tray stretching to twice its length after stage 1 (k 0..1): the long tray, deck and desk
   * take over, the far beam, the window and the street behind it move back with it.
   */
  setStretch(k) {
    const N = GameConfig.night;
    const extra = (N.longMaxZ - N.maxZ) * k;
    const long = k > 0;
    this.tray.visible = !long || !this.trayLong;
    this.deck.visible = !long;
    if (this.trayLong) {
      this.trayLong.visible = long;
      this.trayLongPivot.scale.z = this.trayShortRatio + (1 - this.trayShortRatio) * k;
    }
    this.deckLong.visible = long;
    this.deckLong.scale.z = (N.maxZ - N.minZ + extra) / (N.longMaxZ - N.minZ);
    if (this.deskLong) {
      this.desk.visible = !long;
      this.deskLong.visible = long;
    }
    if (this.droplets) this.droplets.visible = !long;
    this.window.position.z = NIGHT_WINDOW.z + extra;
    this.aimProjector(extra);
    this.stretchExtra = extra;
  }

  /** How far the camera has followed the tank up the long tray (0..1): the view slides down to the street. */
  setFollow(f) {
    if (this.backdrop) this.backdrop.uniforms.uPan.value = THREE.MathUtils.clamp(f, 0, 1);
  }

  /** Water beading on the beam tops and the desk round the tray. */
  buildDroplets() {
    const N = GameConfig.night;
    const geo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    // Only the beads' glints show (black gloss added on top): no grey rings on the wood.
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.02, metalness: 0, envMapIntensity: 1.8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
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
    this.droplets = inst;
    this.group.add(inst);
  }

  buildLights(shadowMap) {
    this.hemi = new THREE.HemisphereLight(0x4a6aa8, 0x1a120c, 0.6);
    // Lamp: the warm key light, from the shade toward the tray's top-left corner.
    this.lamp?.updateMatrixWorld(true);
    const bulb = this.lamp?.getObjectByName('LampLight')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(9.4, 7.6, 4);
    // (LampAim is where the shade opening faces; the light itself falls on the tray's left half.)
    const aim = new THREE.Vector3(3.5, 0, 4.5);
    this.key = new THREE.SpotLight(0xffbe72, 85, 60, 0.95, 0.7, 1.35);
    this.key.position.copy(bulb);
    this.key.target.position.copy(aim);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(shadowMap, shadowMap);
    this.key.shadow.bias = -0.0003;
    this.key.shadow.normalBias = 0.03;
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = 50;
    this.bulbLight = new THREE.PointLight(0xffb05a, 18, 16, 1.5);
    this.bulbLight.position.copy(bulb);
    // Cold window light from the back right, and the neon's pink over the field.
    this.cold = new THREE.SpotLight(0x6cc0ff, 160, 80, 0.75, 0.9, 1.4);
    this.cold.position.set(-14, 16, 16);
    this.cold.target.position.set(-2, 0, 2);
    this.pink = new THREE.PointLight(0xff3aa8, 2, 22, 1.2);
    this.pink.position.set(2.5, 7.5, 0.5);
    this.blue = new THREE.PointLight(0x2f8cff, 6, 30, 1.2);
    this.blue.position.set(-4, 7.5, -2.5);
    // Soft fill from the room behind the camera (the art's desk and front beam are not black).
    this.fill = new THREE.DirectionalLight(0xffd2b0, 2.2);
    this.fill.position.set(6, 20, -30);
    this.bolt = new THREE.DirectionalLight(0xc8d8ff, 0);
    this.bolt.position.set(-10, 30, 30);
    // Soft light on the crates and the dial (window glow from the right).
    this.side = new THREE.PointLight(0x9ab4ff, 9, 14, 1.6);
    // Warm lamp spill on the desk round the mug and the lamp's foot.
    this.deskWarm = new THREE.PointLight(0xffa860, 20, 12, 1.5);
    this.deskWarm.position.set(11, 3, 4.5);
    // Cold rim from the window over the right side of the desk (kept soft: no glare on the wheel).
    this.side.position.set(-13.5, 7, 3);
    // Warm glow of the blast at the tray's right end on the crate fronts (the art's lit crates).
    this.crateFill = new THREE.PointLight(0xffb27a, 16, 9, 1.4);
    this.crateFill.position.set(-12.2, 4.2, 4.2);
    this.group.add(this.crateFill);
    this.group.add(this.deskWarm, this.side, this.fill, this.hemi, this.key, this.key.target, this.bulbLight, this.cold, this.cold.target, this.pink, this.blue, this.bolt);
    this.rainLights.push(
      { position: bulb.clone().add(v1.set(-1.5, -3, -1)), reach: 9, color: new THREE.Color(0xffa24a).multiplyScalar(1.4) },
      { position: new THREE.Vector3(-8, 8, 10), reach: 14, color: new THREE.Color(0x58b8ff).multiplyScalar(0.8) },
      { position: new THREE.Vector3(2.5, 5, 0.5), reach: 8, color: new THREE.Color(0xff3aa8).multiplyScalar(0.6) },
      { position: new THREE.Vector3(-4, 4.5, -2.5), reach: 8, color: new THREE.Color(0x2f8cff).multiplyScalar(0.6) },
      // The street's glow through the window: the rain catches it all across the top.
      { position: new THREE.Vector3(0, 9, 11), reach: 18, color: new THREE.Color(0x9cc8ff).multiplyScalar(0.55) },
    );
  }

  update(dt) {
    this.time += dt;
    COFFEE_TIME.value += dt;
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
    if (this.backdrop) {
      this.backdrop.uniforms.uTime.value = this.time;
      this.backdrop.uniforms.uGain.value = 0.72 + this.flash * 1.0;
    }
    else this.window.material.color.setScalar(2.4 + this.flash * 3);
    // Neon flicker on the pink spill.
    this.pink.intensity = 2.4 * (0.9 + 0.1 * Math.sin(this.time * 7.3) * Math.sin(this.time * 2.1));
  }
}

