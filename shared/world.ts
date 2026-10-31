// World geometry. The map is a growing grid of plots laid out in a square spiral
// around a central plaza. Every plot except the plaza holds a crib: an 8x8 walled
// house with a front door (south) and a back door (north), each 2 tiles wide.
// Cells are integer tiles; cell (x, y) covers [x, x + 1) x [y, y + 1).

import { CRIB_HALF, PLOT, RADIUS } from './constants.ts';

export type DoorSide = 0 | 1; // 0 = front (south), 1 = back (north)
export const DOOR_NAMES = ['front door', 'back door'] as const;

export interface DoorState {
  hp: number; // 0 = broken (always passable until repaired)
  open: boolean;
}

export interface CribView {
  i: number; // plot index in the spiral
  owner: string | null; // player id
  ownerName?: string;
  doors: [DoorState, DoorState];
  max: number; // door max HP (armor level)
}

const spiralCache: Array<[number, number]> = [[0, 0]];

/** Plot coordinates of the n-th plot in the square spiral (0 = plaza). */
export function spiral(n: number): [number, number] {
  while (spiralCache.length <= n) {
    const k = spiralCache.length;
    // ring r holds 8r plots; walk them clockwise starting at (r, -r + 1)
    let r = 1;
    let start = 1;
    while (start + 8 * r <= k) {
      start += 8 * r;
      r++;
    }
    const s = k - start;
    const side = Math.floor(s / (2 * r));
    const o = s % (2 * r);
    let x: number;
    let y: number;
    if (side === 0) { x = r; y = -r + 1 + o; }
    else if (side === 1) { x = r - 1 - o; y = r; }
    else if (side === 2) { x = -r; y = r - 1 - o; }
    else { x = -r + 1 + o; y = -r; }
    spiralCache.push([x, y]);
  }
  return spiralCache[n];
}

const indexByKey = new Map<string, number>();
export function plotIndex(px: number, py: number): number {
  const key = `${px},${py}`;
  const hit = indexByKey.get(key);
  if (hit !== undefined) return hit;
  const r = Math.max(Math.abs(px), Math.abs(py));
  const last = (2 * r + 1) ** 2 - 1;
  for (let n = 0; n <= last; n++) {
    const [x, y] = spiral(n);
    indexByKey.set(`${x},${y}`, n);
  }
  return indexByKey.get(key)!;
}

/** Ring radius needed to hold `count` plots (including the plaza). */
export function ringFor(count: number): number {
  let r = 1;
  while ((2 * r + 1) ** 2 < count) r++;
  return r;
}

export function plotCenter(i: number): [number, number] {
  const [px, py] = spiral(i);
  return [px * PLOT, py * PLOT];
}

/** Center of a crib's interior, in world units. */
export function cribSpawn(i: number): [number, number] {
  const [cx, cy] = plotCenter(i);
  return [cx, cy];
}

/** World-space center of a door. */
export function doorCenter(i: number, side: DoorSide): [number, number] {
  const [cx, cy] = plotCenter(i);
  const y = side === 0 ? cy + CRIB_HALF - 1 + 0.5 : cy - CRIB_HALF + 0.5;
  return [cx, y];
}

export function doorCells(i: number, side: DoorSide): Array<[number, number]> {
  const [cx, cy] = plotCenter(i);
  const y = side === 0 ? cy + CRIB_HALF - 1 : cy - CRIB_HALF;
  return [[cx - 1, y], [cx, y]];
}

export type CellKind = 'floor' | 'street' | 'wall' | 'door' | 'pillar' | 'bound' | 'fence' | 'lamp';

export interface CellInfo {
  kind: CellKind;
  plot: number;
  side?: DoorSide;
}

