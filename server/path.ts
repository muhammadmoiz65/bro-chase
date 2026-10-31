// Grid A* for AI Sixsevens. Walls, fences, pillars and lamps block. A shut, intact
// door is passable at a high cost: the Sixseven will stop and smash it.

import { cellAt, doorBlocks, type DoorLookup } from '../shared/world.ts';

export interface PathResult {
  cells: Array<[number, number]>;
}

const DIRS: Array<[number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

function cost(x: number, y: number, R: number, doors: DoorLookup): number {
  const c = cellAt(x, y, R);
  switch (c.kind) {
    case 'floor': case 'street': return 1;
    case 'door': return doorBlocks(doors(c.plot, c.side!)) ? 7 : 1;
    default: return Infinity;
  }
}

class Heap {
  private a: Array<[number, number]> = []; // [f, key]
  get size() { return this.a.length; }
  push(f: number, k: number) {
    const a = this.a;
    a.push([f, k]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0][1];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const OFF = 1 << 15;
const key = (x: number, y: number) => (x + OFF) * 65536 + (y + OFF);
const unkey = (k: number): [number, number] => [Math.floor(k / 65536) - OFF, (k % 65536) - OFF];

export function findPath(
  sx: number, sy: number, gx: number, gy: number, R: number, doors: DoorLookup, maxNodes = 6000,
): PathResult | null {
  if (cost(gx, gy, R, doors) === Infinity) return null;
  const start = key(sx, sy);
  const goal = key(gx, gy);
  const g = new Map<number, number>([[start, 0]]);
  const from = new Map<number, number>();
  const open = new Heap();
  const h = (x: number, y: number) => Math.hypot(x - gx, y - gy);
  open.push(h(sx, sy), start);
  let expanded = 0;
  let best = start;
  let bestH = h(sx, sy);
  while (open.size && expanded < maxNodes) {
    const cur = open.pop();
    if (cur === goal) { best = goal; break; }
    expanded++;
    const [x, y] = unkey(cur);
    const gc = g.get(cur)!;
    const hc = h(x, y);
    if (hc < bestH) { bestH = hc; best = cur; }
    for (const [dx, dy, w] of DIRS) {
      const nx = x + dx, ny = y + dy;
      const c = cost(nx, ny, R, doors);
      if (c === Infinity) continue;
      // no corner cutting past blocked cells
      if (dx && dy && (cost(x + dx, y, R, doors) === Infinity || cost(x, y + dy, R, doors) === Infinity)) continue;
      const nk = key(nx, ny);
      const ng = gc + w * c;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        from.set(nk, cur);
        open.push(ng + h(nx, ny), nk);
      }
    }
  }
  // walk back from the goal (or the closest cell we reached)
  const cells: Array<[number, number]> = [];
  let k: number | undefined = best;
  while (k !== undefined && k !== start) {
    cells.push(unkey(k));
    k = from.get(k);
  }
  cells.reverse();
  return { cells };
}
