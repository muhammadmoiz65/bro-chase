// 2.5D renderer: a Babylon.js world under a fixed, angled camera that follows you.
// Game logic is flat (x, y tiles); the scene uses x -> x, y -> z, with y up
// (right-handed, like glTF).

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Light } from '@babylonjs/core/Lights/light';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Rendering/boundingBoxRenderer';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DOOR_LEVEL_HP, PLOT, RING_LIGHT_RANGE } from '../../shared/constants.ts';
import { applyGear, makeDefence, makeDoor, tickUpgrades, type DefData, type DoorData, type GearData, type GearNodeData } from './upgrades.ts';
import { cellAt, doorCenter, plotCenter, ventsFor, type CribView } from '../../shared/world.ts';
import type { DefView, DropView, EntView, PropView, WorldEvents } from '../../shared/protocol.ts';
import { FX } from './fx/index.ts';
import { addWallCaps, brickTexture, dressWorld } from './fx/world.ts';
import { DEFAULT_LOOK, parseLook } from '../../shared/look.ts';
import { buildAvatar, type Avatar } from './avatar.ts';
import {
  add, basic, box, canvasTexture, capsule, castShadows, cone, cyl, dispose, fade, group, groundOcclusion, groundPlane, instances, lin,
  line, octa, rimAll, ring, ringData, setOpacity, show, sphere, srgb, std, textSprite, torus, ud, useScene,
  type Inst, type Mesh, type Node,
} from './bjs/kit.ts';

const CAM_OFFSET = new Vector3(0, 15, 10.5);
// Every light costs per pixel on every lit surface it reaches, so the pools stay small.
const RING_POOL = 3;
const DISCO = [0xff3b6b, 0x3bd1ff, 0xffd23f];
const SKY = 0xa9c8de;

function noiseTexture(base: string, speck: string, n: number, lines = false) {
  return canvasTexture(256, 256, (ctx) => {
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
  }, true);
}

interface BroMesh {
  group: Node;
  ring: Mesh;
  ringMat: PBRMaterial;
  label: Mesh;
  reviveRing: Mesh;
  revive: number;
  kind: string;
  name: string;
  look: string;
  avatar: Avatar;
  spd: number;
}

interface OppMesh {
  group: Node;
  armL: Node;
  armR: Node;
  bodyMat: PBRMaterial;
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

const at = <T extends Node>(o: T, x = 0, y = 0, z = 0): T => { o.position.set(x, y, z); return o; };

export class Renderer {
  engine: Engine;
  scene: Scene;
  camera: FreeCamera;
  fx: FX;
  private canvas: HTMLCanvasElement;
  private shadows: ShadowGenerator;
  private stunnedIds = new Set<string>();
  private airborne = new Map<string, number>();
  private hemi: HemisphericLight;
  private moon: DirectionalLight;
  private selfLight: PointLight;
  private ringLights: PointLight[] = [];
  private lampHeadMat: PBRMaterial;
  private worldGroup: Node;
  private builtR = -1;
  private cribFloors = new Map<number, Mesh>();
  private floorMatMine: PBRMaterial;
  private floorTex: ReturnType<typeof noiseTexture>;
  private doors = new Map<string, Node>();
  private cribLabels = new Map<number, { sprite: Mesh; text: string }>();
  private bros = new Map<string, BroMesh>();
  private opps = new Map<string, OppMesh>();
  private drops = new Map<number, { m: Mesh; k: string; id: number }>();
  private props = new Map<number, Node>();
  private defs = new Map<number, { g: Node; bar: Mesh; barMat: StandardMaterial; lv: number; k: string }>();
  private shots: Array<{ m: Node; born: number }> = [];
  private ripples: Array<{ mesh: Mesh; born: number; r: number; o: number; life?: number }> = [];
  private vents: Array<{ g: Node; x: number; y: number; until: number }> = [];
  private blips: Array<{ g: Node; ring: Mesh; born: number; life: number }> = [];
  private seenNoise = new Set<number>();
  private floaters: Array<{ s: Mesh; born: number }> = [];
  private target = new Vector3();
  private lastT = performance.now();
  private power = true;
  private zoom = 1;
  private fogColor = srgb(SKY);
  private pets = new Map<number, { g: Node; home: Vector3; phase: number }>();

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;outline:none;touch-action:none';
    container.appendChild(this.canvas);
    this.engine = new Engine(this.canvas, false, { powerPreference: 'high-performance', stencil: true, preserveDrawingBuffer: false }, false);
    this.scene = new Scene(this.engine);
    const scene = this.scene;
    scene.useRightHandedSystem = true;
    scene.clearColor = Color4.FromColor3(this.fogColor);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = this.fogColor;
    scene.fogStart = 40;
    scene.fogEnd = 80;
    scene.skipPointerMovePicking = true;
    scene.autoClear = true;

    this.camera = new FreeCamera('cam', new Vector3(0, 15, 10.5), scene);
    this.camera.fov = (45 * Math.PI) / 180;
    this.camera.minZ = 0.5;
    this.camera.maxZ = 200;
    this.camera.inputs.clear();

