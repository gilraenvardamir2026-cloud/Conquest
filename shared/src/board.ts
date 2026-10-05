// Battle-level helpers: terrain / marker footprints, zone overlap, board check,
// and building a fresh battle document.

import {
  centeredRectCorners,
  EPS,
  ellipsePolygon,
  placePolygon,
  pointPolygonDistance,
  polygonDistance,
  polygonOverlapsCircle,
  type Polygon,
} from './geometry';
import {
  BOARD_DEPTH,
  BOARD_WIDTH,
  DEFAULT_SETTINGS,
  OBJECTIVE_MARKER_SIDE,
  OBJECTIVE_MARKER_WOUNDS,
  PLAYER_COLORS,
  SAMPLE_LAYOUTS,
  scenarioById,
  terrainPreset,
} from './presets';
import { characterPolygon, regimentPolygons, slotPolygon } from './regiment';
import type { Battle, ObjectiveMarker, PlayerSeat, Regiment, Terrain, Zone } from './types';

export function terrainPolygon(t: Terrain): Polygon {
  switch (t.shape.kind) {
    case 'rect':
      return centeredRectCorners(t.x, t.y, t.shape.w, t.shape.d, t.angle);
    case 'ellipse':
      return ellipsePolygon(t.x, t.y, t.shape.rx, t.shape.ry, t.angle, 64);
    case 'polygon':
      return placePolygon(t.shape.points, t.x, t.y, t.angle);
  }
}

/** Footprint of a piece in its own frame (width ≥ depth not guaranteed). */
export function terrainExtent(t: Terrain): { w: number; d: number } {
  switch (t.shape.kind) {
    case 'rect':
      return { w: t.shape.w, d: t.shape.d };
    case 'ellipse':
      return { w: 2 * t.shape.rx, d: 2 * t.shape.ry };
    case 'polygon': {
      const xs = t.shape.points.map((p) => p[0]);
      const ys = t.shape.points.map((p) => p[1]);
      return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
    }
  }
}

/** Objective markers are drawn as an axis-aligned 54 × 54 mm square. */
export function objectiveMarkerPolygon(m: ObjectiveMarker): Polygon {
  return centeredRectCorners(m.x, m.y, OBJECTIVE_MARKER_SIDE, OBJECTIVE_MARKER_SIDE, 0);
}

/** Build terrain pieces for a sample layout. Ids derive from `idPrefix` so every client gets the same ids. */
export function layoutTerrain(layoutId: string, idPrefix: string, garrisonBuildings = false): Terrain[] {
  const layout = SAMPLE_LAYOUTS.find((l) => l.id === layoutId);
  if (!layout) return [];
  return layout.pieces.map((p, i) => {
    const preset = terrainPreset(p.preset)!;
    const t: Terrain = {
      id: `${idPrefix}-t${i}`,
      name: preset.name,
      shape: structuredCloneShape(preset.shape),
      x: p.x,
      y: p.y,
      angle: p.angle ?? 0,
      size: preset.size,
      keywords: preset.keywords.slice(),
      locked: false,
    };
    return garrisonBuildings && p.preset === 'building' ? toggleGarrison(t, true) : t;
  });
}

const structuredCloneShape = (s: Terrain['shape']): Terrain['shape'] =>
  s.kind === 'polygon' ? { kind: 'polygon', points: s.points.map((p) => [p[0], p[1]] as [number, number]) } : { ...s };

/** Switch a building between Impassable and Garrison terrain. */
export function toggleGarrison(t: Terrain, on: boolean): Terrain {
  const kws = t.keywords.filter((k) => k !== 'Impassable' && k !== 'Garrison');
  if (on) {
    return { ...t, keywords: [...kws, 'Garrison'], garrison: t.garrison ?? { defense: 1, capacity: 5 } };
  }
  const { garrison: _g, ...rest } = t;
  return { ...rest, keywords: [...kws, 'Impassable'] };
}

export function scenarioZones(scenarioId: string, idPrefix: string): { zones: Zone[]; markers: ObjectiveMarker[] } {
  const s = scenarioById(scenarioId);
  if (!s) return { zones: [], markers: [] };
  return {
    zones: s.zones.map((z, i) => ({
      id: `${idPrefix}-z${i}`,
      x: z.x,
      y: z.y,
      diameter: z.diameter,
      ...(z.label ? { label: z.label } : {}),
      ...(z.friendlyTo ? { friendlyTo: z.friendlyTo } : {}),
      locked: true,
    })),
    markers: s.markers.map((m, i) => ({
      id: `${idPrefix}-m${i}`,
      x: m.x,
      y: m.y,
      ...(m.label ? { label: m.label } : {}),
      ...(m.friendlyTo ? { friendlyTo: m.friendlyTo } : {}),
      woundsMax: OBJECTIVE_MARKER_WOUNDS,
      damageBy: { p1: 0, p2: 0 },
      destroyed: false,
      locked: true,
    })),
  };
}

