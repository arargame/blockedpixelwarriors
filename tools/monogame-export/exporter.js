/**
 * Browser-side exporter for the MonoGame port (run by tools/export-monogame.mjs inside the Vite dev
 * server). Walks the live Three.js scene of the web game and writes:
 *
 *   Models/<name>.bpm      meshes: static world, backdrop, train cars, turret, blocks, heli, props
 *   Textures/<name>.png    every texture those meshes use + particles, clouds, UI art
 *   Fonts/<name>.png/.json bitmap font atlases
 *   Data/scene.json        camera, lights, fog, sky, clouds, post-processing, prefab metadata
 *
 * .bpm layout (little endian):
 *   "BPM1" | int32 jsonLength | utf8 json { materials:[...], parts:[{material, vertexStart,
 *   vertexCount, indexStart, indexCount}], bounds } | int32 vertexCount | vertices (36 bytes:
 *   position 3f, normal 3f, uv 2f, colour 4 bytes sRGB) | int32 indexCount | uint16 indices
 *   (relative to the part's vertexStart; parts never exceed 65535 vertices).
 *
 * Colours in the JSON are linear (Three.js working space); textures are sRGB PNGs (normal maps
 * linear). UVs are converted to MonoGame's convention (v = 0 at the top of the image).
 */
import * as THREE from 'three';
import { createVoxelLogo } from '/src/ui/VoxelLogo.js';
import { Palette } from '/src/config/Palette.js';

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpN3 = new THREE.Matrix3();
const tmpC = new THREE.Color();

export async function exportAll(game, save) {
  const ex = new Exporter(game, save);
  await ex.run();
  return ex.report;
}

class Exporter {
  constructor(game, save) {
    this.game = game;
    this.save = save;
    this.textures = new Map(); // texture -> name
    this.textureNames = new Set();
    this.textureSpaces = { ui_logo: 'srgb' };
    this.currentName = 'tex';
    this.report = { models: {}, textures: [] };
    this.nameTextures();
  }

