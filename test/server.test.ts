import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { Room } from '../server/game.ts';
import { startServer } from '../server/index.ts';
import { solvePow } from '../server/captcha.ts';
import { doorCenter, plotCenter } from '../shared/world.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import { CRIB_HALF } from '../shared/constants.ts';

// ---------- room-level tests with fake sockets ----------

class FakeWs {
  readyState = 1;
  msgs: ServerMsg[] = [];
  send(d: string) { this.msgs.push(JSON.parse(d)); }
  close() { this.readyState = 3; }
  last<T extends ServerMsg['t']>(t: T) {
    return [...this.msgs].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
  }
}

const hooks = { onStats: () => {}, onEmpty: () => {} };
const fast = { pregame: 0.01, lockin: 600, touchgrass: 0.01 };

function makeRoom(quick = false) {
  return new Room('TEST01', 'test', true, quick, null, hooks, fast);
}
const tick = (r: Room, n = 1) => { for (let i = 0; i < n; i++) (r as any).tick(); };
/** Host starts and we skip straight past pregame into the night. */
const lockIn = (r: Room, hostId: string) => { r.handle(hostId, { t: 'start' }); r.phaseEnd = 0; tick(r); };

/** Walk a bro into the first free crib so they claim it. */
function settle(r: Room, id: string) {
  const p = r.players.get(id)!;
  let i = 1;
  while (r.cribs.get(i)?.owner) i++;
  [p.x, p.y] = plotCenter(i);
  tick(r);
}

/** Fresh player ids per room. (players.size can't be used: bot bros come and go, so ids would collide and a join would turn into a reconnect.) */
const seqs = new WeakMap<Room, number>();
function joinN(r: Room, n: number, role: 'bro' | 'opp' = 'bro', home = true) {
  const out: Array<{ id: string; ws: FakeWs }> = [];
  for (let i = 0; i < n; i++) {
    const ws = new FakeWs();
    const seq = (seqs.get(r) ?? 0) + 1;
    seqs.set(r, seq);
    const id = `p${seq}`;
    r.join(id, `Bro${id}`, ws as any, role);
    out.push({ id, ws });
    if (home && r.players.get(id)!.role === 'bro') settle(r, id);
  }
  return out;
}

test('first player in a custom lobby is the host, and only the host can start', () => {
  const r = makeRoom();
  const [a, b] = joinN(r, 2);
  assert.equal(r.hostId, a.id);
  r.handle(b.id, { t: 'start' });
  assert.equal(r.phase, 'lobby');
  r.handle(a.id, { t: 'start' });
  assert.equal(r.phase, 'pregame');
});

test('one Opp per 4 bros (rounded up), AI fills the slots', () => {
  const r = makeRoom();
  joinN(r, 9);
  lockIn(r, 'p1');
  assert.equal(r.phase, 'lockin');
  assert.equal(r.ais.length, 3); // ceil(9 / 4)
});

test('anyone can play as an Opp: bot bros keep the 4:1 ratio, extra Opps wait for a slot', () => {
  const r = makeRoom();
  const [solo] = joinN(r, 1, 'opp');
  assert.equal(r.players.get(solo.id)!.role, 'opp');
  assert.equal(r.bots.length, 4); // one Opp needs 4 bros, so bots fill in
  joinN(r, 3);
  assert.equal(r.bots.length, 1);
  const [late] = joinN(r, 1, 'opp');
  assert.equal(r.players.get(late.id)!.role, 'bro'); // 4 real bros -> 1 Opp slot, already taken
  assert.match(late.ws.last('welcome')!.notice!, /slot/);
  assert.equal(r.bots.length, 0);
  lockIn(r, 'p1');
  assert.equal(r.ais.length, 0); // 4 bros -> 1 Opp, already a player
});

