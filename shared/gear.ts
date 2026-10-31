// Jump physics shared by the server and the client prediction, so kicks can give extra
// mid-air jumps. A jump is a ballistic arc: launch speed v0 and gravity g are picked so a
// single jump still reaches JUMP.height in JUMP.sec (or the low-gravity values).

import { GEAR, JUMP } from './constants.ts';

export interface JumpState {
  z: number; // height above the ground
  vz: number; // vertical speed
  air: number; // mid-air jumps left
  cd: number; // cooldown after landing
}

export const freshJump = (): JumpState => ({ z: 0, vz: 0, air: 0, cd: 0 });

function arc(lowgrav: boolean) {
  const h = lowgrav ? JUMP.lowGravHeight : JUMP.height;
  const T = lowgrav ? JUMP.lowGravSec : JUMP.sec;
  return { v0: (4 * h) / T, g: (8 * h) / (T * T) };
}

export const airborne = (j: JumpState) => j.z > 0 || j.vz > 0;

/** Try to jump. Returns 'ground', 'air' (a kicks double jump), or null when not allowed. */
export function tryJump(j: JumpState, kicks: number, lowgrav: boolean): 'ground' | 'air' | null {
  const { v0 } = arc(lowgrav);
  if (!airborne(j)) {
    if (j.cd > 0) return null;
    j.vz = v0;
    j.z = 0.001;
    j.air = GEAR.kicks[kicks]?.airJumps ?? 0;
    return 'ground';
  }
  if (j.air <= 0) return null;
  j.air--;
  j.vz = v0 * 0.9;
  return 'air';
}

/** Advance the arc. Returns true on the tick the player lands. */
export function stepJump(j: JumpState, dt: number, lowgrav: boolean, overFence: boolean): boolean {
  j.cd = Math.max(0, j.cd - dt);
  if (!airborne(j)) return false;
  const { g } = arc(lowgrav);
  j.vz -= g * dt;
  j.z += j.vz * dt;
  if (j.z > 0) return false;
  if (overFence) { j.z = 0.02; j.vz = 0; return false; } // keep floating until clear of the fence
  j.z = 0;
  j.vz = 0;
  j.air = 0;
  j.cd = JUMP.cooldown;
  return true;
}

export const kicksSpeed = (kicks: number) => GEAR.kicks[kicks]?.speed ?? 1;
