// Neighbourhood dressing: asphalt roads with lane markings, concrete sidewalks,
// grass yards around every crib, a paved plaza, brick walls with capstones,
// and a ring of trees beyond the map edge. All instanced, so it costs only a
// handful of draw calls. Purely visual: none of this changes collision.

import * as THREE from 'three';
import { PLOT } from '../../../shared/constants.ts';
import { plotCenter } from '../../../shared/world.ts';
import { buildTown } from './town.ts';
import { cribContactShadows, groundOcclusion } from './ao.ts';

let generation = 0;

type Paint = (ctx: CanvasRenderingContext2D, s: number) => void;

function canvasTex(size: number, paint: Paint, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  paint(ctx, size);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// deterministic random so every client sees the same trees and textures
let seed = 1337;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

function speckle(ctx: CanvasRenderingContext2D, s: number, colors: string[], n: number, min: number, max: number, alpha = 0.5) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = rand() * alpha;
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    const r = min + rand() * (max - min);
    ctx.beginPath();
    ctx.arc(rand() * s, rand() * s, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const grassTex = () => canvasTex(256, (ctx, s) => {
  ctx.fillStyle = '#5e9a3e';
  ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, ['#4b8331', '#6fae4a', '#3f7428', '#86bf5a'], 260, 6, 22, 0.35); // patches
  // blades: short strokes
  for (let i = 0; i < 2600; i++) {
    const x = rand() * s, y = rand() * s;
    ctx.strokeStyle = ['#7cbc52', '#4a8a30', '#93cc62', '#3d6f27'][Math.floor(rand() * 4)];
    ctx.globalAlpha = 0.25 + rand() * 0.45;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
});

const asphaltTex = () => canvasTex(256, (ctx, s) => {
  ctx.fillStyle = '#44474f';
  ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, ['#383a41', '#53565e', '#2f3137'], 160, 8, 30, 0.25);
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = rand() < 0.5 ? '#6a6d75' : '#25272c';
    ctx.globalAlpha = rand() * 0.6;
    ctx.fillRect(rand() * s, rand() * s, 1 + rand(), 1 + rand());
  }
  // a couple of hairline cracks
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#1f2024';
  for (let i = 0; i < 3; i++) {
    let x = rand() * s, y = rand() * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (rand() - 0.5) * 30; y += (rand() - 0.5) * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
});

const concreteTex = () => canvasTex(256, (ctx, s) => {
  ctx.fillStyle = '#c4c0b6';
  ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, ['#b3afa5', '#d2cec5', '#a9a59b'], 220, 4, 18, 0.3);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#8f8b82';
  ctx.lineWidth = 2;
  for (let p = 0; p <= s; p += s / 2) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(s, p); ctx.stroke();
  }
  ctx.globalAlpha = 1;
});

const paverTex = () => canvasTex(256, (ctx, s) => {
  ctx.fillStyle = '#8c6f5a';
  ctx.fillRect(0, 0, s, s);
  const b = s / 8;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const off = (y % 2) * b * 0.5;
      const v = 0.85 + rand() * 0.3;
      ctx.fillStyle = `rgb(${Math.round(196 * v)},${Math.round(150 * v)},${Math.round(118 * v)})`;
      ctx.fillRect(x * b + off + 2, y * b + 2, b - 4, b - 4);
      if (off) ctx.fillRect(off - b + 2 + x * b, y * b + 2, b - 4, b - 4);
    }
  }
  speckle(ctx, s, ['#5c4636', '#e0c2a8'], 200, 1, 3, 0.4);
});

export const brickTexture = () => canvasTex(256, (ctx, s) => {
  ctx.fillStyle = '#d9d6d0'; // mortar
  ctx.fillRect(0, 0, s, s);
  const rows = 8, bw = s / 4, bh = s / rows;
  for (let y = 0; y < rows; y++) {
    const off = (y % 2) * bw * 0.5;
    for (let x = -1; x < 5; x++) {
      const v = 0.88 + rand() * 0.14;
      const g = Math.round(255 * v);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(x * bw + off + 2, y * bh + 2, bw - 4, bh - 4);
    }
  }
  speckle(ctx, s, ['#ffffff', '#b8b4ad'], 300, 1, 3, 0.35);
});

/** Darker capstones along the top of every wall instance (reads the wall InstancedMesh). */
export function addWallCaps(group: THREE.Group, walls: THREE.InstancedMesh) {
  const n = walls.count;
  if (!n) return;
  const cap = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.08, 0.12, 1.08),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
    n,
  );
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    walls.getMatrixAt(i, m);
    m.decompose(p, q, sc);
    tmp.position.set(p.x, p.y + sc.y / 2 + 0.05, p.z);
    tmp.updateMatrix();
    cap.setMatrixAt(i, tmp.matrix);
    if (walls.instanceColor) { walls.getColorAt(i, col); col.multiplyScalar(0.62); } else col.setHex(0x9a958c);
    cap.setColorAt(i, col);
  }
  cap.castShadow = true;
  cap.receiveShadow = true;
  group.add(cap);
}

