// Board, stand, terrain and scenario presets. Coordinates in inches,
// read from the 12" grid of the tournament pack's diagrams.

import { mmToIn } from './geometry';
import type {
  BattleSettings,
  NoReinforcementEdge,
  PlayerSeat,
  StandPreset,
  StandType,
  TerrainKeyword,
  TerrainShape,
} from './types';

export const BOARD_WIDTH = 72;
export const BOARD_DEPTH = 48;

/** A 54 mm stand side, the unit the pack uses for terrain footprints. */
export const STAND_54 = mmToIn(54);

// ---------------------------------------------------------------------------
// Stands
// ---------------------------------------------------------------------------

export const STAND_PRESETS: Record<Exclude<StandType, 'custom'>, StandPreset> = {
  infantry: { w: mmToIn(54), d: mmToIn(54), size: 1 },
  cavalry: { w: mmToIn(54), d: mmToIn(54), size: 2 },
  brute: { w: mmToIn(54), d: mmToIn(54), size: 2 },
  // Two squares back to back, long side front-to-back.
  chariot: { w: mmToIn(54), d: mmToIn(108), size: 2 },
  monster: { w: mmToIn(110), d: mmToIn(110), size: 3 },
};

export const STAND_TYPES: StandType[] = ['infantry', 'cavalry', 'brute', 'chariot', 'monster', 'custom'];

/** Starting composition offered when a regiment is created (all editable). */
export const REGIMENT_DEFAULTS: Record<StandType, { stands: number; files: number; wounds: number }> = {
  infantry: { stands: 3, files: 3, wounds: 4 },
  cavalry: { stands: 3, files: 3, wounds: 4 },
  brute: { stands: 3, files: 3, wounds: 4 },
  chariot: { stands: 2, files: 2, wounds: 5 },
  monster: { stands: 1, files: 1, wounds: 10 },
  custom: { stands: 1, files: 1, wounds: 1 },
};

/** Stand types whose regiments get a command stand by default. */
export const HAS_COMMAND: Record<StandType, boolean> = {
  infantry: true,
  cavalry: true,
  brute: true,
  chariot: false,
  monster: false,
  custom: false,
};

export function presetFor(settings: BattleSettings, type: StandType): StandPreset {
  if (type === 'custom') return { w: STAND_54, d: STAND_54, size: 1 };
  return settings.standPresets[type];
}

export const DEFAULT_SETTINGS: BattleSettings = {
  standPresets: STAND_PRESETS,
  confirmStandRemoval: false,
  reformOnDetach: true,
  characterSide: 'right',
  losObstructing: 'tournament',
  losSizeComparison: 'both',
  losAllFrontIds: [],
  losSampleStep: 0.25,
  anyoneCanEdit: false,
};

export const PLAYER_COLORS: Record<PlayerSeat, string> = {
  p1: '#c8102e', // red
  p2: '#1f5fbf', // blue
};

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export const TERRAIN_KEYWORDS: TerrainKeyword[] = [
  'Elevated',
  'Cover',
  'Obscuring',
  'Obstructing',
  'Traversable',
  'Hindering',
  'Broken Ground',
  'Dangerous',
  'Perilous',
  'Impassable',
  'Water',
  'Garrison',
];

/** Two-letter initials for terrain name tags. Obstructing is "Os" so it differs from Obscuring "Ob". */
export const KEYWORD_INITIALS: Record<TerrainKeyword, string> = {
  Elevated: 'El',
  Cover: 'Co',
  Obscuring: 'Ob',
  Obstructing: 'Os',
  Traversable: 'Tr',
  Hindering: 'Hi',
  'Broken Ground': 'BG',
  Dangerous: 'Da',
  Perilous: 'Pe',
  Impassable: 'Im',
  Water: 'Wa',
  Garrison: 'Ga',
};

const W2 = 2 * STAND_54; // 2 stands ≈ 4.25"
const W3 = 3 * STAND_54; // 3 stands ≈ 6.38"

/**
 * Irregular blob fitting a w × d box, centred on (0, 0). Deterministic, so
 * presets are identical on every client.
 */
function blob(w: number, d: number, wobble: number[]): [number, number][] {
  const n = wobble.length;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const k = wobble[i];
    pts.push([round2((w / 2) * k * Math.cos(t)), round2((d / 2) * k * Math.sin(t))]);
  }
  return pts;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface TerrainPreset {
  key: string;
  name: string;
  size: number;
  keywords: TerrainKeyword[];
  shape: TerrainShape;
  garrison?: { defense: number; capacity: number };
}

const FOREST_SHAPE: TerrainShape = { kind: 'polygon', points: blob(W3, W2, [1, 0.9, 1, 0.85, 1, 0.92, 1, 0.88, 0.97, 0.9]) };
const ROCK_SHAPE: TerrainShape = { kind: 'polygon', points: blob(W3, W2, [1, 0.95, 0.9, 1, 0.93, 0.98, 0.9]) };

