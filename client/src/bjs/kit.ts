// Small Babylon.js toolkit used by the whole client: shape builders, materials,
// groups, billboarded text, and the shader patches (ground occlusion, rim light).
//
// Conventions (same as the old Three.js client, so game code reads the same):
// - The scene is right-handed with y up. Game x -> x, game y -> z.
// - Every builder adds its mesh to the current scene (see `useScene`).
// - `castShadows(root)` registers a node and its children with the sun's shadow map.
// - `node.metadata.tick(t)` is called every frame by `tickAll` (animated upgrade pieces).

import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

export { Mesh, TransformNode, Vector3, Color3 };
export type Node = TransformNode;

// ---------------------------------------------------------------- scene context

let current: Scene | null = null;
let shadowGen: ShadowGenerator | null = null;

/** Builders add to this scene. The game scene and the creator preview each set their own. */
export function useScene(scene: Scene, shadows: ShadowGenerator | null = null) {
  current = scene;
  shadowGen = shadows;
}
/** The current scene and shadow generator, to restore after an await (see town.ts). */
export function context(): { scene: Scene; shadows: ShadowGenerator | null } {
  return { scene: scene(), shadows: shadowGen };
}
export function scene(): Scene {
  if (!current) throw new Error('kit: no scene');
  return current;
}

let uid = 0;
const nm = (p: string) => `${p}${++uid}`;

// ---------------------------------------------------------------- colours

/** sRGB hex -> linear Color3 (what PBR materials expect). */
export function lin(hex: number): Color3 {
  return Color3.FromInts((hex >> 16) & 255, (hex >> 8) & 255, hex & 255).toLinearSpace();
}
/** sRGB hex -> Color3 in gamma space (clear colour, fog, unlit). */
export function srgb(hex: number): Color3 {
  return Color3.FromInts((hex >> 16) & 255, (hex >> 8) & 255, hex & 255);
}
/** Multiply the channels of an sRGB hex colour. */
export function shade(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
}
/** Mix two sRGB hex colours. */
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// ---------------------------------------------------------------- materials

export interface StdOpts {
  roughness?: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  map?: BaseTexture;
  opacity?: number;
  doubleSide?: boolean;
  flat?: boolean;
}

