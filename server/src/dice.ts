// Server-side dice. True random numbers come from the RANDOM.ORG JSON-RPC
// Basic API (generateIntegers, 1..6 with replacement), kept in a pool so a
// free developer key (1,000 requests / 250,000 bits a day) lasts: 300 dice per
// request, refilled in the background when fewer than 60 remain.
//
// Fallback to Node's crypto.randomInt(1, 7) when no key is set, the quota is
// gone, the API errors, or it takes over 3 seconds. Every roll records which
// source it used.

import { randomInt } from 'node:crypto';
import type { DiceStatus } from '@conquest/shared';

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

export interface DiceOptions {
  client: RandomOrgClient | null;
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
  source: 'random.org' | 'local';
}

const isDie = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 6;

export class DiceService {
  private pool: number[] = [];
  private refilling: Promise<void> | null = null;
  private blockedUntil = 0;
  private info: Omit<DiceStatus, 'configured' | 'pool'> = {};
  private readonly o: Required<Omit<DiceOptions, 'client'>> & { client: RandomOrgClient | null };

  constructor(opts: DiceOptions) {
    this.o = {
      client: opts.client,
      poolSize: opts.poolSize ?? 300,
      refillBelow: opts.refillBelow ?? 60,
      timeoutMs: opts.timeoutMs ?? 3000,
      retryAfterMs: opts.retryAfterMs ?? 60_000,
      local: opts.local ?? (() => randomInt(1, 7)),
      now: opts.now ?? Date.now,
    };
  }

  status(): DiceStatus {
    return { configured: !!this.o.client, pool: this.pool.length, ...this.info };
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

  /** Roll n dice. All dice of one roll come from the same source. */
  async roll(n: number): Promise<RollResult> {
    if (this.o.client) {
      if (this.pool.length < n) await this.refill();
      if (this.pool.length >= n) {
        const values = this.pool.splice(0, n);
        if (this.pool.length < this.o.refillBelow) void this.refill();
        return { values, source: 'random.org' };
      }
    }
    return { values: Array.from({ length: n }, () => this.o.local()), source: 'local' };
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
