// The room connection: WebSocket to /ws, hello / welcome, reconnect with
// back-off (asking for the operations missed since our last sequence
// number), and throttled presence (~15 updates a second, only when something
// changed).

import { pieceAt, type ClientMsg, type Presence, type ServerMsg } from '@conquest/shared';
import { ringRadii } from './board/Overlays';
import { browserToken, rememberRoom, savedName } from './route';
import { sessionPose, setSender, useStore } from './store';

const PRESENCE_MS = 66;

let ws: WebSocket | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let stopped = false;

/** Our pointer on the board, reported by the Board component. */
let cursor: { x: number; y: number } | null = null;
export function reportCursor(p: { x: number; y: number } | null) {
  cursor = p;
  schedulePresence();
}

function url() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function send(m: ClientMsg): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(m));
  return true;
}

export function connect(room: string) {
  stopped = false;
  rememberRoom(room);
  setSender(send, () => {
    // Force a full snapshot: drop the socket and reconnect without lastSeq.
    ws?.close();
  });
  open(room);
  useStore.subscribe(schedulePresence);
}

function open(room: string) {
  clearTimeout(retryTimer);
  useStore.getState().setNet({ status: 'connecting' });
  const sock = new WebSocket(url());
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    const st = useStore.getState();
    const lastSeq = st.confirmed ? st.confirmed.seq : undefined;
    send({
      t: 'hello',
      room,
      token: browserToken(),
      name: savedName() || undefined,
      ...(lastSeq !== undefined ? { lastSeq } : {}),
      ...(st.seat ? { wasSeat: st.seat } : {}),
    });
    clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ t: 'ping' }), 25_000);
    lastPresence = '';
  };
  sock.onmessage = (ev) => {
    let m: ServerMsg;
    try {
      m = JSON.parse(String(ev.data)) as ServerMsg;
    } catch {
      return;
    }
    useStore.getState().receive(m);
  };
  sock.onclose = (ev) => {
    clearInterval(pingTimer);
    if (ws !== sock) return;
    ws = null;
    useStore.getState().setNet({ status: 'offline' });
    if (stopped) return;
    if (ev.code === 4004) {
      void roomMissing(room);
      return;
    }
    const delay = Math.min(5000, 500 * 2 ** retry++);
    retryTimer = setTimeout(() => open(room), delay);
  };
}

/** Attempts left to wait for a seated player to restore a lost room. */
let waitsLeft = 20;

/**
 * The server does not know the room. On a first visit that just means a bad
 * link. If we were already playing, the server restarted and lost it: a
 * seated player re-uploads its copy, anyone else waits for that to happen.
 */
async function roomMissing(room: string) {
  const st = useStore.getState();
  const notFound = () => useStore.getState().setNet({ status: 'offline', room: null });
  if (!st.confirmed) return notFound();
  if (st.seat) {
    st.setNet({ note: 'The server restarted. Restoring the game from this browser…' });
    try {
      const res = await fetch(`/api/rooms/${room}/recover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: browserToken(), seat: st.seat, name: st.confirmed.players[st.seat].name, battle: st.confirmed }),
      });
      // 409: someone else restored it first, which is just as good.
      if (res.ok || res.status === 409) return open(room);
      const why = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `error ${res.status}`;
      useStore.getState().notify(`Could not restore the game: ${why}`);
    } catch {
      // Server unreachable again: try the whole thing once more shortly.
      retryTimer = setTimeout(() => open(room), 2000);
      return;
    }
    return notFound();
  }
  if (waitsLeft-- <= 0) return notFound();
  st.setNet({ note: 'The server restarted. Waiting for a player to reconnect and restore the game…' });
  retryTimer = setTimeout(() => open(room), 3000);
}

export function claimSeat(seat: 'p1' | 'p2', name: string) {
  send({ t: 'claim', seat, name });
}

export function freeSeat(seat: 'p1' | 'p2') {
  send({ t: 'freeSeat', seat });
}

export function rollDice(count: number, label: string, target?: number): boolean {
  return send({ t: 'roll', count, label, ...(target ? { target } : {}) });
}

export function rerollDice(id: string, indices: number[]): boolean {
  return send({ t: 'reroll', id, indices });
}

export function rollOff(): boolean {
  return send({ t: 'rolloff' });
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

let presenceTimer: ReturnType<typeof setTimeout> | undefined;
let lastPresence = '';
let lastSent = 0;

function currentPresence(): Presence {
  const st = useStore.getState();
  const m = st.moveSession;
  const tool = st.tool;
  const ring = tool === 'ring' && st.measure.ring.ref ? { ref: st.measure.ring.ref, radii: ringRadii(st.battle, st.measure.ring) } : null;
  return {
    cursor: cursor ? { x: Math.round(cursor.x * 100) / 100, y: Math.round(cursor.y * 100) / 100 } : null,
    selection: st.selection ? { kind: st.selection.kind, id: st.selection.id } : null,
    tool,
    move: m && pieceAt(st.battle, m.piece, m.start) ? { piece: m.piece, pose: sessionPose(m) } : null,
    ruler: tool === 'ruler' ? st.measure.ruler : null,
    pair: (tool === 'distance' || tool === 'select') && st.measure.pair.length === 2 ? st.measure.pair : [],
    los: tool === 'los' && st.los.acting && st.los.target ? { acting: st.los.acting, target: st.los.target, mode: st.los.mode } : null,
    ring: ring && ring.radii.length ? ring : null,
    align: m?.align ? { targetKind: m.align.target.kind, targetId: m.align.target.id, facing: m.align.facing } : null,
  };
}

function schedulePresence() {
  if (presenceTimer || !ws) return;
  const wait = Math.max(0, PRESENCE_MS - (Date.now() - lastSent));
  presenceTimer = setTimeout(() => {
    presenceTimer = undefined;
    if (useStore.getState().mode !== 'online') return;
    const p = currentPresence();
    const text = JSON.stringify(p);
    if (text === lastPresence) return;
    if (send({ t: 'presence', p })) {
      lastPresence = text;
      lastSent = Date.now();
    }
  }, wait);
}