export const TERRAIN_PRESETS: TerrainPreset[] = [
  { key: 'forest', name: 'Forest', size: 3, keywords: ['Hindering', 'Obscuring', 'Traversable'], shape: FOREST_SHAPE },
  { key: 'building', name: 'Building', size: 3, keywords: ['Impassable', 'Obstructing'], shape: { kind: 'rect', w: W3, d: W2 } },
  { key: 'rock', name: 'Rock formation', size: 3, keywords: ['Impassable', 'Obstructing'], shape: ROCK_SHAPE },
  { key: 'hill', name: 'Hill', size: 2, keywords: ['Elevated', 'Obstructing'], shape: { kind: 'ellipse', rx: W3 / 2, ry: W2 / 2 } },
  { key: 'field', name: 'Field', size: 0, keywords: ['Broken Ground', 'Obscuring', 'Traversable'], shape: { kind: 'rect', w: W2, d: W2 } },
  { key: 'water', name: 'Body of water', size: 0, keywords: ['Hindering', 'Traversable', 'Water'], shape: { kind: 'ellipse', rx: W3 / 2, ry: W2 / 2 } },
  { key: 'fog', name: 'Fog', size: 2, keywords: ['Obscuring', 'Traversable', 'Water'], shape: { kind: 'ellipse', rx: W2 / 2, ry: W2 / 2 } },
  { key: 'swamp', name: 'Swamp / Debris', size: 0, keywords: ['Dangerous', 'Hindering', 'Traversable'], shape: { kind: 'rect', w: W2, d: W2 } },
  { key: 'pond', name: 'Frozen pond', size: 0, keywords: ['Dangerous', 'Hindering', 'Traversable', 'Water'], shape: { kind: 'ellipse', rx: W2 / 2, ry: W2 / 2 } },
  {
    key: 'garrison',
    name: 'Garrison',
    size: 3,
    keywords: ['Garrison', 'Obstructing'],
    shape: { kind: 'rect', w: W3, d: W2 },
    garrison: { defense: 1, capacity: 5 },
  },
  {
    key: 'tower',
    name: 'Tower',
    size: 3,
    keywords: ['Garrison', 'Obstructing'],
    shape: { kind: 'rect', w: W2, d: W2 },
    garrison: { defense: 1, capacity: 4 },
  },
];

export const terrainPreset = (key: string): TerrainPreset | undefined => TERRAIN_PRESETS.find((p) => p.key === key);

export interface LayoutPiece {
  preset: string;
  x: number;
  y: number;
  angle?: number;
}

export interface SampleLayout {
  id: string;
  name: string;
  pieces: LayoutPiece[];
}

