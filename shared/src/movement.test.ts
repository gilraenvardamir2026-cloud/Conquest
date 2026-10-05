import { describe, expect, it } from 'vitest';
import { createBattle } from './board';
import { dist, mmToIn, polygonDistance, polygonsOverlap, rectCorners, type Pose } from './geometry';
import { boardContacts, closestBetween, moveWarnings } from './measure';
import {
  alignToFacing,
  boxCorners,
  boxFrame,
  describeMove,
  forwardSegment,
  freeSegment,
  mergeSegments,
  nearestFacing,
  regimentBox,
  rotateSegment,
  sidewaysSegment,
  sweepPoses,
  touchingParts,
  wheelByDistance,
  wheelSegment,
  type PieceBox,
} from './movement';
import { createRegiment, regimentPolygons } from './regiment';
import { STAND_PRESETS } from './presets';
import type { Battle, Regiment, Terrain } from './types';

const W3 = 3 * mmToIn(54); // 6.378"
const D1 = mmToIn(54);
const box3: PieceBox = { u0: 0, u1: W3, d: D1 };

const reg = (id: string, owner: 'p1' | 'p2', pose: Pose, extra: Partial<Regiment> = {}): Regiment => ({
  ...createRegiment({ id, owner, name: id, standType: 'infantry', preset: STAND_PRESETS.infantry, stands: 3, files: 3, woundsMax: 4, location: 'board', ...pose }),
  ...extra,
});

const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 6) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

describe('straight moves', () => {
  it('forward and backward follow the facing', () => {
    const s = forwardSegment({ x: 10, y: 40, angle: 0 }, 6);
    expect(s.to).toEqual({ x: 10, y: 34, angle: 0 });
    expect(s.label).toBe('forward 6.0"');
    const t = forwardSegment({ x: 10, y: 40, angle: 90 }, -2);
    close(t.to, { x: 8, y: 40 });
    expect(t.distance).toBe(2);
    expect(t.label).toBe('backward 2.0"');
  });

  it('sideways moves along the front edge', () => {
    const s = sidewaysSegment({ x: 10, y: 40, angle: 0 }, -2);
    expect(s.to).toEqual({ x: 8, y: 40, angle: 0 });
    expect(s.label).toBe('sideways L 2.0"');
  });

  it('free drag reports the corner that moved farthest', () => {
    const from = { x: 10, y: 40, angle: 0 };
    expect(freeSegment(from, { x: 13, y: 36, angle: 0 }, box3).distance).toBeCloseTo(5, 9);
  });
});

describe('wheel and rotate', () => {
  const from = { x: 10, y: 40, angle: 0 };

  it('a 90° left wheel pivots on the left corner and reports 10.02"', () => {
    const s = wheelSegment(from, box3, -90, 'left');
    expect(s.distance.toFixed(2)).toBe('10.02');
    expect(s.backward).toBeUndefined();
    expect(s.label).toBe('wheel L 10.0"');
    const [fl, fr] = boxCorners(s.to, box3);
    close(fl, { x: 10, y: 40 }); // pivot stays
    close(fr, { x: 10, y: 40 - W3 }); // free corner swung forward
    expect(s.to.angle).toBeCloseTo(-90, 9);
  });

  it('flags a wheel whose moving corner goes backward', () => {
    const s = wheelSegment(from, box3, 20, 'left');
    expect(s.backward).toBe(true);
    expect(s.label).toContain('(backward)');
  });

  it('a wheel given in inches turns by inches / width', () => {
    const s = wheelByDistance(from, box3, 2.5, 'right');
    expect(s.distance).toBeCloseTo(2.5, 9);
    expect(s.value).toBeGreaterThan(0);
    close(boxCorners(s.to, box3)[1], boxCorners(from, box3)[1]); // right corner fixed
  });

  it('rotating about the centre keeps the centre and reports no distance', () => {
    const s = rotateSegment(from, box3, 180);
    expect(s.distance).toBe(0);
    const c0 = { x: 10 + W3 / 2, y: 40 + D1 / 2 };
    const corners = boxCorners(s.to, box3);
    close({ x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 }, c0);
    expect(rotateSegment(from, box3, 270).value).toBe(180);
  });

  it('sweeps a wheel along its arc with the pivot fixed', () => {
    const s = wheelSegment(from, box3, -90, 'left');
    const poses = sweepPoses(s, box3, 0.25);
    expect(poses.length).toBeGreaterThan(30);
    for (const p of poses) close(boxCorners(p, box3)[0], { x: 10, y: 40 });
  });

  it('describes a move like the log does', () => {
    const a = forwardSegment(from, 6);
    const b = wheelByDistance(a.to, box3, 1.2, 'right');
    expect(describeMove([a, b])).toBe('forward 6.0", wheel R 1.2" (total 7.2")');
    expect(describeMove([a])).toBe('forward 6.0"');
  });

  it('merges keyboard nudges of the same kind', () => {
    const a = forwardSegment(from, 0.1);
    const b = forwardSegment(a.to, 1);
    const m = mergeSegments(a, b, box3)!;
    expect(m.value).toBeCloseTo(1.1, 9);
    expect(m.from).toBe(from);
    expect(mergeSegments(a, sidewaysSegment(a.to, 1), box3)).toBeNull();
  });
});

