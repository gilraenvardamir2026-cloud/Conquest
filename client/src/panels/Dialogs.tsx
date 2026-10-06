// Settings dialog, help overlay and toast.

import { useEffect } from 'react';
import { KEYWORD_INITIALS, STAND_PRESETS, type BattleSettings, type StandType } from '@conquest/shared';
import { dispatch, useStore } from '../store';
import { freeSeat } from '../net';
import { LengthField, NumberField, Row, TextField } from '../ui/fields';
import { Modal } from '../ui/Modal';
import { worstColorDistance } from '../ui/color';

export function SettingsDialog() {
  const b = useStore((s) => s.battle);
  const close = () => useStore.getState().setShowSettings(false);
  const set = (patch: Partial<BattleSettings>) => dispatch({ type: 'updateSettings', patch });
  const s = b.settings;
  const types = Object.keys(STAND_PRESETS) as Exclude<StandType, 'custom'>[];
  return (
    <Modal title="Settings" onClose={close} wide>
      <h3>Players</h3>
      {(['p1', 'p2'] as const).map((seat) => (
        <Row key={seat} label={seat === 'p1' ? 'Player 1 (bottom edge)' : 'Player 2 (top edge)'}>
          <TextField value={b.players[seat].name} onCommit={(name) => dispatch({ type: 'updatePlayer', seat, patch: { name: name || (seat === 'p1' ? 'Player 1' : 'Player 2') } })} />
          <input type="color" value={b.players[seat].color} onChange={(e) => dispatch({ type: 'updatePlayer', seat, patch: { color: e.target.value } })} aria-label={`${seat === 'p1' ? 'Player 1' : 'Player 2'} colour`} data-own-label="1" />
        </Row>
      ))}

      <ColorCheck a={b.players.p1.color} b={b.players.p2.color} />

      <OnlineSettings />

      <h3>Stand presets</h3>
      <p className="muted small">Footprints in inches (type in mm with the unit button; 1" = 25.4 mm). New regiments use these; existing ones keep their size until you change their stand type.</p>
      <table className="presets">
        <thead>
          <tr>
            <th>Type</th>
            <th>Width (front)</th>
            <th>Depth</th>
            <th>LoS size</th>
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t}>
              <td>{t}</td>
              <td>
                <LengthField value={s.standPresets[t].w} label={`${t} width`} onCommit={(w) => set({ standPresets: { ...s.standPresets, [t]: { ...s.standPresets[t], w } } })} />
              </td>
              <td>
                <LengthField value={s.standPresets[t].d} label={`${t} depth`} onCommit={(d) => set({ standPresets: { ...s.standPresets, [t]: { ...s.standPresets[t], d } } })} />
              </td>
              <td>
                <NumberField value={s.standPresets[t].size} label={`${t} LoS size`} digits={0} step={1} min={0} max={10} width={44} onCommit={(size) => size !== undefined && set({ standPresets: { ...s.standPresets, [t]: { ...s.standPresets[t], size } } })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => set({ standPresets: STAND_PRESETS })}>Reset presets</button>

      <h3>Stands and characters</h3>
      <Row label="Ask before removing a destroyed stand">
        <input type="checkbox" checked={s.confirmStandRemoval} onChange={(e) => set({ confirmStandRemoval: e.target.checked })} />
      </Row>
      <Row label="Two stands equally far from the command stand">
        <select value={s.woundTies ?? 'ask'} onChange={(e) => set({ woundTies: e.target.value as BattleSettings['woundTies'] })}>
          <option value="ask">ask which one takes the wound</option>
          <option value="left">the left one takes it</option>
        </select>
      </Row>
      <Row label="Close ranks when a character leaves">
        <input type="checkbox" checked={s.reformOnDetach !== false} onChange={(e) => set({ reformOnDetach: e.target.checked })} />
      </Row>
      <Row label="Character joins on the command stand's">
        <select value={s.characterSide} onChange={(e) => set({ characterSide: e.target.value as 'left' | 'right' })}>
          <option value="right">right</option>
          <option value="left">left</option>
        </select>
      </Row>

      <h3>Line of sight</h3>
      <Row label="Obstructing terrain">
        <select value={s.losObstructing} onChange={(e) => set({ losObstructing: e.target.value as BattleSettings['losObstructing'] })}>
          <option value="tournament">blocks every line (tournament pack)</option>
          <option value="core">blocks only if its Size ≥ both sizes (core rules)</option>
        </select>
      </Row>
      <Row label="Size comparison">
        <select value={s.losSizeComparison} onChange={(e) => set({ losSizeComparison: e.target.value as BattleSettings['losSizeComparison'] })}>
          <option value="both">against both acting and target sizes</option>
          <option value="acting">against the acting size only</option>
        </select>
      </Row>
      <Row label="Volley sampling step">
        <NumberField value={s.losSampleStep} min={0.05} max={2} width={52} suffix='"' onCommit={(n) => n && set({ losSampleStep: n })} />
      </Row>

      <div className="btn-row end">
        <button className="primary" onClick={close}>
          Done
        </button>
      </div>
    </Modal>
  );
}