    this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    this.hemi.diffuse = srgb(0xdfe8ff);
    this.hemi.groundColor = srgb(0x6b7458);
    this.hemi.intensity = 2.4;
    this.hemi.specular = Color3.Black();
    this.moon = new DirectionalLight('sun', new Vector3(8, -20, 6).normalize(), scene);
    this.moon.diffuse = srgb(0xfff2dd);
    this.moon.intensity = 2.2;
    this.moon.autoUpdateExtends = false;
    this.moon.orthoLeft = this.moon.orthoBottom = -22;
    this.moon.orthoRight = this.moon.orthoTop = 22;
    this.moon.shadowMinZ = 1;
    this.moon.shadowMaxZ = 60;
    this.shadows = new ShadowGenerator(2048, this.moon);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadows.bias = 0.0008;
    this.shadows.normalBias = 0.02;
    useScene(scene, this.shadows);

    this.selfLight = new PointLight('self', Vector3.Zero(), scene);
    this.selfLight.diffuse = srgb(0xbfb4ff);
    this.selfLight.range = 5.5;
    this.selfLight.falloffType = Light.FALLOFF_GLTF;
    this.selfLight.intensity = 4;
    for (let i = 0; i < RING_POOL; i++) {
      const l = new PointLight(`ring${i}`, Vector3.Zero(), scene);
      l.diffuse = srgb(0xfff1d6);
      l.intensity = 0;
      l.range = 10;
      l.falloffType = Light.FALLOFF_GLTF;
      this.ringLights.push(l);
    }

    this.lampHeadMat = std(0xffd9a0, { emissive: 0xffa040, emissiveIntensity: 2 });
    this.floorTex = noiseTexture('#ffffff', '#c8c8c8', 300, true);
    this.floorMatMine = std(0xffffff, { map: noiseTexture('#8f7cc4', '#5e4f80', 300, true), roughness: 0.85 });

    this.worldGroup = group(null, 'world');
    this.fx = new FX(this.engine, scene, this.camera, this.shadows);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    this.engine.resize();
    this.fx.resize();
  }

  /** Build the static neighbourhood for ring radius R. */
  buildWorld(R: number) {
    if (R === this.builtR) return;
    this.builtR = R;
    useScene(this.scene, this.shadows);
    for (const c of this.worldGroup.getChildren()) c.dispose(false, false);
    this.cribFloors.clear();
    const lo = -(R * PLOT + PLOT / 2);
    const hi = R * PLOT + PLOT / 2 - 1;

    // ground: roads, sidewalks, yards, plaza, trees (fx/world.ts)
    dressWorld(this.worldGroup, R);

    const walls: Inst[] = [];
    const bounds: Inst[] = [];
    const fencesH: Inst[] = [];
    const fencesV: Inst[] = [];
    const pillars: Inst[] = [];
    const lamps: Array<[number, number]> = [];
    for (let y = lo; y <= hi; y++) {
      for (let x = lo; x <= hi; x++) {
        const c = cellAt(x, y, R);
        if (c.kind === 'wall') {
          // every crib gets its own look: wall colour, wall height, floor and door paint
          const st = cribStyle(c.plot);
          walls.push({ x: x + 0.5, y: st.h / 2, z: y + 0.5, s: [1, st.h, 1], color: st.wall });
        } else if (c.kind === 'bound') bounds.push({ x: x + 0.5, y: 1.2, z: y + 0.5 });
        else if (c.kind === 'pillar') pillars.push({ x: x + 0.5, y: 1.1, z: y + 0.5 });
        else if (c.kind === 'lamp') lamps.push([x + 0.5, y + 0.5]);
        else if (c.kind === 'fence') {
          const horiz = cellAt(x - 1, y, R).kind === 'fence' || cellAt(x + 1, y, R).kind === 'fence';
          (horiz ? fencesH : fencesV).push({ x: x + 0.5, y: 0.3, z: y + 0.5 });
        }
      }
    }
    const solid = (mesh: Mesh, list: Inst[], colors = false) => {
      mesh.parent = this.worldGroup;
      instances(mesh, list, { colors });
      mesh.receiveShadows = true;
      castShadows(mesh);
    };
    solid(box(1, 1, 1, groundOcclusion(std(0xffffff, { map: brickTexture(), roughness: 0.88 }), 0.5, 0.9)), walls, true);
    addWallCaps(this.worldGroup, walls);
    solid(box(1, 2.4, 1, groundOcclusion(std(0x4a5062))), bounds);
    addWallCaps(this.worldGroup, bounds);
    solid(cyl(0.35, 0.4, 2.2, groundOcclusion(std(0x5b5f73)), { seg: 10 }), pillars);
    addWallCaps(this.worldGroup, pillars);
    const fenceMat = std(0x8a6a4a, { roughness: 0.8 });
    if (fencesH.length) solid(box(1, 0.55, 0.12, fenceMat), fencesH);
    if (fencesV.length) solid(box(0.12, 0.55, 1, fenceMat), fencesV);

    // vent grates (manholes) the Opps crawl through
    this.vents = [];
    const grateMat = std(0x3b3f4a, { metalness: 0.6, roughness: 0.5 });
    const slotMat = std(0x0b0c10);
    for (const [vx, vy] of ventsFor(R)) {
      const g = group(this.worldGroup, 'vent');
      const disc = at(cyl(0.62, 0.62, 0.06, grateMat, { seg: 18 }), 0, 0.03, 0);
      disc.receiveShadows = true;
      add(g, disc);
      for (let k = -2; k <= 2; k++) add(g, box(0.9 - Math.abs(k) * 0.18, 0.02, 0.07, slotMat, 0, 0.065, k * 0.2));
      g.position.set(vx, 0, vy);
      this.vents.push({ g, x: vx, y: vy, until: 0 });
    }

    // street lamps
    const pole = cyl(0.06, 0.08, 2.6, std(0x2a2d38), { seg: 6 });
    solid(pole, lamps.map(([x, z]) => ({ x, y: 1.3, z })));
    const head = sphere(0.22, this.lampHeadMat, { seg: 10 });
    head.parent = this.worldGroup;
    instances(head, lamps.map(([x, z]) => ({ x, y: 2.6, z })));

    // crib floors for every plot
    const plots = (2 * R + 1) ** 2;
    for (let i = 1; i < plots; i++) {
      const [cx, cy] = plotCenter(i);
      const f = groundPlane(6, 6, this.floorMat(cribStyle(i).floor), 0.03);
      f.position.x = cx;
      f.position.z = cy;
      f.receiveShadows = true;
      f.parent = this.worldGroup;
      this.cribFloors.set(i, f);
    }
    // scenery: stray cats and dogs roam the open streets (no gameplay)
    this.pets.clear();
    let n = 0;
    const corners: Array<[number, number]> = [[6, 6], [-6, 6], [6, -2], [-6, -2]];
    for (let i = 0; i < plots; i++) {
      if (i > 0 && i % 2 === 1) continue;
      const [cx, cy] = plotCenter(i);
      const [ox, oy] = i === 0 ? [2, 2] : corners[(i / 2) % 4];
      const g = this.makePet((i / 2) % 2 ? 'dog' : 'cat');
      g.parent = this.worldGroup;
      g.position.set(cx + ox, 0, cy + oy);
      this.pets.set(n++, { g, home: g.position.clone(), phase: i * 1.7 });
    }
    // labels and doors are re-made from crib state
    for (const d of this.doors.values()) dispose(d, true);
    this.doors.clear();
    for (const l of this.cribLabels.values()) dispose(l.sprite, true);
    this.cribLabels.clear();
  }

