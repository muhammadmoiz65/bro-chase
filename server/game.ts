// One game room: a shared, growing neighbourhood of cribs, its bros, and the
// Opps hunting them. The server is the only source of truth; clients send
// inputs and receive filtered snapshots.

import type { WebSocket } from 'ws';
import {
  AURA, AURA_DELTA, BROS_PER_MONSTER, CASH, MONSTER, RADIUS, VENT, DEF, DEF_KINDS, DEFENCE, DOOR_LEVEL_HP, GEAR, ITEM, SHOP, type DefKind, type ItemId, type ShopId, CATCH_RANGE, DOOR, EVENTS, INTEREST_RADIUS, JUMP, MOG_STUN_SEC, NOISE,
  PHASE_SEC, PLOT, RECONNECT_GRACE_SEC, REVIVE_RANGE, REVIVE_SEC, RING_LIGHT_RANGE, SPEED, TICK_RATE, VISION,
} from '../shared/constants.ts';
import type {
  ClientMsg, DropView, EntView, FeedItem, LobbyInfo, ModeName, NoiseKind, NoiseView, Phase, PropView, DefView, Role, ScoreRow, SelfView, ServerMsg,
} from '../shared/protocol.ts';
import {
  ventsFor, cellAt, cribAtPos, cribSpawn, dist, doorBlocks, doorCells, doorCenter, move, overFence, plotCenter,
  ringFor, type CribView, type DoorSide, type DoorState,
} from '../shared/world.ts';
import { findPath } from './path.ts';
import { airborne as isAirborne, freshJump, kicksSpeed, stepJump, tryJump, type JumpState } from '../shared/gear.ts';

const DT = 1 / TICK_RATE;

export interface Hooks {
  onStats(accountId: string, s: { nights?: number; wins?: number; catches?: number; mogs?: number; revives?: number }): void;
  onEmpty(room: Room): void;
}

interface Door extends DoorState { openUntil: number }
interface Crib { owner: string | null; ownerName?: string; doors: [Door, Door]; level: number; autorepair: boolean; defLv: Record<DefKind, number> }

interface Def { id: number; k: DefKind; x: number; y: number; hp: number; owner: string; plot: number; cd: number; shotT: number; tx: number; ty: number }

interface Hunter { id: string; x: number; y: number; name: string; stunUntil: number; stunFrom: [number, number]; stats: RoundStats; blasterHits?: number }

interface RoundStats { score: number; catches: number; mogs: number; revives: number; letIns: number; caught: number }
const freshStats = (): RoundStats => ({ score: 0, catches: 0, mogs: 0, revives: 0, letIns: 0, caught: 0 });

interface Player {
  id: string; // account id
  name: string;
  role: Role;
  ws: WebSocket | null;
  leftAt: number;
  x: number; y: number;
  npc: boolean; // caught, ghost mode
  light: boolean;
  aura: number;
  input: { dx: number; dy: number; zoom: boolean; sneak: boolean };
  jump: JumpState;
  kicks: number; vest: number; // gear tiers 0..3, kept between nights
  shields: number; shieldUntil: number;
  crib: number;
  stunUntil: number; stunFrom: [number, number];
  repairing: boolean;
  rv: number;
  hue: number;
  cash: number;
  inv: Record<ItemId, number>;
  drinkUntil: number;
  bribeUntil: number;
  cashT: number;
  stats: RoundStats;
  ping: number;
  stepT: number; repairNoiseT: number; smashCd: number;
  chatTimes: number[];
  bot: boolean; // a bot bro that fills a bro slot when players hunt
  wantOpp: boolean; // asked to play as an Opp, waiting for a slot
  screechCd: number; lungeCd: number; lungeT: number;
  botT: number; botGoal: [number, number] | null; botPath: Array<[number, number]>; botReplan: number;
  ventCd: number; ventT: number;
}

const BOT_NAMES = [
  'Skibidi Steve', 'Rizzler Ray', 'Gyatt Gary', 'Fanum Fred', 'Sigma Sam', 'Mewing Mo', 'Ohio Ollie', 'Npc Nate',
  'Delulu Dee', 'Bussin Ben', 'Goofy Gabe', 'Yapper Yas', 'Cooked Cole', 'Aura Ava', 'Edgy Eli', 'Lowkey Lou',
];

interface Ai {
  id: string;
  name: string;
  x: number; y: number;
  path: Array<[number, number]>;
  goal: [number, number] | null;
  chase: string | null; chaseUntil: number;
  replanAt: number;
  stunUntil: number; stunFrom: [number, number];
  smashNoiseT: number;
  hunchAt: number;
  stats: RoundStats;
  blasterHits?: number;
  ventCd: number; ventT: number;
  ventPlan: { a: [number, number]; b: [number, number] } | null;
}

interface Noise { id: number; x: number; y: number; r: number; t: number; src: string | null; k: NoiseKind }
interface Knock { id: number; from: string; owner: string; plot: number; side: DoorSide; expires: number }

let noiseSeq = 1;
let dropSeq = 1;
let knockSeq = 1;
let aiSeq = 1;
let botSeq = 1;

const now = () => Date.now() / 1000;
const hueOf = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
};

export class Room {
  players = new Map<string, Player>();
  ais: Ai[] = [];
  cribs = new Map<number, Crib>();
  R = 1;
  phase: Phase;
  phaseEnd = 0;
  night = 0;
  noises: Noise[] = [];
  drops: Array<{ id: number; x: number; y: number; k: 'aura' | 'cash' }> = [];
  defs: Def[] = [];
  props: Array<{ id: number; k: 'trap' | 'decoy'; x: number; y: number; owner: string; until: number; noiseT: number }> = [];
  knocks = new Map<number, Knock>();
  feed: FeedItem[] = [];
  ev = { power: true, mode: null as ModeName | null, modeEnd: 0, nextAt: 0 };
  private tickN = 0;
  private timer: NodeJS.Timeout | null = null;
  private dropT = 0;
  private aiAdjustT = 0;
  emptySince = 0;

  constructor(
    public code: string,
    public name: string,
    public isPrivate: boolean,
    public quick: boolean,
    public hostId: string | null,
    private hooks: Hooks,
    private phaseSec = PHASE_SEC,
  ) {
    this.phase = quick ? 'pregame' : 'lobby';
    this.phaseEnd = quick ? now() + this.phaseSec.pregame : 0;
    this.emptySince = now();
  }

