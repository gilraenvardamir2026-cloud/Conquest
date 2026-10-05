// Pure 2D geometry, no DOM. All lengths in inches, angles in degrees.
//
// Board frame: origin top-left, x to the right, y DOWN. Because y points down,
// a positive angle turns clockwise on screen, which matches SVG's rotate().
//
// Regiment-local frame (used for stands, arcs, movement):
//   u = along the front edge, to the regiment's right
//   v = towards the regiment's rear
// A local point (u, v) maps to world as origin + u·right + v·back, which is
// exactly SVG `translate(x y) rotate(angle)` applied to (u, v).

export const EPS = 0.001;
export const MM_PER_INCH = 25.4;

export interface Vec {
  x: number;
  y: number;
}
export type Polygon = Vec[];

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const normalize = (a: Vec): Vec => {
  const l = len(a);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

export const degToRad = (d: number): number => (d * Math.PI) / 180;
export const radToDeg = (r: number): number => (r * 180) / Math.PI;
export const mmToIn = (mm: number): number => mm / MM_PER_INCH;
export const inToMm = (inch: number): number => inch * MM_PER_INCH;

/** Normalise an angle to (-180, 180]. */
export function normAngle(deg: number): number {
  let a = deg % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  return a;
}

/** Round to 0.1 for display. */
export const fmtIn = (n: number): string => `${(Math.round(n * 10) / 10).toFixed(1)}"`;

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/** Unit vector the piece faces (angle 0 = up the board, i.e. -y). */
export const facingVec = (angle: number): Vec => {
  const r = degToRad(angle);
  return { x: Math.sin(r), y: -Math.cos(r) };
};
/** Unit vector to the piece's right along its front edge. */
export const rightVec = (angle: number): Vec => {
  const r = degToRad(angle);
  return { x: Math.cos(r), y: Math.sin(r) };
};

export interface Pose {
  x: number;
  y: number;
  angle: number;
}

/** Regiment-local (u right, v back) → world. */
export function localToWorld(pose: Pose, u: number, v: number): Vec {
  const r = degToRad(pose.angle);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: pose.x + u * c - v * s, y: pose.y + u * s + v * c };
}

/** World → regiment-local (u right, v back). */
export function worldToLocal(pose: Pose, p: Vec): { u: number; v: number } {
  const r = degToRad(pose.angle);
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p.x - pose.x;
  const dy = p.y - pose.y;
  return { u: dx * c + dy * s, v: -dx * s + dy * c };
}

/**
 * Corners of a rotated rectangle whose FRONT-LEFT corner is at (x, y).
 * Order: front-left, front-right, rear-right, rear-left.
 */
export function rectCorners(x: number, y: number, w: number, d: number, angle: number): Polygon {
  const pose = { x, y, angle };
  return [localToWorld(pose, 0, 0), localToWorld(pose, w, 0), localToWorld(pose, w, d), localToWorld(pose, 0, d)];
}

/** Corners of a rotated rectangle centred at (cx, cy). Same corner order as rectCorners. */
export function centeredRectCorners(cx: number, cy: number, w: number, d: number, angle: number): Polygon {
  const pose = { x: cx, y: cy, angle };
  return [
    localToWorld(pose, -w / 2, -d / 2),
    localToWorld(pose, w / 2, -d / 2),
    localToWorld(pose, w / 2, d / 2),
    localToWorld(pose, -w / 2, d / 2),
  ];
}

/** Ellipse approximated as an n-gon (64 by default), rotated by angle about its centre. */
export function ellipsePolygon(cx: number, cy: number, rx: number, ry: number, angle = 0, n = 64): Polygon {
  const pose = { x: cx, y: cy, angle };
  const pts: Polygon = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    pts.push(localToWorld(pose, rx * Math.cos(t), ry * Math.sin(t)));
  }
  return pts;
}

/** Polygon given relative to a centre, rotated by angle and placed at (cx, cy). */
export function placePolygon(points: [number, number][], cx: number, cy: number, angle: number): Polygon {
  const pose = { x: cx, y: cy, angle };
  return points.map(([u, v]) => localToWorld(pose, u, v));
}