  private floorMats = new Map<number, PBRMaterial>();
  private floorMat(hex: number): PBRMaterial {
    let m = this.floorMats.get(hex);
    if (!m) {
      m = std(hex, { map: this.floorTex, roughness: 0.85 });
      this.floorMats.set(hex, m);
    }
    return m;
  }

  private label(text: string, color: string, size: number, bg: string, x: number, y: number, z: number): Mesh {
    useScene(this.scene, this.shadows);
    const s = textSprite(text, color, size, bg);
    s.position.set(x, y, z);
    return s;
  }

  updateCribs(cribs: CribView[], myCrib: number, showFree = false) {
    useScene(this.scene, this.shadows);
    const seen = new Set<string>();
    const seenLabels = new Set<number>();
    for (const c of cribs) {
      for (const side of [0, 1] as const) {
        const key = `${c.i}-${side}`;
        seen.add(key);
        const level = Math.max(0, DOOR_LEVEL_HP.indexOf(c.max));
        let m = this.doors.get(key);
        if (!m || ud<DoorData>(m).level !== level) {
          // each door armor level has its own look: wood, iron-banded, steel blast door, Sigma vault
          const old = m;
          m = makeDoor(level, cribStyle(c.i).door);
          const [x, y] = doorCenter(c.i, side);
          m.position.set(x, old ? old.position.y : 0.68, y);
          dispose(old, true);
          this.doors.set(key, m);
        }
        const d = c.doors[side];
        const dd = ud<DoorData>(m);
        dd.setHp(d.hp / Math.max(1, c.max));
        dd.targetY = d.hp <= 0 ? 0.1 : d.open ? 2.1 : 0.68;
        m.scaling.y = d.hp <= 0 ? 0.15 : 1;
      }
      seenLabels.add(c.i);
      const text = c.i === myCrib ? 'YOUR CRIB' : `${c.ownerName ?? 'bro'}'s crib`;
      const cur = this.cribLabels.get(c.i);
      if (!cur || cur.text !== text) {
        dispose(cur?.sprite, true);
        const [cx, cy] = plotCenter(c.i);
        const s = this.label(text, c.i === myCrib ? '#ffd23f' : '#d8d4ff', 36, 'rgba(0,0,0,0.35)', cx, 1.6, cy + 4.9);
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
        const [cx, cy] = plotCenter(i);
        this.cribLabels.set(i, { sprite: this.label(text, '#7dffb2', 30, 'rgba(0,0,0,0.35)', cx, 1.6, cy + 4.9), text });
      }
    }
    for (const [k, m] of this.doors) if (!seen.has(k)) { dispose(m, true); this.doors.delete(k); }
    for (const [i, l] of this.cribLabels) if (!seenLabels.has(i)) { dispose(l.sprite, true); this.cribLabels.delete(i); }
    const owned = new Set(cribs.map((c) => c.i));
    for (const [i, f] of this.cribFloors) if (!owned.has(i)) f.material = this.floorMat(cribStyle(i).floor);
  }

