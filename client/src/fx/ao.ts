// Cheap baked ambient occlusion: darkens surfaces near the ground (so walls,
// pillars, trees and houses look planted instead of floating) and paints soft
// contact shadows on the ground around every crib.

import * as THREE from 'three';
import { CRIB_HALF } from '../../../shared/constants.ts';

/** Patch a standard material so it darkens towards y = 0 (world space). Works with InstancedMesh. */
export function groundOcclusion<T extends THREE.Material>(mat: T, strength = 0.45, height = 0.8): T {
  const m = mat as unknown as THREE.MeshStandardMaterial;
  if (m.userData.groundAO) return mat; // already patched (shared materials)
  m.userData.groundAO = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.aoStrength = { value: strength };
    shader.uniforms.aoHeight = { value: height };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vAoY;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 aoWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          aoWorld = instanceMatrix * aoWorld;
        #endif
        vAoY = (modelMatrix * aoWorld).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAoY;\nuniform float aoStrength;\nuniform float aoHeight;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 1.0 - aoStrength * (1.0 - smoothstep(0.0, aoHeight, vAoY));`);
  };
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}-groundAO-${strength}-${height}`;
  m.needsUpdate = true;
  return mat;
}

let cribAoTex: THREE.CanvasTexture | null = null;

/** Soft contact shadow texture for one crib footprint (10 x 10 tiles, centred on the crib). */
function cribAoTexture(): THREE.CanvasTexture {
  if (cribAoTex) return cribAoTex;
  const N = 512, tiles = 10, px = N / tiles;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, N, N);
  ctx.filter = `blur(${Math.round(px * 0.28)}px)`;
  ctx.fillStyle = '#fff';
  const toPx = (t: number) => (t + tiles / 2) * px;
  for (let ly = -CRIB_HALF; ly < CRIB_HALF; ly++) {
    for (let lx = -CRIB_HALF; lx < CRIB_HALF; lx++) {
      const edgeX = lx === -CRIB_HALF || lx === CRIB_HALF - 1;
      const edgeY = ly === -CRIB_HALF || ly === CRIB_HALF - 1;
      if (!edgeX && !edgeY) continue;
      if (edgeY && !edgeX && (lx === -1 || lx === 0)) continue; // door gaps
      const g = 0.32;
      ctx.fillRect(toPx(lx - g), toPx(ly - g), px * (1 + 2 * g), px * (1 + 2 * g));
    }
  }
  ctx.filter = 'none';
  const t = new THREE.CanvasTexture(c);
  cribAoTex = t;
  return t;
}

/** One instanced decal per crib: darkens the ground hugging every wall, inside and out. */
export function cribContactShadows(centres: Array<[number, number]>): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(10, 10);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: cribAoTexture(), transparent: true, opacity: 0.38, depthWrite: false });
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, centres.length));
  m.count = centres.length;
  const tmp = new THREE.Object3D();
  centres.forEach(([x, z], i) => { tmp.position.set(x, 0.045, z); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); });
  m.renderOrder = 2;
  return m;
}

/** Fresnel rim light so characters pop off the ground. Chains with other patches. */
export function rimLight<T extends THREE.Material>(mat: T, color: number, strength = 0.6, power = 2.5): T {
  const m = mat as unknown as THREE.MeshStandardMaterial;
  if (!(m as THREE.Material & { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial || m.userData.rim) return mat;
  m.userData.rim = true;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.rimColor = { value: new THREE.Color(color).multiplyScalar(strength) };
    shader.uniforms.rimPower = { value: power };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nuniform float rimPower;')
      .replace('#include <opaque_fragment>', `outgoingLight += rimColor * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), rimPower);
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}-rim-${color}-${strength}-${power}`;
  m.needsUpdate = true;
  return mat;
}

/** Apply rim light to every standard material under an object. */
export function rimAll(root: THREE.Object3D, color: number, strength = 0.6, power = 2.5) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const mm of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) rimLight(mm, color, strength, power);
  });
}
