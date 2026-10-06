// Messages between the browser and the server over the room WebSocket.
//
// The server is authoritative: a client sends an operation, the server checks
// it, gives it the next sequence number, applies it, stores it and broadcasts
// it to everyone in the room (the sender included). Presence (cursors, drag
// previews, rulers, LoS) is relayed to the others and never stored.

import type { Facing } from './movement';
import type { MovingPiece } from './measure';
import type { LosMode, LosParty } from './los';
import type { Op, OpEnvelope } from './ops';
import type { StackAction } from './command';
import type { Battle, CommandCard, EntityRef, PlayerSeat } from './types';
import type { Pose, Vec } from './geometry';

/** Live, unsaved state another person sees: about 15 updates per second at most. */
export interface Presence {
  cursor?: Vec | null;
  selection?: { kind: string; id: string } | null;
  tool?: string;
  /** Drag / move-session preview of a regiment or character. */
  move?: { piece: MovingPiece; pose: Pose } | null;
  ruler?: { a: Vec; b: Vec } | null;
  pair?: EntityRef[];
  los?: { acting: LosParty; target: LosParty; mode: LosMode } | null;
  ring?: { ref: EntityRef; radii: { radius: number; label: string }[] } | null;
  align?: { targetKind: 'regiment' | 'objective'; targetId: string; facing: Facing } | null;
}

export type ClientMsg =
  /** wasSeat: the seat this browser held before the server lost the room (see /recover). */
  | { t: 'hello'; room: string; token: string; name?: string; lastSeq?: number; wasSeat?: PlayerSeat }
  | { t: 'claim'; seat: PlayerSeat; name: string }
  | { t: 'op'; id: string; op: Op }
  | { t: 'undo' }
  | { t: 'presence'; p: Presence }
  | { t: 'roll'; count: number; label: string; target?: number }
  | { t: 'reroll'; id: string; indices: number[] }
  | { t: 'rolloff' }
  | { t: 'freeSeat'; seat: PlayerSeat }
  /** Build, lock, flip, take back or clear your command stack. */
  | { t: 'stack'; action: StackAction }
  /** After the server lost the room: give back the stack this browser remembers. */
  | { t: 'stackRestore'; cards: { kind: 'regiment' | 'character'; id: string }[] }
  | { t: 'ping' };

export interface SeatInfo {
  taken: boolean;
  name: string;
  connected: boolean;
}
export type SeatsInfo = Record<PlayerSeat, SeatInfo>;

export interface DiceStatus {
  /** Where dice come from when all is well. */
  source?: 'random.org' | 'drand' | 'local';
  /** A RANDOM.ORG API key is set on the server. */
  configured: boolean;
  /** Dice waiting in the server-side pool. */
  pool: number;
  bitsLeft?: number;
  requestsLeft?: number;
  checkedAt?: number;
  lastError?: string;
  /** drand: the round of the last roll. */
  lastRound?: number;
}

export type ServerMsg =
  | {
      t: 'welcome';
      clientId: string;
      seat: PlayerSeat | null;
      isHost: boolean;
      seats: SeatsInfo;
      spectators: number;
      seq: number;
      /** Full document, or… */
      battle?: Battle;
      /** …only what the client missed since its lastSeq. */
      ops?: OpEnvelope[];
      dice: DiceStatus;
      /** Your command stack's secret part (cards not yet flipped, top first). */
      stack?: CommandCard[];
    }
  | { t: 'op'; env: OpEnvelope }
  | { t: 'reject'; id: string; error: string }
  | { t: 'you'; seat: PlayerSeat | null; isHost: boolean }
  | { t: 'seats'; seats: SeatsInfo; spectators: number }
  | { t: 'presence'; from: string; seat: PlayerSeat | 'spectator'; name: string; p: Presence | null }
  | { t: 'dice'; dice: DiceStatus }
  /** Your command stack's secret part changed (sent only to its owner). */
  | { t: 'stack'; cards: CommandCard[] }
  | { t: 'notice'; text: string; kind?: 'info' | 'error' }
  | { t: 'pong' };

/** Room codes: 6 characters without look-alikes (no 0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export function normalizeRoomCode(s: string): string | null {
  const code = s.trim().toUpperCase().replace(/^.*\//, '');
  return ROOM_CODE_RE.test(code) ? code : null;
}
