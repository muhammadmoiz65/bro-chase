// Per-level looks for everything you can upgrade: crib doors (door armor 0..3),
// defences (levels 1..3), and player gear (kicks and body armour, tiers 0..3).
// Each builder returns a THREE.Group. Animated pieces register a `tick(t)` in userData,
// which the renderer calls every frame through tickUpgrades().

import * as THREE from 'three';

type Tick = (t: number) => void;

const std = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function addTick(o: THREE.Object3D, fn: Tick) {
  const prev = o.userData.tick as Tick | undefined;
  o.userData.tick = prev ? (t: number) => { prev(t); fn(t); } : fn;
}

/** Run every `userData.tick` under `root` (doors, defences, gear). */
export function tickUpgrades(root: THREE.Object3D, t: number) {
  root.traverse((o) => { const f = o.userData.tick as Tick | undefined; if (f) f(t); });
}

// ---------------------------------------------------------------- doors

export const DOOR_LOOK = ['Wood door', 'Iron-banded door', 'Steel blast door', 'Sigma vault'] as const;

/**
 * A crib door, 2 wide x 1.35 tall x 0.22 deep, centred on its origin.
 * userData.setHp(frac) tints it as it takes damage.
 */
export function makeDoor(level: number, paint = 0xb07a3c): THREE.Group {
  const g = new THREE.Group();
  g.userData.level = level;
  const W = 2, H = 1.35, D = 0.22;
  let slabMat: THREE.MeshStandardMaterial;
  const base = new THREE.Color();

  if (level <= 0) {
    // plain planks
    slabMat = std(paint, { roughness: 0.75 });
    g.add(box(W, H, D, slabMat));
    const groove = std(0x6b4220);
    for (const x of [-0.5, 0, 0.5]) for (const z of [D / 2 + 0.005, -D / 2 - 0.005]) g.add(box(0.03, H - 0.1, 0.01, groove, x, 0, z));
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), std(0xd9c27a, { metalness: 0.8, roughness: 0.3 }));
    knob.position.set(0.75, 0, D / 2 + 0.04);
    g.add(knob);
  } else if (level === 1) {
    // wood with black iron bands and rivets
    slabMat = std(new THREE.Color(paint).multiplyScalar(0.85).getHex(), { roughness: 0.7 });
    g.add(box(W, H, D, slabMat));
    const iron = std(0x2b2d33, { metalness: 0.7, roughness: 0.45 });
    const rivet = std(0x8a8f99, { metalness: 0.55, roughness: 0.3 });
    const rg = new THREE.SphereGeometry(0.035, 6, 5);
    for (const y of [-0.42, 0.42]) {
      for (const z of [D / 2 + 0.015, -D / 2 - 0.015]) {
        g.add(box(W + 0.04, 0.14, 0.03, iron, 0, y, z));
        for (const x of [-0.85, -0.3, 0.3, 0.85]) {
          const r = new THREE.Mesh(rg, rivet);
          r.position.set(x, y, z + Math.sign(z) * 0.02);
          g.add(r);
        }
      }
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 14), iron);
    ring.position.set(0.7, 0, D / 2 + 0.05);
    g.add(ring);
  } else if (level === 2) {
    // steel blast door: brushed plate, X brace, hazard stripes
    slabMat = std(0xaab3bf, { metalness: 0.55, roughness: 0.35 });
    g.add(box(W, H, D + 0.04, slabMat));
    const dark = std(0x4a515c, { metalness: 0.8, roughness: 0.4 });
    const len = Math.hypot(W - 0.2, H - 0.2);
    const ang = Math.atan2(H - 0.2, W - 0.2);
    for (const z of [D / 2 + 0.035, -D / 2 - 0.035]) {
      for (const s of [1, -1]) {
        const b = box(len, 0.12, 0.04, dark, 0, 0, z);
        b.rotation.z = s * ang;
        g.add(b);
      }
      g.add(box(W, 0.1, 0.04, dark, 0, H / 2 - 0.05, z));
    }
    // yellow / black hazard band along the bottom
    const c = document.createElement('canvas');
    c.width = 128; c.height = 16;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffd23f'; ctx.fillRect(0, 0, 128, 16);
    ctx.fillStyle = '#111';
    for (let x = -16; x < 128; x += 16) { ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x + 8, 0); ctx.lineTo(x + 16, 0); ctx.lineTo(x + 8, 16); ctx.fill(); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const hz = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    for (const z of [D / 2 + 0.036, -D / 2 - 0.036]) g.add(box(W, 0.16, 0.03, hz, 0, -H / 2 + 0.1, z));
    const bolt = std(0xd0d6de, { metalness: 0.55, roughness: 0.2 });
    const bg = new THREE.CylinderGeometry(0.045, 0.045, 0.05, 6);
    for (const x of [-0.9, 0.9]) for (const y of [-0.5, 0.5]) {
      const b = new THREE.Mesh(bg, bolt);
      b.rotation.x = Math.PI / 2;
      b.position.set(x, y, D / 2 + 0.05);
      g.add(b);
    }
  } else {
    // Sigma vault: black chrome, gold vault wheel, purple neon frame, crown on top
    slabMat = std(0x2a2d3d, { metalness: 0.55, roughness: 0.25 });
    g.add(box(W, H, D + 0.08, slabMat));
    const neon = new THREE.MeshStandardMaterial({ color: 0xd9a0ff, emissive: 0xb46bff, emissiveIntensity: 2.2 });
    for (const z of [D / 2 + 0.05, -D / 2 - 0.05]) {
      g.add(box(W, 0.05, 0.02, neon, 0, H / 2 - 0.04, z));
      g.add(box(W, 0.05, 0.02, neon, 0, -H / 2 + 0.04, z));
      g.add(box(0.05, H, 0.02, neon, -W / 2 + 0.04, 0, z));
      g.add(box(0.05, H, 0.02, neon, W / 2 - 0.04, 0, z));
    }
    const gold = std(0xffc83d, { metalness: 0.55, roughness: 0.25, emissive: 0x553300, emissiveIntensity: 0.4 });
    const wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 8, 28), gold));
    for (let i = 0; i < 3; i++) {
      const spoke = box(0.6, 0.04, 0.04, gold);
      spoke.rotation.z = (i * Math.PI) / 3;
      wheel.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 12), gold);
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
    wheel.position.set(0, 0, D / 2 + 0.1);
    g.add(wheel);
    addTick(wheel, (t) => { wheel.rotation.z = t / 2500; });
    // a little crown floating above the door
    const crown = new THREE.Group();
    crown.add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 14, 1, true), gold));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 4), gold);
      p.position.set(Math.cos(a) * 0.18, 0.1, Math.sin(a) * 0.18);
      crown.add(p);
    }
    crown.position.set(0, H / 2 + 0.25, 0);
    g.add(crown);
    addTick(crown, (t) => { crown.rotation.y = t / 900; crown.position.y = H / 2 + 0.25 + Math.sin(t / 400) * 0.05; });
    g.userData.neon = neon;
  }
  base.copy(slabMat.color);
  g.userData.setHp = (frac: number) => {
    const f = Math.max(0, Math.min(1, frac));
    slabMat.color.copy(base).lerp(new THREE.Color(0x8a1a10), (1 - f) * 0.7); // goes red as it breaks
    slabMat.emissive.setHex(0xff2020);
    slabMat.emissiveIntensity = f < 0.35 ? (0.35 - f) * 1.2 : 0;
    const neonMat = g.userData.neon as THREE.MeshStandardMaterial | undefined;
    if (neonMat) neonMat.emissiveIntensity = 0.6 + 1.6 * f;
  };
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}

