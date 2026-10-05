// Flat SVG shapes for everything on the board. All coordinates are inches.

import type { PointerEvent as RPointerEvent, ReactNode } from 'react';
import {
  localToWorld,
  OBJECTIVE_MARKER_SIDE,
  regimentLocalBox,
  terrainPolygon,
  type Battle,
  type Character,
  type FreeMarker,
  type ObjectiveMarker,
  type Regiment,
  type Terrain,
  type Zone,
} from '@conquest/shared';
import { GRID_STROKE, KEYWORD_PATTERN, NEUTRAL_TINT, SELECT_STROKE, seatColor, seatTag, terrainBaseFill, terrainTag, WARN_STROKE } from './theme';

export type DownHandler = (e: RPointerEvent<SVGElement>) => void;

export interface HoverHandlers {
  onPointerEnter?: (e: RPointerEvent<SVGElement>) => void;
  onPointerLeave?: (e: RPointerEvent<SVGElement>) => void;
}

const pts = (p: { x: number; y: number }[]) => p.map((q) => `${q.x},${q.y}`).join(' ');

/** Text that stays upright when the board view is flipped. */
export function Txt(props: {
  x: number;
  y: number;
  fs: number;
  flip: boolean;
  children: ReactNode;
  anchor?: 'start' | 'middle' | 'end';
  weight?: number;
  fill?: string;
  halo?: string;
  className?: string;
}) {
  const { x, y, fs, flip } = props;
  return (
    <text
      x={x}
      y={y}
      fontSize={fs}
      textAnchor={props.anchor ?? 'middle'}
      dominantBaseline="central"
      fontWeight={props.weight ?? 500}
      fill={props.fill ?? '#1d1b17'}
      stroke={props.halo ?? 'rgba(255,255,255,0.85)'}
      strokeWidth={fs * 0.18}
      paintOrder="stroke"
      transform={flip ? `rotate(180 ${x} ${y})` : undefined}
      className={props.className ?? 'svg-label'}
    >
      {props.children}
    </text>
  );
}

export function Defs() {
  return (
    <defs>
      <pattern id="pat-hatch" width="0.7" height="0.7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="0.7" stroke="rgba(30,40,20,0.45)" strokeWidth="0.08" />
      </pattern>
      <pattern id="pat-dots" width="0.6" height="0.6" patternUnits="userSpaceOnUse">
        <circle cx="0.3" cy="0.3" r="0.08" fill="rgba(30,30,30,0.5)" />
      </pattern>
      <pattern id="pat-cross" width="0.8" height="0.8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d="M0 0.4 H0.8 M0.4 0 V0.8" stroke="rgba(150,30,20,0.45)" strokeWidth="0.06" />
      </pattern>
      <pattern id="pat-perilous" width="0.5" height="0.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d="M0 0.25 H0.5 M0.25 0 V0.5" stroke="rgba(170,20,20,0.6)" strokeWidth="0.07" />
      </pattern>
      <pattern id="pat-dash" width="0.9" height="0.6" patternUnits="userSpaceOnUse">
        <path d="M0.1 0.15 h0.3 M0.5 0.45 h0.3" stroke="rgba(60,45,20,0.55)" strokeWidth="0.07" />
      </pattern>
      <pattern id="pat-waves" width="1.2" height="0.6" patternUnits="userSpaceOnUse">
        <path d="M0 0.3 q0.3 -0.2 0.6 0 t0.6 0" fill="none" stroke="rgba(20,70,120,0.45)" strokeWidth="0.06" />
      </pattern>
      <pattern id="pat-obscure" width="1.4" height="1.4" patternUnits="userSpaceOnUse">
        <circle cx="0.7" cy="0.7" r="0.35" fill="none" stroke="rgba(30,50,20,0.25)" strokeWidth="0.06" />
      </pattern>
      <pattern id="pat-noreinf" width="0.6" height="0.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="0.6" height="0.6" fill="#f3e9d2" />
        <line x1="0" y1="0" x2="0" y2="0.6" stroke="#9b3b2a" strokeWidth="0.18" />
      </pattern>
    </defs>
  );
}

