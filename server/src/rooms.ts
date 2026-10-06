// Rooms: the authoritative battle document, seats, undo history and
// persistence as JSON files.
//
// Each room is two files in DATA_DIR:
//   <CODE>.json        snapshot (battle, seq, seats, host, recent history)
//   <CODE>.ops.jsonl   operations applied since that snapshot, one per line
// Loading reads the snapshot and replays the operations through the same
// pure reducer. A new snapshot is written every 50 operations (and on seat
// changes); the operation file is then emptied. Rooms untouched for 30 days
// are deleted by a periodic sweep.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { applyOp, createBattle, makeId, normalizeBattle, ROOM_CODE_ALPHABET, type Battle, type CommandCard, type Op, type OpEnvelope, type PlayerSeat } from '@conquest/shared';

export const SNAPSHOT_EVERY = 50;
export const ROOM_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Operations kept in memory for reconnecting clients (beyond this they get a snapshot). */
const RECENT_KEPT = 1000;
/** Undo history entries kept. */
const HISTORY_KEPT = 300;

export interface Seat {
  token: string;
  name: string;
}

export interface HistoryEntry {
  seq: number;
  by: PlayerSeat | 'spectator' | 'system';
  touched: string[];
  inverse: Op | null;
  undone?: boolean;
  /** This entry is itself an undo (a restore). */
  isUndo?: boolean;
  label: string;
}

interface Snapshot {
  version: 1;
  code: string;
  createdAt: number;
  lastActivity: number;
  hostToken: string;
  seats: Partial<Record<PlayerSeat, Seat>>;
  seq: number;
  battle: Battle;
  history: HistoryEntry[];
  /** Secret part of each command stack (cards not yet flipped, top first). */
  stacks?: Partial<Record<PlayerSeat, CommandCard[]>>;
}

interface OpLine {
  env: OpEnvelope;
  hist: HistoryEntry;
}

