// Bottom panel: the operation log, filterable by player, with a one-line chat box.

import { useEffect, useRef, useState } from 'react';
import { dispatch, useStore } from '../store';

type Filter = 'all' | 'p1' | 'p2' | 'chat';

export function LogPanel() {
  const log = useStore((s) => s.battle.log);
  const players = useStore((s) => s.battle.players);
  const [filter, setFilter] = useState<Filter>('all');
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const rows = log.filter((e) => (filter === 'all' ? true : filter === 'chat' ? e.kind === 'chat' : e.by === filter));

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  return (
    <div className="log-panel">
      <div className="log-head">
        <strong>Log</strong>
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter log">
          <option value="all">All</option>
          <option value="p1">{players.p1.name}</option>
          <option value="p2">{players.p2.name}</option>
          <option value="chat">Messages</option>
        </select>
        <form
          className="chat"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && dispatch({ type: 'chat', text: text.trim() })) setText('');
          }}
        >
          <input type="text" aria-label="Chat message" placeholder="Message to the other player…" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
          <button type="submit">Send</button>
        </form>
      </div>
      <div className="log-list" ref={listRef} tabIndex={0} role="log" aria-label="Battle log">
        {rows.length === 0 && <div className="muted small">Nothing yet. Every change is recorded here.</div>}
        {rows.map((e) => {
          const color = e.by === 'p1' || e.by === 'p2' ? players[e.by].color : '#666';
          const who = e.by === 'p1' || e.by === 'p2' ? players[e.by].name : e.by;
          return (
            <div key={`${e.seq}-${e.id}`} className={`log-row ${e.kind}`}>
              <span className="time">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span className="who" style={{ color }}>
                {e.by.toUpperCase()}
              </span>
              <span className="text">{e.kind === 'chat' ? `${who}: “${e.text}”` : e.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