/** Warn when the two player colours could be confused, including by colour-blind players. */
function ColorCheck({ a, b }: { a: string; b: string }) {
  const w = worstColorDistance(a, b);
  if (w.delta >= 30) return null;
  return (
    <p className="banner warn small" role="status">
      These two colours look alike{w.vision === 'normal vision' ? '' : ` to someone with ${w.vision}`}. Pick colours further apart.
    </p>
  );
}

/** Room-only settings: seats (the host can free one), casual editing, dice status. */
function OnlineSettings() {
  const mode = useStore((s) => s.mode);
  const net = useStore((s) => s.net);
  const casual = useStore((s) => s.battle.settings.anyoneCanEdit);
  if (mode !== 'online') return null;
  const d = net.dice;
  return (
    <>
      <h3>Room {net.room}</h3>
      {(['p1', 'p2'] as const).map((seat) => {
        const info = net.seats?.[seat];
        return (
          <Row key={seat} label={seat === 'p1' ? 'Player 1 seat' : 'Player 2 seat'}>
            <span>{info?.taken ? `${info.name}${info.connected ? ' (connected)' : ' (away)'}` : 'free'}</span>
            {net.isHost && info?.taken && (
              <button onClick={() => confirm(`Free ${info.name}'s seat? They will become a spectator.`) && freeSeat(seat)}>Free seat</button>
            )}
          </Row>
        );
      })}
      <Row label="Anyone can edit anything" title="Casual play: either player can move and edit every piece">
        <input type="checkbox" checked={!!casual} onChange={(e) => dispatch({ type: 'updateSettings', patch: { anyoneCanEdit: e.target.checked } })} />
      </Row>
      <h3>Dice</h3>
      {d ? (
        <p className="small">
          {d.configured ? (
            <>
              RANDOM.ORG key set · {d.pool} dice in the pool
              {d.requestsLeft !== undefined ? ` · today left: ${d.requestsLeft} requests, ${d.bitsLeft} bits` : ''}
            </>
          ) : d.source === 'drand' ? (
            <>
              From the drand public randomness beacon: each roll waits for the next round (up to 3 seconds) and can be checked with its <i>Check</i> button
              {d.lastRound ? ` · last round ${d.lastRound}` : ''}
            </>
          ) : (
            "From the server's own random numbers (Node crypto)."
          )}
          {d.lastError ? ` · last problem: ${d.lastError} (the server's own random numbers are used meanwhile)` : ''}
        </p>
      ) : (
        <p className="muted small">Dice status unknown.</p>
      )}
    </>
  );
}

