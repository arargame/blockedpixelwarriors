import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { PineTreeFactory } from '../world/PineTreeFactory.js';
import { createCanvas, canvasToTexture } from '../textures/CanvasUtils.js';
import { Random } from '../util/Random.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Static scenery of the tank level (all in one group, exported to MonoGame as one model):
 *
 *   far end (+z)   rail on a gravel embankment across the top, a concrete headwall below it
 *   channel        sloped concrete floor in lanes (block-sized seams), two walls, shallow water
 *                  flowing toward the camera (scrolling ripple texture)
 *   near end       a dam lip; the water pours over it into an oval drain basin (waterfall, a
 *                  water pool at the bottom) where the missed blocks pile up
 *   around         grass, pine trees and a few rocks, never on the channel
 *
 * floorHeight(z) gives the channel floor height (the slope); waterMaterials scroll in update().
 */
export class TankArena {
  constructor(materials, textures) {
    const A = GameConfig.tankArena;
    this.group = new THREE.Group();
    this.width = A.block * A.lanes;
    this.waterMaterials = [];
    const W = this.width;
    const L = A.topZ;
    const top = A.slope * L;
    const rng = new Random(77);

    // ---- Grass ground: the land lies higher than the water (groundY); one hole for the channel,
    // the two ramp cuts and the drain basin (their outline traced as a single path).
    const D = A.drain;
    const GY = A.groundY;
    this.groundY = GY;
    this.rampEnd = W / 2 + 1.2 + A.rampLength;
    const shape = new THREE.Shape();
    shape.moveTo(-160, -120);
    shape.lineTo(160, -120);
    shape.lineTo(160, 220);
    shape.lineTo(-160, 220);
    shape.lineTo(-160, -120);
    shape.holes.push(this.groundHole());
    const groundGeo = new THREE.ShapeGeometry(shape, 48);
    groundGeo.rotateX(-Math.PI / 2);
    planarUV(groundGeo, 1 / 8);
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.95 }));
    ground.position.y = GY - 0.04;
    ground.receiveShadow = true;
    this.group.add(ground);

    // ---- Channel floor (sloped, lane seams) -----------------------------------------------
    const floorGeo = new THREE.PlaneGeometry(W, L, 1, 16);
    floorGeo.rotateX(-Math.PI / 2);
    floorGeo.translate(0, 0, L / 2);
    slopeY(floorGeo, A.slope);
    planarUV(floorGeo, 1 / A.block);
    const concrete = new THREE.MeshStandardMaterial({ map: concreteTexture(true), roughness: 0.35, metalness: 0.05 });
    const floor = new THREE.Mesh(floorGeo, concrete);
    floor.receiveShadow = true;
    this.group.add(floor);

    // ---- Shallow water over it, flowing toward the dam --------------------------------------
    const ripple = rippleTexture();
    const water = new THREE.MeshStandardMaterial({
      color: 0x3f9dbc, map: ripple, transparent: true, opacity: 0.62, roughness: 0.08, metalness: 0.1,
      depthWrite: false, emissive: 0x0b3344, emissiveIntensity: 0.4,
    });
    water.map.wrapS = water.map.wrapT = THREE.RepeatWrapping;
    water.userData.scrollV = 0.35;
    this.waterMaterials.push(water);
    const waterGeo = new THREE.PlaneGeometry(W, L, 1, 16);
    waterGeo.rotateX(-Math.PI / 2);
    waterGeo.translate(0, 0.14, L / 2);
    slopeY(waterGeo, A.slope);
    planarUV(waterGeo, 1 / 6);
    const waterMesh = new THREE.Mesh(waterGeo, water);
    waterMesh.renderOrder = 3;
    this.group.add(waterMesh);

    // ---- Walls along the channel and the headwall under the rail --------------------------
    const wallMat = new THREE.MeshStandardMaterial({ map: concreteTexture(false), roughness: 0.8 });
    // Side walls, each with a gap near the bottom: the road from the base comes in on the left,
    // the way on to phase 2 leaves on the right (behind the gate).
    const G = A.gap;
    // The walls are retaining walls now: from below the floor up to just above the land, flat
    // topped (the channel is deep at the dam, shallow under the rail). They run on past the dam
    // down to the drain basin.
    const wallTop = GY + 0.35;
    for (const side of [-1, 1]) {
      for (const [z0, z1] of [[-4.2, G.z0], [G.z1, L + 1.2]]) {
        const len = z1 - z0;
        const g = new THREE.BoxGeometry(1.2, wallTop + 0.7, len);
        g.translate(side * (W / 2 + 0.6), (wallTop - 0.7) / 2, z0 + len / 2);
        planarUV(g, 1 / 3);
        const wall = new THREE.Mesh(g, wallMat);
        wall.castShadow = true;
        wall.receiveShadow = true;
        this.group.add(wall);
        const cap = new THREE.BoxGeometry(1.5, 0.25, len + 0.2);
        cap.translate(side * (W / 2 + 0.6), wallTop + 0.1, z0 + len / 2);
        planarUV(cap, 1 / 3);
        const capMesh = new THREE.Mesh(cap, concrete);
        capMesh.castShadow = true;
        this.group.add(capMesh);
      }
      this.buildRamp(side, concrete, wallMat, wallTop);
    }
    this.buildRoads(rng);
    this.buildBase(rng);
    this.buildGate();
    const head = new THREE.BoxGeometry(W + 2.4, 3.6, 1.4);
    head.translate(0, top + 1.2, L + 0.7);
    planarUV(head, 1 / 3);
    const headMesh = new THREE.Mesh(head, wallMat);
    headMesh.castShadow = true;
    headMesh.receiveShadow = true;
    this.group.add(headMesh);

    // ---- Rail across the far end (gravel bed, sleepers, two rails) --------------------------
    const railY = top + 3.0;
    this.railY = railY;
    const bed = new THREE.BoxGeometry(320, railY + 0.4, 6);
    bed.translate(0, (railY - 0.4) / 2 - 0.02, A.railZ);
    planarUV(bed, 1 / 4);
    const bedMesh = new THREE.Mesh(bed, new THREE.MeshStandardMaterial({ map: gravelTexture(), roughness: 1 }));
    bedMesh.receiveShadow = true;
    bedMesh.castShadow = true;
    this.group.add(bedMesh);
    const sleeperGeo = new THREE.BoxGeometry(0.5, 0.22, 3.2);
    const sleepers = new THREE.InstancedMesh(sleeperGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.9 }), 300);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 300; i++) {
      dummy.position.set(-150 + i * 1.0, railY + 0.08, A.railZ);
      dummy.updateMatrix();
      sleepers.setMatrixAt(i, dummy.matrix);
    }
    sleepers.receiveShadow = true;
    this.group.add(sleepers);
    for (const dz of [-0.95, 0.95]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(300, 0.2, 0.18), new THREE.MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.3, metalness: 0.85 }));
      rail.position.set(0, railY + 0.29, A.railZ + dz);
      rail.castShadow = true;
      this.group.add(rail);
    }

    // ---- Dam lip, waterfall, oval drain basin ------------------------------------------------
    const lip = new THREE.BoxGeometry(W + 2.4, 0.5, 0.8);
    lip.translate(0, -0.2, -0.2);
    planarUV(lip, 1 / 3);
    const lipMesh = new THREE.Mesh(lip, concrete);
    lipMesh.receiveShadow = true;
    this.group.add(lipMesh);
    const surfaceY = -D.depth + D.water;
    this.drainSurfaceY = surfaceY;
    this.drainFloorY = -D.depth;
    const fallMat = new THREE.MeshBasicMaterial({ map: textures.waterfall().clone(), transparent: true, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.3, 1.45, 1.55) });
    fallMat.map.wrapS = fallMat.map.wrapT = THREE.RepeatWrapping;
    fallMat.map.repeat.set(W / 4, 1);
    fallMat.map.needsUpdate = true;
    fallMat.userData.scrollV = 0.9;
    this.waterMaterials.push(fallMat);
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(W, -surfaceY + 0.2), fallMat);
    fall.position.set(0, surfaceY / 2, -0.62);
    fall.renderOrder = 4;
    this.group.add(fall);
    // Basin walls (inside of an oval cylinder), floor, rim.
    const wallGeo = new THREE.CylinderGeometry(1, 1, D.depth, 64, 1, true);
    wallGeo.scale(D.rx, 1, D.rz);
    wallGeo.translate(0, -D.depth / 2, D.z);
    cylinderUV(wallGeo, D.rx, D.rz);
    const basinWalls = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({ map: concreteTexture(false), roughness: 0.85, side: THREE.BackSide }));
    basinWalls.receiveShadow = true;
    this.group.add(basinWalls);
    const basinFloor = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: 0x4d5a5c, roughness: 0.9 }));
    basinFloor.rotation.x = -Math.PI / 2;
    basinFloor.scale.set(D.rx, D.rz, 1);
    basinFloor.position.set(0, -D.depth, D.z);
    basinFloor.receiveShadow = true;
    this.group.add(basinFloor);
    const rimShape = new THREE.Shape();
    rimShape.absellipse(0, 0, D.rx + 1.25, D.rz + 1.25, 0, Math.PI * 2, false);
    const rimHole = new THREE.Path();
    rimHole.absellipse(0, 0, D.rx, D.rz, 0, Math.PI * 2, true);
    rimShape.holes.push(rimHole);
    const rimGeo = new THREE.ExtrudeGeometry(rimShape, { depth: 0.45, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2, curveSegments: 64 });
    rimGeo.rotateX(-Math.PI / 2);
    rimGeo.translate(0, -0.25, D.z);
    planarUV(rimGeo, 1 / 3);
    const rim = new THREE.Mesh(rimGeo, concrete);
    rim.castShadow = true;
    rim.receiveShadow = true;
    this.group.add(rim);
    // The basin is sunk into the higher land: a retaining band from the rim up to the grass, all
    // round except where the channel meets it.
    this.group.add(this.basinBand(wallMat, concrete, GY));
    const pool = new THREE.MeshStandardMaterial({
      color: 0x2f7f9c, map: ripple.clone(), transparent: true, opacity: 0.72, roughness: 0.06, metalness: 0.1,
      depthWrite: false, emissive: 0x08303e, emissiveIntensity: 0.5,
    });
    pool.map.wrapS = pool.map.wrapT = THREE.RepeatWrapping;
    pool.map.repeat.set(4, 2);
    pool.map.needsUpdate = true;
    pool.userData.scrollV = 0.12;
    this.waterMaterials.push(pool);
    const poolMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 64), pool);
    poolMesh.rotation.x = -Math.PI / 2;
    poolMesh.scale.set(D.rx - 0.02, D.rz - 0.02, 1);
    poolMesh.position.set(0, surfaceY, D.z);
    poolMesh.renderOrder = 3;
    this.group.add(poolMesh);

    // ---- Trees and rocks around (never on the channel, the rail bed or the drain) ----------
    const trees = [];
    const treeOk = (x, z) => {
      if (Math.abs(x) < W / 2 + 2.6) return false;
      if (Math.abs(z - A.railZ) < 5) return false;
      if (Math.abs(x) < D.rx + 4 && z < 4 && z > D.z - D.rz - 4) return false;
      return !this.nearRoad(x, z, 2.6);
    };
    const addTree = (x, z, s0 = 1.1, s1 = 1.9) => {
      if (treeOk(x, z)) trees.push({ x, y: GY - 0.05, z, scale: rng.range(s0, s1), rot: rng.next() * 6, variant: Math.floor(rng.next() * 3) });
    };
    // Forest clumps (dense groves with clearings between them), then single trees everywhere.
    for (let c = 0; c < 46; c++) {
      const side = c % 2 ? -1 : 1;
      const cx = side * rng.range(W / 2 + 5, W / 2 + 48);
      const cz = rng.range(-28, A.railZ + 38);
      const n = 6 + Math.floor(rng.next() * 9);
      for (let k = 0; k < n; k++) {
        const a = rng.next() * Math.PI * 2;
        const d = Math.sqrt(rng.next()) * rng.range(3, 6.5);
        addTree(cx + Math.cos(a) * d, cz + Math.sin(a) * d, 1.0, 2.0);
      }
    }
    for (let i = 0; i < 700 && trees.length < 720; i++) {
      const side = rng.chance(0.5) ? -1 : 1;
      addTree(side * rng.range(W / 2 + 3, W / 2 + 50), rng.range(-30, A.railZ + 40));
    }
    for (let i = 0; i < 70; i++) {
      const x = rng.range(-62, 62);
      const z = rng.range(A.railZ + 6, A.railZ + 45);
      trees.push({ x, y: GY - 0.05, z, scale: rng.range(1.2, 2), rot: rng.next() * 6, variant: Math.floor(rng.next() * 3) });
    }
    this.trees = new PineTreeFactory(materials).createForest(trees);
    this.group.add(this.trees);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8c8f88, roughness: 0.95, flatShading: true });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    // Rocks: scattered along the walls, plus rocky outcrops (a big boulder ringed by smaller ones).
    const rockList = [];
    for (let i = 0; i < 120; i++) {
      const side = i % 2 ? -1 : 1;
      // Half of them hug the channel walls, the rest lie about the fields.
      const near = i < 60;
      const rx = side * (near ? rng.range(W / 2 + 2.2, W / 2 + 10) : rng.range(W / 2 + 8, W / 2 + 48));
      const rz = rng.range(-26, A.railZ - 6);
      if (this.nearRoad(rx, rz, 1.5) || Math.abs(rz - A.railZ) < 5) continue;
      if (Math.abs(rx) < D.rx + 3 && rz < 3 && rz > D.z - D.rz - 3) continue;
      rockList.push([rx, rz, rng.range(0.6, 1.6), rng.range(0.4, 0.95), rng.range(0.6, 1.5)]);
    }
    for (let c = 0; c < 18; c++) {
      const side = c % 2 ? -1 : 1;
      const cx = side * rng.range(W / 2 + 7, W / 2 + 44);
      const cz = rng.range(-20, A.railZ - 4);
      if (this.nearRoad(cx, cz, 4) || (Math.abs(cx) < D.rx + 5 && cz < 4 && cz > D.z - D.rz - 5)) continue;
      const big = rng.range(1.6, 2.8);
      rockList.push([cx, cz, big, big * rng.range(0.6, 0.9), big * rng.range(0.8, 1.1)]);
      for (let k = 0; k < 7; k++) {
        const a = rng.next() * Math.PI * 2;
        const d = big + rng.range(0.4, 2.4);
        rockList.push([cx + Math.cos(a) * d, cz + Math.sin(a) * d, rng.range(0.4, 1.1), rng.range(0.3, 0.8), rng.range(0.4, 1.0)]);
      }
    }
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockList.length);
    rockList.forEach(([rx, rz, sx, sy, sz], i) => {
      dummy.position.set(rx, GY + 0.1 + sy * 0.25, rz);
      dummy.rotation.set(rng.next() * 3, rng.next() * 3, 0);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    });
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    this.group.add(rocks);
  }

  // ---- Roads, base, gate ------------------------------------------------------------------

  /** Smoothed centre lines of the two dirt roads (sampled points, xz). */
  roadLines() {
    if (this.roads) return this.roads;
    const A = GameConfig.tankArena;
    const B = A.base;
    const line = (pts) => {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
      return curve.getSpacedPoints(Math.max(8, Math.round(curve.getLength() / 1.2)));
    };
    this.roads = {
      in: line([...A.roadIn, [B.x + B.r * 0.4, B.z + 0.3]]),
      out: line(A.roadOut),
    };
    return this.roads;
  }

  /** Distance from (x, z) to a sampled road line. */
  static distToLine(pts, x, z) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const px = a.x + dx * t - x;
      const pz = a.z + dz * t - z;
      best = Math.min(best, px * px + pz * pz);
    }
    return Math.sqrt(best);
  }

  /** Inside the base, on a road or a ramp (or within `margin` of them). */
  nearRoad(x, z, margin = 0) {
    const A = GameConfig.tankArena;
    const B = A.base;
    if (Math.abs(x) < (this.rampEnd ?? 0) + margin && z > A.gap.z0 - 0.6 - margin && z < A.gap.z1 + 0.6 + margin) return true;
    const R = this.roadLines();
    if (Math.hypot(x - B.x, z - B.z) < B.r + margin) return true;
    const w = A.roadWidth / 2 + margin;
    return TankArena.distToLine(R.in, x, z) < w || TankArena.distToLine(R.out, x, z) < w;
  }

  buildRoads(rng) {
    const A = GameConfig.tankArena;
    const tex = dirtTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    for (const pts of Object.values(this.roadLines())) {
      const pos = [];
      const uv = [];
      const idx = [];
      let dist = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const tx = b.x - a.x;
        const tz = b.z - a.z;
        const l = Math.hypot(tx, tz) || 1;
        const nx = -tz / l;
        const nz = tx / l;
        if (i > 0) dist += pts[i].distanceTo(pts[i - 1]);
        // Slightly wobbly edges so the road does not look ruled.
        const w0 = A.roadWidth / 2 + rng.spread(0.35);
        const w1 = A.roadWidth / 2 + rng.spread(0.35);
        const y = A.groundY + 0.012;
        pos.push(pts[i].x + nx * w0, y, pts[i].z + nz * w0, pts[i].x - nx * w1, y, pts[i].z - nz * w1);
        uv.push(0, dist / 6, 1, dist / 6);
        if (i > 0) {
          const k = i * 2;
          idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const road = new THREE.Mesh(g, mat);
      road.receiveShadow = true;
      this.group.add(road);
    }
    this.buildRoadStones(rng);
  }

  /** White stones of different sizes lined up along both edges of the roads (grass | dirt). */
  buildRoadStones(rng) {
    const A = GameConfig.tankArena;
    const B = A.base;
    const list = [];
    for (const pts of Object.values(this.roadLines())) {
      // Walk each edge at ~0.75 m steps (the centre line is sampled every ~1.2 m).
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const nx = -(b.z - a.z) / l;
        const nz = (b.x - a.x) / l;
        const steps = Math.max(1, Math.round(l / 0.75));
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          const cx = a.x + (b.x - a.x) * t;
          const cz = a.z + (b.z - a.z) * t;
          for (const side of [-1, 1]) {
            const off = A.roadWidth / 2 + 0.55 + rng.spread(0.15);
            const x = cx + nx * off * side;
            const z = cz + nz * off * side;
            if (Math.abs(x) < this.rampEnd + 0.6 || Math.hypot(x - B.x, z - B.z) < B.r + 0.4) continue;
            // Mostly mid-size stones with the odd big one and small fillers.
            const r = rng.next();
            list.push([x, z, r < 0.15 ? rng.range(0.6, 0.85) : r < 0.4 ? rng.range(0.25, 0.38) : rng.range(0.4, 0.6)]);
          }
        }
      }
    }
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xeceae4, roughness: 0.75, flatShading: true });
    const stones = new THREE.InstancedMesh(geo, mat, list.length);
    const d = new THREE.Object3D();
    list.forEach(([x, z, s], i) => {
      d.position.set(x, A.groundY + s * 0.28, z);
      d.rotation.set(rng.next() * 3, rng.next() * 3, rng.next() * 3);
      d.scale.set(s * rng.range(0.9, 1.3), s * rng.range(0.55, 0.8), s * rng.range(0.9, 1.2));
      d.updateMatrix();
      stones.setMatrixAt(i, d.matrix);
    });
    stones.castShadow = true;
    stones.receiveShadow = true;
    this.group.add(stones);
  }

  /** Outline of the ground's hole: channel (with the two ramp cuts) joined to the drain basin. */
  groundHole() {
    const A = GameConfig.tankArena;
    const D = A.drain;
    const W = (A.block * A.lanes) / 2;
    const X = W + 1.2;
    const R = this.rampEnd;
    const za = A.gap.z0 - 0.6;
    const zb = A.gap.z1 + 0.6;
    const Ztop = A.topZ + 1.4;
    const a = D.rx + 1.2;
    const b = D.rz + 1.2;
    const al = Math.acos(X / a);
    const zc = D.z + b * Math.sin(al);
    // Shape space: (x, -z).
    const pts = [[-X, Ztop], [-X, zb], [-R, zb], [-R, za], [-X, za], [-X, zc]];
    for (let k = 1; k < 48; k++) {
      const t = Math.PI - al + ((Math.PI + 2 * al) * k) / 48;
      pts.push([Math.cos(t) * a, D.z + Math.sin(t) * b]);
    }
    pts.push([X, zc], [X, za], [R, za], [R, zb], [X, zb], [X, Ztop]);
    const path = new THREE.Path();
    path.moveTo(pts[0][0], -pts[0][1]);
    for (const [x, z] of pts.slice(1)) path.lineTo(x, -z);
    path.closePath();
    return path;
  }

  /** Retaining band round the basin from its rim up to the grass (outside the channel only). */
  basinBand(wallMat, capMat, GY) {
    const A = GameConfig.tankArena;
    const D = A.drain;
    const X = (A.block * A.lanes) / 2 + 1.2;
    const a = D.rx + 1.25;
    const b = D.rz + 1.25;
    const al = Math.acos(Math.min(1, X / a));
    const pos = [];
    const uv = [];
    const idx = [];
    const n = 64;
    for (let k = 0; k <= n; k++) {
      const t = Math.PI - al + ((Math.PI + 2 * al) * k) / n;
      const x = Math.cos(t) * a;
      const z = D.z + Math.sin(t) * b;
      pos.push(x, 0.15, z, x, GY + 0.1, z);
      uv.push(k / 4, 0, k / 4, (GY - 0.05) / 3);
      if (k > 0) {
        const i = k * 2;
        idx.push(i - 2, i, i - 1, i - 1, i, i + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = wallMat.clone();
    m.side = THREE.DoubleSide;
    const band = new THREE.Mesh(g, m);
    band.receiveShadow = true;
    return band;
  }

  /**
   * Concrete ramp through the wall gap on `side`: from just under the water at the channel edge up
   * to the land (rampLength outside the wall), between two retaining walls.
   */
  buildRamp(side, concrete, wallMat, wallTop) {
    const A = GameConfig.tankArena;
    const G = A.gap;
    const W = (A.block * A.lanes) / 2;
    const nx = 14;
    const nz = 4;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= nx; i++) {
      const ax = W + ((this.rampEnd - W) * i) / nx;
      for (let j = 0; j <= nz; j++) {
        const z = G.z0 + ((G.z1 - G.z0) * j) / nz;
        pos.push(side * ax, this.rampHeight(ax, z), z);
        uv.push(ax / A.block, z / A.block);
      }
    }
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const a = i * (nz + 1) + j;
        const b = a + nz + 1;
        if (side > 0) idx.push(a, a + 1, b, b, a + 1, b + 1);
        else idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const ramp = new THREE.Mesh(g, concrete);
    ramp.receiveShadow = true;
    this.group.add(ramp);
    // Front face under the ramp's low end (hidden by the water) and the two side walls.
    for (const z of [G.z0 - 0.3, G.z1 + 0.3]) {
      const len = this.rampEnd - W + 0.2;
      const wg = new THREE.BoxGeometry(len, wallTop + 0.7, 0.6);
      wg.translate(side * (W + len / 2), (wallTop - 0.7) / 2, z);
      planarUV(wg, 1 / 3);
      const wall = new THREE.Mesh(wg, wallMat);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
      const cap = new THREE.BoxGeometry(len, 0.25, 0.9);
      cap.translate(side * (W + len / 2), wallTop + 0.1, z);
      planarUV(cap, 1 / 3);
      const capMesh = new THREE.Mesh(cap, concrete);
      capMesh.castShadow = true;
      this.group.add(capMesh);
    }
  }

  /** Ramp surface height at |x| = ax (channel edge .. rampEnd) and z. */
  rampHeight(ax, z) {
    const A = GameConfig.tankArena;
    const W = (A.block * A.lanes) / 2;
    const t = THREE.MathUtils.clamp((ax - W) / (this.rampEnd - W), 0, 1);
    const e = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
    return THREE.MathUtils.lerp(this.floorHeight(z) + 0.16, A.groundY, e);
  }

  /** Round base at the bottom left: packed earth pad, sandbag ring open toward the road, a flag. */
  buildBase(rng) {
    const A = GameConfig.tankArena;
    const B = A.base;
    const pad = new THREE.Mesh(new THREE.CircleGeometry(B.r, 48), new THREE.MeshStandardMaterial({ map: dirtTexture(true), roughness: 0.95 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(B.x, A.groundY + 0.02, B.z);
    pad.receiveShadow = true;
    this.group.add(pad);
    // Sandbags: two staggered courses round the edge, open toward the road.
    const toRoad = Math.atan2(A.roadIn[A.roadIn.length - 1][1] - B.z, A.roadIn[A.roadIn.length - 1][0] - B.x);
    const bagGeo = new RoundedBoxGeometry(1.0, 0.42, 0.62, 2, 0.16);
    const bagMat = new THREE.MeshStandardMaterial({ map: sackTexture(), roughness: 0.95 });
    const placements = [];
    const ring = B.r - 0.45;
    const count = Math.round((2 * Math.PI * ring) / 1.02);
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < count; i++) {
        const a = ((i + layer * 0.5) / count) * Math.PI * 2;
        const d = Math.abs(((a - toRoad + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d < 0.62) continue;
        placements.push({ a, layer });
      }
    }
    const bags = new THREE.InstancedMesh(bagGeo, bagMat, placements.length);
    const dummy = new THREE.Object3D();
    placements.forEach(({ a, layer }, i) => {
      dummy.position.set(B.x + Math.cos(a) * ring, A.groundY + 0.22 + layer * 0.4, B.z + Math.sin(a) * ring);
      dummy.rotation.set(0, -a + Math.PI / 2 + rng.spread(0.06), rng.spread(0.04));
      dummy.scale.set(1, 1 - layer * 0.08, 1);
      dummy.updateMatrix();
      bags.setMatrixAt(i, dummy.matrix);
    });
    bags.castShadow = true;
    bags.receiveShadow = true;
    this.group.add(bags);
    // Flag pole with a red star flag, a couple of ammo crates and fuel drums.
    const fx = B.x - B.r * 0.55;
    const fz = B.z + B.r * 0.55;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 7.5, 10), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.7, roughness: 0.35 }));
    pole.position.set(fx, A.groundY + 3.75, fz);
    pole.castShadow = true;
    this.group.add(pole);
    const flagGeo = new THREE.PlaneGeometry(2.6, 1.6, 8, 1);
    const fp = flagGeo.attributes.position;
    for (let i = 0; i < fp.count; i++) fp.setZ(i, Math.sin((fp.getX(i) + 1.3) * 2.2) * 0.18 * ((fp.getX(i) + 1.3) / 2.6));
    flagGeo.translate(1.3, 0, 0);
    flagGeo.computeVertexNormals();
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.85 }));
    flag.position.set(fx + 0.1, A.groundY + 6.6, fz);
    flag.rotation.y = -0.4;
    flag.castShadow = true;
    this.group.add(flag);
    const crateMat = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.85 });
    const crateGeo = new THREE.BoxGeometry(1.3, 0.9, 0.9);
    for (const [dx, dz, dy, ry] of [[-6.2, -4.6, 0, 0.3], [-5.0, -5.4, 0, -0.2], [-5.6, -5.0, 0.9, 0.05], [5.4, -6.2, 0, 1.2]]) {
      const c = new THREE.Mesh(crateGeo, crateMat);
      c.position.set(B.x + dx, A.groundY + 0.47 + dy, B.z + dz);
      c.rotation.y = ry;
      c.castShadow = true;
      c.receiveShadow = true;
      this.group.add(c);
    }
    const drumMat = new THREE.MeshStandardMaterial({ color: 0x7a2a1e, roughness: 0.6, metalness: 0.3 });
    const drumGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 16);
    for (const [dx, dz] of [[-2.0, 7.2], [-1.1, 7.6], [-1.6, 6.5]]) {
      const d = new THREE.Mesh(drumGeo, drumMat);
      d.position.set(B.x + dx, A.groundY + 0.54, B.z + dz);
      d.castShadow = true;
      this.group.add(d);
    }
  }

  /**
   * Wooden fence gate across the right-hand gap: two leaves hinged on stout posts at the ends of
   * the gap, swinging out (+x) when phase 1 is won. Each leaf is its own pivot group (exported to
   * MonoGame as tank_gate_leaf + hinge list).
   */
  buildGate() {
    const A = GameConfig.tankArena;
    const G = A.gap;
    const W = A.block * A.lanes;
    // The gate is on the side away from the base.
    this.gateSide = -Math.sign(A.base.x);
    // At the top of the far ramp, where the road starts.
    const x = this.gateSide * (this.rampEnd + 0.3);
    const wood = new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.85 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.9 });
    const span = (G.z1 - G.z0) / 2;
    this.gateLeaves = [];
    this.gateOpen = false;
    this.gateT = 0;
    for (const [hz, dir] of [[G.z0, 1], [G.z1, -1]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.2, 0.5), postMat);
      post.position.set(x, A.groundY + 1.4, hz - dir * 0.15);
      post.receiveShadow = true;
      post.castShadow = true;
      this.group.add(post);
      const pivot = new THREE.Group();
      pivot.position.set(x, A.groundY, hz);
      pivot.userData = { hinge: [x, A.groundY, hz], dir };
      const leaf = new THREE.Group();
      const L = span - 0.12;
      // Frame: two posts, three rails, a diagonal brace; vertical planks between the rails.
      const parts = [
        [0.16, 2.3, 0.16, 0, 1.25, dir * 0.08],
        [0.16, 2.3, 0.16, 0, 1.25, dir * (L - 0.08)],
        [0.12, 0.2, L, 0, 0.35, dir * L / 2],
        [0.12, 0.2, L, 0, 1.25, dir * L / 2],
        [0.12, 0.2, L, 0, 2.15, dir * L / 2],
      ];
      for (const [sx, sy, sz, px, py, pz] of parts) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wood);
        m.position.set(px, py, pz);
        m.castShadow = true;
        leaf.add(m);
      }
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, Math.hypot(L, 1.8)), wood);
      brace.position.set(0.04, 1.25, dir * L / 2);
      brace.rotation.x = dir * Math.atan2(1.8, L);
      leaf.add(brace);
      const n = Math.floor(L / 0.32);
      for (let i = 0; i < n; i++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9 + (i % 2) * 0.12, 0.26), wood);
        plank.position.set(-this.gateSide * 0.06, 1.27, dir * (0.25 + i * (L - 0.4) / Math.max(1, n - 1)));
        plank.castShadow = true;
        leaf.add(plank);
      }
      pivot.add(leaf);
      pivot.userData.leaf = leaf;
      this.group.add(pivot);
      this.gateLeaves.push(pivot);
    }
  }

  /** Gate swing (0 closed .. 1 open). */
  setGateOpen(open) {
    this.gateOpen = open;
  }

  /** Ground height anywhere: the sloped channel floor inside, the ramps, the land outside. */
  floorAt(x, z) {
    const A = GameConfig.tankArena;
    const W = (A.block * A.lanes) / 2;
    const ax = Math.abs(x);
    if (ax <= W && z >= 0 && z <= A.topZ) return this.floorHeight(z);
    if (ax > W && ax <= this.rampEnd && z >= A.gap.z0 && z <= A.gap.z1) return this.rampHeight(ax, z);
    if (ax <= W + 1.3 && z > -6 && z <= A.topZ + 1.4) return this.floorHeight(z);
    return A.groundY;
  }

  isWater(x, z) {
    const A = GameConfig.tankArena;
    return Math.abs(x) <= (A.block * A.lanes) / 2 && z >= 0 && z <= A.topZ;
  }

  /**
   * Can the tank stand here (a footprint point)? The channel inside, the two ramps (past the gate
   * at the top of the far one only once it is open), the roads and the base.
   */
  walkable(x, z) {
    const A = GameConfig.tankArena;
    const W = (A.block * A.lanes) / 2;
    const G = A.gap;
    const ax = Math.abs(x);
    const inGap = z > G.z0 + 0.15 && z < G.z1 - 0.15;
    if (ax <= W && z >= 0.3 && z <= A.topZ - A.block * 2.6) return true;
    const open = this.gateT > 0.85;
    const entry = Math.sign(A.base.x);
    if (ax > W && ax <= this.rampEnd + 0.1 && inGap) return true;
    if (ax > W && ax <= this.rampEnd + 0.8 && inGap) return Math.sign(x) === entry || open;
    if (ax <= this.rampEnd + 0.8 && z > G.z0 - 0.9 && z < G.z1 + 0.9) return false;   // ramp walls / gate posts
    if (ax <= W + 1.3) return false;      // the walls
    const B = A.base;
    if (Math.hypot(x - B.x, z - B.z) < B.r - 0.8) return true;
    const R = this.roadLines();
    if (Math.sign(x) === entry && TankArena.distToLine(R.in, x, z) < A.roadWidth / 2) return true;
    if (Math.sign(x) !== entry && TankArena.distToLine(R.out, x, z) < A.roadWidth / 2) return open;
    return false;
  }

  /** A shell hitting a channel wall (inside the wall boxes, below the cap). */
  wallAt(p) {
    const A = GameConfig.tankArena;
    const W = (A.block * A.lanes) / 2;
    const ax = Math.abs(p.x);
    if (ax < W || ax > W + 1.35 || p.z < -4.2 || p.z > A.topZ + 1.2) return false;
    if (p.y > A.groundY + 0.45) return false;
    return !(p.z > A.gap.z0 && p.z < A.gap.z1);
  }

  /** Channel floor height at z (0 at the dam lip, rising toward the rail). */
  floorHeight(z) {
    const A = GameConfig.tankArena;
    return A.slope * THREE.MathUtils.clamp(z, 0, A.topZ);
  }

  update(dt) {
    for (const m of this.waterMaterials) m.map.offset.y += dt * m.userData.scrollV;
    // Gate leaves swing out (eased) when it opens.
    this.gateT = THREE.MathUtils.clamp(this.gateT + (this.gateOpen ? dt / 1.6 : -dt / 0.8), 0, 1);
    const e = this.gateT * this.gateT * (3 - 2 * this.gateT);
    // Both leaves swing outward (away from the channel).
    for (const p of this.gateLeaves) p.rotation.y = this.gateSide * p.userData.dir * e * 1.75;
  }
}