describe('align to target', () => {
  const target = reg('t', 'p2', { x: 30, y: 10, angle: 0 });
  const tf = boxFrame(target, regimentBox(target));

  it('flush against the rear, same width: full contact', () => {
    const mover = { x: 31, y: 30, angle: 0 };
    const { pose, travel } = alignToFacing(mover, box3, tf, 'rear');
    expect(pose.angle).toBeCloseTo(0, 9);
    close(pose, { x: 30, y: 10 + D1 }, 6);
    const moved = { ...reg('m', 'p1', pose) };
    const d = polygonDistance(boxCorners(pose, box3), boxCorners(target, box3));
    expect(d.distance).toBeLessThan(1e-6);
    expect(polygonsOverlap(regimentPolygons(moved)[0], regimentPolygons(target)[0])).toBe(false);
    expect(travel).toBeCloseTo(dist({ x: 31 + W3 / 2, y: 30 }, { x: 30 + W3 / 2, y: 10 + D1 }), 9);
  });

  it('against a narrow flank the wider front covers it, closest to where it was', () => {
    const mover = { x: 15, y: 20, angle: 90 }; // facing +x, to the left of the target
    const { pose } = alignToFacing(mover, box3, tf, 'left');
    expect(pose.angle).toBeCloseTo(90, 9);
    const fl = boxCorners(pose, box3)[0];
    const fr = boxCorners(pose, box3)[1];
    expect(fl.x).toBeCloseTo(30, 9);
    expect(fr.x).toBeCloseTo(30, 9);
    // The front spans y from fl to fr and covers the whole 2.126" flank (10 .. 12.126).
    expect(Math.min(fl.y, fr.y)).toBeLessThanOrEqual(10 + 1e-9);
    expect(Math.max(fl.y, fr.y)).toBeGreaterThanOrEqual(10 + D1 - 1e-9);
  });

  it('centre mode centres on the facing', () => {
    const { pose } = alignToFacing({ x: 50, y: 30, angle: 0 }, { u0: 0, u1: D1, d: D1 }, tf, 'rear', 'centre');
    expect(pose.x + D1 / 2).toBeCloseTo(30 + W3 / 2, 9);
  });

  it('picks the facing nearest the pointer', () => {
    expect(nearestFacing(tf, { x: 33, y: 5 })).toBe('front');
    expect(nearestFacing(tf, { x: 28, y: 11 })).toBe('left');
    expect(nearestFacing(tf, { x: 33, y: 20 })).toBe('rear');
  });
});

describe('contact', () => {
  it('shared edge stretches and corner touches', () => {
    const a = rectCorners(0, 0, 2, 2, 0);
    const parts = touchingParts(a, rectCorners(2, 1, 2, 2, 0));
    expect(parts).toHaveLength(1);
    expect(dist(parts[0].a, parts[0].b)).toBeCloseTo(1, 9);
    const corner = touchingParts(a, rectCorners(2, 2, 2, 2, 0));
    expect(corner).toHaveLength(1);
    close(corner[0].a, { x: 2, y: 2 });
    expect(touchingParts(a, rectCorners(2.05, 0, 2, 2, 0))).toHaveLength(0);
  });

  it('finds touching regiments on the board', () => {
    const b: Battle = {
      ...createBattle({ id: 'b' }),
      regiments: [reg('a', 'p1', { x: 10, y: 20, angle: 0 }), reg('b', 'p2', { x: 10, y: 20 - D1, angle: 0 }), reg('c', 'p2', { x: 40, y: 20, angle: 0 })],
    };
    const cs = boardContacts(b);
    expect(cs).toHaveLength(1);
    expect(new Set([cs[0].a, cs[0].b])).toEqual(new Set(['a', 'b']));
    const total = cs[0].parts.reduce((s, p) => s + dist(p.a, p.b), 0);
    expect(total).toBeCloseTo(W3, 6);
  });
});

