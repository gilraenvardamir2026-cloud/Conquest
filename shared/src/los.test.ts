import { describe, expect, it } from 'vitest';
import { createBattle } from './board';
import { mmToIn, type Pose } from './geometry';
import { describeLos, effectiveSize, lineOfSight } from './los';
import { createRegiment } from './regiment';
import { STAND_PRESETS } from './presets';
import type { Battle, Regiment, StandType, Terrain } from './types';

const W1 = mmToIn(54);
const M1 = mmToIn(110);

function reg(id: string, owner: 'p1' | 'p2', type: Exclude<StandType, 'custom'>, pose: Pose, stands = 3, files = 3, extra: Partial<Regiment> = {}): Regiment {
  return {
    ...createRegiment({ id, owner, name: id, standType: type, preset: STAND_PRESETS[type], stands, files, woundsMax: 4, location: 'board', ...pose }),
    ...extra,
  };
}

const rect = (id: string, name: string, cx: number, cy: number, w: number, d: number, size: number, keywords: Terrain['keywords']): Terrain => ({
  id,
  name,
  shape: { kind: 'rect', w, d },
  x: cx,
  y: cy,
  angle: 0,
  size,
  keywords,
  locked: false,
});

const battle = (regiments: Regiment[], terrain: Terrain[] = [], settings: Partial<Battle['settings']> = {}): Battle => {
  const b = createBattle({ id: 'b' });
  return { ...b, regiments, terrain, settings: { ...b.settings, ...settings } };
};

const A = { kind: 'regiment' as const, id: 'a' };
const T = { kind: 'regiment' as const, id: 't' };

describe('line of sight: required cases', () => {
  // Acting faces up from y = 40; target 20" away faces down at it; a 5-wide blocker in between.
  const acting = (type: Exclude<StandType, 'custom'>) => reg('a', 'p1', type, { x: 10, y: 40, angle: 0 });
  const target = (type: Exclude<StandType, 'custom'>) => reg('t', 'p2', type, { x: 10 + 3 * W1, y: 20, angle: 180 });
  const blocker = reg('x', 'p1', 'infantry', { x: 8, y: 30, angle: 0 }, 5, 5);

  it('a Size-1 regiment between two Size-1 regiments blocks', () => {
    const r = lineOfSight(battle([acting('infantry'), target('infantry'), blocker]), A, T, 'sight')!;
    expect(r.acting.size).toBe(1);
    expect(r.clearCount).toBe(0);
    expect(r.headline).toBe('Line of sight: NO — 0 of 3 front stands clear');
    expect(r.rows.every((x) => x.blockedBy.includes('x'))).toBe(true);
    expect(r.lines.length).toBe(3 * 3 * 4); // 3 origins × 3 target stands × 4 edge centres
    expect(r.lines.every((l) => l.status === 'blocked')).toBe(true);
  });

  it('a Size-1 regiment between two Size-2 regiments does not block', () => {
    const r = lineOfSight(battle([acting('cavalry'), target('cavalry'), blocker]), A, T, 'sight')!;
    expect(r.acting.size).toBe(2);
    expect(r.clearCount).toBe(3);
    expect(r.headline).toBe('Line of sight: YES — 3 of 3 front stands clear');
  });

  it('an Obstructing rock blocks two Size-3 monsters in tournament mode but not in core mode when its Size is 2', () => {
    const a = reg('a', 'p1', 'monster', { x: 10, y: 40, angle: 0 }, 1, 1);
    const t = reg('t', 'p2', 'monster', { x: 10 + M1, y: 20, angle: 180 }, 1, 1);
    const rock2 = rect('rock', 'Rock', 10 + M1 / 2, 30, 10, 2, 2, ['Impassable', 'Obstructing']);
    expect(lineOfSight(battle([a, t], [rock2], { losObstructing: 'tournament' }), A, T, 'sight')!.clearCount).toBe(0);
    expect(lineOfSight(battle([a, t], [rock2], { losObstructing: 'core' }), A, T, 'sight')!.clearCount).toBe(1);
    const rock3 = { ...rock2, size: 3 };
    expect(lineOfSight(battle([a, t], [rock3], { losObstructing: 'core' }), A, T, 'sight')!.clearCount).toBe(0);
  });
});

