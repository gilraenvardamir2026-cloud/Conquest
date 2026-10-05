// Single client store (Zustand). Holds the battle document plus local UI state.
// Every change to the battle goes through dispatch(op), which runs the shared
// reducer. In milestone 1 there is no server: the document is autosaved to
// localStorage and the "acting seat" is switched by hand.

import { create } from 'zustand';
import {
  applyOp,
  boardCheck,
  createBattle,
  makeId,
  type Battle,
  type BoardWarning,
  type Op,
  type OpEnvelope,
  type PlayerSeat,
} from '@conquest/shared';

export type SelectionKind = 'regiment' | 'character' | 'terrain' | 'zone' | 'objective' | 'marker';
export interface Selection {
  kind: SelectionKind;
  id: string;
}

export type Tool = 'select' | 'drawTerrain' | 'placeZone' | 'placeObjective';

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
}

const STORAGE_KEY = 'conquest.local.battle.v1';

function loadSaved(): Battle | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as Battle;
    return b && b.board && Array.isArray(b.regiments) ? b : null;
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
    set({ battle: createBattle({ id: makeId(), scenarioId, layoutId }), selection: null, undoStack: [], history: [], checkResult: null, highlight: [] });
    get().zoomToFit();
  },
  loadBattle: (b) => {
    set({ battle: b, selection: null, undoStack: [], history: [], checkResult: null, highlight: [] });
    get().zoomToFit();
  },
  setShowHelp: (showHelp) => set({ showHelp }),
  setShowSettings: (showSettings) => set({ showSettings }),
  setHighlight: (highlight) => set({ highlight }),
  setCheckResult: (checkResult) => set({ checkResult, highlight: checkResult ? [...new Set(checkResult.flatMap((w) => w.ids))] : [] }),
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