/** The pack's three sample layouts. Centres are approximate, read from the diagrams. */
export const SAMPLE_LAYOUTS: SampleLayout[] = [
  {
    id: 'layout1',
    name: 'Sample layout #1',
    pieces: [
      { preset: 'field', x: 12, y: 15.5 },
      { preset: 'rock', x: 28.5, y: 13.5 },
      { preset: 'forest', x: 49.5, y: 13 },
      { preset: 'forest', x: 35.5, y: 24.5 },
      { preset: 'forest', x: 17.5, y: 36.5 },
      { preset: 'rock', x: 44.5, y: 36 },
      { preset: 'field', x: 60, y: 34 },
    ],
  },
  {
    id: 'layout2',
    name: 'Sample layout #2',
    pieces: [
      { preset: 'forest', x: 18, y: 15 },
      { preset: 'forest', x: 36, y: 12 },
      { preset: 'rock', x: 48, y: 15.5 },
      { preset: 'building', x: 59, y: 12, angle: 90 },
      { preset: 'rock', x: 24.5, y: 29 },
      { preset: 'forest', x: 58, y: 33 },
      { preset: 'building', x: 11.5, y: 35.5, angle: 90 },
      { preset: 'forest', x: 36, y: 38 },
    ],
  },
  {
    id: 'layout3',
    name: 'Sample layout #3',
    pieces: [
      { preset: 'rock', x: 24, y: 10.5 },
      { preset: 'forest', x: 46.5, y: 12 },
      { preset: 'building', x: 12, y: 24, angle: 90 },
      { preset: 'hill', x: 30, y: 24 },
      { preset: 'forest', x: 60.5, y: 24 },
      { preset: 'forest', x: 42.5, y: 37.5 },
      { preset: 'rock', x: 24.5, y: 39 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export interface ScenarioZone {
  x: number;
  y: number;
  diameter: number;
  friendlyTo?: PlayerSeat;
  label?: string;
}

export interface ScenarioMarker {
  x: number;
  y: number;
  friendlyTo?: PlayerSeat;
  label?: string;
}

export interface Scenario {
  id: string;
  number: number;
  name: string;
  zones: ScenarioZone[];
  markers: ScenarioMarker[];
  noReinforcement: NoReinforcementEdge[];
  note?: string;
}

const z = (diameter: number, x: number, y: number, friendlyTo?: PlayerSeat, label?: string): ScenarioZone => ({
  x,
  y,
  diameter,
  ...(friendlyTo ? { friendlyTo } : {}),
  ...(label ? { label } : {}),
});
const mA = (x: number, y: number): ScenarioMarker => ({ x, y, friendlyTo: 'p1', label: 'A' });
const mB = (x: number, y: number): ScenarioMarker => ({ x, y, friendlyTo: 'p2', label: 'B' });
const mN = (x: number, y: number): ScenarioMarker => ({ x, y });

export const SCENARIOS: Scenario[] = [
  {
    id: 's1',
    number: 1,
    name: 'Divide and Conquer',
    zones: [z(6, 12, 36, 'p1'), z(6, 60, 36, 'p1'), z(6, 12, 12, 'p2'), z(6, 60, 12, 'p2'), z(6, 24, 24), z(6, 48, 24)],
    markers: [mA(36, 36), mB(36, 12)],
    noReinforcement: [],
  },
  {
    id: 's2',
    number: 2,
    name: 'Declined Flank',
    zones: [z(6, 6, 18), z(6, 30, 18), z(6, 54, 18), z(6, 18, 30), z(6, 42, 30), z(6, 66, 30)],
    markers: [],
    noReinforcement: [],
  },
  {
    id: 's3',
    number: 3,
    name: 'Breakout',
    zones: [z(9, 12, 24), z(9, 36, 24), z(9, 60, 24)],
    markers: [mA(31.5, 24), mB(40.5, 24)],
    noReinforcement: [],
    note: 'Markers sit on the left and right edge of the centre zone.',
  },
  {
    id: 's4',
    number: 4,
    name: 'Echelon',
    zones: [z(9, 24, 18), z(9, 48, 30)],
    markers: [mA(12, 42), mB(60, 6), mN(48, 18), mN(24, 30)],
    noReinforcement: [],
  },
  {
    id: 's5',
    number: 5,
    name: 'Forlorn Hope',
    zones: [z(9, 48, 18), z(9, 24, 30), z(6, 24, 18), z(6, 48, 30)],
    markers: [mN(36, 18), mN(36, 30)],
    noReinforcement: [
      { edge: 'left', from: 12, to: 36 },
      { edge: 'right', from: 12, to: 36 },
    ],
  },
  {
    id: 's6',
    number: 6,
    name: 'Off-Balance',
    zones: [z(9, 12, 24), z(9, 48, 24)],
    markers: [mA(30, 30), mA(60, 36), mB(30, 18), mB(60, 12)],
    noReinforcement: [],
  },
  {
    id: 's7',
    number: 7,
    name: 'Melee',
    zones: [z(9, 12, 24), z(9, 60, 24), z(6, 42, 18), z(6, 30, 30)],
    markers: [],
    noReinforcement: [],
  },
  {
    id: 's8',
    number: 8,
    name: 'Bulwark',
    zones: [z(9, 18, 24), z(9, 54, 24)],
    markers: [mA(18, 24), mB(54, 24), mN(36, 24)],
    noReinforcement: [],
    note: 'Markers A and B sit at the zone centres.',
  },
  {
    id: 's9',
    number: 9,
    name: 'Foresight',
    zones: [z(6, 6, 30, undefined, '1'), z(6, 18, 18, undefined, '2'), z(6, 54, 30, undefined, '3'), z(6, 66, 18, undefined, '4'), z(6, 36, 24)],
    markers: [],
    noReinforcement: [],
  },
  {
    id: 's10',
    number: 10,
    name: 'Head-to-Head',
    zones: [z(9, 54, 24), z(6, 18, 36, 'p1', 'A'), z(6, 18, 12, 'p2', 'B')],
    markers: [],
    noReinforcement: [],
  },
  {
    id: 's11',
    number: 11,
    name: 'Maelstrom',
    zones: [z(9, 12, 24), z(9, 60, 24), z(6, 36, 24)],
    markers: [],
    noReinforcement: [],
  },
  {
    id: 's12',
    number: 12,
    name: 'Grind Them Down',
    zones: [z(9, 36, 24), z(6, 18, 18), z(6, 18, 30), z(6, 54, 18), z(6, 54, 30)],
    markers: [],
    noReinforcement: [],
  },
];

export const scenarioById = (id: string | undefined): Scenario | undefined => SCENARIOS.find((s) => s.id === id);

/** Objective marker footprint: a 54 × 54 mm brute/cavalry stand. */
export const OBJECTIVE_MARKER_SIDE = STAND_54;
export const OBJECTIVE_MARKER_SIZE = 2;
export const OBJECTIVE_MARKER_WOUNDS = 3;
