// The battlefield: an SVG whose viewBox is in inches. Handles zoom (wheel,
// around the cursor), pan (drag empty space, Space+drag or middle button),
// selection, move sessions (body drag and handles), terrain vertex editing /
// rotation, the measuring tools, drawing terrain and dropping reserve units.
//
// Everything is drawn from the battle with the move in progress applied, so
// contacts, distances and rings follow the moving piece live.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import {
  boxCentre,
  centroid,
  dist,
  dot,
  dragAngle,
  fmtIn,
  facingVec,
  forwardSegment,
  freeSegment,
  localToWorld,
  makeId,
  moveWarnings,
  nearestAlignTarget,
  normAngle,
  pieceAt,
  regimentStandGeoms,
  rightVec,
  rotateSegment,
  sidewaysSegment,
  wheelSegment,
  characterPolygon,
  objectiveMarkerPolygon,
  type AlignTarget,
  type Facing,
  type MovingPiece,
  type Pose,
  occupiedZoneIds,
  OBJECTIVE_MARKER_SIDE,
  OBJECTIVE_MARKER_WOUNDS,
  placePolygon,
  pointInPolygon,
  radToDeg,
  regimentLocalBox,
  regimentPolygons,
  terrainExtent,
  terrainPolygon,
  totalDamage,
  type Battle,
  type Terrain,
  type Vec,
} from '@conquest/shared';
import { sessionPose, useStore, withSession, type Selection } from '../store';
import { movableFromSelection, refFromSelection } from '../moveActions';
import { AlignPreview, Ghost, MoveHandles, type HandleKind } from './MoveOverlay';
import { ContactLayer, DistanceLine, PinnedMeasurement, RangeRing, ringRadii, RulerLine } from './Overlays';
import { BoardLayer, CharacterShape, Defs, FreeMarkerShape, ObjectiveShape, RegimentShape, TerrainShape, Txt, ZoneShape } from './Shapes';
import { labelSize, poseCentredAt, SELECT_STROKE, seatFacing } from './theme';

type Drag =
  | { type: 'pan'; sx: number; sy: number; cx: number; cy: number; moved: boolean }
  | { type: 'entity'; sel: Selection; start: Vec; cur: Vec; moved: boolean; locked: boolean }
  /** Body drag of a regiment or character: a free move segment (Shift: along the facing). */
  | { type: 'piece'; piece: MovingPiece; start: Vec; base: Pose; moved: boolean }
  | { type: 'handle'; kind: HandleKind; start: Vec; base: Pose }
  | { type: 'vertex'; terrainId: string; index: number; cur: Vec }
  | { type: 'rotate'; terrainId: string; angle: number }
  | { type: 'ruler' };

const DRAG_THRESHOLD_PX = 4;

