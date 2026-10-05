import { describe, expect, it } from 'vitest';
import {
  arcWedge,
  centeredRectCorners,
  convexOverlapDepth,
  ellipsePolygon,
  isConvex,
  localToWorld,
  mmToIn,
  offsetConvexPolygon,
  pointArcs,
  pointInPolygon,
  pointPolygonDistance,
  polygonArcs,
  polygonDistance,
  polygonsOverlap,
  rectCorners,
  segmentIntersection,
  signedArea,
  triangulate,
  wheelDistance,
  worldToLocal,
  type Frame,
} from './geometry';
import { createRegiment, regimentFrame } from './regiment';
import { STAND_PRESETS } from './presets';

describe('frames', () => {
  it('angle 0 faces up the board, local v points back (down)', () => {
    const pose = { x: 10, y: 10, angle: 0 };
    expect(localToWorld(pose, 2, 0)).toEqual({ x: 12, y: 10 });
    expect(localToWorld(pose, 0, 2)).toEqual({ x: 10, y: 12 });
  });

  it('angle 90 faces right (+x), right side points down', () => {
    const pose = { x: 0, y: 0, angle: 90 };
    const r = localToWorld(pose, 1, 0);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
    const back = localToWorld(pose, 0, 1);
    expect(back.x).toBeCloseTo(-1);
    expect(back.y).toBeCloseTo(0);
  });

  it('worldToLocal inverts localToWorld', () => {
    const pose = { x: 3.3, y: -2, angle: 37 };
    const p = localToWorld(pose, 1.7, 4.2);
    const l = worldToLocal(pose, p);
    expect(l.u).toBeCloseTo(1.7, 9);
    expect(l.v).toBeCloseTo(4.2, 9);
  });

  it('rectCorners go front-left, front-right, rear-right, rear-left', () => {
    expect(rectCorners(0, 0, 2, 1, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ]);
  });
});

describe('distances', () => {
  it('two axis-aligned 1" squares 3" apart are 3.000" apart', () => {
    const a = centeredRectCorners(0, 0, 1, 1, 0);
    const b = centeredRectCorners(4, 0, 1, 1, 0); // edges at x = 0.5 and x = 3.5
    expect(polygonDistance(a, b).distance).toBeCloseTo(3, 6);
    expect(polygonDistance(a, b).distance.toFixed(3)).toBe('3.000');
  });

  it('rotated square: vertex-to-edge distance matches hand computation', () => {
    // Square B (1") rotated 45° centred 3" to the right of square A's centre.
    // B's nearest vertex is at x = 3 − √2/2; A's right edge is at x = 0.5.
    const a = centeredRectCorners(0, 0, 1, 1, 0);
    const b = centeredRectCorners(3, 0, 1, 1, 45);
    const expected = 3 - Math.SQRT2 / 2 - 0.5; // 1.79289
    const r = polygonDistance(a, b);
    expect(r.distance).toBeCloseTo(expected, 6);
    expect(r.b.x).toBeCloseTo(3 - Math.SQRT2 / 2, 6);
  });

  it('two rotated squares vertex to vertex', () => {
    const a = centeredRectCorners(0, 0, 1, 1, 45);
    const b = centeredRectCorners(3, 0, 1, 1, 45);
    expect(polygonDistance(a, b).distance).toBeCloseTo(3 - Math.SQRT2, 6);
  });

  it('overlapping or touching polygons are 0 apart', () => {
    const a = centeredRectCorners(0, 0, 2, 2, 0);
    expect(polygonDistance(a, centeredRectCorners(1, 1, 2, 2, 0)).distance).toBe(0);
    expect(polygonDistance(a, centeredRectCorners(2, 0, 2, 2, 0)).distance).toBe(0);
  });

  it('point in polygon handles concave shapes and boundary', () => {
    const L = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(pointInPolygon({ x: 0.5, y: 3 }, L)).toBe(true);
    expect(pointInPolygon({ x: 3, y: 3 }, L)).toBe(false);
    expect(pointInPolygon({ x: 4, y: 0.5 }, L)).toBe(true);
    expect(pointInPolygon({ x: 4, y: 0.5 }, L, true)).toBe(false);
    expect(pointPolygonDistance({ x: 3, y: 3 }, L)).toBeCloseTo(2, 6);
  });
});

describe('segments', () => {
  it('finds crossings and touching end points, rejects misses', () => {
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })?.point).toEqual({ x: 1, y: 1 });
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })).not.toBeNull();
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1.1, y: 0 }, { x: 2, y: 1 })).toBeNull();
    // Collinear overlap
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 })).not.toBeNull();
  });
});

