// Single client store (Zustand). Holds the battle document plus local UI state.
// Every change to the battle goes through dispatch(op), which runs the shared
// reducer. Until the server arrives (milestone 4) the document is autosaved to
// localStorage and the "acting seat" is switched by hand.
//
// A move session lives here too: segments accumulate locally and the whole
// move is committed as a single operation.

import { create } from 'zustand';
import {
  applyOp,
  boardCheck,
  createBattle,
  describeMove,
  makeId,
  mergeSegments,
  normalizeBattle,
  pieceAt,
  type AlignMode,
  type AlignTarget,
  type Battle,
  type BoardWarning,
  type EntityRef,
  type LosMode,
  type LosParty,
  type Facing,
  type MoveSegment,
  type MovingPiece,
  type Op,
  type OpEnvelope,
  type PlayerSeat,
  type Pose,
  type Vec,
} from '@conquest/shared';

export type SelectionKind = 'regiment' | 'character' | 'terrain' | 'zone' | 'objective' | 'marker';
export interface Selection {
  kind: SelectionKind;
  id: string;
}

export type Tool = 'select' | 'ruler' | 'distance' | 'ring' | 'los' | 'drawTerrain' | 'placeZone' | 'placeObjective';

/** The line-of-sight check being shown. */
export interface LosState {
  acting: LosParty | null;
  target: LosParty | null;
  mode: LosMode;
  /** Volley: draw every tested line, not just the best per stand. */
  allLines: boolean;
}

/**
 * A move in progress. Nothing is sent until it is committed: then the whole
 * session becomes one moveRegiment / moveCharacter operation.
 */
export interface MoveSession {
  piece: MovingPiece;
  start: Pose;
  segments: MoveSegment[];
  /** Segment being dragged right now (not yet added). */
  live: MoveSegment | null;
  /** Waiting for a click on an enemy facing. */
  aligning: boolean;
  /** Align-to-target preview awaiting confirmation. */
  align: { target: AlignTarget; facing: Facing; mode: AlignMode } | null;
}

export interface RingOptions {
  ref: EntityRef | null;
  march: boolean;
  barrage: boolean;
  halfBarrage: boolean;
  custom: number | null;
}

export interface MeasureState {
  ruler: { a: Vec; b: Vec } | null;
  /** Up to two things for the closest-distance read-out. */
  pair: EntityRef[];
  ring: RingOptions;
}

/** Current pose of a move session (live drag, else last segment, else start). */
export function sessionPose(m: MoveSession): Pose {
  return m.live?.to ?? m.segments[m.segments.length - 1]?.to ?? m.start;
}

/** The battle as it looks with the move session applied (for drawing and live checks). */
export function withSession(b: Battle, m: MoveSession | null): Battle {
  if (!m) return b;
  const pose = sessionPose(m);
  if (m.piece.kind === 'regiment') return { ...b, regiments: b.regiments.map((r) => (r.id === m.piece.id ? { ...r, ...pose } : r)) };
  return { ...b, characters: b.characters.map((c) => (c.id === m.piece.id ? { ...c, ...pose } : c)) };
}

/** Camera: board point at the viewport centre and zoom in pixels per inch. */
export interface View {
  cx: number;
  cy: number;
  scale: number;
}

interface UndoEntry {
  seq: number;
  by: PlayerSeat;
  label: string;
  inverse: Op;
  touched: string[];
}

interface HistoryEntry {
  seq: number;
  touched: string[];
}

export interface AppState {
  battle: Battle;
  seat: PlayerSeat;
  selection: Selection | null;
  tool: Tool;
  view: View;
  viewport: { w: number; h: number };
  flip: boolean;
  undoStack: UndoEntry[];
  history: HistoryEntry[];
  toast: { text: string; kind: 'info' | 'error'; at: number } | null;
  showHelp: boolean;
  showSettings: boolean;
  /** Ids highlighted on the board (e.g. by the board check). */
  highlight: string[];
  /** Last board check result (null = not run since the last change of scenario/terrain). */
  checkResult: BoardWarning[] | null;
  moveSession: MoveSession | null;
  measure: MeasureState;
  los: LosState;
  /** Facing arcs of every piece are shown while A is held. */
  showAllArcs: boolean;

  dispatch: (op: Op) => boolean;
  undo: () => void;
  select: (s: Selection | null) => void;
  setTool: (t: Tool) => void;
  setSeat: (s: PlayerSeat) => void;
  setView: (v: Partial<View>) => void;
  setViewport: (w: number, h: number) => void;
  zoomToFit: () => void;
  centreOn: (x: number, y: number) => void;
  toggleFlip: () => void;
  notify: (text: string, kind?: 'info' | 'error') => void;
  newBattle: (scenarioId?: string, layoutId?: string) => void;
  loadBattle: (b: Battle) => void;
  setShowHelp: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  setHighlight: (ids: string[]) => void;
  setCheckResult: (w: BoardWarning[] | null) => void;