// ---------------------------------------------------------------------------
// Polygon basics
// ---------------------------------------------------------------------------

/** Shoelace signed area. Positive = counter-clockwise in a y-up frame (clockwise on screen). */
export function signedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function centroid(poly: Polygon): Vec {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-12) {
    const s = poly.reduce((acc, p) => add(acc, p), vec(0, 0));
    return mul(s, 1 / Math.max(1, poly.length));
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bounds(poly: Polygon): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function isConvex(poly: Polygon): boolean {
  if (poly.length < 4) return true;
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = poly[(i + 2) % poly.length];
    const z = cross(sub(b, a), sub(c, b));
    if (Math.abs(z) < 1e-12) continue;
    const s = Math.sign(z);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Points and segments
// ---------------------------------------------------------------------------

/** Closest point on segment ab to p. */
export function closestPointOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-18) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

export function pointSegmentDistance(p: Vec, a: Vec, b: Vec): number {
  return dist(p, closestPointOnSegment(p, a, b));
}

export interface SegmentHit {
  /** Parameter along the first segment, 0..1. */
  t: number;
  point: Vec;
}

/**
 * Intersection of segments ab and cd, including touching end points (within eps).
 * Collinear overlapping segments report the first overlapping point.
 */
export function segmentIntersection(a: Vec, b: Vec, c: Vec, d: Vec, eps = EPS): SegmentHit | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const denom = cross(r, s);
  const ca = sub(c, a);
  const rl = len(r);
  const sl = len(s);
  if (Math.abs(denom) < 1e-12) {
    // Parallel. Collinear if c lies on the line ab.
    if (rl < 1e-12) return pointSegmentDistance(a, c, d) <= eps ? { t: 0, point: a } : null;
    if (Math.abs(cross(ca, r)) / rl > eps) return null;
    const t0 = dot(ca, r) / (rl * rl);
    const t1 = dot(sub(d, a), r) / (rl * rl);
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(1, Math.max(t0, t1));
    const tol = eps / rl;
    if (lo > hi + tol) return null;
    const t = Math.max(0, Math.min(1, lo));
    return { t, point: lerp(a, b, t) };
  }
  const t = cross(ca, s) / denom;
  const u = cross(ca, r) / denom;
  const tt = rl > 0 ? eps / rl : 0;
  const tu = sl > 0 ? eps / sl : 0;
  if (t < -tt || t > 1 + tt || u < -tu || u > 1 + tu) return null;
  const tc = Math.max(0, Math.min(1, t));
  return { t: tc, point: lerp(a, b, tc) };
}

export const segmentsIntersect = (a: Vec, b: Vec, c: Vec, d: Vec, eps = EPS): boolean =>
  segmentIntersection(a, b, c, d, eps) !== null;

/** Closest points between segments ab and cd. */
export function segmentSegmentClosest(a: Vec, b: Vec, c: Vec, d: Vec): { distance: number; pa: Vec; pb: Vec } {
  const hit = segmentIntersection(a, b, c, d, 0);
  if (hit) return { distance: 0, pa: hit.point, pb: hit.point };
  // For non-intersecting segments the minimum lies at an end point of one of them.
  const cands: { distance: number; pa: Vec; pb: Vec }[] = [];
  let q = closestPointOnSegment(a, c, d);
  cands.push({ distance: dist(a, q), pa: a, pb: q });
  q = closestPointOnSegment(b, c, d);
  cands.push({ distance: dist(b, q), pa: b, pb: q });
  q = closestPointOnSegment(c, a, b);
  cands.push({ distance: dist(c, q), pa: q, pb: c });
  q = closestPointOnSegment(d, a, b);
  cands.push({ distance: dist(d, q), pa: q, pb: d });
  return cands.reduce((m, x) => (x.distance < m.distance ? x : m));
}

/** Distance from p to the polygon's boundary. */
export function pointBoundaryDistance(p: Vec, poly: Polygon): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    m = Math.min(m, pointSegmentDistance(p, poly[i], poly[(i + 1) % poly.length]));
  }
  return m;
}

/**
 * Point in polygon (ray casting, even-odd). Points within eps of the boundary
 * count as inside unless `strict` is set, in which case they count as outside.
 */
