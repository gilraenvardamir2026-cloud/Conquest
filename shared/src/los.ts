// Facing-arc report, effective sizes and the line-of-sight checker.
//
// The checker reports, stand by stand, what each acting front-rank stand can
// see and why; it never enforces anything. Rule readings that players may
// disagree on are settings (see BattleSettings.los*).
//
// Each line is a 1 mm (0.04") wide corridor. A line is obstructed when that
// corridor crosses the interior of an obstacle:
//  - stands of any other regiment or character (either side) and objective
//    markers (Size 2) whose effective size is ≥ the acting size and (unless
//    the comparison setting says "acting only") ≥ the target size;
//  - terrain with Obstructing or Garrison: in tournament mode every line that
//    crosses it, in core mode only when its Size is ≥ those sizes;
//    such a piece is ignored when the acting stand or the target stand is on it;
//  - the acting and target pieces themselves never block.
// Cover and Obscuring terrain crossed is flagged without changing the result.

import {
  bounds,
  centroid,
  closestPointOnSegment,
  convexOverlapDepth,
  convexPieces,
  dist,
  EPS,
  lerp,
  pointArcs,
  pointInPolygon,
  polygonArcs,
  polygonSetDistance,
  sub,
  add,
  type Arc,
  type Bounds,
  type Frame,
  type Polygon,
  type Vec,
} from './geometry';
import { objectiveMarkerPolygon, terrainPolygon } from './board';
import { presetFor } from './presets';
import { characterPolygon, regimentFrame, regimentStandGeoms, standName } from './regiment';
import type { Battle, Terrain, TerrainKeyword } from './types';

/** Half the 1 mm corridor width. */
export const LOS_HALF_WIDTH = 0.02;
export const OBJECTIVE_MARKER_LOS_SIZE = 2;

export type LosMode = 'sight' | 'volley';

/** A piece that can act in, or be the target of, a line-of-sight check. */
export interface LosParty {
  kind: 'regiment' | 'character' | 'objective';
  id: string;
}

// ---------------------------------------------------------------------------
// Effective size
// ---------------------------------------------------------------------------

export interface SizeInfo {
  size: number;
  /** How it was worked out, for the report. */
  note: string;
}

/** Elevated terrain under every one of the given points (stand centres), if any. */
export function elevatedUnder(b: Battle, centres: Vec[]): Terrain | undefined {
  if (!centres.length) return undefined;
  return b.terrain.find((t) => t.keywords.includes('Elevated') && centres.every((c) => pointInPolygon(c, terrainPolygon(t))));
}

/**
 * Effective LoS size:
 *  - base size from the stand type;
 *  - plus the Size of an Elevated piece it stands on (detected when every
 *    stand centre is inside the piece); a manual override replaces both;
 *  - a regiment in garrison uses the terrain's Size;
 *  - objective markers are Size 2.
 */
export function effectiveSize(b: Battle, p: LosParty): SizeInfo | null {
  if (p.kind === 'objective') {
    return b.objectiveMarkers.some((m) => m.id === p.id) ? { size: OBJECTIVE_MARKER_LOS_SIZE, note: 'objective marker' } : null;
  }
  if (p.kind === 'character') {
    const c = b.characters.find((x) => x.id === p.id);
    if (!c) return null;
    if (c.attachedTo) return effectiveSize(b, { kind: 'regiment', id: c.attachedTo });
    const base = presetFor(b.settings, c.standType).size;
    const poly = characterPolygon(c);
    const elev = poly ? elevatedUnder(b, [centroid(poly)]) : undefined;
    return elev ? { size: base + elev.size, note: `${c.standType} ${base}, on ${elev.name} +${elev.size}` } : { size: base, note: `${c.standType} ${base}` };
  }
  const r = b.regiments.find((x) => x.id === p.id);
  if (!r) return null;
  if (r.garrisonId) {
    const t = b.terrain.find((x) => x.id === r.garrisonId);
    if (t) return { size: t.size, note: `in garrison: ${t.name} Size ${t.size}` };
  }
  if (r.sizeOverride !== undefined) return { size: r.sizeOverride, note: 'manual override' };
  const elev = elevatedUnder(
    b,
    regimentStandGeoms(r).map((g) => centroid(g.poly)),
  );
  return elev ? { size: r.size + elev.size, note: `${r.standType} ${r.size}, on ${elev.name} +${elev.size}` } : { size: r.size, note: `${r.standType} ${r.size}` };
}

// ---------------------------------------------------------------------------
// The two sides of a check
// ---------------------------------------------------------------------------

