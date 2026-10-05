import { describe, expect, it } from 'vitest';
import { createBattle } from './board';
import { applyOp, type ApplyResult } from './reducer';
import { createRegiment } from './regiment';
import { SCENARIOS, STAND_PRESETS } from './presets';
import type { Op, OpEnvelope } from './ops';
import type { Battle, Character } from './types';

let n = 0;
const env = (op: Op, by: OpEnvelope['by'] = 'p1'): OpEnvelope => ({ id: `op${++n}`, by, at: 1_700_000_000_000 + n, op });

function ok(r: ApplyResult): Battle {
  if (!r.ok) throw new Error(r.error);
  return r.battle;
}
const run = (b: Battle, ...ops: Op[]) => ops.reduce((acc, op) => ok(applyOp(acc, env(op))), b);

const militia = () =>
  createRegiment({
    id: 'mil',
    owner: 'p1',
    name: 'Militia',
    standType: 'infantry',
    preset: STAND_PRESETS.infantry,
    stands: 6,
    files: 3,
    woundsMax: 4,
    x: 30,
    y: 40,
    location: 'board',
  });

const hero: Character = {
  id: 'hero',
  owner: 'p1',
  name: 'Hero',
  notes: '',
  standType: 'infantry',
  standW: STAND_PRESETS.infantry.w,
  standD: STAND_PRESETS.infantry.d,
  woundsMax: 5,
  wounds: 0,
  location: 'reserve',
};

// Expected scenario table (x, y in inches; diameter; friendly seat; label).
type Z = [number, number, number, string?, string?];
type M = [number, number, string?, string?];
const EXPECTED: Record<number, { zones: Z[]; markers: M[]; noReinf?: boolean }> = {
  1: { zones: [[12, 36, 6, 'p1'], [60, 36, 6, 'p1'], [12, 12, 6, 'p2'], [60, 12, 6, 'p2'], [24, 24, 6], [48, 24, 6]], markers: [[36, 36, 'p1', 'A'], [36, 12, 'p2', 'B']] },
  2: { zones: [[6, 18, 6], [30, 18, 6], [54, 18, 6], [18, 30, 6], [42, 30, 6], [66, 30, 6]], markers: [] },
  3: { zones: [[12, 24, 9], [36, 24, 9], [60, 24, 9]], markers: [[31.5, 24, 'p1', 'A'], [40.5, 24, 'p2', 'B']] },
  4: { zones: [[24, 18, 9], [48, 30, 9]], markers: [[12, 42, 'p1', 'A'], [60, 6, 'p2', 'B'], [48, 18], [24, 30]] },
  5: { zones: [[48, 18, 9], [24, 30, 9], [24, 18, 6], [48, 30, 6]], markers: [[36, 18], [36, 30]], noReinf: true },
  6: { zones: [[12, 24, 9], [48, 24, 9]], markers: [[30, 30, 'p1', 'A'], [60, 36, 'p1', 'A'], [30, 18, 'p2', 'B'], [60, 12, 'p2', 'B']] },
  7: { zones: [[12, 24, 9], [60, 24, 9], [42, 18, 6], [30, 30, 6]], markers: [] },
  8: { zones: [[18, 24, 9], [54, 24, 9]], markers: [[18, 24, 'p1', 'A'], [54, 24, 'p2', 'B'], [36, 24]] },
  9: { zones: [[6, 30, 6, undefined, '1'], [18, 18, 6, undefined, '2'], [54, 30, 6, undefined, '3'], [66, 18, 6, undefined, '4'], [36, 24, 6]], markers: [] },
  10: { zones: [[54, 24, 9], [18, 36, 6, 'p1', 'A'], [18, 12, 6, 'p2', 'B']], markers: [] },
  11: { zones: [[12, 24, 9], [60, 24, 9], [36, 24, 6]], markers: [] },
  12: { zones: [[36, 24, 9], [18, 18, 6], [18, 30, 6], [54, 18, 6], [54, 30, 6]], markers: [] },
};

