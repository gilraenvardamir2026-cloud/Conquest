// Online-only overlays: connecting / not found, the disconnected banner and
// the seat chooser.

import { useState } from 'react';
import { claimSeat } from '../net';
import { saveName, savedName } from '../route';
import { useStore } from '../store';

export function RoomOverlays() {
  const mode = useStore((s) => s.mode);
  const net = useStore((s) => s.net);
  const seat = useStore((s) => s.seat);
  const [dismissed, setDismissed] = useState(false);
  if (mode !== 'online') return null;

  if (!net.ready) {
    return (
      <div className="modal-back">
        <div className="modal">
          {net.room === null ? (
            <>
              <h2>Room not found</h2>
              <p>This battle does not exist or has expired (rooms are kept for 30 days after the last change).</p>
              <a href="/">Back to the home page</a>
            </>
          ) : (
            <>
              <h2>Connecting…</h2>
              <p className="muted">Joining room {net.room}.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {net.status !== 'online' && <div className="disconnected">Disconnected — reconnecting… Changes are paused until the connection is back.</div>}
      {!seat && !dismissed && net.status === 'online' && <SeatChooser onWatch={() => setDismissed(true)} />}
    </>
  );
}

function SeatChooser({ onWatch }: { onWatch: () => void }) {
  const seats = useStore((s) => s.net.seats);
  const players = useStore((s) => s.battle.players);
  const [name, setName] = useState(savedName());
  const take = (seat: 'p1' | 'p2') => {
    const n = name.trim() || (seat === 'p1' ? 'Player 1' : 'Player 2');
    saveName(n);
    claimSeat(seat, n);
  };
  return (
    <div className="modal-back">
      <div className="modal">
        <h2>Join this battle</h2>
        <label className="row">
          <span className="row-label">Your name</span>
          <input type="text" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="seat-buttons">
          {(['p1', 'p2'] as const).map((s) => {
            const info = seats?.[s];
            return (
              <button key={s} className="seat-btn" disabled={info?.taken} style={{ borderColor: players[s].color }} onClick={() => take(s)}>
                <b>{s === 'p1' ? 'Player 1' : 'Player 2'}</b>
                <span className="small">{s === 'p1' ? 'bottom edge' : 'top edge'}</span>
                <span className="small muted">{info?.taken ? `taken by ${info.name}${info.connected ? '' : ' (away)'}` : 'free'}</span>
              </button>
            );
          })}
        </div>
        <div className="btn-row end">
          <button onClick={onWatch}>Watch as a spectator</button>
        </div>
        <p className="muted small">This browser keeps your seat: refresh or reconnect and you are back in it.</p>
      </div>
    </div>
  );
}
