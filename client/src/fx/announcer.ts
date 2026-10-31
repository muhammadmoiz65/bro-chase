// Announcer: big animated callouts for streaks ("DOUBLE MOG", "MULTI MOG",
// "MONSTER MOG"...), sprees, first mog of the night, and Opp catch streaks.
// Self-contained: injects its own overlay and CSS, plays a synthesized sting,
// and says the line with the browser voice when one is available.

import { sfx } from '../audio.ts';

const CSS = `
#announcer { position: fixed; left: 0; right: 0; top: 17%; display: flex; flex-direction: column; align-items: center;
  pointer-events: none; z-index: 40; gap: 6px; }
#announcer .call { font: 900 clamp(34px, 6.5vw, 76px)/1 Inter, Arial, sans-serif; letter-spacing: 0.04em; text-transform: uppercase;
  color: #fff; -webkit-text-stroke: 2px rgba(0,0,0,0.55); paint-order: stroke fill;
  text-shadow: 0 0 18px var(--glow), 0 0 42px var(--glow), 0 4px 0 rgba(0,0,0,0.35);
  animation: ann-in 0.28s cubic-bezier(.2,1.6,.4,1) both, ann-out 0.45s ease-in 1.9s forwards; }
#announcer .sub { font: 800 clamp(14px, 2vw, 20px)/1.2 Inter, Arial, sans-serif; color: #fff; opacity: 0.92;
  text-shadow: 0 2px 6px rgba(0,0,0,0.6); animation: ann-in 0.3s 0.08s both, ann-out 0.45s ease-in 1.9s forwards; }
#announcer .small { font-size: clamp(20px, 3.2vw, 34px); }
@keyframes ann-in { from { transform: scale(2.4) rotate(-4deg); opacity: 0; filter: blur(6px); } to { transform: none; opacity: 1; filter: none; } }
@keyframes ann-out { to { transform: translateY(-24px) scale(0.92); opacity: 0; } }
#ann-flash { position: fixed; inset: 0; pointer-events: none; z-index: 39; opacity: 0;
  background: radial-gradient(ellipse at center, transparent 40%, var(--glow) 130%); }
#ann-flash.on { animation: ann-flash 0.9s ease-out; }
@keyframes ann-flash { 0% { opacity: 0.9; } 100% { opacity: 0; } }
`;

interface Callout { text: string; sub?: string; color: string; tier: number; small?: boolean; say?: string }

const MOG_STREAK = ['', '', 'DOUBLE MOG', 'TRIPLE MOG', 'MULTI MOG', 'MEGA MOG', 'MONSTER MOG'];
const CATCH_STREAK = ['', '', 'DOUBLE COLLECT', 'TRIPLE COLLECT', 'MULTI COLLECT', 'MONSTER COLLECT'];
const SPREE: Record<number, [string, string]> = {
  3: ['ON A SPREE', '3 mogs without getting caught'],
  5: ['AURA FARMING', '5 mogs, still standing'],
  8: ['UNSTOPPABLE', '8 mogs, the Opps are scared'],
  12: ['SIGMA GRINDSET', '12 mogs. Touch grass? Never.'],
  16: ['GODLIKE RIZZ', '16 mogs. Somebody stop them'],
};
const STREAK_WINDOW = 4500; // ms between hits to keep a multi going

export class Announcer {
  private root: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private queue: Callout[] = [];
  private busyUntil = 0;
  private multi = 0;
  private lastHit = 0;
  private spree = 0;
  private catchMulti = 0;
  private lastCatch = 0;
  private firstDone = false;
  /** Called on every callout so the renderer can add screen effects. tier 1..5 */
  onCallout: (tier: number, color: string) => void = () => {};
  voice = true;

  constructor() {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.root = document.createElement('div');
    this.root.id = 'announcer';
    this.flashEl = document.createElement('div');
    this.flashEl.id = 'ann-flash';
    document.body.append(this.flashEl, this.root);
    setInterval(() => this.pump(), 100);
  }

  private spreeOf = new Map<string, number>();

  /**
   * Feed every kill-feed item through here. `me` is your display name.
   * mog: a = who did it (or "Name's Aura Lamp"), b = the Opp. caught: a = the Opp, b = the bro.
   */
  feed(k: string, a: string | undefined, b: string | undefined, me: string) {
    if (k === 'mog' && a) {
      const by = a.endsWith("'s Aura Lamp") ? a.slice(0, -"'s Aura Lamp".length) : a;
      this.spreeOf.set(by, (this.spreeOf.get(by) ?? 0) + 1);
      if (by === me) this.myMog(b ?? 'an Opp');
      else this.otherMog(by);
    } else if (k === 'caught' && b) {
      const had = this.spreeOf.get(b) ?? 0;
      this.spreeOf.set(b, 0);
      if (b === me) this.gotCaught(a ?? 'the Opps');
      else if (a === me) {
        if (had >= 3) this.shutdown(b, had);
        this.myCatch(b);
      }
    }
  }

