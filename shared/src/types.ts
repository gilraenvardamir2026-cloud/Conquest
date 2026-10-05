// Battle document types. The whole battle is one JSON document; every change
// is a typed operation (see ops.ts) applied by a pure reducer.
//
// Units: every length is in inches (float). Origin is the board's top-left
// corner, x runs across the 72" side, y runs down the 48" side.
// Angles are degrees, clockwise on screen, 0 = facing up the board (-y).

export type PlayerSeat = 'p1' | 'p2';
export type Author = PlayerSeat | 'spectator' | 'system';
export type StandType = 'infantry' | 'cavalry' | 'brute' | 'chariot' | 'monster' | 'custom';

/**
 * Fixed grid position of a stand inside its regiment.
 * rank 0 = front rank, file 0 = leftmost. `file` may be fractional: an
 * incomplete rear rank is centred, so its stands sit at half-stand offsets.
 */
export type Slot = { rank: number; file: number };

export type Location = 'board' | 'reserve' | 'destroyed';

export interface Zone {
  id: string;
  label?: string;
  x: number;
  y: number;
  diameter: number;
  friendlyTo?: PlayerSeat;
  locked: boolean;
}

export interface ObjectiveMarker {
  id: string;
  label?: string;
  x: number;
  y: number;
  friendlyTo?: PlayerSeat;
  woundsMax: number; // 3
  damageBy: Record<PlayerSeat, number>;
  destroyed: boolean;
  locked: boolean;
}

export interface NoReinforcementEdge {
  edge: 'left' | 'right';
  from: number;
  to: number;
}

export interface Board {
  width: number;
  depth: number;
  grid: 0 | 1 | 6 | 12;
  /** Set = zones and markers come from this scenario and are locked. */
  scenarioId?: string;
  noReinforcement: NoReinforcementEdge[];
}

export interface PlayerInfo {
  name: string;
  color: string;
  connected: boolean;
}

