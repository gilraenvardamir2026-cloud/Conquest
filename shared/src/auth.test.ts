import { describe, expect, it } from 'vitest';
import { authorize } from './auth';
import { createBattle } from './board';
import { applyOp } from './reducer';
import { createRegiment } from './regiment';
import { STAND_PRESETS } from './presets';
import { clientMsgSchema, clientOpSchema, parseClientMsg } from './schema';
import type { Op } from './ops';
import type { Battle, DiceRoll } from './types';

const mil = (owner: 'p1' | 'p2', id = 'mil') =>
  createRegiment({ id, owner, name: id, standType: 'infantry', preset: STAND_PRESETS.infantry, stands: 3, files: 3, woundsMax: 4, location: 'board', x: 30, y: 40 });

const base = (): Battle => ({ ...createBattle({ id: 'b', scenarioId: 's1', layoutId: 'layout1' }), regiments: [mil('p1')] });

describe('authorize', () => {
  it('players edit only their own regiments, unless anyone-can-edit is on', () => {
    const b = base();
    const move: Op = { type: 'moveRegiment', id: 'mil', pose: { x: 1, y: 1, angle: 0 } };
    expect(authorize(b, 'p1', move)).toBeNull();
    expect(authorize(b, 'p2', move)).toContain('belongs to the other player');
    expect(authorize(b, 'p2', { type: 'applyWounds', id: 'mil', count: 1 })).not.toBeNull();
    expect(authorize(b, 'p2', { type: 'addRegiment', regiment: mil('p1', 'x') })).not.toBeNull();
    expect(authorize(b, 'p2', { type: 'updateRegiment', id: 'mil', patch: { owner: 'p2' } })).not.toBeNull();
    const casual = { ...b, settings: { ...b.settings, anyoneCanEdit: true } };
    expect(authorize(casual, 'p2', move)).toBeNull();
  });

  it('terrain and objectives are shared until the board is locked; marker damage always works', () => {
    const b = base();
    const t = b.terrain[0];
    const edit: Op = { type: 'updateTerrain', id: t.id, patch: { x: 10 } };
    expect(authorize(b, 'p2', edit)).toBeNull();
    const locked = { ...b, settings: { ...b.settings, boardLocked: true } };
    expect(authorize(locked, 'p2', edit)).toContain('locked');
    expect(authorize(locked, 'p1', { type: 'setScenario', scenarioId: 's2' })).toContain('locked');
    expect(authorize(locked, 'p1', { type: 'updateBoard', patch: { grid: 6 } })).toBeNull();
    expect(authorize(locked, 'p2', { type: 'damageObjectiveMarker', id: b.objectiveMarkers[0].id, seat: 'p2', delta: 1 })).toBeNull();
  });

  it('spectators only chat; dice, restore and replaceBattle come from the server', () => {
    const b = base();
    expect(authorize(b, 'spectator', { type: 'chat', text: 'hi' })).toBeNull();
    expect(authorize(b, 'spectator', { type: 'renameBattle', name: 'x' })).not.toBeNull();
    expect(authorize(b, 'p1', { type: 'restore', label: 'x', entries: [] })).not.toBeNull();
    expect(authorize(b, 'p1', { type: 'rerollDice', id: 'r', indices: [0], values: [6], source: 'local' })).not.toBeNull();
  });

  it('players rename only their own seat', () => {
    const b = base();
    expect(authorize(b, 'p1', { type: 'updatePlayer', seat: 'p1', patch: { name: 'Al' } })).toBeNull();
    expect(authorize(b, 'p1', { type: 'updatePlayer', seat: 'p2', patch: { name: 'Al' } })).not.toBeNull();
  });
});

