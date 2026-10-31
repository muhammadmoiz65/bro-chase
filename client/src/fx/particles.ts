// A small pooled CPU particle system drawn as two point clouds (one alpha-blended
// for dust and smoke, one additive for sparks and glows), plus floating motes.
// World coordinates follow the renderer: x -> x, game y -> z, height -> y.

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import type { Scene } from '@babylonjs/core/scene';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { lin } from '../bjs/kit.ts';

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
const MOTES = 160;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

Effect.ShadersStore.broPointsVertexShader = `
  precision highp float;
  attribute vec3 position;
  attribute vec4 rgba;
  attribute float size;
  uniform mat4 worldView;
  uniform mat4 projection;
  uniform float scale;
  varying vec4 vColor;
  void main() {
    vColor = rgba;
    vec4 mv = worldView * vec4(position, 1.0);
    gl_PointSize = size * scale / max(0.001, -mv.z);
    gl_Position = projection * mv;
  }
`;
Effect.ShadersStore.broPointsFragmentShader = `
  precision highp float;
  varying vec4 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float soft = smoothstep(1.0, 0.0, r);
    gl_FragColor = vec4(vColor.rgb, vColor.a * soft);
  }
`;

class Cloud {
  pos: Float32Array;
  col: Float32Array;
  siz: Float32Array;
  mesh: Mesh;
  mat: ShaderMaterial;

  constructor(scene: Scene, n: number, additive: boolean, name: string) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.siz = new Float32Array(n);
    this.mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.indices = Array.from({ length: n }, (_, i) => i);
    vd.applyToMesh(this.mesh, true);
    this.mesh.setVerticesData('rgba', this.col, true, 4);
    this.mesh.setVerticesData('size', this.siz, true, 1);
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
    this.mesh.renderingGroupId = 1;
    this.mat = new ShaderMaterial(name, scene, 'broPoints', {
      attributes: ['position', 'rgba', 'size'],
      uniforms: ['worldView', 'projection', 'scale'],
      needAlphaBlending: true,
    });
    this.mat.pointsCloud = true;
    this.mat.backFaceCulling = false;
    this.mat.disableDepthWrite = true;
    this.mat.alphaMode = additive ? 1 : 2; // ADD : COMBINE
    this.mat.setFloat('scale', 600);
    this.mesh.material = this.mat;
  }

  upload() {
    this.mesh.updateVerticesData('position', this.pos);
    this.mesh.updateVerticesData('rgba', this.col);
    this.mesh.updateVerticesData('size', this.siz);
  }
}

class Batch {
  pool: P[] = [];
  cloud: Cloud;

  constructor(scene: Scene, additive: boolean) {
    for (let i = 0; i < MAX; i++) {
      this.pool.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0, grow: 0, r: 1, g: 1, b: 1, a: 1, drag: 0, grav: 0 });
    }
    this.cloud = new Cloud(scene, MAX, additive, additive ? 'fx-add' : 'fx-blend');
  }

  spawn(): P | null {
    for (const p of this.pool) if (!p.alive) return p;
    return null;
  }

  private live = 0;
  update(dt: number) {
    const { pos, col, siz } = this.cloud;
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
      pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
      col[n * 4] = p.r; col[n * 4 + 1] = p.g; col[n * 4 + 2] = p.b; col[n * 4 + 3] = p.a * fade;
      siz[n] = p.size;
      n++;
    }
    // clear the slots that were drawn last frame but are dead now
    for (let i = n; i < this.live; i++) siz[i] = 0;
    const changed = n > 0 || this.live > 0;
    this.live = n;
    this.cloud.mesh.setEnabled(n > 0);
    if (changed) this.cloud.upload();
  }
}

export class Particles {
  private normal: Batch;
  private additive: Batch;
  /** Floating pollen / dust motes around the camera target in daylight. */
  private motes: Cloud;
  private moteSeed: Float32Array;
  private moteCenter = { x: 0, z: 0 };
  private moteOpacity = 0.55;
  moteStrength = 1;

  constructor(scene: Scene) {
    this.normal = new Batch(scene, false);
    this.additive = new Batch(scene, true);
    this.motes = new Cloud(scene, MOTES, true, 'fx-motes');
    this.moteSeed = new Float32Array(MOTES * 4);
    const c = lin(0xfff6d8);
    for (let i = 0; i < MOTES; i++) {
      this.moteSeed[i * 4] = Math.random() * 30 - 15;
      this.moteSeed[i * 4 + 1] = Math.random() * 3 + 0.3;
      this.moteSeed[i * 4 + 2] = Math.random() * 30 - 15;
      this.moteSeed[i * 4 + 3] = Math.random() * 100;
      this.motes.col.set([c.r, c.g, c.b, 0.55], i * 4);
      this.motes.siz[i] = 0.06;
    }
  }

  /** Pixel height of the canvas, so point sizes stay in world units. */
  setViewport(heightPx: number, fovRad: number) {
    const s = heightPx / (2 * Math.tan(fovRad / 2));
    for (const c of [this.normal.cloud, this.additive.cloud, this.motes]) c.mat.setFloat('scale', s);
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
      const c = lin(opts.color ?? s.colors[Math.floor(Math.random() * s.colors.length)]);
      p.r = c.r; p.g = c.g; p.b = c.b; p.a = s.alpha ?? 1;
    }
  }

  update(dt: number, center: Vector3, t: number) {
    this.normal.update(dt);
    this.additive.update(dt);
    const k = 1 - Math.exp(-dt * 3);
    this.moteCenter.x += (center.x - this.moteCenter.x) * k;
    this.moteCenter.z += (center.z - this.moteCenter.z) * k;
    this.moteOpacity += (0.55 * this.moteStrength - this.moteOpacity) * Math.min(1, dt * 2);
    const on = this.moteOpacity > 0.02;
    this.motes.mesh.setEnabled(on);
    if (!on) return;
    const { pos, col } = this.motes;
    for (let i = 0; i < MOTES; i++) {
      const sx = this.moteSeed[i * 4], sy = this.moteSeed[i * 4 + 1], sz = this.moteSeed[i * 4 + 2], ph = this.moteSeed[i * 4 + 3];
      // wrap around the camera target so the field always surrounds the player
      const wx = ((sx + t * 0.25 + Math.sin(t * 0.3 + ph) * 0.6 - this.moteCenter.x) % 30 + 45) % 30 - 15;
      const wz = ((sz + Math.cos(t * 0.25 + ph) * 0.6 - this.moteCenter.z) % 30 + 45) % 30 - 15;
      pos[i * 3] = this.moteCenter.x + wx;
      pos[i * 3 + 1] = sy + Math.sin(t * 0.7 + ph) * 0.25;
      pos[i * 3 + 2] = this.moteCenter.z + wz;
      col[i * 4 + 3] = this.moteOpacity;
    }
    this.motes.upload();
  }
}