function flatPlane(w: number, h: number, y: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, spots: Array<[number, number]>): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
  m.count = spots.length;
  const tmp = new THREE.Object3D();
  spots.forEach(([x, z], i) => { tmp.position.set(x, 0, z); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); });
  m.receiveShadow = true;
  return m;
}

/**
 * Ground layers and scenery for a world of ring radius R.
 * Plot layout (tiles from the plot centre): crib walls [-4, 4), yard [-5, 5), sidewalk [-6, 6), road outside that.
 */
export function dressWorld(group: THREE.Group, R: number, renderer: THREE.WebGLRenderer) {
  seed = 1337;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const lo = -(R * PLOT + PLOT / 2);
  const span = (2 * R + 1) * PLOT;
  const mid = lo + span / 2;
  const plots = (2 * R + 1) ** 2;
  const prep = (t: THREE.Texture, rep: number) => { t.repeat.set(rep, rep); t.anisotropy = aniso; return t; };

  // countryside grass beyond the map, a ring road around it, then asphalt over the whole map
  const outer = span + 110;
  const field = new THREE.Mesh(flatPlane(outer, outer, -0.03), new THREE.MeshStandardMaterial({ map: prep(grassTex(), outer / 5), roughness: 1 }));
  field.position.set(mid, 0, mid);
  field.receiveShadow = true;
  const road = new THREE.Mesh(flatPlane(span, span, 0), new THREE.MeshStandardMaterial({ map: prep(asphaltTex(), span / 5), roughness: 0.92 }));
  road.position.set(mid, 0, mid);
  road.receiveShadow = true;
  const ringW = span + 10;
  const ring = new THREE.Mesh(flatPlane(ringW, ringW, -0.01), new THREE.MeshStandardMaterial({ map: prep(asphaltTex(), ringW / 5), roughness: 0.92 }));
  ring.position.set(mid, 0, mid);
  ring.receiveShadow = true;
  const kerbW = span + 13;
  const kerb = new THREE.Mesh(flatPlane(kerbW, kerbW, -0.02), new THREE.MeshStandardMaterial({ map: prep(concreteTex(), kerbW / 2), roughness: 0.85 }));
  kerb.position.set(mid, 0, mid);
  kerb.receiveShadow = true;
  group.add(field, kerb, ring, road);

  const centres: Array<[number, number]> = [];
  for (let i = 0; i < plots; i++) centres.push(plotCenter(i));
  // plot centre cells are offsets in tiles; cell (x, y) covers [x, x + 1), so the plot's true centre is at +0 (crib spans [c-4, c+4))
  const yards = centres.slice(1);
  const walk = new THREE.MeshStandardMaterial({ map: prep(concreteTex(), 12 / 2), roughness: 0.85 });
  group.add(instanced(flatPlane(12, 12, 0.006), walk, centres.slice(1)));
  const lawn = new THREE.MeshStandardMaterial({ map: prep(grassTex(), 10 / 4), roughness: 1 });
  group.add(instanced(flatPlane(10, 10, 0.014), lawn, yards));
  group.add(cribContactShadows(yards));
  // the plaza is paved
  const [px, pz] = centres[0];
  const plaza = new THREE.Mesh(flatPlane(12, 12, 0.014), new THREE.MeshStandardMaterial({ map: prep(paverTex(), 3), roughness: 0.8 }));
  plaza.position.set(px, 0, pz);
  plaza.receiveShadow = true;
  group.add(plaza);

  // dashed centre lines on every road between plots
  const dashes: THREE.Matrix4[] = [];
  const tmp = new THREE.Object3D();
  for (let k = 1; k < 2 * R + 1; k++) {
    const line = lo + k * PLOT;
    for (let t = lo + 1; t < lo + span - 1; t += 2) {
      // skip intersections so lines don't cross
      const rel = ((t - lo) % PLOT + PLOT) % PLOT;
      if (rel < 1.5 || rel > PLOT - 1.5) continue;
      tmp.position.set(line, 0.01, t + 0.5); tmp.rotation.set(0, 0, 0); tmp.updateMatrix(); dashes.push(tmp.matrix.clone());
      tmp.position.set(t + 0.5, 0.01, line); tmp.rotation.set(0, Math.PI / 2, 0); tmp.updateMatrix(); dashes.push(tmp.matrix.clone());
    }
  }
  // the ring road's centre line
  const rr = span / 2 + 2.5;
  for (let t = -rr + 1; t < rr - 1; t += 2) {
    for (const [x, z, rot] of [[mid + t + 0.5, mid - rr, Math.PI / 2], [mid + t + 0.5, mid + rr, Math.PI / 2], [mid - rr, mid + t + 0.5, 0], [mid + rr, mid + t + 0.5, 0]] as Array<[number, number, number]>) {
      tmp.position.set(x, 0.002, z); tmp.rotation.set(0, rot, 0); tmp.updateMatrix(); dashes.push(tmp.matrix.clone());
    }
  }
  const dashMesh = new THREE.InstancedMesh(flatPlane(0.1, 0.9, 0), new THREE.MeshStandardMaterial({ color: 0xf2d16b, roughness: 0.6 }), Math.max(1, dashes.length));
  dashMesh.count = dashes.length;
  dashes.forEach((m, i) => dashMesh.setMatrixAt(i, m));
  dashMesh.receiveShadow = true;
  group.add(dashMesh);

  // bushes hugging the outside corners of every crib
  const bushSpots: Array<[number, number, number]> = [];
  for (const [cx, cz] of yards) {
    for (const [dx, dz] of [[-4.45, -3.2], [4.45, -3.2], [-4.45, 3.2], [4.45, 3.2]]) bushSpots.push([cx + dx, cz + dz, 0.45 + rand() * 0.2]);
  }
  // a ring of trees beyond the boundary wall
  const treeSpots: Array<[number, number, number]> = [];
  const inner = span / 2 + 30;
  for (let ring = 0; ring < 3; ring++) {
    const d = inner + ring * 3.2;
    const count = Math.floor((d * 8) / 2.6);
    for (let i = 0; i < count; i++) {
      // walk the square perimeter at distance d
      const u = (i / count) * 8 - 4; // -4..4 around 4 sides
      const side = Math.floor((u + 4) / 2), f = ((u + 4) % 2) - 1; // f in [-1, 1)
      let x = 0, z = 0;
      if (side === 0) { x = f * d; z = -d; } else if (side === 1) { x = d; z = f * d; } else if (side === 2) { x = -f * d; z = d; } else { x = -d; z = -f * d; }
      x += (rand() - 0.5) * 2; z += (rand() - 0.5) * 2;
      treeSpots.push([mid + x, mid + z, 0.85 + rand() * 0.6]);
    }
  }
  addTrees(group, treeSpots, bushSpots);
  const gen = ++generation;
  void buildTown(group, R, () => gen === generation && group.parent !== null).catch((e) => console.warn('town models failed to load', e));
}