/** A lit PBR material (the old MeshStandardMaterial). */
export function std(color: number, o: StdOpts = {}): PBRMaterial {
  const m = new PBRMaterial(nm('std'), scene());
  m.albedoColor = lin(color);
  m.roughness = o.roughness ?? 0.6;
  m.metallic = o.metalness ?? 0;
  m.maxSimultaneousLights = 8;
  if (o.emissive !== undefined) {
    m.emissiveColor = lin(o.emissive);
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  if (o.map) m.albedoTexture = o.map;
  if (o.opacity !== undefined && o.opacity < 1) { m.alpha = o.opacity; m.transparencyMode = PBRMaterial.MATERIAL_ALPHABLEND; }
  if (o.doubleSide) { m.backFaceCulling = false; m.twoSidedLighting = true; }
  return m;
}

/** Emissive intensity setter that works the same as Three's `emissiveIntensity`. */
export function setEmissive(m: PBRMaterial, intensity: number) { m.emissiveIntensity = intensity; }

export interface BasicOpts { opacity?: number; doubleSide?: boolean; depthWrite?: boolean; depthTest?: boolean; additive?: boolean; map?: BaseTexture }

/** An unlit, flat-coloured material (the old MeshBasicMaterial). */
export function basic(color: number, o: BasicOpts = {}): StandardMaterial {
  const m = new StandardMaterial(nm('basic'), scene());
  m.disableLighting = true;
  m.emissiveColor = srgb(color);
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  // with lighting off the emissive texture is added to emissiveColor, so the colour must be black
  if (o.map) { m.emissiveTexture = o.map; m.opacityTexture = o.map; m.emissiveColor = Color3.Black(); }
  if (o.opacity !== undefined) m.alpha = o.opacity;
  if (o.doubleSide) m.backFaceCulling = false;
  if (o.depthWrite === false) m.disableDepthWrite = true;
  if (o.depthTest === false) m.depthFunction = 519; // ALWAYS
  if (o.additive) m.alphaMode = 1; // ALPHA_ADD
  m.fogEnabled = false;
  return m;
}

/** Set opacity on either material kind (enables blending when below 1). */
export function setOpacity(m: Material, o: number) {
  m.alpha = o;
  if (m instanceof PBRMaterial) m.transparencyMode = o < 1 ? PBRMaterial.MATERIAL_ALPHABLEND : PBRMaterial.MATERIAL_OPAQUE;
}

/** The albedo / emissive colour of a material as an sRGB hex. */
export function setColor(m: Material, hex: number) {
  if (m instanceof PBRMaterial) m.albedoColor = lin(hex);
  else if (m instanceof StandardMaterial) m.emissiveColor = srgb(hex);
}

// ---------------------------------------------------------------- shader patches

/** Injects fixed GLSL into a PBR material. One define per variant keeps the shader cache apart. */
class CodePlugin extends MaterialPluginBase {
  constructor(material: Material, name: string, private define: string, private code: Record<string, string>) {
    super(material, name, 200, { [define]: false });
    this._enable(true);
  }
  prepareDefines(defines: MaterialDefines) { defines[this.define] = true; }
  getCustomCode(shaderType: string) { return shaderType === 'fragment' ? this.code : null; }
  getClassName() { return 'BroCodePlugin'; }
}

const f = (n: number) => n.toFixed(3);
const tag = (n: number) => Math.round(n * 1000).toString(36);

/** Darken a PBR material towards y = 0 in world space, so things look planted. */
export function groundOcclusion<T extends Material>(mat: T, strength = 0.45, height = 0.8): T {
  if (!(mat instanceof PBRMaterial)) return mat;
  const meta = (mat.metadata ??= {}) as { gao?: boolean };
  if (meta.gao) return mat;
  meta.gao = true;
  const def = `GAO_${tag(strength)}_${tag(height)}`.toUpperCase();
  new CodePlugin(mat, `gao${def}`, def, {
    CUSTOM_FRAGMENT_BEFORE_LIGHTS: `surfaceAlbedo *= 1.0 - ${f(strength)} * (1.0 - smoothstep(0.0, ${f(height)}, vPositionW.y));`,
  });
  return mat;
}

/** Fresnel rim light so characters pop off the ground. */
export function rimLight<T extends Material>(mat: T, color: number, strength = 0.6, power = 2.5): T {
  if (!(mat instanceof PBRMaterial)) return mat;
  const meta = (mat.metadata ??= {}) as { rim?: boolean };
  if (meta.rim) return mat;
  meta.rim = true;
  const c = srgb(color).scale(strength);
  const def = `RIM_${color.toString(36)}_${tag(strength)}_${tag(power)}`.toUpperCase();
  new CodePlugin(mat, `rim${def}`, def, {
    CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `finalColor.rgb += vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)}) * pow(1.0 - clamp(abs(dot(normalW, viewDirectionW)), 0.0, 1.0), ${f(power)});`,
  });
  return mat;
}

/** Rim light on every PBR material under a node. */
export function rimAll(root: Node, color: number, strength = 0.6, power = 2.5) {
  for (const m of meshesOf(root)) if (m.material) rimLight(m.material, color, strength, power);
}

// ---------------------------------------------------------------- nodes

export function group(parent?: Node | null, name = 'g'): TransformNode {
  const g = new TransformNode(nm(name), scene());
  if (parent) g.parent = parent;
  return g;
}

export function add(parent: Node, ...kids: Node[]) {
  for (const k of kids) k.parent = parent;
}

/** All meshes under a node, including itself. */
export function meshesOf(root: Node): AbstractMesh[] {
  const out = root.getChildMeshes(false);
  if (root instanceof Mesh) out.unshift(root);
  return out;
}

/** Register a node (and everything under it) as a shadow caster. */
export function castShadows(root: Node) {
  if (!shadowGen) return;
  for (const m of meshesOf(root)) shadowGen.addShadowCaster(m, false);
}

export function receiveShadows(root: Node, on = true) {
  for (const m of meshesOf(root)) m.receiveShadows = on;
}

/** Show or hide a node with its children. */
export function show(n: Node, on: boolean) { if (n.isEnabled(false) !== on) n.setEnabled(on); }

/** Fade every mesh under a node (multiplies with material alpha). */
export function fade(root: Node, v: number) {
  for (const m of meshesOf(root)) m.visibility = v;
}

/** Dispose a node, its children, and (optionally) their materials. */
export function dispose(n: Node | null | undefined, materials = false) {
  if (!n || n.isDisposed()) return;
  n.dispose(false, materials);
}

type Tick = (t: number) => void;
export function addTick(n: Node, fn: Tick) {
  const meta = (n.metadata ??= {}) as { tick?: Tick };
  const prev = meta.tick;
  meta.tick = prev ? (t: number) => { prev(t); fn(t); } : fn;
}
/** Run every `metadata.tick` under a node. */
export function tickAll(root: Node, t: number) {
  const run = (n: Node) => { const fn = (n.metadata as { tick?: Tick } | null)?.tick; if (fn) fn(t); };
  run(root);
  for (const c of root.getChildTransformNodes(false)) run(c);
  for (const c of root.getChildMeshes(false)) run(c);
}

/** Node metadata as a typed bag (the old `userData`). */
export function ud<T = Record<string, unknown>>(n: Node): T {
  return (n.metadata ??= {}) as T;
}

// ---------------------------------------------------------------- shapes

function finish(m: Mesh, mat: Material | null | undefined, x = 0, y = 0, z = 0): Mesh {
  if (mat) m.material = mat;
  m.position.set(x, y, z);
  return m;
}

export function box(w: number, h: number, d: number, mat?: Material | null, x = 0, y = 0, z = 0): Mesh {
  return finish(CreateBox(nm('box'), { width: w, height: h, depth: d }, scene()), mat, x, y, z);
}

export interface SphereOpts { seg?: number; slice?: number; arc?: number }
/** `slice` keeps the top part (0..1 of the height), like Three's thetaLength / PI. */
export function sphere(r: number, mat?: Material | null, o: SphereOpts = {}): Mesh {
  return finish(CreateSphere(nm('sph'), {
    diameter: r * 2, segments: Math.max(4, Math.round((o.seg ?? 16) / 2)), slice: o.slice, arc: o.arc,
    sideOrientation: o.slice !== undefined || o.arc !== undefined ? Mesh.DOUBLESIDE : Mesh.DEFAULTSIDE,
  }, scene()), mat);
}

export interface CylOpts { seg?: number; open?: boolean; arc?: number }
export function cyl(rTop: number, rBot: number, h: number, mat?: Material | null, o: CylOpts = {}): Mesh {
  return finish(CreateCylinder(nm('cyl'), {
    diameterTop: rTop * 2, diameterBottom: rBot * 2, height: h, tessellation: o.seg ?? 12, arc: o.arc,
    cap: o.open ? Mesh.NO_CAP : Mesh.CAP_ALL, sideOrientation: o.open || o.arc ? Mesh.DOUBLESIDE : Mesh.DEFAULTSIDE,
  }, scene()), mat);
}

export function cone(r: number, h: number, mat?: Material | null, seg = 12, open = false): Mesh {
  return cyl(0, r, h, mat, { seg, open });
}

/** Three-style capsule: `len` is the straight middle part, total height len + 2r. */
export function capsule(r: number, len: number, mat?: Material | null, seg = 10): Mesh {
  return finish(CreateCapsule(nm('cap'), { radius: r, height: len + 2 * r, tessellation: seg, subdivisions: 2, capSubdivisions: 4 }, scene()), mat);
}

/** Torus in the XY plane (like Three's TorusGeometry). `arc` in radians draws part of it. */
export function torus(R: number, tube: number, mat?: Material | null, seg = 24, arc = Math.PI * 2): Mesh {
  let m: Mesh;
  if (arc >= Math.PI * 2 - 1e-3) {
    m = CreateTorus(nm('tor'), { diameter: R * 2, thickness: tube * 2, tessellation: seg }, scene());
    // Babylon's torus lies in XZ; turn it to XY like Three
    m.rotation.x = Math.PI / 2;
    m.bakeCurrentTransformIntoVertices();
  } else {
    const path: Vector3[] = [];
    const n = Math.max(4, Math.round((seg * arc) / (Math.PI * 2)));
    for (let i = 0; i <= n; i++) { const a = (i / n) * arc; path.push(new Vector3(Math.cos(a) * R, Math.sin(a) * R, 0)); }
    m = CreateTube(nm('arc'), { path, radius: tube, tessellation: 8, cap: Mesh.CAP_ALL }, scene());
  }
  return finish(m, mat);
}

/** A flat plane facing +Z (Three's PlaneGeometry), visible from both sides. */
export function plane(w: number, h: number, mat?: Material | null): Mesh {
  return finish(CreatePlane(nm('pl'), { width: w, height: h, sideOrientation: Mesh.DOUBLESIDE }, scene()), mat);
}

/** A flat plane lying on the ground (facing +Y) at height y. */
export function groundPlane(w: number, h: number, mat?: Material | null, y = 0): Mesh {
  const m = CreatePlane(nm('gp'), { width: w, height: h }, scene());
  m.rotation.x = Math.PI / 2;
  m.bakeCurrentTransformIntoVertices();
  m.position.y = y;
  if (mat) m.material = mat;
  return m;
}

/** A filled circle in the XY plane. */
export function circle(r: number, mat?: Material | null, seg = 32): Mesh {
  return finish(CreateDisc(nm('disc'), { radius: r, tessellation: seg, sideOrientation: Mesh.DOUBLESIDE }, scene()), mat);
}

/** A flat ring in the XY plane from `inner` to `outer`, optionally only part of it (`arc` radians). */
export function ring(inner: number, outer: number, mat?: Material | null, seg = 32, arc = Math.PI * 2): Mesh {
  const m = new Mesh(nm('ring'), scene());
  ringData(inner, outer, seg, arc).applyToMesh(m, true);
  return finish(m, mat);
}
export function ringData(inner: number, outer: number, seg: number, arc: number): VertexData {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [], uv: number[] = [];
  const n = Math.max(1, Math.round((seg * Math.max(arc, 0.01)) / (Math.PI * 2)));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * arc;
    const c = Math.cos(a), s = Math.sin(a);
    pos.push(c * inner, s * inner, 0, c * outer, s * outer, 0);
    nrm.push(0, 0, 1, 0, 0, 1);
    uv.push(i / n, 0, i / n, 1);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); // back side
  }
  const vd = new VertexData();
  vd.positions = pos; vd.normals = nrm; vd.indices = idx; vd.uvs = uv;
  return vd;
}