export interface FreeMarker {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface Stand {
  id: string;
  slot: Slot;
  woundsMax: number;
  /** Damage taken, 0..woundsMax. */
  wounds: number;
  /** Exactly one per infantry/cavalry/brute regiment. */
  isCommand: boolean;
  label?: string;
}

export interface Regiment {
  id: string;
  owner: PlayerSeat;
  name: string;
  notes: string;
  standType: StandType;
  /** Stand footprint in inches (front width × depth), from the stand-type preset. */
  standW: number;
  standD: number;
  /** LoS size from the stand type: infantry 1, cav/brute/chariot 2, monster 3. */
  size: number;
  sizeOverride?: number;
  /** Stands per rank. */
  files: number;
  stands: Stand[];
  /** Removed stands, restorable to their old slot. */
  casualties: Stand[];
  characterId?: string;
  characterSlot?: Slot;
  /** Pose of the front-left corner. */
  x: number;
  y: number;
  angle: number;
  location: Location;
  march?: number;
  barrageRange?: number;
  tags: string[];
  /** Terrain id of the garrison piece this regiment occupies. */
  garrisonId?: string;
}

export interface Character {
  id: string;
  owner: PlayerSeat;
  name: string;
  notes: string;
  standType: StandType;
  standW: number;
  standD: number;
  woundsMax: number;
  wounds: number;
  /** Regiment id. */
  attachedTo?: string;
  /** No own stand; shown as a badge on a monster regiment. */
  rider?: boolean;
  /** Pose of the front-left corner when drawn on its own. */
  x?: number;
  y?: number;
  angle?: number;
  location: Location;
}

export type TerrainKeyword =
  | 'Elevated'
  | 'Cover'
  | 'Obscuring'
  | 'Obstructing'
  | 'Traversable'
  | 'Hindering'
  | 'Broken Ground'
  | 'Dangerous'
  | 'Perilous'
  | 'Impassable'
  | 'Water'
  | 'Garrison';

export type TerrainShape =
  | { kind: 'rect'; w: number; d: number }
  | { kind: 'ellipse'; rx: number; ry: number }
  /** Points relative to the piece centre (x, y), before rotation. */
  | { kind: 'polygon'; points: [number, number][] };

export interface Terrain {
  id: string;
  name: string;
  shape: TerrainShape;
  /** Centre of the piece. */
  x: number;
  y: number;
  angle: number;
  /** 0..4, the tournament pack's "Elevation (X)". */
  size: number;
  keywords: TerrainKeyword[];
  garrison?: { defense: number; capacity: number; occupiedBy?: string };
  /** Set by the players, never by a scenario. */
  locked: boolean;
}

export interface DiceRoll {
  id: string;
  by: PlayerSeat;
  label: string;
  at: number;
  /** 1..6, sorted when rolled; a re-rolled die keeps its position. */
  results: number[];
  /** Highlight (and count) results ≤ target. */
  target?: number;
  /** Per die: true once re-rolled (each die can be re-rolled only once). */
  rerolled: boolean[];
  /** Where the numbers came from; 'local' if any die (re-rolls included) used the local fallback. */
  source: 'random.org' | 'local';
  /** A roll-off: results[0] is Player 1's die, results[1] Player 2's. */
  kind?: 'roll' | 'rolloff';
  /** Roll-off pairs that tied and were re-rolled automatically. */
  ties?: [number, number][];
}

/** Something on the board that can be measured from or to. */
export interface EntityRef {
  kind: 'regiment' | 'character' | 'terrain' | 'objective' | 'zone';
  id: string;
  /** Measure from a single stand of a regiment. */
  standId?: string;
}

/** A pinned measurement, shown to both players until cleared. */
export type Measurement =
  | { id: string; kind: 'ruler'; by: Author; a: { x: number; y: number }; b: { x: number; y: number } }
  | { id: string; kind: 'distance'; by: Author; a: EntityRef; b: EntityRef }
  | { id: string; kind: 'ring'; by: Author; ref: EntityRef; radius: number; label: string };

export interface StandPreset {
  w: number;
  d: number;
  size: number;
}

export interface BattleSettings {
  /** Editable stand footprints per type (inches). */
  standPresets: Record<Exclude<StandType, 'custom'>, StandPreset>;
  /** Ask before removing a stand whose damage reaches its wounds. */
  confirmStandRemoval: boolean;
  /** Two stands equally far from the command stand: ask the player which takes the wound, or take the left one. */
  woundTies: 'ask' | 'left';
  /** When a character leaves, the regiment closes the gap with a free reform (fewest ranks lost). */
  reformOnDetach: boolean;
  /** Side of the command stand an attaching character takes. */
  characterSide: 'left' | 'right';
  /** Line of sight: does Obstructing terrain block every line, or only when its Size ≥ both sizes. */
  losObstructing: 'tournament' | 'core';
  /** Line of sight: compare blocker size against both regiments, or the acting one only. */
  losSizeComparison: 'both' | 'acting';
  /** Regiments whose four arcs are all treated as front. */
  losAllFrontIds: string[];
  /** Volley sampling step along target edges (inches). */
  losSampleStep: number;
  /** Casual play: anyone can edit anything. */
  anyoneCanEdit: boolean;
  /** Board set for the game: terrain, zones and markers can no longer be edited (markers can still be damaged). */
  boardLocked: boolean;
}

export interface LogEntry {
  id: string;
  seq: number;
  at: number;
  by: Author;
  kind: 'op' | 'chat' | 'dice' | 'system';
  text: string;
}

export interface Battle {
  id: string;
  name: string;
  version: number;
  /** Number of operations applied so far. */
  seq: number;
  board: Board;
  players: Record<PlayerSeat, PlayerInfo>;
  terrain: Terrain[];
  zones: Zone[];
  objectiveMarkers: ObjectiveMarker[];
  regiments: Regiment[];
  /** Unattached ones are drawn on their own or sit in reserve. */
  characters: Character[];
  /** Free tokens, e.g. reinforcement line ends. */
  markers: FreeMarker[];
  dice: DiceRoll[];
  /** Pinned rulers, distances and range rings. */
  measurements: Measurement[];
  settings: BattleSettings;
  log: LogEntry[];
}
