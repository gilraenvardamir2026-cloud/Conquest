// Dice from drand, the free public randomness beacon run by the League of
// Entropy (Cloudflare, universities and others). Its "quicknet" chain
// publishes a new random value every 3 seconds; nobody can know a value
// before its round, and anyone can fetch any past round.
//
// A roll uses the first round published AFTER the roll was asked for, and
// turns that round's randomness into dice with a fixed rule (below), keyed by
// the roll's id. The roll records the round and key, so either player's
// browser can fetch the round from drand and recompute the dice.
//
// Rule: for block = 0, 1, 2…, h = SHA-256(randomness bytes ‖ UTF-8 "<key>#<block>");
// each byte b of h below 252 gives a die (b mod 6) + 1, bytes 252–255 are
// skipped (so every face is equally likely), until there are enough dice.

/** The quicknet chain (3-second rounds). */
export const DRAND_CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
/** Public relays, tried in order. */
export const DRAND_HOSTS = ['https://api.drand.sh', 'https://api2.drand.sh', 'https://api3.drand.sh', 'https://drand.cloudflare.com'];
/** Quicknet timing, used when the chain's /info cannot be fetched. */
export const DRAND_GENESIS = 1692803367;
export const DRAND_PERIOD = 3;

/** One set of dice taken from one drand round. */
export interface DrandDraw {
  round: number;
  key: string;
  values: number[];
}

export interface DrandBeacon {
  round: number;
  randomness: string;
  signature: string;
}

export interface DrandTiming {
  genesis: number;
  period: number;
}

const QUICKNET: DrandTiming = { genesis: DRAND_GENESIS, period: DRAND_PERIOD };

export const drandRoundUrl = (round: number, host = DRAND_HOSTS[0]) => `${host}/${DRAND_CHAIN}/public/${round}`;
/** The round published at or before this time (ms). */
export const roundAt = (ms: number, t: DrandTiming = QUICKNET) => Math.floor((ms / 1000 - t.genesis) / t.period) + 1;
/** When a round is published (ms). */
export const roundTime = (round: number, t: DrandTiming = QUICKNET) => (t.genesis + (round - 1) * t.period) * 1000;

type Subtle = { digest(alg: string, data: Uint8Array): Promise<ArrayBuffer> };
const subtle = () => (globalThis as unknown as { crypto: { subtle: Subtle } }).crypto.subtle;

const sha256 = async (data: Uint8Array) => new Uint8Array(await subtle().digest('SHA-256', data));

function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new Error('not hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** UTF-8 bytes of a string (no TextEncoder in this package's types). */
function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** drand's randomness is SHA-256 of the round's signature: a quick check that a relay sent a coherent beacon. */
export async function beaconIsCoherent(b: DrandBeacon): Promise<boolean> {
  try {
    return toHex(await sha256(hexToBytes(b.signature))) === b.randomness.toLowerCase();
  } catch {
    return false;
  }
}

/** n dice from a round's randomness and a key (the rule at the top of this file). */
export async function diceFromRandomness(randomness: string, key: string, n: number): Promise<number[]> {
  const seed = hexToBytes(randomness);
  const out: number[] = [];
  for (let block = 0; out.length < n; block++) {
    const tag = utf8(`${key}#${block}`);
    const input = new Uint8Array(seed.length + tag.length);
    input.set(seed);
    input.set(tag, seed.length);
    for (const byte of await sha256(input)) {
      if (byte < 252) out.push((byte % 6) + 1);
      if (out.length === n) break;
    }
  }
  return out;
}

/** The parts of fetch and AbortSignal used here (works with the browser's and Node's). */
type Signal = { readonly aborted: boolean };
type FetchLike = (url: string, init?: { signal?: Signal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const globalFetch = () => (globalThis as unknown as { fetch: FetchLike }).fetch;

/** Fetch one round from the first relay that has it. Throws if none does. */
export async function fetchBeacon(round: number, fetchFn: FetchLike = globalFetch(), signal?: Signal): Promise<DrandBeacon> {
  let last = 'no relay answered';
  for (const host of DRAND_HOSTS) {
    try {
      const res = await fetchFn(drandRoundUrl(round, host), { signal });
      if (!res.ok) {
        last = `drand HTTP ${res.status}`;
        continue;
      }
      const b = (await res.json()) as DrandBeacon;
      if (b.round !== round || typeof b.randomness !== 'string' || typeof b.signature !== 'string') {
        last = 'drand sent an unexpected answer';
        continue;
      }
      if (!(await beaconIsCoherent(b))) {
        last = 'drand beacon failed its check';
        continue;
      }
      return b;
    } catch (e) {
      if (signal?.aborted) throw e;
      last = String((e as Error).message ?? e);
    }
  }
  throw new Error(last);
}

/**
 * Recompute every draw of a roll from drand. Returns null when all match,
 * otherwise what did not.
 */
export async function verifyDraws(draws: DrandDraw[], fetchFn?: FetchLike): Promise<string | null> {
  for (const d of draws) {
    const b = await fetchBeacon(d.round, fetchFn);
    const values = await diceFromRandomness(b.randomness, d.key, d.values.length);
    if (values.join() !== d.values.join()) return `round ${d.round} gives ${values.join(', ')}, not ${d.values.join(', ')}`;
  }
  return null;
}
