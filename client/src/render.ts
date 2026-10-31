// 2.5D renderer: a Three.js world under a fixed, angled camera that follows you.
// Game logic is flat (x, y tiles); Three.js uses x -> x, y -> z, with y up.

import * as THREE from 'three';
import { DOOR_LEVEL_HP, PLOT, RING_LIGHT_RANGE } from '../../shared/constants.ts';
import { applyGear, makeDefence, makeDoor, tickUpgrades } from './upgrades.ts';
import { cellAt, doorCenter, plotCenter, ventsFor, type CribView } from '../../shared/world.ts';
import type { DefView, DropView, EntView, PropView, WorldEvents } from '../../shared/protocol.ts';

const CAM_OFFSET = new THREE.Vector3(0, 15, 10.5);
const RING_POOL = 8;
const LAMP_POOL = 6;

function textSprite(text: string, color = '#ffffff', size = 48, bg = 'rgba(0,0,0,0.55)'): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `800 ${size}px Inter, Arial, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + size;
  c.width = w;
  c.height = size * 1.6;
  ctx.font = `800 ${size}px Inter, Arial, sans-serif`;
  if (bg) {
    ctx.fillStyle = bg;
    const r = size * 0.4;
    ctx.beginPath();
    ctx.roundRect(0, 0, c.width, c.height, r);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const s = new THREE.Sprite(mat);
  const scale = 0.006 * (size / 48) * 48 / size;
  s.scale.set(c.width * scale * 0.9, c.height * scale * 0.9, 1);
  s.renderOrder = 10;
  return s;
}

function noiseTexture(base: string, speck: string, n: number, lines = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = speck;
    ctx.globalAlpha = Math.random() * 0.5;
    const s = 2 + Math.random() * 6;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  if (lines) {
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#000';
    for (let y = 0; y <= 256; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
    for (let x = 0; x <= 256; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface BroMesh {
  group: THREE.Group;
  body: THREE.Mesh;
  ring: THREE.Mesh;
  label: THREE.Sprite;
  reviveRing: THREE.Mesh;
  kind: string;
  name: string;
}

interface OppMesh {
  group: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  chest: THREE.Sprite;
  body: THREE.Mesh;
}

/** Paint jobs: each crib picks one from its plot number, so every neighbour looks different. */
const CRIB_STYLES: Array<{ wall: number; floor: number; door: number; h: number }> = [
  { wall: 0xe8d9c0, floor: 0xb08458, door: 0x8a5a2b, h: 1.5 }, // beige stucco, oak floor
  { wall: 0x9fc5e8, floor: 0xd9d2c5, door: 0x2f4f7a, h: 1.7 }, // sky blue, tiles
  { wall: 0xf4b6c2, floor: 0xe9e2d0, door: 0xa8324a, h: 1.4 }, // pink, cream carpet
  { wall: 0xb5d99c, floor: 0x9a7a55, door: 0x3d6b2f, h: 1.6 }, // mint, walnut
  { wall: 0xb8442e, floor: 0x7d6a5a, door: 0x2b2b2b, h: 1.9 }, // red brick, dark floor
  { wall: 0xf3e37c, floor: 0xc9a77a, door: 0x6b4a8a, h: 1.5 }, // yellow, pine
  { wall: 0x8c8f99, floor: 0xa9b0b8, door: 0xd9682b, h: 1.8 }, // concrete, polished
  { wall: 0xffffff, floor: 0x6f4e37, door: 0x111111, h: 1.6 }, // white modern, espresso
  { wall: 0xc9a0dc, floor: 0xe0d6c8, door: 0x4a2a6a, h: 1.45 }, // lilac
  { wall: 0x6b8f71, floor: 0xb39b7a, door: 0xe8c547, h: 1.7 }, // sage
];
function cribStyle(plot: number) {
  return CRIB_STYLES[((plot * 7919) >>> 0) % CRIB_STYLES.length];
}
const DOOR_BROKEN = new THREE.Color(0xc0261a);

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private hemi: THREE.HemisphereLight;
  private moon: THREE.DirectionalLight;
  private selfLight: THREE.PointLight;
  private ringLights: THREE.PointLight[] = [];
  private lampLights: THREE.PointLight[] = [];
  private worldGroup = new THREE.Group();
  private builtR = -1;
  private lamps: THREE.Vector3[] = [];
  private lampHeads: THREE.Mesh[] = [];
  private cribFloors = new Map<number, THREE.Mesh>();
  private floorMatOn: THREE.MeshStandardMaterial;
  private floorMatOff: THREE.MeshStandardMaterial;
  private floorMatMine: THREE.MeshStandardMaterial;
  private floorTex: THREE.Texture;
  private doors = new Map<string, THREE.Group>();
  private cribLabels = new Map<number, { sprite: THREE.Sprite; text: string }>();
  private bros = new Map<string, BroMesh>();
  private opps = new Map<string, OppMesh>();
  private drops = new Map<number, THREE.Mesh>();
  private props = new Map<number, THREE.Object3D>();
  private defs = new Map<number, { g: THREE.Group; bar: THREE.Mesh; lv: number; k: string }>();
  private shots: Array<{ m: THREE.Object3D; born: number }> = [];
  private ripples: Array<{ mesh: THREE.Mesh; born: number; r: number; life?: number }> = [];
  private vents: Array<{ g: THREE.Group; x: number; y: number; until: number }> = [];
  private blips: Array<{ g: THREE.Object3D; born: number; life: number }> = [];
  private seenNoise = new Set<number>();
  private floaters: Array<{ s: THREE.Sprite; born: number }> = [];
  private target = new THREE.Vector3();
  private clock = new THREE.Clock();
  private power = true;
  private zoom = 1;
  private disco: THREE.PointLight[] = [];
  private pets = new Map<number, { g: THREE.Group; kind: string }>();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 200);
    this.scene.background = new THREE.Color(0x3a4a6e);
    this.scene.fog = new THREE.Fog(0x3a4a6e, 40, 80);

    this.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x5a5a6a, 2.4);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.moon.position.set(-8, 20, -6);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(1024, 1024);
    const sc = this.moon.shadow.camera;
    sc.left = sc.bottom = -22; sc.right = sc.top = 22; sc.near = 1; sc.far = 60;
    this.scene.add(this.moon, this.moon.target);

    this.selfLight = new THREE.PointLight(0xbfb4ff, 4, 5.5, 1.6);
    this.scene.add(this.selfLight);
    for (let i = 0; i < RING_POOL; i++) {
      const l = new THREE.PointLight(0xfff1d6, 0, 10, 1.4);
      this.ringLights.push(l);
      this.scene.add(l);
    }
    for (const c of [0xff3b6b, 0x3bd1ff, 0xffd23f]) {
      const l = new THREE.PointLight(c, 0, 16, 1.2);
      this.disco.push(l);
      this.scene.add(l);
    }
    for (let i = 0; i < LAMP_POOL; i++) {
      const l = new THREE.PointLight(0xffb36b, 0, 9, 1.5);
      this.lampLights.push(l);
      this.scene.add(l);
    }

    this.floorMatOn = new THREE.MeshStandardMaterial({ map: noiseTexture('#a87e58', '#6b4a33', 300, true) });
    this.floorTex = noiseTexture('#ffffff', '#c8c8c8', 300, true);
    this.floorMatOff = new THREE.MeshStandardMaterial({ map: noiseTexture('#9a7452', '#6b4a33', 300, true) });
    this.floorMatMine = new THREE.MeshStandardMaterial({ map: noiseTexture('#8f7cc4', '#5e4f80', 300, true) });

    this.scene.add(this.worldGroup);
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /** Build the static neighbourhood for ring radius R. */
  buildWorld(R: number) {
    if (R === this.builtR) return;
    this.builtR = R;
    this.worldGroup.clear();
    this.cribFloors.clear();
    this.lamps = [];
    this.lampHeads = [];
    const lo = -(R * PLOT + PLOT / 2);
    const hi = R * PLOT + PLOT / 2 - 1;
    const span = hi - lo + 1;

    // ground
    const groundTex = noiseTexture('#6d7486', '#454b5a', 900);
    groundTex.repeat.set(span / 4, span / 4);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(span, span),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(lo + span / 2, 0, lo + span / 2);
    ground.receiveShadow = true;
    this.worldGroup.add(ground);

    const walls: Array<[number, number]> = [];
    const wallPlots: number[] = [];
    const bounds: Array<[number, number]> = [];
    const fencesH: Array<[number, number]> = [];
    const fencesV: Array<[number, number]> = [];
    const pillars: Array<[number, number]> = [];
    for (let y = lo; y <= hi; y++) {
      for (let x = lo; x <= hi; x++) {
        const c = cellAt(x, y, R);
        if (c.kind === 'wall') { walls.push([x, y]); wallPlots.push(c.plot); }
        else if (c.kind === 'bound') bounds.push([x, y]);
        else if (c.kind === 'pillar') pillars.push([x, y]);
        else if (c.kind === 'lamp') this.lamps.push(new THREE.Vector3(x + 0.5, 2.6, y + 0.5));
        else if (c.kind === 'fence') {
          const horiz = cellAt(x - 1, y, R).kind === 'fence' || cellAt(x + 1, y, R).kind === 'fence';
          (horiz ? fencesH : fencesV).push([x, y]);
        }
      }
    }

    const wallMat = new THREE.MeshStandardMaterial({ map: noiseTexture('#f2f2f2', '#c4c4c4', 500), roughness: 0.9 });
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, cells: Array<[number, number]>, y: number) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, cells.length));
      m.count = cells.length;
      const tmp = new THREE.Object3D();
      cells.forEach(([x, z], i) => { tmp.position.set(x + 0.5, y, z + 0.5); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); });
      m.castShadow = true;
      m.receiveShadow = true;
      this.worldGroup.add(m);
    };
    {
      // every crib gets its own look: wall colour, wall height, floor and door paint
      const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMat, Math.max(1, walls.length));
      m.count = walls.length;
      const tmp = new THREE.Object3D();
      const col = new THREE.Color();
      walls.forEach(([x, z], i) => {
        const st = cribStyle(wallPlots[i]);
        tmp.position.set(x + 0.5, st.h / 2, z + 0.5);
        tmp.scale.set(1, st.h, 1);
        tmp.updateMatrix();
        m.setMatrixAt(i, tmp.matrix);
        m.setColorAt(i, col.setHex(st.wall));
      });
      m.castShadow = true;
      m.receiveShadow = true;
      this.worldGroup.add(m);
    }
    inst(new THREE.BoxGeometry(1, 2.4, 1), new THREE.MeshStandardMaterial({ color: 0x4a5062 }), bounds, 1.2);
    inst(new THREE.CylinderGeometry(0.35, 0.4, 2.2, 10), new THREE.MeshStandardMaterial({ color: 0x5b5f73 }), pillars, 1.1);
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 });
    inst(new THREE.BoxGeometry(1, 0.55, 0.12), fenceMat, fencesH, 0.3);
    inst(new THREE.BoxGeometry(0.12, 0.55, 1), fenceMat, fencesV, 0.3);

    // vent grates (manholes) the Opps crawl through
    this.vents = [];
    const grateGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.06, 18);
    const grateMat = new THREE.MeshStandardMaterial({ color: 0x3b3f4a, metalness: 0.6, roughness: 0.5 });
    const slotMat = new THREE.MeshStandardMaterial({ color: 0x0b0c10 });
    for (const [vx, vy] of ventsFor(R)) {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(grateGeo, grateMat);
      disc.position.y = 0.03;
      disc.receiveShadow = true;
      g.add(disc);
      for (let k = -2; k <= 2; k++) {
        const slot = new THREE.Mesh(new THREE.BoxGeometry(0.9 - Math.abs(k) * 0.18, 0.02, 0.07), slotMat);
        slot.position.set(0, 0.065, k * 0.2);
        g.add(slot);
      }
      g.position.set(vx, 0, vy);
      this.worldGroup.add(g);
      this.vents.push({ g, x: vx, y: vy, until: 0 });
    }

    // street lamps
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 2.6, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d38 });
    const headGeo = new THREE.SphereGeometry(0.22, 10, 8);
    for (const p of this.lamps) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(p.x, 1.3, p.z);
      const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa040, emissiveIntensity: 2 }));
      head.position.copy(p);
      this.lampHeads.push(head);
      this.worldGroup.add(pole, head);
    }

    // crib floors for every plot
    const floorGeo = new THREE.PlaneGeometry(6, 6);
    const plots = (2 * R + 1) ** 2;
    for (let i = 1; i < plots; i++) {
      const [cx, cy] = plotCenter(i);
      const f = new THREE.Mesh(floorGeo, this.floorMat(cribStyle(i).floor));
      f.rotation.x = -Math.PI / 2;
      f.position.set(cx, 0.01, cy);
      f.receiveShadow = true;
      this.cribFloors.set(i, f);
      this.worldGroup.add(f);
    }
    // scenery: stray cats and dogs roam the open streets (no gameplay)
    for (const p of this.pets.values()) p.g.removeFromParent();
    this.pets.clear();
    let n = 0;
    const corners: Array<[number, number]> = [[6, 6], [-6, 6], [6, -2], [-6, -2]];
    for (let i = 0; i < plots; i++) {
      if (i > 0 && i % 2 === 1) continue;
      const [cx, cy] = plotCenter(i);
      const [ox, oy] = i === 0 ? [2, 2] : corners[(i / 2) % 4];
      const g = this.makePet((i / 2) % 2 ? 'dog' : 'cat');
      g.position.set(cx + ox, 0, cy + oy);
      g.userData = { home: g.position.clone(), stray: true, phase: i * 1.7 };
      this.worldGroup.add(g);
      this.pets.set(n++, { g, kind: 'stray' });
    }
    // labels and doors are re-made from crib state
    for (const d of this.doors.values()) d.removeFromParent();
    this.doors.clear();
    for (const l of this.cribLabels.values()) l.sprite.removeFromParent();
    this.cribLabels.clear();
  }

  private floorMats = new Map<number, THREE.MeshStandardMaterial>();
  private floorMat(hex: number): THREE.MeshStandardMaterial {
    let m = this.floorMats.get(hex);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map: this.floorTex, color: hex, roughness: 0.85 });
      this.floorMats.set(hex, m);
    }
    return m;
  }

  updateCribs(cribs: CribView[], myCrib: number, showFree = false) {
    const seen = new Set<string>();
    const seenLabels = new Set<number>();
    for (const c of cribs) {
      for (const side of [0, 1] as const) {
        const key = `${c.i}-${side}`;
        seen.add(key);
        const level = Math.max(0, DOOR_LEVEL_HP.indexOf(c.max));
        let m = this.doors.get(key);
        if (!m || m.userData.level !== level) {
          // each door armor level has its own look: wood, iron-banded, steel blast door, Sigma vault
          const old = m;
          m = makeDoor(level, cribStyle(c.i).door);
          const [x, y] = doorCenter(c.i, side);
          m.position.set(x, old ? old.position.y : 0.68, y);
          old?.removeFromParent();
          this.scene.add(m);
          this.doors.set(key, m);
        }
        const d = c.doors[side];
        (m.userData.setHp as (f: number) => void)(d.hp / Math.max(1, c.max));
        const targetY = d.hp <= 0 ? 0.1 : d.open ? 2.1 : 0.68;
        m.userData.targetY = targetY;
        m.scale.y = d.hp <= 0 ? 0.15 : 1;
      }
      seenLabels.add(c.i);
      const text = c.i === myCrib ? 'YOUR CRIB' : `${c.ownerName ?? 'bro'}'s crib`;
      const cur = this.cribLabels.get(c.i);
      if (!cur || cur.text !== text) {
        cur?.sprite.removeFromParent();
        const s = textSprite(text, c.i === myCrib ? '#ffd23f' : '#d8d4ff', 36, 'rgba(0,0,0,0.35)');
        const [cx, cy] = plotCenter(c.i);
        s.position.set(cx, 1.6, cy + 4.9);
        this.scene.add(s);
        this.cribLabels.set(c.i, { sprite: s, text });
      }
      const f = this.cribFloors.get(c.i);
      if (f) f.material = c.i === myCrib ? this.floorMatMine : this.floorMat(cribStyle(c.i).floor);
    }
    if (showFree) {
      for (const i of this.cribFloors.keys()) {
        if (seenLabels.has(i)) continue;
        seenLabels.add(i);
        const text = 'FREE CRIB: walk in';
        if (this.cribLabels.get(i)?.text === text) continue;
        const s = textSprite(text, '#7dffb2', 30, 'rgba(0,0,0,0.35)');
        const [cx, cy] = plotCenter(i);
        s.position.set(cx, 1.6, cy + 4.9);
        this.scene.add(s);
        this.cribLabels.set(i, { sprite: s, text });
      }
    }
    for (const [k, m] of this.doors) if (!seen.has(k)) { m.removeFromParent(); this.doors.delete(k); }
    for (const [i, l] of this.cribLabels) if (!seenLabels.has(i)) { l.sprite.removeFromParent(); this.cribLabels.delete(i); }
    const owned = new Set(cribs.map((c) => c.i));
    for (const [i, f] of this.cribFloors) if (!owned.has(i)) f.material = this.floorMat(cribStyle(i).floor);
  }

  private makePet(kind: string): THREE.Group {
    const g = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: kind === 'dog' ? 0xc08040 : 0xff9a3c });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.3, 3, 8), fur);
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), fur);
    head.position.set(0.28, 0.32, 0);
    g.add(body, head);
    if (kind === 'dog') {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.1), fur);
      ear.position.set(0.26, 0.4, 0.1);
      const ear2 = ear.clone();
      ear2.position.z = -0.1;
      g.add(ear, ear2);
    } else {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 4), fur);
      ear.position.set(0.28, 0.46, 0.06);
      const ear2 = ear.clone();
      ear2.position.z = -0.06;
      g.add(ear, ear2);
    }
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6), fur);
    tail.position.set(-0.32, 0.32, 0);
    tail.rotation.z = 0.6;
    g.add(tail);
    return g;
  }

  private makeBro(e: EntView): BroMesh {
    const group = new THREE.Group();
    const color = new THREE.Color().setHSL((e.c ?? 200) / 360, 0.65, 0.55);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.45, 4, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    body.position.y = 0.55;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), new THREE.MeshStandardMaterial({ color: 0xffd7b0 }));
    head.position.y = 1.08;
    head.castShadow = true;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const dx of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), eyeMat);
      eye.position.set(dx, 1.12, 0.19);
      group.add(eye);
    }
    // the ring light: a glowing halo over the head
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.26, 0.045, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d6, emissiveIntensity: 0 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.45;
    const label = textSprite(e.n, '#ffffff', 34);
    label.position.y = 1.9;
    const reviveRing = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.6, 32, 1, 0, 0.01),
      new THREE.MeshBasicMaterial({ color: 0x4ade80, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    reviveRing.rotation.x = -Math.PI / 2;
    reviveRing.position.y = 0.05;
    reviveRing.visible = false;
    group.add(body, head, ring, label, reviveRing);
    applyGear(group, e.gk ?? 0, e.gv ?? 0);
    this.scene.add(group);
    return { group, body, ring, label, reviveRing, kind: e.k, name: e.n };
  }

  private makeOpp(e: EntView): OppMesh {
    // an Opp: tall, hood up, black ski mask, no eyes (they hunt by sound), hands in the hoodie
    const group = new THREE.Group();
    const hoodie = new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.85, emissive: 0x2a0008, emissiveIntensity: 0.4 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.9 });
    const mask = new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.95 });
    for (const dx of [-0.12, 0.12]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.18), pants);
      leg.position.set(dx, 0.45, 0);
      leg.castShadow = true;
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.32), new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }));
      shoe.position.set(dx, 0.06, 0.05);
      group.add(leg, shoe);
    }
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.38), hoodie);
    body.position.y = 1.38;
    body.castShadow = true;
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.02), new THREE.MeshStandardMaterial({ color: 0x14161b }));
    pocket.position.set(0, 1.12, 0.2);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), mask);
    head.scale.set(1, 1.15, 1);
    head.position.y = 2.1;
    head.castShadow = true;
    // hood around the masked head
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.31, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hoodie);
    hood.position.set(0, 2.08, -0.05);
    hood.rotation.x = -0.35;
    // a blank strip where the eyes should be: it glows red, but it cannot see
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: 0xff2050 }));
    slit.position.set(0, 2.15, 0.235);
    const arm = (side: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.38, 1.8, 0);
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.8, 0.16), hoodie);
      a.position.set(0, -0.4, 0);
      a.castShadow = true;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), mask);
      hand.position.set(0, -0.85, 0);
      pivot.add(a, hand);
      group.add(pivot);
      return pivot;
    };
    const armL = arm(-1);
    const armR = arm(1);
    const chest = textSprite('OPP', '#ff3b6b', 40, '');
    chest.position.set(0, 1.45, 0.25);
    chest.scale.multiplyScalar(0.6);
    const label = textSprite(e.ai ? 'OPPS' : `OPP: ${e.n}`, '#ff3b6b', 30);
    label.position.y = 2.8;
    group.add(body, pocket, head, hood, slit, chest, label);
    this.scene.add(group);
    return { group, armL, armR, chest, body };
  }

  private makeDrop(k: 'aura' | 'cash' = 'aura'): THREE.Mesh {
    const m = k === 'cash'
      ? new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.06, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x5dff8a, emissive: 0x1f9a40, emissiveIntensity: 1.2 }),
      )
      : new THREE.Mesh(
        new THREE.OctahedronGeometry(0.2),
        new THREE.MeshStandardMaterial({ color: 0xd9a0ff, emissive: 0xb46bff, emissiveIntensity: 1.6 }),
      );
    m.position.y = 0.45;
    this.scene.add(m);
    return m;
  }

  /** Floating "6" / "7" pop-ups near an Opp. */
  popText(x: number, y: number, text: string, color = '#ff3b6b') {
    const s = textSprite(text, color, 56, '');
    s.position.set(x + (Math.random() - 0.5), 2.8, y);
    this.scene.add(s);
    this.floaters.push({ s, born: performance.now() });
  }

  setDrops(drops: DropView[]) {
    const seen = new Set<number>();
    for (const d of drops) {
      seen.add(d.id);
      let m = this.drops.get(d.id);
      if (!m) { m = this.makeDrop(d.k); this.drops.set(d.id, m); }
      m.position.x = d.x;
      m.position.z = d.y;
    }
    for (const [id, m] of this.drops) if (!seen.has(id)) { m.removeFromParent(); this.drops.delete(id); }
  }

  setProps(props: PropView[]) {
    const seen = new Set<number>();
    for (const p of props) {
      seen.add(p.id);
      if (this.props.has(p.id)) continue;
      let o: THREE.Object3D;
      if (p.k === 'trap') {
        o = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.06, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0xffe14a, emissive: 0x665500 }));
        o.rotation.x = -Math.PI / 2;
        o.position.set(p.x, 0.07, p.y);
      } else {
        const g = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.35), new THREE.MeshStandardMaterial({ color: 0x222228 }));
        box.position.y = 0.28;
        const cone = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), new THREE.MeshStandardMaterial({ color: 0x888899, emissive: 0xff3b6b, emissiveIntensity: 0.8 }));
        cone.position.set(0, 0.3, 0.18);
        const label = textSprite('DECOY', '#ff3b6b', 28);
        label.position.y = 0.9;
        g.add(box, cone, label);
        g.position.set(p.x, 0, p.y);
        o = g;
      }
      this.scene.add(o);
      this.props.set(p.id, o);
    }
    for (const [id, o] of this.props) if (!seen.has(id)) { o.removeFromParent(); this.props.delete(id); }
  }

  private makeDef(d: DefView) {
    // every defence level has its own model (see upgrades.ts)
    const g = makeDefence(d.k, d.lv);
    const top = d.k === 'lamp' ? 2.1 : d.k === 'bass' && d.lv === 3 ? 1.5 : 1.7;
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.08), new THREE.MeshBasicMaterial({ color: 0x4ade80, depthTest: false }));
    bar.position.y = top;
    bar.renderOrder = 11;
    const lvTag = textSprite(`Lv${d.lv}`, '#ffd23f', 24, 'rgba(0,0,0,0.5)');
    lvTag.position.y = top + 0.22;
    g.add(bar, lvTag);
    g.position.set(d.x, 0, d.y);
    this.scene.add(g);
    return { g, bar, lv: d.lv, k: d.k };
  }

  setDefs(defs: DefView[]) {
    const seen = new Set<number>();
    for (const d of defs) {
      seen.add(d.id);
      let m = this.defs.get(d.id);
      if (m && m.lv !== d.lv) { m.g.removeFromParent(); m = undefined; }
      if (!m) { m = this.makeDef(d); this.defs.set(d.id, m); }
      const hp = Math.max(0, d.hp) / 100;
      m.bar.scale.x = Math.max(0.01, hp);
      (m.bar.material as THREE.MeshBasicMaterial).color.setHex(hp > 0.5 ? 0x4ade80 : hp > 0.25 ? 0xffd23f : 0xff4d4d);
      m.bar.quaternion.copy(this.camera.quaternion);
      (m.g.userData.setOff as (off: boolean) => void)(!!d.off);
      if (d.tx !== undefined && d.ty !== undefined) {
        (m.g.userData.fire as (aim: number) => void)(Math.atan2(d.tx - d.x, d.ty - d.y));
        if (m.k === 'blaster') this.shot(d.x, d.y, d.tx, d.ty, d.lv === 3 ? 0xffc83d : 0xff5fa2);
        else if (m.k === 'lamp') this.shot(d.x, d.y, d.tx, d.ty, 0xe9c8ff);
        else if (m.k === 'bass') this.addNoise(-d.id - Math.floor(performance.now() / 400), d.x, d.y, 3 + d.lv);
      }
    }
    for (const [id, m] of this.defs) if (!seen.has(id)) { m.g.removeFromParent(); this.defs.delete(id); }
  }

  private lastShot = new Map<string, number>();
  private shot(x: number, y: number, tx: number, ty: number, color: number) {
    const key = `${x},${y}`;
    const now = performance.now();
    if (now - (this.lastShot.get(key) ?? 0) < 180) return;
    this.lastShot.set(key, now);
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0.7, y), new THREE.Vector3(tx, 1.2, ty)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color }));
    ball.position.set(tx, 1.2, ty);
    const g = new THREE.Group();
    g.add(line, ball);
    this.scene.add(g);
    this.shots.push({ m: g, born: now });
  }

  /** `hunter`: the Opp's sound vision, where every ripple glows hot and thick. */
  addNoise(id: number, x: number, y: number, r: number, hunter = false): boolean {
    if (this.seenNoise.has(id)) return false;
    this.seenNoise.add(id);
    if (this.seenNoise.size > 500) this.seenNoise = new Set([...this.seenNoise].slice(-200));
    const color = hunter ? (r >= 7 ? 0xffd23f : 0xff3b6b) : r >= 9 ? 0xff5577 : 0xcfd6ff;
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(hunter ? 0.85 : 0.92, 1, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: hunter ? 0.9 : 0.6, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.06, y);
    mesh.userData.o = hunter ? 0.9 : 0.6;
    this.scene.add(mesh);
    this.ripples.push({ mesh, born: performance.now(), r });
    return true;
  }

  /** The Opp's screech: a big pulse from (x, y), then a marker on every bro it bounced off. */
  echo(x: number, y: number, r: number, pts: Array<[number, number]>, lifeSec: number) {
    const pulse = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xff3b6b, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    pulse.rotation.x = -Math.PI / 2;
    pulse.position.set(x, 0.08, y);
    pulse.userData.o = 0.9;
    this.scene.add(pulse);
    this.ripples.push({ mesh: pulse, born: performance.now(), r, life: 1400 });
    for (const [px, py] of pts) {
      const delay = (Math.hypot(px - x, py - y) / r) * 1400; // each ping shows when the pulse reaches it
      setTimeout(() => {
        const g = new THREE.Group();
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.45, 0.6, 32),
          new THREE.MeshBasicMaterial({ color: 0xff3b6b, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false, depthTest: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.1;
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.06, 3, 6),
          new THREE.MeshBasicMaterial({ color: 0xff3b6b, transparent: true, opacity: 0.8, depthWrite: false }),
        );
        beam.position.y = 1.5;
        const label = textSprite('BRO', '#ff3b6b', 26);
        label.position.y = 3.3;
        g.add(ring, beam, label);
        g.position.set(px, 0, py);
        this.scene.add(g);
        this.blips.push({ g, born: performance.now(), life: lifeSec * 1000 });
      }, delay);
    }
  }

  /** Where a world position lands on screen, in CSS pixels. */
  toScreen(x: number, y: number): { sx: number; sy: number; behind: boolean } {
    const v = new THREE.Vector3(x, 0.5, y).project(this.camera);
    return { sx: (v.x + 1) / 2 * window.innerWidth, sy: (1 - v.y) / 2 * window.innerHeight, behind: v.z > 1 };
  }

  /** A grate rattles (Opp coming through) for a moment. */
  rattleVent(x: number, y: number, ms = 1700) {
    let best: { g: THREE.Group; x: number; y: number; until: number } | null = null, bd = 1.5;
    for (const v of this.vents) { const d = Math.hypot(v.x - x, v.y - y); if (d < bd) { bd = d; best = v; } }
    if (best) best.until = performance.now() + ms;
  }

  zoomBy(d: number) { this.zoom = Math.max(0.55, Math.min(1.7, this.zoom + d)); }

  /** Draw a frame. `ents` are already interpolated. */
  frame(ents: EntView[], selfId: string, focus: { x: number; y: number }, ev: WorldEvents, monsterView: boolean) {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = performance.now();
    this.power = ev.power;

    // camera
    this.target.lerp(new THREE.Vector3(focus.x, 0, focus.y), 1 - Math.pow(0.0005, dt));
    this.camera.position.copy(this.target).addScaledVector(CAM_OFFSET, this.zoom);
    this.camera.lookAt(this.target.x, 0.6, this.target.z);
    this.moon.position.set(this.target.x - 8, 20, this.target.z - 6);
    this.moon.target.position.copy(this.target);

    // atmosphere
    const fog = this.scene.fog as THREE.Fog;
    const near = ev.fog ? 6 : !ev.power ? 10 : monsterView ? 22 : 40;
    const far = ev.fog ? 18 : !ev.power ? 24 : monsterView ? 45 : 80;
    const bg = this.scene.background as THREE.Color;
    bg.lerp(new THREE.Color(ev.fog ? 0x8a8f9e : !ev.power ? 0x06070c : 0x3a4a6e), 0.06);
    fog.color.copy(bg);
    fog.near += (near - fog.near) * 0.05;
    fog.far += (far - fog.far) * 0.05;
    // smooth transitions between modes
    const hemiTarget = !ev.power ? 0.3 : ev.disco ? 1.0 : 2.4;
    this.hemi.intensity += (hemiTarget - this.hemi.intensity) * 0.06;
    const moonTarget = ev.power ? 2.2 : 0.25;
    this.moon.intensity += (moonTarget - this.moon.intensity) * 0.06;
    this.hemi.color.lerp(new THREE.Color(ev.rage ? 0xff8090 : 0xdfe8ff), 0.05);
    this.disco.forEach((l, i) => {
      l.intensity = ev.disco ? 30 : 0;
      const a = t / 500 + (i * Math.PI * 2) / 3;
      l.position.set(focus.x + Math.cos(a) * 5, 3, focus.y + Math.sin(a) * 5);
    });
    for (const h of this.lampHeads) (h.material as THREE.MeshStandardMaterial).emissiveIntensity = ev.power ? 2 : 0.05;

    // lamp light pool: nearest lamps to the camera target get real lights
    const lampsNear = ev.power
      ? [...this.lamps].sort((a, b) => a.distanceToSquared(this.target) - b.distanceToSquared(this.target)).slice(0, LAMP_POOL)
      : [];
    this.lampLights.forEach((l, i) => {
      const p = lampsNear[i];
      if (p) { l.position.copy(p); l.intensity = 14; } else l.intensity = 0;
    });

    // doors glide to their target height
    for (const d of this.doors.values()) {
      const ty = d.userData.targetY ?? 0.68;
      d.position.y += (ty - d.position.y) * Math.min(1, dt * 10);
    }

    // entities
    const seenBros = new Set<string>();
    const seenOpps = new Set<string>();
    const lit: Array<{ x: number; y: number; z: number }> = [];
    for (const e of ents) {
      if (e.k === 'opp') {
        seenOpps.add(e.id);
        let m = this.opps.get(e.id);
        if (!m) { m = this.makeOpp(e); this.opps.set(e.id, m); }
        const prev = m.group.position.clone();
        m.group.position.set(e.x, 0, e.y);
        const mv = new THREE.Vector3(e.x - prev.x, 0, e.y - prev.z);
        if (mv.lengthSq() > 1e-5) m.group.rotation.y = Math.atan2(mv.x, mv.z);
        // stiff arm swing; frantic when mogged
        const speed = e.st ? 30 : 7;
        m.armL.rotation.x = Math.sin(t / 1000 * speed) * 0.45;
        m.armR.rotation.x = -Math.sin(t / 1000 * speed) * 0.45; // arms swinging, reaching for you
        m.group.rotation.z = e.st ? Math.sin(t / 40) * 0.15 : 0;
        (m.body.material as THREE.MeshStandardMaterial).emissiveIntensity = e.st ? 2 : 0.4;
        continue;
      }
      seenBros.add(e.id);
      let m = this.bros.get(e.id);
      if (!m || m.name !== e.n) {
        if (m) m.group.removeFromParent();
        m = this.makeBro(e);
        this.bros.set(e.id, m);
      }
      const prev = m.group.position.clone();
      const npc = e.k === 'npc';
      const bob = npc ? 0.25 + Math.sin(t / 300) * 0.12 : 0;
      m.group.position.set(e.x, (e.z ?? 0) + bob, e.y);
      const mv = new THREE.Vector3(e.x - prev.x, 0, e.y - prev.z);
      if (mv.lengthSq() > 1e-5) m.group.rotation.y = Math.atan2(mv.x, mv.z);
      if (m.group.userData.gearKey !== `${e.gk ?? 0}:${e.gv ?? 0}`) applyGear(m.group, e.gk ?? 0, e.gv ?? 0);
      const gear = m.group.userData.gear as THREE.Group;
      (gear.userData.setShield as (on: boolean, t: number) => void)(!!e.sh && !npc, t);
      const bm = m.body.material as THREE.MeshStandardMaterial;
      bm.transparent = npc;
      bm.opacity = npc ? 0.35 : 1;
      m.group.children.forEach((c) => { if (c !== m!.label && c !== m!.reviveRing) c.visible = !npc || c === m!.body; });
      const rm = m.ring.material as THREE.MeshStandardMaterial;
      rm.emissiveIntensity = e.l ? 3 : 0;
      m.ring.visible = !npc;
      m.reviveRing.visible = npc && !!e.rv;
      if (npc && e.rv) {
        m.reviveRing.geometry.dispose();
        m.reviveRing.geometry = new THREE.RingGeometry(0.5, 0.62, 32, 1, 0, Math.PI * 2 * e.rv);
      }
      if (e.l && !npc) lit.push({ x: e.x, y: e.y, z: e.z ?? 0 });
      if (e.id === selfId) m.label.visible = false;
    }
    for (const [id, m] of this.bros) if (!seenBros.has(id)) { m.group.removeFromParent(); this.bros.delete(id); }
    for (const [id, m] of this.opps) if (!seenOpps.has(id)) { m.group.removeFromParent(); this.opps.delete(id); }

    // ring light pool: nearest lit bros get a real light
    lit.sort((a, b) => Math.hypot(a.x - focus.x, a.y - focus.y) - Math.hypot(b.x - focus.x, b.y - focus.y));
    this.ringLights.forEach((l, i) => {
      const p = lit[i];
      if (p) { l.position.set(p.x, 1.6 + p.z, p.y); l.intensity = 22; l.distance = RING_LIGHT_RANGE * 4; }
      else l.intensity = 0;
    });
    this.selfLight.position.set(focus.x, 1.6, focus.y);
    this.selfLight.intensity = monsterView ? 2 : 5;

    // ambient strays wander the streets (scenery only)
    for (const p of this.pets.values()) {
      const u = p.g.userData as { home: THREE.Vector3; stray: boolean; phase: number };
      if (u.stray) {
        const a = t / 6000 + u.phase;
        const nx = u.home.x + Math.cos(a) * 2, nz = u.home.z + Math.sin(a * 1.3) * 2;
        p.g.rotation.y = Math.atan2(nx - p.g.position.x, nz - p.g.position.z) - Math.PI / 2;
        p.g.position.set(nx, Math.abs(Math.sin(t / 120)) * 0.04, nz);
      } else {
        p.g.rotation.y = u.phase + Math.sin(t / 3000 + u.phase) * 0.5;
      }
    }

    // turret shots fade
    this.shots = this.shots.filter((s) => {
      const age = (t - s.born) / 250;
      if (age >= 1) { s.m.removeFromParent(); return false; }
      s.m.traverse((o) => { const mm = (o as THREE.Mesh).material as THREE.Material | undefined; if (mm) { mm.transparent = true; mm.opacity = 1 - age; } });
      return true;
    });
    for (const d of this.defs.values()) {
      d.bar.quaternion.copy(this.camera.quaternion);
      tickUpgrades(d.g, t);
    }
    // animated upgrade pieces: vault wheels, kick wings, armour sparkles, defences
    for (const d of this.doors.values()) tickUpgrades(d, t);
    for (const b of this.bros.values()) if (b.group.userData.gear) tickUpgrades(b.group.userData.gear as THREE.Group, t);

    // drops spin
    for (const d of this.drops.values()) { d.rotation.y += dt * 2; d.position.y = 0.45 + Math.sin(t / 400 + d.id) * 0.08; }

    // ripples
    this.ripples = this.ripples.filter((r) => {
      const age = (t - r.born) / (r.life ?? 900);
      if (age >= 1) { r.mesh.removeFromParent(); r.mesh.geometry.dispose(); return false; }
      const s = 0.3 + age * r.r;
      r.mesh.scale.set(s, s, s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (r.mesh.userData.o ?? 0.6) * (1 - age);
      return true;
    });
    for (const v of this.vents) {
      if (t < v.until) {
        v.g.position.y = 0.04 + Math.abs(Math.sin(t / 35)) * 0.12;
        v.g.rotation.y = Math.sin(t / 50) * 0.2;
      } else if (v.g.position.y !== 0) { v.g.position.y = 0; v.g.rotation.y = 0; }
    }
    this.blips = this.blips.filter((b) => {
      const age = (t - b.born) / b.life;
      if (age >= 1) { b.g.removeFromParent(); return false; }
      const o = (1 - age) * (0.6 + 0.4 * Math.sin(t / 90));
      b.g.traverse((c) => {
        const m = (c as THREE.Mesh).material as THREE.Material | undefined;
        if (m) { m.transparent = true; m.opacity = o; }
      });
      const s = 1 + Math.sin(t / 120) * 0.15;
      b.g.children[0].scale.set(s, s, s);
      return true;
    });
    this.floaters = this.floaters.filter((f) => {
      const age = (t - f.born) / 1200;
      if (age >= 1) { f.s.removeFromParent(); return false; }
      f.s.position.y += dt * 0.8;
      f.s.material.opacity = 1 - age;
      return true;
    });

    this.renderer.render(this.scene, this.camera);
  }
}