export function BoardLayer({ b, fs, flip }: { b: Battle; fs: number; flip: boolean }) {
  const { width: W, depth: D, grid } = b.board;
  const lines: ReactNode[] = [];
  if (grid) {
    const major = grid === 12;
    for (let x = grid; x < W - 1e-6; x += grid) {
      const is12 = Math.abs(x % 12) < 1e-6;
      lines.push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={D} className={major || is12 ? 'grid-major' : 'grid-minor'} />);
    }
    for (let y = grid; y < D - 1e-6; y += grid) {
      const is12 = Math.abs(y % 12) < 1e-6;
      lines.push(<line key={`y${y}`} x1={0} y1={y} x2={W} y2={y} className={major || is12 ? 'grid-major' : 'grid-minor'} />);
    }
  }
  const strip = 2;
  return (
    <g>
      <rect x={0} y={0} width={W} height={D} className="board" />
      <g stroke={GRID_STROKE}>{lines}</g>
      {/* Reinforcement zones: Player 2 along the top long edge, Player 1 along the bottom. */}
      <rect x={0} y={-strip} width={W} height={strip} fill={b.players.p2.color} opacity={0.18} />
      <Txt x={W / 2} y={-strip / 2} fs={Math.min(fs, 1.4)} flip={flip} weight={600}>
        {b.players.p2.name} reinforcement zone (P2)
      </Txt>
      <rect x={0} y={D} width={W} height={strip} fill={b.players.p1.color} opacity={0.18} />
      <Txt x={W / 2} y={D + strip / 2} fs={Math.min(fs, 1.4)} flip={flip} weight={600}>
        {b.players.p1.name} reinforcement zone (P1)
      </Txt>
      {b.board.noReinforcement.map((e, i) => {
        const x = e.edge === 'left' ? -strip : W;
        const cx = x + strip / 2;
        const cy = (e.from + e.to) / 2;
        return (
          <g key={i}>
            <rect x={x} y={e.from} width={strip} height={e.to - e.from} fill="url(#pat-noreinf)" stroke="#9b3b2a" strokeWidth={0.06} />
            <g transform={`rotate(${e.edge === 'left' ? -90 : 90} ${cx} ${cy})`}>
              <Txt x={cx} y={cy} fs={Math.min(fs, 1.1)} flip={flip} weight={700} fill="#7a2416">
                No Reinforcement
              </Txt>
            </g>
          </g>
        );
      })}
      <rect x={0} y={0} width={W} height={D} className="board-edge" />
    </g>
  );
}

export function ZoneShape(props: {
  z: Zone;
  b: Battle;
  fs: number;
  flip: boolean;
  occupied: boolean;
  selected: boolean;
  offset?: { x: number; y: number };
  onDown: DownHandler;
  hover: HoverHandlers;
}) {
  const { z, b, fs, flip } = props;
  const x = z.x + (props.offset?.x ?? 0);
  const y = z.y + (props.offset?.y ?? 0);
  const tint = z.friendlyTo ? seatColor(b, z.friendlyTo) : NEUTRAL_TINT;
  const parts = [`${z.diameter}"`, z.label, seatTag(z.friendlyTo)].filter(Boolean).join(' · ');
  return (
    <g className="zone" onPointerDown={props.onDown} {...props.hover}>
      <circle
        cx={x}
        cy={y}
        r={z.diameter / 2}
        fill={tint}
        fillOpacity={props.occupied ? 0.5 : 0.3}
        stroke={props.selected ? SELECT_STROKE : props.occupied ? '#111' : tint}
        strokeWidth={props.selected || props.occupied ? 0.16 : 0.08}
        strokeDasharray={props.occupied && !props.selected ? '0.5 0.25' : undefined}
      />
      <Txt x={x} y={y + z.diameter / 2 - Math.min(fs, 1)} fs={Math.min(fs, 1)} flip={flip}>
        {parts}
      </Txt>
    </g>
  );
}

