import './style.css';
import { api, getToken, loadTurnstile, setToken, solvePow, type Account } from './api.ts';
import { Renderer } from './render.ts';
import { Creator } from './creator.ts';
import { encodeLook, type Look } from '../../shared/look.ts';
import { Hud } from './hud.ts';
import { Input, type Action } from './input.ts';
import { chant, sfx } from './audio.ts';
import { EVENTS, ITEM, MONSTER, SPEED } from '../../shared/constants.ts';
import { airborne, freshJump, kicksSpeed, stepJump, tryJump } from '../../shared/gear.ts';
import {
  cellAt, cribAtPos, dist, doorBlocks, doorCenter, move, overFence, type CribView, type DoorSide,
} from '../../shared/world.ts';
import type { ClientMsg, EntView, LobbyInfo, Phase, Role, ServerMsg, WorldEvents } from '../../shared/protocol.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ls = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

let account: Account | null = null;
let game: Game | null = null;
const renderer = new Renderer($('game'));
const hud = new Hud();
const input = new Input();
const creator = new Creator();

// ======================================================================
// Game session
// ======================================================================

interface Snap { recv: number; ents: Map<string, EntView> }

interface JoinOpts { mode: 'quick' | 'create' | 'join'; code?: string; name?: string; priv?: boolean; role: Role }

class Game {
  ws: WebSocket;
  selfId = '';
  role: Role = 'bro';
  myCrib = -1;
  aura = 0;
  phase: Phase = 'pregame';
  phaseEnd = 0;
  night = 0;
  R = 1;
  ev: WorldEvents = { power: true, fog: false, rage: false, lowgrav: false, disco: false, mode: null, modeEnd: 0 };
  lobby: LobbyInfo | null = null;
  counts = { bros: 0, alive: 0, opps: 0 };
  cribs = new Map<number, CribView>();
  snaps: Snap[] = [];
  me = { x: 0, y: 0, jump: freshJump(), init: false };
  kicks = 0;
  npc = false;
  stunned = false;
  lightOn = false;
  drink = 0;
  lastSent = '';
  lastSentAt = 0;
  scoresOpen = false;
  scoreTimer = 0;
  closed = false;
  lastPop = 0;
  raf = 0;
  // playing as an Opp
  sense = 0;
  lunCd = 0;
  lungeT = 0;
  lastBeat = 0;
  sounds: Array<{ x: number; y: number; r: number; born: number }> = [];

  constructor(opts: JoinOpts) {
    const q = new URLSearchParams({ token: getToken() ?? '', mode: opts.mode, role: opts.role });
    if (opts.code) q.set('code', opts.code.toUpperCase());
    if (opts.name) q.set('name', opts.name);
    if (opts.priv) q.set('priv', '1');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
    this.ws.onmessage = (e) => this.onMsg(JSON.parse(e.data));
    this.ws.onclose = (e) => this.onClose(e);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  send(m: ClientMsg) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  leave() {
    this.closed = true;
    cancelAnimationFrame(this.raf);
    this.ws.close();
  }

  private onClose(e: CloseEvent) {
    cancelAnimationFrame(this.raf);
    if (this.closed) return;
    this.closed = true;
    const reasons: Record<number, string> = { 4001: 'Your device sign-in expired. Reload the page.', 4004: 'No lobby with that code.' };
    showMenu(reasons[e.code] ?? (e.reason || 'Disconnected from the server.'));
  }

  private onMsg(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        this.selfId = m.you.id;
        this.role = m.you.role;
        this.myCrib = m.you.crib;
        hud.myName = account?.name ?? '';
        if (m.notice) hud.chat('server', 'bro', m.notice, true);
        hud.chat('server', 'bro', 'Press Enter to chat, Tab for scores, H for controls.', true);
        hud.intro(12, m.you.role === 'opp');
        break;
      case 'echo':
        renderer.echo(m.x, m.y, m.r, m.pts, MONSTER.echoSec);
        sfx.screech();
        m.pts.forEach((p) => setTimeout(() => sfx.ping(), 150 + (dist(p[0], p[1], m.x, m.y) / m.r) * 1400));
        if (!m.pts.length) hud.chat('server', 'bro', 'Your screech came back empty. No bros nearby.', true);
        break;
      case 'snap': this.onSnap(m); break;
      case 'feed':
        hud.feed(m.items);
        for (const it of m.items) {
          if (it.k === 'caught') { if (it.b === hud.myName) sfx.caught(); }
          else if (it.k === 'mog') sfx.mog();
          else if (it.k === 'revive') sfx.revive();
          else if (it.k === 'event') sfx.event();
        }
        break;
      case 'chat': hud.chat(m.from, m.role, m.text, m.sys); break;
      case 'knock':
        sfx.knock();
        hud.knock(m.id, m.from, m.side, m.expires, (ok) => this.answer(ok));
        break;
      case 'knockDone': hud.clearKnock(m.id); break;
      case 'scores': hud.scores(m.rows, this.selfId, this.lobby?.name ?? ''); break;
      case 'result':
        hud.result(m.win, m.mvp);
        if ((m.win && this.role === 'bro') || (!m.win && this.role === 'opp')) sfx.win(); else sfx.lose();
        break;
      case 'cash':
        if (m.d) hud.auraPop(m.d, m.why, true);
        if (m.d > 0) sfx.auraUp();
        break;
      case 'aura':
        hud.auraPop(m.d, m.why);
        if (m.d >= 0) sfx.auraUp(); else sfx.auraDown();
        break;
      case 'ping': this.send({ t: 'pong', at: m.at }); break;
      case 'kicked': this.closed = true; showMenu(m.reason); break;
    }
  }