interface LosStand {
  id: string;
  name: string;
  poly: Polygon;
  rank: number;
  file: number;
  /** Front edge (left → right) for stands that face somewhere. */
  front?: [Vec, Vec];
}

interface PartyShape {
  name: string;
  owner?: 'p1' | 'p2';
  stands: LosStand[];
  /** Facing frame for arcs (none for objective markers and garrisons). */
  frame?: Frame;
  /** Garrison terrain the party occupies. */
  garrison?: Terrain;
  /** Entity ids that belong to this party (never block its own lines). */
  ownIds: Set<string>;
  barrageRange?: number;
}

function partyShape(b: Battle, p: LosParty): PartyShape | null {
  if (p.kind === 'objective') {
    const m = b.objectiveMarkers.find((x) => x.id === p.id && !x.destroyed);
    if (!m) return null;
    return { name: `objective marker ${m.label ?? '•'}`, stands: [{ id: m.id, name: 'marker', poly: objectiveMarkerPolygon(m), rank: 0, file: 0 }], ownIds: new Set([m.id]) };
  }
  if (p.kind === 'character') {
    const c = b.characters.find((x) => x.id === p.id);
    if (!c || c.location !== 'board') return null;
    if (c.attachedTo) return partyShape(b, { kind: 'regiment', id: c.attachedTo });
    const poly = characterPolygon(c);
    if (!poly) return null;
    return {
      name: c.name,
      owner: c.owner,
      stands: [{ id: c.id, name: c.name, poly, rank: 0, file: 0, front: [poly[0], poly[1]] }],
      frame: { x: c.x!, y: c.y!, angle: c.angle ?? 0, w: c.standW, d: c.standD },
      ownIds: new Set([c.id]),
    };
  }
  const r = b.regiments.find((x) => x.id === p.id);
  if (!r || r.location !== 'board') return null;
  const ownIds = new Set([r.id, ...(r.characterId ? [r.characterId] : [])]);
  if (r.garrisonId) {
    const t = b.terrain.find((x) => x.id === r.garrisonId);
    if (!t) return null;
    return { name: r.name, owner: r.owner, stands: [{ id: t.id, name: t.name, poly: terrainPolygon(t), rank: 0, file: 0 }], garrison: t, ownIds, barrageRange: r.barrageRange };
  }
  const ch = r.characterId ? b.characters.find((c) => c.id === r.characterId) : undefined;
  const stands: LosStand[] = regimentStandGeoms(r).map((g) => {
    const s = r.stands.find((x) => x.id === g.id);
    return { id: g.id, name: s ? standName(r, s) : ch?.name ?? 'character', poly: g.poly, rank: g.slot.rank, file: g.slot.file, front: [g.poly[0], g.poly[1]] as [Vec, Vec] };
  });
  stands.sort((x, y) => x.rank - y.rank || x.file - y.file); // rows read left to right
  return { name: r.name, owner: r.owner, stands, frame: regimentFrame(r), ownIds, barrageRange: r.barrageRange };
}

// ---------------------------------------------------------------------------
// Arc report
// ---------------------------------------------------------------------------

export const ARC_LABEL: Record<Arc, string> = { front: 'Front', left: 'Left flank', right: 'Right flank', rear: 'Rear' };

/** Arcs of the target frame a polygon is in, honouring the "all arcs are front" setting. */
function arcsOf(b: Battle, target: LosParty, frame: Frame | undefined, poly: Polygon): Arc[] {
  if (!frame) return [];
  const arcs = polygonArcs(frame, poly);
  if (b.settings.losAllFrontIds?.includes(target.id) && arcs.length) return ['front'];
  return arcs;
}

// ---------------------------------------------------------------------------
// Obstacles and lines
// ---------------------------------------------------------------------------

interface Obstacle {
  kind: 'stand' | 'objective' | 'terrain';
  /** Entity id (regiment, character, marker or terrain). */
  id: string;
  name: string;
  pieces: Polygon[];
  bb: Bounds;
  blocks: boolean;
  terrain?: Terrain;
}

export interface Blocker {
  kind: Obstacle['kind'];
  id: string;
  name: string;
}

export interface Crossed {
  id: string;
  name: string;
  keywords: TerrainKeyword[];
}

export type LineStatus = 'clear' | 'blocked' | 'outOfRange' | 'outOfArc';

export interface LosLine {
  from: Vec;
  to: Vec;
  length: number;
  status: LineStatus;
  blockers: Blocker[];
  /** Terrain whose interior the line crosses (for Cover / Obscuring flags and the keyword list). */
  crossed: Crossed[];
  originId: string;
  targetStandId: string;
}