// ---------------------------------------------------------------- defences

export type DefenceKind = 'turret' | 'lamp' | 'bass';

/** Normalise whatever id the game uses for a defence to one of the three looks. */
export function defenceKind(id: string): DefenceKind {
  const s = id.toLowerCase();
  if (s.includes('lamp') || s.includes('aura')) return 'lamp';
  if (s.includes('bass') || s.includes('drop') || s.includes('speaker')) return 'bass';
  // 'blaster', 'turret', 'rizz' and anything else
  return 'turret';
}

/**
 * A defence at upgrade level 1..3, standing on the ground at its origin (about 1 tile wide).
 * Call userData.fire(aimAngle) for a muzzle flash / pulse when it triggers (the blaster turns
 * to aimAngle, atan2(dx, dz)); userData.setOff(true) dims it while it's disabled.
 */
export function makeDefence(kindOrId: string, level: number): THREE.Group {
  const kind = defenceKind(kindOrId);
  const lv = Math.max(1, Math.min(3, Math.round(level) || 1));
  const g = kind === 'turret' ? rizzBlaster(lv) : kind === 'lamp' ? auraLamp(lv) : bassDrop(lv);
  g.userData.kind = kind;
  g.userData.level = lv;
  // level pips on the base so you can read the level at a glance
  const pip = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffb000, emissiveIntensity: 1.2 });
  for (let i = 0; i < lv; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), pip);
    p.position.set((i - (lv - 1) / 2) * 0.14, 0.06, 0.46);
    g.add(p);
  }
  g.userData.setOff ??= () => {};
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}

