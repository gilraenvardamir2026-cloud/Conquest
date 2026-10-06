// Zod schemas for everything a client may send. The server parses every
// incoming message with these before anything else touches it; unknown keys
// are dropped and sizes are capped. Server-only operations (dice, restore,
// replaceBattle) are not part of the client schema at all. A whole battle is
// only accepted when a browser re-uploads a room the server lost
// (parseRecoveredBattle).

import { z } from 'zod';
import { TERRAIN_KEYWORDS } from './presets';
import type { ClientMsg } from './protocol';
import type { Battle } from './types';

const coord = z.number().min(-1000).max(1000);
const len = z.number().min(0).max(1000);
const angle = z.number().min(-3600).max(3600);
const id = z.string().min(1).max(64);
const text = (max: number) => z.string().max(max);
const seat = z.enum(['p1', 'p2']);
const standType = z.enum(['infantry', 'cavalry', 'brute', 'chariot', 'monster', 'custom']);
const location = z.enum(['board', 'reserve', 'destroyed']);
const keyword = z.enum(TERRAIN_KEYWORDS as [string, ...string[]]);
const vec = z.object({ x: coord, y: coord });
const pose = z.object({ x: coord, y: coord, angle });
const slot = z.object({ rank: z.number().int().min(0).max(100), file: z.number().min(-100).max(100) });
const wounds = z.number().int().min(0).max(99);

const stand = z.object({
  id,
  slot,
  woundsMax: z.number().int().min(1).max(99),
  wounds,
  isCommand: z.boolean(),
  label: text(40).optional(),
});

const regiment = z.object({
  id,
  owner: seat,
  name: text(80),
  notes: text(5000),
  standType,
  standW: len,
  standD: len,
  size: z.number().int().min(0).max(10),
  sizeOverride: z.number().int().min(0).max(10).optional(),
  files: z.number().int().min(1).max(60),
  stands: z.array(stand).min(1).max(100),
  casualties: z.array(stand).max(100),
  x: coord,
  y: coord,
  angle,
  location,
  march: len.optional(),
  barrageRange: len.optional(),
  tags: z.array(text(40)).max(30),
});

const character = z.object({
  id,
  owner: seat,
  name: text(80),
  notes: text(5000),
  standType,
  standW: len,
  standD: len,
  woundsMax: z.number().int().min(1).max(99),
  wounds,
  rider: z.boolean().optional(),
  x: coord.optional(),
  y: coord.optional(),
  angle: angle.optional(),
  location,
});

const shape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rect'), w: len, d: len }),
  z.object({ kind: z.literal('ellipse'), rx: len, ry: len }),
  z.object({ kind: z.literal('polygon'), points: z.array(z.tuple([coord, coord])).min(3).max(200) }),
]);

const garrisonBlock = z.object({ defense: z.number().int().min(0).max(20), capacity: z.number().int().min(0).max(50) });

const terrain = z.object({
  id,
  name: text(80),
  shape,
  x: coord,
  y: coord,
  angle,
  size: z.number().int().min(0).max(10),
  keywords: z.array(keyword).max(12),
  garrison: garrisonBlock.optional(),
  locked: z.boolean(),
});

const zone = z.object({ id, label: text(20).optional(), x: coord, y: coord, diameter: len, friendlyTo: seat.optional(), locked: z.boolean() });

const objectiveMarker = z.object({
  id,
  label: text(20).optional(),
  x: coord,
  y: coord,
  friendlyTo: seat.optional(),
  woundsMax: z.number().int().min(1).max(20),
  damageBy: z.object({ p1: wounds, p2: wounds }),
  destroyed: z.boolean(),
  locked: z.boolean(),
});

const entityRef = z.object({ kind: z.enum(['regiment', 'character', 'terrain', 'objective', 'zone']), id, standId: id.optional() });
const measurement = z.discriminatedUnion('kind', [
  z.object({ id, kind: z.literal('ruler'), by: z.enum(['p1', 'p2', 'spectator', 'system']), a: vec, b: vec }),
  z.object({ id, kind: z.literal('distance'), by: z.enum(['p1', 'p2', 'spectator', 'system']), a: entityRef, b: entityRef }),
  z.object({ id, kind: z.literal('ring'), by: z.enum(['p1', 'p2', 'spectator', 'system']), ref: entityRef, radius: len, label: text(80) }),
]);

const nul = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();