export function octa(r: number, mat?: Material | null): Mesh {
  // Babylon's unit octahedron reaches 1.414 from the centre; scale it to radius r like Three's
  return finish(CreatePolyhedron(nm('oct'), { type: 1, size: r / Math.SQRT2 }, scene()), mat);
}

export function ico(r: number, subdiv: number, mat?: Material | null, flat = true): Mesh {
  return finish(CreateIcoSphere(nm('ico'), { radius: r, subdivisions: subdiv, flat }, scene()), mat);
}

export function line(points: Array<[number, number, number]>, color: number): Mesh {
  const m = CreateLines(nm('line'), { points: points.map(([x, y, z]) => new Vector3(x, y, z)), updatable: false }, scene());
  m.color = srgb(color);
  return m;
}

// ---------------------------------------------------------------- textures

/** A texture painted on a 2D canvas. */
export function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, repeat = false): DynamicTexture {
  const t = new DynamicTexture(nm('ctex'), { width: w, height: h }, scene(), true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
  paint(ctx, w, h);
  t.update(true);
  t.hasAlpha = true;
  if (repeat) { t.wrapU = Texture.WRAP_ADDRESSMODE; t.wrapV = Texture.WRAP_ADDRESSMODE; }
  return t;
}

// ---------------------------------------------------------------- text sprites

/**
 * A billboarded text label (the old THREE.Sprite labels). Always faces the camera and
 * draws on top of the world. World size: about 0.0054 units per canvas pixel.
 */
export function textSprite(text: string, color = '#ffffff', size = 48, bg = 'rgba(0,0,0,0.55)'): Mesh {
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `800 ${size}px Inter, Arial, sans-serif`;
  const w = Math.ceil(probe.measureText(text).width) + size;
  const h = Math.ceil(size * 1.6);
  const tex = canvasTexture(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = `800 ${size}px Inter, Arial, sans-serif`;
    if (bg) {
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, size * 0.4);
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
  });
  const mat = basic(0xffffff, { map: tex, depthWrite: false });
  mat.useAlphaFromDiffuseTexture = true;
  const k = 0.006 * 0.9;
  const m = plane(w * k, h * k, mat);
  m.billboardMode = Mesh.BILLBOARDMODE_ALL;
  m.renderingGroupId = 2;
  m.isPickable = false;
  m.metadata = { label: true };
  return m;
}

