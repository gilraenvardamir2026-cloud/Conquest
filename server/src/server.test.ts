import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import { createRegiment, diceFromRandomness, roundTime, STAND_PRESETS, type DrandBeacon, type ServerMsg } from '@conquest/shared';
import { createApp } from './app';
import { DiceService, type RandomOrgClient } from './dice';
import { SNAPSHOT_EVERY } from './rooms';

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

const failing: RandomOrgClient = {
  generateIntegers: () => Promise.reject(new Error('quota exhausted')),
  getUsage: () => Promise.reject(new Error('quota exhausted')),
};
const hanging: RandomOrgClient = {
  generateIntegers: (_n, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))),
  getUsage: () => new Promise(() => {}),
};
let served = 0;
const working: RandomOrgClient = {
  generateIntegers: async (n) => {
    served++;
    return { data: Array.from({ length: n }, (_, i) => (i % 6) + 1), bitsLeft: 249_000, requestsLeft: 999 };
  },
  getUsage: async () => ({ bitsLeft: 249_000, requestsLeft: 999, status: 'running' }),
};

describe('dice service', () => {
  it('with RANDOM.ORG failing, a roll still returns values 1–6 marked local', async () => {
    const d = new DiceService({ client: failing });
    const r = await d.roll(50);
    expect(r.source).toBe('local');
    expect(r.values).toHaveLength(50);
    expect(r.values.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)).toBe(true);
    expect(d.status().lastError).toContain('quota');
  });

  it('falls back when RANDOM.ORG takes longer than the timeout', async () => {
    const d = new DiceService({ client: hanging, timeoutMs: 50 });
    const t0 = Date.now();
    const r = await d.roll(3);
    expect(r.source).toBe('local');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(d.status().lastError).toContain('took over');
  });

  it('without a key it is local and never calls out', async () => {
    const d = new DiceService({ client: null });
    expect((await d.roll(5)).source).toBe('local');
    expect(d.status().configured).toBe(false);
  });

  it('serves rolls from a pool of 300 and refills below 60', async () => {
    served = 0;
    const d = new DiceService({ client: working });
    const r = await d.roll(10);
    expect(r.source).toBe('random.org');
    expect(served).toBe(1);
    expect(d.status().pool).toBe(290);
    await d.roll(235); // 55 left: below 60, a refill starts in the background
    await d.refill();
    expect(served).toBe(2);
    expect(d.status().pool).toBe(355);
    expect(d.status().requestsLeft).toBe(999);
  });
});

describe('drand dice', () => {
  const timing = { genesis: 1_000, period: 3 };
  const beacon = (round: number): DrandBeacon => {
    const signature = createHash('sha256').update(`s${round}`).digest('hex');
    return { round, signature, randomness: createHash('sha256').update(Buffer.from(signature, 'hex')).digest('hex') };
  };

  it('waits for the next round, derives the dice from it and records the draw', async () => {
    const asked: number[] = [];
    const slept: number[] = [];
    const now = roundTime(500, timing) + 1_000; // 1 s into round 500
    const d = new DiceService({
      client: null,
      drand: { timing: async () => timing, beacon: async (r) => (asked.push(r), beacon(r)) },
      now: () => now,
      sleep: async (ms) => void slept.push(ms),
    });
    const r = await d.roll(5, 'roll-1');
    expect(asked).toEqual([501]);
    expect(slept[0]).toBe(2_000 + 100);
    expect(r.source).toBe('drand');
    expect(r.draw).toEqual({ round: 501, key: 'roll-1', values: r.values });
    expect(r.values).toEqual(await diceFromRandomness(beacon(501).randomness, 'roll-1', 5));
    expect(d.status()).toMatchObject({ source: 'drand', lastRound: 501 });
  });

  it('retries a slow relay, then falls back to local dice', async () => {
    let calls = 0;
    const flaky = new DiceService({
      client: null,
      drand: { timing: async () => timing, beacon: async (r) => (++calls < 3 ? Promise.reject(new Error('425 too early')) : beacon(r)) },
      sleep: async () => {},
    });
    expect((await flaky.roll(2, 'x')).source).toBe('drand');
    const dead = new DiceService({
      client: null,
      drand: { timing: async () => timing, beacon: async () => Promise.reject(new Error('unreachable')) },
      drandTimeoutMs: 50,
      sleep: (ms) => new Promise((res) => setTimeout(res, Math.min(ms, 5))),
    });
    const r = await dead.roll(3, 'y');
    expect(r.source).toBe('local');
    expect(r.values).toHaveLength(3);
    expect(dead.status().lastError).toContain('did not arrive');
  });
});