export class Room {
  battle: Battle;
  seq: number;
  seats: Partial<Record<PlayerSeat, Seat>>;
  history: HistoryEntry[];
  /** Secret part of each command stack; never in the battle, sent only to its seat. */
  stacks: Partial<Record<PlayerSeat, CommandCard[]>>;
  recent: OpEnvelope[] = [];
  lastActivity: number;
  /** Set when a browser re-uploaded this room after the server lost it. */
  recoveredAt?: number;
  private opsSinceSnapshot = 0;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    readonly store: RoomStore,
    readonly code: string,
    readonly hostToken: string,
    readonly createdAt: number,
    snap: Pick<Snapshot, 'battle' | 'seq' | 'seats' | 'history' | 'lastActivity' | 'stacks'>,
  ) {
    this.stacks = snap.stacks ?? {};
    this.battle = snap.battle;
    this.seq = snap.seq;
    this.seats = snap.seats;
    this.history = snap.history;
    this.lastActivity = snap.lastActivity;
  }

  seatOf(token: string): PlayerSeat | null {
    if (this.seats.p1?.token === token) return 'p1';
    if (this.seats.p2?.token === token) return 'p2';
    return null;
  }

  /** Apply an operation as the authority. Returns the stored envelope or an error. */
  apply(op: Op, by: HistoryEntry['by'], id: string, opts: { isUndo?: boolean; now?: number } = {}): { env: OpEnvelope } | { error: string } {
    if (this.recent.some((e) => e.id === id)) return { error: 'Duplicate operation' };
    const env: OpEnvelope = { id, by, at: opts.now ?? Date.now(), seq: this.seq + 1, op };
    let r: ReturnType<typeof applyOp>;
    try {
      r = applyOp(this.battle, env);
    } catch (e) {
      console.error(`room ${this.code}: ${op.type} failed`, e);
      return { error: 'Server error: that action was not applied' };
    }
    if (!r.ok) return { error: r.error };
    this.battle = r.battle;
    this.seq = env.seq!;
    this.lastActivity = env.at;
    const hist: HistoryEntry = { seq: env.seq!, by, touched: r.touched, inverse: r.inverse, label: r.log.text, ...(opts.isUndo ? { isUndo: true } : {}) };
    this.history.push(hist);
    if (this.history.length > HISTORY_KEPT) this.history.splice(0, this.history.length - HISTORY_KEPT);
    this.recent.push(env);
    if (this.recent.length > RECENT_KEPT) this.recent.splice(0, this.recent.length - RECENT_KEPT);
    this.persistOp({ env, hist });
    return { env };
  }

  /**
   * Undo the seat's own last undoable operation by applying its inverse.
   * Refused when a later operation (other than undone ones and undos) touched
   * the same object.
   */
  undo(seat: PlayerSeat): { env: OpEnvelope } | { error: string } {
    const i = this.history.map((h) => h.by === seat && !!h.inverse && !h.undone && !h.isUndo).lastIndexOf(true);
    if (i < 0) return { error: 'Nothing of yours to undo' };
    const h = this.history[i];
    const clash = this.history.slice(i + 1).find((l) => !l.undone && !l.isUndo && l.touched.some((t) => h.touched.includes(t)));
    if (clash) return { error: `Cannot undo "${h.label}": ${clash.label.replace(/^[^:]*: /, '')} changed the same thing since` };
    const r = this.apply(h.inverse!, seat, `undo-${this.seq + 1}-${makeId(6)}`, { isUndo: true });
    if ('error' in r) return r;
    h.undone = true;
    this.snapshotSoon();
    return r;
  }

  /** Operations after `seq` if still in memory, else null (send a snapshot). */
  opsSince(seq: number): OpEnvelope[] | null {
    if (seq === this.seq) return [];
    if (seq > this.seq) return null;
    const first = this.recent[0]?.seq;
    if (first === undefined || seq + 1 < first) return null;
    return this.recent.filter((e) => e.seq! > seq);
  }

  snapshotData(): Snapshot {
    return {
      version: 1,
      code: this.code,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      hostToken: this.hostToken,
      seats: this.seats,
      seq: this.seq,
      battle: this.battle,
      history: this.history,
      stacks: this.stacks,
    };
  }

  private persistOp(line: OpLine) {
    this.opsSinceSnapshot++;
    if (this.opsSinceSnapshot >= SNAPSHOT_EVERY) {
      this.snapshotNow();
      return;
    }
    const text = JSON.stringify(line) + '\n';
    this.writeChain = this.writeChain.then(() => this.store.appendOps(this.code, text)).catch((e) => console.error(`room ${this.code}: append failed`, e));
  }

  private snapTimer: ReturnType<typeof setTimeout> | undefined;
  /** Snapshot a moment from now (seat changes, undo flags). */
  snapshotSoon() {
    clearTimeout(this.snapTimer);
    this.snapTimer = setTimeout(() => this.snapshotNow(), 500);
  }

  snapshotNow(): Promise<void> {
    clearTimeout(this.snapTimer);
    this.opsSinceSnapshot = 0;
    const data = this.snapshotData();
    this.writeChain = this.writeChain.then(() => this.store.writeSnapshot(this.code, data)).catch((e) => console.error(`room ${this.code}: snapshot failed`, e));
    return this.writeChain;
  }

  /** Wait for pending writes (tests and shutdown). */
  flush(): Promise<void> {
    return this.writeChain;
  }
}

export class RoomStore {
  private rooms = new Map<string, Room>();
  private loading = new Map<string, Promise<Room | null>>();

  constructor(readonly dir: string) {}

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private file(code: string, kind: 'snap' | 'ops') {
    return path.join(this.dir, kind === 'snap' ? `${code}.json` : `${code}.ops.jsonl`);
  }

