// Measuring between things on the board, contacts, and the non-blocking
// warnings shown during a move session. Distances are always edge to edge
// (closest points), never centre to centre.

import {
  add,
  bounds,
  closestPointOnSegment,
  dist,
  EPS,
  mul,
  normalize,
  pointInPolygon,
  polygonDistance,
  polygonsOverlap,
  sub,
  type Polygon,
  type Pose,
  type Vec,
} from './geometry';
import { boardStandPolygons, CONTACT_TOLERANCE, objectiveMarkerPolygon, terrainPolygon } from './board';
import { characterBox, regimentBox, segmentsTotal, sweepPoses, touchingParts, type MoveSegment, type PieceBox } from './movement';
import { characterPolygon, regimentPolygons, slotPolygon } from './regiment';
import type { Battle, EntityRef, Regiment } from './types';

// ---------------------------------------------------------------------------
// Shapes of things
// ---------------------------------------------------------------------------

export type RefShape = { polys: Polygon[] } | { circle: { c: Vec; r: number } };

/** Footprint of a referenced thing, or null if it is not on the board. */
export function refShape(b: Battle, ref: EntityRef): RefShape | null {
  switch (ref.kind) {
    case 'regiment': {
      const r = b.regiments.find((x) => x.id === ref.id);
      if (!r || r.location !== 'board' || r.garrisonId) return null;
      if (ref.standId) {
        const s = r.stands.find((x) => x.id === ref.standId);
        return s ? { polys: [slotPolygon(r, s.slot)] } : null;
      }
      return { polys: regimentPolygons(r) };
    }
    case 'character': {
      const c = b.characters.find((x) => x.id === ref.id);
      if (!c || c.location !== 'board') return null;
      if (c.attachedTo) {
        const r = b.regiments.find((x) => x.id === c.attachedTo);
        return r?.characterSlot && r.location === 'board' && !r.garrisonId ? { polys: [slotPolygon(r, r.characterSlot)] } : null;
      }
      const p = characterPolygon(c);
      return p ? { polys: [p] } : null;
    }
    case 'terrain': {
      const t = b.terrain.find((x) => x.id === ref.id);
      return t ? { polys: [terrainPolygon(t)] } : null;
    }
    case 'objective': {
      const m = b.objectiveMarkers.find((x) => x.id === ref.id);
      return m && !m.destroyed ? { polys: [objectiveMarkerPolygon(m)] } : null;
    }
    case 'zone': {
      const z = b.zones.find((x) => x.id === ref.id);
      return z ? { circle: { c: { x: z.x, y: z.y }, r: z.diameter / 2 } } : null;
    }
  }
}

export function refName(b: Battle, ref: EntityRef): string {
  switch (ref.kind) {
    case 'regiment':
      return b.regiments.find((x) => x.id === ref.id)?.name ?? 'regiment';
    case 'character':
      return b.characters.find((x) => x.id === ref.id)?.name ?? 'character';
    case 'terrain':
      return b.terrain.find((x) => x.id === ref.id)?.name ?? 'terrain';
    case 'objective': {
      const m = b.objectiveMarkers.find((x) => x.id === ref.id);
      return `objective ${m?.label ?? 'marker'}`;
    }
    case 'zone': {
      const z = b.zones.find((x) => x.id === ref.id);
      return `${z?.diameter ?? ''}" zone${z?.label ? ` ${z.label}` : ''}`;
    }
  }
}

