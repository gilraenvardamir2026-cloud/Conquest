// HTTP + WebSocket server. One Node service: it serves the built client, a
// tiny JSON API for creating rooms, and the room WebSocket at /ws.

import express from 'express';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  authorize,
  makeId,
  normalizeRoomCode,
  type DiceRoll,
  type PlayerSeat,
  type Presence,
  type ServerMsg,
  type SeatsInfo,
} from '@conquest/shared';
import { parseClientMsg } from '@conquest/shared/src/schema';
import { DiceService } from './dice';
import { Room, RoomStore } from './rooms';

/** Largest WebSocket message accepted. */
export const MAX_MESSAGE_BYTES = 256 * 1024;
/** Per connection: sustained messages per second and burst. */
const RATE_PER_SEC = 40;
const RATE_BURST = 80;
/** Presence updates relayed per connection per second (extra ones are dropped). */
const PRESENCE_PER_SEC = 20;

interface Client {
  id: string;
  ws: WebSocket;
  room: Room | null;
  token: string;
  seat: PlayerSeat | null;
  name: string;
  tokens: number;
  lastRefill: number;
  lastPresence: number;
  alive: boolean;
}

export interface AppOptions {
  dataDir: string;
  dice: DiceService;
  staticDir?: string;
}

export async function createApp(opts: AppOptions): Promise<{ server: Server; store: RoomStore; close: () => Promise<void> }> {
  const store = new RoomStore(opts.dataDir);
  await store.init();
  const dice = opts.dice;
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // ---- HTTP API ------------------------------------------------------------
  app.post('/api/rooms', async (req, res) => {
    const body = (req.body ?? {}) as { token?: unknown; scenarioId?: unknown; layoutId?: unknown };
    const token = typeof body.token === 'string' && body.token.length >= 16 && body.token.length <= 64 ? body.token : null;
    if (!token) return void res.status(400).json({ error: 'A browser token is required' });
    const room = await store.create({
      hostToken: token,
      scenarioId: typeof body.scenarioId === 'string' ? body.scenarioId : undefined,
      layoutId: typeof body.layoutId === 'string' ? body.layoutId : undefined,
    });
    res.json({ code: room.code });
  });

  app.get('/api/rooms/:code', async (req, res) => {
    const code = normalizeRoomCode(req.params.code);
    const room = code ? await store.get(code) : null;
    if (!room) return void res.status(404).json({ error: 'No such room' });
    res.json({ code: room.code, name: room.battle.name, seats: seatsInfo(room) });
  });

  app.get('/api/rooms/:code/export', async (req, res) => {
    const code = normalizeRoomCode(req.params.code);
    const room = code ? await store.get(code) : null;
    if (!room) return void res.status(404).json({ error: 'No such room' });
    res.json(room.battle);
  });

  app.get('/api/dice', (_req, res) => res.json(dice.status()));
  app.get('/healthz', (_req, res) => res.send('ok'));

  // ---- built client (production) ------------------------------------------------
  if (opts.staticDir && existsSync(path.join(opts.staticDir, 'index.html'))) {
    app.use(express.static(opts.staticDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path === '/ws') return next();
      res.sendFile(path.join(opts.staticDir!, 'index.html'));
    });
  }

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });
  const clients = new Set<Client>();

  // ---- helpers ------------------------------------------------------------------
  const send = (c: Client, m: ServerMsg) => {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(m));
  };
  const inRoom = (room: Room) => [...clients].filter((c) => c.room === room);
  const broadcast = (room: Room, m: ServerMsg, except?: Client) => {
    const text = JSON.stringify(m);
    for (const c of inRoom(room)) if (c !== except && c.ws.readyState === c.ws.OPEN) c.ws.send(text);
  };
  function seatsInfo(room: Room): SeatsInfo {
    const live = inRoom(room);
    const info = (s: PlayerSeat) => ({
      taken: !!room.seats[s],
      name: room.seats[s]?.name ?? room.battle.players[s].name,
      connected: live.some((c) => c.seat === s),
    });
    return { p1: info('p1'), p2: info('p2') };
  }
  const spectators = (room: Room) => inRoom(room).filter((c) => !c.seat).length;
  const sendSeats = (room: Room) => broadcast(room, { t: 'seats', seats: seatsInfo(room), spectators: spectators(room) });
  const notice = (c: Client, text: string, kind: 'info' | 'error' = 'error') => send(c, { t: 'notice', text, kind });

  const takeToken = (c: Client) => {
    const now = Date.now();
    c.tokens = Math.min(RATE_BURST, c.tokens + ((now - c.lastRefill) / 1000) * RATE_PER_SEC);
    c.lastRefill = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  };

  const commit = (c: Client, room: Room, r: { env: import('@conquest/shared').OpEnvelope } | { error: string }, clientOpId?: string) => {
    if ('error' in r) {
      if (clientOpId) send(c, { t: 'reject', id: clientOpId, error: r.error });
      else notice(c, r.error);
      return false;
    }
    broadcast(room, { t: 'op', env: r.env });
    return true;
  };

  // ---- connections ---------------------------------------------------------------
  wss.on('connection', (ws) => {
    const c: Client = { id: makeId(10), ws, room: null, token: '', seat: null, name: 'Spectator', tokens: RATE_BURST, lastRefill: Date.now(), lastPresence: 0, alive: true };
    clients.add(c);
    ws.on('pong', () => (c.alive = true));
    // Oversized or broken frames close the socket (1009 etc.); nothing else to do.
    ws.on('error', () => {});

    ws.on('message', async (data, isBinary) => {
      if (isBinary) return notice(c, 'Binary messages are not accepted');
      if (!takeToken(c)) return; // over the rate limit: drop silently
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        return notice(c, 'Invalid JSON');
      }
      const parsed = parseClientMsg(raw);
      if (!parsed.ok) {
        const id = (raw as { id?: unknown })?.id;
        if ((raw as { t?: unknown })?.t === 'op' && typeof id === 'string') return send(c, { t: 'reject', id: id.slice(0, 40), error: parsed.error });
        return notice(c, parsed.error);
      }
      const m = parsed.msg;
      if (m.t === 'ping') return send(c, { t: 'pong' });

      if (m.t === 'hello') {
        const code = normalizeRoomCode(m.room);
        const room = code ? await store.get(code) : null;
        if (!room) {
          notice(c, 'This room does not exist (or has expired).');
          return ws.close(4004, 'no such room');
        }
        if (c.room && c.room !== room) return notice(c, 'Already in another room');
        c.room = room;
        c.token = m.token;
        c.seat = room.seatOf(m.token);
        if (c.seat) c.name = room.seats[c.seat]!.name;
        else if (m.name) c.name = m.name.slice(0, 40);
        const ops = m.lastSeq !== undefined ? room.opsSince(m.lastSeq) : null;
        send(c, {
          t: 'welcome',
          clientId: c.id,
          seat: c.seat,
          isHost: room.hostToken === c.token,
          seats: seatsInfo(room),
          spectators: spectators(room),
          seq: room.seq,
          ...(ops ? { ops } : { battle: room.battle }),
          dice: dice.status(),
        });
        sendSeats(room);
        return;
      }

      const room = c.room;
      if (!room) return notice(c, 'Say hello first');

      switch (m.t) {
        case 'claim': {
          if (c.seat === m.seat) return;
          if (c.seat) return notice(c, 'You already have a seat');
          const holder = room.seats[m.seat];
          if (holder && holder.token !== c.token) return notice(c, `${room.battle.players[m.seat].name}'s seat is taken`);
          const name = m.name.trim().slice(0, 40) || (m.seat === 'p1' ? 'Player 1' : 'Player 2');
          room.seats[m.seat] = { token: c.token, name };
          c.seat = m.seat;
          c.name = name;
          // Everyone in the room using this browser token gets the seat (same person, two tabs).
          for (const o of inRoom(room)) if (o.token === c.token) o.seat = m.seat;
          if (room.battle.players[m.seat].name !== name) commit(c, room, room.apply({ type: 'updatePlayer', seat: m.seat, patch: { name } }, m.seat, `seat-${makeId(8)}`));
          room.snapshotSoon();
          for (const o of inRoom(room)) if (o.token === c.token) send(o, { t: 'you', seat: m.seat, isHost: room.hostToken === o.token });
          sendSeats(room);
          return;
        }
        case 'freeSeat': {
          if (room.hostToken !== c.token) return notice(c, 'Only the host can free a seat');
          if (!room.seats[m.seat]) return;
          delete room.seats[m.seat];
          for (const o of inRoom(room)) {
            if (o.seat === m.seat) {
              o.seat = null;
              send(o, { t: 'you', seat: null, isHost: room.hostToken === o.token });
              notice(o, 'The host freed your seat; you are now watching.', 'info');
            }
          }
          room.snapshotSoon();
          sendSeats(room);
          return;
        }
        case 'op': {
          const actor = c.seat ?? 'spectator';
          const why = authorize(room.battle, actor, m.op);
          if (why) return send(c, { t: 'reject', id: m.id, error: why });
          commit(c, room, room.apply(m.op, actor, m.id), m.id);
          return;
        }
        case 'undo': {
          if (!c.seat) return notice(c, 'Spectators cannot undo');
          commit(c, room, room.undo(c.seat));
          return;
        }
        case 'presence': {
          const now = Date.now();
          if (now - c.lastPresence < 1000 / PRESENCE_PER_SEC) return;
          c.lastPresence = now;
          broadcast(room, { t: 'presence', from: c.id, seat: c.seat ?? 'spectator', name: c.name, p: m.p as Presence }, c);
          return;
        }
        case 'roll': {
          if (!c.seat) return notice(c, 'Spectators cannot roll');
          const r = await dice.roll(m.count);
          const roll: DiceRoll = {
            id: makeId(10),
            by: c.seat,
            label: m.label.trim(),
            at: Date.now(),
            results: r.values.slice().sort((a, b) => a - b),
            ...(m.target ? { target: m.target } : {}),
            rerolled: r.values.map(() => false),
            source: r.source,
            kind: 'roll',
          };
          commit(c, room, room.apply({ type: 'rollDice', roll }, c.seat, `roll-${roll.id}`));
          return;
        }
        case 'reroll': {
          if (!c.seat) return notice(c, 'Spectators cannot roll');
          const roll = room.battle.dice.find((d) => d.id === m.id);
          if (!roll) return notice(c, 'That roll is no longer in the tray');
          if (roll.by !== c.seat) return notice(c, 'Only the player who rolled can re-roll');
          if (roll.kind === 'rolloff') return notice(c, 'A roll-off cannot be re-rolled');
          if (m.indices.some((i) => roll.rerolled[i])) return notice(c, 'A die can be re-rolled only once');
          const r = await dice.roll(m.indices.length);
          commit(c, room, room.apply({ type: 'rerollDice', id: roll.id, indices: m.indices, values: r.values, source: r.source }, c.seat, `reroll-${makeId(10)}`));
          return;
        }
        case 'rolloff': {
          if (!c.seat) return notice(c, 'Spectators cannot roll');
          const ties: [number, number][] = [];
          let pair: number[] = [];
          let source: 'random.org' | 'local' = 'random.org';
          for (let i = 0; i < 50; i++) {
            const r = await dice.roll(2);
            if (r.source === 'local') source = 'local';
            pair = r.values;
            if (pair[0] !== pair[1]) break;
            ties.push([pair[0], pair[1]]);
          }
          const roll: DiceRoll = { id: makeId(10), by: c.seat, label: 'Roll-off', at: Date.now(), results: pair, rerolled: [false, false], source, kind: 'rolloff', ...(ties.length ? { ties } : {}) };
          commit(c, room, room.apply({ type: 'rollDice', roll }, c.seat, `roll-${roll.id}`));
          return;
        }
      }
    });

    ws.on('close', () => {
      clients.delete(c);
      const room = c.room;
      if (!room) return;
      broadcast(room, { t: 'presence', from: c.id, seat: c.seat ?? 'spectator', name: c.name, p: null });
      sendSeats(room);
      if (!inRoom(room).length) store.unload(room.code);
    });
  });

  // Drop dead connections; refresh dice quota hourly; sweep expired rooms daily.
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, 30_000);
  const usage = setInterval(() => void dice.checkUsage(), 60 * 60 * 1000);
  const sweep = setInterval(() => void store.sweep(), 24 * 60 * 60 * 1000);
  void dice.checkUsage();
  void dice.refill();
  void store.sweep();

  const close = async () => {
    clearInterval(heartbeat);
    clearInterval(usage);
    clearInterval(sweep);
    for (const c of clients) c.ws.terminate();
    wss.close();
    await new Promise<void>((r) => server.close(() => r()));
    await store.closeAll();
  };
  return { server, store, close };
}
