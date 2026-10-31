import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import engineerArtUrl from '../../assets/textures/cards/engineer.jpg?url';
import gemMineArtUrl from '../../assets/textures/cards/gem_mine.jpg?url';
import cargoChopperArtUrl from '../../assets/textures/cards/cargo_chopper.jpg?url';
import homingArtUrl from '../../assets/textures/cards/homing_missile.jpg?url';
import doubleRowArtUrl from '../../assets/textures/cards/double_row.jpg?url';
import surpriseEggArtUrl from '../../assets/textures/cards/surprise_egg.jpg?url';
import flickerArtUrl from '../../assets/textures/cards/flicker.jpg?url';
import cargoTimeArtUrl from '../../assets/textures/cards/cargo_time.jpg?url';

/**
 * Upgrade cards (offered after a train is destroyed).
 *
 * `text` is a list of [string, css colour?] segments; '\n' starts a new paragraph.
 * `requires`: id of a card that must be taken first. What each card does is applied in
 * Game.applyCard(). Add new cards here.
 */
export const CARD_DEFS = Object.freeze([
  {
    id: 'engineer',
    // Art framing above the banner: vertical point of interest (0 top..1 bottom) and zoom (<1 shows more).
    focus: 0.5,
    zoom: 0.9,
    title: 'FIELD ENGINEER',
    kind: 'LOGISTICS',
    art: engineerArtUrl,
    jewel: 0xff9a2a,
    glow: 0xffb050,
    text: [
      ['The chopper drops off an '], ['engineer', '#ffcf6a'], [' with a '], ['forklift', '#ffcf6a'], ['. He stacks the '],
      ['red', '#ff6b6b'], [', '], ['green', '#7be86a'], [' and '], ['blue', '#5ab8ff'], [' cubes you shoot off the train on the dock.'],
    ],  },
  {
    id: 'cargoChopper',
    focus: 0.5,
    zoom: 0.84,
    title: 'CARGO CHOPPER',
    kind: 'LOGISTICS',
    art: cargoChopperArtUrl,
    jewel: 0xe8c23a,
    glow: 0xffd860,
    text: [
      ['The '], ['Chinook', '#ffcf6a'], [' returns '], ['every 2 minutes', '#ffcf6a'], [' to winch the packages off the dock. '],
      ['No mission without it.', '#ff8a7a'],
    ],  },
  {
    id: 'gemMine',
    focus: 0.46,
    zoom: 0.9,
    title: 'GEM MINE',
    kind: 'POWER',
    art: gemMineArtUrl,
    jewel: 0x47c8ff,
    glow: 0x7fd0ff,
    text: [
      ['Blocks may drop '], ['gems', '#ffe08a'], ['.\n'],
      ['Blue', '#5ab8ff'], [' rapid fire · '], ['Green', '#7be86a'], [' acid\n'],
      ['Red', '#ff6b6b'], [' power · '], ['Black', '#c9b8ff'], [' critical'],
    ],  },
  {
    id: 'homing',
    focus: 0.44,
    zoom: 0.88,
    title: 'HOMING ROCKETS',
    kind: 'POWER',
    art: homingArtUrl,
    jewel: 0xff6a4a,
    glow: 0xff8a5a,
    text: [
      ['Unlocks the '], ['R', '#ff8a5a'], [' supply: '], ['homing rockets', '#ff8a5a'], [' that curve onto nearby targets. Never dropped before this card.'],
    ],  },
  {
    id: 'doubleRow',
    focus: 0.6,
    zoom: 0.86,
    title: 'DOUBLE ROW',
    kind: 'LOGISTICS',
    art: doubleRowArtUrl,
    requires: 'engineer',
    jewel: 0x7be86a,
    glow: 0x9cff8a,
    text: [
      ['A '], ['second dock lane', '#ffcf6a'], [': the engineer lines up '], ['twice as many', '#ffcf6a'], [' packages before the chopper comes.'],
    ],  },
  {
    id: 'surpriseEgg',
    focus: 0.66,
    zoom: 0.86,
    title: 'SURPRISE EGG',
    kind: 'SUPPLY',
    art: surpriseEggArtUrl,
    jewel: 0xffd34a,
    glow: 0xffe08a,
    text: [
      ['Board '], ['out of blocks', '#ffcf6a'], ['? '], ['3 spiked balls', '#ffcf6a'], [' drop from the sky. Each one blown up has a '],
      ['20%', '#7be86a'], [' chance to drop a supply.'],
    ],  },
  {
    id: 'flicker',
    title: 'FLICKER',
    kind: 'DEFENSE',
    art: flickerArtUrl,
    focus: 0.42,
    zoom: 0.9,
    jewel: 0x5ad8ff,
    glow: 0x8fe4ff,
    text: [
      ['After every hit the heli '], ['flickers twice as long', '#8fe4ff'], ['. While it flickers, '],
      ['no damage', '#7be86a'], [' gets through.'],
    ],
  },
  {
    id: 'cargoTime',
    title: 'RUSH DELIVERY',
    kind: 'LOGISTICS',
    art: cargoTimeArtUrl,
    requires: 'cargoChopper',
    focus: 0.45,
    zoom: 0.86,
    jewel: 0xe8c23a,
    glow: 0xffd860,
    text: [
      ['The cargo chopper comes '], ['30% sooner', '#ffcf6a'], [': every '], ['1:24', '#ffcf6a'], [' instead of 2:00.'],
    ],
  },
]);