export function createBattle(opts: { id: string; name?: string; scenarioId?: string; layoutId?: string }): Battle {
  const s = opts.scenarioId ? scenarioById(opts.scenarioId) : undefined;
  const { zones, markers } = s ? scenarioZones(s.id, `${opts.id}-${s.id}`) : { zones: [], markers: [] };
  return {
    id: opts.id,
    name: opts.name ?? (s ? s.name : 'Custom battle'),
    version: 1,
    seq: 0,
    board: {
      width: BOARD_WIDTH,
      depth: BOARD_DEPTH,
      grid: 12,
      ...(s ? { scenarioId: s.id } : {}),
      noReinforcement: s ? s.noReinforcement.map((e) => ({ ...e })) : [],
    },
    players: {
      p1: { name: 'Player 1', color: PLAYER_COLORS.p1, connected: false },
      p2: { name: 'Player 2', color: PLAYER_COLORS.p2, connected: false },
    },
    terrain: opts.layoutId ? layoutTerrain(opts.layoutId, `${opts.id}-${opts.layoutId}`) : [],
    zones,
    objectiveMarkers: markers,
    regiments: [],
    characters: [],
    markers: [],
    dice: [],
    measurements: [],
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    log: [],
  };
}

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

/** Every stand footprint on the board (regiment stands, attached characters, lone characters). */
export function boardStandPolygons(b: Battle): { ownerId: string; seat: PlayerSeat; poly: Polygon }[] {
  const out: { ownerId: string; seat: PlayerSeat; poly: Polygon }[] = [];
  for (const r of b.regiments) {
    if (r.location !== 'board' || r.garrisonId) continue;
    for (const p of regimentPolygons(r)) out.push({ ownerId: r.id, seat: r.owner, poly: p });
  }
  for (const c of b.characters) {
    if (c.location !== 'board' || c.attachedTo) continue;
    const p = characterPolygon(c);
    if (p) out.push({ ownerId: c.id, seat: c.owner, poly: p });
  }
  return out;
}

/** Two stands are in contact when they touch, corners included, within this tolerance. */
export const CONTACT_TOLERANCE = 0.02;

/** Ids of the regiment's stands touching any enemy stand (regiment or lone character). */
export function engagedStandIds(b: Battle, reg: Regiment): Set<string> {
  const ids = new Set<string>();
  if (reg.location !== 'board' || reg.garrisonId) return ids;
  const enemies = boardStandPolygons(b).filter((s) => s.seat !== reg.owner);
  if (!enemies.length) return ids;
  for (const s of reg.stands) {
    const poly = slotPolygon(reg, s.slot);
    if (enemies.some((e) => polygonDistance(poly, e.poly).distance <= CONTACT_TOLERANCE)) ids.add(s.id);
  }
  return ids;
}

/** Ids of zones that any stand overlaps (touching the edge counts). */
export function occupiedZoneIds(b: Battle): Set<string> {
  const stands = boardStandPolygons(b);
  const ids = new Set<string>();
  for (const z of b.zones) {
    const c = { x: z.x, y: z.y };
    if (stands.some((s) => pointPolygonDistance(c, s.poly) <= z.diameter / 2 + EPS)) ids.add(z.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Board check (warnings only, following the tournament pack)
// ---------------------------------------------------------------------------

export interface BoardWarning {
  text: string;
  ids: string[];
}

export function boardCheck(b: Battle): BoardWarning[] {
  const w: BoardWarning[] = [];
  const t = b.terrain;
  if (t.length > 9) w.push({ text: `${t.length} terrain pieces (the pack allows at most 9).`, ids: [] });
  const garrisons = t.filter((x) => x.keywords.includes('Garrison'));
  if (garrisons.length > 2) w.push({ text: `${garrisons.length} garrison pieces (at most 2).`, ids: garrisons.map((x) => x.id) });
  const obsc = t.filter((x) => x.keywords.includes('Obscuring')).length;
  if (obsc < 2) w.push({ text: `Only ${obsc} Obscuring piece(s) (at least 2).`, ids: [] });
  const obst = t.filter((x) => x.keywords.includes('Obstructing')).length;
  if (obst < 2) w.push({ text: `Only ${obst} Obstructing piece(s) (at least 2).`, ids: [] });

  for (const x of t) {
    const e = terrainExtent(x);
    const long = Math.max(e.w, e.d);
    const short = Math.min(e.w, e.d);
    if (long > 9 + EPS || short > 6 + EPS) {
      w.push({ text: `${x.name}: footprint ${long.toFixed(1)}" × ${short.toFixed(1)}" exceeds 9" × 6".`, ids: [x.id] });
    }
  }

  const polys = t.map(terrainPolygon);
  for (let i = 0; i < t.length; i++) {
    for (let j = i + 1; j < t.length; j++) {
      const d = polygonDistance(polys[i], polys[j]).distance;
      if (d < 9 - EPS) w.push({ text: `${t[i].name} and ${t[j].name} are ${d.toFixed(1)}" apart (minimum 9").`, ids: [t[i].id, t[j].id] });
    }
  }

  t.forEach((x, i) => {
    if (!x.keywords.includes('Garrison') && !x.keywords.includes('Impassable')) return;
    for (const z of b.zones) {
      if (polygonOverlapsCircle(polys[i], { x: z.x, y: z.y }, z.diameter / 2)) {
        w.push({ text: `${x.name} (${x.keywords.includes('Garrison') ? 'Garrison' : 'Impassable'}) is on an objective zone.`, ids: [x.id, z.id] });
      }
    }
  });
  return w;
}

/**
 * Fill in fields added after a battle file was saved (older saves, imports),
 * so every client works on the same complete shape.
 */
export function normalizeBattle(b: Battle): Battle {
  return {
    ...b,
    seq: b.seq ?? 0,
    measurements: b.measurements ?? [],
    markers: b.markers ?? [],
    dice: b.dice ?? [],
    log: b.log ?? [],
    settings: { ...DEFAULT_SETTINGS, ...JSON.parse(JSON.stringify(b.settings ?? {})) },
  };
}