test('bros spawn homeless, claim a free crib by walking in, and lock-in houses everyone else', () => {
  const r = makeRoom();
  const [a, b, c] = joinN(r, 3, 'bro', false);
  assert.equal(r.cribs.size, 0);
  assert.ok((2 * r.R + 1) ** 2 - 1 >= 3 + 3, 'map keeps spare cribs');
  settle(r, a.id);
  const pa = r.players.get(a.id)!;
  assert.ok(pa.crib > 0);
  for (const d of r.cribs.get(pa.crib)!.doors) { assert.equal(d.open, false); assert.equal(d.hp, 100); }
  // b walks into a's crib: already taken, nothing happens
  const pb = r.players.get(b.id)!;
  [pb.x, pb.y] = plotCenter(pa.crib);
  tick(r);
  assert.equal(pb.crib, -1);
  lockIn(r, a.id);
  assert.ok(pb.crib > 0 && r.players.get(c.id)!.crib > 0, 'lock-in gives the homeless a crib');
  assert.equal(new Set([pa.crib, pb.crib, r.players.get(c.id)!.crib]).size, 3);
  joinN(r, 12, 'bro', false);
  assert.ok((2 * r.R + 1) ** 2 - 1 >= 15 + 3, 'the map grows with players');
});

test('claiming a crib from the doorway never traps you in your own door', async () => {
  const r = makeRoom();
  const [a] = joinN(r, 1, 'bro', false);
  const p = r.players.get(a.id)!;
  const [cx, cy] = plotCenter(1);
  // just inside the back door: centre on a floor cell, body still overlapping the door cells
  [p.x, p.y] = [cx - 0.5, cy - CRIB_HALF + 1.02];
  tick(r);
  assert.equal(p.crib, 1);
  const back = r.cribs.get(1)!.doors[1];
  assert.equal(back.open, true, 'door waits for the doorway to clear');
  p.input = { dx: 0, dy: 1, zoom: false, sneak: false };
  tick(r, 10);
  assert.ok(p.y > cy - CRIB_HALF + 1.6, `walked inside (y=${p.y})`);
  p.input = { dx: 0, dy: 0, zoom: false, sneak: false };
  await new Promise((res) => setTimeout(res, 350)); // the door re-checks the doorway every 0.3s
  tick(r);
  assert.equal(back.open, false, 'and it locks once you are clear');
});

test('knocking asks the owner; the door opens only on approval', () => {
  const r = makeRoom();
  const [a, b] = joinN(r, 2);
  const pa = r.players.get(a.id)!;
  const pb = r.players.get(b.id)!;
  const [dx, dy] = doorCenter(pa.crib, 1);
  pb.x = dx; pb.y = dy - 1.2; // standing outside A's back door
  r.handle(b.id, { t: 'use' });
  const knock = a.ws.last('knock');
  assert.ok(knock, 'owner gets a knock prompt');
  assert.equal(knock!.side, 1);
  const door = r.cribs.get(pa.crib)!.doors[1];
  assert.equal(door.open, false, 'still locked while waiting');

  // say no
  r.handle(a.id, { t: 'answer', id: knock!.id, ok: false });
  assert.equal(door.open, false);
  assert.match(b.ws.last('chat')!.text, /said nah/);

  // knock again and say yes
  r.handle(b.id, { t: 'use' });
  const k2 = a.ws.last('knock')!;
  r.handle(a.id, { t: 'answer', id: k2.id, ok: true });
  assert.equal(door.open, true);
  assert.equal(pa.stats.letIns, 1);
});

