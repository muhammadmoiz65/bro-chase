// Captcha for guest sign-up.
// - With TURNSTILE_SITE_KEY + TURNSTILE_SECRET set, guests solve Cloudflare Turnstile.
// - Without them, a built-in proof-of-work check: the browser must find a nonce so that
//   sha256(challenge + nonce) starts with `bits` zero bits. It costs a real browser about
//   a second, and makes scripted mass sign-ups expensive. Challenges are signed and single-use.

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type CaptchaConfig =
  | { kind: 'turnstile'; siteKey: string }
  | { kind: 'pow'; challenge: string; bits: number };

export type CaptchaAnswer = { turnstile?: string; challenge?: string; nonce?: string };

const POW_TTL_MS = 5 * 60_000;

export function leadingZeroBits(buf: Buffer): number {
  let n = 0;
  for (const byte of buf) {
    if (byte === 0) { n += 8; continue; }
    return n + Math.clz32(byte) - 24;
  }
  return n;
}

export class Captcha {
  private secret = randomBytes(32);
  private used = new Map<string, number>(); // challenge -> expiry
  readonly bits: number;
  readonly siteKey = process.env.TURNSTILE_SITE_KEY ?? '';
  private readonly turnstileSecret = process.env.TURNSTILE_SECRET ?? '';
  readonly disabled: boolean;

  constructor(opts: { bits?: number; disabled?: boolean } = {}) {
    this.bits = opts.bits ?? Number(process.env.POW_BITS ?? 16);
    this.disabled = !!opts.disabled;
  }

  get usesTurnstile() { return !!(this.siteKey && this.turnstileSecret); }

  issue(): CaptchaConfig {
    if (this.usesTurnstile) return { kind: 'turnstile', siteKey: this.siteKey };
    const body = `${Date.now() + POW_TTL_MS}.${randomBytes(12).toString('hex')}`;
    const sig = createHmac('sha256', this.secret).update(body).digest('hex').slice(0, 32);
    return { kind: 'pow', challenge: `${body}.${sig}`, bits: this.bits };
  }

  async verify(ans: CaptchaAnswer | undefined, ip?: string): Promise<boolean> {
    if (this.disabled) return true;
    if (!ans || typeof ans !== 'object') return false;
    if (this.usesTurnstile) return this.verifyTurnstile(ans.turnstile, ip);
    return this.verifyPow(ans.challenge, ans.nonce);
  }

  private verifyPow(challenge: unknown, nonce: unknown): boolean {
    if (typeof challenge !== 'string' || typeof nonce !== 'string' || nonce.length > 32) return false;
    const [exp, rand, sig] = challenge.split('.');
    if (!exp || !rand || !sig) return false;
    const want = createHmac('sha256', this.secret).update(`${exp}.${rand}`).digest('hex').slice(0, 32);
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
    const t = Date.now();
    if (Number(exp) < t) return false;
    for (const [c, e] of this.used) if (e < t) this.used.delete(c);
    if (this.used.has(challenge)) return false;
    const hash = createHash('sha256').update(challenge + nonce).digest();
    if (leadingZeroBits(hash) < this.bits) return false;
    this.used.set(challenge, Number(exp));
    return true;
  }

  private async verifyTurnstile(token: unknown, ip?: string): Promise<boolean> {
    if (typeof token !== 'string' || !token || token.length > 4096) return false;
    try {
      const body = new URLSearchParams({ secret: this.turnstileSecret, response: token });
      if (ip) body.set('remoteip', ip);
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
      const j = (await r.json()) as { success?: boolean };
      return !!j.success;
    } catch {
      return false;
    }
  }
}

/** Solve a proof-of-work challenge (used by tests and bots we run ourselves). */
export function solvePow(challenge: string, bits: number): string {
  for (let n = 0; ; n++) {
    const nonce = n.toString(36);
    if (leadingZeroBits(createHash('sha256').update(challenge + nonce).digest()) >= bits) return nonce;
  }
}