/** Static shape of a cell for a world of ring radius R. Doors report kind 'door'. */
export function cellAt(x: number, y: number, R: number): CellInfo {
  const lo = -(R * PLOT + PLOT / 2);
  const hi = R * PLOT + PLOT / 2 - 1;
  if (x <= lo || y <= lo || x >= hi || y >= hi) return { kind: 'bound', plot: -1 };
  const px = Math.floor((x + PLOT / 2) / PLOT);
  const py = Math.floor((y + PLOT / 2) / PLOT);
  const plot = plotIndex(px, py);
  const cx = px * PLOT;
  const cy = py * PLOT;
  const lx = x - cx;
  const ly = y - cy;
  if (lx === -6 && ly === -6) return { kind: 'lamp', plot };
  if (plot === 0) {
    // plaza: open square with four pillars
    if ((lx === -4 || lx === 3) && (ly === -4 || ly === 3)) return { kind: 'pillar', plot };
    return { kind: 'street', plot };
  }
  const inX = lx >= -CRIB_HALF && lx <= CRIB_HALF - 1;
  const inY = ly >= -CRIB_HALF && ly <= CRIB_HALF - 1;
  if (!inX || !inY) return { kind: 'street', plot };
  const edgeX = lx === -CRIB_HALF || lx === CRIB_HALF - 1;
  const edgeY = ly === -CRIB_HALF || ly === CRIB_HALF - 1;
  if (!edgeX && !edgeY) return { kind: 'floor', plot };
  if (edgeY && !edgeX && (lx === -1 || lx === 0)) {
    return { kind: 'door', plot, side: ly === CRIB_HALF - 1 ? 0 : 1 };
  }
  return { kind: 'wall', plot };
}

/** Which crib (plot index) a world position is inside, or -1 if outside any crib interior. */
export function cribAtPos(x: number, y: number, R: number): number {
  const c = cellAt(Math.floor(x), Math.floor(y), R);
  return c.kind === 'floor' ? c.plot : -1;
}

export type DoorLookup = (plot: number, side: DoorSide) => DoorState | undefined;

/** A door blocks movement when its crib is owned, it is intact, and it is shut. */
export function doorBlocks(d: DoorState | undefined): boolean {
  return !!d && d.hp > 0 && !d.open;
}

/** Movement flags: ghosts (NPC mode) pass doors and fences; airborne bros clear fences. */
export interface MoveFlags { ghost?: boolean; airborne?: boolean }

export function solid(x: number, y: number, R: number, doors: DoorLookup, f: MoveFlags = {}): boolean {
  const c = cellAt(x, y, R);
  switch (c.kind) {
    case 'wall': case 'bound': case 'pillar': case 'lamp':
      return true;
    case 'fence':
      return !f.ghost && !f.airborne;
    case 'door':
      return !f.ghost && doorBlocks(doors(c.plot, c.side!));
    default:
      return false;
  }
}

function hits(x: number, y: number, R: number, doors: DoorLookup, f: MoveFlags): boolean {
  const x0 = Math.floor(x - RADIUS);
  const x1 = Math.floor(x + RADIUS);
  const y0 = Math.floor(y - RADIUS);
  const y1 = Math.floor(y + RADIUS);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (solid(cx, cy, R, doors, f)) return true;
    }
  }
  return false;
}

/** Move with axis-separated collision. Returns the new position. */
export function move(
  x: number, y: number, dx: number, dy: number, R: number, doors: DoorLookup, f: MoveFlags = {},
): [number, number] {
  // sub-step so fast movers never tunnel through a 1-tile wall
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.3));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (!hits(x + sx, y, R, doors, f)) x += sx;
    if (!hits(x, y + sy, R, doors, f)) y += sy;
  }
  return [x, y];
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** True if a position overlaps a fence cell (an airborne bro may not land there). */
export function overFence(x: number, y: number, R: number): boolean {
  const x0 = Math.floor(x - RADIUS), x1 = Math.floor(x + RADIUS);
  const y0 = Math.floor(y - RADIUS), y1 = Math.floor(y + RADIUS);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (cellAt(cx, cy, R).kind === 'fence') return true;
  }
  return false;
}