  startMove: (piece: MovingPiece) => boolean;
  setLive: (seg: MoveSegment | null) => void;
  /** Add a segment; with merge, fold it into the previous one when of the same kind (keyboard nudges). */
  addSegment: (seg: MoveSegment, merge?: boolean) => void;
  popSegment: () => void;
  setAligning: (v: boolean) => void;
  setAlign: (a: MoveSession['align']) => void;
  commitMove: () => void;
  cancelMove: () => void;
  setMeasure: (m: Partial<MeasureState>) => void;
  setRing: (r: Partial<RingOptions>) => void;
  setLos: (l: Partial<LosState>) => void;
  setShowAllArcs: (v: boolean) => void;
}

const STORAGE_KEY = 'conquest.local.battle.v1';

function loadSaved(): Battle | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as Battle;
    return b && b.board && Array.isArray(b.regiments) ? normalizeBattle(b) : null;
  } catch {
    return null;
  }
}

const initialBattle = (): Battle => loadSaved() ?? createBattle({ id: makeId(), scenarioId: 's1', layoutId: 'layout1' });

function fitView(b: Battle, vw: number, vh: number): View {
  // Board plus the reinforcement strips (2" each side) and a small margin.
  const w = b.board.width + 6;
  const h = b.board.depth + 8;
  const scale = Math.max(1, Math.min(vw / w, vh / h));
  return { cx: b.board.width / 2, cy: b.board.depth / 2, scale };
}

export const useStore = create<AppState>((set, get) => ({
  battle: initialBattle(),
  seat: 'p1',
  selection: null,
  tool: 'select',
  view: { cx: 36, cy: 24, scale: 12 },
  viewport: { w: 900, h: 600 },
  flip: false,
  undoStack: [],
  history: [],
  toast: null,
  showHelp: false,
  showSettings: false,
  highlight: [],
  checkResult: null,
  moveSession: null,
  measure: { ruler: null, pair: [], ring: { ref: null, march: true, barrage: false, halfBarrage: false, custom: null } },
  los: { acting: null, target: null, mode: 'sight', allLines: false },
  showAllArcs: false,

  dispatch: (op) => commit(op, true) !== null,

  undo: () => {
    const { undoStack, seat, history } = get();
    const i = undoStack.map((u) => u.by).lastIndexOf(seat);
    if (i < 0) {
      get().notify('Nothing to undo');
      return;
    }
    const entry = undoStack[i];
    // Refuse if a later operation touched the same object.
    const clash = history.some((h) => h.seq > entry.seq && h.touched.some((t) => entry.touched.includes(t)));
    if (clash) {
      get().notify('Cannot undo: something has changed the same object since', 'error');
      return;
    }
    const seq = commit(entry.inverse, false);
    if (seq === null) return;
    // The undone op and its restore cancel out: neither should block later undos.
    set((s) => ({
      undoStack: s.undoStack.filter((_, j) => j !== i),
      history: s.history.filter((h) => h.seq !== entry.seq && h.seq !== seq),
    }));
  },

  select: (selection) => set({ selection }),
  setTool: (tool) => set({ tool }),
  setSeat: (seat) => set({ seat }),
  setView: (v) => set((s) => ({ view: { ...s.view, ...v } })),
  setViewport: (w, h) => {
    const first = get().viewport.w === 900 && get().viewport.h === 600;
    set({ viewport: { w, h } });
    if (first) get().zoomToFit();
  },
  zoomToFit: () => {
    const { battle, viewport } = get();
    set({ view: fitView(battle, viewport.w, viewport.h) });
  },
  centreOn: (x, y) => set((s) => ({ view: { ...s.view, cx: s.flip ? s.battle.board.width - x : x, cy: s.flip ? s.battle.board.depth - y : y } })),
  toggleFlip: () =>
    set((s) => ({
      flip: !s.flip,
      view: { ...s.view, cx: s.battle.board.width - s.view.cx, cy: s.battle.board.depth - s.view.cy },
    })),
  notify: (text, kind = 'info') => set({ toast: { text, kind, at: Date.now() } }),
  newBattle: (scenarioId, layoutId) => {
    set({ battle: createBattle({ id: makeId(), scenarioId, layoutId }), selection: null, undoStack: [], history: [], checkResult: null, highlight: [], moveSession: null });
    get().zoomToFit();
  },
  loadBattle: (b) => {
    set({ battle: normalizeBattle(b), selection: null, undoStack: [], history: [], checkResult: null, highlight: [], moveSession: null });
    get().zoomToFit();
  },
  setShowHelp: (showHelp) => set({ showHelp }),
  setShowSettings: (showSettings) => set({ showSettings }),
  setHighlight: (highlight) => set({ highlight }),
  setCheckResult: (checkResult) => set({ checkResult, highlight: checkResult ? [...new Set(checkResult.flatMap((w) => w.ids))] : [] }),

  startMove: (piece) => {
    const cur = get().moveSession;
    if (cur && cur.piece.id === piece.id) return true;
    if (cur) get().commitMove();
    const b = get().battle;
    const p =
      piece.kind === 'regiment'
        ? b.regiments.find((r) => r.id === piece.id && r.location === 'board' && !r.garrisonId)
        : b.characters.find((c) => c.id === piece.id && c.location === 'board' && !c.attachedTo && c.x !== undefined);
    if (!p) {
      get().notify('Only pieces on the board can move');
      return false;
    }
    const start = { x: p.x!, y: p.y!, angle: p.angle ?? 0 };
    set({ moveSession: { piece, start, segments: [], live: null, aligning: false, align: null }, selection: { kind: piece.kind, id: piece.id } });
    return true;
  },
  setLive: (live) => set((s) => (s.moveSession ? { moveSession: { ...s.moveSession, live } } : {})),
  addSegment: (seg, merge = false) =>
    set((s) => {
      const m = s.moveSession;
      if (!m) return {};
      const prev = m.segments[m.segments.length - 1];
      const box = pieceAt(s.battle, m.piece, m.start)?.box;
      const merged = merge && prev && box ? mergeSegments(prev, seg, box) : null;
      const segments = merged ? [...m.segments.slice(0, -1), merged] : [...m.segments, seg];
      // A nudge that cancels out leaves no segment behind.
      const cleaned = segments.filter((x) => x.distance > 1e-9 || Math.abs(x.value) > 1e-9);
      return { moveSession: { ...m, segments: cleaned, live: null, align: null } };
    }),
  popSegment: () => set((s) => (s.moveSession ? { moveSession: { ...s.moveSession, segments: s.moveSession.segments.slice(0, -1), live: null } } : {})),
  setAligning: (aligning) => set((s) => (s.moveSession ? { moveSession: { ...s.moveSession, aligning, align: aligning ? null : s.moveSession.align } } : {})),
  setAlign: (align) => set((s) => (s.moveSession ? { moveSession: { ...s.moveSession, align, aligning: false } } : {})),
  commitMove: () => {
    const m = get().moveSession;
    if (!m) return;
    set({ moveSession: null });
    if (!m.segments.length) return;
    const pose = m.segments[m.segments.length - 1].to;
    const summary = describeMove(m.segments);
    if (m.piece.kind === 'regiment') get().dispatch({ type: 'moveRegiment', id: m.piece.id, pose, summary });
    else get().dispatch({ type: 'moveCharacter', id: m.piece.id, pose, summary });
  },
  cancelMove: () => set({ moveSession: null }),
  setMeasure: (m) => set((s) => ({ measure: { ...s.measure, ...m } })),
  setRing: (r) => set((s) => ({ measure: { ...s.measure, ring: { ...s.measure.ring, ...r } } })),
  setLos: (l) => set((s) => ({ los: { ...s.los, ...l } })),
  setShowAllArcs: (showAllArcs) => set({ showAllArcs }),
}));

