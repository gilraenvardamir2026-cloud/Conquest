// Command stacks: each player orders the command cards of their units for the
// round, then flips them one at a time to show what activates. The reducer
// only sees the public part (how many cards, which were flipped); the order
// of the rest is kept by whoever deals (the server online, the browser offline).

import type { Op } from './ops';
import type { Battle, CommandCard, PlayerSeat } from './types';

/** Most cards a stack may hold. */
export const MAX_STACK = 100;

/** The cards a seat can put in its stack: every regiment and character not destroyed. */
export function availableCards(b: Battle, seat: PlayerSeat): CommandCard[] {
  return [
    ...b.regiments.filter((r) => r.owner === seat && r.location !== 'destroyed').map((r) => ({ kind: 'regiment' as const, id: r.id, name: r.name })),
    ...b.characters.filter((c) => c.owner === seat && c.location !== 'destroyed').map((c) => ({ kind: 'character' as const, id: c.id, name: c.name })),
  ];
}

export const sameCard = (a: { kind: string; id: string }, b: { kind: string; id: string }) => a.kind === b.kind && a.id === b.id;

/**
 * Check a stack a player built: their own units, not destroyed, each at most
 * once. Returns the cards with their current names, or a reason.
 */
export function checkStack(b: Battle, seat: PlayerSeat, cards: { kind: string; id: string }[]): { ok: true; cards: CommandCard[] } | { ok: false; error: string } {
  if (cards.length > MAX_STACK) return { ok: false, error: 'Too many cards' };
  const avail = availableCards(b, seat);
  const out: CommandCard[] = [];
  for (const c of cards) {
    const card = avail.find((a) => sameCard(a, c));
    if (!card) return { ok: false, error: 'A card in the stack is not one of your units' };
    if (out.some((o) => sameCard(o, card))) return { ok: false, error: `${card.name} is in the stack twice` };
    out.push(card);
  }
  return { ok: true, cards: out };
}

/** Reserve units whose card can still join this round's locked stack. */
export function reserveCards(b: Battle, seat: PlayerSeat, secret: CommandCard[]): CommandCard[] {
  const used = [...secret, ...b.command[seat].revealed];
  const inReserve = (c: CommandCard) =>
    c.kind === 'regiment' ? b.regiments.find((r) => r.id === c.id)?.location === 'reserve' : b.characters.find((x) => x.id === c.id)?.location === 'reserve';
  return availableCards(b, seat).filter((c) => inReserve(c) && !used.some((u) => sameCard(u, c)));
}

/** The card flipped most recently by either player, if any. */
export function lastRevealed(b: Battle): (CommandCard & { at: number; seat: PlayerSeat }) | null {
  let best: (CommandCard & { at: number; seat: PlayerSeat }) | null = null;
  for (const seat of ['p1', 'p2'] as const) {
    const r = b.command[seat].revealed.at(-1);
    if (r && (!best || r.at >= best.at)) best = { ...r, seat };
  }
  return best;
}

/** What a player can do with their stack. */
export type StackAction =
  | { t: 'set'; cards: { kind: string; id: string }[] }
  | { t: 'lock' }
  | { t: 'unlock' }
  | { t: 'flip' }
  | { t: 'unflip' }
  | { t: 'clear' }
  /** Put a reserve unit's card into a locked stack; position 0 = on top. */
  | { t: 'insert'; card: { kind: string; id: string }; position: number };

/**
 * The dealer's side of a stack action: the seat's new secret stack and the
 * public operation to apply (if any). The caller applies the operation and
 * keeps the new secret only if the reducer accepts it.
 */
export function dealStack(
  b: Battle,
  seat: PlayerSeat,
  secret: CommandCard[],
  action: StackAction,
): { ok: true; secret: CommandCard[]; op?: Op } | { ok: false; error: string } {
  const pub = b.command[seat];
  switch (action.t) {
    case 'set': {
      if (pub.locked) return { ok: false, error: 'The stack is locked; rebuild it first' };
      const r = checkStack(b, seat, action.cards);
      return r.ok ? { ok: true, secret: r.cards } : r;
    }
    case 'lock': {
      if (pub.locked) return { ok: false, error: 'The stack is already locked' };
      const r = checkStack(b, seat, secret);
      if (!r.ok) return r;
      if (!r.cards.length) return { ok: false, error: 'Put at least one card in the stack' };
      return { ok: true, secret: r.cards, op: { type: 'lockCommandStack', seat, size: r.cards.length } };
    }
    case 'unlock':
      return { ok: true, secret, op: { type: 'unlockCommandStack', seat } };
    case 'flip': {
      if (!pub.locked) return { ok: false, error: 'Lock the stack first' };
      const [top, ...rest] = secret;
      if (!top) return { ok: false, error: 'No cards left to flip' };
      return { ok: true, secret: rest, op: { type: 'revealCommandCard', seat, card: top } };
    }
    case 'unflip': {
      const last = pub.revealed.at(-1);
      if (!last) return { ok: false, error: 'No card to take back' };
      return { ok: true, secret: [{ kind: last.kind, id: last.id, name: last.name }, ...secret], op: { type: 'unrevealCommandCard', seat } };
    }
    case 'clear':
      return { ok: true, secret: [], op: { type: 'clearCommandStack', seat } };
    case 'insert': {
      if (!pub.locked) return { ok: false, error: 'Lock the stack first (or simply add the card while building)' };
      const card = reserveCards(b, seat, secret).find((c) => sameCard(c, action.card));
      if (!card) return { ok: false, error: 'Only a reserve unit not already in this round\'s stack can be added' };
      const at = Math.max(0, Math.min(secret.length, Math.floor(Number(action.position) || 0)));
      return { ok: true, secret: [...secret.slice(0, at), card, ...secret.slice(at)], op: { type: 'addCommandCard', seat } };
    }
  }
}
