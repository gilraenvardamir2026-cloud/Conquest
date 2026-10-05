// Regiment formation: slot layout, derived world geometry and wound allocation.
//
// A regiment's world geometry is always derived from its pose (x, y, angle of
// the front-left corner), the stand footprint and each stand's slot. Stands
// keep their slot until the user reforms, so a removed stand leaves a gap.

import { localToWorld, type Frame, type Polygon, type Vec } from './geometry';
import { HAS_COMMAND } from './presets';
import type { Character, Regiment, Slot, Stand, StandPreset, StandType } from './types';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

type Footprint = Pick<Regiment, 'x' | 'y' | 'angle' | 'standW' | 'standD'>;

/** World polygon of one slot (front-left, front-right, rear-right, rear-left). */
export function slotPolygon(reg: Footprint, slot: Slot): Polygon {
  const u0 = slot.file * reg.standW;
  const v0 = slot.rank * reg.standD;
  const u1 = u0 + reg.standW;
  const v1 = v0 + reg.standD;
  return [localToWorld(reg, u0, v0), localToWorld(reg, u1, v0), localToWorld(reg, u1, v1), localToWorld(reg, u0, v1)];
}

export interface StandGeom {
  kind: 'stand' | 'character';
  /** Stand id, or character id for the character's slot. */
  id: string;
  slot: Slot;
  poly: Polygon;
}

/** Every occupied slot of the regiment, including an attached character's. */
export function regimentStandGeoms(reg: Regiment): StandGeom[] {
  const out: StandGeom[] = reg.stands.map((s) => ({ kind: 'stand' as const, id: s.id, slot: s.slot, poly: slotPolygon(reg, s.slot) }));
  if (reg.characterId && reg.characterSlot) {
    out.push({ kind: 'character', id: reg.characterId, slot: reg.characterSlot, poly: slotPolygon(reg, reg.characterSlot) });
  }
  return out;
}

export const regimentPolygons = (reg: Regiment): Polygon[] => regimentStandGeoms(reg).map((g) => g.poly);

export function occupiedSlots(reg: Regiment): Slot[] {
  const slots = reg.stands.map((s) => s.slot);
  if (reg.characterId && reg.characterSlot) slots.push(reg.characterSlot);
  return slots;
}

/** Local bounding box (u right, v back) of the occupied slots. Falls back to one empty rank. */
export function regimentLocalBox(reg: Regiment): { u0: number; u1: number; v0: number; v1: number } {
  const slots = occupiedSlots(reg);
  if (slots.length === 0) return { u0: 0, u1: Math.max(1, reg.files) * reg.standW, v0: 0, v1: reg.standD };
  let fMin = Infinity;
  let fMax = -Infinity;
  let rMax = 0;
  for (const s of slots) {
    fMin = Math.min(fMin, s.file);
    fMax = Math.max(fMax, s.file);
    rMax = Math.max(rMax, s.rank);
  }
  return { u0: fMin * reg.standW, u1: (fMax + 1) * reg.standW, v0: 0, v1: (rMax + 1) * reg.standD };
}

/**
 * The regiment's full bounding rectangle (most complete rank × number of
 * ranks, gaps ignored), as used for facing arcs and wheel width.
 */
export function regimentFrame(reg: Regiment): Frame {
  const b = regimentLocalBox(reg);
  const o = localToWorld(reg, b.u0, 0);
  return { x: o.x, y: o.y, angle: reg.angle, w: b.u1 - b.u0, d: b.v1 };
}

