// Builds a bro's 3D figure from their Look (shared/look.ts). Used by the in-game
// renderer and the character creator preview.
//
// Layering for gear (armour, shoes, helmets): attach meshes to `anchors.head`,
// `anchors.torso` or `anchors.feet` and make them slightly bigger than the body
// so they sit over the outfit. Call `setHeadwearVisible(false)` when a helmet
// replaces the custom hat and hair.

import { ACCESSORIES, HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES, type Look } from '../../shared/look.ts';
import {
  add, basic, box, canvasTexture, capsule, cone, cyl, dispose, fade, group, mix, octa, plane, shade, show, sphere, std, torus,
  type Mesh, type Node,
} from './bjs/kit.ts';

/** Body measurements for gear layering (matches the gear thread's GearAnchors), relative to the group. */
export interface AvatarAnchors {
  footY: number; footX: number;
  torsoY: number; torsoR: number; torsoH: number;
  headY: number; headR: number;
  shoulderX: number; shoulderY: number;
}

export interface Avatar {
  group: Node;
  /** torso mesh (kept for code that tints or flashes the body) */
  body: Mesh;
  anchors: { head: Node; torso: Node; feet: Node };
  armL: Node;
  armR: Node;
  legL: Node;
  legR: Node;
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

const HEAD_Y = 1.1;
const HEAD_R = 0.22;
const HIP_Y = 0.44;
const SHOULDER_Y = 0.88;

const m = (o: Mesh, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); return o; };