  /** Name textures after their TextureFactory cache keys (fallback: uuid). */
  nameTextures() {
    for (const [key, value] of this.game.textures.cache) {
      if (value?.isTexture) this.registerName(value, key);
      else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) if (v?.isTexture) this.registerName(v, `${key}_${k}`);
      }
    }
  }

  registerName(texture, name) {
    if (this.textures.has(texture)) return this.textures.get(texture);
    let n = name.replace(/[^a-zA-Z0-9_]/g, '_');
    while (this.textureNames.has(n)) n += '_';
    this.textures.set(texture, n);
    this.textureNames.add(n);
    return n;
  }

  textureName(texture, hint) {
    if (!texture) return null;
    // Cloned textures (waterfall repeat) share the image: export the image once.
    for (const [t, n] of this.textures) if (t.image === texture.image && t !== texture) return n;
    return this.registerName(texture, texture.name || hint || `tex_${texture.uuid.slice(0, 8)}`);
  }

  async run() {
    const g = this.game;
    const w = g.world;
    const scene = g.scene;
    scene.updateMatrixWorld(true);

    // ---- Static world, split by what moves / how it is drawn --------------------------------
    const dynamicRoots = new Set([
      g.heli.object3d, g.blocks.group, g.mines.group, g.supplies.group,
      w.sky.mesh, w.sunGlare.mesh, w.clouds.group, w.boardClouds.group, w.snowFall.object3d, w.railSnow.group,
      g.logistics?.dock?.group, g.logistics?.engineer?.root, g.logistics?.chinook?.root, g.logistics?.chinook?.cable,
      g.checkpoint?.group,
    ].filter(Boolean));
    for (const fx of [g.effects.smoke, g.effects.fire, g.effects.sparks, g.effects.fireballs]) dynamicRoots.add(fx.object3d);
    if (g.effects.debris?.mesh) dynamicRoots.add(g.effects.debris.mesh);
    for (const b of Object.values(g.projectiles)) if (b?.mesh) dynamicRoots.add(b.mesh);
    for (const m of Object.values(g.projectiles.models ?? {})) for (const mesh of m.meshes) dynamicRoots.add(mesh);

    const buckets = { world_static: [], world_backdrop: [], world_foreground: [] };
    const isUnder = (o, root) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
    scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || !o.visible) return;
      for (let p = o; p; p = p.parent) if (dynamicRoots.has(p)) return;
      if (o.material?.isShaderMaterial) return; // billboards / sky (exported separately)
      if (isUnder(o, w.foreground)) buckets.world_foreground.push(o);
      else if (isUnder(o, w.backdrop)) buckets.world_backdrop.push(o);
      else buckets.world_static.push(o);
    });
    // Instanced meshes (island cubes, pines, sleepers) stay instanced: template + instance list.
    this.instanceSets = {};
    for (const [name, meshes] of Object.entries(buckets)) {
      const plain = meshes.filter((m) => !m.isInstancedMesh);
      await this.writeModel(name, plain, null);
      this.instanceSets[name] = [];
      let k = 0;
      for (const inst of meshes.filter((m) => m.isInstancedMesh)) {
        const file = `${name}_inst${k++}`;
        await this.writeInstances(file, inst);
        this.instanceSets[name].push(file);
      }
    }

    // ---- Train cars --------------------------------------------------------------------------
    const f = g.trainFactory;
    const prefabs = {};
    const carMeta = (car) => ({
      length: car.length,
      chimneys: car.chimneys.map((c) => c.toArray()),
      cannons: (car.cannons ?? []).map((c) => ({ muzzle: c.muzzle.toArray(), dir: c.dir.toArray() })),
      turrets: car.turrets.map((t) => ({ position: t.group.position.toArray(), muzzles: t.muzzles.map((m) => m.toArray()) })),
      targets: car.targets.filter((t) => t.kind !== 'cargo').map((t) => ({ kind: t.kind, min: t.box.min.toArray(), max: t.box.max.toArray(), hp: Number.isFinite(t.hp) ? t.hp : -1 })),
      cargo: car.targets.filter((t) => t.kind === 'cargo').map((t) => ({ min: t.box.min.toArray(), max: t.box.max.toArray(), color: t.colorKey, snow: !!t.mesh.children.length })),
    });
    for (const [name, car] of [['car_locomotive', f.buildLocomotive()], ['car_armored', f.buildArmoredWagon(31)], ['car_cargo', f.buildCargoWagon(17, 0.6)]]) {
      car.group.updateMatrixWorld(true);
      const skip = new Set();
      for (const t of car.turrets) skip.add(t.group);
      for (const t of car.targets) if (t.mesh) skip.add(t.mesh);
      const meshes = [];
      car.group.traverse((o) => {
        if (!(o.isMesh) || !o.visible) return;
        for (let p = o; p; p = p.parent) if (skip.has(p)) return;
        meshes.push(o);
      });
      await this.writeModel(name, meshes, car.group);
      prefabs[name] = carMeta(car);
    }
    // Turret: base (static) and head (yaw group).
    const turret = f.buildTurret();
    turret.group.updateMatrixWorld(true);
    await this.writeModel('turret_base', collect(turret.group, (o) => !isUnder(o, turret.yaw)), turret.group);
    await this.writeModel('turret_head', collect(turret.yaw), turret.yaw);
    prefabs.turret = { muzzles: turret.muzzles.map((m) => m.toArray()) };
    // Cargo cube + its snow pillow (shared geometry with the factory).
    const cube = f.addCargoCube(new THREE.Group(), 0, 0, 0, 1, 'red', true);
    cube.mesh.rotation.y = 0;
    cube.mesh.scale.setScalar(1);
    cube.mesh.updateMatrixWorld(true);
    await this.writeModel('cargo_cube', [cube.mesh], cube.mesh);
    await this.writeModel('cargo_snowcap', cube.mesh.children.filter((c) => c.isMesh), cube.mesh);

    // ---- Stage 2: BLOCK HAULER cars (Blender model) + checkpoint gate ------------------------
    const H = g.haulerFactory;
    if (H?.ready) {
      prefabs.hauler = {};
      const { HAULER_ORDER } = await import('/src/entities/HaulerModels.js');
      for (const name of [...new Set(HAULER_ORDER)]) {
        const car = H.build(name, () => 0.5);
        car.group.updateMatrixWorld(true);
        const skip = new Set();
        for (const t of car.turrets) skip.add(t.group);
        for (const t of car.targets) if (t.mesh) skip.add(t.mesh);
        const crane = car.cranes[0];
        if (crane) skip.add(crane.slew);
        const meshes = [];
        car.group.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          for (let q = o; q; q = q.parent) if (skip.has(q)) return;
          meshes.push(o);
        });
        const file = `hauler_${name.slice(6).toLowerCase()}`;
        await this.writeModel(file, meshes, car.group);
        const deck = H.find(car.group, 'CargoDeck');
        prefabs.hauler[name] = {
          model: file,
          ...carMeta(car),
          core: car.core ? car.core.toArray() : null,
          deck: deck ? H.local(car.group, deck).toArray() : null,
        };
        if (crane) {
          crane.slew.updateMatrixWorld(true);
          await this.writeModel('hauler_crane_slew', collect(crane.slew), crane.slew);
          crane.chain.updateMatrixWorld(true);
          await this.writeModel('hauler_chain', [crane.chain], crane.chain);
          crane.ball.updateMatrixWorld(true);
          await this.writeModel('hauler_ball', collect(crane.ball), crane.ball);
          prefabs.hauler[name].crane = { pivot: crane.slew.position.toArray(), tip: crane.tip.position.toArray() };
        }
      }
    }
    if (g.checkpoint) {
      const cp = g.checkpoint;
      const saved = cp.group.position.clone();
      cp.group.position.set(0, 0, 0);
      cp.group.updateMatrixWorld(true);
      await this.writeModel('checkpoint_gate', collect(cp.group, (o) => !isUnder(o, cp.inner)), cp.group);
      await this.writeModel('checkpoint_chevrons', collect(cp.inner), cp.inner);
      cp.group.position.copy(saved);
      cp.group.updateMatrixWorld(true);
    }

    // ---- Board blocks ------------------------------------------------------------------------
    const B = g.blocks;
    await this.writeInstancedTemplate('block', B.meshes.red);
    await this.writeInstancedTemplate('block_armor', B.armorMesh);
    await this.writeInstancedTemplate('block_supply', B.supplyMesh);
    await this.writeInstancedTemplate('block_cargo', B.cargoMesh);
    await this.writeInstancedTemplate('block_acid', B.acidMesh);
    for (let i = 0; i < B.snowMeshes.length; i++) await this.writeInstancedTemplate(`block_snowcap${i}`, B.snowMeshes[i]);
    // Rail snow drifts (RailSnow mound variants, instanced per sleeper span at runtime).
    const rs = w.railSnow;
    for (let i = 0; i < (rs?.meshes?.length ?? 0); i++) await this.writeInstancedTemplate(`rail_snow${i}`, rs.meshes[i]);
    prefabs.blockColors = Object.fromEntries(Object.entries(Palette.blocks).map(([k, v]) => [k, linear(v)]));

    // ---- Helicopter --------------------------------------------------------------------------
    const heli = g.heli;
    const model = heli.model;
    heli.object3d.position.set(0, 0, 0);
    heli.object3d.rotation.set(0, 0, 0);
    model.root.position.set(0, 0, 0);
    model.root.rotation.set(0, 0, 0);
    heli.object3d.updateMatrixWorld(true);
    const rotorSet = new Set([model.rotor, model.tailRotor].filter(Boolean));
    const heliRoot = heli.object3d;
    await this.writeModel('heli_body', collect(heliRoot, (o) => ![...rotorSet].some((r) => isUnder(o, r))), heliRoot);
    if (model.rotor) {
      await this.writeModel('heli_rotor', collect(model.rotor, (o) => o !== model.disc), model.rotor);
      if (model.disc) await this.writeModel('heli_rotor_disc', [model.disc], model.rotor);
    }
    if (model.tailRotor) await this.writeModel('heli_tail_rotor', collect(model.tailRotor), model.tailRotor);
    const toRoot = (o) => {
      const m = new THREE.Matrix4().copy(heliRoot.matrixWorld).invert().multiply(o.matrixWorld);
      return m.toArray();
    };
    prefabs.heli = {
      rotorMatrix: model.rotor ? toRoot(model.rotor) : null,
      tailRotorMatrix: model.tailRotor ? toRoot(model.tailRotor) : null,
      rotorAxis: model.rotorAxis ?? 'y',
      tailAxis: model.tailAxis ?? 'x',
      hardpoints: Object.fromEntries(Object.entries(model.hardpoints).map(([k, v]) => [k, model.root.localToWorld(v.clone()).toArray()])),
    };

    // ---- Projectiles / props -----------------------------------------------------------------
    for (const [kind, set] of Object.entries(g.projectiles.models ?? {})) {
      await this.writeGeometryList(`projectile_${kind}`, set.meshes.map((m) => ({ geometry: m.geometry, material: m.material })));
    }
    const sup = g.supplies;
    await this.writeGeometryList('supply_crate', [{ geometry: sup.crateGeometry, material: sup.crateMaterials.T }]);
    prefabs.supplyCrateTextures = Object.fromEntries(Object.entries(sup.crateMaterials).map(([k, m]) => [k, this.textureName(m.map, `crate_${k}`)]));
    sup.firstAid.updateMatrixWorld(true);
    await this.writeModel('supply_firstaid', collect(sup.firstAid), sup.firstAid);
    await this.writeGeometryList('supply_gem', [{ geometry: sup.gemGeometry, material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.35, flatShading: true }) }]);
    if (g.mines?.geometry) await this.writeGeometryList('spike_ball', [{ geometry: g.mines.geometry, material: g.mines.material }]);

    // ---- Logistics: forklift + engineer, gift packages, dock marking, CH-47F ------------------
    const L = g.logistics;
    if (L) {
      const rel = (root, o) => new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(o.matrixWorld).toArray();
      // Forklift (root at the origin, forks at rest); the carried crate is drawn with cargo_cube.
      const e = L.engineer;
      const savedPos = e.root.position.clone();
      const savedRot = e.root.rotation.clone();
      e.root.position.set(0, 0, 0);
      e.root.rotation.set(0, 0, 0);
      e.forks.position.y = e.forksBase;
      e.root.updateMatrixWorld(true);
      const notCrate = (o) => o !== e.crate && !isUnder(o, e.crate);
      await this.writeModel('forklift_body', collect(e.root, (o) => !isUnder(o, e.forks)), e.root);
      await this.writeModel('forklift_forks', collect(e.forks, notCrate), e.forks);
      prefabs.forklift = {
        forksMatrix: rel(e.root, e.forks),
        crateMatrix: rel(e.forks, e.crate),
        beacon: e.beacon.position.toArray(),
      };
      e.root.position.copy(savedPos);
      e.root.rotation.copy(savedRot);
      // Gift package: coloured box + gold ribbon / bow.
      const gift = L.gifts.build('red');
      gift.updateMatrixWorld(true);
      const box = gift.children[0];
      await this.writeModel('gift_box', [box], gift);
      await this.writeModel('gift_ribbon', gift.children.filter((c) => c !== box), gift);
      // Dock lane marking (column 0, world space; the second lane is the same mesh shifted).
      L.dock.markings[0].updateMatrixWorld(true);
      await this.writeModel('dock_marking', [L.dock.markings[0]], null);
      // Chinook: body + the two rotors (each in its own space).
      const ch = L.chinook;
      const cPos = ch.root.position.clone();
      const cRot = ch.root.rotation.clone();
      ch.root.position.set(0, 0, 0);
      ch.root.rotation.set(0, 0, 0);
      ch.root.updateMatrixWorld(true);
      await this.writeModel('chinook_body', collect(ch.root, (o) => !ch.rotors.some((r) => isUnder(o, r))), ch.root);
      prefabs.chinook = { rotors: [] };
      for (let i = 0; i < ch.rotors.length; i++) {
        await this.writeModel(`chinook_rotor${i}`, collect(ch.rotors[i]), ch.rotors[i]);
        prefabs.chinook.rotors.push(rel(ch.root, ch.rotors[i]));
      }
      ch.root.position.copy(cPos);
      ch.root.rotation.copy(cRot);
    }

    // ---- Upgrade cards: Blender card model + per-card face / art / banner textures ----------
    const cards = g.cards;
    if (cards) {
      await cards.ready;
      if (cards.template) {
        const wrap = new THREE.Group();
        const model = cards.template.clone(true);
        model.rotation.x = Math.PI / 2; // glTF front faces +Y -> toward the camera (+Z)
        wrap.add(model);
        wrap.updateMatrixWorld(true);
        // glTF UVs: origin top-left, the card textures are written top row first -> no v flip.
        this.forceNoFlip = true;
        await this.writeModel('card', collect(wrap), wrap);
        this.forceNoFlip = false;
      }
      const { CARD_DEFS } = await import('/src/ui/UpgradeCards.js');
      prefabs.cards = [];
      for (const def of CARD_DEFS) {
        const c = cards.buildCard(def);
        for (const [suffix, tex] of [['front', c.frontTex], ['art', c.artTex], ['banner', c.bannerTex]]) {
          await this.save(`Textures/card_${def.id}_${suffix}.png`, canvasBase64(tex.image));
          this.textureSpaces[`card_${def.id}_${suffix}`] = 'srgb';
        }
        prefabs.cards.push({ id: def.id, title: def.title, kind: def.kind, requires: def.requires ?? null, jewel: linear(def.jewel), glow: linear(def.glow) });
        c.frontTex.dispose();
        c.artTex.dispose();
        c.bannerTex.dispose();
      }
      await this.save('Textures/card_back.png', canvasBase64(cards.backTexture.image));
      this.textureSpaces.card_back = 'srgb';
      await this.save('Textures/card_glow.png', canvasBase64(cards.glowTexture.image));
      this.textureSpaces.card_glow = 'linear';
    }

    // ---- Main menu: card faces per language, rows and strings ---------------------------------
    if (g.menu) {
      await g.menu.ready;
      const { MENU_ROWS, menuFrontCanvas } = await import('/src/ui/MenuCards.js');
      const { MENU_TEXT, LANGUAGE_NAMES } = await import('/src/ui/MenuText.js');
      const { LANGUAGES } = await import('/src/core/Settings.js');
      for (const row of MENU_ROWS) {
        for (const def of row.cards) {
          for (const lang of LANGUAGES) {
            const name = `card_menu_${def.id}_${lang}`;
            await this.save(`Textures/${name}.png`, canvasBase64(menuFrontCanvas(def, g.menu.images.get(def.art), lang)));
            this.textureSpaces[name] = 'srgb';
          }
        }
      }
      prefabs.menu = {
        languages: [...LANGUAGES],
        languageNames: LANGUAGE_NAMES,
        text: MENU_TEXT,
        rows: MENU_ROWS.map((r) => ({
          id: r.id, label: r.label, sub: r.sub, head: r.head,
          cards: r.cards.map((c) => ({ id: c.id, scenario: !!c.scenario, locked: !!c.locked, panel: c.panel ?? null, jewel: linear(c.jewel), glow: linear(c.glow), glowHex: c.glow, title: c.title })),
        })),
      };
    }

    // ---- Particles, clouds, misc textures ----------------------------------------------------
    const T = g.textures;
    const extra = {
      fx_smoke: T.smokePuff(), fx_glow: T.glow(), fx_streak: T.streak(), fx_fireball: T.fireball(), fx_orb: T.orb(),
      fx_comet: T.comet(), fx_plasma: T.plasmaBolt(), fx_tracer: T.tracerBolt(), fx_sunglare: T.sunGlare(),
      cloud0: T.cloudPuff(0), cloud1: T.cloudPuff(1), cloud2: T.cloudPuff(2),
    };
    for (const [name, tex] of Object.entries(extra)) this.registerName(tex, name);
    g.updateReticle?.(0);
    if (g.reticle) this.registerName(g.reticle.material.map, 'ui_reticle');
    const logo = createVoxelLogo(2);
    await this.save('Textures/ui_logo.png', canvasBase64(logo));
    this.report.textures.push('ui_logo');
    for (const tex of [...this.textures.keys()]) await this.writeTexture(tex);

    // ---- Fonts -------------------------------------------------------------------------------
    await this.writeFont('font_hud', "900 46px 'Arial Black', 'Segoe UI Black', Impact, system-ui, sans-serif", 46);
    await this.writeFont('font_ui', '600 40px system-ui, sans-serif', 40);
    await this.writeFont('font_mono', '500 34px Consolas, "SF Mono", Menlo, "DejaVu Sans Mono", monospace', 34);
    await this.writeFont('font_serif', '700 64px Georgia, "Times New Roman", serif', 64);

    // ---- Scene description -------------------------------------------------------------------
    await this.save('Data/scene.json', b64(JSON.stringify(this.sceneJson(prefabs), null, 1)));
    await this.writeEnvironment();
  }

  /**
   * Data/environment.bin: the PMREM RoomEnvironment as equirectangular half-float maps at several
   * roughness levels, sampled with Three's own textureCubeUV so the port lights exactly the same.
   * "BPE1" | int32 width | int32 height | int32 levels | float32[levels] roughness | half4 texels
   * (level after level, row 0 = straight up; u = atan2(x, -z) / 2pi + 0.5, v = acos(y) / pi).
   */
  async writeEnvironment() {
    const renderer = this.game.pipeline.renderer;
    const env = this.game.scene.environment;
    if (!env?.image?.height) return;
    const imageHeight = env.image.height;
    const maxMip = Math.log2(imageHeight) - 2;
    const W = 256;
    const H = 128;
    const levels = [0.0525, 0.1, 0.2, 0.3, 0.4, 0.55, 0.75, 1.0];
    const material = new THREE.ShaderMaterial({
      defines: {
        ENVMAP_TYPE_CUBE_UV: '',
        CUBEUV_TEXEL_WIDTH: 1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16)),
        CUBEUV_TEXEL_HEIGHT: 1 / imageHeight,
        CUBEUV_MAX_MIP: `${maxMip}.0`,
      },
      uniforms: { envMap: { value: env }, uRoughness: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        #include <common>
        #include <cube_uv_reflection_fragment>
        uniform sampler2D envMap;
        uniform float uRoughness;
        varying vec2 vUv;
        void main() {
          float phi = (vUv.x - 0.5) * 2.0 * PI;
          float theta = (1.0 - vUv.y) * PI;
          vec3 dir = vec3(sin(theta) * sin(phi), cos(theta), -sin(theta) * cos(phi));
          gl_FragColor = vec4(textureCubeUV(envMap, dir, uRoughness).rgb, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    const scene = new THREE.Scene();
    scene.add(quad);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
    const header = 16 + levels.length * 4;
    const buf = new ArrayBuffer(header + W * H * levels.length * 8);
    const dv = new DataView(buf);
    'BPE1'.split('').forEach((ch, i) => dv.setUint8(i, ch.charCodeAt(0)));
    dv.setInt32(4, W, true);
    dv.setInt32(8, H, true);
    dv.setInt32(12, levels.length, true);
    levels.forEach((r, i) => dv.setFloat32(16 + i * 4, r, true));
    const px = new Float32Array(W * H * 4);
    const oldTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    let o = header;
    for (const r of levels) {
      material.uniforms.uRoughness.value = r;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
      for (let y = H - 1; y >= 0; y--) {
        for (let x = 0; x < W; x++) {
          for (let k = 0; k < 4; k++) {
            dv.setUint16(o, THREE.DataUtils.toHalfFloat(k === 3 ? 1 : px[(y * W + x) * 4 + k]), true);
            o += 2;
          }
        }
      }
    }
    renderer.setRenderTarget(null);
    renderer.toneMapping = oldTone;
    rt.dispose();
    material.dispose();
    await this.save('Data/environment.bin', arrayBase64(buf));
  }

  sceneJson(prefabs) {
    const g = this.game;
    const w = g.world;
    const cam = g.camera;
    const sun = w.sun;
    const hemi = g.scene.children.find((o) => o.isHemisphereLight);
    const fill = g.scene.children.find((o) => o.isDirectionalLight && o !== sun);
    const grade = g.pipeline.gradePass?.uniforms;
    const bloom = g.pipeline.bloomPass;
    const sky = w.sky.uniforms;
    const glare = w.sunGlare;
    const cloudLayer = (layer, parent) => ({
      parent,
      variants: layer.variants.map((v) => v.items.map((c) => ({ x: c.x, y: c.y, z: c.z, size: c.size, aspect: c.aspect ?? 1, tint: c.tint ?? 1, alpha: c.alpha ?? 1, drift: c.drift ?? 0.25, wrap: c.wrap ?? 0 }))),
    });
    return {
      camera: {
        position: g.cameraBase.toArray(), pitchDeg: g.cameraSpec.pitchDeg, yawDeg: g.cameraSpec.yawDeg, rollDeg: g.cameraSpec.rollDeg ?? 0,
        fov: g.cameraSpec.fov, near: cam.near, far: cam.far, lensK: g.cameraSpec.lensK, followStrength: 0.2, heliAnchor: g.heliAnchor.toArray(),
      },
      lights: {
        hemi: { sky: linearOf(hemi.color), ground: linearOf(hemi.groundColor), intensity: hemi.intensity },
        sun: {
          color: linearOf(sun.color), intensity: sun.intensity, position: sun.position.toArray(), target: sun.target.position.toArray(),
          shadow: { left: sun.shadow.camera.left, right: sun.shadow.camera.right, top: sun.shadow.camera.top, bottom: sun.shadow.camera.bottom, near: sun.shadow.camera.near, far: sun.shadow.camera.far, bias: sun.shadow.bias, normalBias: sun.shadow.normalBias, radius: sun.shadow.radius },
        },
        fill: fill ? { color: linearOf(fill.color), intensity: fill.intensity, position: fill.position.toArray() } : null,
        environmentIntensity: g.scene.environmentIntensity ?? 1,
      },
      fog: { color: linearOf(g.scene.fog.color), near: g.scene.fog.near, far: g.scene.fog.far },
      backdrop: { quaternion: w.backdrop.quaternion.toArray(), position: w.backdrop.position.toArray() },
      sky: {
        top: linearOf(sky.uTop.value), mid: linearOf(sky.uMid.value), horizon: linearOf(sky.uHorizon.value), bottom: linearOf(sky.uBottom.value),
        sunDir: sky.uSunDir.value.toArray(), sunColor: linearOf(sky.uSunColor.value), horizonOffset: sky.uHorizonOffset.value,
      },
      sunGlare: { position: [glare.positions[0], glare.positions[1], glare.positions[2]], size: glare.sizes[0], color: [glare.colors[0], glare.colors[1], glare.colors[2], glare.colors[3]] },
      clouds: [cloudLayer(w.clouds, 'backdrop'), cloudLayer(w.boardClouds, 'world')],
      post: {
        exposure: grade?.uExposure.value, saturation: grade?.uSaturation.value, contrast: grade?.uContrast.value, vignette: grade?.uVignette.value,
        sunPos: grade?.uSunPos.value.toArray(), sunColor: grade ? linearOf(grade.uSunColor.value) : null, sunStrength: grade?.uSunStrength.value,
        haze: grade ? linearOf(grade.uHaze.value) : null, hazeStrength: grade?.uHazeStrength.value, tint: grade ? linearOf(grade.uTint.value) : null,
        bloom: bloom ? { strength: bloom.strength, radius: bloom.radius, threshold: bloom.threshold } : null,
        toneMappingExposure: g.pipeline.renderer.toneMappingExposure,
      },
      waterfallScroll: 0.9,
      prefabs,
      instanceSets: this.instanceSets,
      textures: this.textureSpaces,
      models: this.report.models,
    };
  }

  // ------------------------------------------------------------------------------------------
  // Meshes
  // ------------------------------------------------------------------------------------------

  /**
   * .bpi = "BPI1" | int32 jsonLength | json {meshMatrix (XNA row order), count} | int32 count |
   * per instance: 12 floats (XNA rows M11..M43 of the instance matrix) + 4 floats linear colour |
   * the template mesh as an embedded .bpm (instance-local geometry + material).
   */
  async writeInstances(name, inst) {
    const rows = [];
    const colors = [];
    for (let i = 0; i < inst.count; i++) {
      inst.getMatrixAt(i, tmpM);
      const e = tmpM.elements;
      if (e[0] === 0 && e[5] === 0 && e[10] === 0) continue;
      rows.push(e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]);
      if (inst.instanceColor) {
        inst.getColorAt(i, tmpC);
        colors.push(tmpC.r, tmpC.g, tmpC.b, 1);
      } else {
        colors.push(1, 1, 1, 1);
      }
    }
    const count = rows.length / 12;
    const me = inst.matrixWorld.elements;
    const json = new TextEncoder().encode(JSON.stringify({ meshMatrix: [...me], count, instanceColors: !!inst.instanceColor }));
    this.currentName = name;
    const template = await this.buildModel([{ geometry: inst.geometry, material: inst.material }]);
    const buf = new ArrayBuffer(4 + 4 + json.length + 4 + count * 64 + template.byteLength);
    const dv = new DataView(buf);
    let o = 0;
    for (const ch of 'BPI1') dv.setUint8(o++, ch.charCodeAt(0));
    dv.setInt32(o, json.length, true); o += 4;
    new Uint8Array(buf, o, json.length).set(json); o += json.length;
    dv.setInt32(o, count, true); o += 4;
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 12; k++) { dv.setFloat32(o, rows[i * 12 + k], true); o += 4; }
      for (let k = 0; k < 4; k++) { dv.setFloat32(o, colors[i * 4 + k], true); o += 4; }
    }
    new Uint8Array(buf, o, template.byteLength).set(new Uint8Array(template));
    await this.save(`Models/${name}.bpi`, arrayBase64(buf));
    this.report.models[name] = { instances: count, templateVertices: this.lastVertexCount };
  }

  /** Template mesh of an InstancedMesh (its geometry + material, identity transform). */
  async writeInstancedTemplate(name, inst) {
    await this.writeGeometryList(name, [{ geometry: inst.geometry, material: inst.material }]);
  }

  async writeGeometryList(name, list) {
    this.currentName = name;
    const buf = await this.buildModel(list);
    await this.save(`Models/${name}.bpm`, arrayBase64(buf));
    this.report.models[name] = { vertices: this.lastVertexCount };
  }

  async buildModel(list) {
    const root = new THREE.Group();
    const meshes = list.map(({ geometry, material }) => {
      const m = new THREE.Mesh(geometry, material);
      root.add(m);
      return m;
    });
    root.updateMatrixWorld(true);
    return this.encodeModel(meshes, root);
  }

  /**
   * Merges meshes into one .bpm grouped by material. `space` = root object whose local space the
   * vertices are written in (null = world space).
   */
  async writeModel(name, meshes, space) {
    this.currentName = name;
    const buf = this.encodeModel(meshes, space);
    await this.save(`Models/${name}.bpm`, arrayBase64(buf));
    this.report.models[name] = { vertices: this.lastVertexCount, parts: this.lastPartCount };
  }

  encodeModel(meshes, space) {
    const inv = space ? new THREE.Matrix4().copy(space.matrixWorld).invert() : new THREE.Matrix4();
    const byMaterial = new Map();
    for (const mesh of meshes) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const geo = mesh.geometry;
      const groups = Array.isArray(mesh.material) && geo.groups.length ? geo.groups : [{ start: 0, count: geo.index ? geo.index.count : geo.attributes.position.count, materialIndex: 0 }];
      for (const grp of groups) {
        const mat = materials[grp.materialIndex ?? 0];
        if (!mat || mat.visible === false) continue;
        if (!byMaterial.has(mat)) byMaterial.set(mat, []);
        byMaterial.get(mat).push({ mesh, grp });
      }
    }
    const materials = [];
    const parts = [];
    const verts = [];
    const indices = [];
    let vCount = 0;
    const bounds = new THREE.Box3();
    for (const [mat, list] of byMaterial) {
      const mIndex = materials.length;
      materials.push(this.material(mat));
      const flip = this.forceNoFlip ? false : mat.map ? mat.map.flipY : true;
      const uvMatrix = mat.map ? (mat.map.updateMatrix(), mat.map.matrix.clone()) : new THREE.Matrix3();
      // One part per material (split when it would exceed 65535 vertices).
      let part = null;
      const newPart = () => {
        part = { material: mIndex, vertexStart: vCount, vertexCount: 0, indexStart: indices.length, indexCount: 0 };
        parts.push(part);
      };
      newPart();
      for (const { mesh, grp: grp0 } of list) {
        let geo = mesh.geometry;
        let grp = grp0;
        if (mat.flatShading) {
          // Faceted look (gems): one normal per triangle.
          geo = geo.index ? geo.toNonIndexed() : geo.clone();
          geo.deleteAttribute('normal');
          geo.computeVertexNormals();
          grp = { start: 0, count: geo.attributes.position.count, materialIndex: 0 };
        }
        const pos = geo.attributes.position;
        const nrm = geo.attributes.normal;
        const uv = geo.attributes.uv;
        const col = geo.attributes.color;
        const idx = geo.index;
        const instances = mesh.isInstancedMesh ? mesh.count : 1;
        const start = grp.start;
        const count = grp.count - (grp.count % 3);
        for (let inst = 0; inst < instances; inst++) {
          const world = new THREE.Matrix4().copy(mesh.matrixWorld);
          if (mesh.isInstancedMesh) {
            mesh.getMatrixAt(inst, tmpM);
            if (tmpM.elements[0] === 0 && tmpM.elements[5] === 0 && tmpM.elements[10] === 0) continue; // hidden slot
            world.multiply(tmpM);
          }
          const m = new THREE.Matrix4().multiplyMatrices(inv, world);
          tmpN3.getNormalMatrix(m);
          const instColor = mesh.isInstancedMesh && mesh.instanceColor ? (mesh.getColorAt(inst, tmpC), tmpC.clone()) : null;
          // Triangle by triangle: a part never exceeds 65535 vertices (16-bit indices relative to
          // the part), even when a single mesh is bigger than that.
          let remap = new Map();
          const emit = (vi) => {
            tmpV.fromBufferAttribute(pos, vi).applyMatrix4(m);
            bounds.expandByPoint(tmpV);
            if (nrm) tmpN.fromBufferAttribute(nrm, vi).applyMatrix3(tmpN3).normalize();
            else tmpN.set(0, 1, 0);
            let u = 0;
            let v = 0;
            if (uv) {
              const t = new THREE.Vector3(uv.getX(vi), uv.getY(vi), 1).applyMatrix3(uvMatrix);
              u = t.x;
              v = flip ? 1 - t.y : t.y;
            }
            let r = 1, gg = 1, b = 1, a = 1;
            if (col && mat.vertexColors) {
              r = col.getX(vi); gg = col.getY(vi); b = col.getZ(vi);
              if (col.itemSize === 4) a = col.getW(vi);
            }
            if (instColor) { r *= instColor.r; gg *= instColor.g; b *= instColor.b; }
            verts.push(tmpV.x, tmpV.y, tmpV.z, tmpN.x, tmpN.y, tmpN.z, u, v, toSrgb8(r), toSrgb8(gg), toSrgb8(b), Math.round(clamp01(a) * 255));
            remap.set(vi, part.vertexCount);
            part.vertexCount++;
            vCount++;
          };
          for (let k = start; k < start + count; k += 3) {
            const tri = [0, 1, 2].map((o) => (idx ? idx.getX(k + o) : k + o));
            const fresh = new Set(tri.filter((vi) => !remap.has(vi))).size;
            if (part.vertexCount + fresh > 65535) {
              newPart();
              remap = new Map();
            }
            for (const vi of tri) if (!remap.has(vi)) emit(vi);
            for (const vi of tri) indices.push(remap.get(vi));
            part.indexCount += 3;
          }
        }
      }
    }
    const json = { materials, parts, bounds: bounds.isEmpty() ? null : { min: bounds.min.toArray(), max: bounds.max.toArray() } };
    const vertexBytes = vCount * 36;
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const total = 4 + 4 + jsonBytes.length + 4 + vertexBytes + 4 + indices.length * 2;
    const buf = new ArrayBuffer(total);
    const dv = new DataView(buf);
    let o = 0;
    for (const ch of 'BPM1') dv.setUint8(o++, ch.charCodeAt(0));
    dv.setInt32(o, jsonBytes.length, true); o += 4;
    new Uint8Array(buf, o, jsonBytes.length).set(jsonBytes); o += jsonBytes.length;
    dv.setInt32(o, vCount, true); o += 4;
    for (let i = 0; i < vCount; i++) {
      const s = i * 12;
      for (let k = 0; k < 8; k++) { dv.setFloat32(o, verts[s + k], true); o += 4; }
      for (let k = 8; k < 12; k++) dv.setUint8(o++, verts[s + k]);
    }
    dv.setInt32(o, indices.length, true); o += 4;
    // Indices are already relative to their part.
    for (let i = 0; i < indices.length; i++) { dv.setUint16(o, indices[i], true); o += 2; }
    this.lastVertexCount = vCount;
    this.lastPartCount = parts.length;
    return buf;
  }

  material(m) {
    const voxel = m.userData?.voxelUniforms;
    const tile = m.userData?.tileUniforms;
    const out = {
      name: m.name || m.type,
      type: m.isMeshBasicMaterial ? 'basic' : 'standard',
      color: linearOf(m.color ?? new THREE.Color(1, 1, 1)),
      opacity: m.opacity ?? 1,
      transparent: !!m.transparent,
      alphaTest: m.alphaTest ?? 0,
      side: m.side === THREE.DoubleSide ? 2 : m.side === THREE.BackSide ? 1 : 0,
      depthWrite: m.depthWrite !== false,
      additive: m.blending === THREE.AdditiveBlending,
      vertexColors: !!m.vertexColors,
      roughness: m.roughness ?? 1,
      metalness: m.metalness ?? 0,
      envMapIntensity: m.envMapIntensity ?? 1,
      flatShading: !!m.flatShading,
      emissive: m.emissive ? linearOf(m.emissive).map((c) => c * (m.emissiveIntensity ?? 1)) : [0, 0, 0],
      map: this.textureName(m.map, `${this.currentName}_map`),
      normalMap: this.textureName(m.normalMap, `${this.currentName}_normal`),
      normalScale: m.normalScale ? m.normalScale.toArray() : [1, 1],
      emissiveMap: this.textureName(m.emissiveMap, `${this.currentName}_emissive`),
      toneMapped: m.toneMapped !== false,
      voxel: voxel ? { size: voxel.uVoxelSize.value, jitter: voxel.uVoxelJitter.value, seam: voxel.uVoxelSeam.value } : null,
      tile: tile ? {
        origin: tile.uTileOrigin.value.toArray(), size: tile.uTileSize.value, grout: tile.uGrout.value, groutColor: linearOf(tile.uGroutColor.value),
        crop: tile.uCrop.value, imageAspect: tile.uImageAspect.value,
      } : null,
      // Waterfalls scroll their texture down (FloatingIslands.update: offset.y += dt * 0.9).
      scrollV: this.isWaterfall(m) ? 0.9 : 0,
    };
    // MonoGame samples textures with v = 0 at the top: flipY maps need their scroll inverted.
    if (out.scrollV && (m.map?.flipY ?? true)) out.scrollV = -out.scrollV;
    return out;
  }

  isWaterfall(m) {
    const w = this.game.world;
    return [w.islands, w.shores].some((isl) => isl?.waterfallMaterials?.includes(m));
  }

  // ------------------------------------------------------------------------------------------
  // Textures / fonts
  // ------------------------------------------------------------------------------------------

  async writeTexture(texture) {
    const name = this.textures.get(texture);
    if (this.report.textures.includes(name)) return;
    const img = texture.image;
    let canvas;
    if (img?.data && img.width) {
      canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      const id = ctx.createImageData(img.width, img.height);
      const src = img.data;
      const ch = src.length / (img.width * img.height);
      for (let i = 0; i < img.width * img.height; i++) {
        for (let k = 0; k < 4; k++) id.data[i * 4 + k] = k < ch ? toByte(src[i * ch + k]) : 255;
      }
      ctx.putImageData(id, 0, 0);
    } else if (img && (img.width || img.naturalWidth)) {
      canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
    } else {
      return;
    }
    // MonoGame expects the image top row first; DataTextures are stored bottom-up in Three.js.
    if (img?.data && texture.flipY === false) {
      const flipped = document.createElement('canvas');
      flipped.width = canvas.width;
      flipped.height = canvas.height;
      const fx = flipped.getContext('2d');
      fx.translate(0, canvas.height);
      fx.scale(1, -1);
      fx.drawImage(canvas, 0, 0);
      canvas = flipped;
    }
    await this.save(`Textures/${name}.png`, canvasBase64(canvas));
    this.report.textures.push(name);
    // Three decodes only sRGB-tagged textures; everything else is sampled as-is.
    this.textureSpaces[name] = texture.colorSpace === THREE.SRGBColorSpace ? 'srgb' : 'linear';
  }

  async writeFont(name, font, size) {
    const chars = [];
    for (let c = 32; c < 127; c++) chars.push(String.fromCharCode(c));
    for (const c of 'ÇĞİÖŞÜçğıöşü·•→←↑↓›‹➜✖☠⬆◆—–…×°◀▶✔▲▼') chars.push(c);
    const pad = Math.ceil(size * 0.18);
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = font;
    const metrics = chars.map((ch) => ({ ch, m: probe.measureText(ch) }));
    const ascent = Math.ceil(Math.max(...metrics.map((x) => x.m.actualBoundingBoxAscent || size * 0.8)));
    const descent = Math.ceil(Math.max(...metrics.map((x) => x.m.actualBoundingBoxDescent || size * 0.2)));
    const cellH = ascent + descent + pad * 2;
    const W = 1024;
    let x = 0;
    let y = 0;
    const glyphs = {};
    for (const { ch, m } of metrics) {
      const left = Math.floor(m.actualBoundingBoxLeft ?? 0);
      const w = Math.ceil((m.actualBoundingBoxRight ?? m.width) + (m.actualBoundingBoxLeft ?? 0)) + pad * 2;
      if (x + w > W) { x = 0; y += cellH; }
      glyphs[ch.codePointAt(0)] = { x, y, w, h: cellH, ox: -left - pad, adv: m.width };
      x += w;
    }
    const H = 1 << Math.ceil(Math.log2(y + cellH));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    for (const { ch } of metrics) {
      const gl = glyphs[ch.codePointAt(0)];
      ctx.fillText(ch, gl.x - gl.ox, gl.y + pad + ascent);
    }
    await this.save(`Fonts/${name}.png`, canvasBase64(canvas));
    await this.save(`Fonts/${name}.json`, b64(JSON.stringify({ size, ascent, descent, lineHeight: cellH - pad * 2, pad, glyphs })));
  }
}

function collect(root, filter = () => true) {
  const out = [];
  root.traverse((o) => { if (o.isMesh && o.visible && filter(o)) out.push(o); });
  return out;
}

function linear(hex) {
  return linearOf(new THREE.Color(hex));
}

function linearOf(c) {
  return [c.r, c.g, c.b];
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function toSrgb8(linearValue) {
  const c = clamp01(linearValue);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

function toByte(v) {
  return v <= 1 && !Number.isInteger(v) ? Math.round(clamp01(v) * 255) : Math.min(255, v);
}

function canvasBase64(canvas) {
  return canvas.toDataURL('image/png').split(',')[1];
}

function arrayBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}

function b64(text) {
  return arrayBase64(new TextEncoder().encode(text).buffer);
}
