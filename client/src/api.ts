// Account + lobby API. The device token lives in localStorage: that is what binds
// a guest account to this device.

export interface Account {
  id: string;
  name: string;
  username: string | null;
  hasPassword: boolean;
  stats: { nights: number; wins: number; catches: number; mogs: number; revives: number };
}

const TOKEN_KEY = 'brochase.token';

function store(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
export const getToken = () => store()?.getItem(TOKEN_KEY) ?? null;
export const setToken = (t: string | null) => {
  try { if (t) store()?.setItem(TOKEN_KEY, t); else store()?.removeItem(TOKEN_KEY); } catch { /* private mode */ }
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  me: () => call<{ account: Account; devices: number }>('GET', '/api/me'),
  captcha: () => call<{ kind: 'pow'; challenge: string; bits: number } | { kind: 'turnstile'; siteKey: string }>('GET', '/api/captcha'),
  guest: (captcha: unknown, name?: string) => call<{ token: string; account: Account }>('POST', '/api/guest', { captcha, name }),
  setName: (name: string) => call<{ account: Account }>('POST', '/api/me/name', { name }),
  credentials: (username: string, password: string, currentPassword?: string) =>
    call<{ account: Account }>('POST', '/api/me/credentials', { username, password, currentPassword }),
  login: (username: string, password: string) => call<{ token: string; account: Account }>('POST', '/api/login', { username, password }),
  logout: () => call<{ ok: true }>('POST', '/api/logout', {}),
  lobbies: () => call<{ lobbies: Array<{ code: string; name: string; players: number; phase: string; quick: boolean }> }>('GET', '/api/lobbies'),
};

export function solvePow(challenge: string, bits: number): Promise<string> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { resolve(e.data.nonce); w.terminate(); };
    w.postMessage({ challenge, bits });
  });
}

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; theme?: string }) => void } }
}

export function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the captcha.'));
    document.head.appendChild(s);
  });
}