export function buildAvatar(look: Look): Avatar {
  const root = group(null, 'bro');

  const skinC = SKIN_TONES[look.skin] ?? SKIN_TONES[1];
  const hairC = HAIR_COLORS[look.hairColor] ?? HAIR_COLORS[0];
  const topC = OUTFIT_COLORS[look.topColor] ?? OUTFIT_COLORS[5];
  const pantsC = OUTFIT_COLORS[look.pantsColor] ?? OUTFIT_COLORS[10];
  const skin = std(skinC, { roughness: 0.65 });
  const hairM = std(hairC, { roughness: 0.85 });
  const top = std(topC, { roughness: 0.75 });
  const pants = std(pantsC, { roughness: 0.8 });
  const shoe = std(0xf4f4f4, { roughness: 0.6 });
  const sole = std(0x222222, { roughness: 0.9 });

  const anchors = { head: group(root, 'head'), torso: group(root, 'torso'), feet: group(root, 'feet') };
  anchors.head.position.y = HEAD_Y;
  anchors.torso.position.y = 0.68;

  // ---- legs ----
  const leg = (side: number) => {
    const pivot = group(root, 'leg');
    pivot.position.set(side * 0.11, HIP_Y, 0);
    add(pivot,
      m(capsule(0.085, 0.24, pants, 8), 0, -0.2, 0),
      m(box(0.15, 0.08, 0.24, shoe), 0, -HIP_Y + 0.05, 0.04),
      m(box(0.155, 0.025, 0.25, sole), 0, -HIP_Y + 0.013, 0.04));
    return pivot;
  };
  const legL = leg(-1);
  const legR = leg(1);

  // ---- torso by top style ----
  const style = look.top;
  const puffer = style === 4;
  const bodyRadius = puffer ? 0.31 : 0.26;
  const body = m(capsule(bodyRadius, 0.26, top, 12), 0, 0.66, 0);
  add(root, body);
  if (style === 3) {
    // jersey: the number 67 on the chest
    const tex = canvasTexture(64, 64, (ctx) => {
      ctx.clearRect(0, 0, 64, 64);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 34px Arial Black, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('67', 32, 34);
    });
    const numMat = std(0xffffff, { roughness: 0.7, map: tex });
    numMat.useAlphaFromAlbedoTexture = true;
    numMat.transparencyMode = 1; // alpha test
    add(root, m(plane(0.26, 0.26, numMat), 0, 0.7, bodyRadius + 0.004));
  }
  // hips in pants colour
  add(root, m(cyl(0.22, 0.2, 0.12, pants, { seg: 12 }), 0, HIP_Y + 0.02, 0));

  if (style === 0) {
    // hoodie: hood bunched behind the neck, front pocket, strings
    const hood = m(torus(0.16, 0.06, top, 16), 0, 0.92, -0.06);
    hood.rotation.x = Math.PI / 2.6;
    const pocket = m(box(0.26, 0.1, 0.03, std(shade(topC, 0.8))), 0, 0.56, bodyRadius - 0.01);
    add(root, hood, pocket);
    const white = std(0xffffff);
    for (const dx of [-0.05, 0.05]) add(root, m(cyl(0.008, 0.008, 0.14, white, { seg: 4 }), dx, 0.82, bodyRadius - 0.005));
  } else if (style === 2) {
    // tank: skin showing at the shoulders
    for (const dx of [-0.17, 0.17]) add(root, m(sphere(0.1, skin, { seg: 10 }), dx, 0.86, 0));
  } else if (puffer) {
    const band = std(shade(topC, 0.75));
    for (const y of [0.56, 0.7, 0.84]) {
      const r = m(torus(bodyRadius - 0.01, 0.025, band, 20), 0, y, 0);
      r.rotation.x = Math.PI / 2;
      add(root, r);
    }
    add(root, m(cyl(0.13, 0.17, 0.1, top, { seg: 12 }), 0, 0.97, 0));
  } else if (style === 5) {
    // suit: white shirt + red tie on the jacket
    add(root,
      m(box(0.12, 0.3, 0.02, std(0xf6f6f6)), 0, 0.78, bodyRadius - 0.02),
      m(box(0.045, 0.26, 0.02, std(0xd11a3c)), 0, 0.76, bodyRadius - 0.005));
  }

  // ---- arms ----
  const sleeveFull = style === 0 || style === 4 || style === 5;
  const arm = (side: number) => {
    const pivot = group(root, 'arm');
    pivot.position.set(side * (bodyRadius + 0.06), SHOULDER_Y, 0);
    add(pivot,
      m(capsule(puffer ? 0.085 : 0.065, 0.14, style === 2 ? skin : top, 8), 0, -0.1, 0),
      m(capsule(0.058, 0.12, sleeveFull ? top : skin, 8), 0, -0.27, 0),
      m(sphere(0.06, skin, { seg: 8 }), 0, -0.38, 0));
    pivot.rotation.z = side * 0.12;
    return pivot;
  };
  const armL = arm(-1);
  const armR = arm(1);

  // ---- head ----
  add(root, m(cyl(0.07, 0.08, 0.1, skin, { seg: 8 }), 0, 0.95, 0));
  const H = anchors.head;
  add(H, sphere(HEAD_R, skin, { seg: 16 }));
  const eyeMat = basic(0x111111);
  const eyeWhite = std(0xffffff, { roughness: 0.3 });
  for (const dx of [-0.075, 0.075]) {
    const white = m(sphere(0.045, eyeWhite, { seg: 8 }), dx, 0.03, HEAD_R - 0.03);
    white.scaling.z = 0.5;
    add(H, white, m(sphere(0.025, eyeMat, { seg: 6 }), dx, 0.03, HEAD_R + 0.005));
  }
  const mouth = m(box(0.08, 0.015, 0.01, std(0x5a2020)), 0, -0.08, HEAD_R - 0.01);
  add(H, mouth);
  for (const dx of [-1, 1]) {
    const ear = m(sphere(0.045, skin, { seg: 8 }), dx * HEAD_R, 0, 0);
    ear.scaling.set(0.5, 1, 0.8);
    add(H, ear);
  }

  // ---- hair ----
  const hair = group(H, 'hair');
  const cap = (r: number, theta: number, mat = hairM) => sphere(r, mat, { seg: 16, slice: theta / Math.PI });
  switch (look.hair) {
    case 1: add(hair, cap(HEAD_R + 0.008, Math.PI / 2.1)); break; // buzz
    case 2: { // low taper fade: tall top, tight sides
      add(hair,
        m(cyl(0.17, 0.2, 0.14, hairM, { seg: 14 }), 0, 0.14, 0),
        cap(HEAD_R + 0.004, Math.PI / 2.4, std(mix(hairC, skinC, 0.5), { roughness: 0.9 })));
      break;
    }
    case 3: { // fluffy
      add(hair, cap(HEAD_R + 0.03, Math.PI / 2));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        add(hair, m(sphere(0.075, hairM, { seg: 8 }), Math.cos(a) * 0.15, 0.13 + (i % 2) * 0.03, Math.sin(a) * 0.15));
      }
      break;
    }
    case 4: { // mullet: business in front, party in the back
      add(hair, cap(HEAD_R + 0.015, Math.PI / 2), m(box(0.3, 0.3, 0.1, hairM), 0, -0.12, -0.17));
      break;
    }
    case 5: { // afro
      const fro = m(sphere(0.33, hairM, { seg: 16 }), 0, 0.1, -0.05);
      fro.scaling.set(1, 0.85, 1);
      add(hair, fro);
      break;
    }
    case 6: { // spikes
      add(hair, cap(HEAD_R + 0.008, Math.PI / 2.2));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const s = m(cone(0.05, 0.16, hairM, 6), Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12);
        s.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        add(hair, s);
      }
      add(hair, m(cone(0.06, 0.2, hairM, 6), 0, 0.27, 0));
      break;
    }
    case 7: { // mohawk
      for (let i = 0; i < 6; i++) {
        const a = -0.3 + (i / 5) * 2.2;
        const s = m(box(0.05, 0.16, 0.07, hairM), 0, Math.cos(a) * (HEAD_R + 0.05), Math.sin(a) * (HEAD_R + 0.05));
        s.rotation.x = a;
        add(hair, s);
      }
      break;
    }
  }

  // ---- hat ----
  const hat = group(H, 'hat');
  const hatC = OUTFIT_COLORS[(look.topColor + 6) % OUTFIT_COLORS.length];
  let propeller: Node | null = null;
  switch (look.hat) {
    case 1:
    case 2: { // cap (2 = backwards)
      const mat = std(hatC, { roughness: 0.7 });
      const capGroup = group(hat);
      const crown = m(cap(HEAD_R + 0.03, Math.PI / 2, mat), 0, 0.02, 0);
      const bill = m(cyl(0.15, 0.15, 0.02, mat, { seg: 16, arc: 0.5 }), 0, 0.06, HEAD_R - 0.02);
      bill.rotation.y = -Math.PI / 2;
      bill.scaling.z = 1.2;
      add(capGroup, crown, bill);
      if (look.hat === 2) capGroup.rotation.y = Math.PI;
      break;
    }
    case 3: { // beanie with pom
      const mat = std(hatC, { roughness: 0.95 });
      const b = cap(HEAD_R + 0.035, Math.PI / 1.9, mat);
      b.scaling.y = 1.25;
      const cuff = m(torus(HEAD_R + 0.02, 0.035, mat, 20), 0, 0.02, 0);
      cuff.rotation.x = Math.PI / 2;
      add(hat, b, cuff, m(sphere(0.06, std(0xffffff, { roughness: 1 }), { seg: 8 }), 0, HEAD_R + 0.08, 0));
      break;
    }
    case 4: { // crown
      const gold = std(0xffd23f, { roughness: 0.25, metalness: 0.8, emissive: 0x6a4a00, emissiveIntensity: 0.3 });
      add(hat, m(cyl(0.17, 0.17, 0.08, gold, { seg: 16, open: true }), 0, 0.2, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(hat, m(cone(0.035, 0.09, gold, 4), Math.cos(a) * 0.17, 0.28, Math.sin(a) * 0.17));
      }
      add(hat, m(octa(0.03, std(0xff3b6b, { roughness: 0.2, emissive: 0x88001a })), 0, 0.2, 0.175));
      break;
    }
    case 5: { // propeller beanie
      [0xff3b6b, 0x3fa9ff, 0xffd23f, 0x5dff8a].forEach((c, i) => {
        const q = sphere(HEAD_R + 0.03, std(c, { roughness: 0.7 }), { seg: 8, arc: 0.25, slice: 1 / 2.1 });
        q.rotation.y = (i * Math.PI) / 2;
        add(hat, q);
      });
      add(hat, m(cyl(0.012, 0.012, 0.08, std(0x888888), { seg: 6 }), 0, HEAD_R + 0.06, 0));
      const prop = group(hat, 'propeller');
      prop.position.y = HEAD_R + 0.1;
      const yellow = std(0xffd23f);
      for (const r of [0, Math.PI]) add(prop, m(box(0.22, 0.01, 0.05, yellow), Math.cos(r) * 0.11, 0, 0));
      propeller = prop;
      break;
    }
    case 6: { // cowboy hat
      const mat = std(0x8a5a2b, { roughness: 0.9 });
      const brim = m(cyl(0.38, 0.38, 0.025, mat, { seg: 20 }), 0, 0.11, 0);
      brim.scaling.z = 0.85;
      add(hat, brim, m(cyl(0.15, 0.19, 0.2, mat, { seg: 16 }), 0, 0.22, 0), m(cyl(0.19, 0.19, 0.035, std(0x2a1a0e), { seg: 16 }), 0, 0.14, 0));
      break;
    }
    case 7: { // traffic cone
      const orange = std(0xff6a1a, { roughness: 0.6 });
      add(hat,
        m(cone(0.2, 0.5, orange, 16), 0, 0.38, 0),
        m(cyl(0.105, 0.135, 0.07, std(0xffffff, { roughness: 0.4 }), { seg: 16 }), 0, 0.4, 0),
        m(box(0.44, 0.03, 0.44, orange), 0, 0.14, 0));
      break;
    }
  }
  // most hats squash the hair under them; afro and mohawk poke out
  if (look.hat !== 0 && look.hat !== 4 && look.hair !== 5) hair.scaling.set(0.98, 0.6, 0.98);

  // ---- accessory ----
  switch (ACCESSORIES[look.acc]) {
    case 'Deal-with-it shades': {
      const mat = std(0x050505, { roughness: 0.15, metalness: 0.4 });
      for (const dx of [-0.075, 0.075]) add(H, m(box(0.11, 0.06, 0.02, mat), dx, 0.035, HEAD_R + 0.02));
      add(H, m(box(0.4, 0.025, 0.02, mat), 0, 0.06, HEAD_R + 0.02));
      break;
    }
    case 'Gold chain': {
      const gold = std(0xffd23f, { roughness: 0.25, metalness: 0.9, emissive: 0x4a3200, emissiveIntensity: 0.3 });
      const chain = m(torus(0.15, 0.022, gold, 24), 0, 0.87, 0.08);
      chain.rotation.x = Math.PI / 2.5;
      add(root, chain, m(box(0.08, 0.08, 0.02, gold), 0, 0.74, bodyRadius + 0.01));
      break;
    }
    case 'Mustache': {
      const s = m(capsule(0.025, 0.1, hairM, 6), 0, -0.04, HEAD_R - 0.005);
      s.rotation.z = Math.PI / 2;
      add(H, s);
      break;
    }
    case 'Headphones': {
      const band = m(torus(HEAD_R + 0.04, 0.02, std(0x222222, { roughness: 0.4 }), 20, Math.PI), 0, 0.02, 0);
      add(H, band);
      const cupMat = std(hatC, { roughness: 0.5 });
      for (const dx of [-1, 1]) {
        const c = m(cyl(0.07, 0.07, 0.06, cupMat, { seg: 12 }), dx * (HEAD_R + 0.03), 0, 0);
        c.rotation.z = Math.PI / 2;
        add(H, c);
      }
      break;
    }
    case 'Clown nose': add(H, m(sphere(0.045, std(0xff1a1a, { roughness: 0.3 }), { seg: 10 }), 0, -0.02, HEAD_R + 0.02)); break;
    case 'Mewing jaw': {
      add(H, m(box(0.3, 0.1, 0.22, skin), 0, -0.13, 0.03));
      mouth.position.y = -0.1;
      mouth.position.z = HEAD_R + 0.04;
      break;
    }
  }

  let ghost = false;
  return {
    group: root, body, anchors, armL, armR, legL, legR, bodyRadius, headTop: HEAD_Y + HEAD_R,
    measure: {
      footY: 0.06, footX: 0.11,
      torsoY: 0.62, torsoR: bodyRadius + 0.02, torsoH: 0.5,
      headY: HEAD_Y, headR: HEAD_R,
      shoulderX: bodyRadius + 0.06, shoulderY: SHOULDER_Y,
    },
    setHeadwearVisible(on: boolean) { show(hat, on); show(hair, on); },
    setGhost(on: boolean) {
      if (on === ghost) return;
      ghost = on;
      fade(root, on ? 0.35 : 1);
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
    dispose() { dispose(root, true); },
  };
}
