// Command stacks: build your stack for the round from your army's cards, lock
// it, then flip the cards one at a time. Your opponent sees how many cards you
// hold and each card as you flip it, never the order of the rest.

import { useState } from 'react';
import { availableCards, lastRevealed, regimentCenter, sameCard, type Battle, type PlayerSeat } from '@conquest/shared';
import { setDraft, stackAction } from '../commandActions';
import { useStore } from '../store';

const kindTag = (c: { kind: string }) => (c.kind === 'character' ? '★ ' : '');

/** Select a card's unit and centre the board on it (a character: its regiment). */
function showOnBoard(b: Battle, card: { kind: string; id: string }) {
  const st = useStore.getState();
  const ch = card.kind === 'character' ? b.characters.find((c) => c.id === card.id) : undefined;
  const regId = card.kind === 'regiment' ? card.id : ch?.attachedTo;
  const r = regId ? b.regiments.find((x) => x.id === regId) : undefined;
  if (ch && !r) return st.select({ kind: 'character', id: ch.id });
  if (!r) return st.notify('That unit is no longer in the battle');
  st.select({ kind: 'regiment', id: r.id });
  if (r.location === 'board') {
    const c = regimentCenter(r);
    st.centreOn(c.x, c.y);
  }
}

export function CommandTray() {
  const b = useStore((s) => s.battle);
  const seat = useStore((s) => s.seat);
  const mode = useStore((s) => s.mode);
  const st = useStore.getState();
  const last = lastRevealed(b);
  const other: PlayerSeat | null = seat ? (seat === 'p1' ? 'p2' : 'p1') : null;
  const seats: PlayerSeat[] = seat ? [other!] : ['p1', 'p2'];

  return (
    <section className="command-tray" role="dialog" aria-label="Command stacks">
      <div className="tray-head">
        <strong>Command stacks</strong>
        <button className="icon" title="Close (C)" aria-label="Close command stacks" onClick={() => st.setShowCommand(false)}>
          ✕
        </button>
      </div>
      {last && (
        <div className="activating" style={{ borderColor: b.players[last.seat].color }} aria-live="polite">
          <span className="muted small">Now activating</span>
          <button className="link big" onClick={() => showOnBoard(b, last)} title="Show it on the board">
            {kindTag(last)}
            {last.name}
          </button>
          <span className="muted small">
            {b.players[last.seat].name} · card {b.command[last.seat].revealed.length}/{b.command[last.seat].size}
          </span>
        </div>
      )}
      <div className="command-body">
        {seat && <MyStack seat={seat} b={b} offline={mode === 'local'} />}
        {seats.map((s) => (
          <PublicStack key={s} seat={s} b={b} />
        ))}
      </div>
    </section>
  );
}

