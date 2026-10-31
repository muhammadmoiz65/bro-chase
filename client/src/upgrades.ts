// Per-level looks for everything you can upgrade: crib doors (door armor 0..3),
// defences (levels 1..3), and player gear (kicks and body armour, tiers 0..3).
// Each builder returns a node. Animated pieces register a tick(t) (see kit.addTick),
// which the renderer runs every frame through tickUpgrades().

import {
  add, addTick, basic, box, canvasTexture, castShadows, circle, cone, cyl, group, lin, octa, plane, setOpacity, shade, show, sphere, std,
  tickAll, torus, ud, type Mesh, type Node,
} from './bjs/kit.ts';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';

const at = <T extends Node>(o: T, x = 0, y = 0, z = 0): T => { o.position.set(x, y, z); return o; };

/** Run every tick under `root` (doors, defences, gear). */
export function tickUpgrades(root: Node, t: number) { tickAll(root, t); }

// ---------------------------------------------------------------- doors

export const DOOR_LOOK = ['Wood door', 'Iron-banded door', 'Steel blast door', 'Sigma vault'] as const;

export interface DoorData { level: number; setHp: (frac: number) => void; targetY?: number }

/**
 * A crib door, 2 wide x 1.35 tall x 0.22 deep, centred on its origin.
 * ud<DoorData>(door).setHp(frac) tints it as it takes damage.
 */
