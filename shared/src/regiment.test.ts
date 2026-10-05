import { describe, expect, it } from 'vitest';
import { allocateWounds, autoLayout, createRegiment, nextWoundTarget, reflowRegiment, slotName } from './regiment';
import { STAND_PRESETS } from './presets';
import type { Regiment, Slot } from './types';

const militia = (stands = 6, files = 3): Regiment =>
  createRegiment({
    id: 'mil',
    owner: 'p1',
    name: 'Militia',
    standType: 'infantry',
    preset: STAND_PRESETS.infantry,
    stands,
    files,
    woundsMax: 4,
  });

const slotOf = (r: Regiment, id: string): Slot | undefined =>
  (r.stands.find((s) => s.id === id) ?? r.casualties.find((s) => s.id === id))?.slot;

describe('auto layout', () => {
  it('3 × 2 puts the command stand front centre', () => {
    const r = militia();
    const cmd = r.stands.find((s) => s.isCommand)!;
    expect(cmd.slot).toEqual({ rank: 0, file: 1 });
    expect(r.stands.map((s) => slotName(r, s.slot)).sort()).toEqual(
      ['front-centre', 'front-left', 'front-right', 'rear-centre', 'rear-left', 'rear-right'].sort(),
    );
  });

  it('command sits left of centre in an even front rank', () => {
    const r = militia(4, 4);
    expect(r.stands.find((s) => s.isCommand)!.slot).toEqual({ rank: 0, file: 1 });
  });

  it('an incomplete rear rank is centred', () => {
    const slots = autoLayout(
      ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, isCommand: i === 0 })),
      3,
    );
    expect(slots.get('d')).toEqual({ rank: 1, file: 0.5 });
    expect(slots.get('e')).toEqual({ rank: 1, file: 1.5 });
  });

  it('a character takes the slot next to the command stand (right by default, or left)', () => {
    const items = [{ id: 'c', isCommand: true }, { id: 'x' }, { id: 'y' }, { id: 'h', isCharacter: true }];
    const right = autoLayout(items, 4, 'right');
    expect(right.get('c')).toEqual({ rank: 0, file: 1 });
    expect(right.get('h')).toEqual({ rank: 0, file: 2 });
    const left = autoLayout(items, 4, 'left');
    expect(left.get('h')).toEqual({ rank: 0, file: 0 });
    expect(left.get('c')).toEqual({ rank: 0, file: 1 });
  });

  it('reflow keeps stand order and inserts the character', () => {
    const r = { ...militia(), characterId: 'hero', characterSlot: { rank: 0, file: -1 } };
    const f = reflowRegiment(r, 3, 'right');
    expect(f.characterSlot).toEqual({ rank: 0, file: 2 });
    expect(f.stands.find((s) => s.isCommand)!.slot).toEqual({ rank: 0, file: 1 });
    // 7 items in 3 files: 3 + 3 + 1 (centred)
    expect(f.stands.filter((s) => s.slot.rank === 2)).toHaveLength(1);
    expect(f.stands.find((s) => s.slot.rank === 2)!.slot.file).toBe(1);
  });
});

describe('wound allocation', () => {
  it('3 × 2 regiment, wounds 4: 5 wounds then 4 more', () => {
    const r0 = militia();
    const before = new Map(r0.stands.map((s) => [s.id, s.slot]));
    const rearLeft = r0.stands.find((s) => s.slot.rank === 1 && s.slot.file === 0)!;
    const rearRight = r0.stands.find((s) => s.slot.rank === 1 && s.slot.file === 2)!;
    const rearCentre = r0.stands.find((s) => s.slot.rank === 1 && s.slot.file === 1)!;

    const a = allocateWounds(r0, 5);
    expect(a.steps).toEqual(['rear-left removed', 'rear-right 1/4']);
    expect(a.regiment.stands.map((s) => s.id)).not.toContain(rearLeft.id);
    expect(a.regiment.casualties.map((s) => s.id)).toEqual([rearLeft.id]);
    expect(a.regiment.stands.find((s) => s.id === rearRight.id)!.wounds).toBe(1);
    expect(a.regiment.stands.filter((s) => s.wounds > 0)).toHaveLength(1);

    const b = allocateWounds(a.regiment, 4);
    expect(b.steps).toEqual(['rear-right removed', 'rear-centre 1/4']);
    expect(b.regiment.casualties.map((s) => s.id)).toEqual([rearLeft.id, rearRight.id]);
    expect(b.regiment.stands.find((s) => s.id === rearCentre.id)!.wounds).toBe(1);

    // No stand changed slot, casualties included.
    for (const [id, slot] of before) expect(slotOf(b.regiment, id)).toEqual(slot);
  });

  it('when the rear rank empties the next rank becomes the rearmost; command is last', () => {
    let r = militia();
    r = allocateWounds(r, 12).regiment; // whole rear rank gone
    expect(r.stands.every((s) => s.slot.rank === 0)).toBe(true);
    const next = nextWoundTarget(r)!;
    expect(next.isCommand).toBe(false);
    expect(next.slot).toEqual({ rank: 0, file: 0 }); // tie between front-left and front-right → left first
    r = allocateWounds(r, 8).regiment;
    expect(r.stands).toHaveLength(1);
    expect(r.stands[0].isCommand).toBe(true);
    const last = allocateWounds(r, 6);
    expect(last.regiment.stands).toHaveLength(0);
    expect(last.unallocated).toBe(2);
  });

  it('a wounded stand keeps taking wounds before anything else', () => {
    let r = militia();
    const frontLeft = r.stands.find((s) => s.slot.rank === 0 && s.slot.file === 0)!;
    r = { ...r, stands: r.stands.map((s) => (s.id === frontLeft.id ? { ...s, wounds: 1 } : s)) };
    expect(nextWoundTarget(r)!.id).toBe(frontLeft.id);
  });

  it('without auto-remove a stand waits at max and is skipped', () => {
    const r = allocateWounds(militia(), 5, false);
    expect(r.steps).toEqual(['rear-left 4/4 (to remove)', 'rear-right 1/4']);
    expect(r.regiment.casualties).toHaveLength(0);
  });
});
