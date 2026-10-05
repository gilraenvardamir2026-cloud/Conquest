// Other people in the room, drawn live in their colour: cursor with name,
// selection, move preview, ruler, distance, range rings, Align preview and
// line of sight. Nothing here is stored.

import {
  alignTargetFrame,
  boxCorners,
  facingEdge,
  lineOfSight,
  pieceAt,
  regimentFrame,
  type Battle,
} from '@conquest/shared';
import type { Peer } from '../store';
import { LosLines } from './LosOverlay';
import { DistanceLine, RangeRing, RulerLine } from './Overlays';
import { Txt } from './Shapes';

const SPECTATOR = '#757575';
const pts = (p: { x: number; y: number }[]) => p.map((q) => `${q.x},${q.y}`).join(' ');

export function PeersLayer({ b, peers, fs, flip, px }: { b: Battle; peers: Record<string, Peer>; fs: number; flip: boolean; px: number }) {
  return (
    <g pointerEvents="none">
      {Object.entries(peers).map(([id, peer]) => {
        const color = peer.seat === 'spectator' ? SPECTATOR : b.players[peer.seat].color;
        const p = peer.p;
        const out: React.ReactNode[] = [];
        // Selection outline.
        if (p.selection?.kind === 'regiment') {
          const r = b.regiments.find((x) => x.id === p.selection!.id);
          if (r && r.location === 'board' && !r.garrisonId && p.move?.piece.id !== r.id) {
            const f = regimentFrame(r);
            out.push(<polygon key="sel" points={pts(boxCorners(f, { u0: 0, u1: f.w, d: f.d }))} fill="none" stroke={color} strokeWidth={2 * px} strokeDasharray={`${3 * px} ${3 * px}`} />);
          }
        }
        // Move preview: the piece's outline where they are moving it.
        if (p.move) {
          const at = pieceAt(b, p.move.piece, p.move.pose);
          if (at) {
            at.polys.forEach((poly, i) => out.push(<polygon key={`mv${i}`} points={pts(poly)} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={2 * px} />));
            const c = boxCorners(p.move.pose, at.box)[0];
            out.push(
              <Txt key="mvt" x={c.x} y={c.y - fs} fs={fs * 0.85} flip={flip} weight={700} fill={color}>
                {peer.name} moving {at.name}
              </Txt>,
            );
          }
        }
        if (p.align) {
          const t = alignTargetFrame(b, { kind: p.align.targetKind, id: p.align.targetId });
          if (t) {
            const e = facingEdge(t.frame, p.align.facing);
            out.push(<line key="al" x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke={color} strokeWidth={5 * px} strokeLinecap="round" />);
          }
        }
        if (p.ruler) out.push(<RulerLine key="ru" a={p.ruler.a} b={p.ruler.b} fs={fs} flip={flip} px={px} color={color} tag={peer.name} />);
        if (p.pair && p.pair.length === 2) out.push(<DistanceLine key="di" b={b} a1={p.pair[0]} a2={p.pair[1]} fs={fs} flip={flip} px={px} color={color} />);
        if (p.ring) p.ring.radii.forEach((r) => out.push(<RangeRing key={`rg${r.label}`} b={b} refr={p.ring!.ref} radius={r.radius} label={`${peer.name}: ${r.label}`} fs={fs} flip={flip} px={px} />));
        if (p.los) {
          const res = lineOfSight(b, p.los.acting, p.los.target, p.los.mode);
          if (res) {
            out.push(<LosLines key="los" result={res} px={px} fs={fs} flip={flip} />);
            const a = b.regiments.find((r) => r.id === p.los!.acting.id);
            if (a) {
              const f = regimentFrame(a);
              out.push(
                <Txt key="lost" x={f.x} y={f.y - fs * 2.2} fs={fs * 0.85} flip={flip} weight={700} fill={color}>
                  {peer.name}: {res.headline}
                </Txt>,
              );
            }
          }
        }
        // Cursor last, on top.
        if (p.cursor) {
          const c = p.cursor;
          out.push(
            <g key="cur">
              <path d={`M${c.x} ${c.y} l${10 * px} ${4 * px} l${-4 * px} ${2 * px} l${-2 * px} ${4 * px} z`} fill={color} stroke="#fff" strokeWidth={1 * px} />
              <Txt x={c.x + 10 * px} y={c.y + 14 * px} fs={fs * 0.8} flip={flip} weight={700} fill={color} anchor="start">
                {peer.name}
              </Txt>
            </g>,
          );
        }
        return <g key={id}>{out}</g>;
      })}
    </g>
  );
}