const standPreset = z.object({ w: len, d: len, size: z.number().int().min(0).max(10) });
const settingsPatch = z
  .object({
    standPresets: z.object({ infantry: standPreset, cavalry: standPreset, brute: standPreset, chariot: standPreset, monster: standPreset }),
    confirmStandRemoval: z.boolean(),
    woundTies: z.enum(['ask', 'left']),
    reformOnDetach: z.boolean(),
    characterSide: z.enum(['left', 'right']),
    losObstructing: z.enum(['tournament', 'core']),
    losSizeComparison: z.enum(['both', 'acting']),
    losAllFrontIds: z.array(id).max(200),
    losSampleStep: z.number().min(0.05).max(2),
    anyoneCanEdit: z.boolean(),
    boardLocked: z.boolean(),
  })
  .partial();

/** Every operation a client may send. */
export const clientOpSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setScenario'), scenarioId: text(20) }),
  z.object({
    type: z.literal('updateBoard'),
    patch: z
      .object({
        grid: z.union([z.literal(0), z.literal(1), z.literal(6), z.literal(12)]),
        width: z.number().min(12).max(200),
        depth: z.number().min(12).max(200),
        noReinforcement: z.array(z.object({ edge: z.enum(['left', 'right']), from: len, to: len })).max(4),
      })
      .partial(),
  }),
  z.object({ type: z.literal('renameBattle'), name: text(120) }),
  z.object({ type: z.literal('updatePlayer'), seat, patch: z.object({ name: text(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).partial() }),
  z.object({ type: z.literal('updateSettings'), patch: settingsPatch }),
  z.object({ type: z.literal('setTerrainLayout'), layoutId: text(20), garrisonBuildings: z.boolean().optional() }),
  z.object({ type: z.literal('clearTerrain') }),
  z.object({ type: z.literal('addTerrain'), terrain }),
  z.object({
    type: z.literal('updateTerrain'),
    id,
    patch: z.object({
      name: nul(text(80)),
      shape: nul(shape),
      x: nul(coord),
      y: nul(coord),
      angle: nul(angle),
      size: nul(z.number().int().min(0).max(10)),
      keywords: nul(z.array(keyword).max(12)),
      locked: nul(z.boolean()),
      garrison: garrisonBlock.nullable().optional(),
    }),
  }),
  z.object({ type: z.literal('removeTerrain'), id }),
  z.object({ type: z.literal('occupyGarrison'), terrainId: id, regimentId: id.nullable() }),
  z.object({ type: z.literal('addZone'), zone }),
  z.object({ type: z.literal('updateZone'), id, patch: z.object({ label: nul(text(20)), x: nul(coord), y: nul(coord), diameter: nul(len), friendlyTo: nul(seat) }) }),
  z.object({ type: z.literal('removeZone'), id }),
  z.object({ type: z.literal('addObjectiveMarker'), marker: objectiveMarker }),
  z.object({
    type: z.literal('updateObjectiveMarker'),
    id,
    patch: z.object({ label: nul(text(20)), x: nul(coord), y: nul(coord), friendlyTo: nul(seat), woundsMax: nul(z.number().int().min(1).max(20)) }),
  }),
  z.object({ type: z.literal('removeObjectiveMarker'), id }),
  z.object({ type: z.literal('damageObjectiveMarker'), id, seat, delta: z.number().int().min(-20).max(20) }),
  z.object({ type: z.literal('setObjectiveMarkerDestroyed'), id, destroyed: z.boolean() }),
  z.object({ type: z.literal('addRegiment'), regiment }),
  z.object({
    type: z.literal('updateRegiment'),
    id,
    patch: z.object({
      name: nul(text(80)),
      notes: nul(text(5000)),
      tags: nul(z.array(text(40)).max(30)),
      march: nul(len),
      barrageRange: nul(len),
      sizeOverride: nul(z.number().int().min(0).max(10)),
      standType: nul(standType),
      standW: nul(len),
      standD: nul(len),
      size: nul(z.number().int().min(0).max(10)),
      owner: nul(seat),
    }),
  }),
  z.object({ type: z.literal('moveRegiment'), id, pose, summary: text(300).optional() }),
  z.object({ type: z.literal('setRegimentLocation'), id, location, pose: pose.optional() }),
  z.object({ type: z.literal('removeRegiment'), id }),
  z.object({ type: z.literal('addStands'), id, count: z.number().int().min(1).max(60) }),
  z.object({ type: z.literal('deleteStand'), id, standId: id }),
  z.object({ type: z.literal('setWoundsPerStand'), id, woundsMax: z.number().int().min(1).max(99) }),
  z.object({ type: z.literal('setCommandStand'), id, standId: id.nullable() }),
  z.object({ type: z.literal('updateStand'), id, standId: id, label: text(40).nullable() }),
  z.object({ type: z.literal('reformRegiment'), id, files: z.number().int().min(1).max(60), slots: z.record(id, slot).optional() }),
  z.object({ type: z.literal('applyWounds'), id, count: z.number().int().min(1).max(200), choices: z.array(id).max(200).optional() }),
  z.object({ type: z.literal('adjustStandWounds'), id, standId: id, delta: z.number().int().min(-99).max(99) }),
  z.object({ type: z.literal('removeStand'), id, standId: id }),
  z.object({ type: z.literal('restoreStand'), id, standId: id }),
  z.object({ type: z.literal('addCharacter'), character }),
  z.object({
    type: z.literal('updateCharacter'),
    id,
    patch: z.object({
      name: nul(text(80)),
      notes: nul(text(5000)),
      standType: nul(standType),
      standW: nul(len),
      standD: nul(len),
      woundsMax: nul(z.number().int().min(1).max(99)),
      rider: nul(z.boolean()),
      owner: nul(seat),
    }),
  }),
  z.object({ type: z.literal('moveCharacter'), id, pose, summary: text(300).optional() }),
  z.object({ type: z.literal('setCharacterLocation'), id, location, pose: pose.optional() }),
  z.object({ type: z.literal('adjustCharacterWounds'), id, delta: z.number().int().min(-99).max(99) }),
  z.object({ type: z.literal('removeCharacter'), id }),
  z.object({ type: z.literal('attachCharacter'), characterId: id, regimentId: id, side: z.enum(['left', 'right']).optional() }),
  z.object({ type: z.literal('detachCharacter'), characterId: id }),
  z.object({ type: z.literal('addMarker'), marker: z.object({ id, label: text(40), x: coord, y: coord }) }),
  z.object({ type: z.literal('updateMarker'), id, patch: z.object({ label: text(40), x: coord, y: coord }).partial() }),
  z.object({ type: z.literal('removeMarker'), id }),
  z.object({ type: z.literal('addMeasurement'), measurement }),
  z.object({ type: z.literal('removeMeasurement'), id }),
  z.object({ type: z.literal('clearMeasurements') }),
  z.object({ type: z.literal('chat'), text: text(500) }),
  z.object({ type: z.literal('logNote'), text: text(2000) }),
]);