  private makePet(kind: string): Node {
    const g = group(null, kind);
    const fur = std(kind === 'dog' ? 0xc08040 : 0xff9a3c);
    const body = at(capsule(0.14, 0.3, fur, 8), 0, 0.2, 0);
    body.rotation.z = Math.PI / 2;
    add(g, body, at(sphere(0.13, fur, { seg: 10 }), 0.28, 0.32, 0));
    if (kind === 'dog') {
      add(g, box(0.05, 0.12, 0.1, fur, 0.26, 0.4, 0.1), box(0.05, 0.12, 0.1, fur, 0.26, 0.4, -0.1));
    } else {
      add(g, at(cone(0.04, 0.1, fur, 4), 0.28, 0.46, 0.06), at(cone(0.04, 0.1, fur, 4), 0.28, 0.46, -0.06));
    }
    const tail = at(cyl(0.025, 0.025, 0.3, fur, { seg: 6 }), -0.32, 0.32, 0);
    tail.rotation.z = 0.6;
    add(g, tail);
    castShadows(g);
    return g;
  }

  /** Put kicks/armour on a custom avatar: shoes ride the leg pivots, a helmet hides hat and hair. */
  private dressGear(avatar: Avatar, kicks: number, vest: number) {
    useScene(this.scene, this.shadows);
    const od = ud<GearData>(avatar.group);
    for (const f of od.kickFeet ?? []) dispose(f, true);
    const gear = applyGear(avatar.group, kicks, vest, avatar.measure);
    const gd = ud<GearNodeData>(gear);
    od.kickFeet = [];
    gd.feet.forEach((f, i) => {
      const leg = i === 0 ? avatar.legL : avatar.legR;
      f.parent = leg;
      f.position.set(0, f.position.y - leg.position.y, f.position.z);
      od.kickFeet!.push(f);
    });
    avatar.setHeadwearVisible(!gd.helmet);
  }

  private makeBro(e: EntView): BroMesh {
    useScene(this.scene, this.shadows);
    const g = group(null, 'broRoot');
    const avatar = buildAvatar(parseLook(e.lk) ?? DEFAULT_LOOK);
    castShadows(avatar.group);
    rimAll(avatar.group, 0xfff4e0, 0.45);
    // the ring light: a glowing halo over the head
    const ringMat = std(0xffffff, { emissive: 0xfff1d6, emissiveIntensity: 0 });
    const halo = at(torus(0.26, 0.045, ringMat, 24), 0, 1.62, 0);
    halo.rotation.x = Math.PI / 2;
    const label = at(textSprite(e.n, '#ffffff', 34), 0, 2.0, 0);
    const reviveRing = at(ring(0.5, 0.62, basic(0x4ade80, { opacity: 0.9, doubleSide: true }), 32, 0.01), 0, 0.05, 0);
    reviveRing.rotation.x = -Math.PI / 2;
    reviveRing.setEnabled(false);
    add(g, avatar.group, halo, label, reviveRing);
    this.dressGear(avatar, e.gk ?? 0, e.gv ?? 0);
    return { group: g, ring: halo, ringMat, label, reviveRing, revive: -1, kind: e.k, name: e.n, look: e.lk ?? '', avatar, spd: 0 };
  }

  private makeOpp(e: EntView): OppMesh {
    // an Opp: tall, hood up, black ski mask, no eyes (they hunt by sound), arms reaching
    useScene(this.scene, this.shadows);
    const g = group(null, 'opp');
    const hoodie = std(0x1c1f26, { roughness: 0.85, emissive: 0x2a0008, emissiveIntensity: 0.4 });
    const pants = std(0x2b2f3a, { roughness: 0.9 });
    const mask = std(0x0b0b0e, { roughness: 0.95 });
    const shoe = std(0xf2f2f2);
    for (const dx of [-0.12, 0.12]) add(g, box(0.16, 0.9, 0.18, pants, dx, 0.45, 0), box(0.2, 0.12, 0.32, shoe, dx, 0.06, 0.05));
    const head = at(sphere(0.24, mask, { seg: 14 }), 0, 2.1, 0);
    head.scaling.set(1, 1.15, 1);
    // hood around the masked head
    const hood = at(sphere(0.31, hoodie, { seg: 14, slice: 0.62 }), 0, 2.08, -0.05);
    hood.rotation.x = -0.35;
    add(g,
      box(0.62, 0.95, 0.38, hoodie, 0, 1.38, 0),
      box(0.4, 0.18, 0.02, std(0x14161b), 0, 1.12, 0.2),
      head, hood,
      // a blank strip where the eyes should be: it glows red, but it cannot see
      box(0.3, 0.05, 0.02, basic(0xff2050), 0, 2.15, 0.235));
    const arm = (side: number) => {
      const pivot = group(g, 'arm');
      pivot.position.set(side * 0.38, 1.8, 0);
      add(pivot, box(0.15, 0.8, 0.16, hoodie, 0, -0.4, 0), box(0.13, 0.13, 0.13, mask, 0, -0.85, 0));
      return pivot;
    };
    const armL = arm(-1);
    const armR = arm(1);
    castShadows(g);
    rimAll(g, 0xff2050, 0.9, 2);
    const chest = at(textSprite('OPP', '#ff3b6b', 40, ''), 0, 1.45, 0.25);
    chest.scaling.setAll(0.6);
    chest.billboardMode = 0;
    chest.renderingGroupId = 0;
    add(g, chest, at(textSprite(e.ai ? 'OPPS' : `OPP: ${e.n}`, '#ff3b6b', 30), 0, 2.8, 0));
    return { group: g, armL, armR, bodyMat: hoodie };
  }

