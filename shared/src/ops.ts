// Typed operations. Every change to a battle is one of these, applied by the
// pure reducer in reducer.ts so that every client (and later the server)
// computes identical state from the same sequence.

import type {
  Author,
  Battle,
  BattleSettings,
  Board,
  Character,
  FreeMarker,
  Location,
  ObjectiveMarker,
  PlayerInfo,
  PlayerSeat,
  Regiment,
  Slot,
  Terrain,
  Zone,
} from './types';

/** A patch where `null` clears an optional field. */
export type Patch<T> = { [K in keyof T]?: T[K] | null };

export interface PoseArgs {
  x: number;
  y: number;
  angle: number;
}

export type RegimentPatch = Patch<
  Pick<
    Regiment,
    'name' | 'notes' | 'tags' | 'march' | 'barrageRange' | 'sizeOverride' | 'standType' | 'standW' | 'standD' | 'size' | 'owner'
  >
>;
export type CharacterPatch = Patch<
  Pick<Character, 'name' | 'notes' | 'standType' | 'standW' | 'standD' | 'woundsMax' | 'rider' | 'owner'>
>;
export type TerrainPatch = Patch<Pick<Terrain, 'name' | 'shape' | 'x' | 'y' | 'angle' | 'size' | 'keywords' | 'locked'>> & {
  /** null removes the garrison block. */
  garrison?: { defense: number; capacity: number } | null;
};
export type ZonePatch = Patch<Pick<Zone, 'label' | 'x' | 'y' | 'diameter' | 'friendlyTo'>>;
export type ObjectiveMarkerPatch = Patch<Pick<ObjectiveMarker, 'label' | 'x' | 'y' | 'friendlyTo' | 'woundsMax'>>;

export type Collection = 'regiments' | 'characters' | 'terrain' | 'zones' | 'objectiveMarkers' | 'markers';
export const COLLECTIONS: Collection[] = ['regiments', 'characters', 'terrain', 'zones', 'objectiveMarkers', 'markers'];
export type DocField = 'board' | 'settings' | 'players' | 'name';
export const DOC_FIELDS: DocField[] = ['board', 'settings', 'players', 'name'];

/** One piece of a restore (undo) operation: an entity's previous value, or a whole top-level field. */
export type RestoreEntry =
  | { kind: 'entity'; coll: Collection; id: string; value: unknown | null; index: number }
  | { kind: 'field'; field: DocField; value: unknown };

export type Op =
  // Board and scenario
  | { type: 'setScenario'; scenarioId: string | 'custom' }
  | { type: 'updateBoard'; patch: Partial<Pick<Board, 'grid' | 'width' | 'depth' | 'noReinforcement'>> }
  | { type: 'renameBattle'; name: string }
  | { type: 'updatePlayer'; seat: PlayerSeat; patch: Partial<Pick<PlayerInfo, 'name' | 'color'>> }
  | { type: 'updateSettings'; patch: Partial<BattleSettings> }
  // Terrain
  | { type: 'setTerrainLayout'; layoutId: string; garrisonBuildings?: boolean }
  | { type: 'clearTerrain' }
  | { type: 'addTerrain'; terrain: Terrain }
  | { type: 'updateTerrain'; id: string; patch: TerrainPatch }
  | { type: 'removeTerrain'; id: string }
  | { type: 'occupyGarrison'; terrainId: string; regimentId: string | null }
  // Objectives
  | { type: 'addZone'; zone: Zone }
  | { type: 'updateZone'; id: string; patch: ZonePatch }
  | { type: 'removeZone'; id: string }
  | { type: 'addObjectiveMarker'; marker: ObjectiveMarker }
  | { type: 'updateObjectiveMarker'; id: string; patch: ObjectiveMarkerPatch }
  | { type: 'removeObjectiveMarker'; id: string }
  | { type: 'damageObjectiveMarker'; id: string; seat: PlayerSeat; delta: number }
  | { type: 'setObjectiveMarkerDestroyed'; id: string; destroyed: boolean }
  // Regiments
  | { type: 'addRegiment'; regiment: Regiment }
  | { type: 'updateRegiment'; id: string; patch: RegimentPatch }
  | { type: 'moveRegiment'; id: string; pose: PoseArgs; summary?: string }
  | { type: 'setRegimentLocation'; id: string; location: Location; pose?: PoseArgs }
  | { type: 'removeRegiment'; id: string }
  | { type: 'addStands'; id: string; count: number }
  | { type: 'deleteStand'; id: string; standId: string }
  | { type: 'setWoundsPerStand'; id: string; woundsMax: number }
  | { type: 'setCommandStand'; id: string; standId: string | null }
  | { type: 'updateStand'; id: string; standId: string; label: string | null }
  | { type: 'reformRegiment'; id: string; files: number; slots?: Record<string, Slot> }
  /** `choices`: stand ids the player picked, one per tie between equidistant stands, in order. */
  | { type: 'applyWounds'; id: string; count: number; choices?: string[] }
  | { type: 'adjustStandWounds'; id: string; standId: string; delta: number }
  | { type: 'removeStand'; id: string; standId: string }
  | { type: 'restoreStand'; id: string; standId: string }
  // Characters
  | { type: 'addCharacter'; character: Character }
  | { type: 'updateCharacter'; id: string; patch: CharacterPatch }
  | { type: 'moveCharacter'; id: string; pose: PoseArgs; summary?: string }
  | { type: 'setCharacterLocation'; id: string; location: Location; pose?: PoseArgs }
  | { type: 'adjustCharacterWounds'; id: string; delta: number }
  | { type: 'removeCharacter'; id: string }
  | { type: 'attachCharacter'; characterId: string; regimentId: string; side?: 'left' | 'right' }
  | { type: 'detachCharacter'; characterId: string }
  // Free tokens
  | { type: 'addMarker'; marker: FreeMarker }
  | { type: 'updateMarker'; id: string; patch: Partial<Pick<FreeMarker, 'label' | 'x' | 'y'>> }
  | { type: 'removeMarker'; id: string }
  // Misc
  | { type: 'chat'; text: string }
  | { type: 'restore'; label: string; entries: RestoreEntry[] }
  | { type: 'replaceBattle'; battle: Battle };

export type OpType = Op['type'];

export interface OpEnvelope {
  /** Unique id chosen by the sender; also seeds ids the reducer creates. */
  id: string;
  by: Author;
  /** Timestamp (ms). Set by the sender locally, by the server once multiplayer exists. */
  at: number;
  /** Sequence number assigned by the server; local play uses battle.seq + 1. */
  seq?: number;
  op: Op;
}