export const CARD_W = 0.63;
export const CARD_H = 0.88;
const FRONT_W = 1280;
const FRONT_H = Math.round(FRONT_W * CARD_H / CARD_W);
// Banner band in card space (matches tools/blender/build_card.py): centre y, height, span.
const BANNER = { y0: -0.175, h: 0.092, span: CARD_W + 0.07 };
// Card-space y above which the pointer is "on the picture" (inspect mode).
const ART_EDGE = BANNER.y0 + BANNER.h / 2 + 0.01;
export const SERIF = 'Georgia, "Times New Roman", serif';

export const loadImage = (url) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = url;
});

export const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
export const easeInOut = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/**
 * Card picker: while it is up the world drains to ash grey (GradePass uAsh) but the game keeps
 * running underneath. The cards (Blender model assets/models/card.glb, poker-card thin) fly in
 * face down, flip over, float and tilt toward the pointer; click / tap one or press 1 / 2.
 */
export class CardPicker {
  /**
   * @param {{pipeline:any, container:HTMLElement, cardGltf:any}} deps
   */
  constructor({ pipeline, container, cardGltf }) {
    this.pipeline = pipeline;
    this.container = container;
    this.template = cardGltf?.scene ?? null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 20);
    this.camera.position.set(0, 0, 2.45);
    // Cards get their own transparent canvas at the full device pixel ratio, so they stay sharp
    // even when the game lowers its render resolution to keep the frame rate up.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'card-canvas';
    container.appendChild(this.canvas);
    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.9;
    const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
    key.position.set(-1.5, 2, 3);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.2);
    rim.position.set(2, -1, 1.5);
    this.scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.35));
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.cards = [];
    this.active = false;
    this.ash = 0;
    this.time = 0;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(9, 9);
    this.backTexture = backTexture();
    this.glowTexture = glowTexture();
    this.images = new Map();
    this.loaded = false;
    this.ready = Promise.all(CARD_DEFS.map(async (d) => this.images.set(d.id, await loadImage(d.art)))).then(() => { this.loaded = true; });

    // DOM: heading + hint.
    this.ui = document.createElement('div');
    this.ui.className = 'card-ui';
    this.ui.innerHTML = '<div class="card-heading">CHOOSE AN UPGRADE</div><div class="card-sub"><span class="card-sub-title">the train is down</span><span class="card-hint"></span></div>';
    container.appendChild(this.ui);

    window.addEventListener('pointermove', (e) => this.onPointer(e), { passive: true });
    window.addEventListener('pointerdown', (e) => this.onPointerDown(e), { capture: true });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /**
   * Shows up to two cards. `onPick(def)` runs once the chosen card has been played.
   * @param {object[]} defs
   * @param {(def:object)=>void} onPick
   */
  async show(defs, onPick) {
    if (this.active || !defs.length) return;
    if (!this.loaded) await this.ready;
    if (this.active) return;
    this.clearCards();
    this.onPick = onPick;
    this.active = true;
    this.picked = null;
    this.inspect = -1;
    this.time = 0;
    this.hover = -1;
    const n = defs.length;
    defs.forEach((def, i) => {
      const card = this.buildCard(def);
      card.index = i;
      card.homeX = (i - (n - 1) / 2) * 0.78;
      card.delay = 0.15 + i * 0.14;
      card.object.position.set(card.homeX * 0.6, -1.5, 0.4);
      card.object.rotation.set(-0.6, Math.PI, 0.3 * (i ? 1 : -1));
      this.root.add(card.object);
      this.cards.push(card);
    });
    this.ui.classList.add('visible');
    this.container.classList.add('cards-open');
    const touch = matchMedia('(pointer: coarse)').matches;
    const keys = n > 1 ? '<b>1</b> / <b>2</b>' : '<b>1</b>';
    this.ui.querySelector('.card-hint').innerHTML = touch
      ? 'tap the picture to see it whole &middot; tap the banner to choose'
      : `click a card or press ${keys} &middot; point at the picture to see it whole`;
  }

  clearCards() {
    for (const c of this.cards) {
      c.object.removeFromParent();
      c.object.traverse((o) => {
        if (o.isMesh) o.material.dispose();
      });
      c.frontTex.dispose();
      c.bannerTex.dispose();
      c.artTex.dispose();
    }
    this.cards = [];
  }

  /** One card: clone of the Blender model with this card's art, banner title and text. */
  buildCard(def) {
    const object = new THREE.Group();
    const img = this.images.get(def.id);
    const frontTex = new THREE.CanvasTexture(frontCanvas(def, img));
    frontTex.colorSpace = THREE.SRGBColorSpace;
    frontTex.anisotropy = this.maxAniso;
    // Inspect mode: the whole painting, fitted to the card, blended in over banner + text.
    const artTex = new THREE.CanvasTexture(artCanvas(img));
    artTex.colorSpace = THREE.SRGBColorSpace;
    artTex.anisotropy = this.maxAniso;
    artTex.flipY = !this.template;
    const reveal = { value: 0 };
    // glTF UVs have their origin at the top-left: textures on glTF meshes must not be flipped.
    frontTex.flipY = !this.template;
    const bannerTex = new THREE.CanvasTexture(bannerCanvas(def.title));
    bannerTex.colorSpace = THREE.SRGBColorSpace;
    bannerTex.anisotropy = this.maxAniso;
    bannerTex.flipY = !this.template;
    const sheen = { value: 0 };
    const sweep = { value: -1 };
    let model;
    if (this.template) {
      model = this.template.clone(true);
      model.rotation.x = Math.PI / 2; // glTF: front faces +Y -> turn it toward the camera (+Z)
    } else {
      model = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_H, 0.003), new THREE.MeshStandardMaterial({ name: 'CardFront' }));
    }
    model.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.material.name;
      let m;
      if (name === 'CardFront') {
        m = new THREE.MeshPhysicalMaterial({ map: frontTex, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.18 });
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uSheen = sheen;
          shader.uniforms.uSweep = sweep;
          shader.uniforms.uArt = { value: artTex };
          shader.uniforms.uReveal = reveal;
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uSheen;\nuniform float uSweep;\nuniform sampler2D uArt;\nuniform float uReveal;')
            .replace('#include <map_fragment>', `#ifdef USE_MAP
              diffuseColor *= mix(texture2D(map, vMapUv), texture2D(uArt, vMapUv), uReveal);
            #endif`)
            .replace('#include <dithering_fragment>', `#include <dithering_fragment>
              float sd = dot(vMapUv - 0.5, normalize(vec2(1.0, 0.55))) - uSweep;
              gl_FragColor.rgb += vec3(1.0, 0.94, 0.8) * uSheen * (smoothstep(0.09, 0.0, abs(sd)) * 0.55 + smoothstep(0.02, 0.0, abs(sd)) * 0.5);`);
        };
      } else if (name === 'CardBack') {
        m = new THREE.MeshPhysicalMaterial({ map: this.backTexture, roughness: 0.5, clearcoat: 0.5 });
      } else if (name === 'CardBanner') {
        m = new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.5, side: THREE.DoubleSide });
      } else if (name === 'CardTail') {
        m = new THREE.MeshStandardMaterial({ color: 0x5e0b10, roughness: 0.6, side: THREE.DoubleSide });
      } else if (name === 'CardGold') {
        m = new THREE.MeshStandardMaterial({ color: 0xe6bb58, roughness: 0.22, metalness: 1, envMapIntensity: 1.4 });
      } else if (name === 'CardJewel') {
        m = new THREE.MeshPhysicalMaterial({ color: def.jewel, emissive: def.jewel, emissiveIntensity: 0.6, roughness: 0.05, clearcoat: 1, flatShading: true });
      } else {
        m = new THREE.MeshStandardMaterial({ color: 0xe6d9b8, roughness: 0.7 }); // paper edge
      }
      m.transparent = true;
      m.userData.banner = name === 'CardBanner' || name === 'CardTail';
      o.material = m;
    });
    object.add(model);
    // Soft coloured glow behind the card (hover / pick).
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_W * 1.9, CARD_H * 1.6),
      new THREE.MeshBasicMaterial({ map: this.glowTexture, color: def.glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.position.z = -0.04;
    object.add(glow);
    return { def, object, model, glow, frontTex, bannerTex, artTex, sheen, sweep, reveal, revealT: 0, onArt: 0, hoverT: 0, lift: 0 };
  }

  /** Fit the row of cards on narrow screens. */
  layout() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w !== this.size?.w || h !== this.size?.h) {
      this.size = { w, h };
      this.renderer.setSize(w, h, false);
    }
    const aspect = w / Math.max(1, h);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const visibleW = 2 * this.camera.position.z * Math.tan(THREE.MathUtils.degToRad(15)) * aspect;
    const need = Math.max(1, this.cards.length) * 0.78 + 0.1;
    this.root.scale.setScalar(Math.min(1, visibleW / need));
    this.root.position.y = -0.04;
  }

  onPointer(e) {
    const rect = this.container.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  hitCard() {
    if (!this.active || this.picked) return -1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    let best = -1;
    let bestD = Infinity;
    this.hoverOnArt = false;
    this.cards.forEach((c, i) => {
      const hit = this.raycaster.intersectObject(c.model, true)[0];
      if (hit && hit.distance < bestD) {
        bestD = hit.distance;
        best = i;
        // Above the banner = on the painting.
        this.hoverOnArt = c.object.worldToLocal(hit.point.clone()).y > ART_EDGE;
      }
    });
    return best;
  }

  onPointerDown(e) {
    if (!this.active || this.picked || this.blocked) return;
    this.onPointer(e);
    const i = this.hitCard();
    if (i < 0 || this.time < this.cards[i].delay + 0.6) return;
    e.stopPropagation();
    e.preventDefault();
    // Touch: tapping the picture shows the whole painting (tap again or tap the banner to choose).
    if (e.pointerType === 'touch' && this.hoverOnArt && this.inspect !== i) {
      this.inspect = i;
      return;
    }
    this.pick(i);
  }

  onKey(e) {
    if (!this.active || this.picked || this.blocked) return;
    const i = { Digit1: 0, Numpad1: 0, Digit2: 1, Numpad2: 1 }[e.code];
    if (i === undefined || i >= this.cards.length) return;
    if (this.time < this.cards[i].delay + 0.6) return;
    this.pick(i);
  }

  pick(i) {
    this.picked = { index: i, t: 0, fired: false };
    this.ui.classList.remove('visible');
    this.container.classList.remove('cards-open');
  }

  /** Called every frame from the game loop (keeps running while the cards are up). */
  update(dt) {
    const target = this.active && (!this.picked || this.picked.t < 0.55) ? 1 : 0;
    this.ash += (target - this.ash) * (1 - Math.exp(-(target ? 5 : 3.5) * dt));
    if (this.ash < 0.002 && !target) this.ash = 0;
    const grade = this.pipeline.gradePass;
    if (grade) grade.uniforms.uAsh.value = this.ash;
    if (!this.active) {
      this.render();
      return;
    }
    this.time += dt;
    this.layout();
    this.hover = this.picked ? this.hover : this.hitCard();
    const t = this.time;
    for (const c of this.cards) {
      const o = c.object;
      const u = easeInOut((t - c.delay) / 0.75);
      const hovered = this.hover === c.index && u >= 1;
      c.hoverT += ((hovered ? 1 : 0) - c.hoverT) * (1 - Math.exp(-10 * dt));
      // Fly in face down, flip over on the way.
      const bob = Math.sin(t * 1.6 + c.index * 1.7) * 0.012;
      let x = THREE.MathUtils.lerp(c.homeX * 0.6, c.homeX, u);
      let y = THREE.MathUtils.lerp(-1.5, 0, ease((t - c.delay) / 0.75)) + bob + c.hoverT * 0.03;
      let z = THREE.MathUtils.lerp(0.4, 0, u) + c.hoverT * 0.1;
      let ry = THREE.MathUtils.lerp(Math.PI, 0, u);
      let rx = THREE.MathUtils.lerp(-0.6, 0, u);
      let rz = THREE.MathUtils.lerp(0.3 * (c.index ? 1 : -1), (c.index - (this.cards.length - 1) / 2) * -0.03, u);
      // Tilt toward the pointer while hovered.
      if (c.hoverT > 0.001) {
        const px = THREE.MathUtils.clamp(this.pointer.x * 1.8 - x * 0.9, -1, 1);
        const py = THREE.MathUtils.clamp(this.pointer.y * 1.8 - y * 0.9, -1, 1);
        ry += px * 0.28 * c.hoverT;
        rx += -py * 0.22 * c.hoverT;
      }
      let scaleBoost = 0;
      let scale = 1 + c.hoverT * 0.07;
      let fade = 1;
      // Shine sweeping across the face: once when it lands, then on hover.
      if (u >= 1 && c.sweep.value < 1.2) c.sweep.value += dt * 1.6;
      if (hovered && c.sweep.value >= 1.2) c.sweep.value = -0.9;
      c.sheen.value = 0.75 + c.hoverT * 0.5;
      // Inspect: pointer resting on the picture (or a touch tap) fades banner + text away.
      const onArt = (hovered && this.hoverOnArt) || this.inspect === c.index;
      c.onArt = onArt ? c.onArt + dt : 0;
      const wantReveal = !this.picked && (this.inspect === c.index || c.onArt > 0.25) ? 1 : 0;
      c.revealT += (wantReveal - c.revealT) * (1 - Math.exp(-(wantReveal ? 7 : 9) * dt));
      c.reveal.value = c.revealT;
      if (c.revealT > 0.01) scaleBoost = c.revealT * 0.03;
      let glow = c.hoverT * 0.55;

      if (this.picked) {
        const p = this.picked;
        const k = p.t;
        if (c.index === p.index) {
          // Chosen: rises to the centre, flares, then shrinks away into the game.
          const a = easeInOut(k / 0.45);
          x = THREE.MathUtils.lerp(x, 0, a);
          y = THREE.MathUtils.lerp(y, 0.05, a);
          z = THREE.MathUtils.lerp(z, 0.35, a);
          rx *= 1 - a;
          ry *= 1 - a;
          rz *= 1 - a;
          scale *= 1 + 0.18 * a;
          glow = 0.55 + a * 0.6;
          if (k > 0.55) {
            const b = easeInOut((k - 0.55) / 0.45);
            scale *= 1 - b * 0.85;
            y += b * 0.25;
            rz += b * 0.6;
            fade = 1 - b;
            glow *= 1 - b;
          }
        } else {
          // Not chosen: drops away and fades.
          const a = easeInOut(k / 0.6);
          y -= a * 1.4;
          rx -= a * 0.8;
          rz += (c.index > p.index ? 1 : -1) * a * 0.5;
          fade = 1 - a;
          glow = 0;
        }
      }
      o.position.set(x, y, z);
      o.rotation.set(rx, ry, rz);
      o.scale.setScalar(scale + scaleBoost);
      c.glow.material.opacity = glow;
      o.traverse((m) => {
        if (m.isMesh && m !== c.glow) m.material.opacity = fade * (m.material.userData.banner ? 1 - c.revealT : 1);
      });
    }
    if (this.picked) {
      const p = this.picked;
      p.t += dt;
      if (!p.fired && p.t > 0.5) {
        p.fired = true;
        this.onPick?.(this.cards[p.index].def);
      }
      if (p.t > 1.05) {
        this.active = false;
        this.clearCards();
      }
    }
    this.render();
  }

  render() {
    if (!this.active && this.cards.length === 0) {
      if (this.drawn) {
        this.renderer.clear();
        this.drawn = false;
      }
      return;
    }
    this.renderer.render(this.scene, this.camera);
    this.drawn = true;
  }

  /** Hides the picker without choosing (e.g. game over). */
  cancel() {
    this.active = false;
    this.picked = null;
    this.ui.classList.remove('visible');
    this.container.classList.remove('cards-open');
    this.clearCards();
  }
}

