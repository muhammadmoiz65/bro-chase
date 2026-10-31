// A small pooled CPU particle system drawn with two THREE.Points batches
// (one alpha-blended for dust and smoke, one additive for sparks and glows).
// World coordinates follow the renderer: x -> x, game y -> z, height -> y.

import * as THREE from 'three';

export type Preset =
  | 'dust' // footstep puff
  | 'land' // bigger puff when landing a jump
  | 'splinter' // door smash: wood chips
  | 'sparks' // electrical / impact sparks
  | 'mog' // ring-light stun flash
  | 'cash' // green sparkle when cash is picked up
  | 'aura' // purple sparkle
  | 'sparkle' // generic gold sparkle (upgrades, purchases)
  | 'smoke' // grey smoke puff
  | 'hit' // white impact puff
  | 'confetti' // win celebration
  | 'shot'; // turret muzzle flash

interface P {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; grow: number;
  r: number; g: number; b: number; a: number;
  drag: number; grav: number;
}

interface Spec {
  n: [number, number];
  add: boolean; // additive blending
  colors: number[];
  speed: [number, number];
  up: [number, number];
  life: [number, number];
  size: [number, number];
  grow: number;
  drag: number;
  grav: number;
  spread?: number; // spawn radius
  alpha?: number;
}

const SPECS: Record<Preset, Spec> = {
  dust: { n: [3, 5], add: false, colors: [0xc9b9a0, 0xb0a28c], speed: [0.3, 0.8], up: [0.2, 0.6], life: [0.45, 0.8], size: [0.18, 0.3], grow: 0.6, drag: 3, grav: -0.2, spread: 0.12, alpha: 0.45 },
  land: { n: [10, 14], add: false, colors: [0xc9b9a0, 0xd8ccb8], speed: [1.2, 2.2], up: [0.1, 0.5], life: [0.5, 0.9], size: [0.22, 0.38], grow: 0.9, drag: 4, grav: -0.1, spread: 0.2, alpha: 0.5 },
  splinter: { n: [14, 20], add: false, colors: [0x8a5a2b, 0xb07a3c, 0x5e3b1a], speed: [2, 4.5], up: [2, 4.5], life: [0.6, 1.1], size: [0.07, 0.13], grow: 0, drag: 0.6, grav: 11, spread: 0.3, alpha: 1 },
  sparks: { n: [14, 22], add: true, colors: [0xffd27a, 0xffa040, 0xfff3c4], speed: [2.5, 5.5], up: [1.5, 4], life: [0.25, 0.55], size: [0.06, 0.11], grow: -0.1, drag: 1.5, grav: 9, spread: 0.1, alpha: 1 },
  mog: { n: [22, 30], add: true, colors: [0xfff1d6, 0xffffff, 0xffe08a], speed: [2, 4], up: [0.5, 2.5], life: [0.35, 0.7], size: [0.1, 0.2], grow: -0.1, drag: 3, grav: 0, spread: 0.3, alpha: 1 },
  cash: { n: [10, 14], add: true, colors: [0x5dff8a, 0xb6ffca, 0xffffff], speed: [0.6, 1.6], up: [1.2, 2.6], life: [0.5, 0.9], size: [0.07, 0.13], grow: -0.05, drag: 2, grav: 2, spread: 0.2, alpha: 1 },
  aura: { n: [10, 14], add: true, colors: [0xd9a0ff, 0xb46bff, 0xffffff], speed: [0.6, 1.6], up: [1.2, 2.6], life: [0.5, 0.9], size: [0.07, 0.13], grow: -0.05, drag: 2, grav: 2, spread: 0.2, alpha: 1 },
  sparkle: { n: [14, 20], add: true, colors: [0xffd23f, 0xfff3b0, 0xffffff], speed: [0.8, 2], up: [1.5, 3], life: [0.6, 1], size: [0.07, 0.14], grow: -0.05, drag: 2, grav: 2.5, spread: 0.3, alpha: 1 },
  smoke: { n: [6, 9], add: false, colors: [0x8d8f96, 0x6e7078], speed: [0.2, 0.6], up: [0.6, 1.2], life: [1, 1.6], size: [0.35, 0.55], grow: 1.1, drag: 1.5, grav: -0.3, spread: 0.25, alpha: 0.4 },
  hit: { n: [8, 12], add: false, colors: [0xffffff, 0xe8ecf5], speed: [1.5, 3], up: [0.3, 1.2], life: [0.25, 0.45], size: [0.14, 0.24], grow: 1.2, drag: 5, grav: 0, spread: 0.1, alpha: 0.75 },
  confetti: { n: [40, 55], add: false, colors: [0xff3b6b, 0x3bd1ff, 0xffd23f, 0x4ade80, 0xb46bff], speed: [1.5, 4], up: [4, 7], life: [1.6, 2.4], size: [0.08, 0.13], grow: 0, drag: 1.2, grav: 6, spread: 0.4, alpha: 1 },
  shot: { n: [5, 8], add: true, colors: [0xfff1d6, 0xffd27a], speed: [0.5, 1.5], up: [0, 0.5], life: [0.08, 0.16], size: [0.18, 0.3], grow: -0.5, drag: 6, grav: 0, spread: 0.05, alpha: 1 },
};

const MAX = 1400;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

const VERT = /* glsl */ `
  attribute float size;
  attribute vec4 rgba;
  varying vec4 vColor;
  uniform float scale;
  void main() {
    vColor = rgba;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float soft = smoothstep(1.0, 0.0, r);
    gl_FragColor = vec4(vColor.rgb, vColor.a * soft);
    #include <colorspace_fragment>
  }
`;