export function pointInPolygon(p: Vec, poly: Polygon, strict = false, eps = EPS): boolean {
  if (pointBoundaryDistance(p, poly) <= eps) return !strict;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y) {
      const xCross = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (p.x < xCross) inside = !inside;
    }
  }
  return inside;
}

/** Distance from p to a polygon (0 when inside). */
export function pointPolygonDistance(p: Vec, poly: Polygon): number {
  return pointInPolygon(p, poly) ? 0 : pointBoundaryDistance(p, poly);
}

// ---------------------------------------------------------------------------
// Polygon vs polygon
// ---------------------------------------------------------------------------

export interface ClosestResult {
  distance: number;
  /** Closest point on the first shape. */
  a: Vec;
  /** Closest point on the second shape. */
  b: Vec;
}

/** True when boundaries cross or touch, or one polygon contains the other. */
export function polygonsTouchOrIntersect(A: Polygon, B: Polygon, eps = EPS): boolean {
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i];
    const a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      if (segmentsIntersect(a1, a2, B[j], B[(j + 1) % B.length], eps)) return true;
    }
  }
  return pointInPolygon(A[0], B) || pointInPolygon(B[0], A);
}

/**
 * Minimum distance between two polygons (convex or concave), measured
 * boundary to boundary. 0 when they touch, overlap, or one contains the other.
 */
export function polygonDistance(A: Polygon, B: Polygon): ClosestResult {
  if (pointInPolygon(A[0], B)) return { distance: 0, a: A[0], b: A[0] };
  if (pointInPolygon(B[0], A)) return { distance: 0, a: B[0], b: B[0] };
  let best: ClosestResult = { distance: Infinity, a: A[0], b: B[0] };
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i];
    const a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const r = segmentSegmentClosest(a1, a2, B[j], B[(j + 1) % B.length]);
      if (r.distance < best.distance) {
        best = { distance: r.distance, a: r.pa, b: r.pb };
        if (r.distance === 0) return best;
      }
    }
  }
  return best;
}

/** Closest pair between two sets of polygons (e.g. the stands of two regiments). */
export function polygonSetDistance(As: Polygon[], Bs: Polygon[]): ClosestResult & { ia: number; ib: number } {
  let best = { distance: Infinity, a: vec(0, 0), b: vec(0, 0), ia: -1, ib: -1 };
  As.forEach((A, ia) =>
    Bs.forEach((B, ib) => {
      const r = polygonDistance(A, B);
      if (r.distance < best.distance) best = { ...r, ia, ib };
    }),
  );
  return best;
}

/**
 * Separating-axis penetration depth for two CONVEX polygons:
 * > 0 = interiors overlap by that much along the best axis, ≤ 0 = separated or touching.
 */
export function convexOverlapDepth(A: Polygon, B: Polygon): number {
  let depth = Infinity;
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const e = sub(P[(i + 1) % P.length], P[i]);
      const axis = normalize({ x: -e.y, y: e.x });
      if (axis.x === 0 && axis.y === 0) continue;
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const p of A) {
        const k = dot(p, axis);
        minA = Math.min(minA, k);
        maxA = Math.max(maxA, k);
      }
      for (const p of B) {
        const k = dot(p, axis);
        minB = Math.min(minB, k);
        maxB = Math.max(maxB, k);
      }
      const o = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (o < depth) depth = o;
      if (depth <= 0) return depth;
    }
  }
  return depth;
}

/**
 * Ear-clipping triangulation for a simple polygon (convex or concave).
 * Returns triangles in the input's orientation.
 */
export function triangulate(poly: Polygon): Polygon[] {
  const n = poly.length;
  if (n < 3) return [];
  if (n === 3) return [poly.slice()];
  const ccw = signedArea(poly) > 0;
  const idx = poly.map((_, i) => i);
  const tris: Polygon[] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length];
      const i1 = idx[k];
      const i2 = idx[(k + 1) % idx.length];
      const a = poly[i0];
      const b = poly[i1];
      const c = poly[i2];
      const z = cross(sub(b, a), sub(c, b));
      if ((ccw && z <= 1e-12) || (!ccw && z >= -1e-12)) continue; // reflex or degenerate
      const tri = [a, b, c];
      let containsOther = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInPolygon(poly[j], tri, true, 1e-9)) {
          containsOther = true;
          break;
        }
      }
      if (containsOther) continue;
      tris.push(tri);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate input: fall back to a fan below
  }
  if (idx.length === 3) tris.push(idx.map((i) => poly[i]));
  else if (idx.length > 3) for (let k = 1; k < idx.length - 1; k++) tris.push([poly[idx[0]], poly[idx[k]], poly[idx[k + 1]]]);
  return tris;
}

