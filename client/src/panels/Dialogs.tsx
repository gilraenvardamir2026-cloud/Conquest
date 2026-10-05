// Settings dialog, help overlay and toast.

import { useEffect } from 'react';
import { KEYWORD_INITIALS, STAND_PRESETS, type BattleSettings, type StandType } from '@conquest/shared';
import { dispatch, useStore } from '../store';
import { LengthField, NumberField, Row, TextField } from '../ui/fields';

export function SettingsDialog() {
  const b = useStore((s) => s.battle);
  const close = () => useStore.getState().setShowSettings(false);
  const set = (patch: Partial<BattleSettings>) => dispatch({ type: 'updateSettings', patch });
  const s = b.settings;
  const types = Object.keys(STAND_PRESETS) as Exclude<StandType, 'custom'>[];
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <h3>Players</h3>
        {(['p1', 'p2'] as const).map((seat) => (
          <Row key={seat} label={seat === 'p1' ? 'Player 1 (bottom edge)' : 'Player 2 (top edge)'}>
            <TextField value={b.players[seat].name} onCommit={(name) => dispatch({ type: 'updatePlayer', seat, patch: { name: name || (seat === 'p1' ? 'Player 1' : 'Player 2') } })} />
            <input type="color" value={b.players[seat].color} onChange={(e) => dispatch({ type: 'updatePlayer', seat, patch: { color: e.target.value } })} aria-label="Colour" />
          </Row>
        ))}

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
                  <LengthField value={s.standPresets[t].w} onCommit={(w) => set({ standPresets: { ...s.standPresets, [t]: { ...s.standPresets[t], w } } })} />
                </td>
                <td>
                  <LengthField value={s.standPresets[t].d} onCommit={(d) => set({ standPresets: { ...s.standPresets, [t]: { ...s.standPresets[t], d } } })} />
                </td>
                <td>
                  <NumberField value={s.standPresets[t].size} digits={0} step={1} min={0} max={10} width={44} onCommit={(size) => size !== undefined && set({ standPresets: { ...s.standPresets, [t]: { ...s.standPresets[t], size } } })} />
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
        <Row label="Character joins on the command stand's">
          <select value={s.characterSide} onChange={(e) => set({ characterSide: e.target.value as 'left' | 'right' })}>
            <option value="right">right</option>
            <option value="left">left</option>
          </select>
        </Row>

        <h3>Line of sight (used from milestone 3)</h3>
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
      </div>
    </div>
  );
}

export function HelpOverlay() {
  const close = () => useStore.getState().setShowHelp(false);
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>Controls</h2>
        <table className="keys">
          <tbody>
            <tr><td>Scroll</td><td>Zoom around the cursor</td></tr>
            <tr><td>Drag empty space · Space + drag · middle button</td><td>Pan</td></tr>
            <tr><td>Click</td><td>Select (Esc clears)</td></tr>
            <tr><td>Drag a piece</td><td>Free move; the distance shows while dragging and goes to the log</td></tr>
            <tr><td>Drag a character onto a friendly regiment</td><td>Join it</td></tr>
            <tr><td>Drag a reserve row onto the board</td><td>Deploy it there</td></tr>
            <tr><td>Selected terrain</td><td>Round knob rotates (Shift: 15°); polygon vertices drag; squares add a vertex; Alt-click deletes one</td></tr>
            <tr><td>V / T</td><td>Select tool / draw terrain</td></tr>
            <tr><td>F</td><td>Zoom to fit</td></tr>
            <tr><td>Delete</td><td>Send the selected regiment or character to reserve (asks first)</td></tr>
            <tr><td>Ctrl+Z</td><td>Undo your last operation</td></tr>
            <tr><td>?</td><td>This help</td></tr>
          </tbody>
        </table>
        <h3>Terrain keyword tags</h3>
        <p className="small">
          {Object.entries(KEYWORD_INITIALS).map(([k, v]) => (
            <span key={k} className="kw-legend">
              <b>{v}</b> {k}
            </span>
          ))}
        </p>
        <p className="muted small">
          This is a virtual tabletop, not a rules engine: it moves pieces and measures in inches. Players apply the rules. Movement tools, measuring, line of sight, multiplayer and dice arrive in later milestones.
        </p>
        <div className="btn-row end">
          <button className="primary" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
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
