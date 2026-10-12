// Simulation (LoL units, lane along +x) <-> three.js world (meters-ish, Y up).
// The lane is rotated 45° so blue sits bottom-left and red top-right, like ARAM.
import { MID } from '../sim/map.js';

export const S = 0.01;
const C = Math.SQRT1_2;

export function simToWorld(x, y, out = { x: 0, z: 0 }) {
  const dx = x - MID;
  out.x = S * C * (dx + y);
  out.z = S * C * (-dx + y);
  return out;
}

export function worldToSim(X, Z, out = { x: 0, y: 0 }) {
  const k = 1 / (2 * S * C);
  out.x = MID + (X - Z) * k;
  out.y = (X + Z) * k;
  return out;
}

/** Sim facing angle -> three.js rotation.y for a model whose forward is +Z. */
export function simAngleToYaw(a) {
  const cx = Math.cos(a), sy = Math.sin(a);
  const wx = C * (cx + sy);
  const wz = C * (-cx + sy);
  return Math.atan2(wx, wz);
}

export function simDirToWorld(dx, dy) {
  return { x: C * (dx + dy), z: C * (-dx + dy) };
}
