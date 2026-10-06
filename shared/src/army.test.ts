import { describe, expect, it } from 'vitest';
import { armyFromBattle, armyOps, parseArmy } from './army';
import { createBattle } from './board';
import { STAND_PRESETS } from './presets';
import { applyOp } from './reducer';
import { createRegiment } from './regiment';
import type { Battle, Character } from './types';
import type { Op } from './ops';

let n = 0;
const run = (b: Battle, ...ops: Op[]) =>
  ops.reduce((acc, op) => {
    const r = applyOp(acc, { id: `op${n++}`, by: 'p1', at: 0, op });
    if (!r.ok) throw new Error(r.error);
    return r.battle;
  }, b);

const hero: Character = { id: 'hero', owner: 'p1', name: 'Hero', notes: 'brave', standType: 'infantry', standW: 1.57, standD: 1.57, woundsMax: 5, wounds: 0, location: 'reserve' };

describe('army lists', () => {
  it('round-trips a seat at full strength, with characters, into the reserve', () => {
    const mil = createRegiment({ id: 'mil', owner: 'p1', name: 'Militia', standType: 'infantry', preset: STAND_PRESETS.infantry, stands: 6, files: 3, woundsMax: 4, location: 'board', x: 10, y: 30 });
    let b = run(createBattle({ id: 'b' }), { type: 'addRegiment', regiment: { ...mil, march: 5, tags: ['Light'] } }, { type: 'addCharacter', character: hero });
    b = run(b, { type: 'attachCharacter', characterId: 'hero', regimentId: 'mil' }, { type: 'applyWounds', id: 'mil', count: 9 });
    expect(b.regiments[0].casualties.length).toBe(2);

    const list = armyFromBattle(b, 'p1', 'Test army');
    expect(list.regiments).toHaveLength(1);
    expect(list.regiments[0]).toMatchObject({ name: 'Militia', stands: 6, files: 3, woundsMax: 4, command: true, march: 5, tags: ['Light'], character: 0 });
    expect(list.characters[0]).toMatchObject({ name: 'Hero', woundsMax: 5, notes: 'brave' });

    // Through JSON, as a file would go, then into the other seat of a new battle.
    const parsed = parseArmy(JSON.parse(JSON.stringify(list)));
    if (!parsed.ok) throw new Error(parsed.error);
    let i = 0;
    const ops = armyOps(parsed.army, 'p2', () => `id${i++}`);
    let b2 = createBattle({ id: 'b2' });
    for (const op of ops) {
      const r = applyOp(b2, { id: `x${i++}`, by: 'p2', at: 0, op });
      if (!r.ok) throw new Error(r.error);
      b2 = r.battle;
    }
    const [r] = b2.regiments;
    expect(r).toMatchObject({ owner: 'p2', name: 'Militia', location: 'reserve', march: 5, casualties: [] });
    expect(r.stands).toHaveLength(6);
    expect(r.stands.every((s) => s.wounds === 0)).toBe(true);
    expect(r.characterId).toBe(b2.characters[0].id);
    expect(b2.characters[0]).toMatchObject({ owner: 'p2', attachedTo: r.id, location: 'reserve' });
  });

  it('rejects files that are not army lists or have bad entries', () => {
    expect(parseArmy({ hello: 1 }).ok).toBe(false);
    expect(parseArmy(null).ok).toBe(false);
    const good = { format: 'conquest-army', version: 1, name: 'A', regiments: [], characters: [] };
    expect(parseArmy(good).ok).toBe(true);
    const reg = { name: 'R', standType: 'infantry', stands: 3, files: 3, woundsMax: 4, standW: 1.57, standD: 1.57, size: 1, command: true };
    expect(parseArmy({ ...good, regiments: [{ ...reg, stands: 0 }] }).ok).toBe(false);
    expect(parseArmy({ ...good, regiments: [{ ...reg, standType: 'dragon' }] }).ok).toBe(false);
    expect(parseArmy({ ...good, regiments: [{ ...reg, character: 0 }] }).ok).toBe(false);
    expect(parseArmy({ ...good, version: 99 }).ok).toBe(false);
  });
});