// ---------------------------------------------------------------------------
// Rooms over WebSockets
// ---------------------------------------------------------------------------

interface TestClient {
  ws: WebSocket;
  msgs: ServerMsg[];
  next: (pred: (m: ServerMsg) => boolean, ms?: number) => Promise<ServerMsg>;
  send: (m: unknown) => void;
  close: () => void;
}

function connect(url: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const msgs: ServerMsg[] = [];
    const waiters: { pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      msgs.push(m);
      for (const w of waiters.slice()) {
        if (w.pred(m)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.res(m);
        }
      }
    });
    ws.on('open', () =>
      resolve({
        ws,
        msgs,
        send: (m) => ws.send(JSON.stringify(m)),
        close: () => ws.close(),
        next: (pred, ms = 2000) =>
          new Promise((res, rej) => {
            const found = msgs.find(pred);
            if (found) {
              msgs.splice(msgs.indexOf(found), 1);
              return res(found);
            }
            const t = setTimeout(() => rej(new Error('timed out waiting for a message')), ms);
            waiters.push({
              pred,
              res: (m) => {
                clearTimeout(t);
                msgs.splice(msgs.indexOf(m), 1);
                res(m);
              },
            });
          }),
      }),
    );
    ws.on('error', reject);
  });
}

const T1 = 'token-player-one-0000000000';
const T2 = 'token-player-two-0000000000';
const T3 = 'token-spectator-00000000000';