export function regimentCenter(reg: Regiment): Vec {
  const b = regimentLocalBox(reg);
  return localToWorld(reg, (b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2);
}

/** Polygon of a character drawn on its own (front-left pose). */
export function characterPolygon(ch: Character): Polygon | null {
  if (ch.x === undefined || ch.y === undefined) return null;
  const pose = { x: ch.x, y: ch.y, angle: ch.angle ?? 0 };
  return [
    localToWorld(pose, 0, 0),
    localToWorld(pose, ch.standW, 0),
    localToWorld(pose, ch.standW, ch.standD),
    localToWorld(pose, 0, ch.standD),
  ];
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface LayoutItem {
  id: string;
  isCommand?: boolean;
  isCharacter?: boolean;
}

/**
 * Automatic formation:
 *  1. Fill ranks of `files` stands from front to back; an incomplete rear rank is centred.
 *  2. The command stand sits in the centre of the front rank (left of centre when even).
 *  3. A character takes the front-rank slot next to the command stand (right by default).
 *  4. Everything else keeps the given order.
 */
export function autoLayout(items: LayoutItem[], files: number, characterSide: 'left' | 'right' = 'right'): Map<string, Slot> {
  const result = new Map<string, Slot>();
  const n = items.length;
  if (n === 0) return result;
  const f = Math.max(1, Math.min(Math.round(files), n));
  const cmd = items.find((i) => i.isCommand);
  const chr = items.find((i) => i.isCharacter);
  const others = items.filter((i) => i !== cmd && i !== chr);

  const k = Math.min(n, f); // front-rank count
  const front: (LayoutItem | undefined)[] = new Array(k).fill(undefined);
  const centre = Math.floor((k - 1) / 2);
  if (cmd && chr) {
    let ci = centre;
    let hi = characterSide === 'right' ? ci + 1 : ci - 1;
    if (hi < 0) {
      ci = 1;
      hi = 0;
    } else if (hi >= k) {
      ci = k - 2;
      hi = k - 1;
    }
    front[ci] = cmd;
    front[hi] = chr;
  } else if (cmd) front[centre] = cmd;
  else if (chr) front[centre] = chr;

  const queue = others.slice();
  for (let i = 0; i < k; i++) if (!front[i]) front[i] = queue.shift();
  front.forEach((it, file) => it && result.set(it.id, { rank: 0, file }));

  let rank = 1;
  while (queue.length) {
    const row = queue.splice(0, f);
    const offset = (f - row.length) / 2; // centre an incomplete rank
    row.forEach((it, j) => result.set(it.id, { rank, file: offset + j }));
    rank++;
  }
  return result;
}

const bySlot = (a: { slot: Slot }, b: { slot: Slot }) => a.slot.rank - b.slot.rank || a.slot.file - b.slot.file;

/**
 * Re-run the automatic layout keeping the current stand order (front to back,
 * left to right), with the attached character (if any) next to the command stand.
 */
export function reflowRegiment(reg: Regiment, files: number, characterSide: 'left' | 'right'): Regiment {
  const ordered = reg.stands.slice().sort(bySlot);
  const items: LayoutItem[] = ordered.map((s) => ({ id: s.id, isCommand: s.isCommand }));
  const hasCharSlot = !!reg.characterId && !!reg.characterSlot;
  if (hasCharSlot) items.push({ id: reg.characterId!, isCharacter: true });
  const slots = autoLayout(items, files, characterSide);
  return {
    ...reg,
    files: Math.max(1, Math.round(files)),
    stands: reg.stands.map((s) => ({ ...s, slot: slots.get(s.id) ?? s.slot })),
    ...(hasCharSlot ? { characterSlot: slots.get(reg.characterId!) } : {}),
  };
}

export interface NewRegimentParams {
  id: string;
  owner: Regiment['owner'];
  name: string;
  standType: StandType;
  preset: StandPreset;
  stands: number;
  files: number;
  woundsMax: number;
  x?: number;
  y?: number;
  angle?: number;
  location?: Regiment['location'];
}

/** Build a regiment with the automatic layout. Stand ids are derived from the regiment id. */
export function createRegiment(p: NewRegimentParams): Regiment {
  const count = Math.max(1, Math.round(p.stands));
  const stands: Stand[] = [];
  for (let i = 0; i < count; i++) {
    stands.push({
      id: `${p.id}-s${i}`,
      slot: { rank: 0, file: 0 },
      woundsMax: p.woundsMax,
      wounds: 0,
      isCommand: i === 0 && HAS_COMMAND[p.standType],
    });
  }
  const slots = autoLayout(
    stands.map((s) => ({ id: s.id, isCommand: s.isCommand })),
    p.files,
  );
  return {
    id: p.id,
    owner: p.owner,
    name: p.name,
    notes: '',
    standType: p.standType,
    standW: p.preset.w,
    standD: p.preset.d,
    size: p.preset.size,
    files: Math.max(1, Math.round(p.files)),
    stands: stands.map((s) => ({ ...s, slot: slots.get(s.id)! })),
    casualties: [],
    x: p.x ?? 0,
    y: p.y ?? 0,
    angle: p.angle ?? 0,
    location: p.location ?? 'reserve',
    tags: [],
  };
}

/** First free slot after the current formation, for a newly added stand. */
export function nextFreeSlot(reg: Regiment): Slot {
  const taken = occupiedSlots(reg);
  const isFree = (s: Slot) => !taken.some((t) => slotsOverlap(t, s));
  const f = Math.max(1, reg.files);
  for (let rank = 0; rank < 1000; rank++) {
    for (let file = 0; file < f; file++) if (isFree({ rank, file })) return { rank, file };
  }
  return { rank: 0, file: 0 };
}

export function slotsEqual(a: Slot, b: Slot): boolean {
  return a.rank === b.rank && Math.abs(a.file - b.file) < 0.01;
}

/** Two slots overlap when they share a rank and sit less than one stand apart (files can be fractional). */
export function slotsOverlap(a: Slot, b: Slot): boolean {
  return a.rank === b.rank && Math.abs(a.file - b.file) < 1 - 0.01;
}

/**
 * Close the gap left at `gap` (e.g. by a departing character) with a free
 * reform that loses as few ranks as possible:
 *  - gap in front of the rearmost rank: the rearmost-rank stand nearest to the
 *    gap steps into it, then what is left of the rearmost rank is re-centred
 *    (the rank count drops only if that rank empties);
 *  - gap in the rearmost rank: that rank is re-centred;
 *  - gap in a single-rank regiment: the rank closes up (one file fewer) and the
 *    pose shifts so the regiment stays centred where it was.
 * Every other stand keeps its slot.
 */
export function closeGap(reg: Regiment, gap: Slot): { regiment: Regiment; note?: string } {
  if (!reg.stands.length) return { regiment: reg };
  const rear = Math.max(...reg.stands.map((s) => s.slot.rank));
  const files = Math.max(1, reg.files);
  let stands = reg.stands;
  let note: string | undefined;
  const recentre = (list: Stand[], rank: number, width: number): Stand[] => {
    const row = list.filter((s) => s.slot.rank === rank).sort((a, b) => a.slot.file - b.slot.file);
    const offset = (width - row.length) / 2;
    const pos = new Map(row.map((s, i) => [s.id, offset + i]));
    return list.map((s) => (pos.has(s.id) ? { ...s, slot: { rank, file: pos.get(s.id)! } } : s));
  };

  if (gap.rank < rear) {
    const donors = stands.filter((s) => s.slot.rank === rear);
    const donor = donors.reduce((best, s) => {
      const d = Math.abs(s.slot.file - gap.file);
      const bd = Math.abs(best.slot.file - gap.file);
      return d < bd - 1e-6 || (Math.abs(d - bd) <= 1e-6 && s.slot.file < best.slot.file) ? s : best;
    });
    note = `${standName(reg, donor)} stepped into the gap`;
    stands = stands.map((s) => (s.id === donor.id ? { ...s, slot: { ...gap } } : s));
    stands = recentre(stands, rear, files);
    return { regiment: { ...reg, stands }, note };
  }
  if (rear > 0) return { regiment: { ...reg, stands: recentre(stands, rear, files) }, note: 'rear rank re-centred' };

  // Single rank: close up and keep the regiment centred where it was.
  const row = stands.slice().sort((a, b) => a.slot.file - b.slot.file);
  const lo = Math.min(gap.file, ...row.map((s) => s.slot.file));
  const hi = Math.max(gap.file, ...row.map((s) => s.slot.file)) + 1;
  const shift = lo + (hi - lo - row.length) / 2; // new left edge, in old file units
  const pos = new Map(row.map((s, i) => [s.id, i]));
  const origin = localToWorld(reg, shift * reg.standW, 0);
  return {
    regiment: {
      ...reg,
      x: origin.x,
      y: origin.y,
      files: row.length,
      stands: stands.map((s) => ({ ...s, slot: { rank: 0, file: pos.get(s.id)! } })),
      casualties: reg.casualties.map((s) => ({ ...s, slot: { ...s.slot, file: s.slot.file - shift } })),
    },
    note: 'rank closed up',
  };
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/**
 * Readable position of a slot, e.g. "rear-left", "front-centre", "rank 2-file 3".
 * Uses stands and casualties together so names stay stable as stands are removed.
 */
export function slotName(reg: Regiment, slot: Slot): string {
  const all = [...reg.stands, ...reg.casualties].map((s) => s.slot);
  if (reg.characterSlot && reg.characterId) all.push(reg.characterSlot);
  const maxRank = all.reduce((m, s) => Math.max(m, s.rank), 0);
  const rankName = slot.rank === 0 ? 'front' : slot.rank === maxRank ? 'rear' : `rank ${slot.rank + 1}`;
  const files = Array.from(new Set(all.filter((s) => s.rank === slot.rank).map((s) => s.file))).sort((a, b) => a - b);
  const i = files.findIndex((f) => Math.abs(f - slot.file) < 0.01);
  let fileName: string;
  if (files.length <= 1) fileName = 'centre';
  else if (i === 0) fileName = 'left';
  else if (i === files.length - 1) fileName = 'right';
  else if (files.length % 2 === 1 && i === (files.length - 1) / 2) fileName = 'centre';
  else fileName = `file ${i + 1}`;
  return `${rankName}-${fileName}`;
}

export function standName(reg: Regiment, s: Stand): string {
  const pos = slotName(reg, s.slot);
  if (s.isCommand) return s.label ? `command (${s.label})` : 'command';
  return s.label ? `${pos} (${s.label})` : pos;
}

// ---------------------------------------------------------------------------
// Wound allocation
// ---------------------------------------------------------------------------

/** Lateral position of the command stand's centre in file units (also when it is a casualty). */
function commandFileCentre(reg: Regiment): number {
  const cmd = reg.stands.find((s) => s.isCommand) ?? reg.casualties.find((s) => s.isCommand);
  if (cmd) return cmd.slot.file + 0.5;
  const slots = [...reg.stands, ...reg.casualties].map((s) => s.slot);
  if (!slots.length) return 0;
  const lo = Math.min(...slots.map((s) => s.file));
  const hi = Math.max(...slots.map((s) => s.file + 1));
  return (lo + hi) / 2;
}

/**
 * Rule 3: take a stand from alternating ends of the candidates' rearmost rank,
 * starting with the end farthest from the command stand, so the centremost
 * stand of the rank is hit last.
 *
 * Alternation is read from the rank itself: if more stands have already been
 * removed from one side of the rank's centre, the other end goes next; when
 * both sides have lost the same number, the end farther from the command
 * stand goes (ties: left).
 */
function alternatingEnd(reg: Regiment, cands: Stand[], cmdX: number): Stand {
  const rear = Math.max(...cands.map((s) => s.slot.rank));
  const row = cands.filter((s) => s.slot.rank === rear).sort((a, b) => a.slot.file - b.slot.file);
  if (row.length === 1) return row[0];
  const left = row[0];
  const right = row[row.length - 1];
  const rankSlots = [...reg.stands, ...reg.casualties].filter((s) => s.slot.rank === rear).map((s) => s.slot.file);
  const mid = (Math.min(...rankSlots) + Math.max(...rankSlots) + 1) / 2;
  const gone = reg.casualties.filter((s) => s.slot.rank === rear);
  const goneLeft = gone.filter((s) => s.slot.file + 0.5 < mid - 1e-6).length;
  const goneRight = gone.filter((s) => s.slot.file + 0.5 > mid + 1e-6).length;
  if (goneLeft < goneRight) return left;
  if (goneRight < goneLeft) return right;
  const dl = Math.abs(left.slot.file + 0.5 - cmdX);
  const dr = Math.abs(right.slot.file + 0.5 - cmdX);
  return dr > dl + 1e-6 ? right : left;
}

/**
 * Which stand takes the next wound (characters are ignored):
 *  1. Wounded non-command stands first (the most wounded).
 *  2. A stand must be destroyed before an unwounded stand takes a wound (follows from 1).
 *  3. Then stands from alternating ends of the rearmost rank, starting with the
 *     end farthest from the command stand; the centremost stand of a rank goes last.
 *     When the rearmost rank empties, the next rank becomes the rearmost.
 *  4. Stands engaged with an enemy are kept for after every unengaged stand, so
 *     as few unengaged stands as possible are left.
 *  5. The command stand is always last.
 * Stands already at woundsMax (awaiting removal) are skipped.
 */
export function nextWoundTarget(reg: Regiment, engaged: ReadonlySet<string> = new Set()): Stand | undefined {
  const alive = reg.stands.filter((s) => s.wounds < s.woundsMax);
  if (!alive.length) return undefined;
  const cmdX = commandFileCentre(reg);
  const wounded = alive.filter((s) => !s.isCommand && s.wounds > 0);
  if (wounded.length) {
    const most = Math.max(...wounded.map((s) => s.wounds));
    return alternatingEnd(
      reg,
      wounded.filter((s) => s.wounds === most),
      cmdX,
    );
  }
  const rankAndFile = alive.filter((s) => !s.isCommand);
  const unengaged = rankAndFile.filter((s) => !engaged.has(s.id));
  if (unengaged.length) return alternatingEnd(reg, unengaged, cmdX);
  if (rankAndFile.length) return alternatingEnd(reg, rankAndFile, cmdX);
  return alive[0];
}

export interface AllocationResult {
  regiment: Regiment;
  /** Human-readable outcome per affected stand, in order of first wound. */
  steps: string[];
  /** Wounds that could not be allocated (no stands left). */
  unallocated: number;
  removedIds: string[];
}

/** Move a stand to the casualty list (keeping its slot so it can be restored). */
export function removeStandToCasualties(reg: Regiment, standId: string): Regiment {
  const s = reg.stands.find((x) => x.id === standId);
  if (!s) return reg;
  return { ...reg, stands: reg.stands.filter((x) => x.id !== standId), casualties: [...reg.casualties, s] };
}

/**
 * Apply n wounds one at a time using nextWoundTarget (`engaged` = ids of stands
 * in contact with an enemy). With autoRemove, a stand
 * whose damage reaches woundsMax goes to the casualty list at once; otherwise
 * it stays at max (awaiting confirmation) and is skipped by later wounds.
 */
export function allocateWounds(reg: Regiment, n: number, autoRemove = true, engaged: ReadonlySet<string> = new Set()): AllocationResult {
  let r = reg;
  const order: string[] = [];
  const names = new Map<string, string>();
  const removedIds: string[] = [];
  let unallocated = 0;
  for (let i = 0; i < n; i++) {
    const t = nextWoundTarget(r, engaged);
    if (!t) {
      unallocated = n - i;
      break;
    }
    if (!names.has(t.id)) {
      names.set(t.id, standName(reg, t));
      order.push(t.id);
    }
    const hit: Stand = { ...t, wounds: t.wounds + 1 };
    r = { ...r, stands: r.stands.map((s) => (s.id === t.id ? hit : s)) };
    if (hit.wounds >= hit.woundsMax && autoRemove) {
      r = removeStandToCasualties(r, hit.id);
      removedIds.push(hit.id);
    }
  }
  const steps = order.map((id) => {
    const name = names.get(id)!;
    if (removedIds.includes(id)) return `${name} removed`;
    const s = r.stands.find((x) => x.id === id)!;
    return s.wounds >= s.woundsMax ? `${name} ${s.wounds}/${s.woundsMax} (to remove)` : `${name} ${s.wounds}/${s.woundsMax}`;
  });
  return { regiment: r, steps, unallocated, removedIds };
}

export const totalDamage = (reg: Regiment): number =>
  reg.stands.reduce((a, s) => a + s.wounds, 0) + reg.casualties.reduce((a, s) => a + s.woundsMax, 0);