/** Shortcut table. In the key column, single keys in [brackets] are drawn as keys. */
const HELP: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Board and view',
    rows: [
      ['Scroll · [+] [−]', 'Zoom (scroll zooms around the cursor)'],
      ['Drag empty space · [Space] + drag · [Arrows] with nothing selected', 'Pan (Shift + arrows: further)'],
      ['[F]', 'Zoom to fit'],
      ['Click · [[] []]', 'Select a piece · step through the regiments on the board'],
      ['[Esc]', 'Back out: closes a dialog, cancels the current step, then clears the selection'],
      ['[A] (hold)', 'Show every facing arc (the selected piece always shows its own)'],
      ['[V] · [T]', 'Select tool · draw terrain (click points, Enter to finish, Backspace removes the last)'],
    ],
  },
  {
    title: 'Moving',
    rows: [
      ['[M], or drag a regiment', 'Start a move. A ghost stays at the start; each segment is listed with the running total'],
      ['Move handles', 'Front arrow: forward/back · side arrows: sideways · front corners: wheel · dashed ring: rotate about the centre · body: free drag (Shift: along the facing)'],
      ['[Arrows] · [Q] [E]', 'Nudge 0.1" (Shift: 1") along its own axes · rotate 1° (Shift: 15°)'],
      ['[Enter] · [Esc] · [Backspace]', 'Commit the move as one log entry · put it back · drop the last segment'],
      ['Drag a reserve row onto the board', 'Deploy it there'],
      ['Drag a character onto a friendly regiment', 'Join it (Detach… in the inspector moves it to another regiment)'],
      ['[Delete]', 'Send the selected regiment to reserve (asks first)'],
    ],
  },
  {
    title: 'Measuring and line of sight',
    rows: [
      ['[R]', 'Ruler (snaps to corners and edge midpoints)'],
      ['[D] · Ctrl-click a second piece', 'Closest distance between two things'],
      ['[G]', 'Range rings around the selected regiment'],
      ['[P]', 'Pin the current ruler, distance or rings for everyone'],
      ['[L] · [[] []]', 'Line of sight from the selected regiment; brackets step through targets'],
    ],
  },
  {
    title: 'Game',
    rows: [
      ['[X]', 'Dice tray: roll, re-roll ticked dice once, roll-off'],
      ['[C] · [N]', 'Command stacks: build and lock your stack, then flip the next card (N, while the tray is open)'],
      ['[Ctrl]+[Z]', 'Undo your last change'],
      ['Army list… (roster)', 'Save your army to a file, or load a saved one into the reserve'],
      ['[?]', 'This help'],
    ],
  },
];

/** "[Ctrl]+[Z] · Drag" → keys drawn as <kbd>, the rest as text. */
function Keys({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]|\[\]\])/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('[') && p.endsWith(']') && p.length > 2 ? <kbd key={i}>{p.slice(1, -1)}</kbd> : <span key={i}>{p}</span>))}
    </>
  );
}

export function HelpOverlay() {
  const close = () => useStore.getState().setShowHelp(false);
  return (
    <Modal title="Controls" onClose={close} wide>
      <div className="help-cols">
        {HELP.map((sec) => (
          <section key={sec.title}>
            <h3>{sec.title}</h3>
            <table className="keys">
              <tbody>
                {sec.rows.map(([keys, what]) => (
                  <tr key={keys}>
                    <td>
                      <Keys text={keys} />
                    </td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <h3>Terrain keyword tags</h3>
      <p className="small">
        {Object.entries(KEYWORD_INITIALS).map(([k, v]) => (
          <span key={k} className="kw-legend">
            <b>{v}</b> {k}
          </span>
        ))}
      </p>
      <p className="muted small">
        This is a virtual tabletop, not a rules engine: it moves pieces and measures in inches. Players apply the rules. Warnings never block a move and line of sight is reported, never enforced.
      </p>
      <div className="btn-row end">
        <button className="primary" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.setState({ toast: null }), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} role="status">
      {toast.text}
    </div>
  );
}