export function Board() {
  const battle = useStore((s) => s.battle);
  const view = useStore((s) => s.view);
  const viewport = useStore((s) => s.viewport);
  const flip = useStore((s) => s.flip);
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const session = useStore((s) => s.moveSession);
  const measure = useStore((s) => s.measure);
  const { select, setView, setViewport, dispatch, setTool, notify } = useStore.getState();
  const [alignHover, setAlignHover] = useState<{ target: AlignTarget; facing: Facing } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<Vec[]>([]);
  const [pointer, setPointer] = useState<Vec | null>(null);
  const [hover, setHover] = useState<{ sel: Selection; cx: number; cy: number } | null>(null);
  const space = useRef(false);

  const W = battle.board.width;
  const D = battle.board.depth;
  const fs = labelSize(view.scale);

  // --- viewport size -------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [setViewport]);

  const vbW = viewport.w / view.scale;
  const vbH = viewport.h / view.scale;
  const viewBox = `${view.cx - vbW / 2} ${view.cy - vbH / 2} ${vbW} ${vbH}`;

  /** Client pixel → board inches (undoing the flip). */
  const toBoard = useCallback(
    (clientX: number, clientY: number): Vec => {
      const r = svgRef.current!.getBoundingClientRect();
      const ox = view.cx + (clientX - r.left - r.width / 2) / view.scale;
      const oy = view.cy + (clientY - r.top - r.height / 2) / view.scale;
      return flip ? { x: W - ox, y: D - oy } : { x: ox, y: oy };
    },
    [view, flip, W, D],
  );

  // --- zoom around the cursor ------------------------------------------------
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { view: v } = useStore.getState();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left - r.width / 2;
      const my = e.clientY - r.top - r.height / 2;
      const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      const scale = Math.max(3, Math.min(200, v.scale * k));
      // Keep the point under the cursor fixed.
      const px = v.cx + mx / v.scale;
      const py = v.cy + my / v.scale;
      setView({ scale, cx: px - mx / scale, cy: py - my / scale });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setView]);

  // --- keyboard ----------------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.code === 'Space') {
        space.current = true;
        e.preventDefault();
      }
      if (tool === 'drawTerrain') {
        if (e.key === 'Enter') finishDraft();
        if (e.key === 'Escape') {
          setDraft([]);
          setTool('select');
        }
        if (e.key === 'Backspace') setDraft((d) => d.slice(0, -1));
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  const finishDraft = () => {
    if (draft.length < 3) {
      notify('A terrain piece needs at least 3 points');
      return;
    }
    const c = centroid(draft);
    const t: Terrain = {
      id: makeId(),
      name: 'Terrain',
      shape: { kind: 'polygon', points: draft.map((p) => [round2(p.x - c.x), round2(p.y - c.y)] as [number, number]) },
      x: round2(c.x),
      y: round2(c.y),
      angle: 0,
      size: 0,
      keywords: [],
      locked: false,
    };
    if (dispatch({ type: 'addTerrain', terrain: t })) select({ kind: 'terrain', id: t.id });
    setDraft([]);
    setTool('select');
  };

  // --- derived ----------------------------------------------------------------
  // The battle as drawn: with the move in progress applied.
  const eff = useMemo(() => withSession(battle, session), [battle, session]);
  const occupied = useMemo(() => occupiedZoneIds(eff), [eff]);
  const moving = session ? pieceAt(battle, session.piece, sessionPose(session)) : null;
  const moveWarns = useMemo(
    () => (session ? moveWarnings(battle, session.piece, sessionPose(session), [...session.segments, ...(session.live ? [session.live] : [])]) : []),
    [battle, session],
  );
  const highlight = useStore((s) => s.highlight);
  const warnIds = useMemo(() => new Set([...highlight, ...moveWarns.flatMap((w) => w.ids)]), [highlight, moveWarns]);
  const snapPoints = useMemo(() => (tool === 'ruler' ? collectSnapPoints(eff) : []), [eff, tool]);
  const px = 1 / view.scale; // one screen pixel in inches
  const snap = (p: Vec): Vec => {
    let best = p;
    let bd = 10 * px;
    for (const q of snapPoints) {
      const d = dist(p, q);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  };

  const offsetFor = (sel: Selection) =>
    drag?.type === 'entity' && drag.moved && !drag.locked && drag.sel.kind === sel.kind && drag.sel.id === sel.id
      ? { x: drag.cur.x - drag.start.x, y: drag.cur.y - drag.start.y }
      : undefined;
  const isSel = (kind: Selection['kind'], id: string) => selection?.kind === kind && selection.id === id;

  // --- pointer handling --------------------------------------------------------
  const capture = (e: RPointerEvent) => svgRef.current?.setPointerCapture(e.pointerId);

  const isLocked = (sel: Selection): boolean => {
    const b = battle;
    switch (sel.kind) {
      case 'terrain':
        return !!b.terrain.find((t) => t.id === sel.id)?.locked;
      case 'zone':
        return !!b.zones.find((z) => z.id === sel.id)?.locked;
      case 'objective':
        return !!b.objectiveMarkers.find((m) => m.id === sel.id)?.locked;
      default:
        return false;
    }
  };

  /** Enemy regiment or objective marker facing near the pointer while picking an Align target. */
  const findAlignTarget = (p: Vec) => (session && moving ? nearestAlignTarget(battle, p, moving.owner) : null);

  const onEntityDown = (sel: Selection) => (e: RPointerEvent<SVGElement>) => {
    if (e.button !== 0 || space.current) return;
    const p = toBoard(e.clientX, e.clientY);
    if (session?.aligning) {
      e.stopPropagation();
      const t = findAlignTarget(p);
      if (t) useStore.getState().setAlign({ ...t, mode: 'contact' });
      else notify('Click a side of an enemy regiment or an objective marker');
      return;
    }
    if (tool === 'distance') {
      const ref = refFromSelection(sel);
      if (!ref) return;
      e.stopPropagation();
      const pair = [...measure.pair, ref].slice(-2);
      useStore.getState().setMeasure({ pair });
      return;
    }
    if (tool === 'ring') {
      if (sel.kind !== 'regiment' && sel.kind !== 'character') return;
      e.stopPropagation();
      const standId = e.altKey ? (e.target as SVGElement).getAttribute('data-stand-id') ?? undefined : undefined;
      useStore.getState().setRing({ ref: { kind: sel.kind, id: sel.id, ...(standId ? { standId } : {}) } });
      return;
    }
    if (tool !== 'select') return;
    e.stopPropagation();
    // Ctrl-click: closest distance between the selection and this.
    if (e.ctrlKey || e.metaKey) {
      const a = refFromSelection(selection);
      const b = refFromSelection(sel);
      if (a && b && a.id !== b.id) useStore.getState().setMeasure({ pair: [a, b] });
      return;
    }
    const piece = movableFromSelection(sel);
    if (piece) {
      if (session && session.piece.id !== piece.id) useStore.getState().commitMove();
      select(sel);
      const cur = useStore.getState().moveSession;
      const base = cur ? sessionPose({ ...cur, live: null }) : piecePose(battle, piece);
      if (!base) return;
      capture(e);
      setDrag({ type: 'piece', piece, start: p, base, moved: false });
      return;
    }
    if (session) useStore.getState().commitMove();
    select(sel);
    capture(e);
    setDrag({ type: 'entity', sel, start: p, cur: p, moved: false, locked: isLocked(sel) });
  };

  const onHandleDown = (kind: HandleKind, e: RPointerEvent<SVGElement>) => {
    if (e.button !== 0 || !session) return;
    e.stopPropagation();
    capture(e);
    setDrag({ type: 'handle', kind, start: toBoard(e.clientX, e.clientY), base: sessionPose({ ...session, live: null }) });
  };

  const hoverFor = (sel: Selection) => ({
    onPointerEnter: (e: RPointerEvent<SVGElement>) => setHover({ sel, cx: e.clientX, cy: e.clientY }),
    onPointerLeave: () => setHover((h) => (h && h.sel.id === sel.id ? null : h)),
  });

  const onBackgroundDown = (e: RPointerEvent<SVGSVGElement>) => {
    const p = toBoard(e.clientX, e.clientY);
    if (e.button === 0 && session?.aligning && !space.current) {
      const t = findAlignTarget(p);
      if (t) useStore.getState().setAlign({ ...t, mode: 'contact' });
      return;
    }
    if (e.button === 0 && tool === 'ruler' && !space.current) {
      const a = e.altKey ? p : snap(p);
      useStore.getState().setMeasure({ ruler: { a, b: a } });
      capture(e);
      setDrag({ type: 'ruler' });
      return;
    }
    if (e.button === 1 || space.current || (e.button === 0 && (tool === 'select' || tool === 'distance' || tool === 'ring'))) {
      capture(e);
      setDrag({ type: 'pan', sx: e.clientX, sy: e.clientY, cx: view.cx, cy: view.cy, moved: false });
      return;
    }
    if (e.button !== 0) return;
    if (tool === 'drawTerrain') {
      if (e.detail >= 2) finishDraft();
      else setDraft((d) => [...d, { x: round2(p.x), y: round2(p.y) }]);
    } else if (tool === 'placeZone') {
      const id = makeId();
      if (dispatch({ type: 'addZone', zone: { id, x: round2(p.x), y: round2(p.y), diameter: 6, locked: false } })) select({ kind: 'zone', id });
      setTool('select');
    } else if (tool === 'placeObjective') {
      const id = makeId();
      const ok = dispatch({
        type: 'addObjectiveMarker',
        marker: { id, x: round2(p.x), y: round2(p.y), woundsMax: OBJECTIVE_MARKER_WOUNDS, damageBy: { p1: 0, p2: 0 }, destroyed: false, locked: false },
      });
      if (ok) select({ kind: 'objective', id });
      setTool('select');
    }
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const p = toBoard(e.clientX, e.clientY);
    setPointer(p);
    if (hover) setHover({ ...hover, cx: e.clientX, cy: e.clientY });
    if (session?.aligning) setAlignHover(findAlignTarget(p));
    else if (alignHover) setAlignHover(null);
    if (!drag) return;
    if (drag.type === 'ruler') {
      const r = useStore.getState().measure.ruler;
      if (r) useStore.getState().setMeasure({ ruler: { a: r.a, b: e.altKey ? p : snap(p) } });
      return;
    }
    if (drag.type === 'piece') {
      const movedPx = Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * view.scale;
      if (!drag.moved && movedPx <= DRAG_THRESHOLD_PX) return;
      const st = useStore.getState();
      if (!st.moveSession && !st.startMove(drag.piece)) {
        setDrag(null);
        return;
      }
      const box = pieceAt(battle, drag.piece, drag.base)?.box;
      if (!box) return;
      const delta = { x: p.x - drag.start.x, y: p.y - drag.start.y };
      const seg = e.shiftKey
        ? forwardSegment(drag.base, dot(delta, facingVec(drag.base.angle)))
        : freeSegment(drag.base, { x: drag.base.x + delta.x, y: drag.base.y + delta.y, angle: drag.base.angle }, box);
      st.setLive(seg);
      if (!drag.moved) setDrag({ ...drag, moved: true });
      return;
    }
    if (drag.type === 'handle') {
      const st = useStore.getState();
      const m = st.moveSession;
      if (!m) return;
      const box = pieceAt(battle, m.piece, drag.base)?.box;
      if (!box) return;
      const delta = { x: p.x - drag.start.x, y: p.y - drag.start.y };
      const b0 = drag.base;
      let seg;
      if (drag.kind === 'forward') seg = forwardSegment(b0, dot(delta, facingVec(b0.angle)));
      else if (drag.kind === 'sideways') seg = sidewaysSegment(b0, dot(delta, rightVec(b0.angle)));
      else if (drag.kind === 'rotate') {
        let a = dragAngle(boxCentre(b0, box), drag.start, p);
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        seg = rotateSegment(b0, box, a);
      } else {
        // Dragging the left corner pivots on the right one, and vice versa.
        const pivot = drag.kind === 'wheel-left' ? 'right' : 'left';
        const pivotPt = localToWorld(b0, pivot === 'left' ? box.u0 : box.u1, 0);
        const corner = localToWorld(b0, pivot === 'left' ? box.u1 : box.u0, 0);
        let a = dragAngle(pivotPt, corner, p);
        if (e.shiftKey) a = Math.round(a / 5) * 5;
        seg = wheelSegment(b0, box, a, pivot);
      }
      st.setLive(seg);
      return;
    }
    if (drag.type === 'pan') {
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      const moved = drag.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
      if (moved) setView({ cx: drag.cx - dx / view.scale, cy: drag.cy - dy / view.scale });
      if (moved !== drag.moved) setDrag({ ...drag, moved });
    } else if (drag.type === 'entity') {
      const px = Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * view.scale;
      setDrag({ ...drag, cur: p, moved: drag.moved || px > DRAG_THRESHOLD_PX });
    } else if (drag.type === 'vertex') {
      setDrag({ ...drag, cur: p });
    } else if (drag.type === 'rotate') {
      const t = battle.terrain.find((x) => x.id === drag.terrainId);
      if (!t) return;
      let a = radToDeg(Math.atan2(p.y - t.y, p.x - t.x)) + 90;
      a = e.shiftKey ? Math.round(a / 15) * 15 : Math.round(a);
      setDrag({ ...drag, angle: normAngle(a) });
    }
  };

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.type === 'ruler') return;
    if (d.type === 'pan') {
      if (!d.moved && tool === 'select' && !session) select(null);
      return;
    }
    if (d.type === 'handle' || d.type === 'piece') {
      const st = useStore.getState();
      const live = st.moveSession?.live;
      if (d.type === 'piece' && d.piece.kind === 'character' && d.moved) {
        // Dropping a character on a friendly regiment joins it instead of moving.
        const c = battle.characters.find((x) => x.id === d.piece.id)!;
        const p = toBoard(e.clientX, e.clientY);
        const target = battle.regiments.find(
          (r) => r.location === 'board' && !r.garrisonId && r.owner === c.owner && regimentPolygons(r).some((poly) => pointInPolygon(p, poly)),
        );
        if (target) {
          st.setLive(null);
          st.commitMove();
          if (target.standType !== c.standType && !c.rider) notify(`Stand types differ (${c.standType} / ${target.standType}) — joined anyway`);
          dispatch({ type: 'attachCharacter', characterId: c.id, regimentId: target.id });
          return;
        }
      }
      if (live && (live.distance > 1e-6 || Math.abs(live.value) > 1e-6)) st.addSegment(live);
      else st.setLive(null);
      return;
    }
    if (d.type === 'vertex') {
      const t = battle.terrain.find((x) => x.id === d.terrainId);
      if (!t || t.shape.kind !== 'polygon') return;
      const pts = t.shape.points.slice();
      pts[d.index] = toLocal(t, d.cur);
      dispatch({ type: 'updateTerrain', id: t.id, patch: { shape: { kind: 'polygon', points: pts } } });
      return;
    }
    if (d.type === 'rotate') {
      dispatch({ type: 'updateTerrain', id: d.terrainId, patch: { angle: d.angle } });
      return;
    }
    if (!d.moved) return;
    if (d.locked) {
      notify('Locked: it cannot be moved');
      return;
    }
    const dx = d.cur.x - d.start.x;
    const dy = d.cur.y - d.start.y;
    const sel = d.sel;
    const r2 = (n: number) => Math.round(n * 1000) / 1000;
    switch (sel.kind) {
      case 'terrain': {
        const t = battle.terrain.find((x) => x.id === sel.id)!;
        dispatch({ type: 'updateTerrain', id: t.id, patch: { x: r2(t.x + dx), y: r2(t.y + dy) } });
        break;
      }
      case 'zone': {
        const z = battle.zones.find((x) => x.id === sel.id)!;
        dispatch({ type: 'updateZone', id: z.id, patch: { x: r2(z.x + dx), y: r2(z.y + dy) } });
        break;
      }
      case 'objective': {
        const m = battle.objectiveMarkers.find((x) => x.id === sel.id)!;
        dispatch({ type: 'updateObjectiveMarker', id: m.id, patch: { x: r2(m.x + dx), y: r2(m.y + dy) } });
        break;
      }
      case 'marker': {
        const m = battle.markers.find((x) => x.id === sel.id)!;
        dispatch({ type: 'updateMarker', id: m.id, patch: { x: r2(m.x + dx), y: r2(m.y + dy) } });
        break;
      }
    }
  };

  // --- drop from roster ----------------------------------------------------------
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData('application/x-conquest');
    if (!raw) return;
    e.preventDefault();
    const { kind, id } = JSON.parse(raw) as { kind: 'regiment' | 'character'; id: string };
    const p = toBoard(e.clientX, e.clientY);
    if (kind === 'regiment') {
      const r = battle.regiments.find((x) => x.id === id);
      if (!r) return;
      const box = regimentLocalBox(r);
      const pose = poseCentredAt(box.u1, box.v1, seatFacing(r.owner), p);
      if (dispatch({ type: 'setRegimentLocation', id, location: 'board', pose: roundPose(pose) })) select({ kind: 'regiment', id });
    } else {
      const c = battle.characters.find((x) => x.id === id);
      if (!c) return;
      const target = battle.regiments.find(
        (r) => r.location === 'board' && !r.garrisonId && r.owner === c.owner && regimentPolygons(r).some((poly) => pointInPolygon(p, poly)),
      );
      if (target) {
        dispatch({ type: 'attachCharacter', characterId: id, regimentId: target.id });
        return;
      }
      const pose = poseCentredAt(c.standW, c.standD, seatFacing(c.owner), p);
      if (dispatch({ type: 'setCharacterLocation', id, location: 'board', pose: roundPose(pose) })) select({ kind: 'character', id });
    }
  };

  // --- selection handles ------------------------------------------------------------
  const selTerrain = selection?.kind === 'terrain' ? battle.terrain.find((t) => t.id === selection.id) : undefined;
  const handleR = 7 / view.scale;

  const terrainForRender = (t: Terrain): Terrain => {
    if (drag?.type === 'vertex' && drag.terrainId === t.id && t.shape.kind === 'polygon') {
      const pts = t.shape.points.slice();
      pts[drag.index] = toLocal(t, drag.cur);
      return { ...t, shape: { kind: 'polygon', points: pts } };
    }
    if (drag?.type === 'rotate' && drag.terrainId === t.id) return { ...t, angle: drag.angle };
    return t;
  };

  const handles = (() => {
    if (!selTerrain || selTerrain.locked || tool !== 'select') return null;
    const t = terrainForRender(selTerrain);
    const ext = terrainExtent(t);
    const knob = placePolygon([[0, -(Math.max(ext.d, ext.w) / 2 + 1.2)]], t.x, t.y, t.angle)[0];
    const out: React.ReactNode[] = [
      <line key="rl" x1={t.x} y1={t.y} x2={knob.x} y2={knob.y} stroke={SELECT_STROKE} strokeWidth={0.06} strokeDasharray="0.2 0.15" />,
      <circle
        key="rot"
        className="handle rotate"
        cx={knob.x}
        cy={knob.y}
        r={handleR * 1.2}
        onPointerDown={(e) => {
          e.stopPropagation();
          capture(e);
          setDrag({ type: 'rotate', terrainId: t.id, angle: t.angle });
        }}
      >
        <title>Drag to rotate (Shift: 15° steps)</title>
      </circle>,
    ];
    if (t.shape.kind === 'polygon') {
      const world = terrainPolygon(t);
      const n = world.length;
      world.forEach((p, i) => {
        const q = world[(i + 1) % n];
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        out.push(
          <rect
            key={`m${i}`}
            className="handle mid"
            x={mid.x - handleR * 0.7}
            y={mid.y - handleR * 0.7}
            width={handleR * 1.4}
            height={handleR * 1.4}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (t.shape.kind !== 'polygon') return;
              const pts = t.shape.points.slice();
              pts.splice(i + 1, 0, toLocal(t, mid));
              dispatch({ type: 'updateTerrain', id: t.id, patch: { shape: { kind: 'polygon', points: pts } } });
            }}
          >
            <title>Click to add a vertex</title>
          </rect>,
        );
        out.push(
          <circle
            key={`v${i}`}
            className="handle vertex"
            cx={p.x}
            cy={p.y}
            r={handleR}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (t.shape.kind !== 'polygon') return;
              if (e.altKey || e.button === 2) {
                if (t.shape.points.length <= 3) return notify('A polygon needs at least 3 points');
                const pts = t.shape.points.filter((_, j) => j !== i);
                dispatch({ type: 'updateTerrain', id: t.id, patch: { shape: { kind: 'polygon', points: pts } } });
                return;
              }
              capture(e);
              setDrag({ type: 'vertex', terrainId: t.id, index: i, cur: p });
            }}
          >
            <title>Drag to move · Alt-click or right-click to delete</title>
          </circle>,
        );
      });
    }
    return out;
  })();

  // --- drag read-outs ------------------------------------------------------------
  const readout = (() => {
    if (drag?.type === 'entity' && drag.moved && !drag.locked) {
      return (
        <Txt x={drag.cur.x} y={drag.cur.y - fs * 1.5} fs={fs * 1.1} flip={flip} weight={800} fill="#000">
          {fmtIn(dist(drag.start, drag.cur))}
        </Txt>
      );
    }
    const live = session?.live;
    if (live && pointer) {
      return (
        <Txt x={pointer.x} y={pointer.y - fs * 1.6} fs={fs * 1.1} flip={flip} weight={800} fill="#000">
          {live.label}
        </Txt>
      );
    }
    return null;
  })();

  const rings = tool === 'ring' && measure.ring.ref ? ringRadii(eff, measure.ring) : [];
  const movingWarn = moveWarns.length > 0;

  const cursor =
    session?.aligning ? (alignHover ? 'pointer' : 'crosshair') : tool === 'select' ? (drag?.type === 'pan' && drag.moved ? 'grabbing' : 'default') : 'crosshair';

  return (
    <div
      ref={wrapRef}
      className="board-wrap"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-conquest')) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      <svg
        ref={svgRef}
        className="board-svg"
        viewBox={viewBox}
        style={{ cursor }}
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setPointer(null)}
        onContextMenu={(e) => tool !== 'select' && e.preventDefault()}
      >
        <Defs />
        <g transform={flip ? `rotate(180 ${W / 2} ${D / 2})` : undefined}>
          <BoardLayer b={battle} fs={fs} flip={flip} />
          {battle.zones.map((z) => {
            const sel = { kind: 'zone' as const, id: z.id };
            return (
              <ZoneShape key={z.id} z={z} b={battle} fs={fs} flip={flip} occupied={occupied.has(z.id)} selected={isSel('zone', z.id)} offset={offsetFor(sel)} onDown={onEntityDown(sel)} hover={hoverFor(sel)} />
            );
          })}
          {battle.terrain.map((t0) => {
            const t = terrainForRender(t0);
            const sel = { kind: 'terrain' as const, id: t.id };
            return (
              <TerrainShape key={t.id} t={t} b={battle} fs={fs} flip={flip} selected={isSel('terrain', t.id)} warn={warnIds.has(t.id)} offset={offsetFor(sel)} onDown={onEntityDown(sel)} hover={hoverFor(sel)} />
            );
          })}
          {battle.objectiveMarkers
            .filter((m) => !m.destroyed)
            .map((m) => {
              const sel = { kind: 'objective' as const, id: m.id };
              return (
                <ObjectiveShape key={m.id} m={m} b={battle} fs={fs} flip={flip} selected={isSel('objective', m.id)} warn={warnIds.has(m.id)} offset={offsetFor(sel)} onDown={onEntityDown(sel)} hover={hoverFor(sel)} />
              );
            })}
          {battle.markers.map((m) => {
            const sel = { kind: 'marker' as const, id: m.id };
            return <FreeMarkerShape key={m.id} m={m} fs={fs} flip={flip} selected={isSel('marker', m.id)} offset={offsetFor(sel)} onDown={onEntityDown(sel)} />;
          })}
          {session && moving && <Ghost pose={session.start} box={moving.box} />}
          {eff.regiments
            .filter((r) => r.location === 'board' && !r.garrisonId)
            .map((r) => {
              const sel = { kind: 'regiment' as const, id: r.id };
              const isMoving = session?.piece.id === r.id;
              return (
                <RegimentShape
                  key={r.id}
                  reg={r}
                  b={eff}
                  fs={fs}
                  flip={flip}
                  selected={isSel('regiment', r.id)}
                  warn={isMoving ? movingWarn : warnIds.has(r.id)}
                  onDown={onEntityDown(sel)}
                  hover={hoverFor(sel)}
                />
              );
            })}
          {eff.characters
            .filter((c) => c.location === 'board' && !c.attachedTo)
            .map((c) => {
              const sel = { kind: 'character' as const, id: c.id };
              const isMoving = session?.piece.id === c.id;
              return (
                <CharacterShape
                  key={c.id}
                  ch={c}
                  b={eff}
                  fs={fs}
                  flip={flip}
                  selected={isSel('character', c.id)}
                  warn={isMoving ? movingWarn : warnIds.has(c.id)}
                  onDown={onEntityDown(sel)}
                  hover={hoverFor(sel)}
                />
              );
            })}
          <ContactLayer b={eff} px={px} />
          {handles}
          {session && moving && tool === 'select' && !session.aligning && !session.align && <MoveHandles pose={sessionPose(session)} box={moving.box} px={px} onDown={onHandleDown} />}
          {session && moving && (session.aligning || session.align) && (
            <AlignPreview b={battle} pose={sessionPose({ ...session, live: null })} box={moving.box} hover={session.aligning ? alignHover : null} pending={session.align} fs={fs} flip={flip} px={px} />
          )}
          {eff.measurements.map((m) => (
            <PinnedMeasurement key={m.id} b={eff} m={m} fs={fs} flip={flip} px={px} />
          ))}
          {rings.map((r) => (
            <RangeRing key={r.label} b={eff} refr={measure.ring.ref!} radius={r.radius} label={r.label} fs={fs} flip={flip} px={px} />
          ))}
          {measure.pair.length === 2 && (tool === 'distance' || tool === 'select') && <DistanceLine b={eff} a1={measure.pair[0]} a2={measure.pair[1]} fs={fs} flip={flip} px={px} />}
          {measure.ruler && tool === 'ruler' && <RulerLine a={measure.ruler.a} b={measure.ruler.b} fs={fs} flip={flip} px={px} />}
          {tool === 'drawTerrain' && draft.length > 0 && (
            <g pointerEvents="none">
              <polyline
                points={[...draft, ...(pointer ? [pointer] : [])].map((p) => `${p.x},${p.y}`).join(' ')}
                fill="rgba(120,140,90,0.25)"
                stroke="#333"
                strokeWidth={0.08}
                strokeDasharray="0.3 0.2"
              />
              {draft.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={handleR * 0.8} fill="#333" />
              ))}
            </g>
          )}
          {readout}
        </g>
      </svg>
      {hover && !drag && <Tooltip b={battle} sel={hover.sel} x={hover.cx} y={hover.cy} />}
      {tool === 'drawTerrain' && (
        <div className="board-hint">Click to add points · double-click or Enter to finish · Backspace removes the last point · Esc cancels</div>
      )}
      {(tool === 'placeZone' || tool === 'placeObjective') && <div className="board-hint">Click on the board to place · Esc cancels</div>}
      {session?.aligning && <div className="board-hint">Click a side of an enemy regiment (front, flank, rear) or of an objective marker · Esc cancels</div>}
      {!session?.aligning && tool === 'ruler' && <div className="board-hint">Drag to measure · snaps to stand corners and edge midpoints (Alt: no snap) · P pins</div>}
      {!session?.aligning && tool === 'distance' && <div className="board-hint">Click two things to see their closest distance · P pins</div>}
      {!session?.aligning && tool === 'ring' && <div className="board-hint">Click a regiment or character (Alt-click a single stand) · choose ranges in the panel · P pins</div>}
      {pointer && (
        <div className="coords">
          {pointer.x.toFixed(1)}", {pointer.y.toFixed(1)}"
        </div>
      )}
    </div>
  );
}