export function ObjectiveShape(props: {
  m: ObjectiveMarker;
  b: Battle;
  fs: number;
  flip: boolean;
  selected: boolean;
  warn?: boolean;
  offset?: { x: number; y: number };
  onDown: DownHandler;
  hover: HoverHandlers;
}) {
  const { m, b, fs, flip } = props;
  const s = OBJECTIVE_MARKER_SIDE;
  const x = m.x + (props.offset?.x ?? 0);
  const y = m.y + (props.offset?.y ?? 0);
  const tint = m.friendlyTo ? seatColor(b, m.friendlyTo) : NEUTRAL_TINT;
  const dmg = m.damageBy.p1 || m.damageBy.p2 ? `P1 ${m.damageBy.p1} · P2 ${m.damageBy.p2}` : '';
  const ready = m.damageBy.p1 >= m.woundsMax || m.damageBy.p2 >= m.woundsMax;
  return (
    <g className="objective" onPointerDown={props.onDown} {...props.hover}>
      <rect
        x={x - s / 2}
        y={y - s / 2}
        width={s}
        height={s}
        fill={tint}
        stroke={props.selected ? SELECT_STROKE : ready || props.warn ? WARN_STROKE : '#222'}
        strokeWidth={props.selected || ready || props.warn ? 0.16 : 0.08}
      />
      {m.label ? (
        <Txt x={x} y={y} fs={Math.min(s * 0.55, Math.max(fs, 0.8))} flip={flip} weight={800} fill="#fff" halo="rgba(0,0,0,0.6)">
          {m.label}
        </Txt>
      ) : (
        <circle cx={x} cy={y} r={0.28} fill="#222" />
      )}
      {dmg && (
        <Txt x={x} y={y + s / 2 + fs * 0.7} fs={fs * 0.85} flip={flip} weight={600} fill={ready ? '#900' : '#222'}>
          {dmg}
        </Txt>
      )}
    </g>
  );
}

export function TerrainShape(props: {
  t: Terrain;
  b: Battle;
  fs: number;
  flip: boolean;
  selected: boolean;
  warn: boolean;
  offset?: { x: number; y: number };
  onDown: DownHandler;
  hover: HoverHandlers;
}) {
  const { t, b, fs, flip } = props;
  const moved = props.offset ? { ...t, x: t.x + props.offset.x, y: t.y + props.offset.y } : t;
  const poly = pts(terrainPolygon(moved));
  const occupant = t.garrison?.occupiedBy ? b.regiments.find((r) => r.id === t.garrison!.occupiedBy) : undefined;
  const garrison = t.keywords.includes('Garrison');
  return (
    <g className="terrain" onPointerDown={props.onDown} {...props.hover}>
      <polygon points={poly} fill={terrainBaseFill(t)} fillOpacity={0.9} />
      {t.keywords.map((k) =>
        KEYWORD_PATTERN[k] ? <polygon key={k} points={poly} fill={`url(#${KEYWORD_PATTERN[k]})`} pointerEvents="none" /> : null,
      )}
      <polygon
        points={poly}
        fill="none"
        stroke={props.selected ? SELECT_STROKE : props.warn ? '#c0392b' : '#4d4535'}
        strokeWidth={props.selected ? 0.16 : garrison ? 0.2 : 0.08}
        strokeDasharray={t.locked ? undefined : undefined}
      />
      {garrison && <polygon points={poly} fill="none" stroke="#f6f0e2" strokeWidth={0.06} pointerEvents="none" />}
      <Txt x={moved.x} y={moved.y} fs={fs * 0.85} flip={flip} weight={600}>
        {terrainTag(t)}
        {t.locked ? ' 🔒' : ''}
      </Txt>
      {occupant && (
        <Txt x={moved.x} y={moved.y + fs * 1.1} fs={fs * 0.85} flip={flip} weight={700} fill={seatColor(b, occupant.owner)}>
          {occupant.name} ({occupant.stands.length})
        </Txt>
      )}
    </g>
  );
}

function standText(s: { isCommand: boolean; wounds: number; woundsMax: number }) {
  const parts: string[] = [];
  if (s.isCommand) parts.push('C');
  if (s.wounds > 0) parts.push(`${s.wounds}/${s.woundsMax}`);
  return parts.join(' ');
}