test('an unanswered knock expires and the door stays locked', () => {
  const r = makeRoom();
  const [a, b] = joinN(r, 2);
  const pa = r.players.get(a.id)!;
  const pb = r.players.get(b.id)!;
  const [dx, dy] = doorCenter(pa.crib, 0);
  pb.x = dx; pb.y = dy + 1.2;
  r.handle(b.id, { t: 'use' });
  const k = a.ws.last('knock')!;
  r.knocks.get(k.id)!.expires = 0;
  tick(r);
  assert.equal(r.knocks.size, 0);
  assert.equal(r.cribs.get(pa.crib)!.doors[0].open, false);
  assert.match(b.ws.last('chat')!.text, /didn't answer/);
});

test('owners open their own door without asking', () => {
  const r = makeRoom();
  const [a] = joinN(r, 1);
  const pa = r.players.get(a.id)!;
  const [dx, dy] = doorCenter(pa.crib, 0);
  pa.x = dx; pa.y = dy - 1;
  r.handle(a.id, { t: 'use' });
  assert.equal(r.cribs.get(pa.crib)!.doors[0].open, true);
});

test('an Opp catches a bro, a lit ring light mogs it, a revive brings the bro back', () => {
  const r = makeRoom();
  const [a, b] = joinN(r, 2);
  lockIn(r, a.id);
  const ai = r.ais[0];
  const pa = r.players.get(a.id)!;
  const pb = r.players.get(b.id)!;
  ai.x = pa.x + 0.3; ai.y = pa.y;
  tick(r);
  assert.equal(pa.npc, true, 'caught');
  const feed = a.ws.msgs.filter((m) => m.t === 'feed').flatMap((m: any) => m.items);
  assert.ok(feed.some((f: any) => f.k === 'caught' && f.b === pa.name));

  // revive: B stands next to A for 3 seconds (60 ticks)
  ai.x = 9999; ai.y = 9999; ai.stunUntil = Infinity;
  pb.x = pa.x + 0.5; pb.y = pa.y;
  tick(r, 62);
  assert.equal(pa.npc, false, 'revived');
  assert.equal(pb.stats.revives, 1);

  // mog: B's ring light stuns an Opp that gets close
  ai.stunUntil = 0;
  pb.light = true;
  ai.x = pb.x + 1.5; ai.y = pb.y;
  (r as any).hunterChecks(ai, Date.now() / 1000);
  assert.ok(ai.stunUntil > Date.now() / 1000, 'stunned');
  assert.equal(pb.stats.mogs, 1);
});

test('a mid-air bro cannot be caught', () => {
  const r = makeRoom();
  const [a] = joinN(r, 1);
  lockIn(r, a.id);
  const pa = r.players.get(a.id)!;
  r.handle(a.id, { t: 'jump' });
  assert.ok(pa.jump.z > 0);
  const ai = r.ais[0];
  ai.x = pa.x + 0.2; ai.y = pa.y;
  (r as any).hunterChecks(ai, Date.now() / 1000);
  assert.equal(pa.npc, false);
});

test('a power cut ends by itself', () => {
  const r = makeRoom();
  const [a] = joinN(r, 1);
  lockIn(r, a.id);
  r.ev.power = false;
  r.ev.mode = 'blackout';
  r.ev.modeEnd = 0;
  tick(r);
  assert.equal(r.ev.power, true);
  assert.equal(r.ev.mode, null);
});

test('chat is broadcast, trimmed and rate limited', () => {
  const r = makeRoom();
  const [a, b] = joinN(r, 2);
  r.handle(a.id, { t: 'chat', text: '  six seven  ' });
  assert.equal(b.ws.last('chat')!.text, 'six seven');
  for (let i = 0; i < 6; i++) r.handle(a.id, { t: 'chat', text: `spam ${i}` });
  assert.match(a.ws.last('chat')!.text, /Slow down/);
});

test('scoreboard lists players and AI Opps', () => {
  const r = makeRoom();
  const [a] = joinN(r, 3);
  lockIn(r, a.id);
  r.handle(a.id, { t: 'scores' });
  const rows = a.ws.last('scores')!.rows;
  assert.equal(rows.length, 4);
  assert.ok(rows.some((x) => x.ai));
});

// ---------- full server over HTTP + WebSocket ----------

test('guest account, password, login on a new device, and joining over WebSocket', async () => {
  const srv = await startServer({ port: 0, dbFile: ':memory:', phaseSec: fast, powBits: 10 });
  const base = `http://localhost:${srv.port}`;
  try {
    const post = (path: string, body: unknown, token?: string) =>
      fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
    const solved = async () => {
      const c = await (await fetch(base + '/api/captcha')).json();
      assert.equal(c.kind, 'pow');
      return { challenge: c.challenge, nonce: solvePow(c.challenge, c.bits) };
    };
    assert.equal((await post('/api/guest', {})).status, 400, 'no captcha, no account');
    const answer = await solved();
    const guest = await (await post('/api/guest', { captcha: answer })).json();
    assert.equal((await post('/api/guest', { captcha: answer })).status, 400, 'a solved challenge is single-use');
    assert.ok(guest.token);
    assert.equal(guest.account.hasPassword, false);

    const creds = await post('/api/me/credentials', { username: 'sigma67', password: 'rizzrizz' }, guest.token);
    assert.equal(creds.status, 200);
    assert.equal((await post('/api/login', { username: 'sigma67', password: 'nope' })).status, 401);
    const login = await (await post('/api/login', { username: 'SIGMA67', password: 'rizzrizz' })).json();
    assert.equal(login.account.id, guest.account.id);
    assert.notEqual(login.token, guest.token, 'new device gets its own token');
    const me = await (await fetch(base + '/api/me', { headers: { authorization: `Bearer ${guest.token}` } })).json();
    assert.equal(me.devices, 2);

    // private lobby created over WebSocket, then joined by code
    const ws = new WebSocket(`ws://localhost:${srv.port}/ws?token=${guest.token}&mode=create&priv=1&name=Test`);
    const welcome: any = await new Promise((res) => ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'welcome') res(m); }));
    assert.match(welcome.room, /^[A-Z2-9]{6}$/);
    const lobbies = await (await fetch(base + '/api/lobbies')).json();
    assert.ok(!lobbies.lobbies.some((l: any) => l.code === welcome.room), 'private lobby is not listed');

    const g2 = await (await post('/api/guest', { name: 'Unc', captcha: await solved() })).json();
    const ws2 = new WebSocket(`ws://localhost:${srv.port}/ws?token=${g2.token}&mode=join&code=${welcome.room}`);
    const snap: any = await new Promise((res) => ws2.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'snap') res(m); }));
    assert.equal(snap.lobby.code, welcome.room);
    assert.equal(snap.lobby.host, guest.account.id);
    assert.equal(snap.ents.filter((e: any) => e.k === 'bro').length, 2);

    const bad = new WebSocket(`ws://localhost:${srv.port}/ws?token=nope`);
    const code = await new Promise((res) => bad.on('close', (c) => res(c)));
    assert.equal(code, 4001);
    ws.close(); ws2.close();
  } finally {
    srv.close();
  }
});