describe('closest distance', () => {
  const b0 = createBattle({ id: 'b', scenarioId: 's1' });
  const b: Battle = { ...b0, regiments: [reg('a', 'p1', { x: 10, y: 40, angle: 0 }), reg('e', 'p2', { x: 10, y: 30, angle: 0 })] };

  it('stand to stand between regiments', () => {
    const r = closestBetween(b, { kind: 'regiment', id: 'a' }, { kind: 'regiment', id: 'e' })!;
    expect(r.distance).toBeCloseTo(10 - D1, 9);
  });

  it('to a zone, with an inside flag', () => {
    const zone = b.zones[0]; // 6" at (12, 36)
    const r = closestBetween(b, { kind: 'regiment', id: 'a' }, { kind: 'zone', id: zone.id })!;
    expect(r.distance).toBeCloseTo(1, 9); // front edge at y 40, circle reaches y 39
    expect(r.inside).toBe(false);
    const moved: Battle = { ...b, regiments: [reg('a', 'p1', { x: 10, y: 38.5, angle: 0 }), b.regiments[1]] };
    const r2 = closestBetween(moved, { kind: 'zone', id: zone.id }, { kind: 'regiment', id: 'a' })!;
    expect(r2.distance).toBe(0);
    expect(r2.inside).toBe(true);
  });

  it('from a single stand', () => {
    const a = b.regiments[0];
    const right = a.stands.find((s) => s.slot.file === 2)!;
    const r = closestBetween(b, { kind: 'regiment', id: 'a', standId: right.id }, { kind: 'regiment', id: 'e' })!;
    expect(r.distance).toBeCloseTo(10 - D1, 9);
  });
});

describe('move warnings', () => {
  const rock: Terrain = { id: 'rock', name: 'Rock', shape: { kind: 'rect', w: 4, d: 2 }, x: 13, y: 30, angle: 0, size: 3, keywords: ['Impassable', 'Obstructing'], locked: false };
  const base = (): Battle => ({ ...createBattle({ id: 'b' }), terrain: [rock], regiments: [reg('a', 'p1', { x: 10, y: 40, angle: 0 }, { march: 8 }), reg('e', 'p2', { x: 40, y: 20, angle: 0 })] });

  it('march, impassable crossing and off-board', () => {
    const b = base();
    const s1 = forwardSegment({ x: 10, y: 40, angle: 0 }, 12);
    const w = moveWarnings(b, { kind: 'regiment', id: 'a' }, s1.to, [s1]);
    const kinds = w.map((x) => x.kind).sort();
    expect(kinds).toEqual(['impassable', 'march']);
    const off = forwardSegment({ x: 10, y: 40, angle: 0 }, -8);
    expect(moveWarnings(b, { kind: 'regiment', id: 'a' }, off.to, [off]).map((x) => x.kind).sort()).toEqual(['offboard']);
  });

  it('enemy within 1", contact, overlap', () => {
    const b = base();
    const near = { x: 40, y: 20 + D1 + 0.5, angle: 0 };
    expect(moveWarnings(b, { kind: 'regiment', id: 'a' }, near, []).map((x) => x.kind)).toEqual(['enemy']);
    const touching = { x: 40, y: 20 + D1, angle: 0 };
    expect(moveWarnings(b, { kind: 'regiment', id: 'a' }, touching, [])[0].text).toContain('In contact');
    const over = { x: 41, y: 20.5, angle: 0 };
    expect(moveWarnings(b, { kind: 'regiment', id: 'a' }, over, []).map((x) => x.kind)).toEqual(['overlap']);
  });

  it('sideways beyond half March', () => {
    const b = base();
    const s = sidewaysSegment({ x: 10, y: 40, angle: 0 }, 4.5);
    expect(moveWarnings(b, { kind: 'regiment', id: 'a' }, s.to, [s]).map((x) => x.kind)).toEqual(['sideways']);
  });
});