class Batch {
  pool: P[] = [];
  geo = new THREE.BufferGeometry();
  pos = new Float32Array(MAX * 3);
  col = new Float32Array(MAX * 4);
  siz = new Float32Array(MAX);
  points: THREE.Points;
  mat: THREE.ShaderMaterial;

  constructor(additive: boolean) {
    for (let i = 0; i < MAX; i++) {
      this.pool.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0, grow: 0, r: 1, g: 1, b: 1, a: 1, drag: 0, grav: 0 });
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('rgba', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { scale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  spawn(): P | null {
    for (const p of this.pool) if (!p.alive) return p;
    return null;
  }

  update(dt: number) {
    let n = 0;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) { p.alive = false; continue; }
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp; p.vz *= damp; p.vy = p.vy * damp - p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      p.size = Math.max(0.005, p.size + p.grow * dt);
      const k = p.life / p.max;
      const fade = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
      this.col[n * 4] = p.r; this.col[n * 4 + 1] = p.g; this.col[n * 4 + 2] = p.b; this.col[n * 4 + 3] = p.a * fade;
      this.siz[n] = p.size;
      n++;
    }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'rgba', 'size']) (this.geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Particles {
  private normal = new Batch(false);
  private additive = new Batch(true);
  private tmp = new THREE.Color();
  /** Floating pollen / dust motes around the camera target in daylight. */
  private motes: THREE.Points;
  private motePos: Float32Array;
  private moteSeed: Float32Array;
  private moteCenter = new THREE.Vector3();
  moteStrength = 1;

  constructor(scene: THREE.Scene) {
    scene.add(this.normal.points, this.additive.points);
    const N = 160;
    this.motePos = new Float32Array(N * 3);
    this.moteSeed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      this.moteSeed[i * 4] = Math.random() * 30 - 15;
      this.moteSeed[i * 4 + 1] = Math.random() * 3 + 0.3;
      this.moteSeed[i * 4 + 2] = Math.random() * 30 - 15;
      this.moteSeed[i * 4 + 3] = Math.random() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.motes = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xfff6d8, size: 0.06, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.motes.frustumCulled = false;
    scene.add(this.motes);
  }

  /** Pixel height of the canvas, so point sizes stay in world units. */
  setViewport(heightPx: number, fovDeg: number) {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.normal.mat.uniforms.scale.value = s;
    this.additive.mat.uniforms.scale.value = s;
  }

  /** Emit a preset at world position (x, height, z). `dir` biases horizontal velocity. */
  burst(preset: Preset, x: number, h: number, z: number, opts: { scale?: number; dir?: [number, number]; color?: number } = {}) {
    const s = SPECS[preset];
    const batch = s.add ? this.additive : this.normal;
    const scale = opts.scale ?? 1;
    const count = Math.round(rnd(s.n[0], s.n[1]) * Math.min(2, Math.max(0.3, scale)));
    for (let i = 0; i < count; i++) {
      const p = batch.spawn();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(s.speed[0], s.speed[1]) * scale;
      const sr = (s.spread ?? 0) * Math.random();
      p.alive = true;
      p.x = x + Math.cos(a) * sr; p.y = h; p.z = z + Math.sin(a) * sr;
      p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp; p.vy = rnd(s.up[0], s.up[1]) * scale;
      if (opts.dir) { p.vx += opts.dir[0] * sp; p.vz += opts.dir[1] * sp; }
      p.life = 0; p.max = rnd(s.life[0], s.life[1]);
      p.size = rnd(s.size[0], s.size[1]) * Math.sqrt(scale); p.grow = s.grow;
      p.drag = s.drag; p.grav = s.grav;
      this.tmp.setHex(opts.color ?? s.colors[Math.floor(Math.random() * s.colors.length)]);
      p.r = this.tmp.r; p.g = this.tmp.g; p.b = this.tmp.b; p.a = s.alpha ?? 1;
    }
  }

  update(dt: number, center: THREE.Vector3, t: number) {
    this.normal.update(dt);
    this.additive.update(dt);
    this.moteCenter.lerp(center, 1 - Math.exp(-dt * 3));
    const N = this.motePos.length / 3;
    for (let i = 0; i < N; i++) {
      const sx = this.moteSeed[i * 4], sy = this.moteSeed[i * 4 + 1], sz = this.moteSeed[i * 4 + 2], ph = this.moteSeed[i * 4 + 3];
      // wrap around the camera target so the field always surrounds the player
      const wx = ((sx + t * 0.25 + Math.sin(t * 0.3 + ph) * 0.6 - this.moteCenter.x) % 30 + 45) % 30 - 15;
      const wz = ((sz + Math.cos(t * 0.25 + ph) * 0.6 - this.moteCenter.z) % 30 + 45) % 30 - 15;
      this.motePos[i * 3] = this.moteCenter.x + wx;
      this.motePos[i * 3 + 1] = sy + Math.sin(t * 0.7 + ph) * 0.25;
      this.motePos[i * 3 + 2] = this.moteCenter.z + wz;
    }
    (this.motes.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    const m = this.motes.material as THREE.PointsMaterial;
    m.opacity += (0.55 * this.moteStrength - m.opacity) * Math.min(1, dt * 2);
    this.motes.visible = m.opacity > 0.02;
  }
}