function rizzBlaster(lv: number): THREE.Group {
  // L1 one pink barrel on a tripod, L2 twin barrels + ammo box, L3 gold quad minigun with a radar dish
  const g = new THREE.Group();
  const metal = std(lv === 3 ? 0xffc83d : 0x3a3f4b, { metalness: 0.8, roughness: 0.35 });
  const pink = new THREE.MeshStandardMaterial({ color: 0xff5fa2, emissive: 0xff2d7a, emissiveIntensity: lv === 1 ? 0.4 : 1 });
  if (lv === 1) {
    for (let i = 0; i < 3; i++) {
      const leg = box(0.05, 0.6, 0.05, metal);
      const a = (i / 3) * Math.PI * 2;
      leg.position.set(Math.cos(a) * 0.18, 0.28, Math.sin(a) * 0.18);
      leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      g.add(leg);
    }
  } else {
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.3, lv === 3 ? 8 : 6), metal);
    plinth.position.y = 0.15;
    g.add(plinth);
  }
  const head = new THREE.Group();
  head.position.y = lv === 1 ? 0.62 : 0.55;
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), metal));
  const barrels = lv === 1 ? [[0, 0]] : lv === 2 ? [[-0.08, 0], [0.08, 0]] : [[-0.07, -0.07], [0.07, -0.07], [-0.07, 0.07], [0.07, 0.07]];
  const spin = new THREE.Group();
  for (const [x, y] of barrels) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.5, 10), pink);
    b.rotation.x = Math.PI / 2;
    b.position.set(x, y, 0.3);
    spin.add(b);
  }
  head.add(spin);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb3d9, transparent: true, opacity: 0 }));
  flash.position.z = 0.6;
  head.add(flash);
  if (lv >= 2) {
    const ammo = box(0.2, 0.16, 0.22, std(0x4a5a2a), -0.26, 0, -0.05);
    head.add(ammo);
    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), pink);
    heart.position.set(0, 0.2, 0);
    head.add(heart);
  }
  if (lv === 3) {
    const dish = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.07, 16, 1, true), std(0xe0e4ea, { metalness: 0.55, side: THREE.DoubleSide }));
    dish.position.set(0, 0.28, -0.08);
    dish.rotation.x = -0.6;
    head.add(dish);
    addTick(dish, (t) => { dish.rotation.y = t / 300; });
  }
  g.add(head);
  let fired = 0;
  let aim = 0;
  addTick(g, (t) => {
    // sweep for Opps, snap onto the target while shooting
    head.rotation.y = t - fired < 700 ? aim : Math.sin(t / (1400 - lv * 250)) * 1.2;
    if (lv === 3) spin.rotation.z = t / 60;
    const age = (t - fired) / 120;
    (flash.material as THREE.MeshBasicMaterial).opacity = age < 1 ? 1 - age : 0;
  });
  g.userData.fire = (a?: number) => { fired = performance.now(); if (a !== undefined) aim = a; };
  return g;
}