  private onSnap(m: Extract<ServerMsg, { t: 'snap' }>) {
    const ents = new Map(m.ents.map((e) => [e.id, e]));
    this.snaps.push({ recv: performance.now(), ents });
    if (this.snaps.length > 30) this.snaps.shift();
    const prevPhase = this.phase;
    this.phase = m.phase;
    this.phaseEnd = m.phaseEnd;
    this.night = m.night;
    this.ev = m.ev;
    this.lobby = m.lobby;
    this.counts = m.counts;
    if (m.you.role !== this.role && m.you.role === 'opp') hud.intro(10, true);
    this.role = m.you.role;
    this.myCrib = m.you.crib;
    this.aura = m.you.aura;
    this.sense = m.you.sense ?? 0;
    this.lunCd = m.you.lun ?? 0;
    hud.hunter(m.you, m.phase);
    hud.wallet(m.you);
    this.drink = m.you.drink;
    this.kicks = m.you.kicks ?? 0;
    renderer.setProps(m.props);
    renderer.setDefs(m.defs);
    if (m.R !== this.R || !this.me.init) { this.R = m.R; renderer.buildWorld(m.R); }
    if (m.cribs) {
      this.cribs = new Map(m.cribs.map((c) => [c.i, c]));
      renderer.updateCribs(m.cribs, this.myCrib, this.role === 'bro' && this.phase !== 'lockin');
    }
    if (m.drops) renderer.setDrops(m.drops);
    const hunter = this.role === 'opp';
    for (const n of m.noises) {
      if (!renderer.addNoise(n.id, n.x, n.y, n.r, hunter)) continue;
      // hear what's near you: footsteps, pets, smashing. Opps hear much farther.
      const d = dist(n.x, n.y, this.me.x, this.me.y);
      if (hunter && d > 1.5 && n.k !== 'screech' && n.k !== 'lunge') this.sounds.push({ x: n.x, y: n.y, r: n.r, born: performance.now() });
      if (n.k === 'screech') { if (!hunter && d < 24) sfx.screech(Math.max(0.2, 1 - d / 24)); continue; }
      const range = hunter ? 22 : 14;
      if (d > range) continue;
      const vol = Math.max(0.15, 1 - d / range);
      if (n.k === 'step' || n.k === 'zoom' || n.k === 'land') sfx.step(vol * (n.k === 'zoom' ? 1.6 : 1));
      else if (n.k === 'smash') sfx.knock();
      else if (n.k === 'bass') sfx.bass();
    }

    const self = ents.get(this.selfId);
    if (self) {
      const wasNpc = this.npc;
      this.npc = self.k === 'npc';
      this.stunned = !!self.st;
      this.lightOn = !!self.l;
      if (!this.me.init || dist(self.x, self.y, this.me.x, this.me.y) > 2.2 || prevPhase !== this.phase || wasNpc !== this.npc) {
        this.me.x = self.x;
        this.me.y = self.y;
        this.me.init = true;
      } else {
        // gently pull the predicted position toward the server's
        const k = this.lastSent.includes('"dx":0,"dy":0') ? 0.2 : 0.03;
        this.me.x += (self.x - this.me.x) * k;
        this.me.y += (self.y - this.me.y) * k;
      }
    }
    hud.role(this.role, this.npc);
    hud.aura(this.aura, this.lightOn);
    hud.events(this.ev);
    hud.lobby(this.lobby, this.phase, this.selfId, this.role);
  }

