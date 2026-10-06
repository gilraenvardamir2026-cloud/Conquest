// Pure reducer. applyOp(battle, envelope) never mutates its input and never
// reads clocks or randomness: ids it creates are derived from the envelope id,
// so two copies fed the same operations produce identical JSON.
//
// Every successful op also yields its inverse (a `restore` op holding the
// previous value of each entity it changed) and the ids it touched, which is
// what undo needs.

import { bounds, localToWorld } from './geometry';
import { engagedStandIds, layoutTerrain, normalizeBattle, scenarioZones, terrainPolygon } from './board';
import { scenarioById } from './presets';
import { MAX_STACK } from './command';
import type { DrandDraw } from './drand';
import {
  allocateWounds,
  closeGap,
  nextFreeSlot,
  reflowRegiment,
  regimentLocalBox,
  removeStandToCasualties,
  slotsOverlap,
  standName,
} from './regiment';
import { COLLECTIONS, DOC_FIELDS, type Op, type OpEnvelope, type Patch, type RestoreEntry } from './ops';
import type { Author, Battle, Character, DiceRoll, LogEntry, Regiment, Slot, Stand, Terrain } from './types';

export class OpError extends Error {}
const fail = (msg: string): never => {
  throw new OpError(msg);
};

export const LOG_LIMIT = 1000;
/** The dice tray keeps the last 20 rolls. */
export const DICE_KEPT = 20;

function successText(r: DiceRoll): string {
  if (r.target === undefined || r.kind === 'rolloff') return '';
  const n = r.results.filter((x) => x <= r.target!).length;
  return ` · ${n} success${n === 1 ? '' : 'es'} (≤ ${r.target})`;
}

function describeRoll(r: DiceRoll): string {
  if (r.kind === 'rolloff') {
    const ties = r.ties?.length ? ` after ${plural(r.ties.length, 'tie')} (${r.ties.map((t) => t.join('–')).join(', ')})` : '';
    return `roll-off: Player 1 ${r.results[0]}, Player 2 ${r.results[1]}${ties} (${r.source})`;
  }
  return `rolled ${diceWord(r.results.length)}${r.label ? ` for "${r.label}"` : ''}: ${r.results.join(', ')} (${sourceText(r.source, r.proof?.[0])})${successText(r)}`;
}

export type ApplyResult =
  | { ok: true; battle: Battle; inverse: Op | null; touched: string[]; log: LogEntry }
  | { ok: false; error: string };

interface Reduced {
  battle: Battle;
  text: string;
  kind?: LogEntry['kind'];
  /** No state change worth undoing (chat). */
  noUndo?: boolean;
}

// ---------------------------------------------------------------------------
// Small immutable helpers
// ---------------------------------------------------------------------------

function idx<T extends { id: string }>(arr: T[], id: string, what: string): number {
  const i = arr.findIndex((x) => x.id === id);
  if (i < 0) fail(`${what} not found`);
  return i;
}
const setAt = <T>(arr: T[], i: number, v: T): T[] => arr.map((x, j) => (j === i ? v : x));
const removeAt = <T>(arr: T[], i: number): T[] => arr.filter((_, j) => j !== i);

function finite(n: unknown, what: string): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) fail(`${what} must be a finite number`);
  return n as number;
}
function checkPose(p: { x: number; y: number; angle: number }) {
  finite(p.x, 'x');
  finite(p.y, 'y');
  finite(p.angle, 'angle');
}

