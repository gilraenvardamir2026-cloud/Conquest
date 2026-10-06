// Server-side dice, from one of:
//  - drand (the default): the next round of the free public quicknet beacon,
//    published every 3 seconds, turned into dice by the rule in
//    shared/src/drand.ts; each roll records its round so players can check it;
//  - RANDOM.ORG, when RANDOM_ORG_API_KEY is set: the JSON-RPC Basic API
//    (generateIntegers, 1..6 with replacement), kept in a pool so a free
//    developer key (1,000 requests / 250,000 bits a day) lasts: 300 dice per
//    request, refilled in the background when fewer than 60 remain.
//
// Fallback to Node's crypto.randomInt(1, 7) when the source errors or is too
// slow. Every roll records which source it used.

import { randomInt } from 'node:crypto';
import { DRAND_CHAIN, DRAND_GENESIS, DRAND_HOSTS, DRAND_PERIOD, diceFromRandomness, fetchBeacon, roundAt, roundTime } from '@conquest/shared';
import type { DiceStatus, DrandBeacon, DrandDraw, DrandTiming } from '@conquest/shared';

const ENDPOINT = 'https://api.random.org/json-rpc/4/invoke';

export interface RandomOrgClient {
  generateIntegers(n: number, signal: AbortSignal): Promise<{ data: number[]; bitsLeft?: number; requestsLeft?: number }>;
  getUsage(signal: AbortSignal): Promise<{ bitsLeft: number; requestsLeft: number; status: string }>;
}

/** Minimal JSON-RPC client for RANDOM.ORG. The key never leaves the server. */
export function randomOrgClient(apiKey: string): RandomOrgClient {
  let nextId = 1;
  const call = async (method: string, params: Record<string, unknown>, signal: AbortSignal) => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params: { apiKey, ...params }, id: nextId++ }),
      signal,
    });
    if (!res.ok) throw new Error(`RANDOM.ORG HTTP ${res.status}`);
    const body = (await res.json()) as { result?: Record<string, unknown>; error?: { code: number; message: string } };
    if (body.error) throw new Error(`RANDOM.ORG ${body.error.code}: ${body.error.message}`);
    if (!body.result) throw new Error('RANDOM.ORG: empty result');
    return body.result;
  };
  return {
    async generateIntegers(n, signal) {
      const r = await call('generateIntegers', { n, min: 1, max: 6, replacement: true }, signal);
      const random = r.random as { data: number[] };
      return { data: random.data, bitsLeft: r.bitsLeft as number, requestsLeft: r.requestsLeft as number };
    },
    async getUsage(signal) {
      const r = await call('getUsage', {}, signal);
      return { bitsLeft: r.bitsLeft as number, requestsLeft: r.requestsLeft as number, status: String(r.status) };
    },
  };
}

/** Where drand rounds come from (the public relays; a fake in tests). */
export interface DrandSource {
  beacon(round: number, signal: AbortSignal): Promise<DrandBeacon>;
  timing(signal: AbortSignal): Promise<DrandTiming>;
}

export function drandSource(): DrandSource {
  return {
    beacon: (round, signal) => fetchBeacon(round, undefined, signal),
    async timing(signal) {
      for (const host of DRAND_HOSTS) {
        try {
          const res = await fetch(`${host}/${DRAND_CHAIN}/info`, { signal });
          if (!res.ok) continue;
          const info = (await res.json()) as { genesis_time?: number; period?: number };
          if (typeof info.genesis_time === 'number' && typeof info.period === 'number') return { genesis: info.genesis_time, period: info.period };
        } catch {
          if (signal.aborted) break;
        }
      }
      return { genesis: DRAND_GENESIS, period: DRAND_PERIOD };
    },
  };
}

export interface DiceOptions {
  /** RANDOM.ORG; when set it is used instead of drand. */
  client: RandomOrgClient | null;
  drand?: DrandSource | null;
  /** How long a drand roll may wait for its round before falling back (ms). */
  drandTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  poolSize?: number;
  refillBelow?: number;
  timeoutMs?: number;
  /** After an API error, wait this long before trying again (ms). */
  retryAfterMs?: number;
  local?: () => number;
  now?: () => number;
}

export interface RollResult {
  values: number[];
  source: 'random.org' | 'drand' | 'local';
  /** drand: the round and key the values came from. */
  draw?: DrandDraw;
}

const isDie = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 6;

export class DiceService {
  private pool: number[] = [];
  private refilling: Promise<void> | null = null;
  private blockedUntil = 0;
  private info: Omit<DiceStatus, 'configured' | 'pool'> = {};
  private readonly o: Required<Omit<DiceOptions, 'client' | 'drand'>> & { client: RandomOrgClient | null; drand: DrandSource | null };
  private timing: DrandTiming | null = null;