describe('line of sight: details', () => {
  it('size comparison "acting only" lets a blocker the size of the acting piece block a bigger target', () => {
    const a = reg('a', 'p1', 'infantry', { x: 10, y: 40, angle: 0 });
    const t = reg('t', 'p2', 'cavalry', { x: 10 + 3 * W1, y: 20, angle: 180 });
    const x = reg('x', 'p1', 'infantry', { x: 8, y: 30, angle: 0 }, 5, 5);
    expect(lineOfSight(battle([a, t, x]), A, T, 'sight')!.clearCount).toBe(3); // both: 1 < 2
    expect(lineOfSight(battle([a, t, x], [], { losSizeComparison: 'acting' }), A, T, 'sight')!.clearCount).toBe(0);
  });

  it('objective markers are Size 2 obstacles', () => {
    const a = reg('a', 'p1', 'infantry', { x: 10, y: 40, angle: 0 }, 1, 1);
    const t = reg('t', 'p2', 'infantry', { x: 10 + W1, y: 20, angle: 180 }, 1, 1);
    const b0 = battle([a, t]);
    const b: Battle = { ...b0, objectiveMarkers: [{ id: 'm', x: 10 + W1 / 2, y: 30, woundsMax: 3, damageBy: { p1: 0, p2: 0 }, destroyed: false, locked: true }] };
    expect(lineOfSight(b, A, T, 'sight')!.rows[0].blockedBy).toEqual(['objective marker •']);
    expect(effectiveSize(b, { kind: 'objective', id: 'm' })!.size).toBe(2);
  });

  it('targets outside the front arc are not seen unless all arcs count as front', () => {
    const a = reg('a', 'p1', 'infantry', { x: 10, y: 40, angle: 0 });
    const t = reg('t', 'p2', 'infantry', { x: 30, y: 40, angle: 0 }); // directly beside, to the right
    const r = lineOfSight(battle([a, t]), A, T, 'sight')!;
    expect(r.clearCount).toBe(0);
    expect(r.targetInFrontArc).toBe(false);
    expect(r.lines.every((l) => l.status === 'outOfArc')).toBe(true);
    const r2 = lineOfSight(battle([a, t], [], { losAllFrontIds: ['a'] }), A, T, 'sight')!;
    expect(r2.clearCount).toBe(3);
  });

  it('arc report: which arcs of the target each front stand is in', () => {
    // Target faces up; acting sits off its left flank facing right, at it.
    const t = reg('t', 'p2', 'infantry', { x: 30, y: 30, angle: 0 });
    // Front edge along x = 26, stands from y 24 down to 30.4: the top stand straddles the
    // target's front-left diagonal (y = x), so it is in both the front and the left arc.
    const a = reg('a', 'p1', 'infantry', { x: 26, y: 24, angle: 90 });
    const r = lineOfSight(battle([a, t], [], { losAllFrontIds: ['a'] }), A, T, 'sight')!;
    expect(r.rows.map((x) => x.arcs.sort().join('+'))).toEqual(['front+left', 'left', 'left']);
    expect(r.arcCounts).toEqual({ front: 1, left: 3 });
    expect(describeLos(r)).toContain('Front: 1 · Left flank: 3');
  });

  it('a regiment wholly on an Elevated piece adds its Size; an Obstructing hill it stands on is ignored', () => {
    const hill = rect('hill', 'Hill', 13, 41, 10, 4, 2, ['Elevated', 'Obstructing']);
    const a = reg('a', 'p1', 'infantry', { x: 10, y: 40, angle: 0 });
    const t = reg('t', 'p2', 'infantry', { x: 10 + 3 * W1, y: 20, angle: 180 });
    const x = reg('x', 'p1', 'infantry', { x: 8, y: 30, angle: 0 }, 5, 5);
    const b = battle([a, t, x], [hill]);
    expect(effectiveSize(b, A)).toEqual({ size: 3, note: 'infantry 1, on Hill +2' });
    // Blocker Size 1 is smaller than the acting size 3, so it no longer blocks.
    expect(lineOfSight(b, A, T, 'sight')!.clearCount).toBe(3);
    // A manual override wins.
    const b2 = battle([{ ...a, sizeOverride: 1 }, t, x], [hill]);
    expect(lineOfSight(b2, A, T, 'sight')!.clearCount).toBe(0);
  });

  it('an Obstructing piece is ignored when any part of the acting or target stand is on it', () => {
    // Rock from y 30 to 40.5: the acting stands (y 40..42.1) overlap its edge by 0.5", centres outside.
    const rock = rect('rock', 'Rock', 13, 35.25, 12, 10.5, 1, ['Obstructing']);
    const a = reg('a', 'p1', 'infantry', { x: 10, y: 40, angle: 0 });
    const t = reg('t', 'p2', 'infantry', { x: 10 + 3 * W1, y: 20, angle: 180 });
    expect(lineOfSight(battle([a, t], [rock]), A, T, 'sight')!.clearCount).toBe(3);
    // Moved 1" back the stands are off it, and the rock blocks again.
    const a2 = reg('a', 'p1', 'infantry', { x: 10, y: 41, angle: 0 });
    expect(lineOfSight(battle([a2, t], [rock]), A, T, 'sight')!.clearCount).toBe(0);
    // The same from the target's side: its stands (y 17.9..20) reach 0.3" into a rock from y 19.7 up to 25.
    const rock2 = rect('rock2', 'Rock', 13, 22.35, 12, 5.3, 1, ['Obstructing']);
    expect(lineOfSight(battle([a2, t], [rock2]), A, T, 'sight')!.clearCount).toBe(3);
  });

  it('an Obstructing piece blocks lines that only cross it', () => {
    const wall = rect('wall', 'Wall', 13, 30, 12, 1, 1, ['Obstructing']);
    const a = reg('a', 'p1', 'infantry', { x: 10, y: 40, angle: 0 });
    const t = reg('t', 'p2', 'infantry', { x: 10 + 3 * W1, y: 20, angle: 180 });
    const r = lineOfSight(battle([a, t], [wall]), A, T, 'sight')!;
    expect(r.clearCount).toBe(0);
    expect(r.rows[0].blockedBy).toEqual(['Wall']);
  });

  it('flags Cover and Obscuring crossed, and a target wholly inside such a piece, without blocking', () => {
    const forest = rect('f', 'Forest', 13, 22, 12, 8, 3, ['Hindering', 'Obscuring', 'Traversable']);
    const a = reg('a', 'p1', 'infantry', { x: 10, y: 40, angle: 0 });
    const t = reg('t', 'p2', 'infantry', { x: 10 + 3 * W1, y: 22, angle: 180 });
    const r = lineOfSight(battle([a, t], [forest]), A, T, 'sight')!;
    expect(r.clearCount).toBe(3);
    expect(r.rows[0].cover).toEqual(['Forest']);
    expect(r.notes.some((n) => n.includes('Every target stand is inside Forest'))).toBe(true);
  });

  it('a garrison sees 360° from the terrain edges and uses the terrain Size', () => {
    const tower = rect('tw', 'Tower', 20, 20, 4, 4, 3, ['Garrison', 'Obstructing']);
    tower.garrison = { defense: 1, capacity: 4, occupiedBy: 'a' };
    const a = reg('a', 'p1', 'infantry', { x: 0, y: 0, angle: 0 }, 3, 3, { garrisonId: 'tw' });
    const t = reg('t', 'p2', 'infantry', { x: 17, y: 30, angle: 0 }); // behind/below the tower
    const b = battle([a, t], [tower]);
    expect(effectiveSize(b, A)!.size).toBe(3);
    const r = lineOfSight(b, A, T, 'sight')!;
    expect(r.rows).toHaveLength(1);
    expect(r.clearCount).toBe(1);
    expect(r.targetInFrontArc).toBe(true);
    expect(r.headline).toBe('Line of sight: YES — 1 of 1 garrison clear');
  });

  it('volley: shortest clear line, Barrage range and effective range', () => {
    const a = reg('a', 'p1', 'infantry', { x: 10, y: 40, angle: 0 }, 3, 3, { barrageRange: 16 });
    const t = reg('t', 'p2', 'infantry', { x: 10 + 3 * W1, y: 30, angle: 180 }); // front edge at y 30: 10" away
    const r = lineOfSight(battle([a, t]), A, T, 'volley')!;
    expect(r.clearCount).toBe(3);
    for (const row of r.rows) {
      expect(row.distance).toBeCloseTo(10, 6);
      expect(row.inRange).toBe(true);
      expect(row.effective).toBe(false); // 10" is not under half of 16"
    }
    expect(r.headline).toBe('Line of sight: YES — 3 of 3 front stands clear · 3 in range (16")');
    expect(r.lines).toHaveLength(3); // best line per stand by default
    const far = lineOfSight(battle([{ ...a, barrageRange: 8 }, t]), A, T, 'volley')!;
    expect(far.rows.every((x) => x.clear && !x.inRange)).toBe(true);
    expect(far.lines.every((l) => l.status === 'outOfRange')).toBe(true);
    const close = lineOfSight(battle([{ ...a, barrageRange: 24 }, t]), A, T, 'volley')!;
    expect(close.rows.every((x) => x.effective)).toBe(true);
  });

  it('volley finds a clear line past a partial blocker that sight-mode edge centres miss', () => {
    // One acting stand at the centre; a 3-wide target 20" ahead; a thin wall 1" in front of
    // the target covering everything but its outer corners.
    const a = reg('a', 'p1', 'infantry', { x: 13.189 - W1 / 2, y: 40, angle: 0 }, 1, 1);
    const t = reg('t', 'p2', 'infantry', { x: 10 + 3 * W1, y: 20, angle: 180 });
    const wall = rect('w', 'Wall', 13.2, 21.25, 5.8, 0.5, 1, ['Obstructing']);
    const b = battle([a, t], [wall]);
    expect(lineOfSight(b, A, T, 'sight')!.clearCount).toBe(0);
    const v = lineOfSight(b, A, T, 'volley')!;
    expect(v.clearCount).toBe(1);
    expect(v.rows[0].best!.status).toBe('clear');
  });
});