/** Apply a patch where null clears a field. */
function applyPatch<T extends object>(obj: T, patch: Patch<Partial<T>> | Record<string, unknown>): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out as T;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function authorName(b: Battle, by: Author): string {
  if (by === 'p1' || by === 'p2') return b.players[by].name;
  return by === 'spectator' ? 'Spectator' : 'System';
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const sourceText = (source: DiceRoll['source'], draw?: DrandDraw) => (source === 'drand' && draw ? `drand round ${draw.round}` : source);

/** A drand draw as recorded on a roll: sane numbers only. */
function checkDraw(d: DrandDraw): DrandDraw {
  if (!Number.isInteger(d.round) || d.round < 1 || typeof d.key !== 'string' || d.key.length > 100) fail('Invalid drand draw');
  if (!Array.isArray(d.values) || d.values.length > 60 || d.values.some((n) => !Number.isInteger(n) || n < 1 || n > 6)) fail('Invalid drand draw');
  return { round: d.round, key: d.key, values: d.values.slice() };
}

const diceWord = (n: number) => `${n} ${n === 1 ? 'die' : 'dice'}`;

// ---------------------------------------------------------------------------
// Regiment / character helpers shared by several ops
// ---------------------------------------------------------------------------

function updateRegimentAt(b: Battle, id: string, fn: (r: Regiment) => Regiment): Battle {
  const i = idx(b.regiments, id, 'Regiment');
  return { ...b, regiments: setAt(b.regiments, i, fn(b.regiments[i])) };
}

function updateCharacterAt(b: Battle, id: string, fn: (c: Character) => Character): Battle {
  const i = idx(b.characters, id, 'Character');
  return { ...b, characters: setAt(b.characters, i, fn(b.characters[i])) };
}

/** Free a garrison piece occupied by this regiment (if any) and clear the regiment's garrison link. */
function releaseGarrison(b: Battle, regimentId: string): Battle {
  let out = b;
  const ti = b.terrain.findIndex((t) => t.garrison?.occupiedBy === regimentId);
  if (ti >= 0) {
    const t = b.terrain[ti];
    const { occupiedBy: _o, ...g } = t.garrison!;
    out = { ...out, terrain: setAt(out.terrain, ti, { ...t, garrison: g }) };
  }
  const ri = out.regiments.findIndex((r) => r.id === regimentId);
  if (ri >= 0 && out.regiments[ri].garrisonId) {
    const { garrisonId: _g, ...r } = out.regiments[ri];
    out = { ...out, regiments: setAt(out.regiments, ri, r as Regiment) };
  }
  return out;
}

/**
 * Detach a character. Lone characters never stand on the board, so it goes to
 * the regiment's location when that is the reserve, otherwise to the reserve
 * (callers that join it to another regiment or place it set the location
 * afterwards). Unless the reformOnDetach setting is off, the regiment then
 * closes the gap with a free reform that loses as few ranks as possible.
 */
function detachWithNote(b: Battle, characterId: string): { battle: Battle; note?: string } {
  const ci = idx(b.characters, characterId, 'Character');
  const ch = b.characters[ci];
  if (!ch.attachedTo) return { battle: b };
  const ri = b.regiments.findIndex((r) => r.id === ch.attachedTo);
  const { attachedTo: _a, x: _x, y: _y, angle: _g, ...c } = ch;
  const placed: Character = { ...c, location: ch.location === 'destroyed' ? 'destroyed' : 'reserve' };
  if (ri < 0) return { battle: { ...b, characters: setAt(b.characters, ci, placed) } };
  const reg = b.regiments[ri];
  const { characterId: _c, characterSlot: gap, ...rest } = reg;
  let nr = rest as Regiment;
  let note: string | undefined;
  if (gap && b.settings.reformOnDetach !== false) {
    const closed = closeGap(nr, gap);
    nr = closed.regiment;
    note = closed.note;
  }
  return {
    battle: { ...b, regiments: setAt(b.regiments, ri, nr), characters: setAt(b.characters, ci, placed) },
    note,
  };
}

const detach = (b: Battle, characterId: string): Battle => detachWithNote(b, characterId).battle;

function charName(b: Battle, id: string | undefined): string | undefined {
  return id ? b.characters.find((c) => c.id === id)?.name : undefined;
}

function terrainEditable(t: Terrain, patchKeys: string[] = []) {
  if (t.locked && !(patchKeys.length === 1 && patchKeys[0] === 'locked')) fail(`${t.name} is locked`);
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

function reduce(b: Battle, env: OpEnvelope): Reduced {
  const op = env.op;
  switch (op.type) {
    // ----- Board ------------------------------------------------------------
    case 'setScenario': {
      if (op.scenarioId === 'custom') {
        const { scenarioId: _s, ...board } = b.board;
        return {
          battle: {
            ...b,
            board,
            zones: b.zones.map((z) => ({ ...z, locked: false })),
            objectiveMarkers: b.objectiveMarkers.map((m) => ({ ...m, locked: false })),
          },
          text: 'switched to a custom board (objectives unlocked)',
        };
      }
      const s = scenarioById(op.scenarioId) ?? fail('Unknown scenario');
      const { zones, markers } = scenarioZones(s.id, env.id);
      return {
        battle: {
          ...b,
          board: { ...b.board, width: 72, depth: 48, scenarioId: s.id, noReinforcement: s.noReinforcement.map((e) => ({ ...e })) },
          zones,
          objectiveMarkers: markers,
        },
        text: `set up scenario ${s.number}: ${s.name}`,
      };
    }
    case 'updateBoard': {
      const p = op.patch;
      const custom = !b.board.scenarioId;
      if ((p.width !== undefined || p.depth !== undefined || p.noReinforcement !== undefined) && !custom) {
        fail('Board size and edges can only change on a custom board');
      }
      if (p.grid !== undefined && ![0, 1, 6, 12].includes(p.grid)) fail('Invalid grid');
      if (p.width !== undefined) finite(p.width, 'width') <= 0 && fail('Width must be positive');
      if (p.depth !== undefined) finite(p.depth, 'depth') <= 0 && fail('Depth must be positive');
      const parts: string[] = [];
      if (p.grid !== undefined) parts.push(p.grid ? `grid ${p.grid}"` : 'grid off');
      if (p.width !== undefined || p.depth !== undefined) parts.push(`size ${p.width ?? b.board.width}" × ${p.depth ?? b.board.depth}"`);
      if (p.noReinforcement) parts.push('no-reinforcement edges');
      return { battle: { ...b, board: { ...b.board, ...p } }, text: `board: ${parts.join(', ') || 'updated'}` };
    }
    case 'renameBattle':
      return { battle: { ...b, name: op.name.slice(0, 120) }, text: `renamed the battle to "${op.name.slice(0, 120)}"` };
    case 'updatePlayer': {
      const before = b.players[op.seat];
      const after = { ...before, ...op.patch };
      return {
        battle: { ...b, players: { ...b.players, [op.seat]: after } },
        text: op.patch.name && op.patch.name !== before.name ? `${before.name} is now called ${after.name}` : `updated ${after.name}`,
      };
    }
    case 'updateSettings': {
      const keys = Object.keys(op.patch);
      let text = `changed settings (${keys.join(', ')})`;
      if (keys.length === 1 && op.patch.boardLocked !== undefined) text = op.patch.boardLocked ? 'locked the board for the game' : 'unlocked the board';
      else if (keys.length === 1 && op.patch.anyoneCanEdit !== undefined) text = op.patch.anyoneCanEdit ? 'turned on "anyone can edit anything"' : 'turned off "anyone can edit anything"';
      return { battle: { ...b, settings: { ...b.settings, ...op.patch } }, text };
    }

    // ----- Terrain ----------------------------------------------------------
    case 'setTerrainLayout': {
      const terrain = layoutTerrain(op.layoutId, env.id, op.garrisonBuildings);
      if (!terrain.length) fail('Unknown layout');
      let out = b;
      for (const r of b.regiments) if (r.garrisonId) out = releaseGarrison(out, r.id);
      return { battle: { ...out, terrain }, text: `placed sample terrain ${op.layoutId.replace('layout', '#')}${op.garrisonBuildings ? ' (garrison buildings)' : ''}` };
    }
    case 'clearTerrain': {
      if (b.terrain.some((t) => t.locked)) fail('Unlock all terrain first');
      let out = b;
      for (const r of b.regiments) if (r.garrisonId) out = releaseGarrison(out, r.id);
      return { battle: { ...out, terrain: [] }, text: 'cleared all terrain' };
    }
    case 'addTerrain': {
      if (b.terrain.some((t) => t.id === op.terrain.id)) fail('Duplicate id');
      checkPose(op.terrain);
      return { battle: { ...b, terrain: [...b.terrain, op.terrain] }, text: `added terrain ${op.terrain.name}` };
    }
    case 'updateTerrain': {
      const i = idx(b.terrain, op.id, 'Terrain');
      const t = b.terrain[i];
      const keys = Object.keys(op.patch).filter((k) => (op.patch as Record<string, unknown>)[k] !== undefined);
      terrainEditable(t, keys);
      for (const k of ['x', 'y', 'angle', 'size'] as const) if (op.patch[k] != null) finite(op.patch[k], k);
      const { garrison, ...rest } = op.patch;
      let nt = applyPatch(t, rest);
      if (garrison === null) {
        const { garrison: _g, ...x } = nt;
        nt = x;
      } else if (garrison) nt = { ...nt, garrison: { ...t.garrison, ...garrison } };
      // Turning a building into garrison terrain or back via the keyword list.
      if (op.patch.keywords && op.patch.keywords.includes('Garrison') && !nt.garrison) nt = { ...nt, garrison: { defense: 1, capacity: 5 } };
      if (op.patch.keywords && !op.patch.keywords.includes('Garrison') && nt.garrison) {
        const { garrison: _g, ...x } = nt;
        nt = x;
      }
      let out: Battle = { ...b, terrain: setAt(b.terrain, i, nt) };
      // No longer garrison terrain: the occupying regiment steps out (keeps its pose).
      const occ = t.garrison?.occupiedBy;
      if (occ && !nt.garrison) {
        out = {
          ...out,
          regiments: out.regiments.map((r) => {
            if (r.id !== occ) return r;
            const { garrisonId: _g, ...rest } = r;
            return rest;
          }),
        };
      }
      const what =
        keys.length === 1 && keys[0] === 'locked'
          ? nt.locked
            ? 'locked'
            : 'unlocked'
          : keys.every((k) => k === 'x' || k === 'y')
            ? `moved to (${nt.x.toFixed(1)}, ${nt.y.toFixed(1)})`
            : keys.length === 1 && keys[0] === 'size'
              ? `Size set to ${nt.size}`
              : `edited (${keys.join(', ')})`;
      return { battle: out, text: `${t.name} ${what}` };
    }
    case 'removeTerrain': {
      const i = idx(b.terrain, op.id, 'Terrain');
      const t = b.terrain[i];
      terrainEditable(t);
      let out = b;
      if (t.garrison?.occupiedBy) out = releaseGarrison(out, t.garrison.occupiedBy);
      return { battle: { ...out, terrain: removeAt(out.terrain, i) }, text: `removed terrain ${t.name}` };
    }
    case 'occupyGarrison': {
      const ti = idx(b.terrain, op.terrainId, 'Terrain');
      const t = b.terrain[ti];
      if (!t.garrison) fail(`${t.name} is not garrison terrain`);
      let out = b;
      if (op.regimentId === null) {
        const occ = t.garrison!.occupiedBy;
        if (!occ) return { battle: b, text: `${t.name}: nobody to leave` };
        out = releaseGarrison(out, occ);
        // Restore the regiment beside the piece (to its right) for the user to position.
        const ri = out.regiments.findIndex((r) => r.id === occ);
        if (ri >= 0) {
          const reg = out.regiments[ri];
          const box = regimentLocalBox(reg);
          const tb = bounds(terrainPolygon(t));
          const half = Math.hypot(box.u1 - box.u0, box.v1) / 2;
          const target = { x: tb.maxX + 1 + half, y: (tb.minY + tb.maxY) / 2 };
          const c = localToWorld({ x: 0, y: 0, angle: reg.angle }, (box.u0 + box.u1) / 2, box.v1 / 2);
          out = { ...out, regiments: setAt(out.regiments, ri, { ...reg, x: target.x - c.x, y: target.y - c.y }) };
          return { battle: out, text: `${reg.name} left ${t.name}` };
        }
        return { battle: out, text: `${t.name} emptied` };
      }
      const ri = idx(b.regiments, op.regimentId, 'Regiment');
      const reg = b.regiments[ri];
      if (reg.location !== 'board') fail(`${reg.name} is not on the board`);
      if (t.garrison!.occupiedBy) out = releaseGarrison(out, t.garrison!.occupiedBy);
      if (reg.garrisonId) out = releaseGarrison(out, reg.id);
      const ti2 = out.terrain.findIndex((x) => x.id === t.id);
      const t2 = out.terrain[ti2];
      out = {
        ...out,
        terrain: setAt(out.terrain, ti2, { ...t2, garrison: { ...t2.garrison!, occupiedBy: reg.id } }),
        regiments: out.regiments.map((r) => (r.id === reg.id ? { ...r, garrisonId: t.id } : r)),
      };
      return { battle: out, text: `${reg.name} occupied ${t.name}` };
    }

    // ----- Objectives -------------------------------------------------------
    case 'addZone': {
      if (b.board.scenarioId) fail('Objective zones are locked by the scenario');
      checkPose({ ...op.zone, angle: 0 });
      return { battle: { ...b, zones: [...b.zones, { ...op.zone, locked: false }] }, text: `added a ${op.zone.diameter}" objective zone` };
    }
    case 'updateZone': {
      const i = idx(b.zones, op.id, 'Zone');
      if (b.zones[i].locked) fail('Objective zones are locked by the scenario');
      for (const k of ['x', 'y', 'diameter'] as const) if (op.patch[k] != null) finite(op.patch[k], k);
      return { battle: { ...b, zones: setAt(b.zones, i, applyPatch(b.zones[i], op.patch)) }, text: 'edited an objective zone' };
    }
    case 'removeZone': {
      const i = idx(b.zones, op.id, 'Zone');
      if (b.zones[i].locked) fail('Objective zones are locked by the scenario');
      return { battle: { ...b, zones: removeAt(b.zones, i) }, text: 'removed an objective zone' };
    }
    case 'addObjectiveMarker': {
      if (b.board.scenarioId) fail('Objective markers are locked by the scenario');
      return {
        battle: { ...b, objectiveMarkers: [...b.objectiveMarkers, { ...op.marker, locked: false }] },
        text: `added objective marker ${op.marker.label ?? '•'}`,
      };
    }
    case 'updateObjectiveMarker': {
      const i = idx(b.objectiveMarkers, op.id, 'Objective marker');
      if (b.objectiveMarkers[i].locked) fail('Objective markers are locked by the scenario');
      return {
        battle: { ...b, objectiveMarkers: setAt(b.objectiveMarkers, i, applyPatch(b.objectiveMarkers[i], op.patch)) },
        text: `edited objective marker ${b.objectiveMarkers[i].label ?? '•'}`,
      };
    }
    case 'removeObjectiveMarker': {
      const i = idx(b.objectiveMarkers, op.id, 'Objective marker');
      if (b.objectiveMarkers[i].locked) fail('Objective markers are locked by the scenario');
      return { battle: { ...b, objectiveMarkers: removeAt(b.objectiveMarkers, i) }, text: 'removed an objective marker' };
    }
    case 'damageObjectiveMarker': {
      const i = idx(b.objectiveMarkers, op.id, 'Objective marker');
      const m = b.objectiveMarkers[i];
      finite(op.delta, 'delta');
      const v = clamp(m.damageBy[op.seat] + Math.round(op.delta), 0, m.woundsMax);
      const nm = { ...m, damageBy: { ...m.damageBy, [op.seat]: v } };
      return {
        battle: { ...b, objectiveMarkers: setAt(b.objectiveMarkers, i, nm) },
        text: `objective marker ${m.label ?? '•'}: ${b.players[op.seat].name} damage ${v}/${m.woundsMax}`,
      };
    }
    case 'setObjectiveMarkerDestroyed': {
      const i = idx(b.objectiveMarkers, op.id, 'Objective marker');
      const m = b.objectiveMarkers[i];
      return {
        battle: { ...b, objectiveMarkers: setAt(b.objectiveMarkers, i, { ...m, destroyed: op.destroyed }) },
        text: `objective marker ${m.label ?? '•'} ${op.destroyed ? 'destroyed and removed' : 'restored'}`,
      };
    }

    // ----- Regiments ----------------------------------------------------------
    case 'addRegiment': {
      const r = op.regiment;
      if (b.regiments.some((x) => x.id === r.id)) fail('Duplicate id');
      checkPose(r);
      if (!r.stands.length) fail('A regiment needs at least one stand');
      // A new regiment starts without links to characters or garrisons.
      const { characterId: _c, characterSlot: _s, garrisonId: _g, ...clean } = r;
      return { battle: { ...b, regiments: [...b.regiments, clean] }, text: `added regiment ${r.name} (${plural(r.stands.length, 'stand')})` };
    }
    case 'updateRegiment': {
      const p = op.patch;
      for (const k of ['march', 'barrageRange', 'sizeOverride', 'standW', 'standD', 'size'] as const) if (p[k] != null) finite(p[k], k);
      if (p.standW != null && p.standW <= 0) fail('Stand width must be positive');
      if (p.standD != null && p.standD <= 0) fail('Stand depth must be positive');
      const before = b.regiments.find((r) => r.id === op.id) ?? fail('Regiment not found');
      if (p.owner && p.owner !== before.owner && before.characterId) fail('Detach the character before changing owner');
      const out = updateRegimentAt(b, op.id, (r) => applyPatch(r, p));
      const keys = Object.keys(p);
      let what = `edited (${keys.join(', ')})`;
      if (keys.length === 1 && keys[0] === 'tags') {
        const added = (p.tags ?? []).filter((t) => !before.tags.includes(t));
        const removed = before.tags.filter((t) => !(p.tags ?? []).includes(t));
        what = [added.length ? `tagged ${added.join(', ')}` : '', removed.length ? `untagged ${removed.join(', ')}` : ''].filter(Boolean).join('; ') || 'tags unchanged';
      } else if (keys.length === 1 && keys[0] === 'notes') what = 'notes updated';
      else if (keys.length === 1 && keys[0] === 'name') what = `renamed to ${p.name}`;
      return { battle: out, text: `${before.name} ${what}` };
    }
    case 'moveRegiment': {
      checkPose(op.pose);
      const r0 = b.regiments.find((r) => r.id === op.id) ?? fail('Regiment not found');
      const out = updateRegimentAt(b, op.id, (r) => ({ ...r, ...op.pose }));
      return { battle: out, text: `${r0.name} ${op.summary?.slice(0, 200) ?? 'moved'}` };
    }
    case 'setRegimentLocation': {
      if (op.pose) checkPose(op.pose);
      const r0 = b.regiments.find((r) => r.id === op.id) ?? fail('Regiment not found');
      let out = op.location !== 'board' ? releaseGarrison(b, op.id) : b;
      out = updateRegimentAt(out, op.id, (r) => ({ ...r, location: op.location, ...(op.pose ?? {}) }));
      if (r0.characterId) out = updateCharacterAt(out, r0.characterId, (c) => ({ ...c, location: op.location }));
      const where = { board: 'deployed to the board', reserve: 'sent to reserve', destroyed: 'marked destroyed' }[op.location];
      return { battle: out, text: `${r0.name} ${where}` };
    }
    case 'removeRegiment': {
      const r0 = b.regiments.find((r) => r.id === op.id) ?? fail('Regiment not found');
      let out = releaseGarrison(b, op.id);
      if (r0.characterId) {
        out = detach(out, r0.characterId);
        out = updateCharacterAt(out, r0.characterId, (c) => ({ ...c, location: 'reserve' }));
      }
      return { battle: { ...out, regiments: out.regiments.filter((r) => r.id !== op.id) }, text: `deleted regiment ${r0.name}` };
    }
    case 'addStands': {
      const n = Math.round(finite(op.count, 'count'));
      if (n < 1 || n > 60) fail('Add between 1 and 60 stands');
      const r0 = b.regiments.find((r) => r.id === op.id) ?? fail('Regiment not found');
      let r = r0;
      const wm = r.stands[0]?.woundsMax ?? r.casualties[0]?.woundsMax ?? 1;
      for (let i = 0; i < n; i++) {
        const s: Stand = { id: `${env.id}-s${i}`, slot: nextFreeSlot(r), woundsMax: wm, wounds: 0, isCommand: false };
        r = { ...r, stands: [...r.stands, s] };
      }
      return { battle: updateRegimentAt(b, op.id, () => r), text: `${r0.name}: added ${plural(n, 'stand')}` };
    }
    case 'deleteStand': {
      const r0 = b.regiments.find((r) => r.id === op.id) ?? fail('Regiment not found');
      const inStands = r0.stands.some((s) => s.id === op.standId);
      const inCas = r0.casualties.some((s) => s.id === op.standId);
      if (!inStands && !inCas) fail('Stand not found');
      if (inStands && r0.stands.length === 1) fail('A regiment needs at least one stand');
      const out = updateRegimentAt(b, op.id, (r) => ({
        ...r,
        stands: r.stands.filter((s) => s.id !== op.standId),
        casualties: r.casualties.filter((s) => s.id !== op.standId),
      }));
      return { battle: out, text: `${r0.name}: deleted a stand` };
    }
    case 'setWoundsPerStand': {
      const wm = Math.round(finite(op.woundsMax, 'woundsMax'));
      if (wm < 1 || wm > 99) fail('Wounds must be 1–99');
      const r0 = b.regiments.find((r) => r.id === op.id) ?? fail('Regiment not found');
      const fix = (s: Stand) => ({ ...s, woundsMax: wm, wounds: Math.min(s.wounds, wm) });
      const out = updateRegimentAt(b, op.id, (r) => ({ ...r, stands: r.stands.map(fix), casualties: r.casualties.map(fix) }));
      return { battle: out, text: `${r0.name}: wounds per stand set to ${wm}` };
    }
    case 'setCommandStand': {
      const r0 = b.regiments.find((r) => r.id === op.id) ?? fail('Regiment not found');
      if (op.standId && !r0.stands.some((s) => s.id === op.standId)) fail('Stand not found');
      const out = updateRegimentAt(b, op.id, (r) => ({
        ...r,
        stands: r.stands.map((s) => (s.isCommand === (s.id === op.standId) ? s : { ...s, isCommand: s.id === op.standId })),
        casualties: r.casualties.map((s) => (s.isCommand ? { ...s, isCommand: false } : s)),
      }));
      return { battle: out, text: op.standId ? `${r0.name}: command stand changed` : `${r0.name}: command stand cleared` };
    }
    case 'updateStand': {
      const r0 = b.regiments.find((r) => r.id === op.id) ?? fail('Regiment not found');
      const fix = (s: Stand): Stand => {
        if (s.id !== op.standId) return s;
        const { label: _l, ...rest } = s;
        return op.label ? { ...rest, label: op.label.slice(0, 40) } : rest;
      };
      return { battle: updateRegimentAt(b, op.id, (r) => ({ ...r, stands: r.stands.map(fix), casualties: r.casualties.map(fix) })), text: `${r0.name}: stand label ${op.label ? `"${op.label}"` : 'cleared'}` };
    }
    case 'reformRegiment': {
      const files = Math.round(finite(op.files, 'files'));
      if (files < 1 || files > 60) fail('Files must be 1–60');
      const r0 = b.regiments.find((r) => r.id === op.id) ?? fail('Regiment not found');
      let r: Regiment;
      if (op.slots) {
        const ids = [...r0.stands.map((s) => s.id), ...(r0.characterId && r0.characterSlot ? [r0.characterId] : [])];
        const used: Slot[] = [];
        for (const id of ids) {
          const s = op.slots[id] ?? fail('Every stand needs a slot');
          finite(s.rank, 'rank');
          finite(s.file, 'file');
          if (s.rank < 0 || !Number.isInteger(s.rank)) fail('Ranks are whole numbers from 0');
          if (used.some((u) => slotsOverlap(u, s))) fail('Two stands cannot overlap');
          used.push(s);
        }
        r = {
          ...r0,
          files,
          stands: r0.stands.map((s) => ({ ...s, slot: { ...op.slots![s.id] } })),
          ...(r0.characterId && r0.characterSlot ? { characterSlot: { ...op.slots[r0.characterId] } } : {}),
        };
      } else {
        r = reflowRegiment(r0, files, b.settings.characterSide);
      }
      return { battle: updateRegimentAt(b, op.id, () => r), text: `${r0.name} reformed (${files} files)` };
    }
    case 'applyWounds': {
      const n = Math.round(finite(op.count, 'count'));
      if (n < 1 || n > 200) fail('Wounds must be 1–200');
      const r0 = b.regiments.find((r) => r.id === op.id) ?? fail('Regiment not found');
      const engaged = engagedStandIds(b, r0);
      if (op.choices && (!Array.isArray(op.choices) || op.choices.length > 200 || op.choices.some((c) => typeof c !== 'string'))) fail('Invalid choices');
      const res = allocateWounds(r0, n, !b.settings.confirmStandRemoval, engaged, { choices: op.choices });
      let extra = res.unallocated ? ` (${res.unallocated} not allocated: no stands left)` : '';
      if (engaged.size) extra += ` (${engaged.size} engaged stand${engaged.size === 1 ? '' : 's'} kept for last)`;
      return {
        battle: updateRegimentAt(b, op.id, () => res.regiment),
        text: `${r0.name}: ${plural(n, 'wound')} → ${res.steps.join(', ') || 'none'}${extra}`,
      };
    }
    case 'adjustStandWounds': {
      const r0 = b.regiments.find((r) => r.id === op.id) ?? fail('Regiment not found');
      const s0 = r0.stands.find((s) => s.id === op.standId) ?? fail('Stand not found');
      const w = clamp(s0.wounds + Math.round(finite(op.delta, 'delta')), 0, s0.woundsMax);
      let r: Regiment = { ...r0, stands: r0.stands.map((s) => (s.id === s0.id ? { ...s, wounds: w } : s)) };
      const name = standName(r0, s0);
      let text = `${r0.name}: ${name} ${w}/${s0.woundsMax}`;
      if (w >= s0.woundsMax && !b.settings.confirmStandRemoval) {
        r = removeStandToCasualties(r, s0.id);
        text = `${r0.name}: ${name} removed`;
      }
      return { battle: updateRegimentAt(b, op.id, () => r), text };
    }
    case 'removeStand': {
      const r0 = b.regiments.find((r) => r.id === op.id) ?? fail('Regiment not found');
      const s0 = r0.stands.find((s) => s.id === op.standId) ?? fail('Stand not found');
      return { battle: updateRegimentAt(b, op.id, (r) => removeStandToCasualties(r, s0.id)), text: `${r0.name}: ${standName(r0, s0)} removed` };
    }
    case 'restoreStand': {
      const r0 = b.regiments.find((r) => r.id === op.id) ?? fail('Regiment not found');
      const s0 = r0.casualties.find((s) => s.id === op.standId) ?? fail('Casualty not found');
      const without = { ...r0, casualties: r0.casualties.filter((s) => s.id !== s0.id) };
      const taken = [...without.stands.map((s) => s.slot), ...(r0.characterSlot ? [r0.characterSlot] : [])];
      const slot = taken.some((t) => slotsOverlap(t, s0.slot)) ? nextFreeSlot(without) : s0.slot;
      const r = { ...without, stands: [...without.stands, { ...s0, wounds: 0, slot }] };
      return { battle: updateRegimentAt(b, op.id, () => r), text: `${r0.name}: ${standName(r0, s0)} restored` };
    }

    // ----- Characters -------------------------------------------------------
    case 'addCharacter': {
      const c = op.character;
      if (b.characters.some((x) => x.id === c.id)) fail('Duplicate id');
      const { attachedTo: _a, ...clean } = c;
      return { battle: { ...b, characters: [...b.characters, clean] }, text: `added character ${c.name}` };
    }
    case 'updateCharacter': {
      const c0 = b.characters.find((c) => c.id === op.id) ?? fail('Character not found');
      if (op.patch.owner && op.patch.owner !== c0.owner && c0.attachedTo) fail('Detach the character before changing owner');
      if (op.patch.rider !== undefined && c0.attachedTo) fail('Detach the character before changing rider');
      let out = updateCharacterAt(b, op.id, (c) => applyPatch(c, op.patch));
      if (op.patch.woundsMax != null) out = updateCharacterAt(out, op.id, (c) => ({ ...c, wounds: Math.min(c.wounds, c.woundsMax) }));
      return { battle: out, text: `${c0.name} edited (${Object.keys(op.patch).join(', ')})` };
    }
    case 'moveCharacter': {
      checkPose(op.pose);
      const c0 = b.characters.find((c) => c.id === op.id) ?? fail('Character not found');
      if (c0.attachedTo) fail(`${c0.name} moves with its regiment`);
      return { battle: updateCharacterAt(b, op.id, (c) => ({ ...c, ...op.pose })), text: `${c0.name} ${op.summary?.slice(0, 200) ?? 'moved'}` };
    }
    case 'setCharacterLocation': {
      if (op.pose) checkPose(op.pose);
      const c0 = b.characters.find((c) => c.id === op.id) ?? fail('Character not found');
      if (op.location === 'board') fail(`${c0.name} goes on the board by joining a regiment`);
      let out = c0.attachedTo ? detach(b, op.id) : b;
      out = updateCharacterAt(out, op.id, (c) => ({ ...c, location: op.location, ...(op.pose ?? {}) }));
      const where = { board: 'deployed to the board', reserve: 'sent to reserve', destroyed: 'marked destroyed' }[op.location];
      return { battle: out, text: `${c0.name} ${where}` };
    }
    case 'adjustCharacterWounds': {
      const c0 = b.characters.find((c) => c.id === op.id) ?? fail('Character not found');
      const w = clamp(c0.wounds + Math.round(finite(op.delta, 'delta')), 0, c0.woundsMax);
      return { battle: updateCharacterAt(b, op.id, (c) => ({ ...c, wounds: w })), text: `${c0.name}: ${w}/${c0.woundsMax} wounds` };
    }
    case 'removeCharacter': {
      const c0 = b.characters.find((c) => c.id === op.id) ?? fail('Character not found');
      const out = c0.attachedTo ? detach(b, op.id) : b;
      return { battle: { ...out, characters: out.characters.filter((c) => c.id !== op.id) }, text: `deleted character ${c0.name}` };
    }
    case 'attachCharacter': {
      const c0 = b.characters.find((c) => c.id === op.characterId) ?? fail('Character not found');
      const r0 = b.regiments.find((r) => r.id === op.regimentId) ?? fail('Regiment not found');
      if (c0.owner !== r0.owner) fail('A character can only join a regiment of the same owner');
      if (r0.characterId && r0.characterId !== c0.id) fail(`${r0.name} already has a character (${charName(b, r0.characterId) ?? '?'})`);
      const from = c0.attachedTo && c0.attachedTo !== r0.id ? b.regiments.find((r) => r.id === c0.attachedTo) : undefined;
      const left = c0.attachedTo ? detachWithNote(b, c0.id) : { battle: b };
      let out = left.battle;
      const reg = out.regiments.find((r) => r.id === r0.id)!;
      let nr: Regiment = { ...reg, characterId: c0.id };
      if (!c0.rider) {
        // Reflow with the character next to the command stand.
        nr = reflowRegiment({ ...nr, characterSlot: { rank: 0, file: -1 } }, reg.files, op.side ?? b.settings.characterSide);
      }
      out = updateRegimentAt(out, r0.id, () => nr);
      out = updateCharacterAt(out, c0.id, (c) => {
        const { x: _x, y: _y, angle: _a, ...rest } = c;
        return { ...rest, attachedTo: r0.id, location: reg.location };
      });
      const warn = c0.standType !== r0.standType && !c0.rider ? ` (stand types differ: ${c0.standType} / ${r0.standType})` : '';
      const moved = from ? `left ${from.name}${left.note ? ` (${from.name} reformed: ${left.note})` : ''} and ` : '';
      return { battle: out, text: `${c0.name} ${moved}${c0.rider ? 'rides with' : 'joined'} ${r0.name}${warn}` };
    }
    case 'detachCharacter': {
      const c0 = b.characters.find((c) => c.id === op.characterId) ?? fail('Character not found');
      if (!c0.attachedTo) fail(`${c0.name} is not attached`);
      const rn = b.regiments.find((r) => r.id === c0.attachedTo)?.name ?? 'regiment';
      const d = detachWithNote(b, c0.id);
      return { battle: d.battle, text: `${c0.name} left ${rn} for the reserve${d.note ? `; ${rn} reformed (${d.note})` : ''}` };
    }

    // ----- Free tokens ------------------------------------------------------
    case 'addMarker':
      checkPose({ ...op.marker, angle: 0 });
      return { battle: { ...b, markers: [...b.markers, op.marker] }, text: `placed marker "${op.marker.label}"` };
    case 'updateMarker': {
      const i = idx(b.markers, op.id, 'Marker');
      return { battle: { ...b, markers: setAt(b.markers, i, { ...b.markers[i], ...op.patch }) }, text: `marker "${b.markers[i].label}" updated` };
    }
    case 'removeMarker': {
      const i = idx(b.markers, op.id, 'Marker');
      return { battle: { ...b, markers: removeAt(b.markers, i) }, text: `removed marker "${b.markers[i].label}"` };
    }

    // ----- Pinned measurements ------------------------------------------------
    case 'addMeasurement': {
      const m = op.measurement;
      if (b.measurements.some((x) => x.id === m.id)) fail('Duplicate id');
      if (m.kind === 'ring') {
        finite(m.radius, 'radius');
        if (m.radius <= 0 || m.radius > 200) fail('Radius must be between 0 and 200"');
      }
      if (m.kind === 'ruler') {
        checkPose({ ...m.a, angle: 0 });
        checkPose({ ...m.b, angle: 0 });
      }
      const what = m.kind === 'ruler' ? 'a ruler' : m.kind === 'distance' ? 'a distance' : `a range ring (${m.label} ${(Math.round(m.radius * 10) / 10).toFixed(1)}")`;
      return { battle: { ...b, measurements: [...b.measurements, { ...m, by: env.by }] }, text: `pinned ${what}` };
    }
    case 'removeMeasurement': {
      const i = idx(b.measurements, op.id, 'Measurement');
      return { battle: { ...b, measurements: removeAt(b.measurements, i) }, text: 'removed a pinned measurement' };
    }
    case 'clearMeasurements':
      return { battle: { ...b, measurements: [] }, text: 'cleared pinned measurements' };

    // ----- Misc ----------------------------------------------------------------
    case 'rollDice': {
      const r = op.roll;
      if (b.dice.some((d) => d.id === r.id)) fail('Duplicate roll');
      if (!r.results.length || r.results.length > 60 || r.results.some((n) => !Number.isInteger(n) || n < 1 || n > 6)) fail('Invalid dice');
      r.proof?.forEach(checkDraw);
      const dice = [...b.dice, { ...r, rerolled: r.results.map(() => false) }].slice(-DICE_KEPT);
      return { battle: { ...b, dice }, text: describeRoll(r), kind: 'dice', noUndo: true };
    }
    case 'rerollDice': {
      const i = b.dice.findIndex((d) => d.id === op.id);
      if (i < 0) fail('That roll is no longer in the tray');
      const r0 = b.dice[i];
      if (!op.indices.length || op.indices.length !== op.values.length) fail('Nothing to re-roll');
      if (new Set(op.indices).size !== op.indices.length) fail('A die is listed twice');
      for (const k of op.indices) {
        if (!Number.isInteger(k) || k < 0 || k >= r0.results.length) fail('No such die');
        if (r0.rerolled[k]) fail('A die can be re-rolled only once');
      }
      if (op.values.some((n) => !Number.isInteger(n) || n < 1 || n > 6)) fail('Invalid dice');
      const results = r0.results.slice();
      const rerolled = r0.rerolled.slice();
      op.indices.forEach((k, j) => {
        results[k] = op.values[j];
        rerolled[k] = true;
      });
      const nr: DiceRoll = {
        ...r0,
        results,
        rerolled,
        source: op.source === 'local' ? 'local' : r0.source,
        ...(op.proof ? { proof: [...(r0.proof ?? []), checkDraw(op.proof)] } : {}),
      };
      const before = op.indices.map((k) => r0.results[k]).join(', ');
      return {
        battle: { ...b, dice: setAt(b.dice, i, nr) },
        text: `re-rolled ${diceWord(op.indices.length)} of "${r0.label || 'roll'}": ${before} → ${op.values.join(', ')} (${sourceText(op.source, op.proof)})${successText(nr)}`,
        kind: 'dice',
        noUndo: true,
      };
    }
    case 'logNote':
      if (!op.text.trim()) fail('Empty note');
      return { battle: b, text: op.text.slice(0, 2000), noUndo: true };
    case 'chat':
      if (!op.text.trim()) fail('Empty message');
      return { battle: b, text: op.text.slice(0, 500), kind: 'chat', noUndo: true };
    case 'restore': {
      let out = b;
      for (const e of op.entries) {
        if (e.kind === 'field') {
          out = { ...out, [e.field]: e.value } as Battle;
          continue;
        }
        const arr = out[e.coll] as { id: string }[];
        const i = arr.findIndex((x) => x.id === e.id);
        let next: { id: string }[];
        if (e.value === null) next = i >= 0 ? removeAt(arr, i) : arr;
        else if (i >= 0) next = setAt(arr, i, e.value as { id: string });
        else {
          next = arr.slice();
          next.splice(Math.min(e.index, next.length), 0, e.value as { id: string });
        }
        out = { ...out, [e.coll]: next } as Battle;
      }
      return { battle: out, text: `undid: ${op.label.slice(0, 200)}` };
    }
    // ----- Command stacks (server-made; the secret order lives with the dealer) -----
    case 'lockCommandStack': {
      const c = b.command[op.seat];
      if (c.locked) fail('The stack is already locked');
      if (!Number.isInteger(op.size) || op.size < 1 || op.size > MAX_STACK) fail('A stack needs at least one card');
      const round = c.round + 1;
      return {
        battle: { ...b, command: { ...b.command, [op.seat]: { round, locked: true, size: op.size, revealed: [] } } },
        text: `locked a command stack of ${op.size} card${op.size === 1 ? '' : 's'} for round ${round}`,
        noUndo: true,
      };
    }
    case 'unlockCommandStack': {
      const c = b.command[op.seat];
      if (!c.locked) fail('The stack is not locked');
      if (c.revealed.length) fail('Cards have been flipped already');
      return {
        battle: { ...b, command: { ...b.command, [op.seat]: { ...c, round: c.round - 1, locked: false, size: 0 } } },
        text: 'is rebuilding the command stack',
        noUndo: true,
      };
    }
    case 'revealCommandCard': {
      const c = b.command[op.seat];
      if (!c.locked) fail('Lock the stack first');
      if (c.revealed.length >= c.size) fail('No cards left to flip');
      const n = c.revealed.length + 1;
      const card = { kind: op.card.kind, id: op.card.id, name: String(op.card.name).slice(0, 80), at: env.at };
      return {
        battle: { ...b, command: { ...b.command, [op.seat]: { ...c, revealed: [...c.revealed, card] } } },
        text: `command card ${n}/${c.size}: ${card.name}`,
        noUndo: true,
      };
    }
    case 'addCommandCard': {
      const c = b.command[op.seat];
      if (!c.locked) fail('Lock the stack first');
      if (c.size >= MAX_STACK) fail('The stack is full');
      return {
        battle: { ...b, command: { ...b.command, [op.seat]: { ...c, size: c.size + 1 } } },
        text: `added a reserve card to the command stack (now ${c.size + 1} cards)`,
        noUndo: true,
      };
    }
    case 'unrevealCommandCard': {
      const c = b.command[op.seat];
      const last = c.revealed.at(-1) ?? fail('No card to take back');
      return {
        battle: { ...b, command: { ...b.command, [op.seat]: { ...c, revealed: c.revealed.slice(0, -1) } } },
        text: `took back the command card ${last.name}`,
        noUndo: true,
      };
    }
    case 'clearCommandStack': {
      const c = b.command[op.seat];
      const left = c.size - c.revealed.length;
      return {
        battle: { ...b, command: { ...b.command, [op.seat]: { ...c, locked: false, size: 0, revealed: [] } } },
        text: c.locked ? `ended round ${c.round}${left ? ` with ${left} card${left === 1 ? '' : 's'} unflipped` : ''}` : 'cleared the command stack',
        noUndo: true,
      };
    }

    case 'replaceBattle': {
      const nb = normalizeBattle(op.battle);
      return { battle: { ...nb, id: b.id, seq: b.seq, log: b.log }, text: `loaded battle "${nb.name}"` };
    }
  }
}

// ---------------------------------------------------------------------------
// Inverse computation
// ---------------------------------------------------------------------------

/**
 * Restore entries that turn `after` back into `before`. Relies on the reducer's
 * structural sharing: entities it did not change keep the same reference.
 */
export function diffForRestore(before: Battle, after: Battle): { entries: RestoreEntry[]; touched: string[] } {
  const entries: RestoreEntry[] = [];
  const touched: string[] = [];
  for (const field of DOC_FIELDS) {
    if (before[field] !== after[field]) {
      entries.push({ kind: 'field', field, value: before[field] });
      touched.push(`#${field}`);
    }
  }
  for (const coll of COLLECTIONS) {
    const A = before[coll] as { id: string }[];
    const B = after[coll] as { id: string }[];
    if (A === B) continue;
    const mapA = new Map(A.map((x, i) => [x.id, { x, i }]));
    const mapB = new Map(B.map((x) => [x.id, x]));
    // Removed or changed entities get their old value back (in original order).
    A.forEach((x, i) => {
      if (mapB.get(x.id) !== x) {
        entries.push({ kind: 'entity', coll, id: x.id, value: x, index: i });
        touched.push(x.id);
      }
    });
    // Added entities are removed.
    for (const x of B) {
      if (!mapA.has(x.id)) {
        entries.push({ kind: 'entity', coll, id: x.id, value: null, index: 0 });
        touched.push(x.id);
      }
    }
  }
  return { entries, touched };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function applyOp(battle: Battle, env: OpEnvelope): ApplyResult {
  let r: Reduced;
  try {
    r = reduce(battle, env);
  } catch (e) {
    if (e instanceof OpError) return { ok: false, error: e.message };
    throw e;
  }
  const seq = env.seq ?? battle.seq + 1;
  const kind = r.kind ?? 'op';
  const { entries, touched } = diffForRestore(battle, r.battle);
  const log: LogEntry = {
    id: env.id,
    seq,
    at: env.at,
    by: env.by,
    kind,
    text: kind === 'chat' ? r.text : `${authorName(battle, env.by)}: ${r.text}`,
  };
  const logs = [...r.battle.log, log];
  const next: Battle = { ...r.battle, seq, log: logs.length > LOG_LIMIT ? logs.slice(logs.length - LOG_LIMIT) : logs };
  const inverse: Op | null = r.noUndo || entries.length === 0 ? null : { type: 'restore', label: r.text, entries };
  return { ok: true, battle: next, inverse, touched, log };
}

/** Apply a list of envelopes, skipping rejected ones. Handy for replays and tests. */
export function applyAll(battle: Battle, envs: OpEnvelope[]): Battle {
  let b = battle;
  for (const e of envs) {
    const r = applyOp(b, e);
    if (r.ok) b = r.battle;
  }
  return b;
}
