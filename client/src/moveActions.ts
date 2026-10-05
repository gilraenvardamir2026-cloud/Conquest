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
    st.dispatch({ type: 'addMeasurement', measurement: { id: makeId(), kind: 'ruler', by: st.seat, a: ruler.a, b: ruler.b } });
    st.setMeasure({ ruler: null });
    return;
  }
  if (pair.length === 2 && tool !== 'ring') {
    if (!closestBetween(st.battle, pair[0], pair[1])) return st.notify('Both things must be on the board');
    st.dispatch({ type: 'addMeasurement', measurement: { id: makeId(), kind: 'distance', by: st.seat, a: pair[0], b: pair[1] } });
    return;
  }
  if (ring.ref) {
    const radii = ringRadii(st.battle, ring);
    if (!radii.length) return st.notify('Choose a range for the ring first');
    for (const r of radii) {
      st.dispatch({ type: 'addMeasurement', measurement: { id: makeId(), kind: 'ring', by: st.seat, ref: ring.ref, radius: r.radius, label: `${refName(st.battle, ring.ref)} ${r.label}` } });
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