describe('message schemas', () => {
  it('accepts well-formed operations and strips unknown keys', () => {
    const ops: Op[] = [
      { type: 'addRegiment', regiment: mil('p1') },
      { type: 'moveRegiment', id: 'mil', pose: { x: 1.5, y: 2, angle: 90 }, summary: 'forward 6.0"' },
      { type: 'applyWounds', id: 'mil', count: 5, choices: ['mil-s3'] },
      { type: 'updateTerrain', id: 't', patch: { garrison: null, size: 2 } },
      { type: 'addMeasurement', measurement: { id: 'm', kind: 'ring', by: 'p1', ref: { kind: 'regiment', id: 'mil' }, radius: 9, label: 'March' } },
      { type: 'chat', text: 'hello' },
    ];
    for (const op of ops) expect(clientOpSchema.safeParse(op).success, op.type).toBe(true);
    const r = clientOpSchema.parse({ type: 'chat', text: 'hi', sneaky: 1 });
    expect(r).toEqual({ type: 'chat', text: 'hi' });
  });

  it('rejects bad shapes, non-finite numbers, oversize text and server-only ops', () => {
    expect(clientOpSchema.safeParse({ type: 'moveRegiment', id: 'mil', pose: { x: Infinity, y: 0, angle: 0 } }).success).toBe(false);
    expect(clientOpSchema.safeParse({ type: 'moveRegiment', id: 'mil', pose: { x: '1', y: 0, angle: 0 } }).success).toBe(false);
    expect(clientOpSchema.safeParse({ type: 'chat', text: 'x'.repeat(501) }).success).toBe(false);
    expect(clientOpSchema.safeParse({ type: 'rollDice', roll: {} }).success).toBe(false);
    expect(clientOpSchema.safeParse({ type: 'restore', label: 'x', entries: [] }).success).toBe(false);
    expect(clientOpSchema.safeParse({ type: 'nope' }).success).toBe(false);
    expect(parseClientMsg({ t: 'roll', count: 61, label: '' }).ok).toBe(false);
    expect(clientMsgSchema.safeParse({ t: 'hello', room: 'ABCDEF', token: 'short' }).success).toBe(false);
  });
});

describe('dice operations', () => {
  const roll = (id: string, results: number[]): DiceRoll => ({ id, by: 'p1', label: 'Clash', at: 1, results, rerolled: results.map(() => false), source: 'random.org', kind: 'roll', target: 3 });
  const env = (op: Op, n: number) => ({ id: `e${n}`, by: 'p1' as const, at: n, op });

  it('a die cannot be re-rolled twice; a local re-roll marks the roll local', () => {
    let b = createBattle({ id: 'b' });
    let r = applyOp(b, env({ type: 'rollDice', roll: roll('r1', [1, 2, 4, 6]) }, 1));
    if (!r.ok) throw new Error(r.error);
    expect(r.log.text).toBe('Player 1: rolled 4 dice for "Clash": 1, 2, 4, 6 (random.org) · 2 successes (≤ 3)');
    b = r.battle;
    r = applyOp(b, env({ type: 'rerollDice', id: 'r1', indices: [2, 3], values: [3, 1], source: 'local' }, 2));
    if (!r.ok) throw new Error(r.error);
    expect(r.battle.dice[0].results).toEqual([1, 2, 3, 1]);
    expect(r.battle.dice[0].rerolled).toEqual([false, false, true, true]);
    expect(r.battle.dice[0].source).toBe('local');
    expect(r.log.text).toContain('re-rolled 2 dice');
    const again = applyOp(r.battle, env({ type: 'rerollDice', id: 'r1', indices: [3], values: [6], source: 'local' }, 3));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain('only once');
  });

  it('the tray keeps the last 20 rolls', () => {
    let b = createBattle({ id: 'b' });
    for (let i = 0; i < 25; i++) {
      const r = applyOp(b, env({ type: 'rollDice', roll: roll(`r${i}`, [i % 6 + 1]) }, i + 1));
      if (!r.ok) throw new Error(r.error);
      b = r.battle;
    }
    expect(b.dice).toHaveLength(20);
    expect(b.dice[0].id).toBe('r5');
  });
});