  private makeDrop(k: 'aura' | 'cash' = 'aura'): Mesh {
    useScene(this.scene, this.shadows);
    const m = k === 'cash'
      ? box(0.42, 0.06, 0.22, std(0x5dff8a, { emissive: 0x1f9a40, emissiveIntensity: 1.2 }))
      : octa(0.2, std(0xd9a0ff, { emissive: 0xb46bff, emissiveIntensity: 1.6 }));
    m.position.y = 0.45;
    return m;
  }

  /** Floating "6" / "7" pop-ups near an Opp. */
  popText(x: number, y: number, text: string, color = '#ff3b6b') {
    const s = this.label(text, color, 56, '', x + (Math.random() - 0.5), 2.8, y);
    this.floaters.push({ s, born: performance.now() });
  }

  setDrops(drops: DropView[]) {
    const seen = new Set<number>();
    for (const d of drops) {
      seen.add(d.id);
      let m = this.drops.get(d.id);
      if (!m) { m = { m: this.makeDrop(d.k), k: d.k, id: d.id }; this.drops.set(d.id, m); }
      m.m.position.x = d.x;
      m.m.position.z = d.y;
    }
    for (const [id, d] of this.drops) {
      if (seen.has(id)) continue;
      // picked up: a little sparkle where it was
      const p = d.m.position;
      this.fx.particles.burst(d.k === 'cash' ? 'cash' : 'aura', p.x, p.y, p.z);
      dispose(d.m, true);
      this.drops.delete(id);
    }
  }

  setProps(props: PropView[]) {
    useScene(this.scene, this.shadows);
    const seen = new Set<number>();
    for (const p of props) {
      seen.add(p.id);
      if (this.props.has(p.id)) continue;
      let o: Node;
      if (p.k === 'trap') {
        o = at(torus(0.16, 0.06, std(0xffe14a, { emissive: 0x665500 }), 12, Math.PI), p.x, 0.07, p.y);
        o.rotation.x = -Math.PI / 2;
      } else {
        const g = group(null, 'decoy');
        const face = at(circle13(), 0, 0.3, 0.18);
        add(g, box(0.4, 0.55, 0.35, std(0x222228), 0, 0.28, 0), face, at(textSprite('DECOY', '#ff3b6b', 28), 0, 0.9, 0));
        g.position.set(p.x, 0, p.y);
        castShadows(g);
        o = g;
      }
      this.props.set(p.id, o);
    }
    for (const [id, o] of this.props) if (!seen.has(id)) { dispose(o, true); this.props.delete(id); }
  }

  private makeDef(d: DefView) {
    // every defence level has its own model (see upgrades.ts)
    useScene(this.scene, this.shadows);
    const g = makeDefence(d.k, d.lv);
    const top = d.k === 'lamp' ? 2.1 : d.k === 'bass' && d.lv === 3 ? 1.5 : 1.7;
    const barMat = basic(0x4ade80, { depthTest: false });
    const bar = at(plane0(0.8, 0.08, barMat), 0, top, 0);
    bar.billboardMode = 7;
    bar.renderingGroupId = 2;
    const lvTag = at(textSprite(`Lv${d.lv}`, '#ffd23f', 24, 'rgba(0,0,0,0.5)'), 0, top + 0.22, 0);
    add(g, bar, lvTag);
    g.position.set(d.x, 0, d.y);
    return { g, bar, barMat, lv: d.lv, k: d.k };
  }

  setDefs(defs: DefView[]) {
    const seen = new Set<number>();
    for (const d of defs) {
      seen.add(d.id);
      let m = this.defs.get(d.id);
      if (m && m.lv !== d.lv) { dispose(m.g, true); m = undefined; }
      if (!m) { m = this.makeDef(d); this.defs.set(d.id, m); }
      const hp = Math.max(0, d.hp) / 100;
      m.bar.scaling.x = Math.max(0.01, hp);
      m.barMat.emissiveColor = srgb(hp > 0.5 ? 0x4ade80 : hp > 0.25 ? 0xffd23f : 0xff4d4d);
      const dd = ud<DefData>(m.g);
      dd.setOff(!!d.off);
      if (d.tx !== undefined && d.ty !== undefined) {
        dd.fire(Math.atan2(d.tx - d.x, d.ty - d.y));
        if (m.k === 'blaster') this.shot(d.x, d.y, d.tx, d.ty, d.lv === 3 ? 0xffc83d : 0xff5fa2);
        else if (m.k === 'lamp') this.shot(d.x, d.y, d.tx, d.ty, 0xe9c8ff);
        else if (m.k === 'bass') this.addNoise(-d.id - Math.floor(performance.now() / 400), d.x, d.y, 3 + d.lv);
      }
    }
    for (const [id, m] of this.defs) if (!seen.has(id)) { dispose(m.g, true); this.defs.delete(id); }
  }

