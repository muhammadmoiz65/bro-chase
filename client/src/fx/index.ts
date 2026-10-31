// One entry point for all visual effects: post-processing, particles,
// camera shake, environment lighting and small world animations.
//
// Renderer usage:
//   this.fx = new FX(this.renderer, this.scene, this.camera);   // constructor
//   this.fx.resize();                                           // on resize
//   this.fx.render(dt, { power, rage, fog, monsterView, danger, focus });  // instead of renderer.render
// Gameplay usage (anywhere): renderer.fx.particles.burst('sparks', x, 0.5, y); renderer.fx.shake(0.4); renderer.fx.flash(0xff0000, 0.5)

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
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
  private shakeOff = new THREE.Vector3();
  private center = new THREE.Vector3();
  private hitStop = 0;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    // soft image-based light so standard materials get believable highlights and reflections
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    pmrem.dispose();
    this.particles = new Particles(scene);
    this.post = new Post(renderer, scene, camera);
    this.particles.setViewport(window.innerHeight, camera.fov);
  }

  resize() {
    this.post.resize();
    this.particles.setViewport(window.innerHeight, this.camera.fov);
  }

  /** Add camera shake. 0.2 = bump, 0.5 = smash, 1 = caught. */
  shake(amount: number) { this.trauma = Math.min(1, this.trauma + amount); }

  /** Freeze particle motion for a few frames on a big hit (sells the impact). */
  freeze(sec = 0.06) { this.hitStop = Math.max(this.hitStop, sec); }

  flash(color: number, strength = 0.5, decay = 4) { this.post.flash(color, strength, decay); }

  /** Call once per frame after the camera has been placed; draws the frame. */
  render(dt: number, s: FxState) {
    const t = performance.now() / 1000;

    // shake (the renderer re-places the camera every frame, so we only add): trauma squared, smooth noise, decays over ~0.6 s
    const k = this.trauma * this.trauma;
    this.shakeOff.set(
      (Math.sin(t * 47.3) + Math.sin(t * 31.1)) * 0.5 * k * 0.35,
      Math.sin(t * 53.7) * k * 0.2,
      (Math.sin(t * 41.9) + Math.sin(t * 27.3)) * 0.5 * k * 0.35,
    );
    this.camera.position.add(this.shakeOff);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);

    // environment light follows the mood
    const envTarget = !s.power ? 0.06 : s.fog ? 0.25 : 0.35;
    this.scene.environmentIntensity += (envTarget - this.scene.environmentIntensity) * Math.min(1, dt * 2);

    this.center.set(s.focus.x, 0, s.focus.y);
    this.particles.moteStrength = s.power && !s.fog ? 1 : 0.25;
    const pdt = this.hitStop > 0 ? dt * 0.1 : dt;
    this.hitStop = Math.max(0, this.hitStop - dt);
    this.particles.update(pdt, this.center, t);

    this.post.render(dt, s);
  }
}
