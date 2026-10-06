// Army lists: a player's regiments and characters at full strength, saved to
// a file once and loaded at the start of each game. Positions, wounds and
// casualties are not part of a list; loading puts everything in reserve.

import { autoLayout, createRegiment } from './regiment';
import type { Op } from './ops';
import type { Battle, Character, PlayerSeat, StandType } from './types';

export const ARMY_FORMAT = 'conquest-army';
export const ARMY_VERSION = 1;

export interface ArmyRegiment {
  name: string;
  standType: StandType;
  stands: number;
  files: number;
  woundsMax: number;
  standW: number;
  standD: number;
  size: number;
  command: boolean;
  march?: number;
  barrageRange?: number;
  notes?: string;
  tags?: string[];
  /** Index into `characters` of the character that starts with this regiment. */
  character?: number;
}

export interface ArmyCharacter {
  name: string;
  standType: StandType;
  standW: number;
  standD: number;
  woundsMax: number;
  rider?: boolean;
  notes?: string;
}

export interface ArmyList {
  format: typeof ARMY_FORMAT;
  version: number;
  name: string;
  regiments: ArmyRegiment[];
  characters: ArmyCharacter[];
}

const STAND_TYPES: StandType[] = ['infantry', 'cavalry', 'brute', 'chariot', 'monster', 'custom'];

/** The seat's army as a list, at full strength (casualties counted back in). */
export function armyFromBattle(b: Battle, seat: PlayerSeat, name = `${b.players[seat].name}'s army`): ArmyList {
  const chars = b.characters.filter((c) => c.owner === seat && c.location !== 'destroyed');
  const charIndex = new Map(chars.map((c, i) => [c.id, i]));
  const regiments = b.regiments
    .filter((r) => r.owner === seat)
    .map((r): ArmyRegiment => {
      const all = [...r.stands, ...r.casualties];
      const ci = r.characterId !== undefined ? charIndex.get(r.characterId) : undefined;
      return {
        name: r.name,
        standType: r.standType,
        stands: all.length,
        files: r.files,
        woundsMax: all[0]?.woundsMax ?? 1,
        standW: r.standW,
        standD: r.standD,
        size: r.size,
        command: all.some((s) => s.isCommand),
        ...(r.march !== undefined ? { march: r.march } : {}),
        ...(r.barrageRange !== undefined ? { barrageRange: r.barrageRange } : {}),
        ...(r.notes ? { notes: r.notes } : {}),
        ...(r.tags.length ? { tags: r.tags } : {}),
        ...(ci !== undefined ? { character: ci } : {}),
      };
    });
  const characters = chars.map(
    (c): ArmyCharacter => ({
      name: c.name,
      standType: c.standType,
      standW: c.standW,
      standD: c.standD,
      woundsMax: c.woundsMax,
      ...(c.rider ? { rider: true } : {}),
      ...(c.notes ? { notes: c.notes } : {}),
    }),
  );
  return { format: ARMY_FORMAT, version: ARMY_VERSION, name, regiments, characters };
}

/**
 * Check a loaded file. Returns the cleaned list or a short reason. The server
 * still validates every operation the list turns into.
 */
export function parseArmy(raw: unknown): { ok: true; army: ArmyList } | { ok: false; error: string } {
  const o = raw as Partial<ArmyList> | null;
  if (!o || typeof o !== 'object' || o.format !== ARMY_FORMAT) return { ok: false, error: 'This is not an army list file' };
  if ((o.version ?? 0) > ARMY_VERSION) return { ok: false, error: 'This army list was made by a newer version' };
  if (!Array.isArray(o.regiments) || !Array.isArray(o.characters)) return { ok: false, error: 'The army list has no regiments' };
  if (o.regiments.length > 60 || o.characters.length > 30) return { ok: false, error: 'The army list is too big' };
  const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
  const optNum = (v: unknown, lo: number, hi: number) => v === undefined || num(v, lo, hi);
  for (const [i, r] of o.regiments.entries()) {
    const ok =
      r &&
      str(r.name, 80) &&
      STAND_TYPES.includes(r.standType) &&
      num(r.stands, 1, 100) &&
      num(r.files, 1, 60) &&
      num(r.woundsMax, 1, 99) &&
      num(r.standW, 0.1, 50) &&
      num(r.standD, 0.1, 50) &&
      num(r.size, 0, 10) &&
      typeof r.command === 'boolean' &&
      optNum(r.march, 0, 100) &&
      optNum(r.barrageRange, 0, 100) &&
      (r.notes === undefined || str(r.notes, 5000)) &&
      (r.tags === undefined || (Array.isArray(r.tags) && r.tags.length <= 30 && r.tags.every((t) => str(t, 40)))) &&
      (r.character === undefined || (Number.isInteger(r.character) && r.character >= 0 && r.character < o.characters.length));
    if (!ok) return { ok: false, error: `Regiment ${i + 1} in the list is not valid` };
  }
  for (const [i, c] of o.characters.entries()) {
    const ok =
      c &&
      str(c.name, 80) &&
      STAND_TYPES.includes(c.standType) &&
      num(c.standW, 0.1, 50) &&
      num(c.standD, 0.1, 50) &&
      num(c.woundsMax, 1, 99) &&
      (c.rider === undefined || typeof c.rider === 'boolean') &&
      (c.notes === undefined || str(c.notes, 5000));
    if (!ok) return { ok: false, error: `Character ${i + 1} in the list is not valid` };
  }
  const used = o.regiments.map((r) => r.character).filter((x) => x !== undefined);
  if (new Set(used).size !== used.length) return { ok: false, error: 'A character is listed with two regiments' };
  return { ok: true, army: { ...(o as ArmyList), name: str(o.name, 120) ? o.name! : 'Army' } };
}

/** The operations that add the list to a seat's reserve. */
export function armyOps(army: ArmyList, seat: PlayerSeat, newId: () => string): Op[] {
  const ops: Op[] = [];
  const regIds = army.regiments.map(() => newId());
  const charIds = army.characters.map(() => newId());
  army.regiments.forEach((a, i) => {
    const id = regIds[i];
    const reg = createRegiment({
      id,
      owner: seat,
      name: a.name,
      standType: a.standType,
      preset: { w: a.standW, d: a.standD, size: a.size },
      stands: a.stands,
      files: a.files,
      woundsMax: a.woundsMax,
      location: 'reserve',
    });
    // The command stand as saved (createRegiment follows the stand type).
    const stands = reg.stands.map((s, i) => ({ ...s, isCommand: a.command && i === 0 }));
    const slots = autoLayout(stands, reg.files);
    ops.push({
      type: 'addRegiment',
      regiment: {
        ...reg,
        stands: stands.map((s) => ({ ...s, slot: slots.get(s.id)! })),
        notes: a.notes ?? '',
        tags: a.tags ?? [],
        ...(a.march !== undefined ? { march: a.march } : {}),
        ...(a.barrageRange !== undefined ? { barrageRange: a.barrageRange } : {}),
      },
    });
  });
  army.characters.forEach((a, i) => {
    const c: Character = {
      id: charIds[i],
      owner: seat,
      name: a.name,
      notes: a.notes ?? '',
      standType: a.standType,
      standW: a.standW,
      standD: a.standD,
      woundsMax: a.woundsMax,
      wounds: 0,
      location: 'reserve',
      ...(a.rider ? { rider: true } : {}),
    };
    ops.push({ type: 'addCharacter', character: c });
  });
  army.regiments.forEach((a, i) => {
    if (a.character !== undefined) ops.push({ type: 'attachCharacter', characterId: charIds[a.character], regimentId: regIds[i] });
  });
  return ops;
}
