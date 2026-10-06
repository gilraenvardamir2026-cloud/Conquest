// Right panel when nothing is selected: scenario, board, terrain layouts and the board check.

import { useState } from 'react';
import {
  boardCheck,
  makeId,
  SAMPLE_LAYOUTS,
  scenarioById,
  SCENARIOS,
  TERRAIN_PRESETS,
  type Terrain,
} from '@conquest/shared';
import { dispatch, useStore } from '../store';
import { NumberField, Row, Section, TextField } from '../ui/fields';
import { PinnedList } from './MeasurePanel';

export function BoardPanel() {
  const b = useStore((s) => s.battle);
  const [garrisonBuildings, setGarrisonBuildings] = useState(false);
  const [preset, setPreset] = useState(TERRAIN_PRESETS[0].key);
  const warnings = useStore((s) => s.checkResult);
  const scenario = scenarioById(b.board.scenarioId);
  const custom = !b.board.scenarioId;
  const destroyed = b.objectiveMarkers.filter((m) => m.destroyed);
  const { setHighlight, setCheckResult, select } = useStore.getState();

  const addPreset = () => {
    const p = TERRAIN_PRESETS.find((x) => x.key === preset)!;
    const t: Terrain = {
      id: makeId(),
      name: p.name,
      shape: JSON.parse(JSON.stringify(p.shape)),
      x: b.board.width / 2,
      y: b.board.depth / 2,
      angle: 0,
      size: p.size,
      keywords: p.keywords.slice(),
      ...(p.garrison ? { garrison: { ...p.garrison } } : {}),
      locked: false,
    };
    if (dispatch({ type: 'addTerrain', terrain: t })) select({ kind: 'terrain', id: t.id });
  };

  const setScenario = (id: string) => {
    if (id === (b.board.scenarioId ?? 'custom')) return;
    if (id !== 'custom' && (b.zones.length || b.objectiveMarkers.length) && !confirm('Replace the current objective zones and markers?')) return;
    dispatch({ type: 'setScenario', scenarioId: id });
  };

  const allLocked = b.terrain.length > 0 && b.terrain.every((t) => t.locked);
  const setAllLocked = (locked: boolean) => b.terrain.filter((t) => t.locked !== locked).forEach((t) => dispatch({ type: 'updateTerrain', id: t.id, patch: { locked } }));

  return (
    <div className="inspector">
      <Section title="Battle">
        <Row label="Name">
          <TextField value={b.name} onCommit={(name) => dispatch({ type: 'renameBattle', name: name || 'Battle' })} />
        </Row>
      </Section>

      <Section title="Scenario">
        <select value={b.board.scenarioId ?? 'custom'} onChange={(e) => setScenario(e.target.value)}>
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.number}. {s.name}
            </option>
          ))}
          <option value="custom">Custom board</option>
        </select>
        {scenario && (
          <div className="muted small">
            {scenario.zones.length} objective zone(s), {scenario.markers.length} marker(s){scenario.noReinforcement.length ? ', no-reinforcement side edges' : ''}. Zones and markers are locked; markers can only be damaged and removed.
            {scenario.note ? ` ${scenario.note}` : ''}
          </div>
        )}
        {custom && (
          <>
            <div className="muted small">Free placement: use the toolbar to place zones and markers, then edit them here.</div>
            <Row label="Board W × D">
              <NumberField value={b.board.width} min={12} max={144} width={52} suffix='"' onCommit={(n) => n && dispatch({ type: 'updateBoard', patch: { width: n } })} />
              <NumberField value={b.board.depth} min={12} max={144} width={52} suffix='"' onCommit={(n) => n && dispatch({ type: 'updateBoard', patch: { depth: n } })} />
            </Row>
            <Row label="No reinforcement" title="Hatched strips on both side edges, 12–36 from the top">
              <input
                type="checkbox"
                checked={b.board.noReinforcement.length > 0}
                onChange={(e) =>
                  dispatch({
                    type: 'updateBoard',
                    patch: {
                      noReinforcement: e.target.checked
                        ? [
                            { edge: 'left', from: 12, to: 36 },
                            { edge: 'right', from: 12, to: 36 },
                          ]
                        : [],
                    },
                  })
                }
              />
            </Row>
          </>
        )}
        {destroyed.length > 0 && (
          <div className="casualties">
            <div className="muted small">Destroyed objective markers</div>
            {destroyed.map((m) => (
              <div key={m.id} className="btn-row">
                <span>
                  Marker {m.label ?? '•'} @ ({m.x}, {m.y})
                </span>
                <button onClick={() => dispatch({ type: 'setObjectiveMarkerDestroyed', id: m.id, destroyed: false })}>Restore</button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Terrain">
        <div className="btn-row">
          {SAMPLE_LAYOUTS.map((l, i) => (
            <button
              key={l.id}
              title={`${l.name}: ${l.pieces.length} pieces`}
              onClick={() => {
                if (b.terrain.length && !confirm('Replace all terrain with this sample layout?')) return;
                dispatch({ type: 'setTerrainLayout', layoutId: l.id, garrisonBuildings });
              }}
            >
              Layout #{i + 1}
            </button>
          ))}
        </div>
        <label className="kw">
          <input type="checkbox" checked={garrisonBuildings} onChange={(e) => setGarrisonBuildings(e.target.checked)} />
          Buildings as garrison terrain
        </label>
        <div className="btn-row">
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {TERRAIN_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          <button onClick={addPreset}>Add piece</button>
        </div>
        <label className="kw" title="Once the board is set: terrain, zones and markers can no longer be edited (markers can still be damaged)">
          <input type="checkbox" checked={!!b.settings.boardLocked} onChange={(e) => dispatch({ type: 'updateSettings', patch: { boardLocked: e.target.checked } })} />
          <b>Board locked for the game</b>
        </label>
        <div className="btn-row">
          <button onClick={() => useStore.getState().setTool('drawTerrain')}>Draw polygon</button>
          <button disabled={!b.terrain.length} onClick={() => setAllLocked(!allLocked)}>
            {allLocked ? 'Unlock all' : 'Lock all'}
          </button>
          <button
            className="danger"
            disabled={!b.terrain.length}
            onClick={() => confirm('Remove all terrain?') && dispatch({ type: 'clearTerrain' })}
          >
            Clear
          </button>
        </div>
      </Section>

      <Section
        title="Board check"
        right={
          <button
            onClick={() => setCheckResult(boardCheck(b))}
          >
            Run
          </button>
        }
      >
        {warnings === null ? (
          <div className="muted small">Checks the tournament pack's terrain guidance. Warnings only.</div>
        ) : warnings.length === 0 ? (
          <div className="ok">No issues found.</div>
        ) : (
          <ul className="warnings">
            {warnings.map((w, i) => (
              <li key={i}>
                <button type="button" onClick={() => setHighlight(w.ids)} title="Highlight on the board">
                  {w.text}
                </button>
              </li>
            ))}
          </ul>
        )}
        {warnings && (
          <button
            className="link"
            onClick={() => setCheckResult(null)}
          >
            Clear highlights
          </button>
        )}
      </Section>

      <PinnedList b={b} />

      <Section title="Tokens">
        <button
          onClick={() => {
            const id = makeId();
            if (dispatch({ type: 'addMarker', marker: { id, label: 'Token', x: b.board.width / 2, y: b.board.depth / 2 } })) select({ kind: 'marker', id });
          }}
        >
          Add token
        </button>
        <span className="muted small"> e.g. reinforcement line ends</span>
      </Section>
    </div>
  );
}