  start() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const p of this.players.values()) p.ws?.close(1001, 'room closed');
  }

  // ---------- membership ----------

  get bros() { return [...this.players.values()].filter((p) => p.role === 'bro'); }
  get humanBros() { return this.bros.filter((p) => !p.bot); }
  get bots() { return [...this.players.values()].filter((p) => p.bot); }
  get oppPlayers() { return [...this.players.values()].filter((p) => p.role === 'opp'); }
  get humanCount() { return this.players.size - this.bots.length; }
  get connectedCount() { return [...this.players.values()].filter((p) => p.ws).length; }

  /**
   * Opp slots: one per 4 real bros (rounded up), and always at least one so you can hunt solo.
   * Bot bros fill the bro side so every player Opp still has 4 bros to chase, and AI Opps fill
   * any slot no player took.
   */
  private canBeOpp(excludeId?: string): boolean {
    const bros = this.humanBros.filter((p) => p.id !== excludeId).length;
    const opps = this.oppPlayers.filter((p) => p.id !== excludeId).length;
    return opps + 1 <= Math.max(1, Math.ceil(bros / BROS_PER_MONSTER));
  }

  /** Add or remove bot bros so each player Opp has BROS_PER_MONSTER bros to hunt. */
  private adjustBots() {
    if (!this.humanCount) { for (const b of this.bots) this.removeBot(b); return; }
    const want = Math.min(MONSTER.maxBots, Math.max(0, this.oppPlayers.length * BROS_PER_MONSTER - this.humanBros.length));
    const bots = this.bots;
    for (let i = bots.length; i < want; i++) this.addBot();
    // only remove bots between nights so nobody's crib vanishes mid-chase
    if (this.phase !== 'lockin') for (const b of bots.slice(want)) this.removeBot(b);
  }

  private addBot() {
    const used = new Set(this.bots.map((b) => b.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot Bro ${botSeq}`;
    const p = this.newPlayer(`bot-${botSeq++}`, name, null, 'bro');
    p.bot = true;
    this.players.set(p.id, p);
    this.ensureRoom();
    // bots take the free crib farthest out so players keep the good ones near the plaza
    this.claimCrib(p, this.nearestFreeCrib(9999, 9999));
    this.spawn(p);
  }

  private removeBot(b: Player) {
    this.players.delete(b.id);
    if (b.crib >= 0) this.releaseCrib(b);
    for (const [id, k] of this.knocks) if (k.from === b.id || k.owner === b.id) this.knocks.delete(id);
  }

  private newPlayer(id: string, name: string, ws: WebSocket | null, role: Role): Player {
    return {
      id, name, role, ws, leftAt: 0, x: 0, y: 0, npc: false, light: false, aura: AURA.start,
      input: { dx: 0, dy: 0, zoom: false, sneak: false }, jump: freshJump(), kicks: 0, vest: 0, shields: 0, shieldUntil: 0, crib: -1, stunUntil: 0, stunFrom: [0, 0],
      repairing: false, rv: 0, hue: hueOf(id), cash: CASH.start, inv: { trap: 0, drink: 0, decoy: 0, bribe: 0 },
      drinkUntil: 0, bribeUntil: 0, cashT: 0, stats: freshStats(), ping: 0, stepT: 0,
      repairNoiseT: 0, smashCd: 0, chatTimes: [], bot: false, wantOpp: false, screechCd: 0, lungeCd: 0, lungeT: 0,
      botT: 0, botGoal: null, botPath: [], botReplan: 0, ventCd: 0, ventT: 0,
    };
  }

  join(accountId: string, name: string, ws: WebSocket, wantRole: Role): void {
    let p = this.players.get(accountId);
    let notice: string | undefined;
    if (p) {
      // reconnect (or a second tab): take over the seat
      if (p.ws && p.ws !== ws) {
        this.sendTo(p, { t: 'kicked', reason: 'You joined from another tab or device.' });
        p.ws.close(4000, 'replaced');
      }
      p.ws = ws;
      p.leftAt = 0;
      p.name = name;
    } else {
      let role: Role = 'bro';
      let queued = false;
      if (wantRole === 'opp') {
        if (this.canBeOpp() && this.phase !== 'lockin') role = 'opp';
        else {
          queued = true;
          notice = this.phase === 'lockin' && this.canBeOpp()
            ? "The night already started. You're a bro until it ends, then you'll be an Opp."
            : `Every Opp slot is taken (one per ${BROS_PER_MONSTER} bros). You're a bro for now and you'll get the next free slot.`;
        }
      }
      p = this.newPlayer(accountId, name, ws, role);
      p.wantOpp = queued;
      this.players.set(accountId, p);
      this.ensureRoom();
      // mid-night joiners get the nearest free crib; otherwise walk into any free crib to claim it
      if (role === 'bro' && this.phase === 'lockin') this.claimCrib(p, this.nearestFreeCrib(0, 0));
      this.spawn(p);
      this.feed.push({ k: 'join', a: name });
      this.systemChat(`${name} joined${role === 'opp' ? ' as an Opp' : ''}.`);
      if (!this.hostId && !this.quick) this.hostId = accountId;
      this.adjustBots();
    }
    this.emptySince = 0;
    this.sendTo(p, { t: 'welcome', you: this.selfView(p), room: this.code, notice });
  }

  leave(accountId: string, ws: WebSocket) {
    const p = this.players.get(accountId);
    if (!p || p.ws !== ws) return;
    p.ws = null;
    p.leftAt = now();
    p.input = { dx: 0, dy: 0, zoom: false, sneak: false };
    p.repairing = false;
    if (this.connectedCount === 0) this.emptySince = now();
  }

  private drop(p: Player) {
    this.players.delete(p.id);
    if (p.crib >= 0) this.releaseCrib(p);
    for (const [id, k] of this.knocks) if (k.from === p.id || k.owner === p.id) this.knocks.delete(id);
    this.feed.push({ k: 'leave', a: p.name });
    this.systemChat(`${p.name} left.`);
    this.adjustBots();
    if (this.hostId === p.id) {
      const next = [...this.players.values()].find((q) => q.ws);
      this.hostId = next ? next.id : null;
      if (next) this.systemChat(`${next.name} is now the host.`);
    }
  }

  /** Keep enough plots so there are always a few free cribs to pick from. */
  private ensureRoom() {
    const bros = [...this.players.values()].filter((q) => q.role === 'bro').length;
    this.R = Math.max(this.R, ringFor(bros + 4), ...[...this.cribs.keys()].map((i) => ringFor(i + 1)));
  }

  private maxPlot() { return (2 * this.R + 1) ** 2 - 1; }

  private nearestFreeCrib(x: number, y: number): number {
    let best = -1, bd = Infinity;
    for (let i = 1; i <= this.maxPlot(); i++) {
      if (this.cribs.get(i)?.owner) continue;
      const [cx, cy] = plotCenter(i);
      const d = dist(cx, cy, x, y);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) { this.R++; return this.nearestFreeCrib(x, y); }
    return best;
  }

  private claimCrib(p: Player, i: number) {
    if (p.crib >= 0) this.releaseCrib(p);
    const fresh = (): Door => ({ hp: DOOR.maxHp, open: false, openUntil: 0 });
    this.cribs.set(i, { owner: p.id, ownerName: p.name, doors: [fresh(), fresh()], level: 0, autorepair: false, defLv: { blaster: 1, lamp: 1, bass: 1 } });
    p.crib = i;
    this.ensureRoom();
  }

  /** Lobby and pregame: a bro without a crib who walks into a free one settles there. */
  private stepClaims() {
    if (this.phase !== 'lobby' && this.phase !== 'pregame') return;
    for (const p of this.players.values()) {
      if (p.role !== 'bro' || p.npc || p.bot) continue;
      const i = cribAtPos(p.x, p.y, this.R);
      if (i <= 0 || i === p.crib || this.cribs.get(i)?.owner) continue;
      // you can move house until you have spent anything on your crib
      const old = p.crib >= 0 ? this.cribs.get(p.crib) : undefined;
      if (old && (old.level > 0 || old.autorepair || this.defs.some((d) => d.plot === p.crib))) continue;
      this.claimCrib(p, i);
      this.sys(p, old ? 'Moved into this crib. Doors lock behind you.' : 'This crib is yours now. Doors are locked: only you can open them.');
      this.feed.push({ k: 'info', text: `${p.name} settled in a crib.` });
    }
  }

  /** Lock-in: anyone still homeless gets the nearest free crib. */
  private assignHomeless() {
    for (const p of this.players.values()) {
      if (p.role !== 'bro' || p.crib >= 0) continue;
      this.claimCrib(p, this.nearestFreeCrib(p.x, p.y));
      this.sys(p, 'You never picked a crib, so you got the nearest one. Get inside!');
    }
  }

  private releaseCrib(p: Player) {
    const c = this.cribs.get(p.crib);
    if (c && c.owner === p.id) this.cribs.delete(p.crib);
    this.defs = this.defs.filter((d) => d.owner !== p.id);
    p.crib = -1;
  }

  private spawn(p: Player) {
    if (p.role === 'bro' && p.crib < 0) {
      p.x = (Math.random() - 0.5) * 4;
      p.y = (Math.random() - 0.5) * 4;
    } else if (p.role === 'bro') {
      const [x, y] = cribSpawn(p.crib);
      p.x = x + (Math.random() - 0.5);
      p.y = y + (Math.random() - 0.5);
    } else {
      [p.x, p.y] = this.edgeSpawn();
    }
    p.npc = false;
    p.light = false;
    p.rv = 0;
  }

  /** A street cell on the outer ring, far from the middle. */
  private edgeSpawn(): [number, number] {
    const edge = this.R * PLOT + PLOT / 2 - 3;
    for (let tries = 0; tries < 200; tries++) {
      const t = Math.random() * 4;
      const s = (Math.random() * 2 - 1) * edge;
      const [x, y] = t < 1 ? [s, -edge] : t < 2 ? [edge, s] : t < 3 ? [s, edge] : [-edge, s];
      const cx = Math.floor(x), cy = Math.floor(y);
      if (cellAt(cx, cy, this.R).kind === 'street') return [cx + 0.5, cy + 0.5];
    }
    return [0.5, -3.5];
  }

  private randomStreet(): [number, number] {
    const span = this.R * PLOT + PLOT / 2 - 2;
    for (let tries = 0; tries < 200; tries++) {
      const cx = Math.floor((Math.random() * 2 - 1) * span);
      const cy = Math.floor((Math.random() * 2 - 1) * span);
      if (cellAt(cx, cy, this.R).kind === 'street') return [cx + 0.5, cy + 0.5];
    }
    return [3.5, 3.5];
  }

  doorLookup = (plot: number, side: DoorSide): DoorState | undefined => {
    const c = this.cribs.get(plot);
    return c && c.owner ? c.doors[side] : undefined;
  };

  // ---------- messages ----------

  handle(accountId: string, msg: ClientMsg) {
    const p = this.players.get(accountId);
    if (!p || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'input': {
        let dx = Number(msg.dx) || 0, dy = Number(msg.dy) || 0;
        const len = Math.hypot(dx, dy);
        if (len > 1) { dx /= len; dy /= len; }
        p.input = { dx, dy, zoom: !!msg.zoom, sneak: !!msg.sneak && !msg.zoom };
        break;
      }
      case 'jump':
        if (p.role === 'opp') this.lunge(p);
        else if (p.role === 'bro' && !p.npc && tryJump(p.jump, p.kicks, this.ev.mode === 'lowgrav') === 'air') {
          this.noise(p.x, p.y, JUMP.landNoise, p.id, 'land'); // the kicks squeak
        }
        break;
      case 'screech': this.screech(p); break;
      case 'vent':
        if (p.role === 'opp') this.enterVent(p, Number(msg.dx) || p.input.dx, Number(msg.dy) || p.input.dy);
        break;
      case 'light':
        if (p.role === 'bro' && !p.npc) p.light = !p.light && p.aura > 0;
        break;
      case 'use': this.use(p); break;
      case 'buy': this.buy(p, msg.item); break;
      case 'item': this.useItem(p, msg.item); break;
      case 'build': this.build(p, msg.kind); break;
      case 'upgrade': this.upgradeDef(p, msg.kind); break;
      case 'repair': p.repairing = !!msg.on; break;
      case 'answer': this.answer(p, Number(msg.id), !!msg.ok); break;
      case 'chat': this.chat(p, msg.text); break;
      case 'scores': this.sendTo(p, { t: 'scores', rows: this.scoreRows() }); break;
      case 'start':
        if (this.phase === 'lobby' && p.id === this.hostId) this.setPhase('pregame');
        break;
      case 'role': this.switchRole(p, msg.role); break;
      case 'pong':
        if (typeof msg.at === 'number') p.ping = Math.max(0, Math.round(Date.now() - msg.at));
        break;
    }
  }

  private switchRole(p: Player, role: Role) {
    if (role !== 'bro' && role !== 'opp') return;
    if (p.bot) return;
    if (role === 'bro') p.wantOpp = false;
    if (p.role === role) return;
    if (this.phase === 'lockin') {
      if (role === 'opp') {
        p.wantOpp = true;
        this.sys(p, "You'll switch to Opp when this night ends.");
      } else this.sys(p, 'You can switch roles between nights.');
      return;
    }
    if (role === 'opp' && !this.canBeOpp(p.id)) {
      p.wantOpp = true;
      this.sys(p, `Every Opp slot is taken (one per ${BROS_PER_MONSTER} bros). You're next in line for one.`);
      return;
    }
    this.setRole(p, role);
  }

  private setRole(p: Player, role: Role) {
    p.role = role;
    p.wantOpp = false;
    p.light = false;
    p.npc = false;
    p.repairing = false;
    if (role === 'opp') this.releaseCrib(p);
    this.ensureRoom();
    this.spawn(p);
    this.systemChat(`${p.name} is now ${role === 'bro' ? 'a bro' : 'an Opp'}.`);
    this.adjustBots();
  }

  // ---------- Opp player abilities ----------

  /** Q: a screech that bounces off every bro in range. The hunter sees pings; everyone nearby hears it. */
  private screech(p: Player) {
    if (p.role !== 'opp' || this.phase !== 'lockin' || p.screechCd > 0 || now() < p.stunUntil) return;
    p.screechCd = MONSTER.screechCd;
    const t = now();
    const r = MONSTER.screechRange * (this.ev.mode === 'disco' ? 0.6 : 1);
    const pts: Array<[number, number]> = this.bros
      .filter((b) => !b.npc && t >= b.bribeUntil && dist(b.x, b.y, p.x, p.y) <= r)
      .map((b) => [+b.x.toFixed(1), +b.y.toFixed(1)]);
    this.noise(p.x, p.y, MONSTER.screechNoise, p.id, 'screech');
    this.sendTo(p, { t: 'echo', x: +p.x.toFixed(1), y: +p.y.toFixed(1), r, pts });
  }

  // ---------- vents ----------

  private nearestVent(x: number, y: number): [number, number] | null {
    let best: [number, number] | null = null, bd = Infinity;
    for (const v of ventsFor(this.R)) {
      const d = dist(v[0], v[1], x, y);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  /** Pick the exit: the farthest vent (up to VENT.maxHop plots) within 50 degrees of the heading, else a random one. */
  private ventExit(from: [number, number], dx: number, dy: number): [number, number] | null {
    const all = ventsFor(this.R).filter((v) => {
      const d = dist(v[0], v[1], from[0], from[1]);
      return d > 1 && d <= VENT.maxHop * PLOT * 1.45;
    });
    if (!all.length) return null;
    const l = Math.hypot(dx, dy);
    if (l > 0.1) {
      let best: [number, number] | null = null, bs = -Infinity;
      for (const v of all) {
        const vx = v[0] - from[0], vy = v[1] - from[1], d = Math.hypot(vx, vy);
        const cos = (vx * dx + vy * dy) / (d * l);
        if (cos < Math.cos((50 * Math.PI) / 180)) continue;
        const score = d * cos;
        if (score > bs) { bs = score; best = v; }
      }
      if (best) return best;
    }
    return all[Math.floor(Math.random() * all.length)];
  }

  /** Crawl in at the nearest grate; both grates clank so bros get a warning before the Opp pops out. */
  private startVent(h: { x: number; y: number; ventCd: number; ventT: number; stunUntil: number }, to: [number, number], src: string | null): boolean {
    const t = now();
    if (this.phase !== 'lockin' || h.ventCd > 0 || h.ventT > 0 || t < h.stunUntil) return false;
    const at = this.nearestVent(h.x, h.y);
    if (!at || dist(at[0], at[1], h.x, h.y) > VENT.useRange) return false;
    this.noise(at[0], at[1], VENT.noise, src, 'vent');
    this.noise(to[0], to[1], VENT.noise, src, 'vent');
    h.ventT = VENT.travelSec;
    h.ventCd = VENT.cd + VENT.travelSec;
    [h.x, h.y] = to;
    return true;
  }

  private enterVent(p: Player, dx: number, dy: number) {
    const at = this.nearestVent(p.x, p.y);
    if (!at || dist(at[0], at[1], p.x, p.y) > VENT.useRange) return this.sys(p, 'Stand on a vent grate to crawl in.');
    const to = this.ventExit(at, dx, dy);
    if (to) this.startVent(p, to, p.id);
  }

  /** Tick a hunter's vent trip. Returns true while it is still underground. */
  private stepVent(h: { x: number; y: number; ventCd: number; ventT: number }, src: string | null): boolean {
    h.ventCd = Math.max(0, h.ventCd - DT);
    if (h.ventT <= 0) return false;
    h.ventT -= DT;
    if (h.ventT > 0) return true;
    h.ventT = 0;
    this.noise(h.x, h.y, VENT.noise, src, 'vent'); // the grate bangs open
    return false;
  }

  /** Space: a short burst of speed to close the gap. */
  private lunge(p: Player) {
    if (this.phase !== 'lockin' || p.lungeCd > 0 || now() < p.stunUntil) return;
    p.lungeCd = MONSTER.lungeCd;
    p.lungeT = MONSTER.lungeSec;
    this.noise(p.x, p.y, NOISE.zoom, p.id, 'lunge');
  }

  // ---------- bot bros ----------

  /** Simple bot bros: stay home, fix their doors, light up and run when something gets close. */
  private stepBots(t: number) {
    const hunters = [...this.ais, ...this.oppPlayers].filter((h) => t >= h.stunUntil);
    for (const b of this.bots) {
      b.input = { dx: 0, dy: 0, zoom: false, sneak: false };
      b.repairing = false;
      if (b.npc) {
        // drift toward the nearest living bro to get revived
        const friend = this.bros.filter((q) => !q.npc && q !== b).sort((a, c) => dist(a.x, a.y, b.x, b.y) - dist(c.x, c.y, b.x, b.y))[0];
        if (friend && dist(friend.x, friend.y, b.x, b.y) > 0.9) this.steer(b, friend.x - b.x, friend.y - b.y);
        continue;
      }
      let threat: { x: number; y: number } | null = null;
      let td = Infinity;
      if (this.phase === 'lockin') {
        for (const h of hunters) {
          const d = dist(h.x, h.y, b.x, b.y);
          if (d < td) { td = d; threat = h; }
        }
      }
      // ring light when one is about to grab them (costs aura, so only up close)
      b.light = !!threat && td < RING_LIGHT_RANGE + 1.2 && b.aura > 35;
      if (threat && td < 6.5) {
        b.botGoal = null;
        this.flee(b, threat, td < 3.5);
        continue;
      }
      const crib = this.cribs.get(b.crib);
      if (!crib) continue;
      const [cx, cy] = plotCenter(b.crib);
      // fix a damaged door when it's quiet
      const max = DOOR_LEVEL_HP[crib.level];
      const hurt = ([0, 1] as DoorSide[]).find((s) => crib.doors[s].hp < max);
      if (hurt !== undefined && td > 8) {
        const tx = cx, ty = hurt === 0 ? cy + 2.4 : cy - 2.4;
        if (dist(b.x, b.y, tx, ty) > 0.6) this.steer(b, tx - b.x, ty - b.y);
        else b.repairing = true;
        continue;
      }
      // otherwise pace around the crib, footsteps and all
      if (cribAtPos(b.x, b.y, this.R) !== b.crib) { this.goHome(b, t, cx, cy); continue; }
      b.botPath = [];
      if ((b.botT -= DT) <= 0 || !b.botGoal) {
        b.botT = 2 + Math.random() * 4;
        b.botGoal = Math.random() < 0.35 ? null : [cx - 2.5 + Math.random() * 4.5, cy - 2.5 + Math.random() * 4.5];
      }
      if (b.botGoal && dist(b.x, b.y, b.botGoal[0], b.botGoal[1]) > 0.4) {
        this.steer(b, b.botGoal[0] - b.x, b.botGoal[1] - b.y, b.botT > 3 ? 'sneak' : 'walk');
      }
    }
  }

  /** Walk back to the crib, opening their own door when they reach it. */
  private goHome(b: Player, t: number, cx: number, cy: number) {
    if (t >= b.botReplan || !b.botPath.length) {
      b.botReplan = t + 0.6;
      const own = (plot: number, side: DoorSide) => (plot === b.crib ? undefined : this.doorLookup(plot, side));
      b.botPath = findPath(Math.floor(b.x), Math.floor(b.y), Math.floor(cx), Math.floor(cy), this.R, own)?.cells ?? [];
    }
    while (b.botPath.length && dist(b.x, b.y, b.botPath[0][0] + 0.5, b.botPath[0][1] + 0.5) < 0.4) b.botPath.shift();
    const next = b.botPath[0];
    if (!next) return this.steer(b, cx - b.x, cy - b.y);
    const c = cellAt(next[0], next[1], this.R);
    if (c.kind === 'door' && c.plot === b.crib && doorBlocks(this.doorLookup(c.plot, c.side!))) this.use(b);
    this.steer(b, next[0] + 0.5 - b.x, next[1] + 0.5 - b.y);
  }

  private steer(b: Player, dx: number, dy: number, pace: 'sneak' | 'walk' | 'zoom' = 'walk') {
    const l = Math.hypot(dx, dy) || 1;
    b.input = { dx: dx / l, dy: dy / l, zoom: pace === 'zoom', sneak: pace === 'sneak' };
  }

  /** Pick the direction (of 12) that gets the bot farthest from the threat without walking into a wall. */
  private flee(b: Player, h: { x: number; y: number }, sprint: boolean) {
    let best: [number, number] = [0, 0];
    let bestD = -Infinity;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const [nx, ny] = move(b.x, b.y, Math.cos(a) * 0.9, Math.sin(a) * 0.9, this.R, this.doorLookup);
      const moved = dist(nx, ny, b.x, b.y);
      const d = dist(nx, ny, h.x, h.y) + moved * 0.3 + Math.random() * 0.15;
      if (moved > RADIUS * 0.5 && d > bestD) { bestD = d; best = [Math.cos(a), Math.sin(a)]; }
    }
    this.steer(b, best[0], best[1], sprint ? 'zoom' : 'walk');
  }

  private use(p: Player) {
    if (p.npc) return;
    if (p.role === 'opp' && p.smashCd <= 0 && now() >= p.stunUntil) {
      const d = this.defs.find((x) => dist(x.x, x.y, p.x, p.y) < 1.6);
      if (d) {
        p.smashCd = DOOR.playerSmashCooldown;
        d.hp -= DEF.playerSmash;
        this.noise(d.x, d.y, NOISE.smash, p.id, 'smash');
        if (d.hp <= 0) {
          this.defs.splice(this.defs.indexOf(d), 1);
          p.stats.score += 5;
          this.feed.push({ k: 'smash', a: p.name, b: DEFENCE[d.k].name });
        }
        return;
      }
    }
    // find the closest door within reach
    let best: { plot: number; side: DoorSide; d: number } | null = null;
    for (const [plot, c] of this.cribs) {
      if (!c.owner) continue;
      for (const side of [0, 1] as DoorSide[]) {
        const [dx, dy] = doorCenter(plot, side);
        const d = dist(p.x, p.y, dx, dy);
        if (d < 1.7 && (!best || d < best.d)) best = { plot, side, d };
      }
    }
    if (!best) return;
    const crib = this.cribs.get(best.plot)!;
    const door = crib.doors[best.side];
    const [dx, dy] = doorCenter(best.plot, best.side);
    if (p.role === 'opp') {
      if (p.smashCd > 0 || !doorBlocks(door) || now() < p.stunUntil) return;
      p.smashCd = DOOR.playerSmashCooldown;
      this.hitDoor(best.plot, best.side, DOOR.playerSmash, p.name, p.stats);
      this.noise(dx, dy, NOISE.smash, p.id, 'smash');
      return;
    }
    if (crib.owner === p.id) {
      if (door.hp <= 0) return;
      door.open = !door.open;
      door.openUntil = door.open ? now() + DOOR.openSec : 0;
      this.noise(dx, dy, NOISE.door, p.id, 'door');
      return;
    }
    // someone else's crib: knock and wait for their approval
    if (!doorBlocks(door)) return;
    for (const k of this.knocks.values()) if (k.from === p.id && k.plot === best.plot) return;
    this.noise(dx, dy, NOISE.knock, p.id, 'knock');
    const owner = this.players.get(crib.owner!);
    if (owner?.bot && !owner.npc) {
      // bot bros let you in unless an Opp is right behind you
      const hot = [...this.ais, ...this.oppPlayers].some((h) => dist(h.x, h.y, p.x, p.y) < 4);
      if (!hot) {
        door.open = true;
        door.openUntil = now() + DOOR.openSec + 1;
        this.feed.push({ k: 'letin', a: owner.name, b: p.name });
      } else this.sys(p, `${owner.name}: nah bro, it's right behind you!`);
      return;
    }
    if (!owner || !owner.ws) {
      this.sendTo(p, { t: 'chat', from: 'server', role: 'bro', sys: true, text: `${crib.ownerName}'s not home. The door stays locked.` });
      return;
    }
    const k: Knock = { id: knockSeq++, from: p.id, owner: owner.id, plot: best.plot, side: best.side, expires: now() + DOOR.knockTimeoutSec };
    this.knocks.set(k.id, k);
    this.sendTo(owner, { t: 'knock', id: k.id, from: p.name, side: k.side, expires: k.expires });
    this.sendTo(p, { t: 'chat', from: 'server', role: 'bro', sys: true, text: `You knocked on ${owner.name}'s ${best.side === 0 ? 'front' : 'back'} door...` });
  }

  private answer(owner: Player, id: number, ok: boolean) {
    const k = this.knocks.get(id);
    if (!k || k.owner !== owner.id) return;
    this.knocks.delete(id);
    const from = this.players.get(k.from);
    const crib = this.cribs.get(k.plot);
    if (!crib || crib.owner !== owner.id) return;
    if (ok) {
      const door = crib.doors[k.side];
      if (door.hp > 0) {
        door.open = true;
        door.openUntil = now() + DOOR.openSec + 1;
      }
      const [dx, dy] = doorCenter(k.plot, k.side);
      this.noise(dx, dy, NOISE.door, owner.id, 'door');
      owner.stats.letIns++;
      owner.stats.score += 5;
      this.auraDelta(owner, AURA_DELTA.letIn, 'let a bro in');
      this.cashDelta(owner, CASH.letIn, 'let a bro in');
      if (from) this.feed.push({ k: 'letin', a: owner.name, b: from.name });
    } else if (from) {
      this.auraDelta(owner, AURA_DELTA.refuse, 'left a bro outside');
      this.sendTo(from, { t: 'chat', from: 'server', role: 'bro', sys: true, text: `${owner.name} said nah. Find another crib!` });
    }
  }

  private chat(p: Player, raw: unknown) {
    if (typeof raw !== 'string') return;
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 140);
    if (!text) return;
    const t = now();
    p.chatTimes = p.chatTimes.filter((x) => t - x < 5);
    if (p.chatTimes.length >= 5) {
      this.sendTo(p, { t: 'chat', from: 'server', role: 'bro', sys: true, text: 'Slow down, bro.' });
      return;
    }
    p.chatTimes.push(t);
    this.broadcast({ t: 'chat', from: p.name, role: p.role, text });
  }

  systemChat(text: string) {
    this.broadcast({ t: 'chat', from: 'server', role: 'bro', text, sys: true });
  }

  // ---------- simulation ----------

  private noise(x: number, y: number, r: number, src: string | null, k: NoiseKind) {
    this.noises.push({ id: noiseSeq++, x, y, r, t: now(), src, k });
  }

  private cashDelta(p: Player, d: number, why: string, quiet = false) {
    p.cash = Math.max(0, Math.round(p.cash + d));
    if (!quiet) this.sendTo(p, { t: 'cash', d: Math.round(d), why });
  }

  private buy(p: Player, item: ShopId) {
    const def = SHOP[item];
    if (!def || p.role !== 'bro') return;
    const crib = p.crib >= 0 ? this.cribs.get(p.crib) : undefined;
    let price: number;
    if (item === 'armor') {
      if (!crib || crib.level >= 3) return this.sendTo(p, { t: 'chat', from: 'server', role: 'bro', sys: true, text: 'Your doors are already max armor.' });
      price = (def.price as number[])[crib.level];
    } else if (item === 'autorepair') {
      if (!crib || crib.autorepair) return;
      price = def.price as number;
    } else if (item === 'kicks' || item === 'vest') {
      if (p[item] >= GEAR.maxTier) return this.sendTo(p, { t: 'chat', from: 'server', role: 'bro', sys: true, text: `Your ${def.name.toLowerCase()} are already max tier.` });
      price = (def.price as number[])[p[item]];
    } else price = def.price as number;
    if (p.cash < price) return this.sendTo(p, { t: 'chat', from: 'server', role: 'bro', sys: true, text: `Not enough cash: ${def.name} costs $${price}.` });
    this.cashDelta(p, -price, def.name);
    if (item === 'armor') {
      crib!.level++;
      const max = DOOR_LEVEL_HP[crib!.level];
      for (const d of crib!.doors) if (d.hp > 0) d.hp = Math.min(max, d.hp + (max - DOOR_LEVEL_HP[crib!.level - 1]));
    } else if (item === 'autorepair') crib!.autorepair = true;
    else if (item === 'kicks') p.kicks++;
    else if (item === 'vest') {
      p.vest++;
      p.shields = GEAR.vest[p.vest].shields; // a fresh suit is fully charged
    } else if (item === 'aura') this.auraDelta(p, 40, 'aura pack');
    else p.inv[item]++;
  }

  private useItem(p: Player, item: ItemId) {
    if (p.role !== 'bro' || p.npc || !(item in p.inv) || p.inv[item] <= 0) return;
    const t = now();
    if (item === 'trap') {
      if (this.props.filter((x) => x.k === 'trap' && x.owner === p.id).length >= ITEM.maxTrapsPerPlayer) {
        return this.sendTo(p, { t: 'chat', from: 'server', role: 'bro', sys: true, text: `Max ${ITEM.maxTrapsPerPlayer} banana peels down at once.` });
      }
      this.props.push({ id: dropSeq++, k: 'trap', x: p.x, y: p.y, owner: p.id, until: Infinity, noiseT: 0 });
    } else if (item === 'decoy') {
      this.props.push({ id: dropSeq++, k: 'decoy', x: p.x, y: p.y, owner: p.id, until: t + ITEM.decoySec, noiseT: 0 });
    } else if (item === 'drink') p.drinkUntil = t + ITEM.drinkSec;
    else if (item === 'bribe') {
      p.bribeUntil = t + ITEM.bribeSec;
      this.feed.push({ k: 'info', text: `${p.name} paid off the Opps (for now).` });
    }
    p.inv[item]--;
  }

  private sys(p: Player, text: string) {
    this.sendTo(p, { t: 'chat', from: 'server', role: 'bro', sys: true, text });
  }

  private build(p: Player, kind: DefKind) {
    const def = DEFENCE[kind];
    if (!def || p.role !== 'bro' || p.npc || p.crib < 0) return;
    const [cx, cy] = plotCenter(p.crib);
    if (Math.abs(p.x - cx) > PLOT / 2 - 0.6 || Math.abs(p.y - cy) > PLOT / 2 - 0.6) return this.sys(p, 'Build defences in or around your own crib.');
    const cell = cellAt(Math.floor(p.x), Math.floor(p.y), this.R);
    if (cell.kind !== 'floor' && cell.kind !== 'street') return this.sys(p, "Can't build on a door.");
    if (this.defs.filter((d) => d.plot === p.crib).length >= DEF.maxPerCrib) return this.sys(p, `Max ${DEF.maxPerCrib} defences per crib.`);
    if (this.defs.some((d) => dist(d.x, d.y, p.x, p.y) < 0.9)) return this.sys(p, 'Too close to another defence.');
    if (p.cash < def.build) return this.sys(p, `Not enough cash: ${def.name} costs $${def.build}.`);
    this.cashDelta(p, -def.build, `built ${def.name}`);
    this.defs.push({ id: dropSeq++, k: kind, x: p.x, y: p.y, hp: DEF.hp, owner: p.id, plot: p.crib, cd: 0, shotT: 0, tx: 0, ty: 0 });
  }

  private upgradeDef(p: Player, kind: DefKind) {
    const crib = p.crib >= 0 ? this.cribs.get(p.crib) : undefined;
    const def = DEFENCE[kind];
    if (!crib || !def) return;
    const lv = crib.defLv[kind];
    if (lv >= 3) return this.sys(p, `${def.name} is already max level.`);
    const price = def.upgrade[lv - 1];
    if (p.cash < price) return this.sys(p, `Not enough cash: upgrade costs $${price}.`);
    this.cashDelta(p, -price, `${def.name} level ${lv + 1}`);
    crib.defLv[kind] = lv + 1;
    for (const d of this.defs) if (d.owner === p.id && d.k === kind) d.hp = DEF.hp;
  }

  private hunters(): Hunter[] {
    return ([...this.ais, ...this.oppPlayers] as Array<Hunter & { ventT: number }>).filter((h) => h.ventT <= 0);
  }

  private stepDefs(t: number) {
    if (this.phase !== 'lockin') return;
    const hunters = this.hunters();
    for (const d of [...this.defs]) {
      d.cd = Math.max(0, d.cd - DT);
      const lv = this.cribs.get(d.plot)?.defLv[d.k] ?? 1;
      const range = DEFENCE[d.k].range[lv - 1];
      const owner = this.players.get(d.owner);
      // Opps wreck defences they brush past
      for (const h of hunters) {
        if (t < h.stunUntil || !h.id.startsWith('ai-')) continue;
        if (dist(h.x, h.y, d.x, d.y) < 1.1) d.hp -= DEF.oppDamagePerSec * DT;
      }
      if (d.hp <= 0) {
        this.defs.splice(this.defs.indexOf(d), 1);
        this.feed.push({ k: 'info', text: `An Opp wrecked ${owner?.name ?? 'a'}'s ${DEFENCE[d.k].name}` });
        continue;
      }
      if (d.cd > 0) continue;
      const targets = hunters.filter((h) => t >= h.stunUntil && dist(h.x, h.y, d.x, d.y) < range);
      if (!targets.length) continue;
      const h = targets.sort((a, b) => dist(a.x, a.y, d.x, d.y) - dist(b.x, b.y, d.x, d.y))[0];
      if (d.k === 'blaster') {
        d.cd = DEFENCE.blaster.every[lv - 1];
        d.shotT = t; d.tx = h.x; d.ty = h.y;
        h.blasterHits = (h.blasterHits ?? 0) + 1;
        if (h.blasterHits >= DEF.blasterStunHits) {
          h.blasterHits = 0;
          h.stunUntil = t + DEF.blasterStunSec;
          h.stunFrom = [d.x, d.y];
          if (owner) { owner.stats.score += 5; this.cashDelta(owner, 10, 'Rizz Blaster stun'); }
          this.feed.push({ k: 'info', text: `${owner?.name ?? 'A'}'s Rizz Blaster foamed ${h.name}` });
        }
      } else if (d.k === 'lamp') {
        if (!this.ev.power) continue; // no power, no light
        d.cd = DEFENCE.lamp.every[lv - 1];
        d.shotT = t; d.tx = h.x; d.ty = h.y;
        h.stunUntil = t + MOG_STUN_SEC;
        h.stunFrom = [d.x, d.y];
        if (owner) { owner.stats.mogs++; owner.stats.score += 8; this.cashDelta(owner, 10, 'Aura Lamp mog'); }
        this.feed.push({ k: 'mog', a: `${owner?.name ?? 'An'}'s Aura Lamp`, b: h.name });
      } else if (d.k === 'bass') {
        d.cd = DEFENCE.bass.every[lv - 1];
        d.shotT = t; d.tx = d.x; d.ty = d.y;
        for (const x of targets) { x.stunUntil = t + DEF.bassStunSec; x.stunFrom = [d.x, d.y]; }
        this.noise(d.x, d.y, DEF.bassNoise, null, 'bass');
      }
    }
  }

  private stepProps(t: number) {
    this.props = this.props.filter((pr) => t < pr.until);
    const hunters: Array<{ x: number; y: number; name: string; stunUntil: number; stunFrom: [number, number] }> = this.hunters();
    for (const pr of [...this.props]) {
      if (pr.k === 'decoy') {
        if ((pr.noiseT -= DT) <= 0) { pr.noiseT = 0.8; this.noise(pr.x, pr.y, ITEM.decoyNoise, null, 'decoy'); }
        continue;
      }
      const h = hunters.find((m) => t >= m.stunUntil && dist(m.x, m.y, pr.x, pr.y) < 0.7);
      if (!h) continue;
      h.stunUntil = t + ITEM.trapStunSec;
      h.stunFrom = [pr.x, pr.y];
      this.props.splice(this.props.indexOf(pr), 1);
      const owner = this.players.get(pr.owner);
      this.feed.push({ k: 'info', text: `${h.name} slipped on ${owner ? owner.name + "'s" : 'a'} banana peel` });
      if (owner) { owner.stats.score += 10; this.cashDelta(owner, CASH.mog, 'banana stun'); }
    }
  }

  private auraDelta(p: Player, d: number, why: string) {
    const before = p.aura;
    p.aura = Math.max(0, Math.min(AURA.max, p.aura + d));
    const real = Math.round(p.aura - before);
    if (real !== 0 || d < 0) this.sendTo(p, { t: 'aura', d: real || d, why });
  }


  private hitDoor(plot: number, side: DoorSide, dmg: number, by: string, stats: RoundStats) {
    const c = this.cribs.get(plot);
    if (!c) return;
    const d = c.doors[side];
    if (d.hp <= 0) return;
    d.hp = Math.max(0, d.hp - dmg);
    if (d.hp === 0) {
      d.open = false;
      stats.score += 5;
      const smasher = [...this.players.values()].find((q) => q.name === by && q.role === 'opp');
      if (smasher) this.cashDelta(smasher, CASH.smash, 'smashed a door');
      this.feed.push({ k: 'smash', a: by, b: `${c.ownerName}'s ${side === 0 ? 'front' : 'back'} door` });
    }
  }

  private setPhase(phase: Phase) {
    this.phase = phase;
    const t = now();
    if (phase === 'pregame') {
      this.reset();
      this.phaseEnd = t + this.phaseSec.pregame;
      this.systemChat('Pregame: walk into any free crib to make it yours, then grab cash. The Opps come out soon.');
    } else if (phase === 'lockin') {
      this.night++;
      this.assignHomeless();
      this.phaseEnd = t + this.phaseSec.lockin;
      this.ev.nextAt = t + EVENTS.firstAfterSec;
      for (const p of this.oppPlayers) [p.x, p.y] = this.edgeSpawn();
      this.adjustBots();
      this.adjustAis(true);
      this.feed.push({ k: 'info', text: 'LOCK IN. The Opps are out.' });
    } else if (phase === 'touchgrass') {
      this.phaseEnd = t + this.phaseSec.touchgrass;
    } else {
      this.phaseEnd = 0;
      this.reset();
    }
  }

  private reset() {
    this.ais = [];
    this.knocks.clear();
    this.noises = [];
    this.ev = { power: true, mode: null, modeEnd: 0, nextAt: 0 };
    // enforce the 4:1 ratio for player Opps between nights
    for (const p of this.oppPlayers) {
      if (!this.canBeOpp(p.id)) {
        p.role = 'bro';
        p.wantOpp = true;
        this.ensureRoom();
        this.systemChat(`${p.name} is back to being a bro (not enough bros for another Opp).`);
      }
    }
    // then fill open slots from the queue, and top up the bot bros
    for (const p of [...this.players.values()]) {
      if (p.wantOpp && p.role === 'bro' && this.canBeOpp(p.id)) this.setRole(p, 'opp');
    }
    this.adjustBots();
    this.props = [];
    for (const d of this.defs) d.hp = DEF.hp;
    for (const c of this.cribs.values()) for (const d of c.doors) { d.hp = DOOR_LEVEL_HP[c.level]; d.open = false; d.openUntil = 0; }
    for (const p of this.players.values()) {
      this.spawn(p);
      p.aura = AURA.start;
      p.stats = freshStats();
      p.jump = freshJump();
      p.shields = GEAR.vest[p.vest].shields;
      p.shieldUntil = 0;
      p.drinkUntil = 0;
      p.bribeUntil = 0;
      p.screechCd = 0;
      p.lungeCd = 0;
      p.ventCd = 0;
      p.ventT = 0;
      p.lungeT = 0;
    }
  }

  private finishNight(win: boolean) {
    const ranked = [...this.players.values()].sort((a, b) => b.stats.score - a.stats.score);
    const mvp = ranked[0]?.stats.score ? ranked[0].name : undefined;
    for (const p of this.players.values()) {
      if (p.bot) continue;
      if (p.role === 'bro') {
        this.hooks.onStats(p.id, { nights: 1, wins: win ? 1 : 0, mogs: p.stats.mogs, revives: p.stats.revives });
      } else {
        this.hooks.onStats(p.id, { nights: 1, wins: win ? 0 : 1, catches: p.stats.catches });
      }
    }
    if (win) for (const p of this.bros) if (!p.npc) this.cashDelta(p, CASH.surviveNight, 'survived the night');
    this.broadcast({ t: 'result', win, night: this.night, mvp });
    this.broadcast({ t: 'scores', rows: this.scoreRows() });
    this.feed.push({ k: 'info', text: win ? 'W. The bros touched grass.' : 'L + ratio. The Opps won.' });
    this.setPhase('touchgrass');
  }

  private adjustAis(initial = false) {
    const want = Math.max(0, Math.ceil(this.bros.length / BROS_PER_MONSTER) - this.oppPlayers.length);
    while (this.ais.length < want) {
      const [x, y] = this.edgeSpawn();
      const n = aiSeq++;
      this.ais.push({
        id: `ai-${n}`, name: `Opp #${this.ais.length + 1}`, x, y, path: [], goal: null, chase: null, chaseUntil: 0,
        replanAt: 0, stunUntil: 0, stunFrom: [0, 0], smashNoiseT: 0, hunchAt: now() + 6 + Math.random() * 6, ventCd: 4, ventT: 0, ventPlan: null,
        stats: freshStats(),
      });
      if (!initial) this.feed.push({ k: 'info', text: 'Another Opp crawled out.' });
    }
    if (this.ais.length > want) this.ais.length = want;
  }

  private tick() {
    const t = now();
    this.tickN++;

    // drop players whose reconnect window ran out
    for (const p of [...this.players.values()]) {
      if (!p.ws && p.leftAt && t - p.leftAt > RECONNECT_GRACE_SEC) this.drop(p);
    }
    if (this.humanCount === 0) {
      if (!this.emptySince) this.emptySince = t;
      this.hooks.onEmpty(this);
      if (this.phase !== 'lobby' && !this.quick) return;
    }

    this.stepPhase(t);
    this.stepEvents(t);
    this.stepBots(t);
    this.stepPlayers(t);
    this.stepClaims();
    if (this.phase === 'lockin') this.stepAis(t);
    this.stepDoors(t);
    this.stepDrops(t);
    this.stepProps(t);
    this.stepDefs(t);
    this.stepKnocks(t);
    this.noises = this.noises.filter((n) => t - n.t < NOISE.lifeSec);

    if (this.tickN % (TICK_RATE * 2) === 0) this.broadcast({ t: 'ping', at: Date.now() });
    this.sendSnapshots();
    if (this.feed.length) {
      this.broadcast({ t: 'feed', items: this.feed });
      this.feed = [];
    }
  }

  private stepPhase(t: number) {
    if (this.phase === 'lobby') return;
    if (this.phase === 'lockin') {
      const bros = this.bros;
      if (bros.length > 0 && bros.every((p) => p.npc)) return this.finishNight(false);
      if (t >= this.phaseEnd) return this.finishNight(true);
      if ((this.aiAdjustT -= DT) <= 0) { this.aiAdjustT = 1; this.adjustAis(); }
      return;
    }
    if (t < this.phaseEnd) return;
    if (this.phase === 'pregame') this.setPhase('lockin');
    else if (this.phase === 'touchgrass') this.setPhase(this.quick ? 'pregame' : 'lobby');
  }

  private stepEvents(t: number) {
    const ev = this.ev;
    if (ev.mode && t >= ev.modeEnd) this.endMode();
    if (this.phase !== 'lockin' || ev.mode || t < ev.nextAt) return;
    ev.nextAt = t + EVENTS.gapMinSec + Math.random() * (EVENTS.gapMaxSec - EVENTS.gapMinSec);
    const options: Array<ModeName | 'aurarain'> = ['blackout', 'blackout', 'fog', 'lowgrav', 'disco', 'aurarain'];
    if (this.ais.length + this.oppPlayers.length > 0) options.push('rage');
    const pick = options[Math.floor(Math.random() * options.length)];
    if (pick === 'aurarain') {
      for (let i = 0; i < EVENTS.auraRainDrops; i++) {
        const [x, y] = this.randomStreet();
        this.drops.push({ id: dropSeq++, x, y, k: 'aura' });
      }
      this.feed.push({ k: 'event', text: 'AURA RAIN! Free aura in the streets.' });
      return;
    }
    ev.mode = pick;
    ev.modeEnd = t + EVENTS.minSec + Math.random() * (EVENTS.maxSec - EVENTS.minSec);
    const text: Record<ModeName, string> = {
      blackout: 'POWER CUT! Lights out, lamps and aura lamps are dead. Stay quiet till it comes back.',
      fog: 'OHIO FOG rolled in. You can barely see.',
      rage: 'OPP RAGE. They are tweaking: way faster.',
      lowgrav: 'LOW GRAVITY. Jumps go way higher.',
      disco: 'DISCO MODE. The music confuses the Opps: they hear less.',
    };
    if (pick === 'blackout') ev.power = false;
    this.feed.push({ k: 'event', text: text[pick] });
  }

  private endMode() {
    const was = this.ev.mode;
    this.ev.mode = null;
    this.ev.modeEnd = 0;
    if (was === 'blackout') this.restorePower();
  }

  private restorePower() {
    this.ev.power = true;
    this.feed.push({ k: 'event', text: 'Power came back on.' });
  }

  private stepPlayers(t: number) {
    const rage = this.ev.mode === 'rage';
    for (const p of this.players.values()) {
      p.smashCd = Math.max(0, p.smashCd - DT);
      p.screechCd = Math.max(0, p.screechCd - DT);
      p.lungeCd = Math.max(0, p.lungeCd - DT);
      p.lungeT = Math.max(0, p.lungeT - DT);
      const { dx, dy, zoom } = p.input;
      const moving = dx !== 0 || dy !== 0;

      if (p.role === 'opp') {
        if (this.stepVent(p, p.id)) continue;
        if (t < p.stunUntil) {
          const a = Math.atan2(p.y - p.stunFrom[1], p.x - p.stunFrom[0]);
          [p.x, p.y] = move(p.x, p.y, Math.cos(a) * 2 * DT, Math.sin(a) * 2 * DT, this.R, this.doorLookup);
          continue;
        }
        if (this.phase !== 'lockin') {
          if (moving) [p.x, p.y] = move(p.x, p.y, dx * SPEED.walk * DT, dy * SPEED.walk * DT, this.R, this.doorLookup);
          continue;
        }
        const sp = SPEED.monsterPlayer * (rage ? EVENTS.rageSpeed : 1) * (this.ev.power ? 1 : 1.1) * (p.lungeT > 0 ? MONSTER.lungeSpeed : 1);
        if (moving) [p.x, p.y] = move(p.x, p.y, dx * sp * DT, dy * sp * DT, this.R, this.doorLookup);
        this.hunterChecks(p, t);
        continue;
      }

      // bro / npc
      if (p.npc) {
        if (moving) [p.x, p.y] = move(p.x, p.y, dx * SPEED.npc * DT, dy * SPEED.npc * DT, this.R, this.doorLookup, { ghost: true });
        continue;
      }
      if (stepJump(p.jump, DT, this.ev.mode === 'lowgrav', overFence(p.x, p.y, this.R))) {
        this.noise(p.x, p.y, JUMP.landNoise, p.id, 'land');
      }
      const airborne = isAirborne(p.jump);
      const sneak = p.input.sneak;
      const sp = (zoom ? SPEED.zoom : sneak ? SPEED.sneak : SPEED.walk) * (t < p.drinkUntil ? ITEM.drinkSpeed : 1) * kicksSpeed(p.kicks);
      if (moving) {
        [p.x, p.y] = move(p.x, p.y, dx * sp * DT, dy * sp * DT, this.R, this.doorLookup, { airborne });
        if ((p.stepT -= DT) <= 0 && !airborne) {
          p.stepT = zoom ? 0.3 : sneak ? 0.7 : 0.45;
          this.noise(p.x, p.y, zoom ? NOISE.zoom : sneak ? NOISE.sneak : NOISE.walk, p.id, zoom ? 'zoom' : 'step');
        }
      }
      if (p.light) {
        p.aura = Math.max(0, p.aura - AURA.burnPerSec * DT);
        if (p.aura <= 0) p.light = false;
      }
      if (p.repairing) this.repair(p, t);
    }

    // passive income for staying alive through the night
    if (this.phase === 'lockin') {
      for (const p of this.bros) {
        if (p.npc) continue;
        p.cashT += DT * CASH.perSecAlive;
        if (p.cashT >= 1) { const whole = Math.floor(p.cashT); p.cashT -= whole; this.cashDelta(p, whole, '', true); }
      }
    }
    for (const c of this.cribs.values()) {
      if (!c.autorepair) continue;
      const max = DOOR_LEVEL_HP[c.level];
      for (const d of c.doors) if (d.hp > 0 && d.hp < max) d.hp = Math.min(max, d.hp + ITEM.autoRepairPerSec * DT);
    }

    // revive NPCs that have a living bro standing next to them
    for (const p of this.players.values()) {
      if (!p.npc) continue;
      const helper = this.bros.find((q) => !q.npc && dist(q.x, q.y, p.x, p.y) < REVIVE_RANGE);
      if (helper) {
        p.rv += DT / REVIVE_SEC;
        if (p.rv >= 1) {
          p.npc = false;
          p.rv = 0;
          helper.stats.revives++;
          helper.stats.score += 15;
          this.auraDelta(helper, AURA_DELTA.revive, 'revived a bro');
          this.cashDelta(helper, CASH.revive, 'revived a bro');
          this.feed.push({ k: 'revive', a: helper.name, b: p.name });
        }
      } else {
        p.rv = Math.max(0, p.rv - DT / REVIVE_SEC);
      }
    }
  }

  private repair(p: Player, t: number) {
    if (p.crib < 0) return;
    const mine = this.defs.find((d) => d.owner === p.id && d.hp < DEF.hp && dist(d.x, d.y, p.x, p.y) < 1.5);
    if (mine) {
      mine.hp = Math.min(DEF.hp, mine.hp + DEF.repairPerSec * DT);
      this.makeRepairNoise(p);
      return;
    }
    const crib = this.cribs.get(p.crib);
    if (!crib) return;
    for (const side of [0, 1] as DoorSide[]) {
      const [dx, dy] = doorCenter(p.crib, side);
      const d = crib.doors[side];
      const max = DOOR_LEVEL_HP[crib.level];
      if (dist(p.x, p.y, dx, dy) < 1.9 && d.hp < max) {
        const was = d.hp;
        d.hp = Math.min(max, d.hp + DOOR.repairPerSec * DT);
        if (was <= 0) { d.open = false; d.openUntil = 0; }
        p.stats.score += (d.hp - was) / 20;
        this.makeRepairNoise(p);
        return;
      }
    }
  }

  private makeRepairNoise(p: Player) {
    if ((p.repairNoiseT -= DT) <= 0) {
      p.repairNoiseT = 0.5;
      this.noise(p.x, p.y, NOISE.repair, p.id, 'repair');
    }
  }

  /** Ring-light mogs and catches, for both AI and player Opps. */
  private hunterChecks(h: { x: number; y: number; name: string; stunUntil: number; stunFrom: [number, number]; stats: RoundStats }, t: number) {
    if (t < h.stunUntil) return;
    for (const b of this.bros) {
      if (b.npc || !b.light || b.aura <= 0) continue;
      if (dist(h.x, h.y, b.x, b.y) < RING_LIGHT_RANGE) {
        h.stunUntil = t + MOG_STUN_SEC;
        h.stunFrom = [b.x, b.y];
        this.auraDelta(b, -AURA.mogCost + AURA_DELTA.mogBonus, 'ring light mog');
        this.cashDelta(b, CASH.mog, 'mogged an Opp');
        if (b.aura <= 0) b.light = false;
        b.stats.mogs++;
        b.stats.score += 10;
        this.noise(h.x, h.y, NOISE.mog, null, 'mog');
        this.feed.push({ k: 'mog', a: b.name, b: h.name });
        return;
      }
    }
    for (const b of this.bros) {
      if (b.npc || isAirborne(b.jump) || t < b.bribeUntil || t < b.shieldUntil) continue; // mid-air, bribed or just-shielded bros can't be grabbed
      if (dist(h.x, h.y, b.x, b.y) < CATCH_RANGE) {
        if (b.shields > 0) {
          // body armour eats the grab and knocks the Opp back
          b.shields--;
          b.shieldUntil = t + GEAR.shieldSafeSec;
          h.stunUntil = t + GEAR.shieldStunSec;
          h.stunFrom = [b.x, b.y];
          this.noise(b.x, b.y, NOISE.mog, b.id, 'mog');
          this.feed.push({ k: 'info', text: `${b.name}'s armour blocked ${h.name}! (${b.shields} left)` });
          continue;
        }
        b.npc = true;
        b.light = false;
        b.rv = 0;
        this.auraDelta(b, -Math.round(b.aura / 2), 'got caught lackin');
        b.stats.caught++;
        h.stats.catches++;
        h.stats.score += 20;
        const hp = this.players.get((h as { id?: string }).id ?? '');
        if (hp) this.cashDelta(hp, CASH.catch, 'caught a bro lackin');
        this.feed.push({ k: 'caught', a: h.name, b: b.name });
        this.knocksFrom(b.id);
      }
    }
  }

  private knocksFrom(id: string) {
    for (const [kid, k] of this.knocks) {
      if (k.from === id) {
        this.knocks.delete(kid);
        const owner = this.players.get(k.owner);
        if (owner) this.sendTo(owner, { t: 'knockDone', id: kid });
      }
    }
  }

  private stepAis(t: number) {
    const rage = this.ev.mode === 'rage';
    const minute = Math.max(0, (this.phaseSec.lockin - (this.phaseEnd - t)) / 60);
    const base = Math.min(SPEED.monsterAiMax, SPEED.monsterAi + minute * 0.18);
    const speed = base * (rage ? EVENTS.rageSpeed : 1) * (this.ev.power ? 1 : 1.1);
    for (const ai of this.ais) {
      if (this.stepVent(ai, null)) continue;
      if (ai.ventPlan && dist(ai.x, ai.y, ai.ventPlan.a[0], ai.ventPlan.a[1]) < VENT.useRange * 0.8) {
        const plan = ai.ventPlan;
        ai.ventPlan = null;
        if (this.startVent(ai, plan.b, null)) { ai.path = []; ai.replanAt = t + VENT.travelSec; continue; }
      }
      if (t < ai.stunUntil) {
        const a = Math.atan2(ai.y - ai.stunFrom[1], ai.x - ai.stunFrom[0]);
        [ai.x, ai.y] = move(ai.x, ai.y, Math.cos(a) * 2.2 * DT, Math.sin(a) * 2.2 * DT, this.R, this.doorLookup);
        ai.path = [];
        continue;
      }
      if (t >= ai.replanAt) this.planAi(ai, t);
      this.followPath(ai, speed);
      this.hunterChecks(ai, t);
    }
  }

  private planAi(ai: Ai, t: number) {
    ai.replanAt = t + 0.4;
    const alive = this.bros.filter((b) => !b.npc && t >= b.bribeUntil);
    let goal: [number, number] | null = null;

    // 1. something right next to it
    const close = alive.filter((b) => dist(b.x, b.y, ai.x, ai.y) < 2.4).sort((a, b) => dist(a.x, a.y, ai.x, ai.y) - dist(b.x, b.y, ai.x, ai.y))[0];
    if (close) { ai.chase = close.id; ai.chaseUntil = t + 3; }

    // 2. the loudest thing it can hear
    if (!close) {
      let bestScore = 0;
      for (const n of this.noises) {
        const d = dist(n.x, n.y, ai.x, ai.y);
        if (d > (this.ev.mode === 'disco' ? n.r * 0.5 : n.r) + 0.5) continue;
        const score = n.r / (1 + d) + (t - n.t < 0.6 ? 1 : 0);
        if (score > bestScore) {
          bestScore = score;
          goal = [n.x, n.y];
          const src = n.src ? this.players.get(n.src) : undefined;
          if (src && src.role === 'bro' && !src.npc && t >= src.bribeUntil) { ai.chase = src.id; ai.chaseUntil = t + 2.5; }
        }
      }
    }

    if (ai.chase && t < ai.chaseUntil) {
      const b = this.players.get(ai.chase);
      if (b && !b.npc && t >= b.bribeUntil) goal = [b.x, b.y];
      else ai.chase = null;
    }

    // 3. a hunch: drift toward a random bro every so often, else wander
    if (!goal) {
      if (t >= ai.hunchAt && alive.length) {
        ai.hunchAt = t + 9 + Math.random() * 8;
        const b = alive[Math.floor(Math.random() * alive.length)];
        ai.goal = [b.x + (Math.random() - 0.5) * 6, b.y + (Math.random() - 0.5) * 6];
      } else if (!ai.goal || dist(ai.x, ai.y, ai.goal[0], ai.goal[1]) < 1.2) {
        ai.goal = this.randomStreet();
      }
      goal = ai.goal;
    }

    // a long way to go? take the vents if that saves real distance
    ai.ventPlan = null;
    const far = dist(ai.x, ai.y, goal[0], goal[1]);
    if (ai.ventCd <= 0 && far > PLOT * 1.5) {
      const a = this.nearestVent(ai.x, ai.y);
      const g = goal;
      const b = a && ventsFor(this.R)
        .filter((v) => dist(v[0], v[1], a[0], a[1]) <= VENT.maxHop * PLOT * 1.45 && dist(v[0], v[1], a[0], a[1]) > 1)
        .sort((u, v) => dist(u[0], u[1], g[0], g[1]) - dist(v[0], v[1], g[0], g[1]))[0];
      if (a && b && dist(ai.x, ai.y, a[0], a[1]) + dist(b[0], b[1], g[0], g[1]) < far - VENT.aiMinGain) {
        ai.ventPlan = { a, b };
        goal = a;
      }
    }
    const res = findPath(Math.floor(ai.x), Math.floor(ai.y), Math.floor(goal[0]), Math.floor(goal[1]), this.R, this.doorLookup);
    ai.path = res ? res.cells : [];
  }

  private followPath(ai: Ai, speed: number) {
    while (ai.path.length) {
      const [cx, cy] = ai.path[0];
      if (dist(ai.x, ai.y, cx + 0.5, cy + 0.5) < 0.35) ai.path.shift();
      else break;
    }
    if (!ai.path.length) return;
    const [cx, cy] = ai.path[0];
    const c = cellAt(cx, cy, this.R);
    if (c.kind === 'door') {
      const door = this.doorLookup(c.plot, c.side!);
      if (doorBlocks(door)) {
        const [dx, dy] = doorCenter(c.plot, c.side!);
        if (dist(ai.x, ai.y, dx, dy) < 1.5) {
          this.hitDoor(c.plot, c.side!, DOOR.aiDamagePerSec * DT, ai.name, ai.stats);
          if ((ai.smashNoiseT -= DT) <= 0) { ai.smashNoiseT = 0.5; this.noise(dx, dy, NOISE.smash, null, 'smash'); }
          return;
        }
      }
    }
    const tx = cx + 0.5, ty = cy + 0.5;
    const a = Math.atan2(ty - ai.y, tx - ai.x);
    const step = Math.min(speed * DT, dist(ai.x, ai.y, tx, ty));
    const [nx, ny] = move(ai.x, ai.y, Math.cos(a) * step, Math.sin(a) * step, this.R, this.doorLookup);
    if (nx === ai.x && ny === ai.y) ai.replanAt = 0; // stuck: replan next tick
    ai.x = nx; ai.y = ny;
  }

  private stepDoors(t: number) {
    const ents: Array<{ x: number; y: number }> = [...this.players.values(), ...this.ais];
    for (const [plot, c] of this.cribs) {
      for (const side of [0, 1] as DoorSide[]) {
        const d = c.doors[side];
        if (!d.open || t < d.openUntil) continue;
        const cells = doorCells(plot, side);
        const blocked = ents.some((e) => cells.some(([cx, cy]) => e.x > cx - 0.4 && e.x < cx + 1.4 && e.y > cy - 0.4 && e.y < cy + 1.4));
        if (blocked) d.openUntil = t + 0.3;
        else d.open = false;
      }
    }
  }

  private stepDrops(_t: number) {
    const target = Math.min(80, 4 + this.bros.length * 2);
    if ((this.dropT -= DT) <= 0) {
      this.dropT = 5;
      if (this.drops.length < target) {
        const [x, y] = this.randomStreet();
        this.drops.push({ id: dropSeq++, x, y, k: Math.random() < 0.5 ? 'cash' : 'aura' });
      }
    }
    for (const b of this.bros) {
      if (b.npc) continue;
      const i = this.drops.findIndex((d) => dist(d.x, d.y, b.x, b.y) < 0.8 && (d.k === 'cash' || b.aura < AURA.max));
      if (i >= 0) {
        const d = this.drops.splice(i, 1)[0];
        if (d.k === 'cash') this.cashDelta(b, CASH.drop, 'cash pickup');
        else this.auraDelta(b, AURA.drop, 'aura drop');
      }
    }
  }

  private stepKnocks(t: number) {
    for (const [id, k] of this.knocks) {
      if (t < k.expires) continue;
      this.knocks.delete(id);
      const from = this.players.get(k.from);
      const owner = this.players.get(k.owner);
      if (owner) this.sendTo(owner, { t: 'knockDone', id });
      if (from) this.sendTo(from, { t: 'chat', from: 'server', role: 'bro', sys: true, text: `${owner?.name ?? 'They'} didn't answer. The door stays locked.` });
    }
  }

  // ---------- views ----------

  private selfView(p: Player): SelfView {
    const crib = p.crib >= 0 ? this.cribs.get(p.crib) : undefined;
    const t = now();
    return {
      id: p.id, role: p.role, aura: Math.round(p.aura), crib: p.crib, cash: p.cash, inv: { ...p.inv },
      armor: crib?.level ?? 0, autorepair: !!crib?.autorepair, kicks: p.kicks, vest: p.vest, shields: p.shields,
      drink: Math.max(0, Math.ceil(p.drinkUntil - t)), bribe: Math.max(0, Math.ceil(p.bribeUntil - t)),
      defLv: crib ? { ...crib.defLv } : { blaster: 1, lamp: 1, bass: 1 },
      defCount: this.defs.filter((d) => d.plot === p.crib).length,
      wantOpp: p.wantOpp || undefined,
      ...(p.role === 'opp' ? {
        scr: +p.screechCd.toFixed(1), lun: +p.lungeCd.toFixed(1), vcd: +p.ventCd.toFixed(1), vnt: p.ventT > 0 ? +p.ventT.toFixed(1) : undefined,
        sense: this.phase === 'lockin' ? this.sense(p, t) : 0,
      } : {}),
    };
  }

  /** Heartbeat for the hunter: 0 = nobody near, 1 = a bro is right there. */
  private sense(p: Player, t: number): number {
    let d = Infinity;
    for (const b of this.bros) if (!b.npc && t >= b.bribeUntil) d = Math.min(d, dist(b.x, b.y, p.x, p.y));
    return d >= MONSTER.senseRange ? 0 : +(1 - d / MONSTER.senseRange).toFixed(2);
  }

  private lobbyInfo(): LobbyInfo {
    const host = this.hostId ? this.players.get(this.hostId) : undefined;
    return { code: this.code, name: this.name, private: this.isPrivate, quick: this.quick, host: this.hostId, hostName: host?.name };
  }

  scoreRows(): ScoreRow[] {
    const rows: ScoreRow[] = [...this.players.values()].map((p) => ({
      id: p.id, n: p.name, role: p.role, alive: p.role === 'opp' || !p.npc, score: Math.round(p.stats.score),
      catches: p.stats.catches, mogs: p.stats.mogs, revives: p.stats.revives, letIns: p.stats.letIns,
      caught: p.stats.caught, ping: p.bot ? 0 : p.ws ? p.ping : -1, ai: p.bot || undefined,
    }));
    for (const ai of this.ais) {
      rows.push({
        id: ai.id, n: ai.name, role: 'opp', alive: true, score: Math.round(ai.stats.score), catches: ai.stats.catches,
        mogs: 0, revives: 0, letIns: 0, caught: 0, ping: 0, ai: true,
      });
    }
    return rows.sort((a, b) => b.score - a.score);
  }

  private cribViews(): CribView[] {
    const out: CribView[] = [];
    for (const [i, c] of this.cribs) {
      if (!c.owner) continue;
      out.push({
        i, owner: c.owner, ownerName: c.ownerName, max: DOOR_LEVEL_HP[c.level],
        doors: [
          { hp: Math.round(c.doors[0].hp), open: c.doors[0].open },
          { hp: Math.round(c.doors[1].hp), open: c.doors[1].open },
        ],
      });
    }
    return out;
  }

  private sendSnapshots() {
    const t = now();
    const fog = this.ev.mode === 'fog';
    const sendCribs = this.tickN % 4 === 0;
    const sendDrops = this.tickN % 10 === 0;
    const cribs = sendCribs ? this.cribViews() : undefined;

    const all: Array<EntView & { lit: boolean }> = [];
    for (const p of this.players.values()) {
      const z = p.jump.z;
      all.push({
        id: p.id, k: p.role === 'opp' ? 'opp' : p.npc ? 'npc' : 'bro', x: +p.x.toFixed(2), y: +p.y.toFixed(2), n: p.name,
        l: p.light ? 1 : undefined, st: t < p.stunUntil ? 1 : undefined, rv: p.npc && p.rv > 0 ? +p.rv.toFixed(2) : undefined,
        c: p.hue, z: z > 0 ? +z.toFixed(2) : undefined, lit: p.light && !p.npc, ai: p.bot ? 1 : undefined,
        gk: p.kicks || undefined, gv: p.vest || undefined, sh: t < p.shieldUntil ? 1 : undefined,
        vt: p.ventT > 0 ? 1 : undefined,
      });
    }
    for (const ai of this.ais) {
      if (ai.ventT > 0) continue;
      all.push({ id: ai.id, k: 'opp', x: +ai.x.toFixed(2), y: +ai.y.toFixed(2), n: ai.name, ai: 1, st: t < ai.stunUntil ? 1 : undefined, lit: false });
    }
    const litBros = all.filter((e) => e.lit);
    const alive = this.bros.filter((b) => !b.npc).length;
    const counts = { bros: this.bros.length, alive, opps: this.ais.length + this.oppPlayers.length };
    const ev = {
      power: this.ev.power, fog,
      rage: this.ev.mode === 'rage', lowgrav: this.ev.mode === 'lowgrav', disco: this.ev.mode === 'disco',
      mode: this.ev.mode, modeEnd: Math.round(this.ev.modeEnd * 1000),
    };
    const lobby = this.lobbyInfo();

    for (const p of this.players.values()) {
      if (!p.ws || p.ws.readyState !== 1) continue;
      const monster = p.role === 'opp';
      let vision = p.light ? VISION.lit : VISION.dark;
      if (fog) vision *= 0.6;
      if (!this.ev.power) vision *= 0.85;
      const ents: EntView[] = [];
      for (const e of all) {
        const d = dist(e.x, e.y, p.x, p.y);
        if (d > INTEREST_RADIUS) continue;
        if (e.id !== p.id) {
          if (e.vt) continue; // nobody sees an Opp in the vents
          if (monster) {
            // Opps are blind: they sense bros up close or see their ring lights
            if (e.k === 'npc') continue;
            if (e.k === 'bro' && d > VISION.monster && !e.lit) continue;
          } else if (e.k === 'opp') {
            const seen = d <= vision || litBros.some((b) => dist(b.x, b.y, e.x, e.y) < 5);
            if (!seen) continue;
          }
        }
        const { lit: _lit, ...view } = e;
        ents.push(view);
      }
      const noises: NoiseView[] = this.noises
        .filter((n) => dist(n.x, n.y, p.x, p.y) < INTEREST_RADIUS)
        .map((n) => ({ id: n.id, x: +n.x.toFixed(1), y: +n.y.toFixed(1), r: n.r, k: n.k }));
      const drops: DropView[] | undefined = sendDrops && !monster
        ? this.drops.filter((d) => dist(d.x, d.y, p.x, p.y) < INTEREST_RADIUS).map((d) => ({ id: d.id, x: d.x, y: d.y, k: d.k }))
        : sendDrops ? [] : undefined;
      this.sendTo(p, {
        t: 'snap', now: Date.now(), phase: this.phase, phaseEnd: Math.round(this.phaseEnd * 1000), R: this.R, night: this.night,
        you: this.selfView(p), ents, cribs, noises, drops, counts, lobby, ev,
        defs: this.defs
          .filter((d) => dist(d.x, d.y, p.x, p.y) < INTEREST_RADIUS)
          .map((d): DefView => ({
            id: d.id, k: d.k, x: +d.x.toFixed(2), y: +d.y.toFixed(2), hp: Math.round((d.hp / DEF.hp) * 100),
            lv: this.cribs.get(d.plot)?.defLv[d.k] ?? 1, own: d.owner === p.id ? 1 : undefined,
            tx: t - d.shotT < 0.2 ? +d.tx.toFixed(2) : undefined, ty: t - d.shotT < 0.2 ? +d.ty.toFixed(2) : undefined,
            off: d.k === 'lamp' && !this.ev.power ? 1 : undefined,
          })),
        props: this.props
          .filter((pr) => dist(pr.x, pr.y, p.x, p.y) < INTEREST_RADIUS && (!monster || pr.k === 'decoy'))
          .map((pr): PropView => ({ id: pr.id, k: pr.k, x: +pr.x.toFixed(2), y: +pr.y.toFixed(2) })),
      });
    }
  }

  sendTo(p: Player, msg: ServerMsg) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.ws && p.ws.readyState === 1) p.ws.send(data);
  }

  listing() {
    return { code: this.code, name: this.name, players: this.players.size, phase: this.phase, quick: this.quick };
  }
}

export { plotCenter };
