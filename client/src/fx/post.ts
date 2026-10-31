// Post-processing: HDR render -> bloom -> ACES tone map (Babylon's default pipeline),
// then our colour grade (vignette, contrast, saturation, danger pulse, flashes,
// power-cut flicker, light grain). Drops to cheaper settings by itself if the
// frame rate suffers.

import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { srgb } from '../bjs/kit.ts';
import { Color3 } from '@babylonjs/core/Maths/math.color';

Effect.ShadersStore.broGradeFragmentShader = `
  precision highp float;
  varying vec2 vUV;
  uniform sampler2D textureSampler;
  uniform float time, vignette, saturation, contrast, warmth, exposure, danger, flash, grain, aberration, aspect;
  uniform vec3 flashColor;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec2 c = vUV - 0.5;
    float ab = aberration * dot(c, c);
    vec3 col;
    col.r = texture2D(textureSampler, vUV + c * ab).r;
    col.g = texture2D(textureSampler, vUV).g;
    col.b = texture2D(textureSampler, vUV - c * ab).b;
    col *= exposure;
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
    col += (hash(vUV * 1000.0 + fract(time)) - 0.5) * grain;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

export interface PostState {
  power: boolean;
  rage: boolean;
  fog: boolean;
  monsterView: boolean;
  danger: number; // 0..1, how close the monster is to you
}

export class Post {
  pipeline: DefaultRenderingPipeline;
  private grade: PostProcess;
  private quality: number;
  private forced: boolean;
  private lastDrop = -999;
  private dtSum = 0;
  private dtN = 0;
  private warm = 0; // seconds since start, ignore early hitches
  private flashV = 0;
  private flashDecay = 4;
  private flashColor = new Color3(1, 1, 1);
  private flicker = 0; // seconds left in a power flicker
  private lastPower = true;
  private danger = 0;
  private u = { vignette: 0.26, saturation: 1.12, contrast: 1.06, warmth: 0.03, exposure: 1, danger: 0, flash: 0, grain: 0.022, aberration: 0 };
  private bloomTarget = 0.35;
  private camera: Camera;

  constructor(private engine: AbstractEngine, scene: Scene, camera: Camera, private shadows: ShadowGenerator) {
    const q = new URLSearchParams(location.search).get('fx');
    this.forced = q === '0' || q === '1' || q === '2';
    this.quality = q === '0' ? 0 : q === '1' ? 1 : 2;
    this.pipeline = new DefaultRenderingPipeline('bro', true, scene, [camera]);
    const p = this.pipeline;
    p.imageProcessingEnabled = true;
    p.imageProcessing.toneMappingEnabled = true;
    p.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    p.imageProcessing.exposure = 1.2;
    p.bloomEnabled = true;
    p.bloomThreshold = 1.1;
    p.bloomWeight = 0.35;
    p.bloomKernel = 48;
    p.bloomScale = 0.5;
    this.grade = new PostProcess('grade', 'broGrade',
      ['time', 'vignette', 'saturation', 'contrast', 'warmth', 'exposure', 'danger', 'flash', 'grain', 'aberration', 'aspect', 'flashColor'],
      null, 1, camera);
    this.camera = camera;
    this.grade.onApply = (e) => {
      const u = this.u;
      e.setFloat('time', performance.now() / 1000);
      for (const k of Object.keys(u) as Array<keyof typeof u>) e.setFloat(k, u[k]);
      e.setFloat('aspect', engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()));
      e.setColor3('flashColor', this.flashColor);
    };
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
    this.engine.setHardwareScalingLevel(1 / pr);
    this.pipeline.bloomEnabled = this.quality >= 1;
    this.pipeline.bloomScale = this.quality >= 2 ? 0.5 : 0.33;
    this.pipeline.samples = this.quality >= 2 ? 4 : this.quality === 1 ? 2 : 1;
    this.pipeline.fxaaEnabled = this.quality === 0;
    const size = this.quality >= 1 ? 2048 : 1024;
    const map = this.shadows.getShadowMap();
    if (map && map.getSize().width !== size) map.resize(size);
    // the pipeline rebuilds its passes when settings change; our grade must run last (after tone mapping)
    this.camera.detachPostProcess(this.grade);
    this.camera.attachPostProcess(this.grade);
  }

  resize() { /* the engine resizes the pipeline itself */ }

  /** A full-screen tint that fades out. */
  flash(color: number, strength: number, decay = 4) {
    this.flashColor = srgb(color);
    this.flashV = Math.max(this.flashV, strength);
    this.flashDecay = decay;
  }

  update(dt: number, s: PostState) {
    const u = this.u;
    // power cut flicker: lights stutter for a moment when the power goes out or comes back
    if (s.power !== this.lastPower) { this.flicker = s.power ? 0.45 : 0.8; this.lastPower = s.power; }
    let exposure = 1;
    if (this.flicker > 0) {
      this.flicker -= dt;
      const t = performance.now();
      exposure = (Math.sin(t / 23) + Math.sin(t / 61) > 0.2) ? 1.35 : 0.35;
    }
    u.exposure = exposure;

    this.danger += (s.danger - this.danger) * Math.min(1, dt * 3);
    u.danger = this.danger * (s.monsterView ? 0 : 1);
    u.aberration = 0.012 * this.danger + (s.rage ? 0.006 : 0);
    const dark = !s.power;
    u.vignette = dark ? 0.55 : s.monsterView ? 0.45 : 0.26;
    u.saturation = dark ? 0.85 : s.fog ? 0.9 : s.rage ? 1.3 : 1.12;
    u.contrast = dark ? 1.12 : 1.06;
    u.warmth = dark ? -0.025 : s.rage ? 0.06 : 0.03;
    u.grain = dark ? 0.05 : 0.022;
    this.flashV = Math.max(0, this.flashV - dt * this.flashDecay);
    u.flash = this.flashV;
    // lights glow harder in the dark
    this.bloomTarget = dark ? 0.9 : 0.35;
    this.pipeline.bloomWeight += (this.bloomTarget - this.pipeline.bloomWeight) * Math.min(1, dt * 3);
    this.pipeline.bloomThreshold = dark ? 0.6 : 1.1;
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
