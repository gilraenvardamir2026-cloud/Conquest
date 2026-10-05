// Movement geometry: move segments (forward, sideways, wheel, rotate, free,
// align), path sampling, Align-to-target and contact detection.
//
// A moving piece is described by its pose (front-left corner of the regiment's
// slot grid, see regiment.ts) and a PieceBox: the local extent of its occupied
// slots. The front edge runs from (u0, 0) to (u1, 0) in local coordinates and
// the piece is `d` deep. Everything here is pure and works in inches/degrees.

import {
  add,
  cross,
  degToRad,
  dist,
  dot,
  EPS,
  facingVec,
  fmtIn,
  len,
  localToWorld,
  mul,
  normAngle,
  normalize,
  pointSegmentDistance,
  polygonDistance,
  radToDeg,
  rightVec,
  rotateAbout,
  sub,
  wheelDistance,
  type Frame,
  type Polygon,
  type Pose,
  type Vec,
} from './geometry';
import { CONTACT_TOLERANCE } from './board';
import { regimentLocalBox } from './regiment';
import type { Character, Regiment } from './types';

export interface PieceBox {
  u0: number;
  u1: number;
  d: number;
}

export function regimentBox(reg: Regiment): PieceBox {
  const b = regimentLocalBox(reg);
  return { u0: b.u0, u1: b.u1, d: b.v1 };
}

export const characterBox = (c: Character): PieceBox => ({ u0: 0, u1: c.standW, d: c.standD });

export const frontWidth = (box: PieceBox): number => box.u1 - box.u0;

/** Frame corners in world space: front-left, front-right, rear-right, rear-left. */
export function boxCorners(pose: Pose, box: PieceBox): Polygon {
  return [localToWorld(pose, box.u0, 0), localToWorld(pose, box.u1, 0), localToWorld(pose, box.u1, box.d), localToWorld(pose, box.u0, box.d)];
}

export const frontCentre = (pose: Pose, box: PieceBox): Vec => localToWorld(pose, (box.u0 + box.u1) / 2, 0);
export const boxCentre = (pose: Pose, box: PieceBox): Vec => localToWorld(pose, (box.u0 + box.u1) / 2, box.d / 2);

/** The piece's bounding frame as used by facing arcs. */
export function boxFrame(pose: Pose, box: PieceBox): Frame {
  const o = localToWorld(pose, box.u0, 0);
  return { x: o.x, y: o.y, angle: pose.angle, w: frontWidth(box), d: box.d };
}

/** Move along the piece's own axes: du to its right, dv towards its rear. */
export function translateLocal(pose: Pose, du: number, dv: number): Pose {
  const o = localToWorld(pose, du, dv);
  return { x: o.x, y: o.y, angle: pose.angle };
}