/** Split into convex pieces: the polygon itself if convex, else its triangles. */
export function convexPieces(poly: Polygon): Polygon[] {
  return isConvex(poly) ? [poly] : triangulate(poly);
}

/**
 * True when the INTERIORS of two polygons overlap by more than eps.
 * Touching edges or corners is not an overlap. Convex shapes use the
 * separating-axis test directly; concave ones are split into convex pieces.
 */
export function polygonsOverlap(A: Polygon, B: Polygon, eps = EPS): boolean {
  const pa = convexPieces(A);
  const pb = convexPieces(B);
  for (const a of pa) for (const b of pb) if (convexOverlapDepth(a, b) > eps) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Circles
// ---------------------------------------------------------------------------

/** Gap between a polygon and a circle (0 when they touch or overlap). */
export function polygonCircleDistance(poly: Polygon, c: Vec, r: number): number {
  return Math.max(0, pointPolygonDistance(c, poly) - r);
}

/** True when a polygon reaches inside a circle by more than eps. */
export function polygonOverlapsCircle(poly: Polygon, c: Vec, r: number, eps = EPS): boolean {
  return pointPolygonDistance(c, poly) < r - eps;
}

// ---------------------------------------------------------------------------
// Offset outlines (range rings)
// ---------------------------------------------------------------------------

/**
 * Outward offset of a CONVEX polygon by r: straight edges pushed out by r,
 * joined by circular arcs around each vertex (a rounded outline). This is the
 * set of points exactly r from the polygon, which is how ranges are measured.
 * `arcSteps` points are used per quarter turn of arc.
 */
export function offsetConvexPolygon(poly: Polygon, r: number, arcSteps = 8): Polygon {
  const n = poly.length;
  if (n === 0) return [];
  const s = signedArea(poly) >= 0 ? 1 : -1;
  // Outward normal of edge a→b. For positive signed area that is (dy, -dx).
  const normalOf = (a: Vec, b: Vec): Vec => {
    const e = normalize(sub(b, a));
    return { x: s * e.y, y: -s * e.x };
  };
  const out: Polygon = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const n1 = normalOf(prev, cur);
    const n2 = normalOf(cur, next);
    const a1 = Math.atan2(n1.y, n1.x);
    let delta = Math.atan2(cross(n1, n2), dot(n1, n2));
    if (s * delta < 0) delta = 0; // reflex vertex (should not happen for convex input)
    const steps = Math.max(1, Math.ceil((Math.abs(delta) / (Math.PI / 2)) * arcSteps));
    for (let k = 0; k <= steps; k++) {
      const t = a1 + (delta * k) / steps;
      out.push({ x: cur.x + r * Math.cos(t), y: cur.y + r * Math.sin(t) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Movement helpers
// ---------------------------------------------------------------------------

/**
 * Distance of a wheel: the moving front corner travels an arc around the
 * pivot corner, so distance = |angle in radians| × front-rank width.
 */
export function wheelDistance(angleDeg: number, frontWidth: number): number {
  return Math.abs(degToRad(angleDeg)) * frontWidth;
}

/** Rotate point p about centre c by angle degrees (clockwise on screen). */
export function rotateAbout(p: Vec, c: Vec, angleDeg: number): Vec {
  const r = degToRad(angleDeg);
  const cs = Math.cos(r);
  const sn = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
}

// ---------------------------------------------------------------------------
// Facing arcs
// ---------------------------------------------------------------------------

export type Arc = 'front' | 'left' | 'right' | 'rear';
export const ARCS: Arc[] = ['front', 'left', 'right', 'rear'];

/** A regiment's full bounding rectangle: front-left pose plus width (along front) and depth. */
export interface Frame extends Pose {
  w: number;
  d: number;
}

/** Half-plane nu·u + nv·v ≤ c in regiment-local coordinates. */
interface HalfPlane {
  nu: number;
  nv: number;
  c: number;
}

/**
 * The four arcs as intersections of half-planes in local (u right, v back)
 * coordinates. Each corner of the frame sends a 45° line outward; those four
 * lines plus the frame's edges bound the wedges.
 *   front: in front of the front edge, between the two front-corner diagonals
 *   left / right: beside the flank, between the front and rear corner diagonals
 *   rear:  behind the rear edge, between the two rear-corner diagonals
 */
function arcHalfPlanes(arc: Arc, W: number, D: number): HalfPlane[] {
  switch (arc) {
    case 'front':
      return [
        { nu: 0, nv: 1, c: 0 }, // v ≤ 0
        { nu: -1, nv: 1, c: 0 }, // v ≤ u        (front-left diagonal)
        { nu: 1, nv: 1, c: W }, // v ≤ W − u    (front-right diagonal)
      ];
    case 'left':
      return [
        { nu: 1, nv: 0, c: 0 }, // u ≤ 0
        { nu: 1, nv: -1, c: 0 }, // v ≥ u        (front-left diagonal)
        { nu: 1, nv: 1, c: D }, // v ≤ D − u    (rear-left diagonal)
      ];
    case 'right':
      return [
        { nu: -1, nv: 0, c: -W }, // u ≥ W
        { nu: -1, nv: -1, c: -W }, // v ≥ W − u   (front-right diagonal)
        { nu: -1, nv: 1, c: D - W }, // v ≤ u − W + D (rear-right diagonal)
      ];
    case 'rear':
      return [
        { nu: 0, nv: -1, c: -D }, // v ≥ D
        { nu: -1, nv: -1, c: -D }, // v ≥ D − u
        { nu: 1, nv: -1, c: W - D }, // v ≥ u − W + D
      ];
  }
}

/**
 * Arcs of the frame containing world point p. A point on a dividing diagonal
 * (within eps) is in both arcs. Points inside the frame itself are in none.
 */
export function pointArcs(frame: Frame, p: Vec, eps = EPS): Arc[] {
  const { u, v } = worldToLocal(frame, p);
  return ARCS.filter((arc) =>
    arcHalfPlanes(arc, frame.w, frame.d).every((h) => h.nu * u + h.nv * v <= h.c + eps * Math.hypot(h.nu, h.nv)),
  );
}

/** Sutherland–Hodgman clip of a polygon against one half-plane (local coords). */
function clipHalfPlane(pts: { u: number; v: number }[], h: HalfPlane, eps: number): { u: number; v: number }[] {
  const lim = h.c + eps * Math.hypot(h.nu, h.nv);
  const f = (p: { u: number; v: number }) => h.nu * p.u + h.nv * p.v - lim;
  const out: { u: number; v: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const fa = f(a);
    const fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push({ u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
    }
  }
  return out;
}

/** Arcs of the frame that any part of the polygon lies in (a polygon can be in two). */
export function polygonArcs(frame: Frame, poly: Polygon, eps = EPS): Arc[] {
  const local = poly.map((p) => worldToLocal(frame, p));
  return ARCS.filter((arc) => {
    let pts = local;
    for (const h of arcHalfPlanes(arc, frame.w, frame.d)) {
      pts = clipHalfPlane(pts, h, eps);
      if (pts.length === 0) return false;
    }
    return true;
  });
}

/**
 * Wedge polygon of an arc, clipped to a large square so it can be drawn
 * (and then clipped to the board by the renderer).
 */
export function arcWedge(frame: Frame, arc: Arc, reach = 200): Polygon {
  const big = [
    { u: -reach, v: -reach },
    { u: reach, v: -reach },
    { u: reach, v: reach },
    { u: -reach, v: reach },
  ];
  let pts = big;
  for (const h of arcHalfPlanes(arc, frame.w, frame.d)) pts = clipHalfPlane(pts, h, 0);
  return pts.map((p) => localToWorld(frame, p.u, p.v));
}
