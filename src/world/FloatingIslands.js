import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Palette } from '../config/Palette.js';
import { Random } from '../util/Random.js';
import { ValueNoise2D } from '../util/Noise.js';

/**
 * Voxel sky islands with grass tops, layered rock cliffs, tapering undersides,
 * pine forests and animated waterfalls.
 */
export class FloatingIslands {
  /**
   * @param {import('../textures/MaterialLibrary.js').MaterialLibrary} materials
   * @param {import('../textures/TextureFactory.js').TextureFactory} textures
   * @param {Array<{x:number,y:number,z:number,radius:number,depth:number,cell?:number,seed:number,waterfalls?:number,trees?:number}>} specs
   */
  constructor(materials, textures, specs) {
    this.group = new THREE.Group();
    this.treePlacements = [];
    this.waterfallMaterials = [];
    this.mistPoints = [];

    this.waterfallTexture = textures.waterfall();
    const cubes = [];
    for (const spec of specs) this.buildIsland(spec, cubes);

    const geometry = new RoundedBoxGeometry(1, 1, 1, 1, 0.07);
    const mesh = new THREE.InstancedMesh(geometry, materials.terrain(), cubes.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    cubes.forEach((c, i) => {
      dummy.position.set(c.x, c.y, c.z);
      dummy.scale.set(c.s, c.h, c.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(c.color));
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  buildIsland(spec, cubes) {
    const rng = new Random(spec.seed);
    const noise = new ValueNoise2D(rng, 16);
    const cell = spec.cell ?? 1;
    const R = spec.radius;
    const n = Math.ceil(R / cell) + 1;
    const grass = new THREE.Color(Palette.grass);
    const grassDark = new THREE.Color(Palette.grassDark);
    const rock = new THREE.Color(Palette.rock);
    const rockDark = new THREE.Color(Palette.rockDark);
    const dirt = new THREE.Color(0x8a6a45);
    const edgeCells = [];

    for (let gx = -n; gx <= n; gx++) {
      for (let gz = -n; gz <= n; gz++) {
        const x = gx * cell;
        const z = gz * cell;
        const ang = Math.atan2(z, x);
        const shapeR = R * (0.72 + noise.fbm(Math.cos(ang) * 2 + 5, Math.sin(ang) * 2 + 5, 3) * 0.55);
        const r = Math.hypot(x, z);
        if (r > shapeR) continue;
        const k = r / shapeR;
        // Terraced top.
        // Terraced mesa: higher toward the center with blocky steps, so cliff faces show.
        const mesa = (1 - k) * (spec.mesa ?? 2.5) + (noise.fbm(x * 0.18 + 9, z * 0.18, 3) - 0.5) * 2.5;
        const top = Math.round(mesa) * cell;
        // Cliff islands keep near-vertical walls (like the key art's mesas), others taper.
        const profile = spec.cliff ? 1 - Math.pow(k, 6) * 0.45 : 1 - Math.pow(k, 1.6);
        const depth = spec.depth * profile * (0.65 + noise.fbm(x * 0.3, z * 0.3 + 4, 2) * 0.7) + cell;
        const layers = Math.max(1, Math.round(depth / cell));
        for (let l = 0; l < layers; l++) {
          const y = spec.y + top - l * cell - cell * 0.5;
          let c;
          if (l === 0) c = grass.clone().lerp(grassDark, rng.next() * 0.5);
          else if (l === 1) c = dirt.clone().lerp(rock, rng.next() * 0.5);
          else {
            const strata = Math.sin((y + spec.seed) * 1.7) * 0.5 + 0.5;
            c = rock.clone().lerp(rockDark, strata * 0.45 + rng.next() * 0.25 + (l / layers) * 0.25);
            // Warm ochre streaks in the stone like sunlit sandstone.
            if (rng.chance(0.18)) c.lerp(new THREE.Color(0xb98a5a), 0.45);
          }
          // Bottom-most cubes shrink to make a stalactite tip.
          const shrink = l === layers - 1 && layers > 2 ? 0.7 : 1;
          cubes.push({ x: spec.x + x, y, z: spec.z + z, s: cell * shrink, h: cell, color: c });
        }
        // Waterfalls only on the camera-facing side (+X / +Z) so they are visible.
        if (k > 0.75 && Math.cos(ang) * 0.8 + Math.sin(ang) * 0.6 > 0.35) edgeCells.push({ x, z, top, ang });
        if (k < 0.8 && rng.chance(spec.treeDensity ?? 0.22)) {
          this.treePlacements.push({
            x: spec.x + x + rng.spread(0.2), y: spec.y + top, z: spec.z + z + rng.spread(0.2),
            scale: rng.range(0.9, 1.6) * (spec.treeScale ?? 1), rot: rng.range(0, 6.28), variant: rng.int(0, 2),
          });
        }
      }
    }

    // Waterfalls pour from a few edge cells.
    const falls = spec.waterfalls ?? 0;
    for (let i = 0; i < falls && edgeCells.length; i++) {
      const e = edgeCells[Math.floor(rng.next() * edgeCells.length)];
      const height = spec.depth * rng.range(1.6, 2.4);
      this.addWaterfall(
        new THREE.Vector3(spec.x + e.x * 1.04, spec.y + e.top + 0.05, spec.z + e.z * 1.04),
        e.ang,
        height,
        cell * rng.range(1.4, 2.2)
      );
    }
  }

  addWaterfall(origin, angle, height, width) {
    const material = new THREE.MeshBasicMaterial({
      map: this.waterfallTexture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      color: new THREE.Color(1.4, 1.5, 1.6),
      fog: true,
    });
    material.map = material.map.clone();
    material.map.repeat.set(1, height / 6);
    material.map.needsUpdate = true;
    this.waterfallMaterials.push(material);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.copy(origin).add(new THREE.Vector3(Math.cos(angle) * 0.3, -height * 0.5, Math.sin(angle) * 0.3));
    mesh.rotation.y = -angle + Math.PI / 2;
    mesh.renderOrder = 4;
    this.group.add(mesh);
    this.mistPoints.push(new THREE.Vector3(mesh.position.x, origin.y - height, mesh.position.z));
  }

  update(dt) {
    for (const m of this.waterfallMaterials) m.map.offset.y += dt * 0.9;
  }
}