function auraLamp(lv: number): THREE.Group {
  // L1 desk-lamp purple bulb, L2 tall pole with a halo, L3 floating crystal with orbiting rings
  const g = new THREE.Group();
  const pole = std(lv === 3 ? 0xffc83d : 0x2a2d38, { metalness: 0.7, roughness: 0.4 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xe9c8ff, emissive: 0xb46bff, emissiveIntensity: 1.2 + lv * 0.8 });
  const h = [0, 0.8, 1.3, 1.5][lv];
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.12, 12), pole);
  base.position.y = 0.06;
  g.add(base);
  if (lv < 3) {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, h, 8), pole);
    stick.position.y = h / 2;
    g.add(stick);
  }
  const bulb = new THREE.Mesh(lv === 3 ? new THREE.OctahedronGeometry(0.22) : new THREE.SphereGeometry(0.16 + lv * 0.03, 14, 10), glow);
  bulb.position.y = h + 0.12;
  g.add(bulb);
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < lv - 1; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.3 + i * 0.12, 0.02, 6, 32), glow);
    r.position.y = h + 0.12;
    r.rotation.x = Math.PI / 2;
    g.add(r);
    rings.push(r);
  }
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(0.6 + lv * 0.35, 32),
    new THREE.MeshBasicMaterial({ color: 0xb46bff, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.02;
  g.add(pool);
  let off = false;
  let flash = 0;
  addTick(g, (t) => {
    const pulse = 0.5 + 0.5 * Math.sin(t / 350);
    const f = t - flash < 200 ? 4 : 0;
    glow.emissiveIntensity = off ? 0.05 : 1 + lv * 0.8 + pulse * 0.8 + f;
    pool.visible = !off;
    (pool.material as THREE.MeshBasicMaterial).opacity = 0.12 + pulse * 0.1;
    if (lv === 3) { bulb.rotation.y = t / 600; bulb.position.y = h + 0.12 + Math.sin(t / 500) * 0.08; }
    rings.forEach((r, i) => { r.rotation.x = Math.PI / 2 + Math.sin(t / 700 + i) * 0.6; r.rotation.y = t / (500 + i * 200); });
  });
  g.userData.fire = () => { flash = performance.now(); };
  g.userData.setOff = (o: boolean) => { off = o; };
  return g;
}

function bassDrop(lv: number): THREE.Group {
  // L1 one speaker box, L2 stacked pair, L3 three-speaker wall with neon and a gold chain
  const g = new THREE.Group();
  const cab = std(lv === 3 ? 0x15151c : 0x26262e, { roughness: 0.8 });
  const cone = std(0x55555f, { metalness: 0.3, roughness: 0.5 });
  const neon = new THREE.MeshStandardMaterial({ color: 0x7ef9ff, emissive: 0x3bd1ff, emissiveIntensity: lv === 1 ? 0.5 : 1.6 });
  const spots: Array<[number, number, number]> = lv === 1 ? [[0, 0.3, 0.5]] : lv === 2 ? [[0, 0.3, 0.5], [0, 0.85, 0.42]] : [[-0.3, 0.3, 0.45], [0.3, 0.3, 0.45], [0, 0.8, 0.55]];
  const woofers: THREE.Mesh[] = [];
  for (const [x, y, s] of spots) {
    g.add(box(s * 1.1, s * 1.1, s * 0.8, cab, x, y, 0));
    const w = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.38, s * 0.42, 0.06, 20), cone);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, y, s * 0.42);
    g.add(w);
    woofers.push(w);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(s * 0.43, 0.018, 6, 24), neon);
    rim.position.set(x, y, s * 0.44);
    g.add(rim);
  }
  if (lv === 3) {
    const gold = std(0xffc83d, { metalness: 0.55, roughness: 0.25 });
    for (let i = 0; i < 9; i++) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 5, 10), gold);
      const a = (i / 8) * Math.PI;
      link.position.set(Math.cos(a) * 0.35, 1.12 - Math.sin(a) * 0.12, 0.3);
      link.rotation.y = i % 2 ? Math.PI / 2 : 0;
      g.add(link);
    }
  }
  let dropped = 0;
  addTick(g, (t) => {
    const age = (t - dropped) / 400;
    const thump = age < 1 ? (1 - age) * 0.25 : 0.03 * Math.max(0, Math.sin(t / 120));
    for (const w of woofers) w.scale.set(1 + thump, 1 + thump * 3, 1 + thump);
    neon.emissiveIntensity = (lv === 1 ? 0.5 : 1.6) + (age < 1 ? (1 - age) * 3 : 0);
  });
  g.userData.fire = () => { dropped = performance.now(); };
  return g;
}

// ---------------------------------------------------------------- player gear