export function RegimentShape(props: {
  reg: Regiment;
  b: Battle;
  fs: number;
  flip: boolean;
  selected: boolean;
  warn?: boolean;
  offset?: { x: number; y: number };
  onDown: DownHandler;
  hover: HoverHandlers;
}) {
  const { b, fs, flip } = props;
  const reg = props.offset ? { ...props.reg, x: props.reg.x + props.offset.x, y: props.reg.y + props.offset.y } : props.reg;
  const W = reg.standW;
  const D = reg.standD;
  const color = seatColor(b, reg.owner);
  const box = regimentLocalBox(reg);
  const mid = (box.u0 + box.u1) / 2;
  const ch = reg.characterId ? b.characters.find((c) => c.id === reg.characterId) : undefined;
  const sfs = Math.min(fs * 0.9, W * 0.3, D * 0.3);
  const tagPos = localToWorld(reg, mid, -0.75 - fs * 0.7);
  const label = `${seatTag(reg.owner)} · ${reg.name} (${reg.stands.length})${reg.tags.length ? ` · ${reg.tags.join(', ')}` : ''}`;
  return (
    <g className="regiment" onPointerDown={props.onDown} {...props.hover}>
      <g transform={`translate(${reg.x} ${reg.y}) rotate(${reg.angle})`}>
        {reg.stands.map((s) => {
          const dead = s.wounds >= s.woundsMax;
          return (
            <rect
              key={s.id}
              data-stand-id={s.id}
              x={s.slot.file * W}
              y={s.slot.rank * D}
              width={W}
              height={D}
              fill={color}
              fillOpacity={dead ? 0.35 : 0.88}
              stroke="#fff"
              strokeWidth={0.05}
            />
          );
        })}
        {ch && reg.characterSlot && (
          <rect
            x={reg.characterSlot.file * W + 0.08}
            y={reg.characterSlot.rank * D + 0.08}
            width={W - 0.16}
            height={D - 0.16}
            fill={color}
            fillOpacity={0.88}
            stroke="#ffd34d"
            strokeWidth={0.16}
          />
        )}
        {/* Thick front edge and chevron make facing obvious at any zoom. */}
        <line x1={box.u0} y1={0} x2={box.u1} y2={0} stroke="#111" strokeWidth={0.2} strokeLinecap="square" />
        <polygon points={`${mid - 0.4},-0.1 ${mid},-0.6 ${mid + 0.4},-0.1`} fill="#111" />
        {props.selected && (
          <rect x={box.u0 - 0.12} y={-0.12} width={box.u1 - box.u0 + 0.24} height={box.v1 + 0.24} fill="none" stroke={SELECT_STROKE} strokeWidth={0.12} strokeDasharray="0.4 0.2" />
        )}
        {props.warn && <rect x={box.u0 - 0.25} y={-0.25} width={box.u1 - box.u0 + 0.5} height={box.v1 + 0.5} fill="none" stroke={WARN_STROKE} strokeWidth={0.12} />}
      </g>
      {reg.stands.map((s) => {
        const t = standText(s);
        if (!t && s.wounds < s.woundsMax) return null;
        const c = localToWorld(reg, (s.slot.file + 0.5) * W, (s.slot.rank + 0.5) * D);
        return (
          <Txt key={s.id} x={c.x} y={c.y} fs={sfs} flip={flip} weight={700} fill="#fff" halo="rgba(0,0,0,0.55)">
            {s.wounds >= s.woundsMax ? `✕ ${t}` : t}
          </Txt>
        );
      })}
      {ch && reg.characterSlot && (() => {
        const c = localToWorld(reg, (reg.characterSlot.file + 0.5) * W, (reg.characterSlot.rank + 0.5) * D);
        return (
          <Txt x={c.x} y={c.y} fs={sfs * 0.85} flip={flip} weight={700} fill="#fff" halo="rgba(0,0,0,0.6)">
            {ch.name.slice(0, 10)}
            {ch.wounds ? ` ${ch.wounds}/${ch.woundsMax}` : ''}
          </Txt>
        );
      })()}
      {ch && ch.rider && (() => {
        const c = localToWorld(reg, mid, box.v1 / 2 + sfs);
        return (
          <Txt x={c.x} y={c.y} fs={sfs * 0.8} flip={flip} weight={700} fill="#ffd34d" halo="rgba(0,0,0,0.7)">
            ★ {ch.name} {ch.wounds}/{ch.woundsMax}
          </Txt>
        );
      })()}
      <Txt x={tagPos.x} y={tagPos.y} fs={fs} flip={flip} weight={700} fill={color}>
        {label}
      </Txt>
    </g>
  );
}

