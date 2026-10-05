// Which page this is: the home page, offline practice, or a room (/<CODE>).

import { makeId, normalizeRoomCode } from '@conquest/shared';

export type Route = { page: 'home'; error?: string } | { page: 'local' } | { page: 'room'; code: string };

export function parseRoute(pathname: string): Route {
  const p = pathname.replace(/^\/+|\/+$/g, '');
  if (!p) return { page: 'home' };
  if (p.toLowerCase() === 'local') return { page: 'local' };
  const code = normalizeRoomCode(p);
  return code ? { page: 'room', code } : { page: 'home', error: `"${p}" is not a room code` };
}

export const ROUTE: Route = typeof location === 'undefined' ? { page: 'local' } : parseRoute(location.pathname);

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode: the seat will not survive a refresh */
  }
};

/**
 * A random token kept in this browser. The server gives the seat back to the
 * same token after a refresh or reconnect; it is never shown to others.
 */
export function browserToken(): string {
  let t = read('conquest.token');
  if (!t || t.length < 16) {
    t = makeId(32);
    write('conquest.token', t);
  }
  return t;
}

export const savedName = () => read('conquest.name') ?? '';
export const saveName = (n: string) => write('conquest.name', n);

export function recentRooms(): string[] {
  try {
    return JSON.parse(read('conquest.recentRooms') ?? '[]') as string[];
  } catch {
    return [];
  }
}
export function rememberRoom(code: string) {
  write('conquest.recentRooms', JSON.stringify([code, ...recentRooms().filter((c) => c !== code)].slice(0, 8)));
}
