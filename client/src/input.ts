// Keyboard + touch input. Emits a movement vector and discrete actions.

export type Action = 'jump' | 'light' | 'use' | 'repairOn' | 'repairOff' | 'yes' | 'no' | 'scoreOn' | 'scoreOff' | 'chat' | 'zoomToggle' | 'walkToggle' | 'camIn' | 'camOut' | 'controls';

export class Input {
  private keys = new Set<string>();
  private stick = { x: 0, y: 0 };
  private zoomLatch = false;
  sneakLatch = false;
  enabled = true;
  onAction: (a: Action) => void = () => {};

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const k = e.key.toLowerCase();
      if (k === 'tab') { e.preventDefault(); if (!e.repeat) this.onAction('scoreOn'); return; }
      if (k === 'enter') { e.preventDefault(); this.onAction('chat'); return; }
      if (e.repeat) return;
      this.keys.add(k);
      if (k === ' ') { e.preventDefault(); this.onAction('jump'); }
      else if (k === 'f') this.onAction('light');
      else if (k === 'e') this.onAction('use');
      else if (k === 'r') this.onAction('repairOn');
      else if (k === 'y') this.onAction('yes');
      else if (k === 'n') this.onAction('no');
      else if (k === 'c') { this.sneakLatch = !this.sneakLatch; this.onAction('walkToggle'); }
      else if (k === '=' || k === '+') this.onAction('camIn');
      else if (k === '-' || k === '_') this.onAction('camOut');
      else if (k === 'h') this.onAction('controls');
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === 'tab') { e.preventDefault(); this.onAction('scoreOff'); }
      if (k === 'r') this.onAction('repairOff');
    });
    window.addEventListener('wheel', (e) => { if (this.enabled) this.onAction(e.deltaY < 0 ? 'camIn' : 'camOut'); }, { passive: true });
    window.addEventListener('blur', () => { this.keys.clear(); this.onAction('repairOff'); this.onAction('scoreOff'); });
  }

  clear() { this.keys.clear(); }

  move(): { dx: number; dy: number; zoom: boolean; sneak: boolean } {
    let dx = 0, dy = 0;
    if (this.enabled) {
      if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
      if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    }
    dx += this.stick.x;
    dy += this.stick.y;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const zoom = this.enabled && (this.keys.has('shift') || this.zoomLatch);
    const sneak = !zoom && (this.sneakLatch || this.keys.has('control'));
    return { dx: +dx.toFixed(3), dy: +dy.toFixed(3), zoom, sneak };
  }

  /** On-screen joystick and buttons for phones and tablets. */
  setupTouch(root: HTMLElement) {
    root.classList.remove('hidden');
    const stick = root.querySelector<HTMLElement>('#stick')!;
    const knob = root.querySelector<HTMLElement>('#stick-knob')!;
    let id: number | null = null;
    const update = (t: Touch) => {
      const r = stick.getBoundingClientRect();
      let x = (t.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let y = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      this.stick = { x, y };
      knob.style.transform = `translate(${x * 35}px, ${y * 35}px)`;
    };
    stick.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; id = t.identifier; update(t); });
    stick.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === id) update(t); });
    const end = (e: TouchEvent) => {
      for (const t of e.changedTouches) if (t.identifier === id) { id = null; this.stick = { x: 0, y: 0 }; knob.style.transform = ''; }
    };
    stick.addEventListener('touchend', end);
    stick.addEventListener('touchcancel', end);

    root.querySelectorAll<HTMLButtonElement>('#touch-buttons button').forEach((b) => {
      const act = b.dataset.act!;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (act === 'jump') this.onAction('jump');
        else if (act === 'light') this.onAction('light');
        else if (act === 'use') this.onAction('use');
        else if (act === 'repair') this.onAction('repairOn');
        else if (act === 'score') this.onAction('scoreOn');
        else if (act === 'chat') this.onAction('chat');
        else if (act === 'zoom') { this.zoomLatch = !this.zoomLatch; b.classList.toggle('on', this.zoomLatch); }
        else if (act === 'walk') { this.sneakLatch = !this.sneakLatch; b.classList.toggle('on', this.sneakLatch); this.onAction('walkToggle'); }
      });
      b.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (act === 'repair') this.onAction('repairOff');
        if (act === 'score') this.onAction('scoreOff');
      });
    });
  }
}
