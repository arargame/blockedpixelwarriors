import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { PineTreeFactory } from '../world/PineTreeFactory.js';
import { createCanvas, canvasToTexture } from '../textures/CanvasUtils.js';
import { Random } from '../util/Random.js';

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

    // ---- Grass ground with an oval hole for the drain -----------------------------------
    const D = A.drain;
    const shape = new THREE.Shape();
    shape.moveTo(-160, -120);
    shape.lineTo(160, -120);
    shape.lineTo(160, 220);
    shape.lineTo(-160, 220);
    shape.lineTo(-160, -120);
    const hole = new THREE.Path();
    hole.absellipse(0, -D.z, D.rx + 1.2, D.rz + 1.2, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const groundGeo = new THREE.ShapeGeometry(shape, 48);
    groundGeo.rotateX(-Math.PI / 2);
    planarUV(groundGeo, 1 / 8);
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.95 }));
    ground.position.y = -0.04;
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
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(1.2, 3.2, L + 1.2);
      g.translate(side * (W / 2 + 0.6), 0.9, L / 2 + 0.6);
      slopeY(g, A.slope);
      planarUV(g, 1 / 3);
      const wall = new THREE.Mesh(g, wallMat);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
      const cap = new THREE.BoxGeometry(1.5, 0.25, L + 1.4);
      cap.translate(side * (W / 2 + 0.6), 2.6, L / 2 + 0.6);
      slopeY(cap, A.slope);
      planarUV(cap, 1 / 3);
      const capMesh = new THREE.Mesh(cap, concrete);
      capMesh.castShadow = true;
      this.group.add(capMesh);
    }
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
    for (let i = 0; i < 260 && trees.length < 150; i++) {
      const side = rng.chance(0.5) ? -1 : 1;
      const x = side * rng.range(W / 2 + 4, W / 2 + 46);
      const z = rng.range(-30, A.railZ + 40);
      if (Math.abs(z - A.railZ) < 5) continue;
      if (Math.abs(x) < D.rx + 4 && z < 4 && z > D.z - D.rz - 4) continue;
      trees.push({ x, y: -0.05, z, scale: rng.range(1.1, 1.9), rot: rng.next() * 6, variant: Math.floor(rng.next() * 3) });
    }
    for (let i = 0; i < 40; i++) {
      const x = rng.range(-50, 50);
      const z = rng.range(A.railZ + 6, A.railZ + 45);
      trees.push({ x, y: -0.05, z, scale: rng.range(1.2, 2), rot: rng.next() * 6, variant: Math.floor(rng.next() * 3) });
    }
    this.trees = new PineTreeFactory(materials).createForest(trees);
    this.group.add(this.trees);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8c8f88, roughness: 0.95, flatShading: true });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 24);
    for (let i = 0; i < 24; i++) {
      const side = i % 2 ? -1 : 1;
      dummy.position.set(side * rng.range(W / 2 + 2.2, W / 2 + 9), 0.2, rng.range(-8, A.railZ - 6));
      dummy.rotation.set(rng.next() * 3, rng.next() * 3, 0);
      dummy.scale.set(rng.range(0.6, 1.5), rng.range(0.4, 0.9), rng.range(0.6, 1.4));
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    this.group.add(rocks);
  }

  /** Channel floor height at z (0 at the dam lip, rising toward the rail). */
  floorHeight(z) {
    const A = GameConfig.tankArena;
    return A.slope * THREE.MathUtils.clamp(z, 0, A.topZ);
  }

  update(dt) {
    for (const m of this.waterMaterials) m.map.offset.y += dt * m.userData.scrollV;
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