export function makeDoor(level: number, paint = 0xb07a3c): Node {
  const g = group(null, 'door');
  const W = 2, H = 1.35, D = 0.22;
  let slabMat: PBRMaterial;
  let neon: PBRMaterial | null = null;

  if (level <= 0) {
    // plain planks
    slabMat = std(paint, { roughness: 0.75 });
    add(g, box(W, H, D, slabMat));
    const groove = std(0x6b4220);
    for (const x of [-0.5, 0, 0.5]) for (const z of [D / 2 + 0.005, -D / 2 - 0.005]) add(g, box(0.03, H - 0.1, 0.01, groove, x, 0, z));
    add(g, at(sphere(0.05, std(0xd9c27a, { metalness: 0.8, roughness: 0.3 }), { seg: 8 }), 0.75, 0, D / 2 + 0.04));
  } else if (level === 1) {
    // wood with black iron bands and rivets
    slabMat = std(shade(paint, 0.85), { roughness: 0.7 });
    add(g, box(W, H, D, slabMat));
    const iron = std(0x2b2d33, { metalness: 0.7, roughness: 0.45 });
    const rivet = std(0x8a8f99, { metalness: 0.55, roughness: 0.3 });
    for (const y of [-0.42, 0.42]) {
      for (const z of [D / 2 + 0.015, -D / 2 - 0.015]) {
        add(g, box(W + 0.04, 0.14, 0.03, iron, 0, y, z));
        for (const x of [-0.85, -0.3, 0.3, 0.85]) add(g, at(sphere(0.035, rivet, { seg: 6 }), x, y, z + Math.sign(z) * 0.02));
      }
    }
    add(g, at(torus(0.09, 0.02, iron, 14), 0.7, 0, D / 2 + 0.05));
  } else if (level === 2) {
    // steel blast door: brushed plate, X brace, hazard stripes
    slabMat = std(0xaab3bf, { metalness: 0.55, roughness: 0.35 });
    add(g, box(W, H, D + 0.04, slabMat));
    const dark = std(0x4a515c, { metalness: 0.8, roughness: 0.4 });
    const len = Math.hypot(W - 0.2, H - 0.2);
    const ang = Math.atan2(H - 0.2, W - 0.2);
    for (const z of [D / 2 + 0.035, -D / 2 - 0.035]) {
      for (const s of [1, -1]) {
        const b = box(len, 0.12, 0.04, dark, 0, 0, z);
        b.rotation.z = s * ang;
        add(g, b);
      }
      add(g, box(W, 0.1, 0.04, dark, 0, H / 2 - 0.05, z));
    }
    // yellow / black hazard band along the bottom
    const tex = canvasTexture(128, 16, (ctx) => {
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(0, 0, 128, 16);
      ctx.fillStyle = '#111';
      for (let x = -16; x < 128; x += 16) { ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x + 8, 0); ctx.lineTo(x + 16, 0); ctx.lineTo(x + 8, 16); ctx.fill(); }
    });
    const hz = std(0xffffff, { roughness: 0.6, map: tex });
    for (const z of [D / 2 + 0.036, -D / 2 - 0.036]) add(g, box(W, 0.16, 0.03, hz, 0, -H / 2 + 0.1, z));
    const bolt = std(0xd0d6de, { metalness: 0.55, roughness: 0.2 });
    for (const x of [-0.9, 0.9]) for (const y of [-0.5, 0.5]) {
      const b = at(cyl(0.045, 0.045, 0.05, bolt, { seg: 6 }), x, y, D / 2 + 0.05);
      b.rotation.x = Math.PI / 2;
      add(g, b);
    }
  } else {
    // Sigma vault: black chrome, gold vault wheel, purple neon frame, crown on top
    slabMat = std(0x2a2d3d, { metalness: 0.55, roughness: 0.25 });
    add(g, box(W, H, D + 0.08, slabMat));
    neon = std(0xd9a0ff, { emissive: 0xb46bff, emissiveIntensity: 2.2 });
    for (const z of [D / 2 + 0.05, -D / 2 - 0.05]) {
      add(g,
        box(W, 0.05, 0.02, neon, 0, H / 2 - 0.04, z),
        box(W, 0.05, 0.02, neon, 0, -H / 2 + 0.04, z),
        box(0.05, H, 0.02, neon, -W / 2 + 0.04, 0, z),
        box(0.05, H, 0.02, neon, W / 2 - 0.04, 0, z));
    }
    const gold = std(0xffc83d, { metalness: 0.55, roughness: 0.25, emissive: 0x553300, emissiveIntensity: 0.4 });
    const wheel = group(g, 'wheel');
    add(wheel, torus(0.3, 0.04, gold, 28));
    for (let i = 0; i < 3; i++) {
      const spoke = box(0.6, 0.04, 0.04, gold);
      spoke.rotation.z = (i * Math.PI) / 3;
      add(wheel, spoke);
    }
    const hub = cyl(0.08, 0.08, 0.06, gold, { seg: 12 });
    hub.rotation.x = Math.PI / 2;
    add(wheel, hub);
    wheel.position.set(0, 0, D / 2 + 0.1);
    addTick(wheel, (t) => { wheel.rotation.z = t / 2500; });
    // a little crown floating above the door
    const crown = group(g, 'crown');
    add(crown, cyl(0.18, 0.18, 0.08, gold, { seg: 14, open: true }));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      add(crown, at(cone(0.04, 0.12, gold, 4), Math.cos(a) * 0.18, 0.1, Math.sin(a) * 0.18));
    }
    crown.position.set(0, H / 2 + 0.25, 0);
    addTick(crown, (t) => { crown.rotation.y = t / 900; crown.position.y = H / 2 + 0.25 + Math.sin(t / 400) * 0.05; });
  }
  const base = slabMat.albedoColor.clone();
  const broken = lin(0x8a1a10);
  slabMat.emissiveColor = lin(0xff2020);
  slabMat.emissiveIntensity = 0;
  const data = ud<DoorData>(g);
  data.level = level;
  data.setHp = (frac: number) => {
    const f = Math.max(0, Math.min(1, frac));
    Color3.LerpToRef(base, broken, (1 - f) * 0.7, slabMat.albedoColor); // goes red as it breaks
    slabMat.emissiveIntensity = f < 0.35 ? (0.35 - f) * 1.2 : 0;
    if (neon) neon.emissiveIntensity = 0.6 + 1.6 * f;
  };
  castShadows(g);
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

export interface DefData { kind: DefenceKind; level: number; fire: (aim?: number) => void; setOff: (off: boolean) => void }