// -------------------------------------------------------------------------------------------------
// Canvas art
// -------------------------------------------------------------------------------------------------

/** Card face: painting, dark reading panel under the banner, type label and description. */
function frontCanvas(def, img) {
  const W = FRONT_W;
  const H = FRONT_H;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1512';
  g.fillRect(0, 0, W, H);
  if (img) drawFramedArt(g, img, W, H, def.focus ?? 0.5, def.zoom ?? 1);
  // Vignette + reading panel: the lower part fades into dark leather-brown.
  const bannerTop = H * (0.5 - (BANNER.y0 + BANNER.h / 2) / CARD_H);
  const grad = g.createLinearGradient(0, bannerTop - H * 0.12, 0, H);
  grad.addColorStop(0, 'rgba(14,10,8,0)');
  grad.addColorStop(0.28, 'rgba(14,10,8,0.82)');
  grad.addColorStop(1, 'rgba(10,7,5,0.96)');
  g.fillStyle = grad;
  g.fillRect(0, bannerTop - H * 0.12, W, H);
  const vg = g.createRadialGradient(W / 2, H * 0.4, W * 0.35, W / 2, H * 0.45, W * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);

  const bannerBottom = H * (0.5 - (BANNER.y0 - BANNER.h / 2) / CARD_H);
  const margin = W * 0.1;
  // Type label, flanked by thin gold rules.
  let y = bannerBottom + H * 0.034;
  g.font = `600 ${Math.round(W * 0.032)}px ${SERIF}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const label = def.kind.split('').join(String.fromCharCode(8202));
  const lw = g.measureText(label).width;
  g.fillStyle = '#e9c46a';
  g.fillText(label, W / 2, y);
  g.strokeStyle = 'rgba(233,196,106,0.7)';
  g.lineWidth = 2;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(W / 2 + s * (lw / 2 + 14), y);
    g.lineTo(W / 2 + s * (lw / 2 + 110), y);
    g.stroke();
    g.fillStyle = '#e9c46a';
    g.save();
    g.translate(W / 2 + s * (lw / 2 + 118), y);
    g.rotate(Math.PI / 4);
    g.fillRect(-5, -5, 10, 10);
    g.restore();
  }
  // Description: word-wrapped, coloured keywords, centred.
  y += H * 0.022;
  // Largest font size whose wrapped text still fits the reading panel.
  const maxY = H * 0.945;
  let size = Math.round(W * 0.05);
  while (size > W * 0.03 && !drawRichText(g, def.text, W / 2, y, W - margin * 2, size, maxY, true)) size -= 2;
  drawRichText(g, def.text, W / 2, y, W - margin * 2, size, maxY);
  return c;
}

/** Draws (or, with `measure`, only checks) centred word-wrapped text. Returns true if it fits. */
export function drawRichText(g, segments, cx, top, maxW, size, maxY, measure = false) {
  g.font = `${size}px ${SERIF}`;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  const lineH = size * 1.32;
  // Tokenise into words keeping colours; '\n' forces a paragraph break.
  const words = [];
  for (const [text, color] of segments) {
    const parts = text.split(/(\n| )/);
    for (const p of parts) {
      if (p === '') continue;
      words.push({ text: p, color: color ?? '#efe6d6' });
    }
  }
  const lines = [[]];
  let width = 0;
  for (const w of words) {
    if (w.text === '\n') {
      lines.push([]);
      width = 0;
      continue;
    }
    const ww = g.measureText(w.text).width;
    if (w.text !== ' ' && width + ww > maxW && lines[lines.length - 1].length) {
      lines.push([]);
      width = 0;
    }
    if (w.text === ' ' && width === 0) continue;
    lines[lines.length - 1].push({ ...w, w: ww });
    width += ww;
  }
  let y = top + size;
  if (measure) return top + size + (lines.length - 1) * lineH <= maxY;
  for (const line of lines) {
    while (line.length && line[line.length - 1].text === ' ') line.pop();
    const total = line.reduce((s, w) => s + w.w, 0);
    let x = cx - total / 2;
    for (const w of line) {
      g.fillStyle = 'rgba(0,0,0,0.85)';
      g.fillText(w.text, x + 2, y + 2);
      g.fillStyle = w.color;
      g.fillText(w.text, x, y);
      x += w.w;
    }
    y += lineH;
    if (y > maxY) break;
  }
}

/**
 * Paints the art into the window above the banner. The painting is centred on its point of
 * interest (`focus`) and may be zoomed out (`zoom` < 1) so more of it fits; the sides then show a
 * blurred, darkened copy that the sharp picture feathers into.
 */
function drawFramedArt(g, img, W, H, focus, zoom) {
  const winH = H * (0.5 - BANNER.y0 / CARD_H); // top edge down to the banner's centre line
  const cover = W / img.width;
  const s = cover * zoom;
  const iw = img.width * s;
  const ih = img.height * s;
  // Background: blurred cover fill of the whole card.
  const bs = Math.max(W / img.width, H / img.height) * 1.1;
  g.save();
  g.filter = 'blur(22px) brightness(0.55) saturate(1.2)';
  g.drawImage(img, (W - img.width * bs) / 2, (H - img.height * bs) / 2, img.width * bs, img.height * bs);
  g.restore();
  // Sharp picture: focus point on the window centre, clamped so it never leaves a gap at the top.
  let y = winH / 2 - focus * ih;
  y = Math.min(0, Math.max(y, winH - ih * 0.98));
  const x = (W - iw) / 2;
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  const t = tmp.getContext('2d');
  t.drawImage(img, x, y, iw, ih);
  if (zoom < 1) {
    // Feather the left/right edges into the blurred fill.
    const f = W * 0.05;
    t.globalCompositeOperation = 'destination-in';
    const grad = t.createLinearGradient(x, 0, x + iw, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(f / iw, 'rgba(0,0,0,1)');
    grad.addColorStop(1 - f / iw, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    t.fillStyle = grad;
    t.fillRect(0, 0, W, H);
  }
  g.drawImage(tmp, 0, 0);
}

/** Whole painting fitted to the card (inspect mode), blurred fill behind. */
function artCanvas(img) {
  const W = 1024;
  const H = Math.round(W * CARD_H / CARD_W);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#15110e';
  g.fillRect(0, 0, W, H);
  if (!img) return c;
  const bs = Math.max(W / img.width, H / img.height) * 1.1;
  g.save();
  g.filter = 'blur(22px) brightness(0.5)';
  g.drawImage(img, (W - img.width * bs) / 2, (H - img.height * bs) / 2, img.width * bs, img.height * bs);
  g.restore();
  const s = Math.min(W / img.width, H / img.height) * 0.97;
  g.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
  return c;
}

/** Ribbon band texture: crimson silk with gold edges and the gold title. */
function bannerCanvas(title) {
  const W = 2048;
  const H = Math.round(W * BANNER.h / BANNER.span);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const silk = g.createLinearGradient(0, 0, 0, H);
  silk.addColorStop(0, '#c4242b');
  silk.addColorStop(0.45, '#9b141b');
  silk.addColorStop(1, '#5c080d');
  g.fillStyle = silk;
  g.fillRect(0, 0, W, H);
  // Fabric sheen + faint weave.
  g.globalAlpha = 0.08;
  for (let x = 0; x < W; x += 6) {
    g.fillStyle = x % 12 ? '#000' : '#fff';
    g.fillRect(x, 0, 2, H);
  }
  g.globalAlpha = 1;
  const shine = g.createLinearGradient(0, 0, W, 0);
  shine.addColorStop(0, 'rgba(255,255,255,0)');
  shine.addColorStop(0.5, 'rgba(255,220,200,0.12)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = shine;
  g.fillRect(0, 0, W, H);
  // Gold edges (double line) and stitching.
  for (const [y, h] of [[4, 7], [H - 11, 7]]) {
    const gold = g.createLinearGradient(0, y, 0, y + h);
    gold.addColorStop(0, '#fff0b3');
    gold.addColorStop(0.5, '#d9a33c');
    gold.addColorStop(1, '#8a5a12');
    g.fillStyle = gold;
    g.fillRect(0, y, W, h);
  }
  g.strokeStyle = 'rgba(255,214,140,0.55)';
  g.setLineDash([14, 10]);
  g.lineWidth = 2;
  for (const y of [22, H - 22]) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.setLineDash([]);
  // Title (inside the card width: the band overhangs the card edges by 5% each side).
  let size = Math.round(H * 0.5);
  g.font = `700 ${size}px ${SERIF}`;
  const spaced = title.split('').join(String.fromCharCode(8202));
  while (g.measureText(spaced).width > W * 0.78 && size > 20) {
    size -= 4;
    g.font = `700 ${size}px ${SERIF}`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.16;
  g.strokeStyle = '#2a0406';
  g.strokeText(spaced, W / 2, H * 0.54);
  const tg = g.createLinearGradient(0, H * 0.25, 0, H * 0.8);
  tg.addColorStop(0, '#fff6cf');
  tg.addColorStop(0.5, '#f3cf6b');
  tg.addColorStop(1, '#c58a24');
  g.fillStyle = tg;
  g.fillText(spaced, W / 2, H * 0.54);
  return c;
}

/** Card back: dark leather, gold double frame, diamond emblem and the game's initials. */
export function backTexture() {
  const W = 512;
  const H = Math.round(W * CARD_H / CARD_W);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, H * 0.7);
  bg.addColorStop(0, '#3b2a1f');
  bg.addColorStop(1, '#140d09');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // Diamond lattice.
  g.strokeStyle = 'rgba(214,170,80,0.13)';
  g.lineWidth = 2;
  for (let k = -H; k < W + H; k += 36) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + H, H);
    g.moveTo(k, H);
    g.lineTo(k + H, 0);
    g.stroke();
  }
  g.strokeStyle = '#d6aa50';
  g.lineWidth = 6;
  g.strokeRect(26, 26, W - 52, H - 52);
  g.lineWidth = 2;
  g.strokeRect(40, 40, W - 80, H - 80);
  // Emblem.
  g.save();
  g.translate(W / 2, H / 2 - 20);
  g.rotate(Math.PI / 4);
  const em = g.createLinearGradient(-60, -60, 60, 60);
  em.addColorStop(0, '#ffe9a6');
  em.addColorStop(1, '#a8741f');
  g.fillStyle = em;
  g.fillRect(-62, -62, 124, 124);
  g.fillStyle = '#7d1016';
  g.fillRect(-44, -44, 88, 88);
  g.restore();
  g.fillStyle = '#ffe9a6';
  g.font = `700 46px ${SERIF}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('BPW', W / 2, H / 2 - 20);
  g.font = `600 20px ${SERIF}`;
  g.fillStyle = '#d6aa50';
  g.fillText('BLOCKED PIXEL WARRIORS', W / 2, H / 2 + 100);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  return t;
}

export function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
