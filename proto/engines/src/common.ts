// Engine-neutral parts of the engine comparison prototype.
// Both the Three.js page and the Babylon.js page use exactly this layout,
// crowd paths, FPS meter and game-server connection, so the only thing that
// differs between them is the renderer.

import { api, getToken, setToken, solvePow } from '../../../client/src/api.ts';
import type { ClientMsg, EntView, ServerMsg } from '../../../shared/protocol.ts';
import { PLOT } from '../../../shared/constants.ts';

export const params = new URLSearchParams(location.search);
export const CROWD = Number(params.get('n') ?? 24); // animated characters walking the streets
export const BENCH_SECONDS = Number(params.get('bench') ?? 0); // >0: measure for N seconds, then report
export const ONLINE = params.get('online') !== '0';

// ---- Town layout --------------------------------------------------------
// Same plot grid as the real game: a plot is 14 game tiles. Here a plot is
// 4 model tiles: a 3x3 yard with the crib in the middle, plus one street tile.

export const RING = 2; // plots from the plaza to the edge (5x5 plots)
export const TILES_PER_PLOT = 4;
export const HALF = RING * TILES_PER_PLOT + 2; // tiles from center to edge

export type TileModel =
  | 'road-straight' | 'road-straight-lightposts' | 'road-intersection'
  | 'grass' | 'grass-trees' | 'grass-trees-tall' | 'pavement' | 'pavement-fountain'
  | 'building-small-a' | 'building-small-b' | 'building-small-c' | 'building-small-d' | 'building-garage';

export const MODELS: TileModel[] = [
  'road-straight', 'road-straight-lightposts', 'road-intersection',
  'grass', 'grass-trees', 'grass-trees-tall', 'pavement', 'pavement-fountain',
  'building-small-a', 'building-small-b', 'building-small-c', 'building-small-d', 'building-garage',
];

export interface Placement { model: TileModel; x: number; z: number; rot: number } // rot in radians around Y

const isRoad = (i: number) => ((i % 4) + 4) % 4 === 2;