export function CharacterShape(props: {
  ch: Character;
  b: Battle;
  fs: number;
  flip: boolean;
  selected: boolean;
  warn?: boolean;
  offset?: { x: number; y: number };
  onDown: DownHandler;
  hover: HoverHandlers;
}) {
  const { b, fs, flip } = props;
  const ch = props.ch;
  if (ch.x === undefined || ch.y === undefined) return null;
  const pose = { x: ch.x + (props.offset?.x ?? 0), y: ch.y + (props.offset?.y ?? 0), angle: ch.angle ?? 0 };
  const W = ch.standW;
  const D = ch.standD;
  const color = seatColor(b, ch.owner);
  const tag = localToWorld(pose, W / 2, -0.75 - fs * 0.7);
  const c = localToWorld(pose, W / 2, D / 2);
  return (
    <g className="character" onPointerDown={props.onDown} {...props.hover}>
      <g transform={`translate(${pose.x} ${pose.y}) rotate(${pose.angle})`}>
        <rect x={0} y={0} width={W} height={D} fill={color} fillOpacity={0.88} stroke="#ffd34d" strokeWidth={0.16} />
        <rect x={0.2} y={0.2} width={W - 0.4} height={D - 0.4} fill="none" stroke="#ffd34d" strokeWidth={0.05} />
        <line x1={0} y1={0} x2={W} y2={0} stroke="#111" strokeWidth={0.2} />
        <polygon points={`${W / 2 - 0.35},-0.1 ${W / 2},-0.55 ${W / 2 + 0.35},-0.1`} fill="#111" />
        {props.selected && (
          <rect x={-0.12} y={-0.12} width={W + 0.24} height={D + 0.24} fill="none" stroke={SELECT_STROKE} strokeWidth={0.12} strokeDasharray="0.4 0.2" />
        )}
        {props.warn && <rect x={-0.25} y={-0.25} width={W + 0.5} height={D + 0.5} fill="none" stroke={WARN_STROKE} strokeWidth={0.12} />}
      </g>
      {ch.wounds > 0 && (
        <Txt x={c.x} y={c.y} fs={Math.min(fs, W * 0.3)} flip={flip} weight={700} fill="#fff" halo="rgba(0,0,0,0.55)">
          {ch.wounds}/{ch.woundsMax}
        </Txt>
      )}
      <Txt x={tag.x} y={tag.y} fs={fs} flip={flip} weight={700} fill={color}>
        ★ {seatTag(ch.owner)} · {ch.name}
      </Txt>
    </g>
  );
}

export function FreeMarkerShape(props: {
  m: FreeMarker;
  fs: number;
  flip: boolean;
  selected: boolean;
  offset?: { x: number; y: number };
  onDown: DownHandler;
}) {
  const x = props.m.x + (props.offset?.x ?? 0);
  const y = props.m.y + (props.offset?.y ?? 0);
  return (
    <g className="free-marker" onPointerDown={props.onDown}>
      <path d={`M${x} ${y} l-0.35 -0.7 h0.7 z`} fill="#333" stroke={props.selected ? SELECT_STROKE : '#fff'} strokeWidth={0.06} />
      <Txt x={x} y={y - 0.7 - props.fs * 0.6} fs={props.fs * 0.85} flip={props.flip}>
        {props.m.label}
      </Txt>
    </g>
  );
}
