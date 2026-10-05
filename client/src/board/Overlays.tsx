// Measuring overlays drawn on the board: contacts, ruler, closest distance,
// range rings and pinned measurements. Everything is recomputed from the
// battle (with any move in progress applied), so read-outs stay live.

import { useId } from 'react';
import {
  boardContacts,
  closestBetween,
  dist,
  fmtIn,
  localToWorld,
  refName,
  type Battle,
  type EntityRef,
  type Measurement,
  type Vec,
} from '@conquest/shared';
import type { RingOptions } from '../store';
import { Txt } from './Shapes';

const RULER = '#111';
const DIST = '#6a1b9a';
const RING = '#00695c';
const CONTACT = '#ff8f00';

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Touching edges between pieces: thick orange stretches, dots for corner touches. */
export function ContactLayer({ b, px }: { b: Battle; px: number }) {
  const contacts = boardContacts(b);
  return (
    <g pointerEvents="none">
      {contacts.flatMap((c, i) =>
        c.parts.map((p, j) =>
          dist(p.a, p.b) < 1e-6 ? (
            <circle key={`${i}-${j}`} cx={p.a.x} cy={p.a.y} r={4 * px} fill={CONTACT} stroke="#000" strokeWidth={px} />
          ) : (
            <line key={`${i}-${j}`} x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} stroke={CONTACT} strokeWidth={5 * px} strokeLinecap="round" />
          ),
        ),
      )}
    </g>
  );
}

export function RulerLine({ a, b, fs, flip, px, pinned, color = RULER, tag }: { a: Vec; b: Vec; fs: number; flip: boolean; px: number; pinned?: boolean; color?: string; tag?: string }) {
  const m = mid(a, b);
  return (
    <g pointerEvents="none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#fff" strokeWidth={5 * px} strokeLinecap="round" />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={2 * px} strokeDasharray={pinned ? undefined : `${6 * px} ${3 * px}`} />
      <circle cx={a.x} cy={a.y} r={3.5 * px} fill={color} />
      <circle cx={b.x} cy={b.y} r={3.5 * px} fill={color} />
      <Txt x={m.x} y={m.y - fs * 0.9} fs={fs * 1.1} flip={flip} weight={800} fill={color}>
        {fmtIn(dist(a, b))}
        {pinned ? ' 📌' : ''}
        {tag ? ` · ${tag}` : ''}
      </Txt>
    </g>
  );
}

export function DistanceLine({
  b,
  a1,
  a2,
  fs,
  flip,
  px,
  pinned,
  color = DIST,
}: {
  b: Battle;
  a1: EntityRef;
  a2: EntityRef;
  fs: number;
  flip: boolean;
  px: number;
  pinned?: boolean;
  color?: string;
}) {
  const r = closestBetween(b, a1, a2);
  if (!r) return null;
  const m = mid(r.a, r.b);
  const zone = a1.kind === 'zone' || a2.kind === 'zone';
  const text = `${fmtIn(r.distance)}${zone ? (r.inside ? ' · inside zone' : ' · outside zone') : ''}${pinned ? ' 📌' : ''}`;
  return (
    <g pointerEvents="none">
      <line x1={r.a.x} y1={r.a.y} x2={r.b.x} y2={r.b.y} stroke="#fff" strokeWidth={5 * px} />
      <line x1={r.a.x} y1={r.a.y} x2={r.b.x} y2={r.b.y} stroke={color} strokeWidth={2 * px} strokeDasharray={`${5 * px} ${3 * px}`} />
      <circle cx={r.a.x} cy={r.a.y} r={3 * px} fill={color} />
      <circle cx={r.b.x} cy={r.b.y} r={3 * px} fill={color} />
      <Txt x={m.x} y={m.y - fs * 0.9} fs={fs * 1.05} flip={flip} weight={800} fill={color}>
        {text}
      </Txt>
      <Txt x={m.x} y={m.y + fs * 0.9} fs={fs * 0.8} flip={flip} fill={color}>
        {refName(b, a1)} ↔ {refName(b, a2)}
      </Txt>
    </g>
  );
}

