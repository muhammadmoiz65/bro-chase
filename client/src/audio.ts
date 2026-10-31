// Synthesized sound (no audio files): a small mixer with a compressor and a
// generated room reverb, noise-based foley (steps, knocks, smashes), stereo
// panning by position, daytime ambience, and a heartbeat when the monster is near.
// The sfx.* names are used across the client; keep them stable.

let ctx: AudioContext | null = null;
let master: GainNode;
let dry: GainNode;
let wet: GainNode;
let noiseBuf: AudioBuffer;
let ambience: { wind: GainNode; windF: BiquadFilterNode; hum: GainNode } | null = null;

function ac(): AudioContext {
  if (ctx) return ctx;
  const a = new AudioContext();
  ctx = a;
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  master = a.createGain();
  master.gain.value = 0.9;
  master.connect(comp).connect(a.destination);
  dry = a.createGain();
  dry.connect(master);
  // generated impulse response: short, dark, a little roomy
  const len = Math.floor(a.sampleRate * 1.3);
  const ir = a.createBuffer(2, len, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  const conv = a.createConvolver();
  conv.buffer = ir;
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  wet = a.createGain();
  wet.gain.value = 0.22;
  wet.connect(conv).connect(lp).connect(master);
  noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  return a;
}

/** Route a node to the mix with optional pan and reverb amount. */
function out(node: AudioNode, pan = 0, verb = 0.3) {
  const a = ac();
  let n: AudioNode = node;
  if (pan) {
    const p = a.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    n.connect(p);
    n = p;
  }
  n.connect(dry);
  if (verb > 0) {
    const s = a.createGain();
    s.gain.value = verb;
    n.connect(s).connect(wet);
  }
}

interface ToneOpts { type?: OscillatorType; vol?: number; slide?: number; pan?: number; verb?: number; attack?: number; delay?: number }

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.15, slide = 0, o: ToneOpts = {}) {
  try {
    const a = ac();
    const t0 = a.currentTime + (o.delay ?? 0);
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    const at = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    out(g, o.pan, o.verb ?? 0.25);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch { /* audio blocked */ }
}

/** Filtered noise burst: the base of all foley. */
function noise(dur: number, freq: number, q: number, vol: number, o: { type?: BiquadFilterType; pan?: number; verb?: number; sweep?: number; delay?: number; attack?: number } = {}) {
  try {
    const a = ac();
    const t0 = a.currentTime + (o.delay ?? 0);
    const src = a.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = a.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(freq, t0);
    if (o.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + o.sweep), t0 + dur);
    f.Q.value = q;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g);
    out(g, o.pan, o.verb ?? 0.2);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  } catch { /* audio blocked */ }
}

const thud = (f: number, vol: number, pan = 0, delay = 0) => {
  tone(f, 0.14, 'sine', vol, -f * 0.5, { pan, delay, verb: 0.35 });
  noise(0.07, 900, 1.2, vol * 0.5, { pan, delay, verb: 0.35 });
};