describe('overlap', () => {
  it('touching squares do not overlap; interpenetrating ones do', () => {
    const a = centeredRectCorners(0, 0, 2, 2, 0);
    expect(polygonsOverlap(a, centeredRectCorners(2, 0, 2, 2, 0))).toBe(false);
    expect(polygonsOverlap(a, centeredRectCorners(1.9, 0, 2, 2, 0))).toBe(true);
    expect(polygonsOverlap(a, centeredRectCorners(0, 0, 2, 2, 0))).toBe(true);
    expect(convexOverlapDepth(a, centeredRectCorners(1.5, 0, 2, 2, 0))).toBeCloseTo(0.5, 6);
  });

  it('concave shapes use their convex pieces', () => {
    const L = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(isConvex(L)).toBe(false);
    const tris = triangulate(L);
    expect(tris).toHaveLength(4);
    const area = tris.reduce((a, t) => a + Math.abs(signedArea(t)), 0);
    expect(area).toBeCloseTo(7, 6);
    // A square sitting in the notch of the L does not overlap it…
    expect(polygonsOverlap(L, centeredRectCorners(2.5, 2.5, 2, 2, 0))).toBe(false);
    // …but one poking into the arm does.
    expect(polygonsOverlap(L, centeredRectCorners(2.5, 1.4, 2, 1, 0))).toBe(true);
  });
});

describe('ellipse and offset', () => {
  it('ellipse is a 64-gon on the ellipse', () => {
    const e = ellipsePolygon(0, 0, 3, 2);
    expect(e).toHaveLength(64);
    expect(e[0].x).toBeCloseTo(3);
    expect(e[16].y).toBeCloseTo(2);
  });

  it('offset outline of a rectangle stays exactly r away', () => {
    const rect = centeredRectCorners(10, 10, 4, 2, 30);
    const ring = offsetConvexPolygon(rect, 6, 16);
    for (const p of ring) expect(pointPolygonDistance(p, rect)).toBeCloseTo(6, 6);
  });
});

describe('wheel', () => {
  it('90° wheel of a 3-stand infantry front reports 10.02"', () => {
    const reg = createRegiment({
      id: 'r',
      owner: 'p1',
      name: 'Militia',
      standType: 'infantry',
      preset: STAND_PRESETS.infantry,
      stands: 3,
      files: 3,
      woundsMax: 4,
    });
    const w = regimentFrame(reg).w;
    expect(w).toBeCloseTo(3 * mmToIn(54), 9); // 6.378"
    expect(w.toFixed(3)).toBe('6.378');
    expect(wheelDistance(90, w).toFixed(2)).toBe('10.02');
    expect(wheelDistance(-90, w)).toBeCloseTo((Math.PI / 2) * w, 9);
  });
});

describe('facing arcs', () => {
  const frame: Frame = { x: 10, y: 10, angle: 0, w: 6.378, d: 2.126 };

  it('a point straight ahead is in the front arc only', () => {
    expect(pointArcs(frame, { x: 13.189, y: 0 })).toEqual(['front']);
  });

  it('a point 45° off a front corner is on the boundary and counts for both', () => {
    expect(pointArcs(frame, { x: 7, y: 7 }).sort()).toEqual(['front', 'left']);
    expect(pointArcs(frame, { x: 10 + 6.378 + 4, y: 6 }).sort()).toEqual(['front', 'right']);
  });

  it('a point directly beside the regiment is in the flank arc', () => {
    expect(pointArcs(frame, { x: 5, y: 11 })).toEqual(['left']);
    expect(pointArcs(frame, { x: 20, y: 11 })).toEqual(['right']);
    expect(pointArcs(frame, { x: 13, y: 20 })).toEqual(['rear']);
  });

  it('works for a rotated regiment', () => {
    const f: Frame = { ...frame, angle: 90 }; // facing +x
    const ahead = localToWorld(f, f.w / 2, -10);
    expect(ahead.x).toBeGreaterThan(f.x);
    expect(pointArcs(f, ahead)).toEqual(['front']);
    expect(pointArcs(f, localToWorld(f, -3, 1))).toEqual(['left']);
  });

  it('a stand straddling a diagonal is in two arcs', () => {
    const stand = centeredRectCorners(7, 7, 1, 1, 0);
    expect(polygonArcs(frame, stand).sort()).toEqual(['front', 'left']);
    expect(polygonArcs(frame, centeredRectCorners(13, 2, 1, 1, 0))).toEqual(['front']);
  });

  it('wedges are convex and start at the frame', () => {
    const w = arcWedge(frame, 'front');
    expect(w.length).toBeGreaterThanOrEqual(3);
    expect(isConvex(w)).toBe(true);
  });
});
