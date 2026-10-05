// Facing-arc wedges and line-of-sight lines drawn on the board.

import { useId } from 'react';
import { ARCS, arcWedge, localToWorld, type Arc, type Battle, type Frame, type LosLine, type LosResult } from '@conquest/shared';
import { Txt } from './Shapes';

const ARC_FILL: Record<Arc, string> = {
  front: 'rgba(46,125,50,0.10)',
  left: 'rgba(245,166,35,0.09)',
  right: 'rgba(245,166,35,0.09)',
  rear: 'rgba(198,40,40,0.08)',
};
const ARC_TEXT: Record<Arc, string> = { front: 'Front', left: 'Left flank', right: 'Right flank', rear: 'Rear' };

/**
 * The four arcs of a frame as faint wedges reaching the board edge: each
 * corner sends a 45° line outward. A stand is in an arc if any part of it is
 * inside the wedge (a stand can be in two).
 */
export function ArcWedges({ frame, board, fs, flip, px, labels }: { frame: Frame; board: { width: number; depth: number }; fs: number; flip: boolean; px: number; labels: boolean }) {
  const id = useId().replace(/:/g, '');
  const pts = (p: { x: number; y: number }[]) => p.map((q) => `${q.x},${q.y}`).join(' ');
  // Label each arc a few inches out along its middle.
  const at: Record<Arc, { x: number; y: number }> = {
    front: localToWorld(frame, frame.w / 2, -4),
    rear: localToWorld(frame, frame.w / 2, frame.d + 4),
    left: localToWorld(frame, -4, frame.d / 2),
    right: localToWorld(frame, frame.w + 4, frame.d / 2),
  };
  return (
    <g pointerEvents="none">
      <defs>
        <clipPath id={`arcs-${id}`}>
          <rect x={0} y={0} width={board.width} height={board.depth} />
        </clipPath>
      </defs>
      <g clipPath={`url(#arcs-${id})`}>
        {ARCS.map((a) => (
          <polygon key={a} points={pts(arcWedge(frame, a, 300))} fill={ARC_FILL[a]} stroke="rgba(0,0,0,0.35)" strokeWidth={1 * px} strokeDasharray={`${4 * px} ${4 * px}`} />
        ))}
      </g>
      {labels &&
        ARCS.map((a) => (
          <Txt key={a} x={at[a].x} y={at[a].y} fs={fs * 0.8} flip={flip} fill="rgba(0,0,0,0.55)">
            {ARC_TEXT[a]}
          </Txt>
        ))}
    </g>
  );
}

const LINE_COLOR: Record<LosLine['status'], string> = {
  clear: '#2e7d32',
  blocked: '#c62828',
  outOfRange: '#9e9e9e',
  outOfArc: '#bdbdbd',
};

/** Every tested line: green clear, red obstructed, grey out of range, faint dotted out of arc. */
export function LosLines({ result, px, fs, flip }: { result: LosResult; px: number; fs: number; flip: boolean }) {
  // Draw out-of-arc and blocked lines first so clear ones stay on top.
  const order: LosLine['status'][] = ['outOfArc', 'blocked', 'outOfRange', 'clear'];
  const lines = order.flatMap((st) => result.lines.filter((l) => l.status === st));
  const best = new Set(result.rows.map((r) => r.best).filter(Boolean));
  return (
    <g pointerEvents="none">
      {lines.map((l, i) => (
        <line
          key={i}
          x1={l.from.x}
          y1={l.from.y}
          x2={l.to.x}
          y2={l.to.y}
          stroke={LINE_COLOR[l.status]}
          strokeWidth={(best.has(l) ? 2.5 : 1.2) * px}
          strokeDasharray={l.status === 'outOfArc' ? `${2 * px} ${3 * px}` : l.status === 'outOfRange' ? `${6 * px} ${3 * px}` : undefined}
          opacity={l.status === 'outOfArc' ? 0.6 : 0.9}
        />
      ))}
      {result.mode === 'volley' &&
        result.rows.map((r) =>
          r.best && r.clear ? (
            <Txt key={r.id} x={(r.best.from.x + r.best.to.x) / 2} y={(r.best.from.y + r.best.to.y) / 2} fs={fs * 0.85} flip={flip} weight={700} fill={LINE_COLOR[r.best.status]}>
              {r.best.length.toFixed(1)}"
            </Txt>
          ) : null,
        )}
    </g>
  );
}

/** Ids of everything that obstructs a line, for highlighting. */
export function losBlockerIds(result: LosResult | null): string[] {
  if (!result) return [];
  return [...new Set(result.lines.filter((l) => l.status === 'blocked').flatMap((l) => l.blockers.map((x) => x.id)))];
}

/** Frames whose arcs to draw: the selection (or the LoS acting piece), or every piece while A is held. */
export function arcFrames(b: Battle, ids: string[], all: boolean, frameOf: (b: Battle, id: string) => Frame | null): Frame[] {
  const out: Frame[] = [];
  const list = all ? [...b.regiments.filter((r) => r.location === 'board' && !r.garrisonId).map((r) => r.id), ...b.characters.filter((c) => c.location === 'board' && !c.attachedTo).map((c) => c.id)] : ids;
  for (const id of list) {
    const f = frameOf(b, id);
    if (f) out.push(f);
  }
  return out;
}