/** Rectangles (in their own frames) whose rounded offset forms a range ring. */
function ringRects(b: Battle, ref: EntityRef): { pose: { x: number; y: number; angle: number }; u: number; v: number; w: number; d: number }[] {
  if (ref.kind === 'regiment') {
    const r = b.regiments.find((x) => x.id === ref.id);
    if (!r || r.location !== 'board' || r.garrisonId) return [];
    const slots = ref.standId ? r.stands.filter((s) => s.id === ref.standId).map((s) => s.slot) : [...r.stands.map((s) => s.slot), ...(r.characterId && r.characterSlot ? [r.characterSlot] : [])];
    return slots.map((s) => ({ pose: r, u: s.file * r.standW, v: s.rank * r.standD, w: r.standW, d: r.standD }));
  }
  if (ref.kind === 'character') {
    const c = b.characters.find((x) => x.id === ref.id);
    if (!c || c.location !== 'board' || c.attachedTo || c.x === undefined) return [];
    return [{ pose: { x: c.x, y: c.y ?? 0, angle: c.angle ?? 0 }, u: 0, v: 0, w: c.standW, d: c.standD }];
  }
  return [];
}

/**
 * A range ring: the true offset of the footprint by `radius` (every stand's
 * rectangle grown by the radius with rounded corners, merged). The outline is
 * drawn as the band between the offsets at radius and radius − 2 px, so the
 * merged shape needs no polygon union.
 */
export function RangeRing({ b, refr, radius, label, fs, flip, px }: { b: Battle; refr: EntityRef; radius: number; label: string; fs: number; flip: boolean; px: number }) {
  const id = useId().replace(/:/g, '');
  const rects = ringRects(b, refr);
  if (!rects.length || radius <= 0) return null;
  const shapes = (r: number) =>
    rects.map((q, i) => (
      <rect
        key={i}
        transform={`translate(${q.pose.x} ${q.pose.y}) rotate(${q.pose.angle})`}
        x={q.u - r}
        y={q.v - r}
        width={q.w + 2 * r}
        height={q.d + 2 * r}
        rx={Math.max(0, r)}
      />
    ));
  const band = 2 * px;
  // Label at the front: front centre of the first stand's frame, pushed out by the radius.
  const q = rects[0];
  const front = localToWorld(q.pose, (rects.reduce((m, x) => Math.min(m, x.u), Infinity) + rects.reduce((m, x) => Math.max(m, x.u + x.w), -Infinity)) / 2, -radius - fs * 0.6);
  return (
    <g pointerEvents="none">
      <defs>
        <mask id={`ring-${id}`} maskUnits="userSpaceOnUse" x={-1000} y={-1000} width={2000} height={2000}>
          <g fill="#fff">{shapes(radius)}</g>
          <g fill="#000">{shapes(radius - band)}</g>
        </mask>
      </defs>
      <g fill={RING} opacity={0.07}>
        {shapes(radius)}
      </g>
      <rect x={-1000} y={-1000} width={2000} height={2000} fill={RING} mask={`url(#ring-${id})`} />
      <Txt x={front.x} y={front.y} fs={fs * 0.95} flip={flip} weight={800} fill={RING}>
        {label} {fmtIn(radius)}
      </Txt>
    </g>
  );
}

/** Radii to draw for the ring options and the referenced piece. */
export function ringRadii(b: Battle, o: RingOptions): { radius: number; label: string }[] {
  if (!o.ref) return [];
  const reg = o.ref.kind === 'regiment' ? b.regiments.find((r) => r.id === o.ref!.id) : undefined;
  const out: { radius: number; label: string }[] = [];
  if (o.march && reg?.march) out.push({ radius: reg.march, label: 'March' });
  if (o.barrage && reg?.barrageRange) out.push({ radius: reg.barrageRange, label: 'Barrage' });
  if (o.halfBarrage && reg?.barrageRange) out.push({ radius: reg.barrageRange / 2, label: '½ Barrage' });
  if (o.custom && o.custom > 0) out.push({ radius: o.custom, label: 'Range' });
  return out;
}

export function PinnedMeasurement({ b, m, fs, flip, px }: { b: Battle; m: Measurement; fs: number; flip: boolean; px: number }) {
  if (m.kind === 'ruler') return <RulerLine a={m.a} b={m.b} fs={fs} flip={flip} px={px} pinned />;
  if (m.kind === 'distance') return <DistanceLine b={b} a1={m.a} a2={m.b} fs={fs} flip={flip} px={px} pinned />;
  return <RangeRing b={b} refr={m.ref} radius={m.radius} label={`📌 ${m.label}`} fs={fs} flip={flip} px={px} />;
}