/**
 * A defence at upgrade level 1..3, standing on the ground at its origin (about 1 tile wide).
 * ud<DefData>(g).fire(aimAngle) shows a muzzle flash / pulse when it triggers (the blaster turns
 * to aimAngle, atan2(dx, dz)); setOff(true) dims it while it's disabled.
 */
export function makeDefence(kindOrId: string, level: number): Node {
  const kind = defenceKind(kindOrId);
  const lv = Math.max(1, Math.min(3, Math.round(level) || 1));
  const g = kind === 'turret' ? rizzBlaster(lv) : kind === 'lamp' ? auraLamp(lv) : bassDrop(lv);
  const d = ud<DefData>(g);
  d.kind = kind;
  d.level = lv;
  // level pips on the base so you can read the level at a glance
  const pip = std(0xffd23f, { emissive: 0xffb000, emissiveIntensity: 1.2 });
  for (let i = 0; i < lv; i++) add(g, at(sphere(0.05, pip, { seg: 8 }), (i - (lv - 1) / 2) * 0.14, 0.06, 0.46));
  d.setOff ??= () => {};
  castShadows(g);
  return g;
}

function rizzBlaster(lv: number): Node {
  // L1 one pink barrel on a tripod, L2 twin barrels + ammo box, L3 gold quad minigun with a radar dish
  const g = group(null, 'blaster');
  const metal = std(lv === 3 ? 0xffc83d : 0x3a3f4b, { metalness: 0.8, roughness: 0.35 });
  const pink = std(0xff5fa2, { emissive: 0xff2d7a, emissiveIntensity: lv === 1 ? 0.4 : 1 });
  if (lv === 1) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = box(0.05, 0.6, 0.05, metal, Math.cos(a) * 0.18, 0.28, Math.sin(a) * 0.18);
      leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      add(g, leg);
    }
  } else {
    add(g, at(cyl(0.34, 0.42, 0.3, metal, { seg: lv === 3 ? 8 : 6 }), 0, 0.15, 0));
  }
  const head = group(g, 'head');
  head.position.y = lv === 1 ? 0.62 : 0.55;
  add(head, sphere(0.18, metal, { seg: 12 }));
  const barrels = lv === 1 ? [[0, 0]] : lv === 2 ? [[-0.08, 0], [0.08, 0]] : [[-0.07, -0.07], [0.07, -0.07], [-0.07, 0.07], [0.07, 0.07]];
  const spin = group(head, 'spin');
  for (const [x, y] of barrels) {
    const b = at(cyl(0.045, 0.05, 0.5, pink, { seg: 10 }), x, y, 0.3);
    b.rotation.x = Math.PI / 2;
    add(spin, b);
  }
  const flashMat = basic(0xffb3d9, { opacity: 0 });
  add(head, at(sphere(0.12, flashMat, { seg: 8 }), 0, 0, 0.6));
  if (lv >= 2) add(head, box(0.2, 0.16, 0.22, std(0x4a5a2a), -0.26, 0, -0.05), at(sphere(0.05, pink, { seg: 8 }), 0, 0.2, 0));
  if (lv === 3) {
    const dish = at(cone(0.16, 0.07, std(0xe0e4ea, { metalness: 0.55, doubleSide: true }), 16, true), 0, 0.28, -0.08);
    dish.rotation.x = -0.6;
    add(head, dish);
    addTick(dish, (t) => { dish.rotation.y = t / 300; });
  }
  let fired = 0;
  let aim = 0;
  addTick(g, (t) => {
    // sweep for Opps, snap onto the target while shooting
    head.rotation.y = t - fired < 700 ? aim : Math.sin(t / (1400 - lv * 250)) * 1.2;
    if (lv === 3) spin.rotation.z = t / 60;
    const age = (t - fired) / 120;
    flashMat.alpha = age < 1 ? 1 - age : 0;
  });
  ud<DefData>(g).fire = (a?: number) => { fired = performance.now(); if (a !== undefined) aim = a; };
  return g;
}

