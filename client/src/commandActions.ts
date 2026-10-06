// Command stack actions. Online the server deals (it keeps the secret order
// and answers with our stack); offline this browser deals for both seats with
// the same shared rules.

import { dealStack, type CommandCard, type StackAction } from '@conquest/shared';
import { sendToServer, useStore } from './store';

export function stackAction(action: StackAction): boolean {
  const st = useStore.getState();
  const seat = st.seat;
  if (!seat) {
    st.notify('Spectators have no command stack', 'error');
    return false;
  }
  if (st.mode === 'online') {
    if (st.net.status !== 'online') {
      st.notify('Disconnected — reconnecting. Changes are paused.', 'error');
      return false;
    }
    // Building is private: show the new order at once; the server's answer confirms it.
    if (action.t === 'set') {
      const d = dealStack(st.battle, seat, st.stacks[seat] ?? [], action);
      if (!d.ok) {
        st.notify(d.error, 'error');
        return false;
      }
      st.setStack(seat, d.secret);
    }
    return sendToServer({ t: 'stack', action });
  }
  const d = dealStack(st.battle, seat, st.stacks[seat] ?? [], action);
  if (!d.ok) {
    st.notify(d.error, 'error');
    return false;
  }
  if (d.op && !st.dispatch(d.op)) return false;
  st.setStack(seat, d.secret);
  return true;
}

/** Replace the draft stack (only while it is not locked). */
export const setDraft = (cards: CommandCard[]) => stackAction({ t: 'set', cards: cards.map(({ kind, id }) => ({ kind, id })) });