export const sfx = {
  unlock() { try { void ac().resume(); startAmbience(); } catch { /* ignore */ } },
  knock(pan = 0) { thud(150, 0.35, pan); thud(140, 0.32, pan, 0.16); thud(145, 0.3, pan, 0.3); },
  smash(pan = 0) {
    noise(0.35, 1800, 0.7, 0.4, { pan, sweep: -1400, verb: 0.45 });
    tone(80, 0.3, 'sine', 0.35, -40, { pan });
    for (let i = 0; i < 4; i++) noise(0.05, 2500 + Math.random() * 2000, 4, 0.15, { pan, delay: 0.05 + Math.random() * 0.2 });
  },
  door(pan = 0) { noise(0.4, 500, 2, 0.12, { pan, sweep: 600, attack: 0.05 }); thud(120, 0.15, pan, 0.35); },
  caught() {
    tone(500, 0.6, 'sawtooth', 0.14, -420, { verb: 0.5 });
    tone(62, 0.8, 'sine', 0.4, -20);
    noise(0.6, 400, 0.6, 0.2, { sweep: -300, verb: 0.5 });
  },
  mog(pan = 0) {
    tone(900, 0.25, 'square', 0.07, 600, { pan });
    tone(1800, 0.35, 'sine', 0.08, 1200, { pan, verb: 0.6 });
    noise(0.3, 6000, 0.8, 0.12, { pan, type: 'highpass' });
  },
  revive() {
    [440, 554, 660, 880].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, 0, { delay: i * 0.08, verb: 0.5 }));
  },
  jump() { tone(300, 0.14, 'sine', 0.06, 220); noise(0.12, 1200, 1, 0.04, { sweep: 1500 }); },
  land(vol = 1) { thud(90, 0.18 * vol); noise(0.12, 600, 0.8, 0.08 * vol); },
  light() { tone(1200, 0.06, 'triangle', 0.05); noise(0.03, 4000, 2, 0.04); },
  event() {
    tone(220, 0.5, 'sawtooth', 0.09, 0, { verb: 0.5 });
    tone(180, 0.6, 'sawtooth', 0.09, 0, { delay: 0.3, verb: 0.5 });
  },
  /** Footstep: soft filtered noise + a low knock, panned by where it happened. */
  step(vol: number, pan = 0) {
    noise(0.07, 700 + Math.random() * 400, 1.4, 0.12 * vol, { pan, verb: 0.15 });
    tone(80 + Math.random() * 25, 0.05, 'sine', 0.08 * vol, -20, { pan, verb: 0 });
  },
  bark(pan = 0) { tone(420, 0.09, 'sawtooth', 0.1, -200, { pan }); tone(400, 0.1, 'sawtooth', 0.1, -200, { pan, delay: 0.18 }); },
  meow(pan = 0) { tone(700, 0.35, 'triangle', 0.08, 300, { pan, attack: 0.05 }); },
  auraUp() { tone(880, 0.12, 'triangle', 0.07, 300); tone(1320, 0.18, 'sine', 0.05, 200, { delay: 0.06, verb: 0.5 }); },
  auraDown() { tone(300, 0.2, 'square', 0.05, -150); },
  cash() { [1318, 1760, 2093].forEach((f, i) => tone(f, 0.12, 'triangle', 0.06, 0, { delay: i * 0.05, verb: 0.4 })); },
  buy() { tone(660, 0.08, 'square', 0.05); tone(990, 0.15, 'triangle', 0.06, 0, { delay: 0.07 }); },
  click() { noise(0.02, 3000, 3, 0.06, { verb: 0 }); },
  whoosh() { noise(0.25, 600, 0.8, 0.1, { sweep: 2400, attack: 0.08 }); },
  shot(pan = 0) { noise(0.08, 2200, 0.9, 0.12, { pan, sweep: -1500 }); tone(220, 0.06, 'square', 0.04, -100, { pan }); },
  powerDown() {
    tone(120, 1.2, 'sawtooth', 0.12, -90, { verb: 0.5 });
    noise(0.15, 5000, 1, 0.15, { type: 'highpass' });
    noise(0.12, 4000, 1, 0.1, { type: 'highpass', delay: 0.2 });
  },
  powerUp() { tone(60, 0.9, 'sawtooth', 0.08, 60, { attack: 0.3, verb: 0.4 }); tone(880, 0.2, 'sine', 0.05, 0, { delay: 0.7 }); },
  bass(pan = 0) { tone(55, 0.6, 'sine', 0.4, -20, { pan, verb: 0.2 }); tone(110, 0.25, 'square', 0.06, -50, { pan }); noise(0.3, 120, 0.7, 0.2, { type: 'lowpass', pan }); },
  /** Announcer sting: bigger tier = bigger chord, more bass and a riser. */
  sting(tier: number) {
    const root = 220 * Math.pow(2, Math.min(tier, 5) / 12);
    const chord = tier >= 4 ? [1, 1.26, 1.5, 2, 2.52] : tier >= 2 ? [1, 1.26, 1.5, 2] : [1.5, 2];
    chord.forEach((m, i) => tone(root * m, 0.5 + tier * 0.08, 'sawtooth', 0.035, 0, { delay: i * 0.025, verb: 0.6, attack: 0.01 }));
    if (tier >= 2) { tone(55, 0.5, 'sine', 0.3 + tier * 0.04, -15); noise(0.4, 300, 0.6, 0.12, { sweep: 4000, attack: 0.15, delay: 0 }); }
    if (tier >= 4) noise(0.6, 6000, 0.5, 0.08, { type: 'highpass', verb: 0.8, delay: 0.05 });
  },
  /** The Opp's echo screech: a falling shriek. */
  screech(vol = 1) { tone(1400, 0.5, 'sawtooth', 0.12 * vol, -1100, { verb: 0.6 }); tone(900, 0.4, 'square', 0.06 * vol, -600, { delay: 0.09, verb: 0.6 }); },
  /** A vent grate clanking. */
  vent(vol = 1, pan = 0) {
    tone(220, 0.08, 'square', 0.14 * vol, -80, { pan, verb: 0.5 });
    tone(160, 0.1, 'square', 0.12 * vol, -60, { pan, delay: 0.09, verb: 0.5 });
    noise(0.12, 2200, 3, 0.18 * vol, { pan, delay: 0.2, verb: 0.5 });
  },
  ping() { tone(1800, 0.08, 'sine', 0.06, 0, { verb: 0.4 }); },
  lunge() { tone(160, 0.25, 'sawtooth', 0.12, 260); noise(0.25, 800, 0.8, 0.1, { sweep: 2000 }); },
  /** A heartbeat thump; louder when a bro is close. */
  beat(vol: number) { tone(58, 0.11, 'sine', 0.35 * vol, 0, { verb: 0 }); tone(50, 0.13, 'sine', 0.28 * vol, 0, { delay: 0.15, verb: 0 }); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, 'triangle', 0.13, 0, { delay: i * 0.14, verb: 0.5 })); },
  lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.45, 'sawtooth', 0.08, 0, { delay: i * 0.18, verb: 0.5 })); },
};

