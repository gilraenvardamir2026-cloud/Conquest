import { describe, expect, it } from 'vitest';
import { createBattle } from './board';
import { deployPose } from './deploy';
import { polygonsOverlap } from './geometry';
import { STAND_PRESETS } from './presets';
import { createRegiment, regimentPolygons } from './regiment';
import type { Battle, PlayerSeat, Regiment } from './types';

const reg = (id: string, owner: PlayerSeat, stands = 6, files = 3): Regiment =>
  createRegiment({ id, owner, name: id, standType: 'infantry', preset: STAND_PRESETS.infantry, stands, files, woundsMax: 4, location: 'reserve' });
const place = (b: Battle, r: Regiment, pose: { x: number; y: number; angle: number }): Battle => ({
  ...b,
  regiments: [...b.regiments.filter((x) => x.id !== r.id), { ...r, ...pose, location: 'board' }],
});
const points = (r: Regiment) => regimentPolygons(r).flat();
const W = STAND_PRESETS.infantry.w;

describe('deploying off the table', () => {
  it('own edge: front rank on the edge, the rest behind it, centred', () => {
    const b = createBattle({ id: 'b' });
    const r1 = reg('a', 'p1');
    const p = deployPose(b, r1, 'own');
    expect(p.angle).toBe(0);
    const pts = points({ ...r1, ...p });
    expect(Math.min(...pts.map((q) => q.y))).toBeCloseTo(48, 6); // front edge on the bottom edge
    expect(Math.max(...pts.map((q) => q.y))).toBeCloseTo(48 + 2 * W, 6); // two ranks behind it
    expect((Math.min(...pts.map((q) => q.x)) + Math.max(...pts.map((q) => q.x))) / 2).toBeCloseTo(36, 6);

    const r2 = reg('b', 'p2');
    const q = deployPose(b, r2, 'own');
    expect(q.angle).toBe(180);
    const qs = points({ ...r2, ...q });
    expect(Math.max(...qs.map((v) => v.y))).toBeCloseTo(0, 6);
    expect(Math.min(...qs.map((v) => v.y))).toBeCloseTo(-2 * W, 6);
  });

  it('side edges: facing in, front on the edge, at the end nearest the own long edge', () => {
    const b = createBattle({ id: 'b' });
    const r = reg('a', 'p1');
    const left = deployPose(b, r, 'left');
    expect(left.angle).toBe(90);
    const lp = points({ ...r, ...left });
    expect(Math.max(...lp.map((v) => v.x))).toBeCloseTo(0, 6);
    expect(Math.max(...lp.map((v) => v.y))).toBeCloseTo(48, 6);
    const right = deployPose(b, reg('c', 'p2'), 'right');
    expect(right.angle).toBe(270);
    const rp = points({ ...reg('c', 'p2'), ...right });
    expect(Math.min(...rp.map((v) => v.x))).toBeCloseTo(72, 6);
    expect(Math.min(...rp.map((v) => v.y))).toBeCloseTo(0, 6);
  });

  it('slides along the edge to the nearest free spot', () => {
    let b = createBattle({ id: 'b' });
    const regs = ['a', 'b', 'c'].map((id) => reg(id, 'p1'));
    for (const r of regs) b = place(b, r, deployPose(b, r, 'own'));
    for (const edge of ['left', 'left'] as const) {
      const r = reg(`s${b.regiments.length}`, 'p1');
      b = place(b, r, deployPose(b, r, edge));
    }
    const polys = b.regiments.map((r) => regimentPolygons(r));
    for (let i = 0; i < polys.length; i++)
      for (let j = i + 1; j < polys.length; j++) expect(polys[i].some((p) => polys[j].some((q) => polygonsOverlap(p, q)))).toBe(false);
    // The second regiment on the left edge sits further up the edge than the first.
    const [s1, s2] = b.regiments.slice(3);
    expect(s2.y).toBeLessThan(s1.y);
  });
});
