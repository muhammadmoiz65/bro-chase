// Cheap baked ambient occlusion: darkens surfaces near the ground (so walls,
// pillars, trees and houses look planted instead of floating) and paints soft
// contact shadows on the ground around every crib.

import { CRIB_HALF } from '../../../shared/constants.ts';
import { basic, canvasTexture, groundPlane, type Mesh } from '../bjs/kit.ts';
import { Matrix } from '@babylonjs/core/Maths/math.vector';

export { groundOcclusion, rimLight, rimAll } from '../bjs/kit.ts';

/** One instanced decal per crib: darkens the ground hugging every wall, inside and out. */
export function cribContactShadows(centres: Array<[number, number]>): Mesh {
  const N = 512, tiles = 10, px = N / tiles;
  const tex = canvasTexture(N, N, (ctx) => {
    ctx.clearRect(0, 0, N, N);
    ctx.filter = `blur(${Math.round(px * 0.28)}px)`;
    ctx.fillStyle = '#000';
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
  });
  const mat = basic(0x000000, { opacity: 0.38, depthWrite: false });
  mat.opacityTexture = tex;
  mat.fogEnabled = true;
  const m = groundPlane(10, 10, mat, 0);
  const buf = new Float32Array(Math.max(1, centres.length) * 16);
  centres.forEach(([x, z], i) => Matrix.Translation(x, 0.045, z).copyToArray(buf, i * 16));
  m.thinInstanceSetBuffer('matrix', buf, 16, true);
  m.thinInstanceRefreshBoundingInfo();
  m.alphaIndex = 2;
  return m;
}
