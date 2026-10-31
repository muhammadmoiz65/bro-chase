// 2.5D renderer: a Three.js world under a fixed, angled camera that follows you.
// Game logic is flat (x, y tiles); Three.js uses x -> x, y -> z, with y up.

import * as THREE from 'three';
import { PLOT, RING_LIGHT_RANGE } from '../../shared/constants.ts';
import { cellAt, doorCenter, plotCenter, type CribView } from '../../shared/world.ts';
import type { DropView, EntView, WorldEvents } from '../../shared/protocol.ts';

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

interface SixMesh {
  group: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  chest: THREE.Sprite;
  body: THREE.Mesh;
}

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
  private doors = new Map<string, THREE.Mesh>();
  private cribLabels = new Map<number, { sprite: THREE.Sprite; text: string }>();
  private bros = new Map<string, BroMesh>();
  private sixes = new Map<string, SixMesh>();
  private drops = new Map<number, THREE.Mesh>();
  private ripples: Array<{ mesh: THREE.Mesh; born: number; r: number }> = [];
  private seenNoise = new Set<number>();
  private floaters: Array<{ s: THREE.Sprite; born: number }> = [];
  private generator!: THREE.Mesh;
  private target = new THREE.Vector3();
  private clock = new THREE.Clock();
  private power = true;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 200);
    this.scene.background = new THREE.Color(0x05060b);
    this.scene.fog = new THREE.Fog(0x05060b, 16, 34);

    this.hemi = new THREE.HemisphereLight(0x6f7fc0, 0x0b0b12, 0.55);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x8fa2ff, 0.45);
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
    for (let i = 0; i < LAMP_POOL; i++) {
      const l = new THREE.PointLight(0xffb36b, 0, 9, 1.5);
      this.lampLights.push(l);
      this.scene.add(l);
    }

    this.floorMatOn = new THREE.MeshStandardMaterial({ map: noiseTexture('#6b4a33', '#2b1c12', 300, true), emissive: 0x3a2412, emissiveIntensity: 0.6 });
    this.floorMatOff = new THREE.MeshStandardMaterial({ map: noiseTexture('#3a2a20', '#1b120c', 300, true) });
    this.floorMatMine = new THREE.MeshStandardMaterial({ map: noiseTexture('#5e4f80', '#2b2240', 300, true), emissive: 0x2b1d55, emissiveIntensity: 0.7 });

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
    const groundTex = noiseTexture('#20232c', '#0c0d12', 900);
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
    const bounds: Array<[number, number]> = [];
    const fencesH: Array<[number, number]> = [];
    const fencesV: Array<[number, number]> = [];
    const pillars: Array<[number, number]> = [];
    for (let y = lo; y <= hi; y++) {
      for (let x = lo; x <= hi; x++) {
        const c = cellAt(x, y, R);
        if (c.kind === 'wall') walls.push([x, y]);
        else if (c.kind === 'bound') bounds.push([x, y]);
        else if (c.kind === 'pillar') pillars.push([x, y]);
        else if (c.kind === 'lamp') this.lamps.push(new THREE.Vector3(x + 0.5, 2.6, y + 0.5));
        else if (c.kind === 'fence') {
          const horiz = cellAt(x - 1, y, R).kind === 'fence' || cellAt(x + 1, y, R).kind === 'fence';
          (horiz ? fencesH : fencesV).push([x, y]);
        }
      }
    }

    const wallMat = new THREE.MeshStandardMaterial({ map: noiseTexture('#4a4f63', '#22252f', 500), roughness: 0.9 });
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, cells: Array<[number, number]>, y: number) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, cells.length));
      m.count = cells.length;
      const tmp = new THREE.Object3D();
      cells.forEach(([x, z], i) => { tmp.position.set(x + 0.5, y, z + 0.5); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); });
      m.castShadow = true;
      m.receiveShadow = true;
      this.worldGroup.add(m);
    };
    inst(new THREE.BoxGeometry(1, 1.5, 1), wallMat, walls, 0.75);
    inst(new THREE.BoxGeometry(1, 2.4, 1), new THREE.MeshStandardMaterial({ color: 0x1a1c26 }), bounds, 1.2);
    inst(new THREE.CylinderGeometry(0.35, 0.4, 2.2, 10), new THREE.MeshStandardMaterial({ color: 0x5b5f73 }), pillars, 1.1);
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 });
    inst(new THREE.BoxGeometry(1, 0.55, 0.12), fenceMat, fencesH, 0.3);
    inst(new THREE.BoxGeometry(0.12, 0.55, 1), fenceMat, fencesV, 0.3);

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

    // generator in the plaza
    this.generator = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.2, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x3b4252, emissive: 0x22ff88, emissiveIntensity: 0.25 }),
    );
    this.generator.position.set(0, 0.6, 0);
    this.generator.castShadow = true;
    const genLabel = textSprite('GENERATOR', '#7dffb2', 40);
    genLabel.position.set(0, 1.9, 0);
    this.worldGroup.add(this.generator, genLabel);

    // crib floors for every plot
    const floorGeo = new THREE.PlaneGeometry(6, 6);
    const plots = (2 * R + 1) ** 2;
    for (let i = 1; i < plots; i++) {
      const [cx, cy] = plotCenter(i);
      const f = new THREE.Mesh(floorGeo, this.floorMatOff);
      f.rotation.x = -Math.PI / 2;
      f.position.set(cx, 0.01, cy);
      f.receiveShadow = true;
      this.cribFloors.set(i, f);
      this.worldGroup.add(f);
    }
    // labels and doors are re-made from crib state
    for (const d of this.doors.values()) d.removeFromParent();
    this.doors.clear();
    for (const l of this.cribLabels.values()) l.sprite.removeFromParent();
    this.cribLabels.clear();
  }

  updateCribs(cribs: CribView[], myCrib: number) {
    const seen = new Set<string>();
    const seenLabels = new Set<number>();
    for (const c of cribs) {
      for (const side of [0, 1] as const) {
        const key = `${c.i}-${side}`;
        seen.add(key);
        let m = this.doors.get(key);
        if (!m) {
          m = new THREE.Mesh(new THREE.BoxGeometry(2, 1.35, 0.22), new THREE.MeshStandardMaterial({ color: 0xb07a3c, roughness: 0.6 }));
          const [x, y] = doorCenter(c.i, side);
          m.position.set(x, 0.68, y);
          m.castShadow = true;
          this.scene.add(m);
          this.doors.set(key, m);
        }
        const d = c.doors[side];
        const mat = m.material as THREE.MeshStandardMaterial;
        const hp = d.hp / 100;
        mat.color.setRGB(0.62, 0.12 + 0.3 * hp, 0.06 + 0.12 * hp); // wood, going red as it breaks
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
        s.position.set(cx, 1.9, cy - 3.2);
        this.scene.add(s);
        this.cribLabels.set(c.i, { sprite: s, text });
      }
      const f = this.cribFloors.get(c.i);
      if (f) f.material = c.i === myCrib ? this.floorMatMine : this.power ? this.floorMatOn : this.floorMatOff;
    }
    for (const [k, m] of this.doors) if (!seen.has(k)) { m.removeFromParent(); this.doors.delete(k); }
    for (const [i, l] of this.cribLabels) if (!seenLabels.has(i)) { l.sprite.removeFromParent(); this.cribLabels.delete(i); }
    for (const [i, f] of this.cribFloors) if (!seenLabels.has(i)) f.material = this.floorMatOff;
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
    this.scene.add(group);
    return { group, body, ring, label, reviveRing, kind: e.k, name: e.n };
  }

  private makeSix(e: EntView): SixMesh {
    const group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xbfc3c9, roughness: 0.7, emissive: 0x220008, emissiveIntensity: 0.4 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 2.0, 10), skin);
    body.position.y = 1.0;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), skin);
    head.scale.set(1, 1.35, 1);
    head.position.y = 2.25;
    head.castShadow = true;
    // a wide, eyeless grin
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: 0xff2050 }));
    mouth.position.set(0, 2.18, 0.26);
    const arm = (side: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.3, 1.75, 0);
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), skin);
      a.position.set(side * 0.05, 0.1, 0.35);
      a.rotation.x = -1.2; // forearms forward, palms up: the six-seven hand scale
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.2), skin);
      palm.position.set(side * 0.05, 0.45, 0.72);
      pivot.add(a, palm);
      group.add(pivot);
      return pivot;
    };
    const armL = arm(-1);
    const armR = arm(1);
    const chest = textSprite('67', '#ff3b6b', 64, '');
    chest.position.set(0, 1.35, 0.4);
    const label = textSprite(e.ai ? 'SIXSEVEN' : `SIXSEVEN: ${e.n}`, '#ff3b6b', 30);
    label.position.y = 2.95;
    group.add(body, head, mouth, chest, label);
    this.scene.add(group);
    return { group, armL, armR, chest, body };
  }

  private makeDrop(): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.2),
      new THREE.MeshStandardMaterial({ color: 0xd9a0ff, emissive: 0xb46bff, emissiveIntensity: 1.6 }),
    );
    m.position.y = 0.45;
    this.scene.add(m);
    return m;
  }

  /** Floating "6" / "7" pop-ups near a Sixseven. */
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
      if (!m) { m = this.makeDrop(); this.drops.set(d.id, m); }
      m.position.x = d.x;
      m.position.z = d.y;
    }
    for (const [id, m] of this.drops) if (!seen.has(id)) { m.removeFromParent(); this.drops.delete(id); }
  }

  addNoise(id: number, x: number, y: number, r: number) {
    if (this.seenNoise.has(id)) return;
    this.seenNoise.add(id);
    if (this.seenNoise.size > 500) this.seenNoise = new Set([...this.seenNoise].slice(-200));
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 40),
      new THREE.MeshBasicMaterial({ color: r >= 9 ? 0xff5577 : 0xcfd6ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.06, y);
    this.scene.add(mesh);
    this.ripples.push({ mesh, born: performance.now(), r });
  }

  /** Draw a frame. `ents` are already interpolated. */
  frame(ents: EntView[], selfId: string, focus: { x: number; y: number }, ev: WorldEvents, monsterView: boolean) {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = performance.now();
    this.power = ev.power;

    // camera
    this.target.lerp(new THREE.Vector3(focus.x, 0, focus.y), 1 - Math.pow(0.0005, dt));
    this.camera.position.copy(this.target).add(CAM_OFFSET);
    this.camera.lookAt(this.target.x, 0.6, this.target.z);
    this.moon.position.set(this.target.x - 8, 20, this.target.z - 6);
    this.moon.target.position.copy(this.target);

    // atmosphere
    const fog = this.scene.fog as THREE.Fog;
    const near = ev.fog ? 5 : monsterView ? 10 : 16;
    const far = ev.fog ? 14 : monsterView ? 24 : 34;
    fog.near += (near - fog.near) * 0.05;
    fog.far += (far - fog.far) * 0.05;
    const hemiTarget = ev.power ? 0.55 : 0.22;
    this.hemi.intensity += (hemiTarget - this.hemi.intensity) * 0.08;
    this.moon.intensity = ev.power ? 0.45 : 0.25;
    for (const h of this.lampHeads) (h.material as THREE.MeshStandardMaterial).emissiveIntensity = ev.power ? 2 : 0.05;
    if (this.generator) {
      const gm = this.generator.material as THREE.MeshStandardMaterial;
      gm.emissive.setHex(ev.power ? 0x22ff88 : 0xff2244);
      gm.emissiveIntensity = ev.power ? 0.25 : 0.4 + 0.4 * Math.sin(t / 150);
    }

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
    const seenSix = new Set<string>();
    const lit: Array<{ x: number; y: number; z: number }> = [];
    for (const e of ents) {
      if (e.k === 'sixseven') {
        seenSix.add(e.id);
        let m = this.sixes.get(e.id);
        if (!m) { m = this.makeSix(e); this.sixes.set(e.id, m); }
        const prev = m.group.position.clone();
        m.group.position.set(e.x, 0, e.y);
        const mv = new THREE.Vector3(e.x - prev.x, 0, e.y - prev.z);
        if (mv.lengthSq() > 1e-5) m.group.rotation.y = Math.atan2(mv.x, mv.z);
        // the six-seven hand motion: palms bob up and down out of phase
        const speed = e.st ? 30 : 9;
        m.armL.rotation.x = Math.sin(t / 1000 * speed) * 0.45;
        m.armR.rotation.x = -Math.sin(t / 1000 * speed) * 0.45;
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
    for (const [id, m] of this.sixes) if (!seenSix.has(id)) { m.group.removeFromParent(); this.sixes.delete(id); }

    // ring light pool: nearest lit bros get a real light
    lit.sort((a, b) => Math.hypot(a.x - focus.x, a.y - focus.y) - Math.hypot(b.x - focus.x, b.y - focus.y));
    this.ringLights.forEach((l, i) => {
      const p = lit[i];
      if (p) { l.position.set(p.x, 1.6 + p.z, p.y); l.intensity = 22; l.distance = RING_LIGHT_RANGE * 4; }
      else l.intensity = 0;
    });
    this.selfLight.position.set(focus.x, 1.6, focus.y);
    this.selfLight.intensity = monsterView ? 2 : 5;

    // drops spin
    for (const d of this.drops.values()) { d.rotation.y += dt * 2; d.position.y = 0.45 + Math.sin(t / 400 + d.id) * 0.08; }

    // ripples
    this.ripples = this.ripples.filter((r) => {
      const age = (t - r.born) / 900;
      if (age >= 1) { r.mesh.removeFromParent(); r.mesh.geometry.dispose(); return false; }
      const s = 0.3 + age * r.r;
      r.mesh.scale.set(s, s, s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - age);
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