  /** New night: reset first-mog and sprees. */
  reset() {
    this.firstDone = false;
    this.spree = 0;
    this.multi = 0;
    this.catchMulti = 0;
    this.spreeOf.clear();
  }

  /** You (a bro) stunned an Opp, by ring light or one of your defences. */
  myMog(victim: string) {
    const now = performance.now();
    this.multi = now - this.lastHit < STREAK_WINDOW ? this.multi + 1 : 1;
    this.lastHit = now;
    this.spree++;
    if (!this.firstDone) {
      this.firstDone = true;
      this.push({ text: 'FIRST MOG', sub: `you mogged ${victim}`, color: '#ffd23f', tier: 2, say: 'first mog' });
    }
    if (this.multi >= 2) {
      const name = MOG_STREAK[Math.min(this.multi, MOG_STREAK.length - 1)];
      this.push({ text: name, sub: `${this.multi} Opps in a row`, color: this.multi >= 5 ? '#ff3bd4' : '#3bd1ff', tier: Math.min(5, this.multi), say: name.toLowerCase() });
    } else if (this.firstDone && this.spree > 1 && !SPREE[this.spree]) {
      this.push({ text: 'MOGGED', sub: victim, color: '#fff1d6', tier: 1, small: true });
    }
    const s = SPREE[this.spree];
    if (s) this.push({ text: s[0], sub: s[1], color: '#b46bff', tier: 4, say: s[0].toLowerCase() });
  }

  /** Someone else mogged an Opp: a light callout only on the first mog of the night. */
  otherMog(by: string) {
    if (this.firstDone) return;
    this.firstDone = true;
    this.push({ text: 'FIRST MOG', sub: `${by} drew first`, color: '#ffd23f', tier: 1, small: true });
  }

  /** You got caught: the spree ends. */
  gotCaught(by: string) {
    const lost = this.spree;
    this.spree = 0;
    this.multi = 0;
    this.push({ text: 'COLLECTED', sub: lost >= 3 ? `${by} ended your ${lost}-mog spree` : `${by} got you`, color: '#ff1a3c', tier: 3 });
  }

  /** You (as an Opp) caught a bro. */
  myCatch(victim: string) {
    const now = performance.now();
    this.catchMulti = now - this.lastCatch < STREAK_WINDOW * 1.5 ? this.catchMulti + 1 : 1;
    this.lastCatch = now;
    if (this.catchMulti >= 2) {
      const name = CATCH_STREAK[Math.min(this.catchMulti, CATCH_STREAK.length - 1)];
      this.push({ text: name, sub: `${this.catchMulti} bros in a row`, color: '#ff3b6b', tier: Math.min(5, this.catchMulti + 1), say: name.toLowerCase() });
    } else this.push({ text: 'GOT ONE', sub: victim, color: '#ff3b6b', tier: 2, small: true });
  }

  /** You stunned a bro's spree-ender: shutdown. */
  shutdown(victim: string, spree: number) {
    this.push({ text: 'SHUTDOWN', sub: `you ended ${victim}'s ${spree}-mog spree`, color: '#ff8a3b', tier: 3, say: 'shutdown' });
  }

  private push(c: Callout) {
    // a bigger callout replaces smaller ones still waiting
    this.queue = this.queue.filter((q) => q.tier >= c.tier);
    this.queue.push(c);
    this.pump();
  }

  private pump() {
    const now = performance.now();
    if (now < this.busyUntil || !this.queue.length) return;
    const c = this.queue.shift()!;
    this.busyUntil = now + (c.small ? 900 : 1300);
    this.root.replaceChildren();
    const el = document.createElement('div');
    el.className = 'call' + (c.small ? ' small' : '');
    el.textContent = c.text;
    el.style.setProperty('--glow', c.color);
    this.root.appendChild(el);
    if (c.sub) {
      const s = document.createElement('div');
      s.className = 'sub';
      s.textContent = c.sub;
      this.root.appendChild(s);
    }
    if (c.tier >= 2) {
      this.flashEl.style.setProperty('--glow', c.color);
      this.flashEl.classList.remove('on');
      void this.flashEl.offsetWidth;
      this.flashEl.classList.add('on');
    }
    sfx.sting(c.tier);
    if (c.say && this.voice) this.speak(c.say);
    this.onCallout(c.tier, c.color);
  }

  private speak(text: string) {
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.9;
      u.pitch = 0.5;
      u.volume = 0.9;
      window.speechSynthesis.speak(u);
    } catch { /* no voice */ }
  }
}