  constructor(opts: DiceOptions) {
    this.o = {
      client: opts.client,
      drand: opts.drand ?? null,
      drandTimeoutMs: opts.drandTimeoutMs ?? 6000,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      poolSize: opts.poolSize ?? 300,
      refillBelow: opts.refillBelow ?? 60,
      timeoutMs: opts.timeoutMs ?? 3000,
      retryAfterMs: opts.retryAfterMs ?? 60_000,
      local: opts.local ?? (() => randomInt(1, 7)),
      now: opts.now ?? Date.now,
    };
  }

  status(): DiceStatus {
    const source = this.o.client ? 'random.org' : this.o.drand ? 'drand' : 'local';
    return { source, configured: !!this.o.client, pool: this.pool.length, ...this.info };
  }

  /** Fetch a batch into the pool. Only one request runs at a time; errors are recorded, never thrown. */
  refill(): Promise<void> {
    const client = this.o.client;
    if (!client || this.o.now() < this.blockedUntil) return Promise.resolve();
    if (this.refilling) return this.refilling;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.o.timeoutMs);
    this.refilling = client
      .generateIntegers(this.o.poolSize, ac.signal)
      .then((r) => {
        const good = r.data.filter(isDie);
        if (good.length !== r.data.length) throw new Error('RANDOM.ORG returned values outside 1..6');
        this.pool.push(...good);
        this.info = { ...this.info, bitsLeft: r.bitsLeft, requestsLeft: r.requestsLeft, checkedAt: this.o.now(), lastError: undefined };
      })
      .catch((e: unknown) => {
        this.info = { ...this.info, lastError: ac.signal.aborted ? `RANDOM.ORG took over ${this.o.timeoutMs / 1000} s` : String((e as Error).message ?? e) };
        this.blockedUntil = this.o.now() + this.o.retryAfterMs;
      })
      .finally(() => {
        clearTimeout(timer);
        this.refilling = null;
      });
    return this.refilling;
  }

  /** Roll n dice; `key` names the draw for drand (the roll id). All dice of one roll come from the same source. */
  async roll(n: number, key = ''): Promise<RollResult> {
    if (this.o.client) {
      if (this.pool.length < n) await this.refill();
      if (this.pool.length >= n) {
        const values = this.pool.splice(0, n);
        if (this.pool.length < this.o.refillBelow) void this.refill();
        return { values, source: 'random.org' };
      }
    } else if (this.o.drand) {
      try {
        return await this.drandRoll(n, key);
      } catch (e) {
        this.info = { ...this.info, lastError: String((e as Error).message ?? e) };
      }
    }
    return { values: Array.from({ length: n }, () => this.o.local()), source: 'local' };
  }

  /**
   * Wait for the first drand round published after now (so nobody, the
   * server included, could know it when the roll was asked for), then derive
   * the dice from it.
   */
  private async drandRoll(n: number, key: string): Promise<RollResult> {
    const drand = this.o.drand!;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.o.drandTimeoutMs);
    try {
      this.timing ??= await drand.timing(ac.signal);
      const start = this.o.now();
      const round = roundAt(start, this.timing) + 1;
      await this.o.sleep(Math.max(0, roundTime(round, this.timing) - start) + 100);
      let beacon: DrandBeacon | null = null;
      let lastError: unknown = null;
      while (!beacon && !ac.signal.aborted) {
        try {
          beacon = await drand.beacon(round, ac.signal);
        } catch (e) {
          lastError = e;
          if (!ac.signal.aborted) await this.o.sleep(400); // the relays may need a moment
        }
      }
      if (!beacon) throw new Error(`drand round ${round} did not arrive in ${this.o.drandTimeoutMs / 1000} s${lastError ? ` (${String((lastError as Error).message ?? lastError)})` : ''}`);
      const values = await diceFromRandomness(beacon.randomness, key, n);
      this.info = { ...this.info, lastError: undefined, lastRound: round, checkedAt: this.o.now() };
      return { values, source: 'drand', draw: { round, key, values } };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Ask RANDOM.ORG how much of today's quota is left (called hourly). */
  async checkUsage(): Promise<void> {
    const client = this.o.client;
    if (!client) return;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.o.timeoutMs);
    try {
      const u = await client.getUsage(ac.signal);
      this.info = { ...this.info, bitsLeft: u.bitsLeft, requestsLeft: u.requestsLeft, checkedAt: this.o.now() };
    } catch (e) {
      this.info = { ...this.info, lastError: String((e as Error).message ?? e) };
    } finally {
      clearTimeout(timer);
    }
  }
}
