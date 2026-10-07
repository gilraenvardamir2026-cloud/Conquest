// Deploying a regiment from reserve: it waits just off the table, behind the
// edge line, with its front rank touching the edge and facing in. Either on
// the player's own long edge (centred) or on a side edge (at the end nearest
// the player's own long edge). If the spot is taken it slides along the edge
// to the nearest free place.

import { localToWorld, polygonsOverlap, type Pose } from './geometry';
import { regimentLocalBox, regimentPolygons } from './regiment';
import type { Battle, Regiment } from './types';

export type DeployEdge = 'own' | 'left' | 'right';

/** Search step along the edge when the first spot is taken (inches). */
const STEP = 0.5;

export function deployPose(b: Battle, reg: Regiment, edge: DeployEdge): Pose {
  const { width: W, depth: D } = b.board;
  const box = regimentLocalBox(reg);
  const half = (box.u1 - box.u0) / 2;
  const p1 = reg.owner === 'p1';
  // Facing (clockwise from up), where the front centre goes, and which way to slide along the edge.
  const angle = edge === 'own' ? (p1 ? 0 : 180) : edge === 'left' ? 90 : 270;
  const along = edge === 'own' ? { x: 1, y: 0 } : { x: 0, y: p1 ? -1 : 1 };
  const start = edge === 'own' ? { x: W / 2, y: p1 ? D : 0 } : { x: edge === 'left' ? 0 : W, y: p1 ? D - half : half };
  const length = edge === 'own' ? W : D;

  /** The pose whose front-edge centre sits on point c. */
  const poseAt = (c: { x: number; y: number }): Pose => {
    const off = localToWorld({ x: 0, y: 0, angle }, (box.u0 + box.u1) / 2, box.v0);
    return { x: c.x - off.x, y: c.y - off.y, angle };
  };
  const others = b.regiments.filter((r) => r.id !== reg.id && r.location === 'board' && !r.garrisonId).flatMap(regimentPolygons);
  const free = (pose: Pose) => !regimentPolygons({ ...reg, ...pose }).some((p) => others.some((o) => polygonsOverlap(p, o)));

  // Own edge: try the centre, then alternately right and left of it. Side edges: from the corner inwards.
  const offsets: number[] = [0];
  for (let k = 1; k * STEP <= length; k++) {
    if (edge === 'own') offsets.push(k * STEP, -k * STEP);
    else offsets.push(k * STEP);
  }
  for (const o of offsets) {
    const c = { x: start.x + along.x * o, y: start.y + along.y * o };
    // Keep the whole front along the edge.
    const lo = edge === 'own' ? c.x - half : c.y - half;
    if (lo < -1e-6 || lo + 2 * half > length + 1e-6) continue;
    const pose = poseAt(c);
    if (free(pose)) return pose;
  }
  return poseAt(start);
}