function hash(x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function townLayout(): Placement[] {
  const out: Placement[] = [];
  const cribs: TileModel[] = ['building-small-a', 'building-small-b', 'building-small-c', 'building-small-d'];
  for (let x = -HALF; x <= HALF; x++) {
    for (let z = -HALF; z <= HALF; z++) {
      const rx = isRoad(x), rz = isRoad(z);
      if (rx && rz) { out.push({ model: 'road-intersection', x, z, rot: 0 }); continue; }
      if (rx || rz) {
        const lamp = (rx ? z : x) % 4 === 0;
        out.push({ model: lamp ? 'road-straight-lightposts' : 'road-straight', x, z, rot: rx ? 0 : Math.PI / 2 });
        continue;
      }
      const px = Math.round(x / 4), pz = Math.round(z / 4);
      const lx = x - px * 4, lz = z - pz * 4;
      const plaza = px === 0 && pz === 0;
      const r = hash(x, z);
      if (plaza) {
        out.push({ model: lx === 0 && lz === 0 ? 'pavement-fountain' : 'pavement', x, z, rot: 0 });
      } else if (lx === 0 && lz === 0) {
        // the crib: front door faces south (+z), like the game
        out.push({ model: cribs[Math.floor(hash(px, pz) * cribs.length)], x, z, rot: 0 });
      } else if (lz === 1 && lx === 0) {
        out.push({ model: 'pavement', x, z, rot: 0 }); // front path
      } else {
        out.push({ model: r < 0.25 ? 'grass-trees' : r < 0.4 ? 'grass-trees-tall' : r < 0.47 ? 'building-garage' : 'grass', x, z, rot: Math.floor(r * 4) * Math.PI / 2 });
      }
    }
  }
  return out;
}

// ---- Crowd: characters walking loops around blocks ----------------------

export interface Walker { x: number; z: number; heading: number }

export function crowdAt(i: number, t: number): Walker {
  // each walker circles one block on the street ring around it
  const plots = 2 * RING + 1;
  const bx = (i % plots) - RING, bz = (Math.floor(i / plots) % plots) - RING;
  const side = 4; // block perimeter is a 4x4 square of street tiles
  const per = side * 4;
  const speed = 0.9 + 0.3 * hash(i, 7);
  let d = ((t * speed + i * 3.7) % per + per) % per;
  const cx = bx * 4, cz = bz * 4, h = 2;
  const lane = 0.18 * (i % 2 ? 1 : -1);
  let x: number, z: number, heading: number;
  if (d < side) { x = cx - h + d; z = cz - h + lane; heading = Math.PI / 2; }
  else if ((d -= side) < side) { x = cx + h + lane; z = cz - h + d; heading = 0; }
  else if ((d -= side) < side) { x = cx + h - d; z = cz + h + lane; heading = -Math.PI / 2; }
  else { d -= side; x = cx - h + lane; z = cz + h - d; heading = Math.PI; }
  return { x, z, heading };
}

/** Game-server world units to scene tile units. */
export function serverToScene(x: number, y: number): [number, number] {
  return [(x / PLOT) * TILES_PER_PLOT, (y / PLOT) * TILES_PER_PLOT];
}

// ---- HUD: FPS meter + benchmark -----------------------------------------

/** CPU time the engine spent on the last frame (update + draw submit), in ms. */
export const cpu: number[] = [];
export function timeFrame(fn: () => void) {
  const a = performance.now();
  fn();
  cpu.push(performance.now() - a);
  if (cpu.length > 240) cpu.shift();
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

export interface Stats { drawCalls: () => number; triangles: () => number }

export function startHud(engine: string, loadStart: number, stats: Stats) {
  const el = document.createElement('div');
  el.id = 'hud';
  el.style.cssText = 'position:fixed;left:8px;top:8px;padding:8px 10px;background:rgba(0,0,0,.6);color:#fff;font:13px/1.4 ui-monospace,Menlo,monospace;border-radius:6px;z-index:10;white-space:pre';
  document.body.appendChild(el);
  const loadMs = performance.now() - loadStart;
  const frames: number[] = [];
  let last = performance.now();
  let shown = 0;
  const benchStart = performance.now() + 2000; // 2 s warm-up
  let reported = false;
  const tick = (now: number) => {
    const dt = now - last;
    last = now;
    frames.push(dt);
    if (frames.length > 240) frames.shift();
    if (now - shown > 250) {
      shown = now;
      const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
      el.textContent = `${engine}\nFPS ${(1000 / avg).toFixed(0)}  (${avg.toFixed(1)} ms, CPU ${mean(cpu).toFixed(1)} ms)\ndraw calls ${stats.drawCalls()}  tris ${(stats.triangles() / 1000).toFixed(0)}k\ncharacters ${CROWD + net.ents.length}  load ${(loadMs / 1000).toFixed(2)} s\nserver ${net.status}${net.ents.length ? `, ${net.ents.length} live` : ''}`;
    }
    if (BENCH_SECONDS > 0 && !reported && now > benchStart) {
      bench.push(dt);
      benchCpu.push(cpu[cpu.length - 1] ?? 0);
      if (now - benchStart > BENCH_SECONDS * 1000) {
        reported = true;
        const sorted = [...bench].sort((a, b) => a - b);
        const avg = bench.reduce((a, b) => a + b, 0) / bench.length;
        (window as unknown as { __bench: unknown }).__bench = {
          engine, fps: 1000 / avg, cpuMs: mean(benchCpu), cpuP95: [...benchCpu].sort((a, b) => a - b)[Math.floor(benchCpu.length * 0.95)], p95ms: sorted[Math.floor(sorted.length * 0.95)],
          frames: bench.length, drawCalls: stats.drawCalls(), triangles: stats.triangles(), loadMs,
          server: net.status, live: net.ents.length,
        };
      }
    }
    requestAnimationFrame(tick);
  };
  const bench: number[] = [];
  const benchCpu: number[] = [];
  requestAnimationFrame(tick);
}

// ---- Game server connection (the real Bro Chase server) -----------------

export const keys = new Set<string>();
addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

export const net = {
  status: 'offline' as string,
  you: '' as string,
  ents: [] as EntView[],
  ws: null as WebSocket | null,
  send(m: ClientMsg) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); },
};

export async function connect() {
  if (!ONLINE) return;
  try {
    net.status = 'signing in';
    if (!getToken() || !(await api.me().catch(() => null))) {
      const c = await api.captcha();
      if (c.kind !== 'pow') throw new Error('turnstile captcha is on');
      const nonce = await solvePow(c.challenge, c.bits);
      setToken((await api.guest({ challenge: c.challenge, nonce }, 'Proto')).token);
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?${new URLSearchParams({ token: getToken() ?? '', mode: 'quick', role: 'bro' })}`);
    net.ws = ws;
    ws.onopen = () => { net.status = 'connected'; };
    ws.onclose = () => { net.status = 'closed'; net.ents = []; };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as ServerMsg;
      if (m.t === 'welcome') net.you = m.you.id;
      else if (m.t === 'snap') net.ents = m.ents;
      else if (m.t === 'ping') net.send({ t: 'pong', at: m.at });
    };
    setInterval(() => {
      const dx = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
      const dy = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
      net.send({ t: 'input', dx, dy, zoom: keys.has('shift') });
    }, 50);
  } catch (e) {
    net.status = `no server (${(e as Error).message})`;
  }
}

// ---- Shared look settings ------------------------------------------------

export const LOOK = {
  sky: 0x9fd4ff,
  fogNear: 14,
  fogFar: 34,
  sunDir: [-0.5, -1, -0.35] as [number, number, number],
  sunIntensity: 2.4,
  hemiIntensity: 0.6,
  envIntensity: 0.8,
  robotScale: 0.08,
  camera: params.get('cam') === 'close'
    ? { pos: [-1.0, 1.5, 4.6] as [number, number, number], target: [-4, 0.35, 0.9] as [number, number, number], fov: 40 }
    : { pos: [7.5, 9, 11] as [number, number, number], target: [0, 0, 1] as [number, number, number], fov: 45 },
};
