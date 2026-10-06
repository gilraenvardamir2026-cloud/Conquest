import { describe, expect, it } from 'vitest';
import { availableCards, dealStack, lastRevealed, reserveCards, type StackAction } from './command';
import { createBattle } from './board';
import { STAND_PRESETS } from './presets';
import { applyOp } from './reducer';
import { createRegiment } from './regiment';
import type { Battle, CommandCard, PlayerSeat } from './types';
import type { Op } from './ops';

let n = 0;
const run = (b: Battle, op: Op, at = n) => {
  const r = applyOp(b, { id: `op${n++}`, by: 'system', at, op });
  if (!r.ok) throw new Error(r.error);
  return r;
};
const reg = (id: string, owner: PlayerSeat, location: 'board' | 'reserve' | 'destroyed' = 'board') =>
  createRegiment({ id, owner, name: id, standType: 'infantry', preset: STAND_PRESETS.infantry, stands: 3, files: 3, woundsMax: 4, location });

/** A dealer in miniature: one seat's secret plus the battle, as the server keeps them. */
function table() {
  let b = createBattle({ id: 'b' });
  for (const r of [reg('mil', 'p1'), reg('bow', 'p1', 'reserve'), reg('dead', 'p1', 'destroyed'), reg('raid', 'p2')]) b = run(b, { type: 'addRegiment', regiment: r }).battle;
  b = run(b, { type: 'addCharacter', character: { id: 'hero', owner: 'p1', name: 'Hero', notes: '', standType: 'infantry', standW: 2, standD: 2, woundsMax: 5, wounds: 0, location: 'reserve' } }).battle;
  b = run(b, { type: 'attachCharacter', characterId: 'hero', regimentId: 'mil' }).battle;
  let secret: CommandCard[] = [];
  const act = (a: StackAction, at = n) => {
    const d = dealStack(b, 'p1', secret, a);
    if (!d.ok) return d.error;
    if (d.op) {
      const r = applyOp(b, { id: `op${n++}`, by: 'system', at, op: d.op });
      if (!r.ok) return r.error;
      b = r.battle;
    }
    secret = d.secret;
    return null;
  };
  return { get b() { return b; }, get secret() { return secret; }, act };
}

describe('command stacks', () => {
  it('offers every regiment and character not destroyed', () => {
    const t = table();
    expect(availableCards(t.b, 'p1').map((c) => c.id)).toEqual(['mil', 'bow', 'hero']);
  });

  it('builds, locks, flips in order, takes back and clears', () => {
    const t = table();
    expect(t.act({ t: 'set', cards: [{ kind: 'regiment', id: 'raid' }] })).toContain('not one of your units');
    expect(t.act({ t: 'set', cards: [{ kind: 'regiment', id: 'dead' }] })).toContain('not one of your units');
    expect(t.act({ t: 'set', cards: [{ kind: 'regiment', id: 'mil' }, { kind: 'regiment', id: 'mil' }] })).toContain('twice');
    expect(t.act({ t: 'lock' })).toContain('at least one');
    expect(t.act({ t: 'set', cards: [{ kind: 'character', id: 'hero' }, { kind: 'regiment', id: 'bow' }, { kind: 'regiment', id: 'mil' }] })).toBeNull();
    // Building is secret: nothing public yet.
    expect(t.b.command.p1).toEqual({ round: 0, locked: false, size: 0, revealed: [] });

    expect(t.act({ t: 'lock' })).toBeNull();
    expect(t.b.command.p1).toMatchObject({ round: 1, locked: true, size: 3, revealed: [] });
    expect(t.b.log.at(-1)!.text).toBe('System: locked a command stack of 3 cards for round 1');
    expect(t.act({ t: 'set', cards: [] })).toContain('locked');

    expect(t.act({ t: 'flip' }, 100)).toBeNull();
    expect(t.b.command.p1.revealed.map((c) => c.name)).toEqual(['Hero']);
    expect(t.b.log.at(-1)!.text).toBe('System: command card 1/3: Hero');
    expect(t.secret.map((c) => c.id)).toEqual(['bow', 'mil']);
    expect(t.act({ t: 'unlock' })).toContain('flipped already');

    expect(t.act({ t: 'unflip' })).toBeNull();
    expect(t.secret.map((c) => c.id)).toEqual(['hero', 'bow', 'mil']);
    for (const at of [101, 102, 103]) expect(t.act({ t: 'flip' }, at)).toBeNull();
    expect(t.act({ t: 'flip' })).toContain('No cards left');
    expect(lastRevealed(t.b)).toMatchObject({ seat: 'p1', name: 'mil', at: 103 });

    expect(t.act({ t: 'clear' })).toBeNull();
    expect(t.b.command.p1).toEqual({ round: 1, locked: false, size: 0, revealed: [] });
    expect(t.secret).toEqual([]);
  });

  it('unlocking before any flip lets the player rebuild and keeps the round number', () => {
    const t = table();
    t.act({ t: 'set', cards: [{ kind: 'regiment', id: 'mil' }] });
    t.act({ t: 'lock' });
    expect(t.act({ t: 'unlock' })).toBeNull();
    expect(t.b.command.p1).toMatchObject({ round: 0, locked: false });
    expect(t.secret.map((c) => c.id)).toEqual(['mil']);
  });

  it('a reserve card can join a locked stack at any position; on-board units cannot', () => {
    const t = table();
    t.act({ t: 'set', cards: [{ kind: 'regiment', id: 'mil' }, { kind: 'character', id: 'hero' }] });
    expect(t.act({ t: 'insert', card: { kind: 'regiment', id: 'bow' }, position: 0 })).toContain('Lock the stack first');
    t.act({ t: 'lock' });
    t.act({ t: 'flip' });
    // Hero rides with Men-at-Arms on the board; Bow is in reserve.
    expect(reserveCards(t.b, 'p1', t.secret).map((c) => c.id)).toEqual(['bow']);
    expect(t.act({ t: 'insert', card: { kind: 'regiment', id: 'mil' }, position: 0 })).toContain('Only a reserve unit');
    expect(t.act({ t: 'insert', card: { kind: 'regiment', id: 'bow' }, position: 99 })).toBeNull();
    expect(t.secret.map((c) => c.id)).toEqual(['hero', 'bow']);
    expect(t.b.command.p1).toMatchObject({ size: 3, revealed: [{ id: 'mil' }] });
    // Which card and where stay secret.
    expect(t.b.log.at(-1)!.text).toBe('System: added a reserve card to the command stack (now 3 cards)');
    expect(t.act({ t: 'insert', card: { kind: 'regiment', id: 'bow' }, position: 0 })).toContain('Only a reserve unit');
    expect(reserveCards(t.b, 'p1', t.secret)).toEqual([]);
  });

  it('players cannot send stack operations themselves', async () => {
    const { authorize } = await import('./auth');
    const t = table();
    expect(authorize(t.b, 'p1', { type: 'revealCommandCard', seat: 'p1', card: { kind: 'regiment', id: 'mil', name: 'mil' } })).not.toBeNull();
  });
});
