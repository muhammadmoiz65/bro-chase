// One entry point for all visual effects: post-processing, particles,
// camera shake, environment lighting and small world animations.
//
// Renderer usage:
//   this.fx = new FX(engine, scene, camera, shadows);   // constructor
//   this.fx.update(dt, { power, rage, fog, monsterView, danger, focus });  // every frame, after placing the camera
// Gameplay usage (anywhere): renderer.fx.particles.burst('sparks', x, 0.5, y); renderer.fx.shake(0.4); renderer.fx.flash(0xff0000, 0.5)

import type { Scene } from '@babylonjs/core/scene';
import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HDRCubeTexture } from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import { Particles } from './particles.ts';
import { Post, type PostState } from './post.ts';

export type { Preset } from './particles.ts';

export interface FxState extends PostState {
  focus: { x: number; y: number };
}

export class FX {
  particles: Particles;
  post: Post;
  private trauma = 0;
  private center = new Vector3();
  private hitStop = 0;

  constructor(private engine: AbstractEngine, private scene: Scene, private camera: FreeCamera, shadows: ShadowGenerator) {
    // soft image-based light so PBR materials get believable highlights and reflections
    scene.environmentTexture = new HDRCubeTexture('/env/sky.hdr', scene, 128, false, true, false, true);
    scene.environmentIntensity = 0.35;
    this.particles = new Particles(scene);
    this.post = new Post(engine, scene, camera, shadows);
    this.resize();
  }

  resize() {
    this.post.resize();
    this.particles.setViewport(this.engine.getRenderHeight(), this.camera.fov);
  }

  /** Add camera shake. 0.2 = bump, 0.5 = smash, 1 = caught. */
  shake(amount: number) { this.trauma = Math.min(1, this.trauma + amount); }

  /** Freeze particle motion for a few frames on a big hit (sells the impact). */
  freeze(sec = 0.06) { this.hitStop = Math.max(this.hitStop, sec); }

  flash(color: number, strength = 0.5, decay = 4) { this.post.flash(color, strength, decay); }

  /** Call once per frame after the camera has been placed (before the scene renders). */
  update(dt: number, s: FxState) {
    const t = performance.now() / 1000;

    // shake (the renderer re-places the camera every frame, so we only add): trauma squared, smooth noise, decays over ~0.6 s
    const k = this.trauma * this.trauma;
    this.camera.position.x += (Math.sin(t * 47.3) + Math.sin(t * 31.1)) * 0.5 * k * 0.35;
    this.camera.position.y += Math.sin(t * 53.7) * k * 0.2;
    this.camera.position.z += (Math.sin(t * 41.9) + Math.sin(t * 27.3)) * 0.5 * k * 0.35;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);

    // environment light follows the mood
    const envTarget = !s.power ? 0.06 : s.fog ? 0.25 : 0.35;
    this.scene.environmentIntensity += (envTarget - this.scene.environmentIntensity) * Math.min(1, dt * 2);

    this.center.set(s.focus.x, 0, s.focus.y);
    this.particles.moteStrength = s.power && !s.fog ? 1 : 0.25;
    const pdt = this.hitStop > 0 ? dt * 0.1 : dt;
    this.hitStop = Math.max(0, this.hitStop - dt);
    this.particles.update(pdt, this.center, t);

    this.post.update(dt, s);
  }
}