const presence = z
  .object({
    cursor: vec.nullable(),
    selection: z.object({ kind: text(20), id }).nullable(),
    tool: text(20),
    move: z.object({ piece: z.object({ kind: z.enum(['regiment', 'character']), id }), pose }).nullable(),
    ruler: z.object({ a: vec, b: vec }).nullable(),
    pair: z.array(entityRef).max(2),
    los: z.object({ acting: z.object({ kind: z.enum(['regiment', 'objective']), id }), target: z.object({ kind: z.enum(['regiment', 'objective']), id }), mode: z.enum(['sight', 'volley']) }).nullable(),
    ring: z.object({ ref: entityRef, radii: z.array(z.object({ radius: len, label: text(40) })).max(6) }).nullable(),
    align: z.object({ targetKind: z.enum(['regiment', 'objective']), targetId: id, facing: z.enum(['front', 'left', 'right', 'rear']) }).nullable(),
  })
  .partial();

const cardRef = z.object({ kind: z.enum(['regiment', 'character']), id });
const stackAction = z.discriminatedUnion('t', [
  z.object({ t: z.literal('set'), cards: z.array(cardRef).max(100) }),
  z.object({ t: z.literal('lock') }),
  z.object({ t: z.literal('unlock') }),
  z.object({ t: z.literal('flip') }),
  z.object({ t: z.literal('unflip') }),
  z.object({ t: z.literal('clear') }),
]);

export const clientMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), room: text(12), token: z.string().min(16).max(64), name: text(40).optional(), lastSeq: z.number().int().min(0).optional(), wasSeat: seat.optional() }),
  z.object({ t: z.literal('claim'), seat, name: text(40) }),
  z.object({ t: z.literal('op'), id: z.string().min(6).max(40), op: clientOpSchema }),
  z.object({ t: z.literal('undo') }),
  z.object({ t: z.literal('presence'), p: presence }),
  z.object({ t: z.literal('roll'), count: z.number().int().min(1).max(60), label: text(80), target: z.number().int().min(1).max(6).optional() }),
  z.object({ t: z.literal('reroll'), id, indices: z.array(z.number().int().min(0).max(59)).min(1).max(60) }),
  z.object({ t: z.literal('rolloff') }),
  z.object({ t: z.literal('freeSeat'), seat }),
  z.object({ t: z.literal('stack'), action: stackAction }),
  z.object({ t: z.literal('stackRestore'), cards: z.array(cardRef).max(100) }),
  z.object({ t: z.literal('ping') }),
]);

// ---------------------------------------------------------------------------
// A whole battle (room recovery after a server restart)
// ---------------------------------------------------------------------------

