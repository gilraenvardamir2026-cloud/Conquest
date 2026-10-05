// What a move session draws: the faded ghost at the start pose, the movement
// handles on the piece's current pose, and the Align-to-target preview.

import type { PointerEvent as RPointerEvent } from 'react';
import {
  alignTargetFrame,
  alignToFacing,
  boxCentre,
  boxCorners,
  facingEdge,
  localToWorld,
  type AlignTarget,
  type Battle,
  type Facing,
  type PieceBox,
  type Pose,
} from '@conquest/shared';
import { SELECT_STROKE } from './theme';
import { Txt } from './Shapes';

export type HandleKind = 'forward' | 'sideways' | 'wheel-left' | 'wheel-right' | 'rotate';

const pts = (p: { x: number; y: number }[]) => p.map((q) => `${q.x},${q.y}`).join(' ');

export function Ghost({ pose, box }: { pose: Pose; box: PieceBox }) {
  return <polygon points={pts(boxCorners(pose, box))} fill="rgba(60,60,60,0.12)" stroke="#555" strokeWidth={0.06} strokeDasharray="0.3 0.2" pointerEvents="none" />;
}

/**
 * Handles, all on the piece's current pose:
 *  - arrow in front of the front centre: forward / backward
 *  - arrows on both flanks: sideways
 *  - circles on the front corners: wheel (pivot on the other corner)
 *  - dashed ring around it: rotate about the centre
 * The body itself is the free-drag handle (handled by the piece's shape).
 */
export function MoveHandles({ pose, box, px, onDown }: { pose: Pose; box: PieceBox; px: number; onDown: (k: HandleKind, e: RPointerEvent<SVGElement>) => void }) {
  const P = (u: number, v: number) => localToWorld(pose, u, v);
  const mid = (box.u0 + box.u1) / 2;
  const s = 9 * px; // handle size in inches, ~9 px on screen
  const tri = (tip: [number, number], back1: [number, number], back2: [number, number]) => pts([P(...tip), P(...back1), P(...back2)]);
  const fwdBase = -0.8 - s;
  const c = boxCentre(pose, box);
  const ringR = Math.hypot(box.u1 - box.u0, box.d) / 2 + 1.2 + s;
  const down = (k: HandleKind) => (e: RPointerEvent<SVGElement>) => onDown(k, e);
  return (
    <g className="move-handles">
      <circle cx={c.x} cy={c.y} r={ringR} fill="none" stroke={SELECT_STROKE} strokeWidth={1.5 * px} strokeDasharray={`${6 * px} ${4 * px}`} pointerEvents="none" />
      <circle cx={c.x} cy={c.y} r={ringR} fill="none" stroke="transparent" strokeWidth={12 * px} className="handle-hit rotate" onPointerDown={down('rotate')}>
        <title>Rotate about the centre (reports the angle)</title>
      </circle>
      <polygon
        className="handle move"
        points={tri([mid, fwdBase - 1.6 * s], [mid - s, fwdBase], [mid + s, fwdBase])}
        onPointerDown={down('forward')}
      >
        <title>Forward / backward along the facing</title>
      </polygon>
      <polygon className="handle move" points={tri([box.u0 - 0.5 - 1.6 * s, box.d / 2], [box.u0 - 0.5, box.d / 2 - s], [box.u0 - 0.5, box.d / 2 + s])} onPointerDown={down('sideways')}>
        <title>Sideways</title>
      </polygon>
      <polygon className="handle move" points={tri([box.u1 + 0.5 + 1.6 * s, box.d / 2], [box.u1 + 0.5, box.d / 2 - s], [box.u1 + 0.5, box.d / 2 + s])} onPointerDown={down('sideways')}>
        <title>Sideways</title>
      </polygon>
      {(['wheel-left', 'wheel-right'] as const).map((k) => {
        const p = P(k === 'wheel-left' ? box.u0 : box.u1, 0);
        return (
          <circle key={k} className="handle wheel" cx={p.x} cy={p.y} r={s * 0.9} onPointerDown={down(k)}>
            <title>Wheel: drag this corner, the other front corner is the pivot</title>
          </circle>
        );
      })}
    </g>
  );
}

/** The facing being pointed at (aligning) and the proposed pose (preview). */
export function AlignPreview({
  b,
  pose,
  box,
  hover,
  pending,
  fs,
  flip,
  px,
}: {
  b: Battle;
  pose: Pose;
  box: PieceBox;
  hover: { target: AlignTarget; facing: Facing } | null;
  pending: { target: AlignTarget; facing: Facing; mode: 'contact' | 'centre' } | null;
  fs: number;
  flip: boolean;
  px: number;
}) {
  const edgeOf = (target: AlignTarget, facing: Facing) => {
    const t = alignTargetFrame(b, target);
    return t ? facingEdge(t.frame, facing) : null;
  };
  const out: React.ReactNode[] = [];
  const h = hover ? edgeOf(hover.target, hover.facing) : null;
  if (h) out.push(<line key="h" x1={h.a.x} y1={h.a.y} x2={h.b.x} y2={h.b.y} stroke="#d500f9" strokeWidth={6 * px} strokeLinecap="round" opacity={0.8} />);
  if (pending) {
    const t = alignTargetFrame(b, pending.target);
    if (t) {
      const e = facingEdge(t.frame, pending.facing);
      out.push(<line key="e" x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke="#d500f9" strokeWidth={6 * px} strokeLinecap="round" />);
      const res = alignToFacing(pose, box, t.frame, pending.facing, pending.mode);
      const corners = boxCorners(res.pose, box);
      out.push(<polygon key="p" points={pts(corners)} fill="rgba(213,0,249,0.15)" stroke="#d500f9" strokeWidth={2 * px} strokeDasharray={`${6 * px} ${3 * px}`} />);
      const fc = localToWorld(res.pose, (box.u0 + box.u1) / 2, box.d / 2);
      out.push(
        <Txt key="t" x={fc.x} y={fc.y} fs={fs} flip={flip} weight={800} fill="#6a0080">
          {res.travel.toFixed(1)}"
        </Txt>,
      );
    }
  }
  return <g pointerEvents="none">{out}</g>;
}