export const KICKS_LOOK = ['', 'Fresh Kicks', 'Turbo Kicks', 'Sky Kicks'] as const;
export const VEST_LOOK = ['', 'Hoodie Vest', 'Steel Plate', 'Gold Sigma Suit'] as const;

/** Where gear sits on a character model. The defaults fit the capsule bro. */
export interface GearAnchors {
  footY: number; footX: number; // feet height and half spacing
  torsoY: number; torsoR: number; torsoH: number; // torso centre, radius and height
  headY: number; headR: number;
  shoulderX: number; shoulderY: number;
}

export const BRO_ANCHORS: GearAnchors = {
  footY: 0.06, footX: 0.13,
  torsoY: 0.6, torsoR: 0.29, torsoH: 0.5,
  headY: 1.08, headR: 0.22,
  shoulderX: 0.3, shoulderY: 0.88,
};

/**
 * Put kicks and body armour (tiers 0..3) on a character group. Calling it again replaces
 * the old gear. Returns the gear group (also kept as group.userData.gear).
 */
export function applyGear(group: THREE.Object3D, kicks: number, vest: number, a: GearAnchors = BRO_ANCHORS): THREE.Group {
  (group.userData.gear as THREE.Group | undefined)?.removeFromParent();
  const gear = new THREE.Group();
  gear.name = 'gear';
  group.userData.gear = gear;
  group.userData.gearKey = `${kicks}:${vest}`;
  if (kicks > 0) gear.add(makeKicks(kicks, a));
  if (vest > 0) gear.add(makeVest(vest, a));
  gear.userData.helmet = vest >= 3; // a custom avatar should hide its hat and hair while this is true
  // armour bubble that flashes when it blocks a grab (setShield)
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(0.75, 20, 14),
    new THREE.MeshBasicMaterial({ color: vest >= 3 ? 0xffd23f : 0x9fd8ff, transparent: true, opacity: 0, depthWrite: false }),
  );
  bubble.position.y = a.torsoY + 0.1;
  bubble.visible = false;
  gear.add(bubble);
  gear.userData.setShield = (on: boolean, t: number) => {
    bubble.visible = on;
    (bubble.material as THREE.MeshBasicMaterial).opacity = on ? 0.25 + 0.15 * Math.sin(t / 60) : 0;
  };
  gear.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== bubble) o.castShadow = true; });
  group.add(gear);
  return gear;
}

function makeKicks(tier: number, a: GearAnchors): THREE.Group {
  const g = new THREE.Group();
  const upper = tier === 1 ? std(0xf4f4f4, { roughness: 0.5 })
    : tier === 2 ? std(0x1b1b22, { roughness: 0.4 })
    : std(0xffc83d, { metalness: 0.55, roughness: 0.25, emissive: 0x553300, emissiveIntensity: 0.5 });
  const sole = tier === 1 ? std(0xffffff)
    : new THREE.MeshStandardMaterial({ color: tier === 2 ? 0x7dff6b : 0xffffff, emissive: tier === 2 ? 0x2bff3a : 0xfff1a0, emissiveIntensity: 1.8 });
  const accent = tier === 1 ? std(0xe0263b) : tier === 2 ? new THREE.MeshStandardMaterial({ color: 0x7dff6b, emissive: 0x2bff3a, emissiveIntensity: 1.2 }) : std(0xffffff);
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6d0, emissiveIntensity: 0.6, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const foot = new THREE.Group();
    foot.position.set(s * a.footX, a.footY, 0.04);
    foot.add(box(0.15, 0.1, 0.28, upper, 0, 0.03, 0));
    foot.add(box(0.16, 0.04, 0.3, sole, 0, -0.03, 0));
    foot.add(box(0.012, 0.04, 0.16, accent, s * 0.077, 0.03, -0.02)); // side stripe
    if (tier === 3) {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), wingMat);
      wing.position.set(s * 0.1, 0.08, -0.08);
      wing.rotation.set(0, s * 0.6, s * 0.4);
      foot.add(wing);
      addTick(wing, (t) => { wing.rotation.z = s * (0.4 + Math.sin(t / 90) * 0.35); });
    }
    g.add(foot);
  }
  return g;
}

