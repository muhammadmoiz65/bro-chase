// The town around the playable map: Kenney's CC0 low-poly houses, tree lots and
// parked trucks (see client/public/models/LICENSE.md). Loaded asynchronously and
// instanced, so it adds a few draw calls. Nothing here has collision: it all sits
// outside the boundary wall. The south side (towards the camera) keeps tall
// models far back so they never block the view of players.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLOT } from '../../../shared/constants.ts';
import { groundOcclusion } from './ao.ts';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();
const load = (url: string) => {
  let p = cache.get(url);
  if (!p) { p = loader.loadAsync(url).then((g) => g.scene); cache.set(url, p); }
  return p;
};

const BUILDINGS = ['building-small-a', 'building-small-b', 'building-small-c', 'building-small-d', 'building-garage'];
const LOW = ['building-small-a', 'building-small-d', 'building-garage'];
const TREES = ['grass-trees', 'grass-trees-tall'];
const TRUCKS = ['red', 'green', 'yellow', 'purple'];

let seed = 4242;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

interface Place { model: string; x: number; z: number; rot: number; scale: number }

/** The first mesh in a Kenney model (city kit models are a single mesh). */
function firstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => { if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh; });
  return found;
}

function prepMaterial(m: THREE.Material | THREE.Material[]) {
  for (const mm of Array.isArray(m) ? m : [m]) {
    const s = mm as THREE.MeshStandardMaterial;
    if (s.map) { s.map.anisotropy = 4; s.map.colorSpace = THREE.SRGBColorSpace; }
    s.roughness = 0.8;
    s.metalness = 0;
    groundOcclusion(s, 0.4, 1.2);
  }
}

/** Build the town for ring radius R into `group`. `alive()` returns false once the world was rebuilt. */
export async function buildTown(group: THREE.Group, R: number, alive: () => boolean) {
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

  // instanced per model
  const byModel = new Map<string, Place[]>();
  for (const p of places) { if (!byModel.has(p.model)) byModel.set(p.model, []); byModel.get(p.model)!.push(p); }
  const tmp = new THREE.Object3D();
  await Promise.all([...byModel].map(async ([model, list]) => {
    const scene = await load(`/models/city/${model}.glb`);
    if (!alive()) return;
    const mesh = firstMesh(scene);
    if (!mesh) return;
    prepMaterial(mesh.material);
    mesh.updateWorldMatrix(true, false);
    const local = mesh.matrixWorld.clone();
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
    list.forEach((p, i) => {
      tmp.position.set(p.x, 0, p.z);
      tmp.rotation.set(0, p.rot, 0);
      tmp.scale.setScalar(p.scale);
      tmp.updateMatrix();
      im.setMatrixAt(i, tmp.matrix.clone().multiply(local));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  }));

  // parked trucks along the outer road, nose to tail at the kerb
  const trucks = await Promise.all(TRUCKS.map((c) => load(`/models/cars/vehicle-truck-${c}.glb`)));
  if (!alive()) return;
  trucks.forEach((t) => t.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { prepMaterial(m.material); m.castShadow = true; m.receiveShadow = true; } }));
  const kerb = half + 3.6;
  for (let side = 0; side < 4; side++) {
    for (let t = -half + 4; t < half - 4; t += 7) {
      if (rand() < 0.45) continue;
      const truck = trucks[Math.floor(rand() * trucks.length)].clone();
      const along = side === 0 || side === 2;
      const [x, z] = side === 0 ? [t, -kerb] : side === 1 ? [kerb, t] : side === 2 ? [-t, kerb] : [-kerb, -t];
      truck.position.set(x, 0, z);
      truck.rotation.y = (along ? Math.PI / 2 : 0) + (rand() < 0.5 ? Math.PI : 0);
      truck.scale.setScalar(0.95);
      group.add(truck);
    }
  }
}
