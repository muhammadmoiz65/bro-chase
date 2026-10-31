// Character creator: a full-screen panel with a spinning 3D preview of your bro and
// pickers for skin, hair, outfit, hat and accessory. Opens before your first game
// and from the menu or the pre-game lobby panel.

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { context, cyl, group, srgb, std, useScene, type Node } from './bjs/kit.ts';
import {
  ACCESSORIES, DEFAULT_LOOK, HAIR_COLORS, HAIR_STYLES, HATS, OUTFIT_COLORS, SKIN_NAMES, SKIN_TONES, TOPS,
  randomLook, type Look,
} from '../../shared/look.ts';
import { buildAvatar, type Avatar } from './avatar.ts';

type StyleField = { key: keyof Look; label: string; kind: 'list'; names: readonly string[] };
type ColorField = { key: keyof Look; label: string; kind: 'color'; colors: readonly number[]; names?: readonly string[] };
const FIELDS: Array<StyleField | ColorField> = [
  { key: 'skin', label: 'Skin', kind: 'color', colors: SKIN_TONES, names: SKIN_NAMES },
  { key: 'hair', label: 'Hair', kind: 'list', names: HAIR_STYLES },
  { key: 'hairColor', label: 'Hair colour', kind: 'color', colors: HAIR_COLORS },
  { key: 'top', label: 'Fit', kind: 'list', names: TOPS },
  { key: 'topColor', label: 'Fit colour', kind: 'color', colors: OUTFIT_COLORS },
  { key: 'pantsColor', label: 'Pants', kind: 'color', colors: OUTFIT_COLORS },
  { key: 'hat', label: 'Hat', kind: 'list', names: HATS },
  { key: 'acc', label: 'Drip', kind: 'list', names: ACCESSORIES },
];

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export class Creator {
  private root: HTMLElement;
  private canvasBox: HTMLElement;
  private controls: HTMLElement;
  private status: HTMLElement;
  private look: Look = { ...DEFAULT_LOOK };
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private camera: FreeCamera | null = null;
  private avatar: Avatar | null = null;
  private turntable: Node | null = null;
  private lastW = 0;
  private lastH = 0;
  private raf = 0;
  private spin = 0.5;
  private drag: { x: number; rot: number } | null = null;
  private onSave: ((look: Look) => Promise<void>) | null = null;
  private onClose: (() => void) | null = null;
  isOpen = false;

  constructor() {
    this.root = document.getElementById('creator')!;
    this.canvasBox = document.getElementById('creator-preview')!;
    this.controls = document.getElementById('creator-controls')!;
    this.status = document.getElementById('creator-status')!;
    document.getElementById('creator-random')!.onclick = () => { this.look = randomLook(); this.refresh(); };
    document.getElementById('creator-save')!.onclick = () => void this.save();
    document.getElementById('creator-cancel')!.onclick = () => this.close();

    this.canvasBox.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, rot: this.turntable?.rotation.y ?? 0 };
      this.canvasBox.setPointerCapture(e.pointerId);
    });
    this.canvasBox.addEventListener('pointermove', (e) => {
      if (this.drag && this.turntable) this.turntable.rotation.y = this.drag.rot + (e.clientX - this.drag.x) * 0.012;
    });
    const end = () => { this.drag = null; };
    this.canvasBox.addEventListener('pointerup', end);
    this.canvasBox.addEventListener('pointercancel', end);
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && e.key === 'Escape') { e.stopPropagation(); this.close(); }
    }, true);
  }

  /** Show the creator. `firstTime` hides Cancel (the player should pick a look once). */
  open(start: Look | null, opts: { firstTime?: boolean; onSave: (look: Look) => Promise<void>; onClose?: () => void }) {
    this.look = { ...(start ?? randomLook()) };
    this.onSave = opts.onSave;
    this.onClose = opts.onClose ?? null;
    document.getElementById('creator-title')!.textContent = opts.firstTime ? 'MAKE YOUR BRO' : 'CHANGE YOUR LOOK';
    document.getElementById('creator-cancel')!.classList.toggle('hidden', !!opts.firstTime);
    this.status.textContent = '';
    this.root.classList.remove('hidden');
    this.isOpen = true;
    if (!this.engine) {
      try { this.setup(); } catch { this.engine = null; }
    }
    this.refresh();
    cancelAnimationFrame(this.raf);
    const loop = (t: number) => {
      if (!this.isOpen) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(t / 1000);
    };
    this.raf = requestAnimationFrame(loop);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    cancelAnimationFrame(this.raf);
    this.root.classList.add('hidden');
    this.onClose?.();
  }

  private async save() {
    if (!this.onSave) return;
    const btn = document.getElementById('creator-save') as HTMLButtonElement;
    btn.disabled = true;
    this.status.textContent = 'Saving your drip...';
    try {
      await this.onSave({ ...this.look });
      this.status.textContent = '';
      this.close();
    } catch (e) {
      this.status.textContent = (e as Error).message;
    } finally {
      btn.disabled = false;
    }
  }

  /** A small Babylon scene of its own (its own canvas), so it works over the menu and in the lobby. */
  private setup() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block;outline:none';
    this.canvasBox.appendChild(canvas);
    const engine = new Engine(canvas, true, { alpha: true, premultipliedAlpha: false }, true);
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0, 0, 0, 0);
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    const camera = new FreeCamera('creator-cam', new Vector3(0, 1.25, 3.3), scene);
    camera.fov = (32 * Math.PI) / 180;
    camera.minZ = 0.1;
    camera.setTarget(new Vector3(0, 0.8, 0));
    camera.inputs.clear();
    const hemi = new HemisphericLight('h', new Vector3(0, 1, 0), scene);
    hemi.diffuse = srgb(0xffffff);
    hemi.groundColor = srgb(0x6a6080);
    hemi.intensity = 1.6;
    const key = new DirectionalLight('key', new Vector3(-2, -4, -3).normalize(), scene);
    key.intensity = 2.2;
    const rim = new DirectionalLight('rim', new Vector3(3, -2, 2).normalize(), scene);
    rim.diffuse = srgb(0xff6aa0);
    rim.intensity = 1.2;
    const prev = this.saveContext();
    useScene(scene, null);
    this.turntable = group(null, 'turntable');
    const disc = cyl(0.7, 0.75, 0.06, std(0x2a2c3a, { roughness: 0.6 }), { seg: 40 });
    disc.position.y = -0.03;
    disc.parent = this.turntable;
    this.restoreContext(prev);
    this.engine = engine;
    this.scene = scene;
    this.camera = camera;
  }

  private saveContext() { try { return context(); } catch { return null; } }
  private restoreContext(c: ReturnType<typeof context> | null) { if (c) useScene(c.scene, c.shadows); }

  private frame(time: number) {
    if (!this.engine || !this.scene) return;
    const w = this.canvasBox.clientWidth, h = this.canvasBox.clientHeight;
    if (w !== this.lastW || h !== this.lastH) { this.lastW = w; this.lastH = h; this.engine.resize(); }
    if (!this.drag && this.turntable) this.turntable.rotation.y += this.spin / 60;
    this.avatar?.animate(time, 0);
    if (this.avatar) this.avatar.group.position.y = Math.abs(Math.sin(time * 2.2)) * 0.03;
    this.scene.render();
  }

  private refresh() {
    this.avatar?.dispose();
    this.avatar = null;
    if (this.scene && this.turntable) {
      const prev = this.saveContext();
      useScene(this.scene, null);
      this.avatar = buildAvatar(this.look);
      this.avatar.group.parent = this.turntable;
      this.restoreContext(prev);
    }
    this.buildControls();
  }

  private set(key: keyof Look, v: number) {
    this.look[key] = v;
    this.refresh();
  }

  private buildControls() {
    this.controls.replaceChildren();
    for (const f of FIELDS) {
      const row = document.createElement('div');
      row.className = 'cr-row';
      const label = document.createElement('div');
      label.className = 'cr-label';
      label.textContent = f.label;
      row.appendChild(label);
      const cur = this.look[f.key];
      if (f.kind === 'list') {
        const n = f.names.length;
        const pick = document.createElement('div');
        pick.className = 'cr-pick';
        const prev = document.createElement('button');
        prev.className = 'small ghost';
        prev.textContent = '‹';
        prev.setAttribute('aria-label', `Previous ${f.label}`);
        prev.onclick = () => this.set(f.key, (cur + n - 1) % n);
        const name = document.createElement('span');
        name.textContent = f.names[cur];
        const next = document.createElement('button');
        next.className = 'small ghost';
        next.textContent = '›';
        next.setAttribute('aria-label', `Next ${f.label}`);
        next.onclick = () => this.set(f.key, (cur + 1) % n);
        pick.append(prev, name, next);
        row.appendChild(pick);
      } else {
        const sw = document.createElement('div');
        sw.className = 'cr-swatches';
        f.colors.forEach((c, i) => {
          const b = document.createElement('button');
          b.className = 'cr-swatch' + (i === cur ? ' on' : '');
          b.style.background = hex(c);
          b.title = f.names?.[i] ?? hex(c);
          b.setAttribute('aria-label', `${f.label}: ${b.title}`);
          b.onclick = () => this.set(f.key, i);
          sw.appendChild(b);
        });
        row.appendChild(sw);
      }
      this.controls.appendChild(row);
    }
  }
}