function MyStack({ seat, b, offline }: { seat: PlayerSeat; b: Battle; offline: boolean }) {
  const stack = useStore((s) => s.stacks[seat]) ?? [];
  const pub = b.command[seat];
  const [drag, setDrag] = useState<number | null>(null);
  const avail = availableCards(b, seat).filter((c) => !stack.some((s) => sameCard(s, c)));
  const move = (i: number, j: number) => {
    if (j < 0 || j >= stack.length) return;
    const next = stack.slice();
    const [c] = next.splice(i, 1);
    next.splice(j, 0, c);
    setDraft(next);
  };

  if (!pub.locked) {
    return (
      <div className="stack-section">
        <h3>
          Your stack <span className="muted small">round {pub.round + 1} · {offline ? `${b.players[seat].name}, ` : ''}only you see the order</span>
        </h3>
        {stack.length ? (
          <ol className="cards" aria-label="Your stack, top card first">
            {stack.map((c, i) => (
              <li
                key={`${c.kind}-${c.id}`}
                className={`card mine ${drag === i ? 'dragging' : ''}`}
                draggable
                onDragStart={() => setDrag(i)}
                onDragEnd={() => setDrag(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => drag !== null && move(drag, i)}
              >
                <span className="pos">{i + 1}</span>
                <span className="name">
                  {kindTag(c)}
                  {c.name}
                </span>
                <button className="icon" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move ${c.name} up`} title="Up">
                  ↑
                </button>
                <button className="icon" disabled={i === stack.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move ${c.name} down`} title="Down">
                  ↓
                </button>
                <button className="icon" onClick={() => setDraft(stack.filter((_, k) => k !== i))} aria-label={`Take ${c.name} out`} title="Take out">
                  ✕
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted small">Add the cards for this round, then order them: the top card is flipped first.</p>
        )}
        {avail.length > 0 && (
          <>
            <div className="avail-head">
              <span className="muted small">Not in the stack</span>
              <button className="link" onClick={() => setDraft([...stack, ...avail])}>
                Add all
              </button>
            </div>
            <ul className="cards avail" aria-label="Cards not in the stack">
              {avail.map((c) => (
                <li key={`${c.kind}-${c.id}`} className="card">
                  <span className="name">
                    {kindTag(c)}
                    {c.name}
                  </span>
                  <button className="icon" onClick={() => setDraft([...stack, c])} aria-label={`Add ${c.name}`} title="Add to the bottom">
                    +
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="btn-row">
          <button className="primary" disabled={!stack.length} onClick={() => stackAction({ t: 'lock' })} title="Lock the order; your opponent sees how many cards you hold">
            Lock stack ({stack.length})
          </button>
          {stack.length > 0 && <button onClick={() => setDraft([])}>Empty</button>}
        </div>
      </div>
    );
  }

  const done = pub.revealed;
  const left = pub.size - done.length;
  return (
    <div className="stack-section">
      <h3>
        Your stack <span className="muted small">round {pub.round} · {left} of {pub.size} left</span>
      </h3>
      <ol className="cards" aria-label="Your stack">
        {done.map((c, i) => (
          <li key={`r${i}`} className="card flipped">
            <span className="pos">{i + 1}</span>
            <span className="name">
              {kindTag(c)}
              {c.name}
            </span>
            <span className="muted small">flipped</span>
          </li>
        ))}
        {stack.map((c, i) => (
          <li key={`s${i}`} className={`card mine ${i === 0 ? 'next' : ''}`}>
            <span className="pos">{done.length + i + 1}</span>
            <span className="name">
              {kindTag(c)}
              {c.name}
            </span>
            {i === 0 && <span className="small">next</span>}
          </li>
        ))}
      </ol>
      <div className="btn-row">
        <button className="primary" disabled={!left} onClick={() => stackAction({ t: 'flip' })} title="Show the next card to your opponent (N)">
          Flip next card
        </button>
        <button disabled={!done.length} onClick={() => stackAction({ t: 'unflip' })} title="Put the last flipped card back on top">
          Take back
        </button>
        {!done.length ? (
          <button onClick={() => stackAction({ t: 'unlock' })} title="Unlock to change the order (nothing flipped yet)">
            Rebuild
          </button>
        ) : (
          <button
            onClick={() => (left === 0 || confirm(`End round ${pub.round} with ${left} card${left === 1 ? '' : 's'} still face down?`)) && stackAction({ t: 'clear' })}
            title="Clear the stack ready for the next round"
          >
            End round
          </button>
        )}
      </div>
    </div>
  );
}

function PublicStack({ seat, b }: { seat: PlayerSeat; b: Battle }) {
  const pub = b.command[seat];
  const p = b.players[seat];
  const left = pub.size - pub.revealed.length;
  return (
    <div className="stack-section">
      <h3>
        <span className="swatch" style={{ background: p.color }} /> {p.name}{' '}
        <span className="muted small">{pub.locked ? `round ${pub.round} · ${left} of ${pub.size} face down` : 'building a stack'}</span>
      </h3>
      {pub.locked && (
        <>
          <div className="backs" role="img" aria-label={`${left} cards face down`}>
            {Array.from({ length: left }, (_, i) => (
              <span key={i} className="back" style={{ background: p.color }} />
            ))}
          </div>
          {pub.revealed.length > 0 && (
            <ol className="cards">
              {pub.revealed.map((c, i) => (
                <li key={i} className={`card flipped ${i === pub.revealed.length - 1 ? 'latest' : ''}`}>
                  <span className="pos">{i + 1}</span>
                  <button className="link name" onClick={() => showOnBoard(b, c)} title="Show it on the board">
                    {kindTag(c)}
                    {c.name}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
