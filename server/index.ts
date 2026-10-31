// HTTP API (accounts, lobbies), static client, and the WebSocket game endpoint.

import express from 'express';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { Accounts, AccountError, cleanName } from './accounts.ts';
import { Rooms } from './rooms.ts';
import { Captcha } from './captcha.ts';
import { PHASE_SEC } from '../shared/constants.ts';
import type { ClientMsg, Role } from '../shared/protocol.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface StartOptions {
  port?: number;
  dbFile?: string;
  phaseSec?: typeof PHASE_SEC;
  powBits?: number;
}

export function startServer(opts: StartOptions = {}): Promise<{ server: Server; port: number; close: () => void }> {
  const accounts = new Accounts(opts.dbFile ?? process.env.DB_FILE ?? join(root, 'data', 'bro-chase.db'));
  const captcha = new Captcha({ bits: opts.powBits });
  const rooms = new Rooms((id, s) => accounts.addStats(id, s), opts.phaseSec);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));

  const bearer = (req: express.Request) => {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7) : null;
  };
  const authed = (req: express.Request, res: express.Response) => {
    const acc = accounts.byToken(bearer(req));
    if (!acc) res.status(401).json({ error: 'Not signed in on this device.' });
    return acc;
  };
  const wrap = (fn: (req: express.Request, res: express.Response) => void | Promise<void>) => async (req: express.Request, res: express.Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof AccountError) res.status(e.status).json({ error: e.message });
      else { console.error(e); res.status(500).json({ error: 'Something broke on our side.' }); }
    }
  };

  // naive login throttle: 10 attempts per minute per IP
  const attempts = new Map<string, number[]>();
  const throttled = (ip: string) => {
    const t = Date.now();
    const list = (attempts.get(ip) ?? []).filter((x) => t - x < 60_000);
    list.push(t);
    attempts.set(ip, list);
    return list.length > 10;
  };

  app.get('/api/captcha', (_req, res) => { res.json(captcha.issue()); });
  app.post('/api/guest', wrap(async (req, res) => {
    if (!(await captcha.verify(req.body?.captcha, req.ip))) {
      res.status(400).json({ error: 'Captcha failed. Prove you are not an NPC and try again.' });
      return;
    }
    const { token, account } = accounts.createGuest(req.body?.name);
    res.json({ token, account });
  }));
  app.get('/api/me', wrap((req, res) => {
    const acc = authed(req, res);
    if (acc) res.json({ account: acc, devices: accounts.devices(acc.id) });
  }));
  app.post('/api/me/name', wrap((req, res) => {
    const acc = authed(req, res);
    if (acc) res.json({ account: accounts.setName(acc.id, req.body?.name) });
  }));
  app.post('/api/me/credentials', wrap((req, res) => {
    const acc = authed(req, res);
    if (acc) res.json({ account: accounts.setCredentials(acc.id, req.body?.username, req.body?.password, req.body?.currentPassword) });
  }));
  app.post('/api/login', wrap((req, res) => {
    if (throttled(req.ip ?? 'x')) { res.status(429).json({ error: 'Too many tries. Wait a minute.' }); return; }
    res.json(accounts.login(req.body?.username, req.body?.password));
  }));
  app.post('/api/logout', wrap((req, res) => {
    const t = bearer(req);
    if (t) accounts.logout(t);
    res.json({ ok: true });
  }));
  app.get('/api/lobbies', (_req, res) => { res.json({ lobbies: rooms.list() }); });
  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });

  const dist = join(root, 'dist', 'client');
  if (existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: 'index.html' }));
    app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
  }

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const acc = accounts.byToken(url.searchParams.get('token'));
    if (!acc) { ws.close(4001, 'not signed in'); return; }
    const mode = url.searchParams.get('mode') ?? 'quick';
    const role: Role = url.searchParams.get('role') === 'sixseven' ? 'sixseven' : 'bro';
    let room = rooms.quick;
    try {
      if (mode === 'create') {
        const name = cleanName(url.searchParams.get('name')) ?? `${acc.name}'s lobby`;
        room = rooms.create(name, url.searchParams.get('priv') === '1', acc.id);
      } else if (mode === 'join') {
        const found = rooms.get(url.searchParams.get('code') ?? '');
        if (!found) { ws.close(4004, 'No lobby with that code.'); return; }
        room = found;
      }
    } catch (e) {
      ws.close(4005, (e as Error).message.slice(0, 100));
      return;
    }
    room.join(acc.id, acc.name, ws, role);
    ws.on('message', (data) => {
      let msg: ClientMsg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      room.handle(acc.id, msg);
    });
    ws.on('close', () => room.leave(acc.id, ws));
    ws.on('error', () => {});
  });

  return new Promise((resolve) => {
    server.listen(opts.port ?? Number(process.env.PORT ?? 3000), () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        server, port,
        close: () => { rooms.stopAll(); wss.close(); server.close(); },
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().then(({ port }) => console.log(`Bro Chase server on http://localhost:${port}`));
}