  private doors = (plot: number, side: DoorSide) => {
    const c = this.cribs.get(plot);
    return c && c.owner ? c.doors[side] : undefined;
  };

  answer(ok: boolean) {
    const id = hud.pendingKnock;
    if (id === null) return;
    this.send({ t: 'answer', id, ok });
    hud.clearKnock();
  }

  action(a: Action) {
    switch (a) {
      case 'screech': if (this.role === 'opp') this.send({ t: 'screech' }); break;
      case 'jump':
        if (this.role === 'opp' && this.phase === 'lockin' && this.lunCd <= 0 && this.lungeT <= 0 && !this.stunned) {
          this.lungeT = MONSTER.lungeSec;
          this.lunCd = MONSTER.lungeCd;
          sfx.lunge();
        }
        if (this.role === 'bro' && !this.npc && tryJump(this.me.jump, this.kicks, this.ev.lowgrav)) sfx.jump();
        this.send({ t: 'jump' });
        break;
      case 'light': this.send({ t: 'light' }); sfx.light(); break;
      case 'walkToggle': hud.walkMode(input.sneakLatch); break;
      case 'camIn': renderer.zoomBy(-0.12); break;
      case 'camOut': renderer.zoomBy(0.12); break;
      case 'controls': hud.toggleControls(); break;
      case 'shop': hud.toggleShop(); break;
      case 'escape': hud.toggleShop(false); break;
      case 'item1': this.send({ t: 'item', item: 'trap' }); break;
      case 'item2': this.send({ t: 'item', item: 'drink' }); break;
      case 'item3': this.send({ t: 'item', item: 'decoy' }); break;
      case 'item4': this.send({ t: 'item', item: 'bribe' }); break;
      case 'use': this.send({ t: 'use' }); break;
      case 'repairOn': this.send({ t: 'repair', on: true }); break;
      case 'repairOff': this.send({ t: 'repair', on: false }); break;
      case 'yes': this.answer(true); break;
      case 'no': this.answer(false); break;
      case 'scoreOn':
        this.scoresOpen = true;
        hud.scoreboard(true);
        this.send({ t: 'scores' });
        break;
      case 'scoreOff': this.scoresOpen = false; hud.scoreboard(false); break;
      case 'chat': {
        const r = hud.toggleChat();
        input.enabled = !r.open;
        input.clear();
        if (r.text) this.send({ t: 'chat', text: r.text });
        break;
      }
    }
  }

  private interpolated(): EntView[] {
    const n = this.snaps.length;
    if (!n) return [];
    const renderAt = performance.now() - 110;
    let a = this.snaps[0], b = this.snaps[n - 1];
    for (let i = n - 1; i > 0; i--) {
      if (this.snaps[i - 1].recv <= renderAt) { a = this.snaps[i - 1]; b = this.snaps[i]; break; }
    }
    const span = b.recv - a.recv;
    const f = span > 0 ? Math.max(0, Math.min(1, (renderAt - a.recv) / span)) : 1;
    const out: EntView[] = [];
    for (const [id, eb] of b.ents) {
      const ea = a.ents.get(id);
      if (ea && Math.hypot(ea.x - eb.x, ea.y - eb.y) < 3) {
        out.push({ ...eb, x: ea.x + (eb.x - ea.x) * f, y: ea.y + (eb.y - ea.y) * f, z: (ea.z ?? 0) + ((eb.z ?? 0) - (ea.z ?? 0)) * f });
      } else out.push(eb);
    }
    return out;
  }

