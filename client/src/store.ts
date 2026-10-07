// Single client store (Zustand). Holds the battle document plus local UI state.
// Every change to the battle goes through dispatch(op), which runs the shared
// reducer.
//
// Two modes:
//  - local (/local): offline practice, autosaved to localStorage, the "acting
//    seat" is switched by hand;
//  - online (/<CODE>): the server is authoritative. `confirmed` is the battle
//    as the server last told us; `pending` are our operations sent but not yet
//    echoed. The displayed `battle` is confirmed + pending, applied
//    optimistically and rebuilt whenever the server speaks.
//
// A move session lives here too: segments accumulate locally and the whole
// move is committed as a single operation.

import { create } from 'zustand';
import { ROUTE } from './route';
import {
  applyOp,
  boardCheck,
  regimentPolygons,
  createBattle,
  describeMove,
  makeId,
  mergeSegments,
  normalizeBattle,
  pieceAt,
  type AlignMode,
  type AlignTarget,
  authorize,
  type Battle,
  type BoardWarning,
  type ClientMsg,
  type CommandCard,
  type DiceStatus,
  type Presence,
  type SeatsInfo,
  type ServerMsg,
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

export interface NetState {
  status: 'connecting' | 'online' | 'offline';
  room: string | null;
  clientId: string | null;
  isHost: boolean;
  seats: SeatsInfo | null;
  spectators: number;
  dice: DiceStatus | null;
  /** True once the first welcome arrived (the board is real). */
  ready: boolean;
  /** Shown in the disconnected banner instead of the default text. */
  note?: string;
}

/** Another person in the room, with what they are doing right now. */
export interface Peer {
  seat: PlayerSeat | 'spectator';
  name: string;
  p: Presence;
  at: number;
}

export interface AppState {
  mode: 'local' | 'online';
  battle: Battle;
  /** Online: our seat (null = spectator). Local: the seat we act as. */
  seat: PlayerSeat | null;
  net: NetState;
  confirmed: Battle | null;
  pending: { id: string; op: Op }[];
  peers: Record<string, Peer>;
  showDice: boolean;
  /** Command tray open. */
  showCommand: boolean;
  /**
   * Secret part of command stacks (cards not yet flipped, top first). Online:
   * only our own seat's, as the server sends it. Offline: both seats.
   */
  stacks: Partial<Record<PlayerSeat, CommandCard[]>>;
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
  setShowDice: (v: boolean) => void;
  setShowCommand: (v: boolean) => void;
  setStack: (seat: PlayerSeat, cards: CommandCard[]) => void;
  /** Handle a message from the server (online mode). */
  receive: (m: ServerMsg) => void;
  setNet: (n: Partial<NetState>) => void;
}

/** Set by the connection module: send a message, or reconnect for a full snapshot. */
let sender: ((m: ClientMsg) => boolean) | null = null;
let resyncer: (() => void) | null = null;
export const setSender = (f: ((m: ClientMsg) => boolean) | null, resync: (() => void) | null = null) => {
  sender = f;
  resyncer = resync;
};
export const sendToServer = (m: ClientMsg): boolean => (sender ? sender(m) : false);

/** Apply ops one by one, skipping (and reporting) any the reducer now rejects. */
function rebase(base: Battle, pending: { id: string; op: Op }[], seat: PlayerSeat | null): { battle: Battle; kept: { id: string; op: Op }[] } {
  let b = base;
  const kept: { id: string; op: Op }[] = [];
  for (const p of pending) {
    const r = applyOp(b, { id: p.id, by: seat ?? 'spectator', at: Date.now(), op: p.op });
    if (r.ok) {
      b = r.battle;
      kept.push(p);
    }
  }
  return { battle: b, kept };
}

const STORAGE_KEY = 'conquest.local.battle.v1';

/** Where this browser remembers its command stacks: per room online, one slot offline. */
const stacksKey = () => (ROUTE.page === 'room' ? `conquest.stacks.${ROUTE.code}` : 'conquest.local.stacks.v1');

function loadStacks(): Partial<Record<PlayerSeat, CommandCard[]>> {
  try {
    const raw = localStorage.getItem(stacksKey());
    const v = raw ? (JSON.parse(raw) as Partial<Record<PlayerSeat, CommandCard[]>>) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function saveStacks() {
  try {
    localStorage.setItem(stacksKey(), JSON.stringify(useStore.getState().stacks));
  } catch {
    /* storage full or blocked: only the recovery copy is lost */
  }
}

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

const initialBattle = (): Battle =>
  ROUTE.page === 'room' ? createBattle({ id: ROUTE.code }) : loadSaved() ?? createBattle({ id: makeId(), scenarioId: 's1', layoutId: 'layout1' });

function fitView(b: Battle, vw: number, vh: number): View {
  // Board plus the reinforcement strips (2" each side) and a small margin,
  // grown to include regiments waiting off the table.
  let x0 = -3;
  let y0 = -4;
  let x1 = b.board.width + 3;
  let y1 = b.board.depth + 4;
  for (const r of b.regiments) {
    if (r.location !== 'board') continue;
    for (const p of regimentPolygons(r).flat()) {
      x0 = Math.min(x0, p.x - 1);
      y0 = Math.min(y0, p.y - 1);
      x1 = Math.max(x1, p.x + 1);
      y1 = Math.max(y1, p.y + 1);
    }
  }
  const scale = Math.max(1, Math.min(vw / (x1 - x0), vh / (y1 - y0)));
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale };
}

export const useStore = create<AppState>((set, get) => ({
  mode: ROUTE.page === 'room' ? 'online' : 'local',
  battle: initialBattle(),
  seat: ROUTE.page === 'room' ? null : 'p1',
  net: { status: 'connecting', room: ROUTE.page === 'room' ? ROUTE.code : null, clientId: null, isHost: false, seats: null, spectators: 0, dice: null, ready: false },
  confirmed: null,
  pending: [],
  peers: {},
  showDice: false,
  showCommand: false,
  stacks: loadStacks(),
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

  dispatch: (op) => (get().mode === 'online' ? sendOp(op) : commit(op, true) !== null),

  undo: () => {
    if (get().mode === 'online') {
      if (get().net.status !== 'online') return get().notify('Disconnected — reconnecting', 'error');
      if (!get().seat) return get().notify('Spectators cannot undo', 'error');
      sendToServer({ t: 'undo' });
      return;
    }
    const { undoStack, seat, history } = get();
    const i = undoStack.map((u) => u.by).lastIndexOf(seat ?? 'p1');
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
    const { battle, viewport, flip } = get();
    const v = fitView(battle, viewport.w, viewport.h);
    // View coordinates are mirrored while the view is flipped.
    set({ view: flip ? { ...v, cx: battle.board.width - v.cx, cy: battle.board.depth - v.cy } : v });
  },
  centreOn: (x, y) => set((s) => ({ view: { ...s.view, cx: s.flip ? s.battle.board.width - x : x, cy: s.flip ? s.battle.board.depth - y : y } })),
  toggleFlip: () =>
    set((s) => ({
      flip: !s.flip,
      view: { ...s.view, cx: s.battle.board.width - s.view.cx, cy: s.battle.board.depth - s.view.cy },
    })),
  notify: (text, kind = 'info') => set({ toast: { text, kind, at: Date.now() } }),
  newBattle: (scenarioId, layoutId) => {
    set({ battle: createBattle({ id: makeId(), scenarioId, layoutId }), selection: null, undoStack: [], history: [], checkResult: null, highlight: [], moveSession: null, stacks: {} });
    saveStacks();
    get().zoomToFit();
  },
  loadBattle: (b) => {
    set({ battle: normalizeBattle(b), selection: null, undoStack: [], history: [], checkResult: null, highlight: [], moveSession: null, stacks: {} });
    saveStacks();
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
    if (get().mode === 'online') {
      const seat = get().seat;
      if (!seat) return get().notify('Spectators cannot move pieces', 'error'), false;
      if (p.owner !== seat && !b.settings.anyoneCanEdit) return get().notify(`${p.name} belongs to the other player`, 'error'), false;
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
  setShowDice: (showDice) => set({ showDice }),
  setShowCommand: (showCommand) => set({ showCommand }),
  setStack: (seat, cards) => {
    set((s) => ({ stacks: { ...s.stacks, [seat]: cards } }));
    saveStacks();
  },
  setNet: (n) => set((s) => ({ net: { ...s.net, ...n } })),

  receive: (m) => {
    const s = get();
    switch (m.t) {
      case 'welcome': {
        let confirmed = m.battle ? normalizeBattle(m.battle) : s.confirmed;
        if (!confirmed) return; // ops without a base: cannot happen (we only send lastSeq once we have a battle)
        for (const env of m.ops ?? []) {
          const r = applyOp(confirmed, env);
          if (r.ok) confirmed = r.battle;
        }
        // Anything we sent that the server has now applied is no longer pending; resend the rest.
        const seen = new Set((m.ops ?? []).map((e) => e.id));
        const pending = s.pending.filter((p) => !seen.has(p.id));
        const { battle, kept } = rebase(confirmed, pending, m.seat);
        const first = !s.net.ready;
        set({
          confirmed,
          battle,
          pending: kept,
          seat: m.seat,
          peers: {},
          net: { ...s.net, status: 'online', note: undefined, clientId: m.clientId, isHost: m.isHost, seats: m.seats, spectators: m.spectators, dice: m.dice, ready: true },
        });
        for (const p of kept) sendToServer({ t: 'op', id: p.id, op: p.op });
        if (m.seat && m.stack) {
          // The server lost our stack (it restarted without its files): hand back the one we remember.
          const remembered = s.stacks[m.seat] ?? [];
          if (!m.stack.length && remembered.length) sendToServer({ t: 'stackRestore', cards: remembered.map(({ kind, id }) => ({ kind, id })) });
          else get().setStack(m.seat, m.stack);
        }
        if (first) get().zoomToFit();
        return;
      }
      case 'op': {
        if (!s.confirmed) return;
        const r = applyOp(s.confirmed, m.env);
        if (!r.ok) {
          // Should never happen: the server applied it. Resynchronise from scratch.
          console.warn('Could not apply a server operation; resynchronising', r.error);
          set({ confirmed: null });
          resyncer?.();
          return;
        }
        const pending = s.pending.filter((p) => p.id !== m.env.id);
        const { battle, kept } = rebase(r.battle, pending, s.seat);
        set({ confirmed: r.battle, battle, pending: kept });
        return;
      }
      case 'reject': {
        const pending = s.pending.filter((p) => p.id !== m.id);
        if (s.confirmed) {
          const { battle, kept } = rebase(s.confirmed, pending, s.seat);
          set({ battle, pending: kept });
        } else set({ pending });
        get().notify(m.error, 'error');
        return;
      }
      case 'you':
        set({ seat: m.seat, net: { ...s.net, isHost: m.isHost } });
        return;
      case 'seats':
        set({ net: { ...s.net, seats: m.seats, spectators: m.spectators } });
        return;
      case 'presence': {
        const peers = { ...s.peers };
        if (m.p) peers[m.from] = { seat: m.seat, name: m.name, p: { ...(peers[m.from]?.p ?? {}), ...m.p }, at: Date.now() };
        else delete peers[m.from];
        set({ peers });
        return;
      }
      case 'dice':
        set({ net: { ...s.net, dice: m.dice } });
        return;
      case 'stack':
        if (s.seat) get().setStack(s.seat, m.cards);
        return;
      case 'notice':
        get().notify(m.text, m.kind ?? 'error');
        return;
      case 'pong':
        return;
    }
  },
}));

/**
 * Online: check the op locally (permission, reducer), show it at once, and
 * send it. The server's echo (or rejection) reconciles.
 */
function sendOp(op: Op): boolean {
  const st = useStore.getState();
  if (st.net.status !== 'online' || !st.confirmed) {
    st.notify('Disconnected — reconnecting. Changes are paused.', 'error');
    return false;
  }
  const actor = st.seat ?? 'spectator';
  const why = authorize(st.battle, actor, op);
  if (why) {
    st.notify(why, 'error');
    return false;
  }
  const id = makeId(16);
  const r = applyOp(st.battle, { id, by: actor, at: Date.now(), op });
  if (!r.ok) {
    st.notify(r.error, 'error');
    return false;
  }
  useStore.setState({ battle: r.battle, pending: [...st.pending, { id, op }] });
  sendToServer({ t: 'op', id, op });
  return true;
}

/** Run an op through the reducer; record its inverse for undo unless it is itself an undo. */
function commit(op: Op, recordUndo: boolean): number | null {
  const { battle } = useStore.getState();
  const seat = useStore.getState().seat ?? 'p1';
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
  if (s.mode !== 'local') return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 300);
});

function saveLocal() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(useStore.getState().battle));
  } catch {
    /* storage full or blocked: ignore */
  }
}

// Offline: never lose the last change to a quick reload or a closed tab.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => useStore.getState().mode === 'local' && saveLocal());

/** Convenience for components. */
export const dispatch = (op: Op) => useStore.getState().dispatch(op);

// Handy for debugging and browser tests: the store is reachable from the console.
(globalThis as unknown as { conquestStore?: typeof useStore }).conquestStore = useStore;