function addTrees(group: THREE.Group, trees: Array<[number, number, number]>, bushes: Array<[number, number, number]>) {
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.4, 6);
  trunkGeo.translate(0, 0.7, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, groundOcclusion(new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95 })), Math.max(1, trees.length));
  // lumpy low-poly canopy
  const blob = (r: number, detail: number) => {
    const g = new THREE.IcosahedronGeometry(r, detail);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const k = 1 + (Math.sin(pos.getX(i) * 7.1) + Math.cos(pos.getZ(i) * 6.3) + Math.sin(pos.getY(i) * 5.7)) * 0.05;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.9, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  };
  const leaf = groundOcclusion(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), 0.35, 0.6);
  const canopy = new THREE.InstancedMesh(blob(1, 1), leaf, Math.max(1, trees.length * 2));
  const bush = new THREE.InstancedMesh(blob(1, 1), leaf, Math.max(1, bushes.length));
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  const greens = [0x4f8f35, 0x5fa040, 0x3f7a2c, 0x6aa84a, 0x55923a];
  let c = 0;
  trees.forEach(([x, z, s], i) => {
    tmp.position.set(x, 0, z); tmp.scale.set(s, s, s); tmp.rotation.set(0, rand() * 6, 0); tmp.updateMatrix();
    trunks.setMatrixAt(i, tmp.matrix);
    for (let k = 0; k < 2; k++) {
      tmp.position.set(x + (rand() - 0.5) * 0.4 * s, (1.7 + k * 0.75) * s, z + (rand() - 0.5) * 0.4 * s);
      const cs = s * (k ? 0.75 : 1.05);
      tmp.scale.set(cs, cs, cs);
      tmp.updateMatrix();
      canopy.setMatrixAt(c, tmp.matrix);
      canopy.setColorAt(c, col.setHex(greens[Math.floor(rand() * greens.length)]));
      c++;
    }
  });
  canopy.count = c;
  trunks.count = trees.length;
  bushes.forEach(([x, z, s], i) => {
    tmp.position.set(x, s * 0.55, z); tmp.scale.set(s, s * 0.85, s); tmp.rotation.set(0, rand() * 6, 0); tmp.updateMatrix();
    bush.setMatrixAt(i, tmp.matrix);
    bush.setColorAt(i, col.setHex(greens[Math.floor(rand() * greens.length)]).multiplyScalar(0.9));
  });
  bush.count = bushes.length;
  for (const m of [trunks, canopy, bush]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
}