/** Rotate a pose (its origin and facing) about a world point; positive = clockwise on screen. */
export function rotatePoseAbout(pose: Pose, c: Vec, angleDeg: number): Pose {
  const o = rotateAbout({ x: pose.x, y: pose.y }, c, angleDeg);
  return { x: o.x, y: o.y, angle: normAngle(pose.angle + angleDeg) };
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export type SegmentKind = 'forward' | 'sideways' | 'wheel' | 'rotate' | 'free' | 'align';

export interface MoveSegment {
  kind: SegmentKind;
  from: Pose;
  to: Pose;
  /** Inches counted towards the move total (0 for a rotation about the centre). */
  distance: number;
  /**
   * Signed amount: forward + / backward − (inches); sideways right + / left −
   * (inches); wheel and rotate in degrees, + = clockwise (to the right).
   */
  value: number;
  /** Wheel: the fixed front corner. Rotate: the centre. */
  pivot?: Vec;
  /** Wheel whose moving corner travelled backward. */
  backward?: boolean;
  /** Lower-case read-out, e.g. `wheel R 2.4"`. */
  label: string;
}

// Poses keep full float precision; only read-outs are rounded (to 0.1").
const roundPose = (p: Pose): Pose => ({ x: p.x, y: p.y, angle: normAngle(p.angle) });

export function forwardSegment(from: Pose, d: number): MoveSegment {
  return {
    kind: 'forward',
    from,
    to: roundPose(translateLocal(from, 0, -d)),
    distance: Math.abs(d),
    value: d,
    label: `${d >= 0 ? 'forward' : 'backward'} ${fmtIn(Math.abs(d))}`,
  };
}

export function sidewaysSegment(from: Pose, d: number): MoveSegment {
  return {
    kind: 'sideways',
    from,
    to: roundPose(translateLocal(from, d, 0)),
    distance: Math.abs(d),
    value: d,
    label: `sideways ${d >= 0 ? 'R' : 'L'} ${fmtIn(Math.abs(d))}`,
  };
}

/**
 * Wheel about a front corner. `pivot` names the corner that stays put; the
 * other front corner travels an arc of |angle| × front width. Turning towards
 * the pivot side moves the free corner forward: a left wheel pivots on the
 * left corner and turns anticlockwise (negative angle).
 */
export function wheelSegment(from: Pose, box: PieceBox, angleDeg: number, pivot: 'left' | 'right'): MoveSegment {
  const p = localToWorld(from, pivot === 'left' ? box.u0 : box.u1, 0);
  const backward = (pivot === 'left' && angleDeg > 0) || (pivot === 'right' && angleDeg < 0);
  const distance = wheelDistance(angleDeg, frontWidth(box));
  const turn = angleDeg < 0 ? 'L' : 'R';
  return {
    kind: 'wheel',
    from,
    to: roundPose(rotatePoseAbout(from, p, angleDeg)),
    distance,
    value: angleDeg,
    pivot: p,
    ...(backward ? { backward } : {}),
    label: `wheel ${turn} ${fmtIn(distance)}${backward ? ' (backward)' : ''}`,
  };
}

/** Wheel given as the distance the moving corner travels. Left = pivot on the left corner. */
export function wheelByDistance(from: Pose, box: PieceBox, inches: number, dir: 'left' | 'right'): MoveSegment {
  const angle = radToDeg(inches / Math.max(EPS, frontWidth(box)));
  return wheelSegment(from, box, dir === 'left' ? -angle : angle, dir);
}

export function rotateSegment(from: Pose, box: PieceBox, angleDeg: number): MoveSegment {
  const c = boxCentre(from, box);
  const a = Math.max(-180, Math.min(180, angleDeg));
  return {
    kind: 'rotate',
    from,
    to: roundPose(rotatePoseAbout(from, c, a)),
    distance: 0,
    value: a,
    pivot: c,
    label: `rotate ${Math.abs(Math.round(a * 10) / 10)}° ${a < 0 ? 'L' : 'R'}`,
  };
}

/** Largest displacement of any frame corner between two poses. */
export function maxCornerDisplacement(a: Pose, b: Pose, box: PieceBox): number {
  const A = boxCorners(a, box);
  const B = boxCorners(b, box);
  return Math.max(...A.map((p, i) => dist(p, B[i])));
}

export function freeSegment(from: Pose, to: Pose, box: PieceBox): MoveSegment {
  const d = maxCornerDisplacement(from, to, box);
  return { kind: 'free', from, to: roundPose(to), distance: d, value: d, label: `free ${fmtIn(d)}` };
}

export function alignSegment(from: Pose, to: Pose, box: PieceBox, target: string): MoveSegment {
  const d = dist(frontCentre(from, box), frontCentre(to, box));
  return { kind: 'align', from, to: roundPose(to), distance: d, value: d, label: `align to ${target} ${fmtIn(d)}` };
}

export const segmentsTotal = (segs: MoveSegment[]): number => segs.reduce((a, s) => a + s.distance, 0);

/** Log summary, e.g. `forward 6.0", wheel R 1.2" (total 7.2")`. */
export function describeMove(segs: MoveSegment[]): string {
  if (!segs.length) return 'did not move';
  const body = segs.map((s) => s.label).join(', ');
  return segs.length > 1 ? `${body} (total ${fmtIn(segmentsTotal(segs))})` : body;
}

/**
 * Merge a new segment into the previous one when both are straight moves of the
 * same kind or turns about the same point (used by keyboard nudges).
 */
export function mergeSegments(prev: MoveSegment, next: MoveSegment, box: PieceBox): MoveSegment | null {
  if (prev.kind !== next.kind) return null;
  if (prev.kind === 'forward') return forwardSegment(prev.from, prev.value + next.value);
  if (prev.kind === 'sideways') return sidewaysSegment(prev.from, prev.value + next.value);
  if (prev.kind === 'rotate') return rotateSegment(prev.from, box, prev.value + next.value);
  return null;
}

/** Signed angle (degrees, + = clockwise) that turns direction a→p0 onto a→p1. */
export function dragAngle(centre: Vec, p0: Vec, p1: Vec): number {
  const v0 = sub(p0, centre);
  const v1 = sub(p1, centre);
  return radToDeg(Math.atan2(cross(v0, v1), dot(v0, v1)));
}

/**
 * Poses along a segment's path, every `step` inches or so (end points
 * included), for checks such as crossing Impassable terrain.
 */
export function sweepPoses(seg: MoveSegment, box: PieceBox, step = 0.25): Pose[] {
  let length: number;
  if (seg.kind === 'wheel' || seg.kind === 'rotate') {
    const reach = Math.max(...boxCorners(seg.from, box).map((c) => dist(c, seg.pivot!)));
    length = Math.abs(degToRad(seg.value)) * reach;
  } else {
    length = maxCornerDisplacement(seg.from, seg.to, box);
  }
  const n = Math.max(1, Math.ceil(length / step));
  const out: Pose[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (seg.kind === 'wheel' || seg.kind === 'rotate') out.push(rotatePoseAbout(seg.from, seg.pivot!, seg.value * t));
    else {
      const da = normAngle(seg.to.angle - seg.from.angle);
      out.push({ x: seg.from.x + (seg.to.x - seg.from.x) * t, y: seg.from.y + (seg.to.y - seg.from.y) * t, angle: seg.from.angle + da * t });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Align to target
// ---------------------------------------------------------------------------

export type Facing = 'front' | 'left' | 'right' | 'rear';
export const FACINGS: Facing[] = ['front', 'left', 'right', 'rear'];

/** A facing of a frame: edge from a to b and its outward normal. */
export function facingEdge(f: Frame, facing: Facing): { a: Vec; b: Vec; normal: Vec } {
  const fw = facingVec(f.angle);
  const rt = rightVec(f.angle);
  const P = (u: number, v: number) => localToWorld(f, u, v);
  switch (facing) {
    case 'front':
      return { a: P(0, 0), b: P(f.w, 0), normal: fw };
    case 'rear':
      return { a: P(f.w, f.d), b: P(0, f.d), normal: mul(fw, -1) };
    case 'left':
      return { a: P(0, f.d), b: P(0, 0), normal: mul(rt, -1) };
    case 'right':
      return { a: P(f.w, 0), b: P(f.w, f.d), normal: rt };
  }
}

/** Facing of the frame whose edge is nearest to point p. */
export function nearestFacing(f: Frame, p: Vec): Facing {
  let best: Facing = 'front';
  let bd = Infinity;
  for (const k of FACINGS) {
    const e = facingEdge(f, k);
    const d = pointSegmentDistance(p, e.a, e.b);
    if (d < bd - 1e-9) {
      bd = d;
      best = k;
    }
  }
  return best;
}

/** Angle (degrees) whose facing vector is `dir`. */
export const angleOfFacing = (dir: Vec): number => normAngle(radToDeg(Math.atan2(dir.x, -dir.y)));

export type AlignMode = 'contact' | 'centre';

/**
 * Pose that puts the moving piece's front edge flush against a facing of the
 * target frame, facing into it.
 *  - 'contact' (default): the most contact the two edges allow (the smaller
 *    edge fully against the larger), at the lateral position closest to where
 *    the piece's front centre is now;
 *  - 'centre': centred on the facing.
 * `travel` is how far the moving front centre goes.
 */
export function alignToFacing(pose: Pose, box: PieceBox, target: Frame, facing: Facing, mode: AlignMode = 'contact'): { pose: Pose; travel: number } {
  const { a, b, normal } = facingEdge(target, facing);
  const angle = angleOfFacing(mul(normal, -1));
  const right = rightVec(angle);
  const W = frontWidth(box);
  const sB = dot(sub(b, a), right);
  const lo = Math.min(0, sB);
  const hi = Math.max(0, sB);
  const fc = frontCentre(pose, box);
  let c: number;
  if (mode === 'centre') c = (lo + hi) / 2;
  else {
    const m1 = lo + W / 2;
    const m2 = hi - W / 2;
    const cur = dot(sub(fc, a), right);
    c = Math.max(Math.min(m1, m2), Math.min(Math.max(m1, m2), cur));
  }
  const newFc = add(a, mul(right, c));
  // Pose origin = front centre − right·(u0 + W/2).
  const o = sub(newFc, mul(right, box.u0 + W / 2));
  const np = roundPose({ x: o.x, y: o.y, angle });
  return { pose: np, travel: dist(fc, frontCentre(np, box)) };
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

/**
 * Where two polygons touch: shared edge stretches (as segments) or, for
 * corner contact, a single point (a === b). Empty when they are further apart than tol.
 */
export function touchingParts(A: Polygon, B: Polygon, tol = CONTACT_TOLERANCE): { a: Vec; b: Vec }[] {
  const closest = polygonDistance(A, B);
  if (closest.distance > tol) return [];
  const out: { a: Vec; b: Vec }[] = [];
  for (let i = 0; i < A.length; i++) {
    const p = A[i];
    const q = A[(i + 1) % A.length];
    const e = sub(q, p);
    const el = len(e);
    if (el < EPS) continue;
    const eu = normalize(e);
    for (let j = 0; j < B.length; j++) {
      const r = B[j];
      const s = B[(j + 1) % B.length];
      const f = sub(s, r);
      if (len(f) < EPS) continue;
      if (Math.abs(cross(eu, normalize(f))) > 1e-3) continue; // not parallel
      if (Math.abs(cross(eu, sub(r, p))) > tol) continue; // not on the same line
      const t0 = dot(sub(r, p), eu);
      const t1 = dot(sub(s, p), eu);
      const lo = Math.max(0, Math.min(t0, t1));
      const hi = Math.min(el, Math.max(t0, t1));
      if (hi - lo > tol) out.push({ a: add(p, mul(eu, lo)), b: add(p, mul(eu, hi)) });
    }
  }
  if (!out.length) {
    const m = mul(add(closest.a, closest.b), 0.5);
    out.push({ a: m, b: m });
  }
  return out;
}