function auraLamp(lv: number): Node {
  // L1 desk-lamp purple bulb, L2 tall pole with a halo, L3 floating crystal with orbiting rings
  const g = group(null, 'lamp');
  const pole = std(lv === 3 ? 0xffc83d : 0x2a2d38, { metalness: 0.7, roughness: 0.4 });
  const glow = std(0xe9c8ff, { emissive: 0xb46bff, emissiveIntensity: 1.2 + lv * 0.8 });
  const h = [0, 0.8, 1.3, 1.5][lv];
  add(g, at(cyl(0.22, 0.3, 0.12, pole, { seg: 12 }), 0, 0.06, 0));
  if (lv < 3) add(g, at(cyl(0.04, 0.05, h, pole, { seg: 8 }), 0, h / 2, 0));
  const bulb = at(lv === 3 ? octa(0.22, glow) : sphere(0.16 + lv * 0.03, glow, { seg: 14 }), 0, h + 0.12, 0);
  add(g, bulb);
  const rings: Mesh[] = [];
  for (let i = 0; i < lv - 1; i++) {
    const r = at(torus(0.3 + i * 0.12, 0.02, glow, 32), 0, h + 0.12, 0);
    r.rotation.x = Math.PI / 2;
    add(g, r);
    rings.push(r);
  }
  const poolMat = basic(0xb46bff, { opacity: 0.18, depthWrite: false });
  const pool = at(circle(0.6 + lv * 0.35, poolMat, 32), 0, 0.02, 0);
  pool.rotation.x = -Math.PI / 2;
  add(g, pool);
  let off = false;
  let flash = 0;
  addTick(g, (t) => {
    const pulse = 0.5 + 0.5 * Math.sin(t / 350);
    const f = t - flash < 200 ? 4 : 0;
    glow.emissiveIntensity = off ? 0.05 : 1 + lv * 0.8 + pulse * 0.8 + f;
    show(pool, !off);
    setOpacity(poolMat, 0.12 + pulse * 0.1);
    if (lv === 3) { bulb.rotation.y = t / 600; bulb.position.y = h + 0.12 + Math.sin(t / 500) * 0.08; }
    rings.forEach((r, i) => { r.rotation.x = Math.PI / 2 + Math.sin(t / 700 + i) * 0.6; r.rotation.y = t / (500 + i * 200); });
  });
  const d = ud<DefData>(g);
  d.fire = () => { flash = performance.now(); };
  d.setOff = (o: boolean) => { off = o; };
  return g;
}