/** Current pose of a regiment or lone character on the board. */
function piecePose(b: Battle, piece: MovingPiece): Pose | null {
  if (piece.kind === 'regiment') {
    const r = b.regiments.find((x) => x.id === piece.id);
    return r && r.location === 'board' && !r.garrisonId ? { x: r.x, y: r.y, angle: r.angle } : null;
  }
  const c = b.characters.find((x) => x.id === piece.id);
  return c && c.location === 'board' && !c.attachedTo && c.x !== undefined ? { x: c.x, y: c.y ?? 0, angle: c.angle ?? 0 } : null;
}

/** Ruler snap targets: stand corners and edge midpoints (regiments, characters, objective markers). */
function collectSnapPoints(b: Battle): Vec[] {
  const polys: Vec[][] = [];
  for (const r of b.regiments) if (r.location === 'board' && !r.garrisonId) for (const g of regimentStandGeoms(r)) polys.push(g.poly);
  for (const c of b.characters) {
    if (c.location !== 'board' || c.attachedTo) continue;
    const p = characterPolygon(c);
    if (p) polys.push(p);
  }
  for (const m of b.objectiveMarkers) if (!m.destroyed) polys.push(objectiveMarkerPolygon(m));
  const out: Vec[] = [];
  for (const poly of polys)
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length];
      out.push(p, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    });
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const roundPose = (p: { x: number; y: number; angle: number }) => ({ x: round2(p.x), y: round2(p.y), angle: p.angle });