  private lastShot = new Map<string, number>();
  private shot(x: number, y: number, tx: number, ty: number, color: number) {
    const key = `${x},${y}`;
    const now = performance.now();
    if (now - (this.lastShot.get(key) ?? 0) < 180) return;
    this.lastShot.set(key, now);
    useScene(this.scene, this.shadows);
    this.fx.particles.burst('shot', x, 0.7, y, { color });
    this.fx.particles.burst('hit', tx, 1.2, ty, { scale: 0.4 });
    const g = group(null, 'shot');
    add(g, line([[x, 0.7, y], [tx, 1.2, ty]], color), at(sphere(0.14, basic(color), { seg: 8 }), tx, 1.2, ty));
    this.shots.push({ m: g, born: now });
  }

  /** `hunter`: the Opp's sound vision, where every ripple glows hot and thick. `k` picks the particle puff. */
  addNoise(id: number, x: number, y: number, r: number, hunter = false, k?: string): boolean {
    if (this.seenNoise.has(id)) return false;
    this.seenNoise.add(id);
    if (this.seenNoise.size > 500) this.seenNoise = new Set([...this.seenNoise].slice(-200));
    useScene(this.scene, this.shadows);
    const color = hunter ? (r >= 7 ? 0xffd23f : 0xff3b6b) : r >= 9 ? 0xff5577 : 0xcfd6ff;
    const o = hunter ? 0.9 : 0.6;
    const mesh = at(ring(hunter ? 0.85 : 0.92, 1, basic(color, { opacity: o, depthWrite: false }), 40), x, 0.06, y);
    mesh.rotation.x = -Math.PI / 2;
    this.ripples.push({ mesh, born: performance.now(), r, o });
    const P = this.fx.particles;
    if (k === 'step' || k === 'zoom') P.burst('dust', x, 0.05, y, { scale: k === 'zoom' ? 1.3 : 0.8 });
    else if (k === 'land') P.burst('land', x, 0.05, y);
    else if (k === 'smash') { P.burst('splinter', x, 0.7, y); P.burst('smoke', x, 0.3, y); }
    else if (k === 'knock' || k === 'door') P.burst('hit', x, 0.7, y, { scale: 0.5 });
    else if (k === 'repair') P.burst('sparks', x, 0.6, y, { scale: 0.4 });
    else if (k === 'mog') P.burst('mog', x, 1.2, y);
    else if (k === 'bass') P.burst('hit', x, 0.4, y, { scale: 1.6 });
    return true;
  }

  /** The Opp's screech: a big pulse from (x, y), then a marker on every bro it bounced off. */
  echo(x: number, y: number, r: number, pts: Array<[number, number]>, lifeSec: number) {
    useScene(this.scene, this.shadows);
    const pulse = at(ring(0.96, 1, basic(0xff3b6b, { opacity: 0.9, depthWrite: false }), 64), x, 0.08, y);
    pulse.rotation.x = -Math.PI / 2;
    this.ripples.push({ mesh: pulse, born: performance.now(), r, o: 0.9, life: 1400 });
    for (const [px, py] of pts) {
      const delay = (Math.hypot(px - x, py - y) / r) * 1400; // each ping shows when the pulse reaches it
      setTimeout(() => {
        useScene(this.scene, this.shadows);
        const g = group(null, 'blip');
        const rg = at(ring(0.45, 0.6, basic(0xff3b6b, { depthWrite: false, depthTest: false }), 32), 0, 0.1, 0);
        rg.rotation.x = -Math.PI / 2;
        add(g, rg, at(cyl(0.06, 0.06, 3, basic(0xff3b6b, { opacity: 0.8, depthWrite: false }), { seg: 6 }), 0, 1.5, 0), at(textSprite('BRO', '#ff3b6b', 26), 0, 3.3, 0));
        g.position.set(px, 0, py);
        this.blips.push({ g, ring: rg, born: performance.now(), life: lifeSec * 1000 });
      }, delay);
    }
  }

  /** Where a world position lands on screen, in CSS pixels. */
  toScreen(x: number, y: number): { sx: number; sy: number; behind: boolean } {
    const w = window.innerWidth, h = window.innerHeight;
    const v = Vector3.Project(new Vector3(x, 0.5, y), Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(w, h));
    return { sx: v.x, sy: v.y, behind: v.z > 1 || v.z < 0 };
  }

  /** A grate rattles (Opp coming through) for a moment. */
  rattleVent(x: number, y: number, ms = 1700) {
    let best: { g: Node; x: number; y: number; until: number } | null = null, bd = 1.5;
    for (const v of this.vents) { const d = Math.hypot(v.x - x, v.y - y); if (d < bd) { bd = d; best = v; } }
    if (best) best.until = performance.now() + ms;
  }

  zoomBy(d: number) { this.zoom = Math.max(0.55, Math.min(1.7, this.zoom + d)); }