  private predict(dt: number) {
    const mv = input.move();
    // send input on change, and at least 5 times a second
    const key = JSON.stringify(mv);
    const t = performance.now();
    if (key !== this.lastSent || t - this.lastSentAt > 200) {
      this.send({ t: 'input', ...mv });
      this.lastSent = key;
      this.lastSentAt = t;
    }
    if (!this.me.init || this.stunned) return;
    const me = this.me;
    stepJump(me.jump, dt, this.ev.lowgrav, overFence(me.x, me.y, this.R));
    let sp: number;
    if (this.role === 'opp') {
      sp = this.phase === 'lockin' ? SPEED.monsterPlayer * (this.ev.rage ? EVENTS.rageSpeed : 1) * (this.ev.power ? 1 : 1.1) : SPEED.walk;
      if (this.lungeT > 0) { sp *= MONSTER.lungeSpeed; this.lungeT -= dt; }
    } else sp = (this.npc ? SPEED.npc : mv.zoom ? SPEED.zoom : mv.sneak ? SPEED.sneak : SPEED.walk) * (this.drink > 0 && !this.npc ? ITEM.drinkSpeed : 1) * (this.npc ? 1 : kicksSpeed(this.kicks));
    if (mv.dx || mv.dy) {
      [me.x, me.y] = move(me.x, me.y, mv.dx * sp * dt, mv.dy * sp * dt, this.R, this.doors, { ghost: this.npc, airborne: airborne(me.jump) });
    }
  }

