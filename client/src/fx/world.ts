// Neighbourhood dressing: asphalt roads with lane markings, concrete sidewalks,
// grass yards around every crib, a paved plaza, brick walls with capstones,
// and a ring of trees beyond the map edge. All instanced, so it costs only a
// handful of draw calls. Purely visual: none of this changes collision.

import { PLOT } from '../../../shared/constants.ts';
import { plotCenter } from '../../../shared/world.ts';
import { buildTown } from './town.ts';
import { cribContactShadows } from './ao.ts';
import {
  box, canvasTexture, cyl, groundOcclusion, groundPlane, ico, instances, receiveShadows, castShadows, std, type Inst, type Mesh, type Node,
} from '../bjs/kit.ts';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';

let generation = 0;

type Paint = (ctx: CanvasRenderingContext2D, s: number) => void;
const tex = (size: number, paint: Paint) => canvasTexture(size, size, (ctx) => paint(ctx, size), true);

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

const grassTex = () => tex(256, (ctx, s) => {
  ctx.fillStyle = '#5e9a3e';
  ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, ['#4b8331', '#6fae4a', '#3f7428', '#86bf5a'], 260, 6, 22, 0.35); // patches
  for (let i = 0; i < 2600; i++) { // blades: short strokes
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

const asphaltTex = () => tex(256, (ctx, s) => {
  ctx.fillStyle = '#44474f';
  ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, ['#383a41', '#53565e', '#2f3137'], 160, 8, 30, 0.25);
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = rand() < 0.5 ? '#6a6d75' : '#25272c';
    ctx.globalAlpha = rand() * 0.6;
    ctx.fillRect(rand() * s, rand() * s, 1 + rand(), 1 + rand());
  }
  ctx.globalAlpha = 0.35; // a couple of hairline cracks
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

const concreteTex = () => tex(256, (ctx, s) => {
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

const paverTex = () => tex(256, (ctx, s) => {
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

export const brickTexture = () => tex(256, (ctx, s) => {
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

const rep = (t: DynamicTexture, n: number) => { t.uScale = n; t.vScale = n; t.anisotropicFilteringLevel = 8; return t; };

/** Darker capstones along the top of every wall (one entry per wall instance). */
export function addWallCaps(parent: Node, walls: Inst[]) {
  if (!walls.length) return;
  const cap = box(1.08, 0.12, 1.08, std(0xffffff, { roughness: 0.7 }));
  cap.parent = parent;
  instances(cap, walls.map((w) => {
    const h = Array.isArray(w.s) ? w.s[1] : 1;
    return { x: w.x, z: w.z, y: (w.y ?? 0) + h / 2 + 0.05, color: w.color !== undefined ? mulHex(w.color, 0.62) : 0x9a958c };
  }), { colors: true });
  castShadows(cap);
  cap.receiveShadows = true;
}
const mulHex = (hex: number, k: number) => ((Math.round(((hex >> 16) & 255) * k) << 16) | (Math.round(((hex >> 8) & 255) * k) << 8) | Math.round((hex & 255) * k));

function flat(w: number, h: number, mat: Parameters<typeof groundPlane>[2], y: number, parent: Node, x = 0, z = 0): Mesh {
  const m = groundPlane(w, h, mat, y);
  m.position.x = x;
  m.position.z = z;
  m.parent = parent;
  m.receiveShadows = true;
  return m;
}

/**
 * Ground layers and scenery for a world of ring radius R.
 * Plot layout (tiles from the plot centre): crib walls [-4, 4), yard [-5, 5), sidewalk [-6, 6), road outside that.
 */
export function dressWorld(parent: Node, R: number) {
  seed = 1337;
  const lo = -(R * PLOT + PLOT / 2);
  const span = (2 * R + 1) * PLOT;
  const mid = lo + span / 2;
  const plots = (2 * R + 1) ** 2;

  // countryside grass beyond the map, a ring road around it, then asphalt over the whole map
  const outer = span + 110;
  flat(outer, outer, std(0xffffff, { roughness: 1, map: rep(grassTex(), outer / 5) }), -0.03, parent, mid, mid);
  const kerbW = span + 13;
  flat(kerbW, kerbW, std(0xffffff, { roughness: 0.85, map: rep(concreteTex(), kerbW / 2) }), -0.02, parent, mid, mid);
  const ringW = span + 10;
  flat(ringW, ringW, std(0xffffff, { roughness: 0.92, map: rep(asphaltTex(), ringW / 5) }), -0.01, parent, mid, mid);
  flat(span, span, std(0xffffff, { roughness: 0.92, map: rep(asphaltTex(), span / 5) }), 0, parent, mid, mid);

  const centres: Array<[number, number]> = [];
  for (let i = 0; i < plots; i++) centres.push(plotCenter(i));
  const yards = centres.slice(1);
  const at = (list: Array<[number, number]>) => list.map(([x, z]) => ({ x, z }));
  instances(flat(12, 12, std(0xffffff, { roughness: 0.85, map: rep(concreteTex(), 6) }), 0.006, parent), at(yards));
  instances(flat(10, 10, std(0xffffff, { roughness: 1, map: rep(grassTex(), 10 / 4) }), 0.014, parent), at(yards));
  cribContactShadows(yards).parent = parent;
  // the plaza is paved
  const [px, pz] = centres[0];
  flat(12, 12, std(0xffffff, { roughness: 0.8, map: rep(paverTex(), 3) }), 0.014, parent, px, pz);

  // dashed centre lines on every road between plots
  const dashes: Inst[] = [];
  for (let k = 1; k < 2 * R + 1; k++) {
    const ln = lo + k * PLOT;
    for (let t = lo + 1; t < lo + span - 1; t += 2) {
      const rel = ((t - lo) % PLOT + PLOT) % PLOT; // skip intersections so lines don't cross
      if (rel < 1.5 || rel > PLOT - 1.5) continue;
      dashes.push({ x: ln, y: 0.01, z: t + 0.5 }, { x: t + 0.5, y: 0.01, z: ln, ry: Math.PI / 2 });
    }
  }
  const rr = span / 2 + 2.5; // the ring road's centre line
  for (let t = -rr + 1; t < rr - 1; t += 2) {
    dashes.push(
      { x: mid + t + 0.5, y: 0.002, z: mid - rr, ry: Math.PI / 2 }, { x: mid + t + 0.5, y: 0.002, z: mid + rr, ry: Math.PI / 2 },
      { x: mid - rr, y: 0.002, z: mid + t + 0.5 }, { x: mid + rr, y: 0.002, z: mid + t + 0.5 });
  }
  instances(flat(0.1, 0.9, std(0xf2d16b, { roughness: 0.6 }), 0, parent), dashes);

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
      const u = (i / count) * 8 - 4; // walk the square perimeter at distance d
      const side = Math.floor((u + 4) / 2), f = ((u + 4) % 2) - 1;
      let x = 0, z = 0;
      if (side === 0) { x = f * d; z = -d; } else if (side === 1) { x = d; z = f * d; } else if (side === 2) { x = -f * d; z = d; } else { x = -d; z = -f * d; }
      x += (rand() - 0.5) * 2; z += (rand() - 0.5) * 2;
      treeSpots.push([mid + x, mid + z, 0.85 + rand() * 0.6]);
    }
  }
  addTrees(parent, treeSpots, bushSpots);
  const gen = ++generation;
  void buildTown(parent, R, () => gen === generation && !parent.isDisposed()).catch((e) => console.warn('town models failed to load', e));
}

/** A lumpy low-poly blob for canopies and bushes. */
function blob(): Mesh {
  const m = ico(1, 2, null, true);
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const k = 1 + (Math.sin(x * 7.1) + Math.cos(z * 6.3) + Math.sin(y * 5.7)) * 0.05;
    pos[i] = x * k; pos[i + 1] = y * k * 0.9; pos[i + 2] = z * k;
  }
  const idx = m.getIndices()!;
  const nrm: number[] = [];
  VertexData.ComputeNormals(pos, idx, nrm);
  m.setVerticesData(VertexBuffer.PositionKind, pos);
  m.setVerticesData(VertexBuffer.NormalKind, nrm);
  return m;
}

function addTrees(parent: Node, trees: Array<[number, number, number]>, bushes: Array<[number, number, number]>) {
  const trunk = cyl(0.12, 0.18, 1.4, groundOcclusion(std(0x6b4a2f, { roughness: 0.95 })), { seg: 6 });
  trunk.position.y = 0.7;
  trunk.bakeCurrentTransformIntoVertices();
  const leaf = groundOcclusion(std(0xffffff, { roughness: 0.85 }), 0.35, 0.6);
  const canopy = blob();
  canopy.material = leaf;
  const bush = blob();
  bush.material = leaf;
  const greens = [0x4f8f35, 0x5fa040, 0x3f7a2c, 0x6aa84a, 0x55923a];
  const trunkList: Inst[] = [], canopyList: Inst[] = [], bushList: Inst[] = [];
  for (const [x, z, s] of trees) {
    trunkList.push({ x, z, s, ry: rand() * 6 });
    for (let k = 0; k < 2; k++) {
      const cs = s * (k ? 0.75 : 1.05);
      canopyList.push({ x: x + (rand() - 0.5) * 0.4 * s, y: (1.7 + k * 0.75) * s, z: z + (rand() - 0.5) * 0.4 * s, s: cs, color: greens[Math.floor(rand() * greens.length)] });
    }
  }
  for (const [x, z, s] of bushes) bushList.push({ x, y: s * 0.55, z, s: [s, s * 0.85, s], ry: rand() * 6, color: mulHex(greens[Math.floor(rand() * greens.length)], 0.9) });
  instances(trunk, trunkList);
  instances(canopy, canopyList, { colors: true });
  instances(bush, bushList, { colors: true });
  for (const m of [trunk, canopy, bush]) { m.parent = parent; castShadows(m); }
  receiveShadows(parent);
}