/** World point → polygon-local coordinates of a terrain piece (undoing its rotation). */
function toLocal(t: Terrain, p: Vec): [number, number] {
  const r = (-t.angle * Math.PI) / 180;
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  return [round2(dx * Math.cos(r) - dy * Math.sin(r)), round2(dx * Math.sin(r) + dy * Math.cos(r))];
}

function Tooltip({ b, sel, x, y }: { b: Battle; sel: Selection; x: number; y: number }) {
  const lines: string[] = [];
  if (sel.kind === 'regiment') {
    const r = b.regiments.find((q) => q.id === sel.id);
    if (!r) return null;
    const ch = r.characterId ? b.characters.find((c) => c.id === r.characterId) : undefined;
    lines.push(`${r.name} — ${b.players[r.owner].name}`);
    lines.push(`${r.stands.length} stand(s) · ${r.standType} · damage ${totalDamage(r)}`);
    const wounded = r.stands.filter((s) => s.wounds > 0).map((s) => `${s.wounds}/${s.woundsMax}`);
    if (wounded.length) lines.push(`Wounded: ${wounded.join(', ')}`);
    if (ch) lines.push(`Character: ${ch.name} ${ch.wounds}/${ch.woundsMax}`);
    if (r.tags.length) lines.push(`Tags: ${r.tags.join(', ')}`);
  } else if (sel.kind === 'character') {
    const c = b.characters.find((q) => q.id === sel.id);
    if (!c) return null;
    lines.push(`${c.name} — ${b.players[c.owner].name}`);
    lines.push(`${c.standType} · wounds ${c.wounds}/${c.woundsMax}`);
  } else if (sel.kind === 'terrain') {
    const t = b.terrain.find((q) => q.id === sel.id);
    if (!t) return null;
    lines.push(`${t.name} · Size ${t.size}${t.locked ? ' · locked' : ''}`);
    if (t.keywords.length) lines.push(t.keywords.join(', '));
    if (t.garrison) lines.push(`Garrison: Defense ${t.garrison.defense}, Capacity ${t.garrison.capacity}`);
  } else if (sel.kind === 'zone') {
    const z = b.zones.find((q) => q.id === sel.id);
    if (!z) return null;
    lines.push(`Objective zone ${z.label ?? ''} · ${z.diameter}"`);
    lines.push(z.friendlyTo ? `Friendly to ${b.players[z.friendlyTo].name}` : 'Neutral');
    if (z.locked) lines.push('Locked by the scenario');
  } else if (sel.kind === 'objective') {
    const m = b.objectiveMarkers.find((q) => q.id === sel.id);
    if (!m) return null;
    lines.push(`Objective marker ${m.label ?? '(neutral)'} · ${OBJECTIVE_MARKER_SIDE.toFixed(2)}" square, Size 2`);
    lines.push(`Damage: P1 ${m.damageBy.p1}/${m.woundsMax} · P2 ${m.damageBy.p2}/${m.woundsMax}`);
  }
  if (!lines.length) return null;
  return (
    <div className="tooltip" style={{ left: x + 14, top: y + 14 }}>
      {lines.map((l, i) => (
        <div key={i} className={i === 0 ? 'tt-title' : undefined}>
          {l}
        </div>
      ))}
    </div>
  );
}
