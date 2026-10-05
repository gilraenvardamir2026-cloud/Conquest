// Top toolbar: tools, board view controls, acting seat (local play), undo, save/load.

import { useRef, useState } from 'react';
import { SAMPLE_LAYOUTS, SCENARIOS, type Battle } from '@conquest/shared';
import { useStore, type Tool } from '../store';
import { downloadJson } from './actions';
import { startMoveForSelection } from '../moveActions';

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const seat = useStore((s) => s.seat);
  const grid = useStore((s) => s.battle.board.grid);
  const custom = useStore((s) => !s.battle.board.scenarioId);
  const players = useStore((s) => s.battle.players);
  const flip = useStore((s) => s.flip);
  const moving = useStore((s) => !!s.moveSession);
  const st = useStore.getState();
  const fileRef = useRef<HTMLInputElement>(null);
  const [newOpen, setNewOpen] = useState(false);

  const toolBtn = (t: Tool, label: string, key: string, disabled = false, title?: string) => (
    <button className={`tool ${tool === t ? 'on' : ''}`} disabled={disabled} aria-pressed={tool === t} title={title ?? `${label} (${key})`} onClick={() => st.setTool(t)}>
      {label}
    </button>
  );

  return (
    <div className="toolbar">
      <span className="brand">Conquest Tabletop</span>
      <div className="tb-group">
        {toolBtn('select', 'Select', 'V')}
        <button className={moving ? 'on' : ''} aria-pressed={moving} onClick={() => startMoveForSelection()} title="Move the selected regiment or character (M)">
          Move
        </button>
        {toolBtn('ruler', 'Ruler', 'R')}
        {toolBtn('distance', 'Distance', 'D')}
        {toolBtn('ring', 'Range ring', 'G')}
        {toolBtn('drawTerrain', 'Draw terrain', 'T')}
        {toolBtn('placeZone', 'Place zone', '—', !custom, custom ? 'Place an objective zone' : 'Custom board only (scenario objectives are locked)')}
        {toolBtn('placeObjective', 'Place marker', '—', !custom, custom ? 'Place an objective marker' : 'Custom board only (scenario objectives are locked)')}
      </div>
      <div className="tb-group">
        <label className="tb-label">
          Grid
          <select value={grid} onChange={(e) => st.dispatch({ type: 'updateBoard', patch: { grid: Number(e.target.value) as 0 | 1 | 6 | 12 } })}>
            <option value={0}>off</option>
            <option value={1}>1"</option>
            <option value={6}>6"</option>
            <option value={12}>12"</option>
          </select>
        </label>
        <button className={flip ? 'on' : ''} aria-pressed={flip} onClick={() => st.toggleFlip()} title="Rotate the view 180° so the other edge is at the bottom">
          Flip view
        </button>
        <button onClick={() => st.zoomToFit()} title="Zoom to fit (F)">
          Fit
        </button>
      </div>
      <div className="tb-group" title="Local play: choose which player you are acting as. Real seats arrive with multiplayer.">
        <span className="tb-label">Acting as</span>
        {(['p1', 'p2'] as const).map((s) => (
          <button key={s} className={`seat ${seat === s ? 'on' : ''}`} style={seat === s ? { background: players[s].color, borderColor: players[s].color } : undefined} aria-pressed={seat === s} onClick={() => st.setSeat(s)}>
            {players[s].name}
          </button>
        ))}
      </div>
      <div className="tb-group">
        <button onClick={() => st.undo()} title="Undo your last operation (Ctrl+Z)">
          Undo
        </button>
        <button onClick={() => downloadJson(`${st.battle.name.replace(/[^\w-]+/g, '_') || 'battle'}.json`, useStore.getState().battle)} title="Save the whole battle as a JSON file">
          Save
        </button>
        <button onClick={() => fileRef.current?.click()} title="Load a battle JSON file">
          Load
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const b = JSON.parse(await f.text()) as Battle;
              if (!b.board || !Array.isArray(b.regiments)) throw new Error('not a battle file');
              useStore.getState().loadBattle(b);
              useStore.getState().notify(`Loaded "${b.name}"`);
            } catch (err) {
              useStore.getState().notify(`Could not load: ${(err as Error).message}`, 'error');
            }
          }}
        />
        <button onClick={() => setNewOpen(true)}>New battle</button>
      </div>
      <div className="tb-group right">
        <button onClick={() => st.setShowSettings(true)}>Settings</button>
        <button onClick={() => st.setShowHelp(true)} title="Help and shortcuts (?)">
          ?
        </button>
      </div>
      {newOpen && <NewBattleDialog onClose={() => setNewOpen(false)} />}
    </div>
  );
}

function NewBattleDialog({ onClose }: { onClose: () => void }) {
  const [scenario, setScenario] = useState('s1');
  const [layout, setLayout] = useState('layout1');
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New battle</h2>
        <p className="muted small">This replaces the current local battle. Save it first if you want to keep it.</p>
        <label className="row">
          <span className="row-label">Scenario</span>
          <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.number}. {s.name}
              </option>
            ))}
            <option value="custom">Custom board</option>
          </select>
        </label>
        <label className="row">
          <span className="row-label">Terrain</span>
          <select value={layout} onChange={(e) => setLayout(e.target.value)}>
            {SAMPLE_LAYOUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
            <option value="">No terrain</option>
          </select>
        </label>
        <div className="btn-row end">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              useStore.getState().newBattle(scenario === 'custom' ? undefined : scenario, layout || undefined);
              onClose();
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
