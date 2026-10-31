// Post-processing: HDR render -> bloom -> tone map -> colour grade (vignette,
// contrast, saturation, danger pulse, flashes, power-cut flicker, light grain).
// Drops to cheaper settings by itself if the frame rate suffers.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const GradeShader = {
  name: 'BroGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    vignette: { value: 0.28 },
    saturation: { value: 1.12 },
    contrast: { value: 1.06 },
    warmth: { value: 0.03 },
    exposure: { value: 1 },
    danger: { value: 0 },
    flashColor: { value: new THREE.Color(1, 1, 1) },
    flash: { value: 0 },
    grain: { value: 0.025 },
    aberration: { value: 0 },
    aspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, vignette, saturation, contrast, warmth, exposure, danger, flash, grain, aberration, aspect;
    uniform vec3 flashColor;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float ab = aberration * dot(c, c);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ab).b;
      col *= exposure;
      // grade
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.5) * contrast + 0.5;
      col += vec3(warmth, warmth * 0.35, -warmth);
      // vignette (wider on the horizontal so the HUD corners stay readable)
      vec2 v = c * vec2(aspect * 0.75, 1.0);
      float vig = smoothstep(0.85, 0.2, length(v));
      col *= mix(1.0 - vignette, 1.0, vig);
      // danger: a red pulse that creeps in from the edges
      float pulse = 0.65 + 0.35 * sin(time * 7.0);
      col = mix(col, vec3(0.55, 0.02, 0.06), danger * pulse * (1.0 - vig) * 0.7);
      // flashes (hits, mogs, pickups)
      col = mix(col, flashColor, flash * (0.35 + 0.65 * (1.0 - vig)));
      // film grain
      col += (hash(vUv * 1000.0 + fract(time)) - 0.5) * grain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export interface PostState {
  power: boolean;
  rage: boolean;
  fog: boolean;
  monsterView: boolean;
  danger: number; // 0..1, how close the monster is to you
}

export class Post {
  composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private quality: number;
  private forced: boolean;
  private lastDrop = -999;
  private scene: THREE.Scene;
  private dtSum = 0;
  private dtN = 0;
  private warm = 0; // seconds since start, ignore early hitches
  private flashV = 0;
  private flashDecay = 4;
  private flicker = 0; // seconds left in a power flicker
  private lastPower = true;
  private danger = 0;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    const q = new URLSearchParams(location.search).get('fx');
    this.forced = q === '0' || q === '1' || q === '2';
    this.quality = q === '0' ? 0 : q === '1' ? 1 : 2;
    // PCF (not PCFSoft) is much cheaper; the light's shadow.radius still softens it
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.applyQuality();
  }

  /**
   * 2 = high: up to 1.5x pixel ratio (Retina is 2x, which is 78% more pixels for little gain), 4x MSAA, bloom.
   * 1 = medium: 1x pixel ratio, 2x MSAA, bloom at low res.
   * 0 = low: 1x pixel ratio, no MSAA, no bloom, smaller shadow map.
   */
  private applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    const pr = this.quality >= 2 ? Math.min(dpr, 1.5) : this.quality === 1 ? Math.min(dpr, 1) : Math.min(dpr, 0.85);
    this.renderer.setPixelRatio(pr);
    this.bloom.enabled = this.quality >= 1;
    const samples = this.quality >= 2 ? 4 : this.quality === 1 ? 2 : 0;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
    }
    const size = this.quality >= 1 ? 2048 : 1024;
    this.scene.traverse((o) => {
      const l = o as THREE.DirectionalLight;
      if (l.isDirectionalLight && l.castShadow && l.shadow.mapSize.x !== size) {
        l.shadow.mapSize.set(size, size);
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    });
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const bw = this.quality >= 2 ? 0.5 : 0.33;
    this.bloom.resolution.set(w * bw, h * bw);
    this.grade.uniforms.aspect.value = w / h;
  }

  /** A full-screen tint that fades out. */
  flash(color: number, strength: number, decay = 4) {
    (this.grade.uniforms.flashColor.value as THREE.Color).setHex(color);
    this.flashV = Math.max(this.flashV, strength);
    this.flashDecay = decay;
  }

  render(dt: number, s: PostState) {
    const u = this.grade.uniforms;
    u.time.value = performance.now() / 1000;

    // power cut flicker: lights stutter for a moment when the power goes out or comes back
    if (s.power !== this.lastPower) { this.flicker = s.power ? 0.45 : 0.8; this.lastPower = s.power; }
    let exposure = 1;
    if (this.flicker > 0) {
      this.flicker -= dt;
      const t = performance.now();
      exposure = (Math.sin(t / 23) + Math.sin(t / 61) > 0.2) ? 1.35 : 0.35;
    }
    u.exposure.value = exposure;

    this.danger += (s.danger - this.danger) * Math.min(1, dt * 3);
    u.danger.value = this.danger * (s.monsterView ? 0 : 1);
    u.aberration.value = 0.012 * this.danger + (s.rage ? 0.006 : 0);
    const dark = !s.power;
    u.vignette.value = dark ? 0.55 : s.monsterView ? 0.45 : 0.26;
    u.saturation.value = dark ? 0.85 : s.fog ? 0.9 : s.rage ? 1.3 : 1.12;
    u.contrast.value = dark ? 1.12 : 1.06;
    u.warmth.value = dark ? -0.025 : s.rage ? 0.06 : 0.03;
    u.grain.value = dark ? 0.05 : 0.022;
    this.flashV = Math.max(0, this.flashV - dt * this.flashDecay);
    u.flash.value = this.flashV;
    // lights glow harder in the dark
    const bs = dark ? 0.9 : 0.35;
    this.bloom.strength += (bs - this.bloom.strength) * Math.min(1, dt * 3);
    this.bloom.threshold = dark ? 0.6 : 0.92;

    this.composer.render(dt);
    this.adapt(dt);
  }

  /** Watch the frame rate: step down fast when it drops under ~50 fps, step back up slowly when there is headroom. */
  private adapt(dt: number) {
    this.warm += dt;
    if (this.warm < 2 || this.forced) return;
    this.dtSum += dt;
    this.dtN++;
    if (this.dtSum < 1.5) return;
    const avg = this.dtSum / this.dtN;
    this.dtSum = 0;
    this.dtN = 0;
    if (avg > 1 / 50 && this.quality > 0) {
      this.quality--;
      this.lastDrop = this.warm;
      this.applyQuality();
    } else if (avg < 1 / 58 && this.quality < 2 && this.warm - this.lastDrop > 30) {
      this.quality++;
      this.lastDrop = this.warm; // wait again before the next step up
      this.applyQuality();
    }
  }
}