const author = z.enum(['p1', 'p2', 'spectator', 'system']);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const commandCard = z.object({ kind: z.enum(['regiment', 'character']), id, name: text(80) });
const commandState = z.object({
  round: z.number().int().min(0).max(1000),
  locked: z.boolean(),
  size: z.number().int().min(0).max(100),
  revealed: z.array(commandCard.extend({ at: z.number() })).max(100),
});

export const battleSchema = z.object({
  id: text(64),
  name: text(120),
  version: z.number().int().min(1).max(100),
  seq: z.number().int().min(0).max(1e9),
  board: z.object({
    width: z.number().min(1).max(200),
    depth: z.number().min(1).max(200),
    grid: z.union([z.literal(0), z.literal(1), z.literal(6), z.literal(12)]),
    scenarioId: text(20).optional(),
    noReinforcement: z.array(z.object({ edge: z.enum(['left', 'right']), from: coord, to: coord })).max(8),
  }),
  players: z.object({
    p1: z.object({ name: text(40), color, connected: z.boolean() }),
    p2: z.object({ name: text(40), color, connected: z.boolean() }),
  }),
  terrain: z.array(terrain.extend({ garrison: garrisonBlock.extend({ occupiedBy: id.optional() }).optional() })).max(200),
  zones: z.array(zone).max(50),
  objectiveMarkers: z.array(objectiveMarker).max(50),
  regiments: z.array(regiment.extend({ characterId: id.optional(), characterSlot: slot.optional(), garrisonId: id.optional() })).max(200),
  characters: z.array(character.extend({ attachedTo: id.optional() })).max(100),
  markers: z.array(z.object({ id, label: text(40), x: coord, y: coord })).max(200),
  dice: z
    .array(
      z.object({
        id,
        by: seat,
        label: text(80),
        at: z.number(),
        results: z.array(z.number().int().min(1).max(6)).max(60),
        target: z.number().int().min(1).max(6).optional(),
        rerolled: z.array(z.boolean()).max(60),
        source: z.enum(['random.org', 'local']),
        kind: z.enum(['roll', 'rolloff']).optional(),
        ties: z.array(z.tuple([z.number().int(), z.number().int()])).max(60).optional(),
      }),
    )
    .max(50),
  measurements: z.array(measurement).max(500),
  command: z
    .object({
      p1: commandState,
      p2: commandState,
    })
    .optional(),
  settings: settingsPatch,
  log: z.array(z.object({ id: text(64), seq: z.number().int().min(0), at: z.number(), by: author, kind: z.enum(['op', 'chat', 'dice', 'system']), text: text(2500) })).max(1000),
});

/**
 * Check a battle a browser re-uploads: the shape, then that ids are unique
 * and every cross-reference points at something that exists, so the reducer
 * never meets a dangling id.
 */
export function parseRecoveredBattle(raw: unknown): { ok: true; battle: Battle } | { ok: false; error: string } {
  const r = battleSchema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    return { ok: false, error: `Invalid battle${first ? `: ${first.path.join('.')} ${first.message}` : ''}` };
  }
  const b = r.data as unknown as Battle;
  const ids = new Set<string>();
  const unique = (xs: { id: string }[]) => xs.every((x) => !ids.has(x.id) && !!ids.add(x.id));
  if (![b.terrain, b.zones, b.objectiveMarkers, b.regiments, b.characters, b.markers].every(unique)) return { ok: false, error: 'Invalid battle: repeated id' };
  const regs = new Map(b.regiments.map((x) => [x.id, x]));
  const chars = new Map(b.characters.map((x) => [x.id, x]));
  const terr = new Map(b.terrain.map((x) => [x.id, x]));
  for (const reg of b.regiments) {
    if (reg.characterId && chars.get(reg.characterId)?.attachedTo !== reg.id) return { ok: false, error: `Invalid battle: ${reg.name}'s character` };
    if (reg.garrisonId && terr.get(reg.garrisonId)?.garrison?.occupiedBy !== reg.id) return { ok: false, error: `Invalid battle: ${reg.name}'s garrison` };
  }
  for (const c of b.characters) if (c.attachedTo && regs.get(c.attachedTo)?.characterId !== c.id) return { ok: false, error: `Invalid battle: ${c.name}'s regiment` };
  for (const t of b.terrain) if (t.garrison?.occupiedBy && regs.get(t.garrison.occupiedBy)?.garrisonId !== t.id) return { ok: false, error: `Invalid battle: ${t.name}'s garrison` };
  return { ok: true, battle: b };
}

/** Parse a raw message; returns the cleaned message or an error string. */
export function parseClientMsg(raw: unknown): { ok: true; msg: ClientMsg } | { ok: false; error: string } {
  const r = clientMsgSchema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    return { ok: false, error: `Invalid message${first ? `: ${first.path.join('.')} ${first.message}` : ''}` };
  }
  return { ok: true, msg: r.data as ClientMsg };
}