describe('room server', () => {
  let dir: string;
  let base: string;
  let wsUrl: string;
  let app: Awaited<ReturnType<typeof createApp>>;

  const start = async () => {
    app = await createApp({ dataDir: dir, dice: new DiceService({ client: failing }) });
    await new Promise<void>((r) => app.server.listen(0, r));
    const port = (app.server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/ws`;
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'conquest-'));
    await start();
  });
  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const newRoom = async () => {
    const r = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: T1, scenarioId: 's1', layoutId: 'layout1' }) });
    return ((await r.json()) as { code: string }).code;
  };

  const join = async (code: string, token: string, seat?: 'p1' | 'p2', name?: string) => {
    const c = await connect(wsUrl);
    c.send({ t: 'hello', room: code, token, name });
    const w = (await c.next((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>;
    if (seat) {
      c.send({ t: 'claim', seat, name: name ?? seat });
      await c.next((m) => m.t === 'you');
    }
    return { c, w };
  };

  const militia = (id: string, owner: 'p1' | 'p2') =>
    createRegiment({ id, owner, name: id, standType: 'infantry', preset: STAND_PRESETS.infantry, stands: 3, files: 3, woundsMax: 4, x: 30, y: 40, location: 'board' });

  it('creates a room, seats two players and broadcasts operations to both', async () => {
    const code = await newRoom();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    const { c: a, w } = await join(code, T1, 'p1', 'Alice');
    expect(w.isHost).toBe(true);
    expect(w.battle!.board.scenarioId).toBe('s1');
    const { c: b } = await join(code, T2, 'p2', 'Bob');

    a.send({ t: 'op', id: 'op-aaaaaa', op: { type: 'addRegiment', regiment: militia('mil', 'p1') } });
    const ea = (await a.next((m) => m.t === 'op' && m.env.id === 'op-aaaaaa')) as Extract<ServerMsg, { t: 'op' }>;
    const eb = (await b.next((m) => m.t === 'op' && m.env.id === 'op-aaaaaa')) as Extract<ServerMsg, { t: 'op' }>;
    expect(ea.env.seq).toBe(eb.env.seq);
    expect(eb.env.by).toBe('p1');

    // Ownership: Bob cannot move Alice's regiment.
    b.send({ t: 'op', id: 'op-bbbbbb', op: { type: 'moveRegiment', id: 'mil', pose: { x: 1, y: 1, angle: 0 } } });
    const rej = (await b.next((m) => m.t === 'reject')) as Extract<ServerMsg, { t: 'reject' }>;
    expect(rej.error).toContain('belongs to the other player');

    // Server-only operations and malformed messages are refused.
    a.send({ t: 'op', id: 'op-cccccc', op: { type: 'rollDice', roll: {} } });
    expect((await a.next((m) => m.t === 'reject')).t).toBe('reject');
    a.send({ t: 'op', id: 'op-dddddd', op: { type: 'moveRegiment', id: 'mil', pose: { x: 'far', y: 1, angle: 0 } } });
    expect((await a.next((m) => m.t === 'reject')).t).toBe('reject');
    a.close();
    b.close();
  });

  it('spectators can only chat; a third person cannot take a taken seat', async () => {
    const code = await newRoom();
    const { c: a } = await join(code, T1, 'p1');
    const { c: s, w } = await join(code, T3);
    expect(w.seat).toBeNull();
    s.send({ t: 'claim', seat: 'p1', name: 'Mallory' });
    expect(((await s.next((m) => m.t === 'notice')) as { text: string }).text).toContain('taken');
    s.send({ t: 'op', id: 'op-eeeeee', op: { type: 'setScenario', scenarioId: 's2' } });
    expect(((await s.next((m) => m.t === 'reject')) as { error: string }).error).toContain('Spectators');
    s.send({ t: 'op', id: 'op-ffffff', op: { type: 'chat', text: 'hello all' } });
    await a.next((m) => m.t === 'op' && m.env.op.type === 'chat');
    a.close();
    s.close();
  });

  it('undo sends the inverse, and is refused once someone else touched the same object', async () => {
    const code = await newRoom();
    const { c: a } = await join(code, T1, 'p1');
    const { c: b } = await join(code, T2, 'p2');
    // Alice damages an objective marker, then undoes it.
    const markerId = ((await (await fetch(`${base}/api/rooms/${code}/export`)).json()) as { objectiveMarkers: { id: string }[] }).objectiveMarkers[0].id;
    a.send({ t: 'op', id: 'op-111111', op: { type: 'damageObjectiveMarker', id: markerId, seat: 'p1', delta: 1 } });
    await a.next((m) => m.t === 'op' && m.env.id === 'op-111111');
    a.send({ t: 'undo' });
    const u = (await b.next((m) => m.t === 'op' && m.env.op.type === 'restore')) as Extract<ServerMsg, { t: 'op' }>;
    expect(u.env.by).toBe('p1');
    // Alice damages again; Bob damages the same marker; Alice's undo is refused.
    a.send({ t: 'op', id: 'op-222222', op: { type: 'damageObjectiveMarker', id: markerId, seat: 'p1', delta: 1 } });
    await a.next((m) => m.t === 'op' && m.env.id === 'op-222222');
    b.send({ t: 'op', id: 'op-333333', op: { type: 'damageObjectiveMarker', id: markerId, seat: 'p2', delta: 2 } });
    await a.next((m) => m.t === 'op' && m.env.id === 'op-333333');
    a.send({ t: 'undo' });
    expect(((await a.next((m) => m.t === 'notice')) as { text: string }).text).toContain('Cannot undo');
    a.close();
    b.close();
  });

  it('dice: rolled on the server, marked local when RANDOM.ORG fails, a die re-rolls only once, roll-offs never tie', async () => {
    const code = await newRoom();
    const { c: a } = await join(code, T1, 'p1');
    const { c: b } = await join(code, T2, 'p2');
    a.send({ t: 'roll', count: 6, label: 'Clash vs Militia', target: 3 });
    const r = (await b.next((m) => m.t === 'op' && m.env.op.type === 'rollDice')) as Extract<ServerMsg, { t: 'op' }>;
    const roll = (r.env.op as { roll: { id: string; results: number[]; source: string } }).roll;
    expect(roll.source).toBe('local');
    expect(roll.results).toEqual(roll.results.slice().sort((x, y) => x - y));
    a.send({ t: 'reroll', id: roll.id, indices: [0, 2] });
    await b.next((m) => m.t === 'op' && m.env.op.type === 'rerollDice');
    a.send({ t: 'reroll', id: roll.id, indices: [2] });
    expect(((await a.next((m) => m.t === 'notice')) as { text: string }).text).toContain('only once');
    b.send({ t: 'reroll', id: roll.id, indices: [1] });
    expect(((await b.next((m) => m.t === 'notice')) as { text: string }).text).toContain('Only the player who rolled');
    b.send({ t: 'rolloff' });
    const ro = (await a.next((m) => m.t === 'op' && m.env.op.type === 'rollDice' && m.env.op.roll.kind === 'rolloff')) as Extract<ServerMsg, { t: 'op' }>;
    const pair = (ro.env.op as { roll: { results: number[] } }).roll.results;
    expect(pair).toHaveLength(2);
    expect(pair[0]).not.toBe(pair[1]);
    a.close();
    b.close();
  });

  it('a reconnecting client gets only what it missed, and the same seat back', async () => {
    const code = await newRoom();
    const { c: a, w } = await join(code, T1, 'p1');
    const { c: b } = await join(code, T2, 'p2');
    const seq0 = w.seq;
    a.close();
    b.send({ t: 'op', id: 'op-444444', op: { type: 'chat', text: 'are you there?' } });
    await b.next((m) => m.t === 'op' && m.env.id === 'op-444444');
    const a2 = await connect(wsUrl);
    a2.send({ t: 'hello', room: code, token: T1, lastSeq: seq0 + 1 }); // it had seen its own seat-name op
    const w2 = (await a2.next((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>;
    expect(w2.seat).toBe('p1');
    expect(w2.battle).toBeUndefined();
    expect(w2.ops!.map((e) => e.id)).toContain('op-444444');
    a2.close();
    b.close();
  });

  it('rooms survive a server restart (snapshot + replayed operations)', async () => {
    const code = await newRoom();
    const { c: a } = await join(code, T1, 'p1', 'Alice');
    for (let i = 0; i < SNAPSHOT_EVERY + 5; i++) {
      a.send({ t: 'op', id: `op-chat-${i}`, op: { type: 'chat', text: `message ${i}` } });
      await a.next((m) => m.t === 'op' && m.env.id === `op-chat-${i}`);
    }
    a.send({ t: 'op', id: 'op-reg-01', op: { type: 'addRegiment', regiment: militia('mil', 'p1') } });
    await a.next((m) => m.t === 'op' && m.env.id === 'op-reg-01');
    const before = await (await fetch(`${base}/api/rooms/${code}/export`)).json();
    a.close();
    await new Promise((r) => setTimeout(r, 100));
    // The op file holds only what came after the last snapshot.
    const ops = (await readFile(path.join(dir, `${code}.ops.jsonl`), 'utf8')).split('\n').filter(Boolean);
    expect(ops.length).toBeLessThan(SNAPSHOT_EVERY);
    await app.close();
    await start();
    const { w } = await join(code, T1);
    expect(w.seat).toBe('p1');
    expect(JSON.stringify(w.battle)).toBe(JSON.stringify(before));
  });

  it('a room the server lost is restored from a seated player\'s copy; the other player gets their seat back', async () => {
    const code = await newRoom();
    const { c: a } = await join(code, T1, 'p1', 'Alice');
    const { c: b } = await join(code, T2, 'p2', 'Bob');
    a.send({ t: 'op', id: 'op-reg-02', op: { type: 'addRegiment', regiment: militia('mil', 'p1') } });
    await b.next((m) => m.t === 'op' && m.env.id === 'op-reg-02');
    const copy = (await (await fetch(`${base}/api/rooms/${code}/export`)).json()) as import('@conquest/shared').Battle;
    a.close();
    b.close();
    // A restart without a persistent disk: everything is gone.
    await app.close();
    await rm(dir, { recursive: true, force: true });
    await start();
    const probe = await connect(wsUrl);
    const closed = new Promise<number>((r) => probe.ws.on('close', (c) => r(c)));
    probe.send({ t: 'hello', room: code, token: T1 });
    expect(await closed).toBe(4004);

    const recover = (body: unknown) => fetch(`${base}/api/rooms/${code}/recover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await recover({ token: T1, seat: 'p1', battle: { ...copy, regiments: 'lots' } })).status).toBe(400);
    const dangling = { ...copy, regiments: copy.regiments.map((r) => ({ ...r, characterId: 'ghost' })) };
    expect((await recover({ token: T1, seat: 'p1', battle: dangling })).status).toBe(400);
    expect((await recover({ token: T1, seat: 'p1', name: 'Alice', battle: copy })).status).toBe(200);
    expect((await recover({ token: T2, seat: 'p2', name: 'Bob', battle: copy })).status).toBe(409);

    const a2 = await connect(wsUrl);
    a2.send({ t: 'hello', room: code, token: T1, lastSeq: copy.seq, wasSeat: 'p1' });
    const wa = (await a2.next((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>;
    expect(wa.seat).toBe('p1');
    expect(wa.isHost).toBe(true);
    expect(wa.ops!.map((e) => e.op.type)).toEqual(['logNote']);
    // Bob comes back: his seat is still free, so he gets it.
    const b2 = await connect(wsUrl);
    b2.send({ t: 'hello', room: code, token: T2, lastSeq: copy.seq, wasSeat: 'p2' });
    const wb = (await b2.next((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>;
    expect(wb.seat).toBe('p2');
    // Somebody else claiming to have been p2 is only a spectator.
    const s3 = await connect(wsUrl);
    s3.send({ t: 'hello', room: code, token: T3, wasSeat: 'p2' });
    expect(((await s3.next((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>).seat).toBeNull();
    s3.close();
    b2.send({ t: 'op', id: 'op-wound-1', op: { type: 'applyWounds', id: 'mil', count: 1 } });
    await a2.next((m) => m.t === 'op' && m.env.id === 'op-wound-1');
    a2.close();
    b2.close();
  });

  it('command stacks: the order stays secret until each card is flipped, and survives a restart', async () => {
    const code = await newRoom();
    const { c: a } = await join(code, T1, 'p1', 'Alice');
    const { c: b } = await join(code, T2, 'p2', 'Bob');
    const { c: s } = await join(code, T3);
    for (const id of ['mil', 'bow', 'cav']) {
      a.send({ t: 'op', id: `op-add-${id}`, op: { type: 'addRegiment', regiment: militia(id, 'p1') } });
      await b.next((m) => m.t === 'op' && m.env.id === `op-add-${id}`);
    }
    const order = ['cav', 'mil', 'bow'];
    a.send({ t: 'stack', action: { t: 'set', cards: order.map((id) => ({ kind: 'regiment', id })) } });
    const mine = (await a.next((m) => m.t === 'stack' && m.cards.length > 0)) as Extract<ServerMsg, { t: 'stack' }>;
    expect(mine.cards.map((x) => x.id)).toEqual(order);
    a.send({ t: 'stack', action: { t: 'lock' } });
    const lock = (await b.next((m) => m.t === 'op' && m.env.op.type === 'lockCommandStack')) as Extract<ServerMsg, { t: 'op' }>;
    expect(lock.env.op).toEqual({ type: 'lockCommandStack', seat: 'p1', size: 3 });
    // Bob may not touch Alice's stack (his actions only ever reach his own) and spectators have none.
    b.send({ t: 'stack', action: { t: 'flip' } });
    expect(((await b.next((m) => m.t === 'notice')) as { text: string }).text).toContain('Lock the stack first');
    s.send({ t: 'stack', action: { t: 'flip' } });
    expect(((await s.next((m) => m.t === 'notice')) as { text: string }).text).toContain('Spectators');

    a.send({ t: 'stack', action: { t: 'flip' } });
    const flip = (await b.next((m) => m.t === 'op' && m.env.op.type === 'revealCommandCard')) as Extract<ServerMsg, { t: 'op' }>;
    expect(flip.env.op).toMatchObject({ seat: 'p1', card: { id: 'cav' } });
    expect(flip.env.by).toBe('p1');

    // Nothing Bob or the spectator received names the cards still hidden.
    for (const c of [b, s]) {
      expect(c.msgs.some((m) => m.t === 'stack' && m.cards.length > 0)).toBe(false);
      expect(JSON.stringify(c.msgs).match(/"id":"(mil|bow)","name"/)).toBeNull();
    }

    // A restart keeps the secret order.
    a.close();
    b.close();
    s.close();
    await new Promise((r) => setTimeout(r, 100));
    await app.close();
    await start();
    const { w } = await join(code, T1);
    expect(w.stack!.map((x) => x.id)).toEqual(['mil', 'bow']);
    expect(w.battle!.command.p1).toMatchObject({ round: 1, locked: true, size: 3 });
  });

  it('wasSeat does nothing in a room that was not recovered', async () => {
    const code = await newRoom();
    const c = await connect(wsUrl);
    c.send({ t: 'hello', room: code, token: T3, wasSeat: 'p1' });
    expect(((await c.next((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>).seat).toBeNull();
    c.close();
  });

  it('rate-limits and size-limits messages', async () => {
    const code = await newRoom();
    const { c: a } = await join(code, T1, 'p1');
    // 300 messages at once: the burst allowance lets some through, the rest are dropped.
    for (let i = 0; i < 300; i++) a.send({ t: 'op', id: `op-flood-${i}`, op: { type: 'chat', text: 'spam' } });
    await new Promise((r) => setTimeout(r, 300));
    const delivered = a.msgs.filter((m) => m.t === 'op' && m.env.op.type === 'chat').length;
    expect(delivered).toBeGreaterThan(10);
    expect(delivered).toBeLessThan(150);
    const big = 'x'.repeat(300 * 1024);
    const closed = new Promise<number>((r) => a.ws.on('close', (c) => r(c)));
    a.ws.send(JSON.stringify({ t: 'op', id: 'op-big000', op: { type: 'chat', text: big } }));
    expect(await closed).toBe(1009); // message too big
  });
});