// ----- ambience: wind, birds in daylight, mains hum, all very quiet -----

function startAmbience() {
  if (ambience) return;
  const a = ac();
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const windF = a.createBiquadFilter();
  windF.type = 'lowpass';
  windF.frequency.value = 380;
  const wind = a.createGain();
  wind.gain.value = 0.025;
  src.connect(windF).connect(wind);
  out(wind, 0, 0);
  src.start();
  const osc = a.createOscillator();
  osc.frequency.value = 60;
  const hum = a.createGain();
  hum.gain.value = 0.006;
  osc.connect(hum);
  out(hum, 0, 0);
  osc.start();
  ambience = { wind, windF, hum };
}

let nextBird = 0;
let beatAt = 0;

/**
 * Call every frame. `danger` 0..1 (monster closeness) drives a heartbeat;
 * daylight gets the odd bird chirp, power cuts kill the mains hum and raise the wind.
 */
export function ambient(power: boolean, danger: number) {
  if (!ctx || !ambience) return;
  const now = ctx.currentTime;
  ambience.hum.gain.setTargetAtTime(power ? 0.006 : 0, now, 0.2);
  ambience.wind.gain.setTargetAtTime(power ? 0.022 : 0.05, now, 1);
  ambience.windF.frequency.setTargetAtTime(300 + Math.sin(now * 0.3) * 120, now, 0.5);
  if (power && now > nextBird) {
    nextBird = now + 2 + Math.random() * 6;
    const f = 2400 + Math.random() * 1600, pan = Math.random() * 2 - 1;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) tone(f, 0.07, 'sine', 0.018, 600, { delay: i * 0.11, pan, verb: 0.6 });
  }
  if (danger > 0.05) {
    const interval = 1.1 - danger * 0.6;
    if (now > beatAt) {
      beatAt = now + interval;
      const v = 0.12 + danger * 0.3;
      tone(55, 0.16, 'sine', v, -15, { verb: 0 });
      tone(50, 0.18, 'sine', v * 0.8, -15, { delay: 0.18, verb: 0 });
    }
  }
}

let voiceOn = true;
let lastChant = 0;
export function setVoice(on: boolean) { voiceOn = on; }

/** The monster mutters when it's close. Uses the browser's speech voice if there is one. */
export function chant(distance: number, lines = ['we outside', 'where you at', 'come out bro', 'we know you lackin']) {
  const now = performance.now();
  if (!voiceOn || distance > 7 || now - lastChant < 3500) return;
  lastChant = now;
  try {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(lines[Math.floor(Math.random() * lines.length)]);
      u.rate = 0.7;
      u.pitch = 0.2;
      u.volume = Math.max(0.15, 1 - distance / 7);
      window.speechSynthesis.speak(u);
      return;
    }
  } catch { /* fall through */ }
  tone(110, 0.3, 'sawtooth', 0.12);
  tone(98, 0.4, 'sawtooth', 0.12, 0, { delay: 0.35 });
}
