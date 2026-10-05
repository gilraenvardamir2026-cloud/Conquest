// Random ids for entities and operations. Uses getRandomValues, which works in
// browsers on plain http (unlike randomUUID) and in Node.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function makeId(length = 12): string {
  const bytes = new Uint8Array(length);
  (globalThis as unknown as { crypto: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}
