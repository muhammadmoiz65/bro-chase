// Character creator: a full-screen panel with a spinning 3D preview of your bro and
// pickers for skin, hair, outfit, hat and accessory. Opens before your first game
// and from the menu or the pre-game lobby panel.

import * as THREE from 'three';
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
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private avatar: Avatar | null = null;
  private turntable = new THREE.Group();
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

    this.camera.position.set(0, 1.25, 3.3);
    this.camera.lookAt(0, 0.8, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6080, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff6aa0, 1.2);
    rim.position.set(-3, 2, -2);
    this.scene.add(rim);
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.75, 0.06, 40),
      new THREE.MeshStandardMaterial({ color: 0x2a2c3a, roughness: 0.6 }),
    );
    disc.position.y = -0.03;
    this.turntable.add(disc);
    this.scene.add(this.turntable);

    this.canvasBox.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, rot: this.turntable.rotation.y };
      this.canvasBox.setPointerCapture(e.pointerId);
    });
    this.canvasBox.addEventListener('pointermove', (e) => {
      if (this.drag) this.turntable.rotation.y = this.drag.rot + (e.clientX - this.drag.x) * 0.012;
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
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.canvasBox.appendChild(this.renderer.domElement);
      } catch { this.renderer = null; }
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

  private frame(time: number) {
    if (!this.renderer) return;
    const w = this.canvasBox.clientWidth, h = this.canvasBox.clientHeight;
    const c = this.renderer.domElement;
    if (c.width !== Math.floor(w * this.renderer.getPixelRatio()) || c.height !== Math.floor(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }
    if (!this.drag) this.turntable.rotation.y += this.spin / 60;
    this.avatar?.animate(time, 0);
    if (this.avatar) this.avatar.group.position.y = Math.abs(Math.sin(time * 2.2)) * 0.03;
    this.renderer.render(this.scene, this.camera);
  }

  private refresh() {
    if (this.avatar) { this.avatar.group.removeFromParent(); this.avatar.dispose(); }
    this.avatar = buildAvatar(this.look);
    this.turntable.add(this.avatar.group);
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