/** Fade a text sprite. */
export function spriteOpacity(m: Mesh, o: number) { m.visibility = o; }

export const WHITE4 = new Color4(1, 1, 1, 1);

// ---------------------------------------------------------------- instancing

export interface Inst { x: number; y?: number; z: number; ry?: number; rx?: number; s?: number | [number, number, number]; color?: number }

/**
 * Draw `mesh` once per entry with thin instances (one draw call). Colours are sRGB hex and
 * multiply the material colour.
 */
export function instances(mesh: Mesh, list: Inst[], opts: { colors?: boolean } = {}): Mesh {
  const n = Math.max(1, list.length);
  const mats = new Float32Array(n * 16);
  const cols = opts.colors ? new Float32Array(n * 4) : null;
  const q = new Quaternion();
  const sc = new Vector3();
  list.forEach((p, i) => {
    Quaternion.RotationYawPitchRollToRef(p.ry ?? 0, p.rx ?? 0, 0, q);
    const s = p.s ?? 1;
    if (Array.isArray(s)) sc.set(s[0], s[1], s[2]); else sc.setAll(s);
    Matrix.ComposeToRef(sc, q, new Vector3(p.x, p.y ?? 0, p.z), TMP_M);
    TMP_M.copyToArray(mats, i * 16);
    if (cols) {
      const c = lin(p.color ?? 0xffffff);
      cols.set([c.r, c.g, c.b, 1], i * 4);
    }
  });
  if (!list.length) { mesh.setEnabled(false); return mesh; }
  mesh.thinInstanceSetBuffer('matrix', mats, 16, true);
  if (cols) mesh.thinInstanceSetBuffer('color', cols, 4, true);
  mesh.thinInstanceRefreshBoundingInfo();
  return mesh;
}
const TMP_M = new Matrix();