  private hintText(): string {
    const { x, y } = this.me;
    if (this.phase === 'lobby') return 'Walk around while you wait. Space to jump.';
    if (this.npc) return 'NPC mode: stand next to a living bro to get revived';
    let best: { plot: number; side: DoorSide; d: number } | null = null;
    for (const c of this.cribs.values()) {
      for (const side of [0, 1] as DoorSide[]) {
        const [dx, dy] = doorCenter(c.i, side);
        const d = dist(x, y, dx, dy);
        if (d < 1.7 && (!best || d < best.d)) best = { plot: c.i, side, d };
      }
    }
    const sideName = (s: DoorSide) => (s === 0 ? 'front' : 'back');
    if (this.role === 'opp') {
      if (best && doorBlocks(this.doors(best.plot, best.side))) return 'E: smash the door';
      if (this.phase !== 'lockin') return 'You come out when the night starts. Q screech · Space lunge · E smash';
      if (this.sense > 0.6) return 'A bro is RIGHT here. Lunge (Space)!';
      if (this.sense > 0) return 'You can feel a bro close by. Screech (Q) to find them.';
      return 'Follow the ripples and red arrows. Q screech pings every bro nearby.';
    }
    if (this.myCrib < 0 && this.phase !== 'lockin') return 'Walk into any free crib (no name on it) to make it yours';
    if (best) {
      const c = this.cribs.get(best.plot)!;
      const d = c.doors[best.side];
      if (c.i === this.myCrib) {
        if (d.hp < c.max) return `Hold R: repair your ${sideName(best.side)} door (${d.hp}/${c.max})  ·  E: open it`;
        return d.open ? 'Your door is open. It closes by itself.' : `E: open your ${sideName(best.side)} door`;
      }
      if (doorBlocks(d)) return `E: knock on ${c.ownerName}'s ${sideName(best.side)} door`;
    }
    if (this.phase === 'pregame') return 'Grab purple aura drops, then get to your crib';
    if (input.sneakLatch) return 'Walk mode: slow and quiet';
    if (cribAtPos(x, y, this.R) === this.myCrib) return 'Doors stay locked unless you open them. C = walk mode (quiet)';
    return '';
  }

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - (this.lastFrame || now)) / 1000);
    this.lastFrame = now;
    this.predict(dt);
    const ents = this.interpolated();
    const self = ents.find((e) => e.id === this.selfId);
    if (self && this.me.init) {
      self.x = this.me.x;
      self.y = this.me.y;
      if (this.role === 'bro' && !this.npc) self.z = this.me.jump.z;
    }
    // the Opp chant when one is close
    if (this.role === 'bro') {
      let nearest = Infinity;
      let near: EntView | null = null;
      for (const e of ents) {
        if (e.k !== 'opp') continue;
        const d = dist(e.x, e.y, this.me.x, this.me.y);
        if (d < nearest) { nearest = d; near = e; }
      }
      if (near) {
        chant(nearest);
        if (nearest < 9 && now - this.lastPop > 700) {
          this.lastPop = now;
          renderer.popText(near.x, near.y, ['WE OUTSIDE', 'WHERE U AT', 'OPPS PACKIN', 'U LACKIN'][Math.floor(now / 700) % 4], '#ffd23f');
        }
      }
    }
    renderer.frame(ents, this.selfId, this.me, this.ev, this.role === 'opp');
    this.hunterFrame(now);
    hud.timer(this.phase, this.phaseEnd, this.night, this.counts);
    hud.hint(this.hintText());
    hud.tickKnock();
    if (this.scoresOpen && now - this.scoreTimer > 1000) { this.scoreTimer = now; this.send({ t: 'scores' }); }
  }
  private lastFrame = 0;

  /** Sound vision for an Opp: edge arrows to off-screen noise, and the heartbeat. */
  private hunterFrame(now: number) {
    if (this.role !== 'opp') { if (this.sounds.length) { this.sounds = []; hud.compass([]); } return; }
    const life = 2600;
    this.sounds = this.sounds.filter((s) => now - s.born < life).slice(-24);
    const w = window.innerWidth, h = window.innerHeight, pad = 28;
    const c = renderer.toScreen(this.me.x, this.me.y);
    const marks: Array<{ x: number; y: number; a: number; o: number; loud: boolean }> = [];
    for (const s of this.sounds) {
      const p = renderer.toScreen(s.x, s.y);
      if (!p.behind && p.sx > pad && p.sx < w - pad && p.sy > pad && p.sy < h - pad) continue; // the ripple itself is on screen
      const a = Math.atan2(p.sy - c.sy, p.sx - c.sx);
      // from the player's spot along that angle to the screen edge
      const ca = Math.cos(a), sa = Math.sin(a);
      const tx = ca > 0 ? (w - pad - c.sx) / ca : ca < 0 ? (pad - c.sx) / ca : Infinity;
      const ty = sa > 0 ? (h - pad - c.sy) / sa : sa < 0 ? (pad - c.sy) / sa : Infinity;
      const k = Math.max(0, Math.min(tx, ty));
      marks.push({ x: c.sx + ca * k, y: c.sy + sa * k, a, o: Math.max(0, 1 - (now - s.born) / life), loud: s.r >= 7 });
    }
    hud.compass(marks);
    if (this.phase === 'lockin' && this.sense > 0 && now - this.lastBeat > 1100 - 700 * this.sense) {
      this.lastBeat = now;
      sfx.beat(0.3 + this.sense * 0.7);
      hud.beat();
    }
  }
}

input.onAction = (a) => {
  if (hud.introOpen && a !== 'scoreOff' && a !== 'repairOff') hud.closeIntro();
  game?.action(a);
};
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); game?.action('chat'); }
  if (e.key === 'Escape') { hud.closeChat(); input.enabled = true; }
  e.stopPropagation();
});

// ======================================================================
// Menu, accounts, captcha
// ======================================================================

function showError(msg: string) { $('menu-error').textContent = msg; }

function showMenu(error = '') {
  game = null;
  hud.show(false);
  hud.closeChat();
  input.enabled = true;
  $('menu').classList.remove('hidden');
  showError(error);
  void refreshLobbies();
}

function startGame(opts: JoinOpts) {
  sfx.unlock();
  showError('');
  game?.leave();
  $('menu').classList.add('hidden');
  hud.show(true);
  game = new Game(opts);
}