function slopeY(geo, slope) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + slope * Math.max(0, p.getZ(i)));
  geo.computeVertexNormals();
}

/** Box-projected world UVs (scale = repeats per unit). */
function planarUV(geo, scale) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u;
    let v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = -p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function cylinderUV(geo, rx, rz) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const perim = Math.PI * (3 * (rx + rz) - Math.sqrt((3 * rx + rz) * (rx + 3 * rz)));
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    uv[i * 2] = ((a / (Math.PI * 2)) * perim) / 3;
    uv[i * 2 + 1] = p.getY(i) / 3;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Light concrete; `seams` draws the block-sized lane joints of the channel floor. */
function concreteTexture(seams) {
  const S = 256;
  const c = createCanvas(S, S);
  const g = c.getContext('2d');
  const rng = new Random(seams ? 5 : 9);
  g.fillStyle = seams ? '#b9b6ad' : '#a9a69d';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 1800; i++) {
    const v = rng.range(-22, 22);
    g.fillStyle = `rgba(${150 + v},${148 + v},${140 + v},${rng.range(0.15, 0.45)})`;
    const s = rng.range(1, 4);
    g.fillRect(rng.range(0, S), rng.range(0, S), s, s);
  }
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(80,86,80,${rng.range(0.05, 0.12)})`;
    g.beginPath();
    g.ellipse(rng.range(0, S), rng.range(0, S), rng.range(10, 40), rng.range(6, 20), rng.next() * 3, 0, Math.PI * 2);
    g.fill();
  }
  if (seams) {
    g.strokeStyle = 'rgba(70,72,68,0.7)';
    g.lineWidth = 4;
    g.strokeRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 2;
    g.strokeRect(4, 4, S - 8, S - 8);
  }
  return canvasToTexture(c, { srgb: true, repeat: true });
}

/** Flowing water ripples: soft caustic bands and highlights (tiles seamlessly). */
function rippleTexture() {
  const S = 256;
  const c = createCanvas(S, S);
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * Math.PI * 2;
      const v = (y / S) * Math.PI * 2;
      let w = Math.sin(u * 3 + Math.sin(v * 2) * 1.5) * 0.5 + Math.sin(v * 5 + Math.sin(u * 2) * 2) * 0.35 + Math.sin((u + v) * 4) * 0.15;
      w = Math.pow(Math.max(0, w * 0.5 + 0.5), 3);
      const k = (y * S + x) * 4;
      img.data[k] = 175 + 80 * w;
      img.data[k + 1] = 205 + 50 * w;
      img.data[k + 2] = 215 + 40 * w;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvasToTexture(c, { srgb: true, repeat: true });
}

function grassTexture() {
  const S = 256;
  const c = createCanvas(S, S);
  const g = c.getContext('2d');
  const rng = new Random(13);
  g.fillStyle = '#5f8f3c';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const v = rng.range(-26, 26);
    g.fillStyle = `rgba(${92 + v},${140 + v},${58 + v * 0.5},${rng.range(0.3, 0.8)})`;
    g.fillRect(rng.range(0, S), rng.range(0, S), rng.range(1, 3), rng.range(2, 6));
  }
  return canvasToTexture(c, { srgb: true, repeat: true });
}

function gravelTexture() {
  const S = 128;
  const c = createCanvas(S, S);
  const g = c.getContext('2d');
  const rng = new Random(21);
  g.fillStyle = '#7d7468';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const v = rng.range(-30, 30);
    g.fillStyle = `rgb(${120 + v},${112 + v},${100 + v})`;
    g.beginPath();
    g.arc(rng.range(0, S), rng.range(0, S), rng.range(0.8, 2.4), 0, Math.PI * 2);
    g.fill();
  }
  return canvasToTexture(c, { srgb: true, repeat: true });
}

/** Packed dirt road with tyre ruts; `pad` = the base's round pad (no ruts, more gravel). */
function dirtTexture(pad = false) {
  const S = 256;
  const c = createCanvas(S, S);
  const g = c.getContext('2d');
  const rng = new Random(pad ? 41 : 31);
  g.fillStyle = pad ? '#8a7656' : '#86704f';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const v = rng.range(-24, 24);
    g.fillStyle = `rgba(${130 + v},${110 + v},${80 + v * 0.8},${rng.range(0.25, 0.7)})`;
    const s = rng.range(1, pad ? 4 : 3);
    g.fillRect(rng.range(0, S), rng.range(0, S), s, s);
  }
  if (!pad) {
    // Ruts along the road (v runs along it), grass creeping in at both edges (u = 0 / 1).
    for (const u of [0.3, 0.7]) {
      const grad = g.createLinearGradient((u - 0.08) * S, 0, (u + 0.08) * S, 0);
      grad.addColorStop(0, 'rgba(60,46,30,0)');
      grad.addColorStop(0.5, 'rgba(60,46,30,0.4)');
      grad.addColorStop(1, 'rgba(60,46,30,0)');
      g.fillStyle = grad;
      g.fillRect((u - 0.08) * S, 0, 0.16 * S, S);
    }
    // Darker, rougher shoulders.
    for (const [x0, x1] of [[0, 0.07], [0.93, 1]]) {
      g.fillStyle = 'rgba(92,72,46,0.45)';
      g.fillRect(x0 * S, 0, (x1 - x0) * S, S);
    }
  }
  return canvasToTexture(c, { srgb: true, repeat: true });
}

function sackTexture() {
  const S = 64;
  const c = createCanvas(S, S);
  const g = c.getContext('2d');
  const rng = new Random(17);
  g.fillStyle = '#b9a47a';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 400; i++) {
    const v = rng.range(-20, 20);
    g.fillStyle = `rgba(${170 + v},${150 + v},${110 + v},0.6)`;
    g.fillRect(rng.range(0, S), rng.range(0, S), 2, 1);
  }
  g.strokeStyle = 'rgba(90,72,48,0.6)';
  for (let y = 4; y < S; y += 6) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(S, y + 1);
    g.stroke();
  }
  return canvasToTexture(c, { srgb: true, repeat: true });
}

function flagTexture() {
  const W = 128;
  const H = 80;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#b02a22';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#f2e6c8';
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 === 0 ? 24 : 10;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    g.lineTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  return canvasToTexture(c, { srgb: true });
}

function crateTexture() {
  const S = 64;
  const c = createCanvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#5d6234';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#3a3d20';
  g.lineWidth = 4;
  g.strokeRect(2, 2, S - 4, S - 4);
  g.fillStyle = '#e8d78a';
  g.fillRect(14, 26, 36, 10);
  return canvasToTexture(c, { srgb: true });
}

function plankTexture() {
  const S = 128;
  const c = createCanvas(S, S);
  const g = c.getContext('2d');
  const rng = new Random(23);
  g.fillStyle = '#8a6440';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const v = rng.range(-26, 26);
    g.strokeStyle = `rgba(${110 + v},${78 + v},${48 + v},0.55)`;
    g.lineWidth = rng.range(0.5, 2);
    const x = rng.range(0, S);
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + rng.spread(6), S);
    g.stroke();
  }
  return canvasToTexture(c, { srgb: true, repeat: true });
}
