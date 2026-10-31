import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { Room } from '../server/game.ts';
import { startServer } from '../server/index.ts';
import { solvePow } from '../server/captcha.ts';
import { doorCenter } from '../shared/world.ts';
import type { ServerMsg } from '../shared/protocol.ts';

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

function joinN(r: Room, n: number, role: 'bro' | 'collector' = 'bro') {
  const out: Array<{ id: string; ws: FakeWs }> = [];
  for (let i = 0; i < n; i++) {
    const ws = new FakeWs();
    const id = `p${r.players.size + 1}`;
    r.join(id, `Bro${id}`, ws as any, role);
    out.push({ id, ws });
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

test('one Bill Collector per 4 bros (rounded up), AI fills the slots', () => {
  const r = makeRoom();
  joinN(r, 9);
  lockIn(r, 'p1');
  assert.equal(r.phase, 'lockin');
  assert.equal(r.ais.length, 3); // ceil(9 / 4)
});

test('a player can only be a Bill Collector while the 4:1 ratio holds', () => {
  const r = makeRoom();
  const [solo] = joinN(r, 1, 'collector');
  assert.equal(r.players.get(solo.id)!.role, 'bro');
  assert.match(solo.ws.last('welcome')!.notice!, /4 bros/);
  joinN(r, 3);
  const [monster] = joinN(r, 1, 'collector');
  assert.equal(r.players.get(monster.id)!.role, 'collector');
  lockIn(r, 'p1');
  assert.equal(r.ais.length, 0); // 4 bros -> 1 Bill Collector, already a player
});

test('every bro gets a crib, doors start locked, and the map grows with players', () => {
  const r = makeRoom();
  joinN(r, 12);
  assert.equal(r.cribs.size, 12);
  for (const c of r.cribs.values()) for (const d of c.doors) { assert.equal(d.open, false); assert.equal(d.hp, 100); }
  assert.equal(r.R, 2); // 13 plots need ring 2
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

test('a Bill Collector catches a bro, a lit ring light mogs it, a revive brings the bro back', () => {
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

  // mog: B's ring light stuns a Bill Collector that gets close
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
  assert.ok(pa.jumpT > 0);
  const ai = r.ais[0];
  ai.x = pa.x + 0.2; ai.y = pa.y;
  (r as any).hunterChecks(ai, Date.now() / 1000);
  assert.equal(pa.npc, false);
});

test('power failure is fixed by repairing the generator', () => {
  const r = makeRoom();
  const [a] = joinN(r, 1);
  lockIn(r, a.id);
  r.ev.power = false;
  r.ev.mode = 'blackout';
  r.ev.modeEnd = Infinity;
  const pa = r.players.get(a.id)!;
  pa.x = 1.5; pa.y = 1.6; // next to the generator in the plaza
  r.handle(a.id, { t: 'repair', on: true });
  tick(r, 4 * 20 + 2);
  assert.equal(r.ev.power, true);
});

test('chat is broadcast, trimmed and rate limited', () => {
  const r = makeRoom();
  const [a, b] = joinN(r, 2);
  r.handle(a.id, { t: 'chat', text: '  six seven  ' });
  assert.equal(b.ws.last('chat')!.text, 'six seven');
  for (let i = 0; i < 6; i++) r.handle(a.id, { t: 'chat', text: `spam ${i}` });
  assert.match(a.ws.last('chat')!.text, /Slow down/);
});

test('scoreboard lists players and AI Bill Collectors', () => {
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