/** Run an op through the reducer; record its inverse for undo unless it is itself an undo. */
function commit(op: Op, recordUndo: boolean): number | null {
  const { battle, seat } = useStore.getState();
  const env: OpEnvelope = { id: makeId(), by: seat, at: Date.now(), op };
  const r = applyOp(battle, env);
  if (!r.ok) {
    useStore.getState().notify(r.error, 'error');
    return null;
  }
  useStore.setState((s) => ({
    battle: r.battle,
    history: [...s.history.slice(-500), { seq: r.log.seq, touched: r.touched }],
    undoStack:
      recordUndo && r.inverse
        ? [...s.undoStack.slice(-200), { seq: r.log.seq, by: seat, label: r.log.text, inverse: r.inverse, touched: r.touched }]
        : s.undoStack,
  }));
  return r.log.seq;
}

// Autosave (local play only; the server takes over persistence in milestone 4).
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.battle === prev.battle) return;
  // A move session whose piece left the board (deleted, sent to reserve, undone…) ends.
  const m = s.moveSession;
  if (m) {
    const ok =
      m.piece.kind === 'regiment'
        ? s.battle.regiments.some((r) => r.id === m.piece.id && r.location === 'board' && !r.garrisonId)
        : s.battle.characters.some((c) => c.id === m.piece.id && c.location === 'board' && !c.attachedTo);
    if (!ok) useStore.setState({ moveSession: null });
  }
  // Keep a board check that has been run up to date as terrain and zones change.
  if (s.checkResult && (s.battle.terrain !== prev.battle.terrain || s.battle.zones !== prev.battle.zones)) {
    s.setCheckResult(boardCheck(s.battle));
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(useStore.getState().battle));
    } catch {
      /* storage full or blocked: ignore */
    }
  }, 300);
});

/** Convenience for components. */
export const dispatch = (op: Op) => useStore.getState().dispatch(op);

// Handy for debugging and browser tests: the store is reachable from the console.
(globalThis as unknown as { conquestStore?: typeof useStore }).conquestStore = useStore;