/** Closest point on a polygon (boundary, or p itself when inside). */
export function closestPointOnPolygon(p: Vec, poly: Polygon): Vec {
  if (pointInPolygon(p, poly)) return p;
  let best = poly[0];
  let bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const q = closestPointOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    const d = dist(p, q);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

export interface Closest {
  distance: number;
  a: Vec;
  b: Vec;
  /** When one side is a zone: does any stand / part of the other thing reach inside the circle? */
  inside?: boolean;
}

function polysToCircle(polys: Polygon[], c: Vec, r: number): Closest {
  let best: Closest = { distance: Infinity, a: c, b: c, inside: false };
  for (const poly of polys) {
    const p = closestPointOnPolygon(c, poly);
    const d = dist(p, c);
    if (d < r - EPS) best.inside = true;
    const gap = Math.max(0, d - r);
    if (gap < best.distance) {
      const onCircle = d > r ? add(c, mul(normalize(sub(p, c)), r)) : p;
      best = { distance: gap, a: p, b: onCircle, inside: best.inside };
    }
  }
  return best;
}

/** Closest points between two referenced things (stand to stand, edge to edge). */
export function closestBetween(b: Battle, r1: EntityRef, r2: EntityRef): Closest | null {
  const s1 = refShape(b, r1);
  const s2 = refShape(b, r2);
  if (!s1 || !s2) return null;
  if ('circle' in s1 && 'circle' in s2) {
    const d = dist(s1.circle.c, s2.circle.c);
    const u = d > 0 ? normalize(sub(s2.circle.c, s1.circle.c)) : { x: 1, y: 0 };
    const gap = Math.max(0, d - s1.circle.r - s2.circle.r);
    return { distance: gap, a: add(s1.circle.c, mul(u, s1.circle.r)), b: sub(s2.circle.c, mul(u, s2.circle.r)), inside: gap === 0 };
  }
  if ('circle' in s1) {
    const r = polysToCircle((s2 as { polys: Polygon[] }).polys, s1.circle.c, s1.circle.r);
    return { ...r, a: r.b, b: r.a };
  }
  if ('circle' in s2) return polysToCircle(s1.polys, s2.circle.c, s2.circle.r);
  let best: Closest = { distance: Infinity, a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
  for (const A of s1.polys)
    for (const B of s2.polys) {
      const r = polygonDistance(A, B);
      if (r.distance < best.distance) best = { distance: r.distance, a: r.a, b: r.b };
    }
  return best;
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export interface Contact {
  a: string;
  b: string;
  /** Touching edge stretches; a === b for a corner touch. */
  parts: { a: Vec; b: Vec }[];
}

/** Every pair of pieces on the board (regiments, lone characters) whose stands touch. */
export function boardContacts(b: Battle): Contact[] {
  const stands = boardStandPolygons(b).map((s) => ({ ...s, bb: bounds(s.poly) }));
  const pairs = new Map<string, Contact>();
  const tol = CONTACT_TOLERANCE;
  for (let i = 0; i < stands.length; i++) {
    for (let j = i + 1; j < stands.length; j++) {
      const A = stands[i];
      const B = stands[j];
      if (A.ownerId === B.ownerId) continue;
      if (A.bb.minX > B.bb.maxX + tol || B.bb.minX > A.bb.maxX + tol || A.bb.minY > B.bb.maxY + tol || B.bb.minY > A.bb.maxY + tol) continue;
      const parts = touchingParts(A.poly, B.poly, tol);
      if (!parts.length) continue;
      const key = A.ownerId < B.ownerId ? `${A.ownerId}|${B.ownerId}` : `${B.ownerId}|${A.ownerId}`;
      const c = pairs.get(key) ?? { a: A.ownerId, b: B.ownerId, parts: [] };
      c.parts.push(...parts);
      pairs.set(key, c);
    }
  }
  return [...pairs.values()];
}

// ---------------------------------------------------------------------------
// Move warnings
// ---------------------------------------------------------------------------

export type MoveWarningKind = 'march' | 'sideways' | 'enemy' | 'garrison' | 'overlap' | 'offboard' | 'impassable';

export interface MoveWarning {
  kind: MoveWarningKind;
  text: string;
  /** Things involved, for highlighting. */
  ids: string[];
}

export interface MovingPiece {
  kind: 'regiment' | 'character';
  id: string;
}

/** Footprint and stand polygons of a moving piece at a given pose. */
export function pieceAt(b: Battle, piece: MovingPiece, pose: Pose): { box: PieceBox; polys: Polygon[]; owner: Regiment['owner']; march?: number; name: string } | null {
  if (piece.kind === 'regiment') {
    const r = b.regiments.find((x) => x.id === piece.id);
    if (!r) return null;
    const moved = { ...r, ...pose };
    return { box: regimentBox(r), polys: regimentPolygons(moved), owner: r.owner, march: r.march, name: r.name };
  }
  const c = b.characters.find((x) => x.id === piece.id);
  if (!c) return null;
  const p = characterPolygon({ ...c, ...pose });
  return p ? { box: characterBox(c), polys: [p], owner: c.owner, name: c.name } : null;
}

const fmt = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}"`;

/**
 * Warnings for a piece ending a move at `pose` after `segments`. They never
 * block anything; the players decide what they mean.
 */
export function moveWarnings(b: Battle, piece: MovingPiece, pose: Pose, segments: MoveSegment[]): MoveWarning[] {
  const me = pieceAt(b, piece, pose);
  if (!me) return [];
  const out: MoveWarning[] = [];
  const total = segmentsTotal(segments);

  if (me.march !== undefined && total > me.march + EPS) {
    out.push({ kind: 'march', text: `Total ${fmt(total)} exceeds March ${fmt(me.march)}`, ids: [] });
  }
  if (me.march !== undefined) {
    const side = segments.filter((s) => s.kind === 'sideways').reduce((a, s) => a + s.distance, 0);
    if (side > me.march / 2 + EPS) out.push({ kind: 'sideways', text: `Sideways ${fmt(side)} exceeds half March (${fmt(me.march / 2)})`, ids: [] });
  }

  // Other pieces on the board (the attached character moves with its regiment, so it is not "other").
  const selfIds = new Set([piece.id]);
  if (piece.kind === 'regiment') {
    const r = b.regiments.find((x) => x.id === piece.id);
    if (r?.characterId) selfIds.add(r.characterId);
  }
  const others = boardStandPolygons(b).filter((s) => !selfIds.has(s.ownerId));
  const byOwner = new Map<string, { seat: string; polys: Polygon[] }>();
  for (const s of others) {
    const e = byOwner.get(s.ownerId) ?? { seat: s.seat, polys: [] };
    e.polys.push(s.poly);
    byOwner.set(s.ownerId, e);
  }
  const nameOf = (id: string) => b.regiments.find((r) => r.id === id)?.name ?? b.characters.find((c) => c.id === id)?.name ?? '?';

  for (const [id, e] of byOwner) {
    let gap = Infinity;
    let overlap = false;
    for (const A of me.polys)
      for (const B of e.polys) {
        gap = Math.min(gap, polygonDistance(A, B).distance);
        if (!overlap && polygonsOverlap(A, B)) overlap = true;
      }
    if (overlap) out.push({ kind: 'overlap', text: `Overlaps ${nameOf(id)}`, ids: [id] });
    else if (e.seat !== me.owner && gap < 1 - EPS) {
      out.push({ kind: 'enemy', text: gap <= CONTACT_TOLERANCE ? `In contact with enemy ${nameOf(id)}` : `Within 1" of enemy ${nameOf(id)} (${fmt(gap)})`, ids: [id] });
    }
  }

  for (const m of b.objectiveMarkers) {
    if (m.destroyed) continue;
    const poly = objectiveMarkerPolygon(m);
    if (me.polys.some((A) => polygonsOverlap(A, poly))) out.push({ kind: 'overlap', text: `Overlaps objective marker ${m.label ?? '•'}`, ids: [m.id] });
  }

  for (const t of b.terrain) {
    if (!t.keywords.includes('Garrison')) continue;
    const poly = terrainPolygon(t);
    const gap = Math.min(...me.polys.map((A) => polygonDistance(A, poly).distance));
    if (gap < 1 - EPS) out.push({ kind: 'garrison', text: `Within 1" of garrison terrain ${t.name} (${fmt(gap)})`, ids: [t.id] });
  }

  const W = b.board.width;
  const D = b.board.depth;
  if (me.polys.some((poly) => poly.some((p) => p.x < -EPS || p.y < -EPS || p.x > W + EPS || p.y > D + EPS))) {
    out.push({ kind: 'offboard', text: 'Part of it is off the board', ids: [] });
  }

  const impassable = b.terrain.filter((t) => t.keywords.includes('Impassable')).map((t) => ({ t, poly: terrainPolygon(t) }));
  if (impassable.length) {
    const crossed = new Set<string>();
    for (const seg of segments) {
      for (const p of sweepPoses(seg, me.box)) {
        const at = pieceAt(b, piece, p);
        if (!at) continue;
        for (const { t, poly } of impassable) if (!crossed.has(t.id) && at.polys.some((A) => polygonsOverlap(A, poly))) crossed.add(t.id);
      }
    }
    // The end pose counts even with no segments (e.g. a piece dropped onto terrain).
    for (const { t, poly } of impassable) if (!crossed.has(t.id) && me.polys.some((A) => polygonsOverlap(A, poly))) crossed.add(t.id);
    for (const id of crossed) out.push({ kind: 'impassable', text: `Crosses Impassable ${b.terrain.find((t) => t.id === id)!.name}`, ids: [id] });
  }
  return out;
}