/** The 1 mm corridor around a line. */
function corridor(a: Vec, c: Vec): Polygon {
  const d = sub(c, a);
  const l = Math.hypot(d.x, d.y);
  const n = l < 1e-12 ? { x: 0, y: LOS_HALF_WIDTH } : { x: (-d.y / l) * LOS_HALF_WIDTH, y: (d.x / l) * LOS_HALF_WIDTH };
  return [add(a, n), add(c, n), sub(c, n), sub(a, n)];
}

const bbOverlap = (a: Bounds, b: Bounds) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

function crossesInterior(cor: Polygon, corBB: Bounds, o: { pieces: Polygon[]; bb: Bounds }): boolean {
  if (!bbOverlap(corBB, o.bb)) return false;
  return o.pieces.some((p) => convexOverlapDepth(cor, p) > EPS);
}

const isBlockingTerrain = (t: Terrain) => t.keywords.includes('Obstructing') || t.keywords.includes('Garrison');
const isFlagTerrain = (t: Terrain) => t.keywords.includes('Cover') || t.keywords.includes('Obscuring');

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

export interface LosRow {
  /** Acting stand id (or garrison terrain id). */
  id: string;
  name: string;
  /** Arcs of the target this acting stand is in. */
  arcs: Arc[];
  clear: boolean;
  /** Shortest clear line, else the shortest line tested in arc, else any. */
  best?: LosLine;
  blockedBy: string[];
  /** Volley: length of the shortest clear line. */
  distance?: number;
  inRange?: boolean;
  /** Volley: closest stand-to-target distance is under half the Barrage range. */
  effective?: boolean;
  /** Cover / Obscuring crossed by the best line. */
  cover: string[];
  /** Other terrain crossed by the best line, with keyword initials for the report. */
  terrain: Crossed[];
}

export interface LosResult {
  mode: LosMode;
  actingName: string;
  targetName: string;
  acting: SizeInfo;
  target: SizeInfo;
  rows: LosRow[];
  /** Lines to draw (all tested lines in Sight mode; the best line per stand in Volley mode unless allLines). */
  lines: LosLine[];
  clearCount: number;
  inRangeCount: number;
  headline: string;
  arcCounts: Partial<Record<Arc, number>>;
  /** Any part of the target is in the acting piece's front arc (always true for garrisons and "all arcs are front"). */
  targetInFrontArc: boolean;
  barrageRange?: number;
  notes: string[];
}

export interface LosOptions {
  /** Volley: return every tested line, not just the best per stand. */
  allLines?: boolean;
}

/** Evenly spaced points along a polygon's boundary (vertices included). */
function boundarySamples(poly: Polygon, step: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const c = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(dist(a, c) / step));
    for (let k = 0; k < n; k++) out.push(lerp(a, c, k / n));
  }
  return out;
}

const edgeMidpoints = (poly: Polygon): Vec[] => poly.map((p, i) => lerp(p, poly[(i + 1) % poly.length], 0.5));