describe('scenario presets', () => {
  it('has all 12 scenarios', () => {
    expect(SCENARIOS.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  for (const s of SCENARIOS) {
    it(`scenario ${s.number} (${s.name}) matches the table`, () => {
      const b = createBattle({ id: 'b', scenarioId: s.id });
      const exp = EXPECTED[s.number];
      expect(b.board.scenarioId).toBe(s.id);
      expect(b.zones.map((z) => [z.x, z.y, z.diameter, z.friendlyTo, z.label])).toEqual(exp.zones.map(([x, y, d, f, l]) => [x, y, d, f, l]));
      expect(b.objectiveMarkers.map((m) => [m.x, m.y, m.friendlyTo, m.label])).toEqual(exp.markers.map(([x, y, f, l]) => [x, y, f, l]));
      expect(b.zones.every((z) => z.locked)).toBe(true);
      expect(b.objectiveMarkers.every((m) => m.locked && m.woundsMax === 3 && m.damageBy.p1 === 0 && m.damageBy.p2 === 0)).toBe(true);
      if (exp.noReinf) {
        expect(b.board.noReinforcement).toEqual([
          { edge: 'left', from: 12, to: 36 },
          { edge: 'right', from: 12, to: 36 },
        ]);
      } else expect(b.board.noReinforcement).toEqual([]);
    });
  }

  it('setScenario through the reducer places the same objectives', () => {
    const b = run(createBattle({ id: 'b' }), { type: 'setScenario', scenarioId: 's3' });
    expect(b.zones.map((z) => [z.x, z.y, z.diameter])).toEqual([[12, 24, 9], [36, 24, 9], [60, 24, 9]]);
    expect(b.zones.every((z) => z.locked)).toBe(true);
  });

  it('rejects any move, resize or delete of locked zones and markers', () => {
    const b = createBattle({ id: 'b', scenarioId: 's1' });
    const z = b.zones[0];
    const m = b.objectiveMarkers[0];
    const rejected: Op[] = [
      { type: 'updateZone', id: z.id, patch: { x: 13 } },
      { type: 'updateZone', id: z.id, patch: { diameter: 9 } },
      { type: 'removeZone', id: z.id },
      { type: 'updateObjectiveMarker', id: m.id, patch: { x: 1, y: 1 } },
      { type: 'removeObjectiveMarker', id: m.id },
      { type: 'addZone', zone: { id: 'nz', x: 1, y: 1, diameter: 6, locked: false } },
    ];
    for (const op of rejected) {
      const r = applyOp(b, env(op));
      expect(r.ok, op.type).toBe(false);
    }
  });

  it('allows damage and destroying a locked marker, with undo', () => {
    const b0 = createBattle({ id: 'b', scenarioId: 's1' });
    const m = b0.objectiveMarkers[0];
    let b = run(b0, { type: 'damageObjectiveMarker', id: m.id, seat: 'p2', delta: 2 }, { type: 'damageObjectiveMarker', id: m.id, seat: 'p1', delta: 1 });
    expect(b.objectiveMarkers[0].damageBy).toEqual({ p1: 1, p2: 2 });
    b = run(b, { type: 'damageObjectiveMarker', id: m.id, seat: 'p2', delta: 5 });
    expect(b.objectiveMarkers[0].damageBy.p2).toBe(3); // clamped at woundsMax
    const r = applyOp(b, env({ type: 'setObjectiveMarkerDestroyed', id: m.id, destroyed: true }));
    if (!r.ok) throw new Error(r.error);
    expect(r.battle.objectiveMarkers[0].destroyed).toBe(true);
    expect(r.log.text).toContain('destroyed');
    const undone = ok(applyOp(r.battle, env(r.inverse!)));
    expect(undone.objectiveMarkers[0].destroyed).toBe(false);
  });

  it('custom board unlocks objectives', () => {
    const b = run(createBattle({ id: 'b', scenarioId: 's1' }), { type: 'setScenario', scenarioId: 'custom' });
    expect(b.board.scenarioId).toBeUndefined();
    const moved = run(b, { type: 'updateZone', id: b.zones[0].id, patch: { x: 20 } });
    expect(moved.zones[0].x).toBe(20);
  });
});

describe('regiment ops', () => {
  it('applyWounds logs the allocation', () => {
    const b0 = run(createBattle({ id: 'b' }), { type: 'addRegiment', regiment: militia() });
    const r = applyOp(b0, env({ type: 'applyWounds', id: 'mil', count: 5 }));
    if (!r.ok) throw new Error(r.error);
    expect(r.log.text).toBe('Player 1: Militia: 5 wounds → rear-left removed, rear-right 1/4');
    expect(r.touched).toEqual(['mil']);
  });

  it('attach reflows next to the command stand; detach leaves a gap and places the stand 1" in front', () => {
    let b = run(createBattle({ id: 'b' }), { type: 'addRegiment', regiment: militia() }, { type: 'addCharacter', character: hero });
    b = run(b, { type: 'attachCharacter', characterId: 'hero', regimentId: 'mil' });
    const reg = b.regiments[0];
    expect(reg.characterSlot).toEqual({ rank: 0, file: 2 });
    expect(b.characters[0].attachedTo).toBe('mil');
    expect(b.characters[0].location).toBe('board');

    b = run(b, { type: 'detachCharacter', characterId: 'hero' });
    const after = b.regiments[0];
    expect(after.characterId).toBeUndefined();
    expect(after.stands.map((s) => s.slot)).toEqual(reg.stands.map((s) => s.slot));
    const c = b.characters[0];
    expect(c.location).toBe('board');
    expect(c.angle).toBe(0);
    // Regiment front edge is at y = 40; the stand's rear edge sits 1" in front of it.
    expect(c.y! + c.standD).toBeCloseTo(39, 9);
  });

  it('a rider joins without taking a slot and keeps its own wounds', () => {
    const rider: Character = { ...hero, id: 'rider', rider: true, standType: 'monster' };
    let b = run(createBattle({ id: 'b' }), { type: 'addRegiment', regiment: militia() }, { type: 'addCharacter', character: rider });
    const before = b.regiments[0].stands.map((s) => s.slot);
    b = run(b, { type: 'attachCharacter', characterId: 'rider', regimentId: 'mil' }, { type: 'adjustCharacterWounds', id: 'rider', delta: 2 });
    expect(b.regiments[0].characterId).toBe('rider');
    expect(b.regiments[0].characterSlot).toBeUndefined();
    expect(b.regiments[0].stands.map((s) => s.slot)).toEqual(before);
    expect(b.characters[0].wounds).toBe(2);
  });

  it('refuses a second character or one of another owner', () => {
    const villain: Character = { ...hero, id: 'v', owner: 'p2' };
    const second: Character = { ...hero, id: 'h2' };
    let b = run(
      createBattle({ id: 'b' }),
      { type: 'addRegiment', regiment: militia() },
      { type: 'addCharacter', character: hero },
      { type: 'addCharacter', character: villain },
      { type: 'addCharacter', character: second },
    );
    expect(applyOp(b, env({ type: 'attachCharacter', characterId: 'v', regimentId: 'mil' })).ok).toBe(false);
    b = run(b, { type: 'attachCharacter', characterId: 'hero', regimentId: 'mil' });
    expect(applyOp(b, env({ type: 'attachCharacter', characterId: 'h2', regimentId: 'mil' })).ok).toBe(false);
  });

  it('restoring a casualty returns it to its old slot', () => {
    let b = run(createBattle({ id: 'b' }), { type: 'addRegiment', regiment: militia() }, { type: 'applyWounds', id: 'mil', count: 4 });
    const cas = b.regiments[0].casualties[0];
    b = run(b, { type: 'restoreStand', id: 'mil', standId: cas.id });
    const s = b.regiments[0].stands.find((x) => x.id === cas.id)!;
    expect(s.slot).toEqual(cas.slot);
    expect(s.wounds).toBe(0);
  });
});

describe('reducer determinism and undo', () => {
  const script = (): OpEnvelope[] => {
    let k = 0;
    const e = (op: Op, by: OpEnvelope['by'] = 'p1'): OpEnvelope => ({ id: `d${++k}`, by, at: 1000 + k, op });
    return [
      e({ type: 'setScenario', scenarioId: 's4' }),
      e({ type: 'setTerrainLayout', layoutId: 'layout2', garrisonBuildings: true }),
      e({ type: 'addRegiment', regiment: militia() }),
      e({ type: 'addCharacter', character: hero }),
      e({ type: 'attachCharacter', characterId: 'hero', regimentId: 'mil' }),
      e({ type: 'moveRegiment', id: 'mil', pose: { x: 31, y: 34, angle: 15 }, summary: 'forward 6.0"' }),
      e({ type: 'applyWounds', id: 'mil', count: 5 }),
      e({ type: 'addStands', id: 'mil', count: 2 }),
      e({ type: 'damageObjectiveMarker', id: 'd1-m0', seat: 'p2', delta: 1 }, 'p2'),
      e({ type: 'updateRegiment', id: 'mil', patch: { tags: ['Activated'], notes: 'hold the line' } }),
      e({ type: 'reformRegiment', id: 'mil', files: 4 }),
      e({ type: 'chat', text: 'good luck' }, 'p2'),
    ];
  };

  it('same operations in the same order give identical JSON', () => {
    const a0 = createBattle({ id: 'x' });
    const b0 = JSON.parse(JSON.stringify(a0)) as Battle;
    let a = a0;
    let b = b0;
    for (const e of script()) {
      const ra = applyOp(a, e);
      const rb = applyOp(b, JSON.parse(JSON.stringify(e)));
      expect(ra.ok).toBe(true);
      a = ok(ra);
      b = ok(rb);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.seq).toBe(12);
    expect(a.terrain.filter((t) => t.keywords.includes('Garrison'))).toHaveLength(2);
  });

  it('every inverse restores the previous state', () => {
    let b = createBattle({ id: 'x' });
    for (const e of script()) {
      const r = applyOp(b, e);
      if (!r.ok) throw new Error(r.error);
      if (r.inverse) {
        const back = ok(applyOp(r.battle, { id: `inv-${e.id}`, by: e.by, at: e.at, op: r.inverse }));
        const strip = (x: Battle) => JSON.stringify({ ...x, seq: 0, log: [] });
        expect(strip(back), e.op.type).toBe(strip(b));
      }
      b = r.battle;
    }
  });

  it('input battles are never mutated', () => {
    const b = createBattle({ id: 'x' });
    const frozen = JSON.stringify(b);
    let cur = b;
    for (const e of script()) cur = ok(applyOp(cur, e));
    expect(JSON.stringify(b)).toBe(frozen);
  });
});