const role = (): Role => ($<HTMLSelectElement>('role-select').value === 'opp' ? 'opp' : 'bro');

async function refreshLobbies() {
  const ul = $('lobby-list');
  try {
    const { lobbies } = await api.lobbies();
    ul.replaceChildren();
    for (const l of lobbies) {
      const li = document.createElement('li');
      const left = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = l.name;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${l.players} playing · ${l.phase === 'lobby' ? 'waiting to start' : l.phase === 'lockin' ? 'night in progress (drop in)' : 'between nights'}`;
      left.append(name, meta);
      const b = document.createElement('button');
      b.className = 'small';
      b.textContent = 'Join';
      b.onclick = () => startGame(l.quick ? { mode: 'quick', role: role() } : { mode: 'join', code: l.code, role: role() });
      li.append(left, b);
      ul.appendChild(li);
    }
  } catch {
    ul.textContent = 'Could not load lobbies.';
  }
}

function renderAccount() {
  if (!account) return;
  const a = account;
  $('account-status').textContent = a.username
    ? `Signed in as ${a.username}. You can sign in on any device with your password.`
    : 'Guest account on this device. Add a login to keep it if you switch devices.';
  $('sec-current').classList.toggle('hidden', !a.hasPassword);
  $<HTMLInputElement>('sec-user').value = a.username ?? '';
  $('form-secure').querySelector('button')!.textContent = a.hasPassword ? 'Change login' : 'Save login';
  const s = a.stats;
  $('account-msg').textContent = `Nights played ${s.nights} · wins ${s.wins} · mogs ${s.mogs} · revives ${s.revives} · catches ${s.catches}`;
}

function enterMain(a: Account) {
  account = a;
  $('captcha-box').classList.add('hidden');
  $('menu-main').classList.remove('hidden');
  $<HTMLInputElement>('name-input').value = a.name;
  renderAccount();
  void refreshLobbies();
  const join = new URLSearchParams(location.search).get('join');
  if (join) history.replaceState(null, '', location.pathname);
  const go = () => { if (join) startGame({ mode: 'join', code: join, role: role() }); };
  if (!a.look) openCreator(true, go);
  else go();
}

/** Open the character creator; saves to the account and, if in a game, updates your bro live. */
function openCreator(firstTime = false, after?: () => void) {
  const wasEnabled = input.enabled;
  input.enabled = false;
  creator.open(account?.look ?? null, {
    firstTime,
    onSave: async (look: Look) => {
      const r = await api.setLook(look);
      account = r.account;
      game?.send({ t: 'look', look: encodeLook(look) });
    },
    onClose: () => { input.enabled = wasEnabled || !!game; after?.(); },
  });
}

async function runCaptcha() {
  $('captcha-box').classList.remove('hidden');
  const status = $('captcha-status');
  const cfg = await api.captcha();
  if (cfg.kind === 'turnstile') {
    $('pow-check').classList.add('hidden');
    await loadTurnstile();
    window.turnstile!.render($('turnstile-slot'), {
      sitekey: cfg.siteKey,
      theme: 'dark',
      callback: async (token) => {
        try {
          const r = await api.guest({ turnstile: token });
          setToken(r.token);
          enterMain(r.account);
        } catch (e) { status.textContent = (e as Error).message; }
      },
    });
    return;
  }
  const box = $<HTMLInputElement>('pow-input');
  box.checked = false;
  box.disabled = false;
  box.onchange = async () => {
    if (!box.checked) return;
    box.disabled = true;
    status.textContent = 'Checking your aura...';
    try {
      const fresh = await api.captcha();
      if (fresh.kind !== 'pow') return;
      const nonce = await solvePow(fresh.challenge, fresh.bits);
      const r = await api.guest({ challenge: fresh.challenge, nonce });
      setToken(r.token);
      status.textContent = '';
      enterMain(r.account);
    } catch (e) {
      status.textContent = (e as Error).message;
      box.checked = false;
      box.disabled = false;
    }
  };
}

async function boot() {
  const savedRole = ls.get('brochase.role');
  if (savedRole) $<HTMLSelectElement>('role-select').value = savedRole;
  if (getToken()) {
    try {
      const { account: a } = await api.me();
      enterMain(a);
      return;
    } catch {
      setToken(null);
    }
  }
  await runCaptcha().catch((e) => showError((e as Error).message));
}

// ----- menu wiring -----
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tab-body').forEach((b) => b.classList.toggle('hidden', b.id !== t.dataset.tab));
  };
});
$('role-select').onchange = () => ls.set('brochase.role', role());
let nameTimer = 0;
$('name-input').oninput = () => {
  clearTimeout(nameTimer);
  nameTimer = window.setTimeout(async () => {
    try {
      const r = await api.setName($<HTMLInputElement>('name-input').value);
      account = r.account;
      showError('');
    } catch (e) { showError((e as Error).message); }
  }, 500);
};
$('btn-quick').onclick = () => startGame({ mode: 'quick', role: role() });
$('btn-refresh').onclick = () => void refreshLobbies();
$('btn-create').onclick = () => startGame({
  mode: 'create', role: role(), name: $<HTMLInputElement>('lobby-name').value || undefined,
  priv: $<HTMLInputElement>('lobby-private').checked,
});
$('btn-join').onclick = () => {
  const code = $<HTMLInputElement>('join-code').value.trim().toUpperCase();
  if (code.length !== 6) return showError('Invite codes are 6 characters.');
  startGame({ mode: 'join', code, role: role() });
};
$('form-secure').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const r = await api.credentials($<HTMLInputElement>('sec-user').value, $<HTMLInputElement>('sec-pass').value, $<HTMLInputElement>('sec-current').value || undefined);
    account = r.account;
    $<HTMLInputElement>('sec-pass').value = '';
    $<HTMLInputElement>('sec-current').value = '';
    renderAccount();
    $('account-msg').textContent = 'Saved. You can now sign in on other devices.';
  } catch (err) { $('account-msg').textContent = (err as Error).message; }
};
$('form-login').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const r = await api.login($<HTMLInputElement>('login-user').value, $<HTMLInputElement>('login-pass').value);
    setToken(r.token);
    enterMain(r.account);
    $('account-msg').textContent = 'Signed in. This device is now linked to your account.';
  } catch (err) { $('account-msg').textContent = (err as Error).message; }
};
$('btn-logout').onclick = async () => {
  if (account && !account.hasPassword && !confirm('This guest account has no password. Signing out loses it for good. Continue?')) return;
  try { await api.logout(); } catch { /* ignore */ }
  setToken(null);
  account = null;
  $('menu-main').classList.add('hidden');
  void runCaptcha();
};

// ----- HUD wiring -----
$('btn-leave').onclick = () => { game?.leave(); showMenu(); };
$('btn-shop').onclick = () => hud.toggleShop();
$('shop-close').onclick = () => hud.toggleShop(false);
hud.onBuy = (item) => game?.send({ t: 'buy', item });
hud.onBuild = (kind) => { game?.send({ t: 'build', kind }); hud.toggleShop(false); };
hud.onUpgrade = (kind) => game?.send({ t: 'upgrade', kind });
$('btn-start').onclick = () => game?.send({ t: 'start' });
$('btn-role-bro').onclick = () => game?.send({ t: 'role', role: 'bro' });
$('btn-role-six').onclick = () => game?.send({ t: 'role', role: 'opp' });
$('btn-look').onclick = () => openCreator();
$('btn-customize').onclick = () => openCreator();
$('btn-copy').onclick = async () => {
  const code = game?.lobby?.code;
  if (!code) return;
  const link = `${location.origin}/?join=${code}`;
  try { await navigator.clipboard.writeText(link); $('btn-copy').textContent = 'Copied!'; } catch { prompt('Invite link', link); }
  setTimeout(() => { $('btn-copy').textContent = 'Copy link'; }, 1500);
};

if ('ontouchstart' in window || navigator.maxTouchPoints > 0) input.setupTouch($('touch'));

void boot();