  /** Draw a frame. `ents` are already interpolated. */
  frame(ents: EntView[], selfId: string, focus: { x: number; y: number }, ev: WorldEvents, monsterView: boolean) {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    const t = now;
    this.power = ev.power;
    useScene(this.scene, this.shadows);

    // camera
    const k = 1 - Math.pow(0.0005, dt);
    this.target.x += (focus.x - this.target.x) * k;
    this.target.z += (focus.y - this.target.z) * k;
    this.target.y = 0;
    this.camera.position.copyFrom(this.target).addInPlace(CAM_OFFSET.scale(this.zoom));
    this.camera.setTarget(new Vector3(this.target.x, 0.6, this.target.z));
    this.moon.position.set(this.target.x - 8, 20, this.target.z - 6);

    // atmosphere
    const s = this.scene;
    const near = ev.fog ? 6 : !ev.power ? 10 : monsterView ? 22 : 40;
    const far = ev.fog ? 18 : !ev.power ? 24 : monsterView ? 45 : 80;
    Color3.LerpToRef(this.fogColor, srgb(ev.fog ? 0x9aa0ab : !ev.power ? 0x06070c : SKY), 0.06, this.fogColor);
    s.fogColor = this.fogColor;
    s.clearColor.set(this.fogColor.r, this.fogColor.g, this.fogColor.b, 1);
    s.fogStart += (near - s.fogStart) * 0.05;
    s.fogEnd += (far - s.fogEnd) * 0.05;
    // smooth transitions between modes
    const hemiTarget = !ev.power ? 0.3 : ev.disco ? 1.0 : 2.4;
    this.hemi.intensity += (hemiTarget - this.hemi.intensity) * 0.06;
    const moonTarget = ev.power ? 2.2 : 0.25;
    this.moon.intensity += (moonTarget - this.moon.intensity) * 0.06;
    Color3.LerpToRef(this.hemi.diffuse, srgb(ev.rage ? 0xff8090 : 0xdfe8ff), 0.05, this.hemi.diffuse);
    this.lampHeadMat.emissiveIntensity = ev.power ? 2 : 0.05;

    // doors glide to their target height
    for (const d of this.doors.values()) {
      const ty = ud<DoorData>(d).targetY ?? 0.68;
      d.position.y += (ty - d.position.y) * Math.min(1, dt * 10);
    }

    // entities
    const seenBros = new Set<string>();
    const seenOpps = new Set<string>();
    const lit: Array<{ x: number; y: number; z: number }> = [];
    let danger = 0;
    for (const e of ents) {
      if (e.k === 'opp') {
        seenOpps.add(e.id);
        let m = this.opps.get(e.id);
        if (!m) { m = this.makeOpp(e); this.opps.set(e.id, m); }
        const p = m.group.position;
        const mx = e.x - p.x, mz = e.y - p.z;
        p.set(e.x, 0, e.y);
        if (mx * mx + mz * mz > 1e-5) m.group.rotation.y = Math.atan2(mx, mz);
        // stiff arm swing; frantic when mogged
        const speed = e.st ? 30 : 7;
        m.armL.rotation.x = Math.sin(t / 1000 * speed) * 0.45;
        m.armR.rotation.x = -Math.sin(t / 1000 * speed) * 0.45; // arms swinging, reaching for you
        m.group.rotation.z = e.st ? Math.sin(t / 40) * 0.15 : 0;
        m.bodyMat.emissiveIntensity = e.st ? 2 : 0.4;
        if (e.st && !this.stunnedIds.has(e.id)) { this.fx.particles.burst('mog', e.x, 1.6, e.y, { scale: 1.3 }); this.fx.shake(0.15); }
        if (e.st) this.stunnedIds.add(e.id); else this.stunnedIds.delete(e.id);
        danger = Math.max(danger, 1 - Math.hypot(e.x - focus.x, e.y - focus.y) / 9);
        continue;
      }
      seenBros.add(e.id);
      let m = this.bros.get(e.id);
      if (!m || m.name !== e.n || m.look !== (e.lk ?? '')) {
        if (m) this.dropBro(m);
        m = this.makeBro(e);
        this.bros.set(e.id, m);
      }
      const p = m.group.position;
      const mx = e.x - p.x, mz = e.y - p.z;
      const npc = e.k === 'npc';
      const bob = npc ? 0.25 + Math.sin(t / 300) * 0.12 : 0;
      p.set(e.x, (e.z ?? 0) + bob, e.y);
      if (mx * mx + mz * mz > 1e-5) m.group.rotation.y = Math.atan2(mx, mz);
      const od = ud<GearData>(m.avatar.group);
      if (od.gearKey !== `${e.gk ?? 0}:${e.gv ?? 0}`) this.dressGear(m.avatar, e.gk ?? 0, e.gv ?? 0);
      const gear = od.gear!;
      ud<GearNodeData>(gear).setShield(!!e.sh && !npc, t);
      show(gear, !npc);
      for (const f of od.kickFeet ?? []) show(f, !npc);
      m.avatar.setGhost(npc);
      m.spd = m.spd * 0.85 + (Math.hypot(mx, mz) / Math.max(dt, 1e-3)) * 0.15;
      m.avatar.animate(t / 1000, npc ? 0 : Math.min(1, m.spd / 4));
      m.ringMat.emissiveIntensity = e.l ? 3 : 0;
      show(m.ring, !npc);
      const rv = npc && e.rv ? e.rv : 0;
      show(m.reviveRing, rv > 0);
      if (rv > 0 && Math.abs(rv - m.revive) > 0.005) {
        m.revive = rv;
        ringData(0.5, 0.62, 32, Math.PI * 2 * rv).applyToMesh(m.reviveRing, true);
      }
      // landing puff when a jump touches down
      const z = e.z ?? 0, wasZ = this.airborne.get(e.id) ?? 0;
      if (wasZ > 0.25 && z < 0.05) this.fx.particles.burst('land', e.x, 0.05, e.y, { scale: 0.7 });
      this.airborne.set(e.id, z);
      if (e.l && !npc) lit.push({ x: e.x, y: e.y, z: e.z ?? 0 });
      if (e.id === selfId) show(m.label, false);
    }
    for (const [id, m] of this.bros) if (!seenBros.has(id)) { this.dropBro(m); this.bros.delete(id); this.airborne.delete(id); }
    for (const [id, m] of this.opps) if (!seenOpps.has(id)) { dispose(m.group, true); this.opps.delete(id); }

    // ring light pool: nearest lit bros get a real light
    lit.sort((a, b) => Math.hypot(a.x - focus.x, a.y - focus.y) - Math.hypot(b.x - focus.x, b.y - focus.y));
    // (in disco mode the same pool becomes the spinning party lights)
    this.ringLights.forEach((l, i) => {
      const p = lit[i];
      if (ev.disco) {
        const a = t / 500 + (i * Math.PI * 2) / 3;
        l.diffuse = srgb(DISCO[i % DISCO.length]);
        l.position.set(focus.x + Math.cos(a) * 5, 3, focus.y + Math.sin(a) * 5);
        l.intensity = 30; l.range = 16;
      } else if (p) { l.diffuse = srgb(0xfff1d6); l.position.set(p.x, 1.6 + p.z, p.y); l.intensity = 22; l.range = RING_LIGHT_RANGE * 4; }
      else l.intensity = 0;
      l.setEnabled(l.intensity > 0);
    });
    this.selfLight.position.set(focus.x, 1.6, focus.y);
    this.selfLight.intensity = monsterView ? 2 : 5;

    // ambient strays wander the streets (scenery only)
    for (const p of this.pets.values()) {
      const a = t / 6000 + p.phase;
      const nx = p.home.x + Math.cos(a) * 2, nz = p.home.z + Math.sin(a * 1.3) * 2;
      p.g.rotation.y = Math.atan2(nx - p.g.position.x, nz - p.g.position.z) - Math.PI / 2;
      p.g.position.set(nx, Math.abs(Math.sin(t / 120)) * 0.04, nz);
    }

    // turret shots fade
    this.shots = this.shots.filter((sh) => {
      const age = (t - sh.born) / 250;
      if (age >= 1) { dispose(sh.m, true); return false; }
      fade(sh.m, 1 - age);
      return true;
    });
    // animated upgrade pieces: vault wheels, kick wings, armour sparkles, defences
    for (const d of this.defs.values()) tickUpgrades(d.g, t);
    for (const d of this.doors.values()) tickUpgrades(d, t);
    for (const b of this.bros.values()) tickUpgrades(b.avatar.group, t);

    // drops spin
    for (const d of this.drops.values()) { d.m.rotation.y += dt * 2; d.m.position.y = 0.45 + Math.sin(t / 400 + d.id) * 0.08; }

    // ripples
    this.ripples = this.ripples.filter((r) => {
      const age = (t - r.born) / (r.life ?? 900);
      if (age >= 1) { dispose(r.mesh, true); return false; }
      const sc = 0.3 + age * r.r;
      r.mesh.scaling.set(sc, sc, sc);
      if (r.mesh.material) setOpacity(r.mesh.material, r.o * (1 - age));
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
      if (age >= 1) { dispose(b.g, true); return false; }
      fade(b.g, (1 - age) * (0.6 + 0.4 * Math.sin(t / 90)));
      const sc = 1 + Math.sin(t / 120) * 0.15;
      b.ring.scaling.set(sc, sc, sc);
      return true;
    });
    this.floaters = this.floaters.filter((f) => {
      const age = (t - f.born) / 1200;
      if (age >= 1) { dispose(f.s, true); return false; }
      f.s.position.y += dt * 0.8;
      f.s.visibility = 1 - age;
      return true;
    });

    this.danger = Math.max(0, danger);
    this.fx.update(dt, { power: ev.power, rage: ev.rage, fog: ev.fog, monsterView, danger: this.danger, focus });
    this.scene.render();
  }

  private dropBro(m: BroMesh) {
    m.avatar.dispose();
    dispose(m.group, true);
  }

  /** 0..1: how close the nearest Opp is to the camera target (for heartbeat and screen effects). */
  danger = 0;
}

/** Decoy speaker face. */
function circle13(): Mesh {
  const m = cyl(0.13, 0.13, 0.01, std(0x888899, { emissive: 0xff3b6b, emissiveIntensity: 0.8 }), { seg: 16 });
  m.rotation.x = Math.PI / 2;
  return m;
}

/** A plane for HUD-ish bars. */
function plane0(w: number, h: number, mat: StandardMaterial): Mesh {
  const m = box(w, h, 0.001, mat);
  m.isPickable = false;
  return m;
}