function makeVest(tier: number, a: GearAnchors): THREE.Group {
  const g = new THREE.Group();
  if (tier === 1) {
    // padded hoodie vest with a hood bunched behind the head and a zipper
    const pad = std(0x4f5b3a, { roughness: 0.85 });
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(a.torsoR + 0.02, a.torsoR + 0.04, a.torsoH * 0.8, 14, 1, true), pad);
    vest.position.y = a.torsoY + 0.05;
    (vest.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    g.add(vest);
    for (const y of [-0.1, 0.05, 0.2]) {
      const quilt = new THREE.Mesh(new THREE.TorusGeometry(a.torsoR + 0.035, 0.012, 4, 20), std(0x3c4630));
      quilt.rotation.x = Math.PI / 2;
      quilt.position.y = a.torsoY + y;
      g.add(quilt);
    }
    g.add(box(0.02, a.torsoH * 0.78, 0.02, std(0xd0d0d0, { metalness: 0.8 }), 0, a.torsoY + 0.05, a.torsoR + 0.04));
    const hood = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.06, 6, 14), pad);
    hood.position.set(0, a.shoulderY + 0.06, -0.12);
    hood.rotation.x = Math.PI / 2.4;
    g.add(hood);
    return g;
  }
  const plate = tier === 2
    ? std(0xa9b2bf, { metalness: 0.55, roughness: 0.3 })
    : std(0xffc83d, { metalness: 0.55, roughness: 0.2, emissive: 0x5a3800, emissiveIntensity: 0.5 });
  const trim = tier === 2 ? std(0x3a3f4b, { metalness: 0.7 }) : new THREE.MeshStandardMaterial({ color: 0xd9a0ff, emissive: 0xb46bff, emissiveIntensity: 1.8 });
  // chest and back plates
  for (const z of [1, -1]) {
    const p = box(a.torsoR * 1.6, a.torsoH * 0.75, 0.07, plate, 0, a.torsoY + 0.06, z * (a.torsoR - 0.02));
    g.add(p);
    g.add(box(a.torsoR * 1.6, 0.03, 0.08, trim, 0, a.torsoY + 0.06 + a.torsoH * 0.37, z * (a.torsoR - 0.02)));
  }
  g.add(box(a.torsoR * 1.7, 0.08, a.torsoR * 2.05, trim, 0, a.torsoY - a.torsoH * 0.32, 0)); // belt
  // shoulder pads
  for (const s of [-1, 1]) {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), plate);
    pad.scale.set(1.1, 0.8, 1);
    pad.position.set(s * a.shoulderX, a.shoulderY, 0);
    pad.rotation.z = -s * 0.35;
    g.add(pad);
  }
  if (tier === 2) {
    // rivets on the chest
    const rv = std(0x5d6470, { metalness: 0.55 });
    for (const x of [-0.12, 0.12]) for (const y of [-0.08, 0.12]) {
      const r = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), rv);
      r.position.set(x, a.torsoY + 0.06 + y, a.torsoR + 0.02);
      g.add(r);
    }
    return g;
  }
  // tier 3: gold helmet with a glowing visor, a chest gem, and an aura halo of sparkles
  const helm = new THREE.Mesh(new THREE.SphereGeometry(a.headR + 0.035, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.8), plate);
  helm.position.y = a.headY;
  g.add(helm);
  const visor = box(a.headR * 1.5, 0.06, 0.04, trim, 0, a.headY + 0.04, a.headR + 0.01);
  g.add(visor);
  const crest = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 4), trim);
  crest.position.y = a.headY + a.headR + 0.1;
  g.add(crest);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), trim);
  gem.position.set(0, a.torsoY + 0.12, a.torsoR + 0.05);
  g.add(gem);
  const sparkles = new THREE.Group();
  const sp = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.03), sp);
    const ang = (i / 6) * Math.PI * 2;
    s.position.set(Math.cos(ang) * 0.5, 0, Math.sin(ang) * 0.5);
    sparkles.add(s);
  }
  sparkles.position.y = a.torsoY;
  g.add(sparkles);
  addTick(sparkles, (t) => {
    sparkles.rotation.y = t / 700;
    sparkles.position.y = a.torsoY + Math.sin(t / 500) * 0.15;
    gem.rotation.y = t / 300;
  });
  return g;
}
