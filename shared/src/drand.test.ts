import { beforeAll, describe, expect, it } from 'vitest';
import { beaconIsCoherent, diceFromRandomness, fetchBeacon, roundAt, roundTime, verifyDraws, type DrandBeacon } from './drand';

const subtle = (globalThis as unknown as { crypto: { subtle: { digest(a: string, d: Uint8Array): Promise<ArrayBuffer> } } }).crypto.subtle;
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!, (x) => parseInt(x, 16));

/** A made-up beacon whose randomness is SHA-256 of its signature, as drand's are. */
const beacons: Record<number, DrandBeacon> = {};
async function makeBeacon(round: number): Promise<DrandBeacon> {
  const signature = round.toString(16).padStart(2, '0').repeat(48); // 48 bytes, like a quicknet signature
  return (beacons[round] = { round, signature, randomness: hex(await subtle.digest('SHA-256', fromHex(signature))) });
}
const beaconFor = (round: number) => beacons[round];
const fakeFetch = (beacons: Record<number, DrandBeacon>) => async (url: string) => {
  const round = Number(url.split('/').pop());
  const b = beacons[round];
  return { ok: !!b, status: b ? 200 : 404, json: async () => b };
};

describe('drand dice', () => {
  beforeAll(async () => {
    for (const r of [1, 7, 8, 9]) await makeBeacon(r);
  });

  it('are deterministic per round and key, all faces 1–6, close to uniform', async () => {
    const r = beaconFor(1).randomness;
    expect(await diceFromRandomness(r, 'abc', 10)).toEqual(await diceFromRandomness(r, 'abc', 10));
    expect(await diceFromRandomness(r, 'abc', 10)).not.toEqual(await diceFromRandomness(r, 'abd', 10));
    // The first dice of a longer draw are the same as a shorter draw's.
    expect((await diceFromRandomness(r, 'k', 40)).slice(0, 5)).toEqual(await diceFromRandomness(r, 'k', 5));
    const many = await diceFromRandomness(r, 'big', 60_000);
    const counts = [1, 2, 3, 4, 5, 6].map((f) => many.filter((v) => v === f).length);
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(400); // > 4 standard deviations
  });

  it('round timing: the next round after a moment is published after it', () => {
    const t = { genesis: 1_000, period: 3 };
    const now = roundTime(50, t) + 1_200;
    expect(roundAt(now, t)).toBe(50);
    expect(roundTime(roundAt(now, t) + 1, t)).toBeGreaterThan(now);
  });

  it('checks beacons and verifies recorded draws', async () => {
    const b = beaconFor(7);
    expect(await beaconIsCoherent(b)).toBe(true);
    expect(await beaconIsCoherent({ ...b, randomness: beaconFor(8).randomness })).toBe(false);
    const fetchFn = fakeFetch({ 7: b, 8: { ...beaconFor(8), randomness: beaconFor(9).randomness } });
    expect((await fetchBeacon(7, fetchFn)).round).toBe(7);
    await expect(fetchBeacon(8, fetchFn)).rejects.toThrow('failed its check');
    const values = await diceFromRandomness(b.randomness, 'roll1', 6);
    expect(await verifyDraws([{ round: 7, key: 'roll1', values }], fetchFn)).toBeNull();
    const forged = values.map((v) => (v % 6) + 1);
    expect(await verifyDraws([{ round: 7, key: 'roll1', values: forged }], fetchFn)).toContain('round 7 gives');
  });
});