  async writeSnapshot(code: string, data: Snapshot) {
    const f = this.file(code, 'snap');
    const tmp = `${f}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, f);
    await fs.writeFile(this.file(code, 'ops'), '');
  }

  async appendOps(code: string, text: string) {
    await fs.appendFile(this.file(code, 'ops'), text);
  }

  private async newCode(): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      const bytes = new Uint8Array(6);
      crypto.getRandomValues(bytes);
      for (const b of bytes) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
      if (!this.rooms.has(code) && !(await exists(this.file(code, 'snap')))) return code;
    }
    throw new Error('Could not find a free room code');
  }

  async create(opts: { hostToken: string; scenarioId?: string; layoutId?: string; battle?: Battle }): Promise<Room> {
    const code = await this.newCode();
    const now = Date.now();
    const battle: Battle = opts.battle
      ? { ...opts.battle, id: code, seq: 0, log: [] }
      : createBattle({ id: code, scenarioId: opts.scenarioId, layoutId: opts.layoutId });
    const room = new Room(this, code, opts.hostToken, now, { battle, seq: 0, seats: {}, history: [], lastActivity: now });
    this.rooms.set(code, room);
    await room.snapshotNow();
    return room;
  }

  private recovering = new Set<string>();

  /**
   * Recreate a room the server lost (a restart without a persistent disk)
   * from a seated player's copy. Returns null if the room exists after all or
   * another browser is recovering it right now.
   */
  async recover(code: string, opts: { token: string; seat: PlayerSeat; name: string; battle: Battle }): Promise<Room | null> {
    if (this.rooms.has(code) || this.loading.has(code) || this.recovering.has(code)) return null;
    this.recovering.add(code);
    try {
      if (await this.get(code)) return null;
      const now = Date.now();
      const battle: Battle = { ...opts.battle, id: code };
      const seats = { [opts.seat]: { token: opts.token, name: opts.name } };
      const room = new Room(this, code, opts.token, now, { battle, seq: battle.seq, seats, history: [], lastActivity: now });
      room.recoveredAt = now;
      this.rooms.set(code, room);
      await room.snapshotNow();
      return room;
    } finally {
      this.recovering.delete(code);
    }
  }

  /** The room, loaded from disk if needed; null if it does not exist. */
  get(code: string): Promise<Room | null> {
    const r = this.rooms.get(code);
    if (r) return Promise.resolve(r);
    let p = this.loading.get(code);
    if (!p) {
      p = this.load(code).finally(() => this.loading.delete(code));
      this.loading.set(code, p);
    }
    return p;
  }

  private async load(code: string): Promise<Room | null> {
    let snap: Snapshot;
    try {
      snap = JSON.parse(await fs.readFile(this.file(code, 'snap'), 'utf8')) as Snapshot;
    } catch {
      return null;
    }
    const room = new Room(this, code, snap.hostToken, snap.createdAt, { ...snap, battle: normalizeBattle(snap.battle) });
    // Replay operations written after the snapshot through the same reducer.
    let lines: string[] = [];
    try {
      lines = (await fs.readFile(this.file(code, 'ops'), 'utf8')).split('\n').filter(Boolean);
    } catch {
      /* no ops file */
    }
    for (const l of lines) {
      try {
        const { env, hist } = JSON.parse(l) as OpLine;
        const r = applyOp(room.battle, env);
        if (!r.ok) continue;
        room.battle = r.battle;
        room.seq = env.seq!;
        room.lastActivity = Math.max(room.lastActivity, env.at);
        room.history.push(hist);
        // Undo flags live in history entries; re-apply them from restores.
        if (hist.isUndo) {
          const target = [...room.history].reverse().find((h) => h.by === hist.by && !h.undone && !h.isUndo && h.seq < hist.seq && !!h.inverse);
          if (target) target.undone = true;
        }
        room.recent.push(env);
      } catch {
        /* a torn last line after a crash: ignore */
      }
    }
    this.rooms.set(code, room);
    return room;
  }

  /** Write every loaded room to disk and forget them (shutdown). */
  async closeAll() {
    const rooms = [...this.rooms.values()];
    await Promise.all(rooms.map((r) => r.snapshotNow()));
    this.rooms.clear();
  }

  /** Forget rooms with nobody connected (they are on disk). */
  unload(code: string) {
    const r = this.rooms.get(code);
    if (r) void r.snapshotNow().then(() => this.rooms.delete(code));
  }

  /** Delete rooms whose files have not changed for 30 days. */
  async sweep(now = Date.now()): Promise<string[]> {
    const removed: string[] = [];
    let names: string[] = [];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return removed;
    }
    for (const n of names) {
      const m = /^([A-Z0-9]{6})\.json$/.exec(n);
      if (!m) continue;
      const code = m[1];
      if (this.rooms.has(code)) continue;
      const stamps = await Promise.all([this.file(code, 'snap'), this.file(code, 'ops')].map((f) => fs.stat(f).then((s) => s.mtimeMs).catch(() => 0)));
      if (now - Math.max(...stamps) > ROOM_TTL_MS) {
        await Promise.all([this.file(code, 'snap'), this.file(code, 'ops')].map((f) => fs.rm(f, { force: true })));
        removed.push(code);
      }
    }
    return removed;
  }
}

async function exists(f: string) {
  try {
    await fs.access(f);
    return true;
  } catch {
    return false;
  }
}
