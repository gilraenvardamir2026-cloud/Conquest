// Actions shared by the keyboard, the board and the side panels for moving
// and measuring.

import {
  alignSegment,
  alignTargetFrame,
  alignToFacing,
  closestBetween,
  facingName,
  forwardSegment,
  makeId,
  pieceAt,
  refName,
  regimentCenter,
  rotateSegment,
  sidewaysSegment,
  type EntityRef,
  type MovingPiece,
} from '@conquest/shared';
import { ringRadii } from './board/Overlays';
import { sessionPose, useStore, type Selection } from './store';

export function movableFromSelection(sel: Selection | null): MovingPiece | null {
  if (!sel || (sel.kind !== 'regiment' && sel.kind !== 'character')) return null;
  return { kind: sel.kind, id: sel.id };
}

export function refFromSelection(sel: Selection | null): EntityRef | null {
  if (!sel || sel.kind === 'marker') return null;
  return { kind: sel.kind, id: sel.id };
}

/** Start a move for the selection (M). */
export function startMoveForSelection(): boolean {
  const st = useStore.getState();
  const piece = movableFromSelection(st.selection);
  if (!piece) {
    st.notify('Select a regiment or character to move');
    return false;
  }
  if (st.tool !== 'select') st.setTool('select');
  return st.startMove(piece);
}

/** Arrow keys: nudge along the piece's own axes. Q/E: rotate about the centre. */
export function nudge(kind: 'forward' | 'sideways' | 'rotate', amount: number) {
  const st = useStore.getState();
  if (!st.moveSession && !startMoveForSelection()) return;
  const m = useStore.getState().moveSession!;
  const base = sessionPose({ ...m, live: null });
  const box = pieceAt(st.battle, m.piece, m.start)?.box;
  if (!box) return;
  const seg = kind === 'forward' ? forwardSegment(base, amount) : kind === 'sideways' ? sidewaysSegment(base, amount) : rotateSegment(base, box, amount);
  st.addSegment(seg, true);
}

/** Turn the pending align preview into a segment of the move. */
export function applyAlign() {
  const st = useStore.getState();
  const m = st.moveSession;
  if (!m?.align) return;
  const target = alignTargetFrame(st.battle, m.align.target);
  const base = sessionPose({ ...m, live: null });
  const box = pieceAt(st.battle, m.piece, m.start)?.box;
  if (!target || !box) return;
  const res = alignToFacing(base, box, target.frame, m.align.facing, m.align.mode);
  st.addSegment(alignSegment(base, res.pose, box, `${target.name} ${facingName(m.align.target.kind, m.align.facing)}`));
}

/** P: pin the current ruler, distance or range rings so they stay until cleared. */
export function pinCurrent() {
  const st = useStore.getState();
  const { ruler, pair, ring } = st.measure;
  const tool = st.tool;
  if ((tool === 'ruler' || (tool !== 'distance' && tool !== 'ring')) && ruler) {
    st.dispatch({ type: 'addMeasurement', measurement: { id: makeId(), kind: 'ruler', by: st.seat ?? 'spectator', a: ruler.a, b: ruler.b } });
    st.setMeasure({ ruler: null });
    return;
  }
  if (pair.length === 2 && tool !== 'ring') {
    if (!closestBetween(st.battle, pair[0], pair[1])) return st.notify('Both things must be on the board');
    st.dispatch({ type: 'addMeasurement', measurement: { id: makeId(), kind: 'distance', by: st.seat ?? 'spectator', a: pair[0], b: pair[1] } });
    return;
  }
  if (ring.ref) {
    const radii = ringRadii(st.battle, ring);
    if (!radii.length) return st.notify('Choose a range for the ring first');
    for (const r of radii) {
      st.dispatch({ type: 'addMeasurement', measurement: { id: makeId(), kind: 'ring', by: st.seat ?? 'spectator', ref: ring.ref, radius: r.radius, label: `${refName(st.battle, ring.ref)} ${r.label}` } });
    }
    return;
  }
  st.notify('Nothing to pin: measure something first');
}

/** L: open the line-of-sight tool, with the selected regiment as the acting piece. */
export function startLos() {
  const st = useStore.getState();
  st.setTool('los');
  const sel = st.selection;
  if (sel && sel.kind === 'regiment' && st.los.acting?.id !== sel.id) {
    st.setLos({ acting: { kind: sel.kind, id: sel.id }, target: st.los.target?.id === sel.id ? null : st.los.target });
  }
}

/** +/-: zoom about the middle of the view. */
export function zoomBy(k: number) {
  const st = useStore.getState();
  st.setView({ scale: Math.max(3, Math.min(200, st.view.scale * k)) });
}

/** Arrow keys with nothing to move: pan the view by about 80 px (Shift: 400 px). */
export function panBy(dx: number, dy: number) {
  const st = useStore.getState();
  st.setView({ cx: st.view.cx + dx / st.view.scale, cy: st.view.cy + dy / st.view.scale });
}

/**
 * [ and ]: step through the regiments on the board (and, as line-of-sight
 * targets, objective markers) without a mouse. With the LoS tool and an
 * acting regiment, they step the target; otherwise the selection.
 */
export function cycle(dir: 1 | -1) {
  const st = useStore.getState();
  const b = st.battle;
  const regs = b.regiments
    .filter((r) => r.location === 'board' && !r.garrisonId)
    .sort((p, q) => p.owner.localeCompare(q.owner) || p.name.localeCompare(q.name));
  const step = <T,>(list: T[], i: number) => list[(((i + dir) % list.length) + list.length) % list.length];
  const centre = (kind: 'regiment' | 'objective', id: string) => {
    const r = kind === 'regiment' ? regs.find((x) => x.id === id) : undefined;
    const m = kind === 'objective' ? b.objectiveMarkers.find((x) => x.id === id) : undefined;
    const c = r ? regimentCenter(r) : m ? { x: m.x, y: m.y } : null;
    if (c) st.centreOn(c.x, c.y);
  };
  if (st.tool === 'los' && st.los.acting) {
    const actingId = st.los.acting.id;
    const acting = regs.find((r) => r.id === actingId);
    const targets = [
      ...regs.filter((r) => r.id !== actingId && r.owner !== acting?.owner).map((r) => ({ kind: 'regiment' as const, id: r.id })),
      ...b.objectiveMarkers.filter((m) => !m.destroyed).map((m) => ({ kind: 'objective' as const, id: m.id })),
    ];
    if (!targets.length) return st.notify('No target to pick');
    const t = step(targets, targets.findIndex((x) => x.id === st.los.target?.id));
    st.setLos({ target: t });
    st.notify(`Target: ${refName(b, t)}`, 'info');
    return centre(t.kind, t.id);
  }
  if (!regs.length) return st.notify('No regiment on the board');
  const cur = st.selection?.kind === 'regiment' ? regs.findIndex((r) => r.id === st.selection!.id) : dir === 1 ? -1 : 0;
  const r = step(regs, cur);
  st.select({ kind: 'regiment', id: r.id });
  if (st.tool === 'los') st.setLos({ acting: { kind: 'regiment', id: r.id }, target: null });
  centre('regiment', r.id);
}
