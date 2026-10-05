import {
  KEYWORD_INITIALS,
  localToWorld,
  type Battle,
  type PlayerSeat,
  type Terrain,
  type TerrainKeyword,
  type Vec,
} from '@conquest/shared';

export const BOARD_FILL = '#e8e3d3';
export const GRID_STROKE = '#8c8270';
export const SELECT_STROKE = '#f2b705';
export const NEUTRAL_TINT = '#c8a96e';

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Label size in inches: about 13 px on screen, kept within limits so labels stay readable at any zoom. */
export const labelSize = (pxPerInch: number) => clamp(13 / pxPerInch, 0.28, 1.2);

export function seatColor(b: Battle, seat: PlayerSeat | undefined): string {
  return seat ? b.players[seat].color : NEUTRAL_TINT;
}

export const seatTag = (seat: PlayerSeat | undefined) => (seat === 'p1' ? 'P1' : seat === 'p2' ? 'P2' : '');

/** Base fill of a terrain piece, chosen from its keywords. */
export function terrainBaseFill(t: Terrain): string {
  const k = t.keywords;
  if (k.includes('Impassable')) return '#77736b';
  if (k.includes('Garrison')) return '#a08a6c';
  if (k.includes('Water')) return '#a9c9dc';
  if (k.includes('Elevated')) return '#cdb88d';
  if (k.includes('Obscuring') && k.includes('Traversable')) return '#b3c79a';
  return '#cfc7ae';
}

/** SVG pattern ids layered on top of the base fill, one per keyword that has one. */
export const KEYWORD_PATTERN: Partial<Record<TerrainKeyword, string>> = {
  Hindering: 'pat-hatch',
  Cover: 'pat-dots',
  Dangerous: 'pat-cross',
  Perilous: 'pat-perilous',
  'Broken Ground': 'pat-dash',
  Water: 'pat-waves',
  Obscuring: 'pat-obscure',
};

export function terrainTag(t: Terrain): string {
  const kws = t.keywords.map((k) => KEYWORD_INITIALS[k]).join(' ');
  return `${t.name} · S${t.size}${kws ? ` · ${kws}` : ''}`;
}

/** Pose (front-left corner) that puts the centre of a w × d footprint at p. */
export function poseCentredAt(w: number, d: number, angle: number, p: Vec) {
  const c = localToWorld({ x: 0, y: 0, angle }, w / 2, d / 2);
  return { x: p.x - c.x, y: p.y - c.y, angle };
}

/** Default facing for a seat: Player 1 deploys from the bottom edge facing up, Player 2 from the top facing down. */
export const seatFacing = (seat: PlayerSeat) => (seat === 'p1' ? 0 : 180);
