// Tiny synthesized sound effects (no audio files needed) plus the Opp's chant.

let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new AudioContext());

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.15, slide = 0) {
  try {
    const a = ac();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + dur);
  } catch { /* audio blocked */ }
}

export const sfx = {
  unlock() { try { void ac().resume(); } catch { /* ignore */ } },
  knock() { tone(140, 0.12, 'square', 0.2); setTimeout(() => tone(130, 0.12, 'square', 0.2), 160); },
  caught() { tone(500, 0.6, 'sawtooth', 0.15, -420); },
  mog() { tone(900, 0.25, 'square', 0.1, 600); },
  revive() { tone(440, 0.15, 'sine', 0.15); setTimeout(() => tone(660, 0.2, 'sine', 0.15), 140); },
  jump() { tone(300, 0.12, 'sine', 0.06, 200); },
  light() { tone(1200, 0.06, 'triangle', 0.05); },
  event() { tone(220, 0.4, 'sawtooth', 0.12); setTimeout(() => tone(180, 0.5, 'sawtooth', 0.12), 300); },
  bass() { tone(55, 0.5, 'sine', 0.35, -20); },
  step(vol: number) { tone(90 + Math.random() * 30, 0.05, 'triangle', 0.08 * vol); },
  bark() { tone(420, 0.09, 'sawtooth', 0.12, -200); setTimeout(() => tone(400, 0.1, 'sawtooth', 0.12, -200), 180); },
  meow() { tone(700, 0.35, 'triangle', 0.1, 300); },
  auraUp() { tone(880, 0.12, 'triangle', 0.08, 300); },
  auraDown() { tone(300, 0.2, 'square', 0.06, -150); },
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.15), i * 140)); },
  lose() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'sawtooth', 0.1), i * 180)); },
};

let voiceOn = true;
let lastChant = 0;
export function setVoice(on: boolean) { voiceOn = on; }

/** The Opps call out when they are close. Uses the browser's speech voice if there is one. */
export function chant(distance: number) {
  const now = performance.now();
  if (!voiceOn || distance > 7 || now - lastChant < 3500) return;
  lastChant = now;
  try {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(['we outside', 'where you at', 'come out bro', 'we know you lackin'][Math.floor(Math.random() * 4)]);
      u.rate = 0.7;
      u.pitch = 0.2;
      u.volume = Math.max(0.15, 1 - distance / 7);
      window.speechSynthesis.speak(u);
      return;
    }
  } catch { /* fall through */ }
  tone(110, 0.3, 'sawtooth', 0.12);
  setTimeout(() => tone(98, 0.4, 'sawtooth', 0.12), 350);
}
