// Builds a bro's 3D figure from their Look (shared/look.ts). Used by the in-game
// renderer and the character creator preview.
//
// Layering for gear (armour, shoes, helmets): attach meshes to `anchors.head`,
// `anchors.torso` or `anchors.feet` and make them slightly bigger than the body
// so they sit over the outfit. Call `setHeadwearVisible(false)` when a helmet
// replaces the custom hat and hair.

import * as THREE from 'three';
import { ACCESSORIES, HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES, type Look } from '../../shared/look.ts';

/** Body measurements for gear layering (matches the gear thread's GearAnchors), relative to the group. */
export interface AvatarAnchors {
  footY: number; footX: number;
  torsoY: number; torsoR: number; torsoH: number;
  headY: number; headR: number;
  shoulderX: number; shoulderY: number;
}

export interface Avatar {
  group: THREE.Group;
  /** torso mesh (kept for code that tints or flashes the body) */
  body: THREE.Mesh;
  anchors: { head: THREE.Group; torso: THREE.Group; feet: THREE.Group };
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  /** body radius at the chest, for gear sizing */
  bodyRadius: number;
  /** y of the top of the head (hat excluded) */
  headTop: number;
  measure: AvatarAnchors;
  setHeadwearVisible(on: boolean): void;
  /** NPC ghost mode: see-through */
  setGhost(on: boolean): void;
  /** walk cycle; speed 0 = idle */
  animate(timeSec: number, speed: number): void;
  dispose(): void;
}

const std = (color: number, roughness = 0.7, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, ...extra });

const HEAD_Y = 1.1;
const HEAD_R = 0.22;
const HIP_Y = 0.44;
const SHOULDER_Y = 0.88;

function jerseyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 34px Arial Black, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('67', 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildAvatar(look: Look): Avatar {
  const group = new THREE.Group();
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const track = <T extends THREE.Mesh>(m: T): T => {
    const mm = m.material;
    (Array.isArray(mm) ? mm : [mm]).forEach((x) => mats.push(x));
    geos.push(m.geometry);
    m.castShadow = true;
    return m;
  };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => track(new THREE.Mesh(g, m));

  const skinC = SKIN_TONES[look.skin] ?? SKIN_TONES[1];
  const hairC = HAIR_COLORS[look.hairColor] ?? HAIR_COLORS[0];
  const topC = OUTFIT_COLORS[look.topColor] ?? OUTFIT_COLORS[5];
  const pantsC = OUTFIT_COLORS[look.pantsColor] ?? OUTFIT_COLORS[10];
  const skin = std(skinC, 0.65);
  const hairM = std(hairC, 0.85);
  const top = std(topC, 0.75);
  const pants = std(pantsC, 0.8);
  const shoe = std(0xf4f4f4, 0.6);
  const sole = std(0x222222, 0.9);

  const anchors = { head: new THREE.Group(), torso: new THREE.Group(), feet: new THREE.Group() };
  anchors.head.position.y = HEAD_Y;
  anchors.torso.position.y = 0.68;
  group.add(anchors.head, anchors.torso, anchors.feet);

  // ---- legs ----
  const leg = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.11, HIP_Y, 0);
    const l = mesh(new THREE.CapsuleGeometry(0.085, 0.24, 3, 8), pants);
    l.position.y = -0.2;
    const s = mesh(new THREE.BoxGeometry(0.15, 0.08, 0.24), shoe);
    s.position.set(0, -HIP_Y + 0.05, 0.04);
    const so = mesh(new THREE.BoxGeometry(0.155, 0.025, 0.25), sole);
    so.position.set(0, -HIP_Y + 0.013, 0.04);
    pivot.add(l, s, so);
    group.add(pivot);
    return pivot;
  };
  const legL = leg(-1);
  const legR = leg(1);

  // ---- torso by top style ----
  const style = look.top;
  const puffer = style === 4;
  const bodyRadius = puffer ? 0.31 : 0.26;
  const body = mesh(new THREE.CapsuleGeometry(bodyRadius, 0.26, 4, 12), top);
  body.position.y = 0.66;
  group.add(body);
  if (style === 3) {
    // jersey: the number 67 on the chest
    const num = mesh(
      new THREE.PlaneGeometry(0.26, 0.26),
      new THREE.MeshStandardMaterial({ map: jerseyTexture(), transparent: true, roughness: 0.7 }),
    );
    num.castShadow = false;
    num.position.set(0, 0.7, bodyRadius + 0.004);
    group.add(num);
  }
  // hips in pants colour
  const hips = mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.12, 12), pants);
  hips.position.y = HIP_Y + 0.02;
  group.add(hips);

  if (style === 0) {
    // hoodie: hood bunched behind the neck, front pocket, strings
    const hood = mesh(new THREE.TorusGeometry(0.16, 0.06, 8, 16), top);
    hood.position.set(0, 0.92, -0.06);
    hood.rotation.x = Math.PI / 2.6;
    const pocket = mesh(new THREE.BoxGeometry(0.26, 0.1, 0.03), std(new THREE.Color(topC).multiplyScalar(0.8).getHex()));
    pocket.position.set(0, 0.56, bodyRadius - 0.01);
    group.add(hood, pocket);
    for (const dx of [-0.05, 0.05]) {
      const s = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 4), std(0xffffff));
      s.position.set(dx, 0.82, bodyRadius - 0.005);
      group.add(s);
    }
  } else if (style === 2) {
    // tank: skin showing at the shoulders
    for (const dx of [-0.17, 0.17]) {
      const sh = mesh(new THREE.SphereGeometry(0.1, 10, 8), skin);
      sh.position.set(dx, 0.86, 0);
      group.add(sh);
    }
  } else if (puffer) {
    const band = std(new THREE.Color(topC).multiplyScalar(0.75).getHex());
    for (const y of [0.56, 0.7, 0.84]) {
      const r = mesh(new THREE.TorusGeometry(bodyRadius - 0.01, 0.025, 6, 20), band);
      r.rotation.x = Math.PI / 2;
      r.position.y = y;
      group.add(r);
    }
    const collar = mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.1, 12), top);
    collar.position.y = 0.97;
    group.add(collar);
  } else if (style === 5) {
    // suit: white shirt + red tie on the jacket
    const shirt = mesh(new THREE.BoxGeometry(0.12, 0.3, 0.02), std(0xf6f6f6));
    shirt.position.set(0, 0.78, bodyRadius - 0.02);
    const tie = mesh(new THREE.BoxGeometry(0.045, 0.26, 0.02), std(0xd11a3c));
    tie.position.set(0, 0.76, bodyRadius - 0.005);
    group.add(shirt, tie);
  }

  // ---- arms ----
  const sleeveFull = style === 0 || style === 4 || style === 5;
  const arm = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * (bodyRadius + 0.06), SHOULDER_Y, 0);
    const upper = mesh(new THREE.CapsuleGeometry(puffer ? 0.085 : 0.065, 0.14, 3, 8), style === 2 ? skin : top);
    upper.position.y = -0.1;
    const lower = mesh(new THREE.CapsuleGeometry(0.058, 0.12, 3, 8), sleeveFull ? top : skin);
    lower.position.y = -0.27;
    const hand = mesh(new THREE.SphereGeometry(0.06, 8, 6), skin);
    hand.position.y = -0.38;
    pivot.add(upper, lower, hand);
    pivot.rotation.z = side * 0.12;
    group.add(pivot);
    return pivot;
  };
  const armL = arm(-1);
  const armR = arm(1);

  // ---- head ----
  const neck = mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 8), skin);
  neck.position.y = 0.95;
  group.add(neck);
  const head = mesh(new THREE.SphereGeometry(HEAD_R, 16, 12), skin);
  anchors.head.add(head);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  mats.push(eyeMat);
  for (const dx of [-0.075, 0.075]) {
    const white = mesh(new THREE.SphereGeometry(0.045, 8, 6), std(0xffffff, 0.3));
    white.position.set(dx, 0.03, HEAD_R - 0.03);
    white.scale.z = 0.5;
    const eye = mesh(new THREE.SphereGeometry(0.025, 6, 6), eyeMat);
    eye.position.set(dx, 0.03, HEAD_R + 0.005);
    anchors.head.add(white, eye);
  }
  const mouth = mesh(new THREE.BoxGeometry(0.08, 0.015, 0.01), std(0x5a2020));
  mouth.position.set(0, -0.08, HEAD_R - 0.01);
  anchors.head.add(mouth);
  for (const dx of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.045, 8, 6), skin);
    ear.position.set(dx * HEAD_R, 0, 0);
    ear.scale.set(0.5, 1, 0.8);
    anchors.head.add(ear);
  }

  // ---- hair ----
  const hair = new THREE.Group();
  anchors.head.add(hair);
  const capGeo = (r: number, theta: number) => new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, theta);
  switch (look.hair) {
    case 1: { // buzz
      hair.add(mesh(capGeo(HEAD_R + 0.008, Math.PI / 2.1), hairM));
      break;
    }
    case 2: { // low taper fade: tall top, tight sides
      const top = mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.14, 14), hairM);
      top.position.y = 0.14;
      const fade = mesh(capGeo(HEAD_R + 0.004, Math.PI / 2.4), std(new THREE.Color(hairC).lerp(new THREE.Color(skinC), 0.5).getHex(), 0.9));
      hair.add(top, fade);
      break;
    }
    case 3: { // fluffy
      hair.add(mesh(capGeo(HEAD_R + 0.03, Math.PI / 2), hairM));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const puff = mesh(new THREE.SphereGeometry(0.075, 8, 6), hairM);
        puff.position.set(Math.cos(a) * 0.15, 0.13 + (i % 2) * 0.03, Math.sin(a) * 0.15);
        hair.add(puff);
      }
      break;
    }
    case 4: { // mullet: business in front, party in the back
      hair.add(mesh(capGeo(HEAD_R + 0.015, Math.PI / 2), hairM));
      const back = mesh(new THREE.BoxGeometry(0.3, 0.3, 0.1), hairM);
      back.position.set(0, -0.12, -0.17);
      hair.add(back);
      break;
    }
    case 5: { // afro
      const fro = mesh(new THREE.SphereGeometry(0.33, 16, 12), hairM);
      fro.position.set(0, 0.1, -0.05);
      fro.scale.set(1, 0.85, 1);
      hair.add(fro);
      break;
    }
    case 6: { // spikes
      hair.add(mesh(capGeo(HEAD_R + 0.008, Math.PI / 2.2), hairM));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const s = mesh(new THREE.ConeGeometry(0.05, 0.16, 6), hairM);
        s.position.set(Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12);
        s.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        hair.add(s);
      }
      const c = mesh(new THREE.ConeGeometry(0.06, 0.2, 6), hairM);
      c.position.y = 0.27;
      hair.add(c);
      break;
    }
    case 7: { // mohawk
      for (let i = 0; i < 6; i++) {
        const s = mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), hairM);
        const a = -0.3 + (i / 5) * 2.2;
        s.position.set(0, Math.cos(a) * (HEAD_R + 0.05), Math.sin(a) * (HEAD_R + 0.05));
        s.rotation.x = a;
        hair.add(s);
      }
      break;
    }
  }

  // ---- hat ----
  const hat = new THREE.Group();
  anchors.head.add(hat);
  const hatC = OUTFIT_COLORS[(look.topColor + 6) % OUTFIT_COLORS.length];
  switch (look.hat) {
    case 1:
    case 2: { // cap (2 = backwards)
      const m = std(hatC, 0.7);
      const crown = mesh(capGeo(HEAD_R + 0.03, Math.PI / 2), m);
      crown.position.y = 0.02;
      const bill = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 16, 1, false, 0, Math.PI), m);
      bill.position.set(0, 0.06, HEAD_R - 0.02);
      bill.rotation.y = -Math.PI / 2;
      bill.scale.z = 1.2;
      const capGroup = new THREE.Group();
      capGroup.add(crown, bill);
      if (look.hat === 2) capGroup.rotation.y = Math.PI;
      hat.add(capGroup);
      break;
    }
    case 3: { // beanie with pom
      const m = std(hatC, 0.95);
      const b = mesh(capGeo(HEAD_R + 0.035, Math.PI / 1.9), m);
      b.scale.y = 1.25;
      const cuff = mesh(new THREE.TorusGeometry(HEAD_R + 0.02, 0.035, 6, 20), m);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = 0.02;
      const pom = mesh(new THREE.SphereGeometry(0.06, 8, 6), std(0xffffff, 1));
      pom.position.y = HEAD_R + 0.08;
      hat.add(b, cuff, pom);
      break;
    }
    case 4: { // crown
      const gold = std(0xffd23f, 0.25, { metalness: 0.8, emissive: 0x6a4a00, emissiveIntensity: 0.3 });
      const band = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 16, 1, true), gold);
      band.position.y = 0.2;
      hat.add(band);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const p = mesh(new THREE.ConeGeometry(0.035, 0.09, 4), gold);
        p.position.set(Math.cos(a) * 0.17, 0.28, Math.sin(a) * 0.17);
        hat.add(p);
      }
      const gem = mesh(new THREE.OctahedronGeometry(0.03), std(0xff3b6b, 0.2, { emissive: 0x88001a }));
      gem.position.set(0, 0.2, 0.175);
      hat.add(gem);
      break;
    }
    case 5: { // propeller beanie
      const quarters = [0xff3b6b, 0x3fa9ff, 0xffd23f, 0x5dff8a];
      quarters.forEach((c, i) => {
        const q = mesh(new THREE.SphereGeometry(HEAD_R + 0.03, 8, 8, (i * Math.PI) / 2, Math.PI / 2, 0, Math.PI / 2.1), std(c, 0.7));
        hat.add(q);
      });
      const stem = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), std(0x888888));
      stem.position.y = HEAD_R + 0.06;
      const prop = new THREE.Group();
      prop.position.y = HEAD_R + 0.1;
      prop.name = 'propeller';
      for (const r of [0, Math.PI]) {
        const blade = mesh(new THREE.BoxGeometry(0.22, 0.01, 0.05), std(0xffd23f));
        blade.position.x = Math.cos(r) * 0.11;
        prop.add(blade);
      }
      hat.add(stem, prop);
      break;
    }
    case 6: { // cowboy hat
      const m = std(0x8a5a2b, 0.9);
      const brim = mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.025, 20), m);
      brim.position.y = 0.11;
      brim.scale.z = 0.85;
      const crown = mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.2, 16), m);
      crown.position.y = 0.22;
      const band = mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.035, 16), std(0x2a1a0e));
      band.position.y = 0.14;
      hat.add(brim, crown, band);
      break;
    }
    case 7: { // traffic cone
      const cone = mesh(new THREE.ConeGeometry(0.2, 0.5, 16), std(0xff6a1a, 0.6));
      cone.position.y = 0.38;
      const stripe = mesh(new THREE.CylinderGeometry(0.105, 0.135, 0.07, 16), std(0xffffff, 0.4));
      stripe.position.y = 0.4;
      const base = mesh(new THREE.BoxGeometry(0.44, 0.03, 0.44), std(0xff6a1a, 0.6));
      base.position.y = 0.14;
      hat.add(cone, stripe, base);
      break;
    }
  }
  // most hats squash the hair under them; afro and mohawk poke out
  if (look.hat !== 0 && look.hat !== 4 && look.hair !== 5) hair.scale.set(0.98, 0.6, 0.98);

  // ---- accessory ----
  switch (ACCESSORIES[look.acc]) {
    case 'Deal-with-it shades': {
      const m = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.15, metalness: 0.4 });
      for (const dx of [-0.075, 0.075]) {
        const lens = mesh(new THREE.BoxGeometry(0.11, 0.06, 0.02), m);
        lens.position.set(dx, 0.035, HEAD_R + 0.02);
        anchors.head.add(lens);
      }
      const bridge = mesh(new THREE.BoxGeometry(0.4, 0.025, 0.02), m);
      bridge.position.set(0, 0.06, HEAD_R + 0.02);
      anchors.head.add(bridge);
      break;
    }
    case 'Gold chain': {
      const gold = std(0xffd23f, 0.25, { metalness: 0.9, emissive: 0x4a3200, emissiveIntensity: 0.3 });
      const chain = mesh(new THREE.TorusGeometry(0.15, 0.022, 6, 24), gold);
      chain.position.set(0, 0.87, 0.08);
      chain.rotation.x = Math.PI / 2.5;
      const pend = mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), gold);
      pend.position.set(0, 0.74, bodyRadius + 0.01);
      group.add(chain, pend);
      break;
    }
    case 'Mustache': {
      const m = mesh(new THREE.CapsuleGeometry(0.025, 0.1, 3, 6), hairM);
      m.rotation.z = Math.PI / 2;
      m.position.set(0, -0.04, HEAD_R - 0.005);
      anchors.head.add(m);
      break;
    }
    case 'Headphones': {
      const m = std(0x222222, 0.4);
      const band = mesh(new THREE.TorusGeometry(HEAD_R + 0.04, 0.02, 6, 20, Math.PI), m);
      band.position.y = 0.02;
      for (const dx of [-1, 1]) {
        const cup = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 12), std(hatC, 0.5));
        cup.rotation.z = Math.PI / 2;
        cup.position.set(dx * (HEAD_R + 0.03), 0, 0);
        anchors.head.add(cup);
      }
      anchors.head.add(band);
      break;
    }
    case 'Clown nose': {
      const n = mesh(new THREE.SphereGeometry(0.045, 10, 8), std(0xff1a1a, 0.3));
      n.position.set(0, -0.02, HEAD_R + 0.02);
      anchors.head.add(n);
      break;
    }
    case 'Mewing jaw': {
      const jaw = mesh(new THREE.BoxGeometry(0.3, 0.1, 0.22), skin);
      jaw.position.set(0, -0.13, 0.03);
      anchors.head.add(jaw);
      mouth.position.y = -0.1;
      mouth.position.z = HEAD_R + 0.04;
      break;
    }
  }

  const propeller = hat.getObjectByName('propeller');
  const baseOpacity = new Map<THREE.Material, { t: boolean; o: number }>();
  for (const m of mats) baseOpacity.set(m, { t: m.transparent, o: m.opacity });

  return {
    group, body, anchors, armL, armR, legL, legR, bodyRadius, headTop: HEAD_Y + HEAD_R,
    measure: {
      footY: 0.06, footX: 0.11,
      torsoY: 0.62, torsoR: bodyRadius + 0.02, torsoH: 0.5,
      headY: HEAD_Y, headR: HEAD_R,
      shoulderX: bodyRadius + 0.06, shoulderY: SHOULDER_Y,
    },
    setHeadwearVisible(on: boolean) { hat.visible = on; hair.visible = on; },
    setGhost(on: boolean) {
      for (const m of mats) {
        const b = baseOpacity.get(m)!;
        m.transparent = on || b.t;
        m.opacity = on ? 0.35 : b.o;
        m.depthWrite = !on;
      }
    },
    animate(time: number, speed: number) {
      const s = Math.min(1, speed);
      const sw = Math.sin(time * 10) * 0.6 * s;
      legL.rotation.x = sw;
      legR.rotation.x = -sw;
      armL.rotation.x = -sw * 0.8;
      armR.rotation.x = sw * 0.8;
      if (propeller) propeller.rotation.y = time * (6 + 20 * s);
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) {
        const map = (m as THREE.MeshStandardMaterial).map;
        if (map) map.dispose();
        m.dispose();
      }
    },
  };
}