test('bros build defences in their crib; a Rizz Blaster stuns an Opp after 5 hits', () => {
  const r = makeRoom();
  const [a] = joinN(r, 1);
  const pa = r.players.get(a.id)!;
  pa.cash = 1000;
  r.handle(a.id, { t: 'build', kind: 'blaster' });
  assert.equal(r.defs.length, 1);
  pa.x += 30; // far from home
  r.handle(a.id, { t: 'build', kind: 'lamp' });
  assert.equal(r.defs.length, 1, 'cannot build outside your plot');
  r.handle(a.id, { t: 'upgrade', kind: 'blaster' });
  assert.equal(r.cribs.get(pa.crib)!.defLv.blaster, 2);
  lockIn(r, a.id);
  const ai = r.ais[0];
  const d = r.defs[0];
  ai.x = d.x + 3; ai.y = d.y; ai.stunUntil = 0; ai.path = [];
  ai.replanAt = Infinity;
  for (let i = 0; i < 20 * 6 && ai.stunUntil < Date.now() / 1000; i++) { ai.x = d.x + 3; ai.y = d.y; tick(r); }
  assert.ok(ai.stunUntil > Date.now() / 1000, 'stunned by the blaster');
});

test('maxed-out defences stun an Opp, but never keep it stunned all night', () => {
  const realNow = Date.now;
  let fake = realNow();
  Date.now = () => fake;
  try {
    const r = makeRoom();
    const [a] = joinN(r, 1);
    const pa = r.players.get(a.id)!;
    pa.cash = 99999;
    const [cx, cy] = plotCenter(pa.crib);
    for (const [ox, oy, k] of [[-2, -2, 'blaster'], [2, -2, 'blaster'], [-2, 2, 'lamp'], [2, 2, 'bass']] as const) {
      [pa.x, pa.y] = [cx + ox, cy + oy];
      r.handle(a.id, { t: 'build', kind: k });
    }
    for (const k of ['blaster', 'blaster', 'lamp', 'lamp', 'bass', 'bass'] as const) r.handle(a.id, { t: 'upgrade', kind: k });
    assert.equal(r.defs.length, 4);
    lockIn(r, a.id);
    const ai = r.ais[0];
    let stunned = 0, free = 0;
    for (let i = 0; i < 20 * 30; i++) {
      fake += 50;
      // pin the Opp at the front door, in range of everything
      [ai.x, ai.y] = [cx, cy + 4.6]; ai.path = []; ai.replanAt = Infinity;
      tick(r);
      if (ai.stunUntil > fake / 1000) stunned++; else free++;
    }
    assert.ok(stunned > 0, "defences do stun it");
    assert.ok(free > 20 * 10, `the Opp gets real time to act (free ${free / 20}s of 30s)`);
  } finally {
    Date.now = realNow;
  }
});
