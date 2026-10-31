// The town around the playable map: Kenney's CC0 low-poly houses, tree lots and
// parked trucks (see client/public/models/LICENSE.md). Loaded asynchronously and
// instanced, so it adds a few draw calls. Nothing here has collision: it all sits
// outside the boundary wall. The south side (towards the camera) keeps tall
// models far back so they never block the view of players.

import { PLOT } from '../../../shared/constants.ts';
import { castShadows, context, groundOcclusion, instances, scene, useScene, type Inst, type Node } from '../bjs/kit.ts';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';

const cache = new Map<string, Promise<AssetContainer>>();
// the glTF loader is split into its own chunk: the game can start before it arrives
const loader = () => Promise.all([import('@babylonjs/core/Loading/sceneLoader'), import('@babylonjs/loaders/glTF/2.0')]).then(([m]) => m.LoadAssetContainerAsync);
const load = (url: string) => {
  let p = cache.get(url);
  if (!p) { const sc = scene(); p = loader().then((fn) => fn(url, sc)); cache.set(url, p); }
  return p;
};

const BUILDINGS = ['building-small-a', 'building-small-b', 'building-small-c', 'building-small-d', 'building-garage'];
const LOW = ['building-small-a', 'building-small-d', 'building-garage'];
const TREES = ['grass-trees', 'grass-trees-tall'];
const TRUCKS = ['red', 'green', 'yellow', 'purple'];

let seed = 4242;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

interface Place { model: string; x: number; z: number; rot: number; scale: number }

const prepped = new WeakSet<AssetContainer>();
function prep(c: AssetContainer) {
  if (prepped.has(c)) return;
  prepped.add(c);
  for (const t of c.textures) scene().addTexture(t);
  for (const m of c.materials) {
    scene().addMaterial(m);
    if (!(m instanceof PBRMaterial)) continue;
    m.roughness = 0.8;
    m.metallic = 0;
    m.maxSimultaneousLights = 8;
    if (m.albedoTexture) m.albedoTexture.anisotropicFilteringLevel = 4;
    groundOcclusion(m, 0.4, 1.2);
  }
}

/** A copy of every mesh in a model, flattened into world space, as instancing templates. */
function templates(c: AssetContainer, parent: Node): Mesh[] {
  const out: Mesh[] = [];
  for (const src of c.meshes) {
    if (!(src instanceof Mesh) || !src.getTotalVertices()) continue;
    const m = src.clone(src.name + '-tpl', null, true, false)!;
    m.makeGeometryUnique();
    m.parent = null;
    src.computeWorldMatrix(true);
    m.bakeTransformIntoVertices(src.getWorldMatrix());
    m.position.setAll(0);
    m.rotationQuaternion = null;
    m.rotation.setAll(0);
    m.scaling.setAll(1);
    m.parent = parent;
    out.push(m);
  }
  return out;
}

/** Build the town for ring radius R under `parent`. `alive()` returns false once the world was rebuilt. */
export async function buildTown(parent: Node, R: number, alive: () => boolean) {
  seed = 4242;
  const half = ((2 * R + 1) * PLOT) / 2;
  const places: Place[] = [];
  const S = 5.5; // city kit tiles are 1 unit; one building lot = 5.5 tiles
  // four sides; side 0 = north (-z), 1 = east, 2 = south (+z, camera side), 3 = west
  for (let side = 0; side < 4; side++) {
    const south = side === 2;
    const d = half + (south ? 13 : 5) + S / 2;
    const inward = [0, -Math.PI / 2, Math.PI, Math.PI / 2][side];
    for (let t = -half - S; t <= half + S; t += S + 0.6) {
      const r = rand();
      const model = r < 0.22
        ? TREES[Math.floor(rand() * TREES.length)]
        : (south ? LOW : BUILDINGS)[Math.floor(rand() * (south ? LOW.length : BUILDINGS.length))];
      const [x, z] = side === 0 ? [t, -d] : side === 1 ? [d, t] : side === 2 ? [-t, d] : [-d, -t];
      places.push({ model, x, z, rot: inward, scale: S });
      // a second, deeper row of tree lots
      const d2 = d + S + 1;
      const [x2, z2] = side === 0 ? [t, -d2] : side === 1 ? [d2, t] : side === 2 ? [-t, d2] : [-d2, -t];
      places.push({ model: TREES[Math.floor(rand() * 2)], x: x2, z: z2, rot: Math.floor(rand() * 4) * (Math.PI / 2), scale: S });
    }
  }
  // corner lots: trees
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const d = half + 5 + S / 2 + (sz > 0 ? 8 : 0);
    places.push({ model: 'grass-trees-tall', x: sx * (half + 5 + S / 2), z: sz * d, rot: 0, scale: S });
  }
  // parked trucks along the outer road, nose to tail at the kerb
  const trucks: Place[] = [];
  const kerb = half + 3.6;
  for (let side = 0; side < 4; side++) {
    for (let t = -half + 4; t < half - 4; t += 7) {
      if (rand() < 0.45) continue;
      const colour = TRUCKS[Math.floor(rand() * TRUCKS.length)];
      const along = side === 0 || side === 2;
      const [x, z] = side === 0 ? [t, -kerb] : side === 1 ? [kerb, t] : side === 2 ? [-t, kerb] : [-kerb, -t];
      trucks.push({ model: colour, x, z, rot: (along ? Math.PI / 2 : 0) + (rand() < 0.5 ? Math.PI : 0), scale: 0.95 });
    }
  }

  const group = (list: Place[]) => {
    const by = new Map<string, Place[]>();
    for (const p of list) { if (!by.has(p.model)) by.set(p.model, []); by.get(p.model)!.push(p); }
    return by;
  };
  const ctx = context();
  const place = async (url: string, list: Place[]) => {
    const c = await load(url);
    if (!alive()) return;
    useScene(ctx.scene, ctx.shadows); // another scene (the creator preview) may have been current meanwhile
    prep(c);
    const inst: Inst[] = list.map((p) => ({ x: p.x, z: p.z, ry: p.rot, s: p.scale }));
    for (const t of templates(c, parent)) {
      instances(t, inst);
      t.receiveShadows = true;
      castShadows(t);
    }
  };
  await Promise.all([
    ...[...group(places)].map(([model, list]) => place(`/models/city/${model}.glb`, list)),
    ...[...group(trucks)].map(([colour, list]) => place(`/models/cars/vehicle-truck-${colour}.glb`, list)),
  ]);
}