export function lineOfSight(b: Battle, actingRef: LosParty, targetRef: LosParty, mode: LosMode, opts: LosOptions = {}): LosResult | null {
  const acting = partyShape(b, actingRef);
  const target = partyShape(b, targetRef);
  const aSize = effectiveSize(b, actingRef);
  const tSize = effectiveSize(b, targetRef);
  if (!acting || !target || !aSize || !tSize || actingRef.id === targetRef.id) return null;
  const s = b.settings;
  const cmpBoth = s.losSizeComparison !== 'acting';
  const sizeBlocks = (size: number) => size >= aSize.size && (!cmpBoth || size >= tSize.size);
  const step = Math.max(0.05, s.losSampleStep || 0.25);
  const allFront = !!acting.garrison || s.losAllFrontIds?.includes(actingRef.id);
  const notes: string[] = [];

  // --- obstacles -----------------------------------------------------------
  const obstacles: Obstacle[] = [];
  const skip = new Set([...acting.ownIds, ...target.ownIds]);
  const sizeCache = new Map<string, number>();
  const sizeOfPiece = (kind: 'regiment' | 'character', id: string) => {
    if (!sizeCache.has(id)) sizeCache.set(id, effectiveSize(b, { kind, id })?.size ?? 0);
    return sizeCache.get(id)!;
  };
  for (const r of b.regiments) {
    if (r.location !== 'board' || r.garrisonId || skip.has(r.id)) continue;
    const blocks = sizeBlocks(sizeOfPiece('regiment', r.id));
    for (const g of regimentStandGeoms(r)) obstacles.push({ kind: 'stand', id: r.id, name: r.name, pieces: [g.poly], bb: bounds(g.poly), blocks });
  }
  for (const c of b.characters) {
    if (c.location !== 'board' || c.attachedTo || skip.has(c.id)) continue;
    const poly = characterPolygon(c);
    if (poly) obstacles.push({ kind: 'stand', id: c.id, name: c.name, pieces: [poly], bb: bounds(poly), blocks: sizeBlocks(sizeOfPiece('character', c.id)) });
  }
  for (const m of b.objectiveMarkers) {
    if (m.destroyed || skip.has(m.id)) continue;
    const poly = objectiveMarkerPolygon(m);
    obstacles.push({ kind: 'objective', id: m.id, name: `objective marker ${m.label ?? '•'}`, pieces: [poly], bb: bounds(poly), blocks: sizeBlocks(OBJECTIVE_MARKER_LOS_SIZE) });
  }
  for (const t of b.terrain) {
    if (t.id === acting.garrison?.id || t.id === target.garrison?.id) continue;
    const poly = terrainPolygon(t);
    const blocks = isBlockingTerrain(t) && (s.losObstructing === 'tournament' || sizeBlocks(t.size));
    obstacles.push({ kind: 'terrain', id: t.id, name: t.name, pieces: convexPieces(poly), bb: bounds(poly), blocks, terrain: t });
  }
  // Obstructing pieces the acting or target stand stands on (centre inside) are ignored for that line.
  const on = (standPoly: Polygon) => {
    const c = centroid(standPoly);
    return new Set(obstacles.filter((o) => o.kind === 'terrain' && isBlockingTerrain(o.terrain!) && o.pieces.some((p) => pointInPolygon(c, p))).map((o) => o.id));
  };

  const testLine = (from: Vec, to: Vec, originId: string, targetStandId: string, ignore: Set<string>): LosLine => {
    const length = dist(from, to);
    if (!allFront && acting.frame && !pointArcs(acting.frame, to).includes('front')) {
      return { from, to, length, status: 'outOfArc', blockers: [], crossed: [], originId, targetStandId };
    }
    const cor = corridor(from, to);
    const cbb = bounds(cor);
    const blockers: Blocker[] = [];
    const crossed: Crossed[] = [];
    for (const o of obstacles) {
      if (!crossesInterior(cor, cbb, o)) continue;
      if (o.kind === 'terrain') {
        crossed.push({ id: o.id, name: o.name, keywords: o.terrain!.keywords });
        if (o.blocks && !ignore.has(o.id)) blockers.push({ kind: o.kind, id: o.id, name: o.name });
      } else if (o.blocks && !blockers.some((x) => x.id === o.id)) blockers.push({ kind: o.kind, id: o.id, name: o.name });
    }
    let status: LineStatus = blockers.length ? 'blocked' : 'clear';
    if (status === 'clear' && mode === 'volley' && acting.barrageRange !== undefined && length > acting.barrageRange + EPS) status = 'outOfRange';
    return { from, to, length, status, blockers, crossed, originId, targetStandId };
  };

  // --- origins (one row each) ------------------------------------------------
  let origins: { id: string; name: string; poly: Polygon; points: Vec[] }[];
  if (acting.garrison) {
    const poly = acting.stands[0].poly;
    origins = [{ id: acting.garrison.id, name: `${acting.name} in ${acting.garrison.name}`, poly, points: boundarySamples(poly, 0.5) }];
    notes.push(`${acting.name} is in garrison: it sees 360° and draws lines from any edge of ${acting.garrison.name}.`);
  } else {
    const frontRank = Math.min(...acting.stands.map((x) => x.rank));
    origins = acting.stands.filter((x) => x.rank === frontRank && x.front).map((x) => ({ id: x.id, name: x.name, poly: x.poly, points: [lerp(x.front![0], x.front![1], 0.5)] }));
  }
  if (allFront && !acting.garrison) notes.push(`All arcs of ${acting.name} count as front (setting).`);

  // --- target points -----------------------------------------------------------
  // Sight: the centre of each edge of every target stand. Volley: corners and
  // points every `step` along each edge, plus (per origin) the closest point of
  // each edge, so the shortest clear line is exact when it exists.
  const targets = target.stands.map((ts) => ({ ts, points: mode === 'sight' ? edgeMidpoints(ts.poly) : boundarySamples(ts.poly, step) }));
  const targetPolys = target.stands.map((x) => x.poly);
  const pointsFor = (ts: LosStand, base: Vec[], from: Vec): Vec[] =>
    mode === 'sight' ? base : [...base, ...ts.poly.map((p, i) => closestPointOnSegment(from, p, ts.poly[(i + 1) % ts.poly.length]))];

  const rows: LosRow[] = [];
  const lines: LosLine[] = [];
  for (const o of origins) {
    const ignoreBase = on(o.poly);
    const rowLines: LosLine[] = [];
    for (const { ts, points } of targets) {
      const ignore = new Set([...ignoreBase, ...on(ts.poly)]);
      for (const from of o.points) for (const to of pointsFor(ts, points, from)) rowLines.push(testLine(from, to, o.id, ts.id, ignore));
    }
    const clear = rowLines.filter((l) => l.status === 'clear' || l.status === 'outOfRange').sort((x, y) => x.length - y.length);
    const inArc = rowLines.filter((l) => l.status !== 'outOfArc').sort((x, y) => x.length - y.length);
    const best = clear[0] ?? inArc[0] ?? rowLines.slice().sort((x, y) => x.length - y.length)[0];
    const blockedBy = clear.length ? [] : [...new Set(inArc.flatMap((l) => l.blockers.map((x) => x.name)))];
    const row: LosRow = {
      id: o.id,
      name: o.name,
      arcs: arcsOf(b, targetRef, target.frame, o.poly),
      clear: clear.length > 0,
      best,
      blockedBy,
      cover: best ? best.crossed.filter((c) => c.keywords.includes('Cover') || c.keywords.includes('Obscuring')).map((c) => c.name) : [],
      terrain: best ? best.crossed : [],
    };
    if (mode === 'volley') {
      if (clear[0]) row.distance = clear[0].length;
      if (acting.barrageRange !== undefined) {
        row.inRange = !!clear[0] && clear[0].length <= acting.barrageRange + EPS;
        row.effective = polygonSetDistance([o.poly], targetPolys).distance < acting.barrageRange / 2 - EPS;
      }
    }
    rows.push(row);
    if (mode === 'sight' || opts.allLines) lines.push(...rowLines);
    else if (best) lines.push(best);
  }

  // --- summary -------------------------------------------------------------------
  const clearCount = rows.filter((r) => r.clear).length;
  const inRangeCount = rows.filter((r) => r.inRange).length;
  const arcCounts: Partial<Record<Arc, number>> = {};
  for (const r of rows) for (const a of r.arcs) arcCounts[a] = (arcCounts[a] ?? 0) + 1;
  const targetInFrontArc = allFront || !acting.frame || target.stands.some((t) => polygonArcs(acting.frame!, t.poly).includes('front'));
  if (!targetInFrontArc) notes.push(`No part of ${target.name} is in ${acting.name}'s front arc.`);

  // Every target stand inside one Cover / Obscuring piece.
  const coverPiece = b.terrain.find((t) => isFlagTerrain(t) && target.stands.every((x) => pointInPolygon(centroid(x.poly), terrainPolygon(t))));
  if (coverPiece) notes.push(`Every target stand is inside ${coverPiece.name} (${coverPiece.keywords.filter((k) => k === 'Cover' || k === 'Obscuring').join(', ')}).`);

  const unit = acting.garrison ? 'garrison' : `front stand${rows.length === 1 ? '' : 's'}`;
  let headline = `Line of sight: ${clearCount ? 'YES' : 'NO'} — ${clearCount} of ${rows.length} ${unit} clear`;
  if (mode === 'volley' && acting.barrageRange !== undefined) headline += ` · ${inRangeCount} in range (${acting.barrageRange}")`;

  return {
    mode,
    actingName: acting.name,
    targetName: target.name,
    acting: aSize,
    target: tSize,
    rows,
    lines,
    clearCount,
    inRangeCount,
    headline,
    arcCounts,
    targetInFrontArc,
    ...(acting.barrageRange !== undefined ? { barrageRange: acting.barrageRange } : {}),
    notes,
  };
}

/** One-paragraph summary for the log. */
export function describeLos(r: LosResult): string {
  const arcs = (Object.keys(r.arcCounts) as Arc[]).map((a) => `${ARC_LABEL[a]}: ${r.arcCounts[a]}`).join(' · ');
  const rows = r.rows
    .map((x) => {
      const what = x.clear ? `clear${x.distance !== undefined ? ` ${x.distance.toFixed(1)}"` : ''}` : x.blockedBy.length ? `blocked by ${x.blockedBy.join(', ')}` : 'no line in arc';
      return `${x.name}: ${what}${x.cover.length ? ` (crosses ${x.cover.join(', ')})` : ''}`;
    })
    .join('; ');
  return `${r.mode === 'volley' ? 'Volley' : 'Sight'} ${r.actingName} → ${r.targetName} (sizes ${r.acting.size} / ${r.target.size}). ${r.headline}.${arcs ? ` Arcs: ${arcs}.` : ''} ${rows}`;
}
