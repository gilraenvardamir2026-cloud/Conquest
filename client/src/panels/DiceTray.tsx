// Shared dice tray. Online, every roll happens on the server (RANDOM.ORG with
// a local fallback) and reaches both players at the same moment; offline it
// rolls in the browser. The tray keeps the last 20 rolls.

import { useState } from 'react';
import { makeId, type Battle, type DiceRoll } from '@conquest/shared';
import { rerollDice, rollDice, rollOff } from '../net';
import { useStore } from '../store';
import { NumberField } from '../ui/fields';

/** Offline rolls use the browser's crypto random numbers. */
function localDice(n: number): number[] {
  const out: number[] = [];
  const buf = new Uint32Array(1);
  while (out.length < n) {
    crypto.getRandomValues(buf);
    // Reject the top of the range so every face is equally likely.
    if (buf[0] < 4294967296 - (4294967296 % 6)) out.push((buf[0] % 6) + 1);
  }
  return out;
}

export function DiceTray() {
  const b = useStore((s) => s.battle);
  const mode = useStore((s) => s.mode);
  const seat = useStore((s) => s.seat);
  const status = useStore((s) => s.net.status);
  const [count, setCount] = useState(6);
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState<number | undefined>(undefined);
  const st = useStore.getState();
  const online = mode === 'online';
  const canRoll = !!seat && (!online || status === 'online');

  const roll = () => {
    if (!canRoll) return st.notify(online ? (seat ? 'Disconnected' : 'Spectators cannot roll') : 'Pick a seat');
    if (online) rollDice(count, label, target);
    else {
      const results = localDice(count).sort((x, y) => x - y);
      st.dispatch({
        type: 'rollDice',
        roll: { id: makeId(), by: seat!, label: label.trim(), at: Date.now(), results, rerolled: results.map(() => false), source: 'local', kind: 'roll', ...(target ? { target } : {}) },
      });
    }
  };
  const rolloff = () => {
    if (!canRoll) return;
    if (online) rollOff();
    else {
      const ties: [number, number][] = [];
      let pair = localDice(2);
      while (pair[0] === pair[1]) {
        ties.push([pair[0], pair[1]]);
        pair = localDice(2);
      }
      st.dispatch({ type: 'rollDice', roll: { id: makeId(), by: seat!, label: 'Roll-off', at: Date.now(), results: pair, rerolled: [false, false], source: 'local', kind: 'rolloff', ...(ties.length ? { ties } : {}) } });
    }
  };

  const rolls = b.dice.slice().reverse();
  return (
    <div className="dice-tray" role="dialog" aria-label="Dice tray">
      <header>
        <strong>Dice</strong>
        <button className="icon" title="Close (X)" onClick={() => st.setShowDice(false)}>
          ✕
        </button>
      </header>
      <div className="btn-row">
        <span className="row-label">Dice</span>
        <NumberField value={count} digits={0} step={1} min={1} max={60} width={52} onCommit={(n) => n && setCount(n)} />
        <span className="row-label">Success ≤</span>
        <NumberField value={target} allowEmpty digits={0} step={1} min={1} max={6} width={44} onCommit={(n) => setTarget(n)} />
      </div>
      <div className="btn-row">
        <input type="text" placeholder='Label, e.g. "Clash vs Militia"' value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} className="grow" />
      </div>
      <div className="btn-row">
        <button className="primary" disabled={!canRoll} onClick={roll}>
          Roll {count}
        </button>
        <button disabled={!canRoll} onClick={rolloff} title="One die each; ties re-roll automatically">
          Roll-off
        </button>
      </div>
      <div className="rolls">
        {rolls.length === 0 && <div className="muted small">No rolls yet.</div>}
        {rolls.map((r) => (
          <RollCard key={r.id} r={r} b={b} mine={r.by === seat} canReroll={canRoll && r.by === seat} online={online} />
        ))}
      </div>
    </div>
  );
}

function RollCard({ r, b, mine, canReroll, online }: { r: DiceRoll; b: Battle; mine: boolean; canReroll: boolean; online: boolean }) {
  const [picked, setPicked] = useState<number[]>([]);
  const color = b.players[r.by].color;
  const st = useStore.getState();
  const reroll = () => {
    if (!picked.length) return;
    if (online) rerollDice(r.id, picked);
    else st.dispatch({ type: 'rerollDice', id: r.id, indices: picked, values: localDice(picked.length), source: 'local' });
    setPicked([]);
  };

  if (r.kind === 'rolloff') {
    const low = r.results[0] < r.results[1] ? 0 : 1;
    return (
      <div className="roll" style={{ borderLeftColor: color }}>
        <div className="roll-head">
          <b>Roll-off</b> <span className={`src ${r.source}`}>{r.source === 'random.org' ? 'RANDOM.ORG' : 'local'}</span>
        </div>
        <div className="faces">
          {(['p1', 'p2'] as const).map((s, i) => (
            <div key={s} className="rolloff-side">
              <span className="small" style={{ color: b.players[s].color }}>
                {b.players[s].name}
              </span>
              <span className={`face ${i === low ? 'low' : ''}`} title={i === low ? 'lowest' : undefined}>
                {r.results[i]}
              </span>
            </div>
          ))}
        </div>
        {r.ties?.length ? <div className="muted small">Ties re-rolled: {r.ties.map((t) => t.join('–')).join(', ')}</div> : null}
      </div>
    );
  }

  const successes = r.target !== undefined ? r.results.filter((x) => x <= r.target!).length : undefined;
  return (
    <div className="roll" style={{ borderLeftColor: color }}>
      <div className="roll-head">
        <b style={{ color }}>{b.players[r.by].name}</b> {r.label && <span>“{r.label}”</span>}
        <span className={`src ${r.source}`} title={r.source === 'random.org' ? 'True random numbers from RANDOM.ORG' : 'Rolled with the local fallback'}>
          {r.source === 'random.org' ? 'RANDOM.ORG' : 'local'}
        </span>
      </div>
      <div className="faces">
        {r.results.map((v, i) => {
          const hit = r.target !== undefined && v <= r.target;
          const sel = picked.includes(i);
          const can = canReroll && !r.rerolled[i];
          return (
            <button
              key={i}
              className={`face ${hit ? 'hit' : ''} ${r.rerolled[i] ? 'rerolled' : ''} ${sel ? 'picked' : ''}`}
              disabled={!can}
              aria-pressed={sel}
              title={r.rerolled[i] ? 're-rolled (no further re-roll)' : can ? 'Tick to re-roll' : undefined}
              onClick={() => setPicked(sel ? picked.filter((x) => x !== i) : [...picked, i])}
            >
              {v}
              {r.rerolled[i] && <span className="rr">↻</span>}
            </button>
          );
        })}
      </div>
      <div className="roll-foot">
        {successes !== undefined && (
          <span>
            <b>{successes}</b> success{successes === 1 ? '' : 'es'} (≤ {r.target})
          </span>
        )}
        {mine && picked.length > 0 && (
          <button className="primary" onClick={reroll}>
            Re-roll {picked.length}
          </button>
        )}
      </div>
    </div>
  );
}