function bassDrop(lv: number): Node {
  // L1 one speaker box, L2 stacked pair, L3 three-speaker wall with neon and a gold chain
  const g = group(null, 'bass');
  const cab = std(lv === 3 ? 0x15151c : 0x26262e, { roughness: 0.8 });
  const coneM = std(0x55555f, { metalness: 0.3, roughness: 0.5 });
  const neon = std(0x7ef9ff, { emissive: 0x3bd1ff, emissiveIntensity: lv === 1 ? 0.5 : 1.6 });
  const spots: Array<[number, number, number]> = lv === 1 ? [[0, 0.3, 0.5]] : lv === 2 ? [[0, 0.3, 0.5], [0, 0.85, 0.42]] : [[-0.3, 0.3, 0.45], [0.3, 0.3, 0.45], [0, 0.8, 0.55]];
  const woofers: Mesh[] = [];
  for (const [x, y, s] of spots) {
    add(g, box(s * 1.1, s * 1.1, s * 0.8, cab, x, y, 0));
    const w = at(cyl(s * 0.38, s * 0.42, 0.06, coneM, { seg: 20 }), x, y, s * 0.42);
    w.rotation.x = Math.PI / 2;
    add(g, w);
    woofers.push(w);
    add(g, at(torus(s * 0.43, 0.018, neon, 24), x, y, s * 0.44));
  }
  if (lv === 3) {
    const gold = std(0xffc83d, { metalness: 0.55, roughness: 0.25 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * Math.PI;
      const link = at(torus(0.035, 0.012, gold, 10), Math.cos(a) * 0.35, 1.12 - Math.sin(a) * 0.12, 0.3);
      link.rotation.y = i % 2 ? Math.PI / 2 : 0;
      add(g, link);
    }
  }
  let dropped = 0;
  addTick(g, (t) => {
    const age = (t - dropped) / 400;
    const thump = age < 1 ? (1 - age) * 0.25 : 0.03 * Math.max(0, Math.sin(t / 120));
    for (const w of woofers) w.scaling.set(1 + thump, 1 + thump * 3, 1 + thump);
    neon.emissiveIntensity = (lv === 1 ? 0.5 : 1.6) + (age < 1 ? (1 - age) * 3 : 0);
  });
  ud<DefData>(g).fire = () => { dropped = performance.now(); };
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

export interface GearData { gear?: Node; gearKey?: string; kickFeet?: Node[] }
export interface GearNodeData { helmet: boolean; feet: Node[]; setShield: (on: boolean, t: number) => void }

/**
 * Put kicks and body armour (tiers 0..3) on a character node. Calling it again replaces
 * the old gear. Returns the gear node (also kept as ud<GearData>(owner).gear).
 */
export function applyGear(owner: Node, kicks: number, vest: number, a: GearAnchors = BRO_ANCHORS): Node {
  const od = ud<GearData>(owner);
  od.gear?.dispose(false, true);
  const gear = group(owner, 'gear');
  od.gear = gear;
  od.gearKey = `${kicks}:${vest}`;
  const gd = ud<GearNodeData>(gear);
  gd.feet = kicks > 0 ? makeKicks(gear, kicks, a) : [];
  if (vest > 0) makeVest(vest, a).parent = gear;
  gd.helmet = vest >= 3; // a custom avatar should hide its hat and hair while this is true
  castShadows(gear);
  // armour bubble that flashes when it blocks a grab (setShield)
  const bubbleMat = basic(vest >= 3 ? 0xffd23f : 0x9fd8ff, { opacity: 0, depthWrite: false });
  const bubble = at(sphere(0.75, bubbleMat, { seg: 20 }), 0, a.torsoY + 0.1, 0);
  bubble.parent = gear;
  bubble.setEnabled(false);
  gd.setShield = (on: boolean, t: number) => {
    show(bubble, on);
    bubbleMat.alpha = on ? 0.25 + 0.15 * Math.sin(t / 60) : 0;
  };
  return gear;
}

function makeKicks(parent: Node, tier: number, a: GearAnchors): Node[] {
  const upper = tier === 1 ? std(0xf4f4f4, { roughness: 0.5 })
    : tier === 2 ? std(0x1b1b22, { roughness: 0.4 })
    : std(0xffc83d, { metalness: 0.55, roughness: 0.25, emissive: 0x553300, emissiveIntensity: 0.5 });
  const sole = tier === 1 ? std(0xffffff)
    : std(tier === 2 ? 0x7dff6b : 0xffffff, { emissive: tier === 2 ? 0x2bff3a : 0xfff1a0, emissiveIntensity: 1.8 });
  const accent = tier === 1 ? std(0xe0263b) : tier === 2 ? std(0x7dff6b, { emissive: 0x2bff3a, emissiveIntensity: 1.2 }) : std(0xffffff);
  const wingMat = std(0xffffff, { emissive: 0xfff6d0, emissiveIntensity: 0.6, doubleSide: true });
  const feet: Node[] = [];
  for (const s of [-1, 1]) {
    const foot = group(parent, 'foot');
    foot.position.set(s * a.footX, a.footY, 0.04);
    add(foot, box(0.15, 0.1, 0.28, upper, 0, 0.03, 0), box(0.16, 0.04, 0.3, sole, 0, -0.03, 0), box(0.012, 0.04, 0.16, accent, s * 0.077, 0.03, -0.02));
    if (tier === 3) {
      const wing = at(plane(0.16, 0.1, wingMat), s * 0.1, 0.08, -0.08);
      wing.rotation.set(0, s * 0.6, s * 0.4);
      add(foot, wing);
      addTick(wing, (t) => { wing.rotation.z = s * (0.4 + Math.sin(t / 90) * 0.35); });
    }
    feet.push(foot);
  }
  return feet;
}

function makeVest(tier: number, a: GearAnchors): Node {
  const g = group(null, 'vest');
  if (tier === 1) {
    // padded hoodie vest with a hood bunched behind the head and a zipper
    const pad = std(0x4f5b3a, { roughness: 0.85, doubleSide: true });
    add(g, at(cyl(a.torsoR + 0.02, a.torsoR + 0.04, a.torsoH * 0.8, pad, { seg: 14, open: true }), 0, a.torsoY + 0.05, 0));
    const quiltM = std(0x3c4630);
    for (const y of [-0.1, 0.05, 0.2]) {
      const q = at(torus(a.torsoR + 0.035, 0.012, quiltM, 20), 0, a.torsoY + y, 0);
      q.rotation.x = Math.PI / 2;
      add(g, q);
    }
    add(g, box(0.02, a.torsoH * 0.78, 0.02, std(0xd0d0d0, { metalness: 0.8 }), 0, a.torsoY + 0.05, a.torsoR + 0.04));
    const hood = at(torus(0.16, 0.06, pad, 14), 0, a.shoulderY + 0.06, -0.12);
    hood.rotation.x = Math.PI / 2.4;
    add(g, hood);
    return g;
  }
  const plate = tier === 2
    ? std(0xa9b2bf, { metalness: 0.55, roughness: 0.3 })
    : std(0xffc83d, { metalness: 0.55, roughness: 0.2, emissive: 0x5a3800, emissiveIntensity: 0.5 });
  const trim = tier === 2 ? std(0x3a3f4b, { metalness: 0.7 }) : std(0xd9a0ff, { emissive: 0xb46bff, emissiveIntensity: 1.8 });
  // chest and back plates
  for (const z of [1, -1]) {
    add(g,
      box(a.torsoR * 1.6, a.torsoH * 0.75, 0.07, plate, 0, a.torsoY + 0.06, z * (a.torsoR - 0.02)),
      box(a.torsoR * 1.6, 0.03, 0.08, trim, 0, a.torsoY + 0.06 + a.torsoH * 0.37, z * (a.torsoR - 0.02)));
  }
  add(g, box(a.torsoR * 1.7, 0.08, a.torsoR * 2.05, trim, 0, a.torsoY - a.torsoH * 0.32, 0)); // belt
  // shoulder pads
  for (const s of [-1, 1]) {
    const pad = at(sphere(0.13, plate, { seg: 12, slice: 0.5 }), s * a.shoulderX, a.shoulderY, 0);
    pad.scaling.set(1.1, 0.8, 1);
    pad.rotation.z = -s * 0.35;
    add(g, pad);
  }
  if (tier === 2) {
    // rivets on the chest
    const rv = std(0x5d6470, { metalness: 0.55 });
    for (const x of [-0.12, 0.12]) for (const y of [-0.08, 0.12]) add(g, at(sphere(0.02, rv, { seg: 6 }), x, a.torsoY + 0.06 + y, a.torsoR + 0.02));
    return g;
  }
  // tier 3: gold helmet with a glowing visor, a chest gem, and an aura halo of sparkles
  add(g,
    at(sphere(a.headR + 0.035, plate, { seg: 16, slice: 1 / 1.8 }), 0, a.headY, 0),
    box(a.headR * 1.5, 0.06, 0.04, trim, 0, a.headY + 0.04, a.headR + 0.01),
    at(cone(0.04, 0.16, trim, 4), 0, a.headY + a.headR + 0.1, 0));
  const gem = at(octa(0.06, trim), 0, a.torsoY + 0.12, a.torsoR + 0.05);
  add(g, gem);
  const sparkles = group(g, 'sparkles');
  const sp = basic(0xffe9a0);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    add(sparkles, at(octa(0.03, sp), Math.cos(ang) * 0.5, 0, Math.sin(ang) * 0.5));
  }
  sparkles.position.y = a.torsoY;
  addTick(sparkles, (t) => {
    sparkles.rotation.y = t / 700;
    sparkles.position.y = a.torsoY + Math.sin(t / 500) * 0.15;
    gem.rotation.y = t / 300;
  });
  return g;
}
