// Right panel: context-sensitive editor for the current selection.

import { useEffect, useState } from 'react';
import {
  allocateWounds,
  effectiveSize,
  engagedStandIds,
  localToWorld,
  nextWoundTarget,
  regimentLocalBox,
  presetFor,
  standName,
  STAND_TYPES,
  TERRAIN_KEYWORDS,
  terrainExtent,
  terrainPolygon,
  toggleGarrison,
  totalDamage,
  type Battle,
  type Character,
  type CharacterPatch,
  type ObjectiveMarkerPatch,
  type RegimentPatch,
  type TerrainPatch,
  type ZonePatch,
  type FreeMarker,
  type ObjectiveMarker,
  type PlayerSeat,
  type Regiment,
  type Stand,
  type StandType,
  type Terrain,
  type Zone,
} from '@conquest/shared';
import { dispatch, useStore } from '../store';
import { LengthField, NotesField, NumberField, Row, Section, TextField } from '../ui/fields';
import { deployRegiment, duplicateRegiment, duplicateTerrain } from './actions';
import { BoardPanel } from './BoardPanel';
import { StandGrid } from './StandGrid';
import { MeasurePanel } from './MeasurePanel';
import { MovePanel } from './MovePanel';
import { LosPanel } from './LosPanel';

export function Inspector() {
  const battle = useStore((s) => s.battle);
  const selection = useStore((s) => s.selection);
  const moving = useStore((s) => !!s.moveSession);
  const tool = useStore((s) => s.tool);
  if (moving) return <MovePanel />;
  if (tool === 'ruler' || tool === 'distance' || tool === 'ring') return <MeasurePanel />;
  if (tool === 'los') return <LosPanel />;
  if (!selection) return <BoardPanel />;
  const close = (
    <button className="icon" title="Close (Esc)" onClick={() => useStore.getState().select(null)}>
      ✕
    </button>
  );
  switch (selection.kind) {
    case 'regiment': {
      const r = battle.regiments.find((x) => x.id === selection.id);
      return r ? <RegimentInspector key={r.id} r={r} b={battle} close={close} /> : <BoardPanel />;
    }
    case 'character': {
      const c = battle.characters.find((x) => x.id === selection.id);
      return c ? <CharacterInspector key={c.id} c={c} b={battle} close={close} /> : <BoardPanel />;
    }
    case 'terrain': {
      const t = battle.terrain.find((x) => x.id === selection.id);
      return t ? <TerrainInspector key={t.id} t={t} b={battle} close={close} /> : <BoardPanel />;
    }
    case 'zone': {
      const z = battle.zones.find((x) => x.id === selection.id);
      return z ? <ZoneInspector key={z.id} z={z} b={battle} close={close} /> : <BoardPanel />;
    }
    case 'objective': {
      const m = battle.objectiveMarkers.find((x) => x.id === selection.id);
      return m ? <ObjectiveInspector key={m.id} m={m} b={battle} close={close} /> : <BoardPanel />;
    }
    case 'marker': {
      const m = battle.markers.find((x) => x.id === selection.id);
      return m ? <MarkerInspector key={m.id} m={m} close={close} /> : <BoardPanel />;
    }
  }
}

const COMMON_TAGS = ['Activated', 'Broken', 'Inspired', 'Engaged', 'Shaken'];

function SeatSelect({ value, onChange, b, disabled }: { value: PlayerSeat; onChange: (s: PlayerSeat) => void; b: Battle; disabled?: boolean }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as PlayerSeat)}>
      <option value="p1">{b.players.p1.name} (P1)</option>
      <option value="p2">{b.players.p2.name} (P2)</option>
    </select>
  );
}

function PoseFields({ x, y, angle, onCommit }: { x: number; y: number; angle: number; onCommit: (p: { x: number; y: number; angle: number }) => void }) {
  return (
    <Row label="Position" title="Front-left corner in inches; angle in degrees, 0 = facing up the board">
      <NumberField value={x} width={56} onCommit={(v) => v !== undefined && onCommit({ x: v, y, angle })} />
      <NumberField value={y} width={56} onCommit={(v) => v !== undefined && onCommit({ x, y: v, angle })} />
      <NumberField value={angle} width={52} digits={1} step={1} suffix="°" onCommit={(v) => v !== undefined && onCommit({ x, y, angle: v })} />
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Regiment
// ---------------------------------------------------------------------------

function RegimentInspector({ r, b, close }: { r: Regiment; b: Battle; close: React.ReactNode }) {
  const [wounds, setWounds] = useState(1);
  // A wound allocation paused at a tie: the choices made so far and the stands to pick from.
  const [tie, setTie] = useState<{ choices: string[]; wound: number; candidates: Stand[]; steps: string[] } | null>(null);
  useEffect(() => setTie(null), [r]);

  /** Plan the allocation locally; stop at each tie to ask, then send one op carrying the choices. */
  const applyWounds = (choices: string[]) => {
    const ask = (b.settings.woundTies ?? 'ask') === 'ask';
    const plan = allocateWounds(r, wounds, !b.settings.confirmStandRemoval, engagedStandIds(b, r), { choices, stopAtTie: ask });
    if (plan.pendingTie) {
      setTie({ choices, wound: plan.pendingTie.wound, candidates: plan.pendingTie.candidates, steps: plan.steps });
      return;
    }
    setTie(null);
    dispatch({ type: 'applyWounds', id: r.id, count: wounds, ...(choices.length ? { choices } : {}) });
  };
  const [newTag, setNewTag] = useState('');
  const ch = r.characterId ? b.characters.find((c) => c.id === r.characterId) : undefined;
  const joinable = b.characters.filter((c) => c.owner === r.owner && !c.attachedTo && c.location !== 'destroyed');
  const commandLost = !r.stands.some((s) => s.isCommand) && r.casualties.some((s) => s.isCommand);
  const pending = r.stands.filter((s) => s.wounds >= s.woundsMax);
  const woundsMax = r.stands[0]?.woundsMax ?? r.casualties[0]?.woundsMax ?? 1;
  const eff = effectiveSize(b, { kind: 'regiment', id: r.id });
  const upd = (patch: RegimentPatch) => dispatch({ type: 'updateRegiment', id: r.id, patch });

  const setType = (t: StandType) => {
    if (t === 'custom') return upd({ standType: t });
    const p = presetFor(b.settings, t);
    upd({ standType: t, standW: p.w, standD: p.d, size: p.size });
  };

  const removeOne = () => {
    const t = nextWoundTarget(r, engagedStandIds(b, r)) ?? r.stands[r.stands.length - 1];
    if (t) dispatch({ type: 'deleteStand', id: r.id, standId: t.id });
  };

  const toggleTag = (tag: string) => upd({ tags: r.tags.includes(tag) ? r.tags.filter((t) => t !== tag) : [...r.tags, tag] });

  return (
    <div className="inspector">
      <Section title="Regiment" right={close}>
        <Row label="Name">
          <TextField value={r.name} onCommit={(v) => upd({ name: v || 'Regiment' })} />
        </Row>
        <Row label="Owner">
          <SeatSelect b={b} value={r.owner} onChange={(owner) => upd({ owner })} />
        </Row>
        <div className="status-line">
          <span className={`loc loc-${r.location}`}>{r.location === 'board' ? (r.garrisonId ? 'In garrison' : 'On board') : r.location === 'reserve' ? 'In reserve' : 'Destroyed'}</span>
          <span>
            {r.stands.length} stand{r.stands.length === 1 ? '' : 's'} · damage {totalDamage(r)}
          </span>
        </div>
        <div className="btn-row">
          {r.location !== 'board' && <button onClick={() => deployRegiment(b, r)}>Deploy to edge</button>}
          {r.location !== 'reserve' && <button onClick={() => dispatch({ type: 'setRegimentLocation', id: r.id, location: 'reserve' })}>To reserve</button>}
          {r.location !== 'destroyed' && <button onClick={() => dispatch({ type: 'setRegimentLocation', id: r.id, location: 'destroyed' })}>Mark destroyed</button>}
          <button onClick={() => duplicateRegiment(r)}>Duplicate</button>
          <button
            className="danger"
            onClick={() => {
              if (confirm(`Delete ${r.name} permanently?`)) {
                dispatch({ type: 'removeRegiment', id: r.id });
                useStore.getState().select(null);
              }
            }}
          >
            Delete
          </button>
        </div>
        {r.location === 'board' && <PoseFields x={r.x} y={r.y} angle={r.angle} onCommit={(pose) => dispatch({ type: 'moveRegiment', id: r.id, pose, summary: `placed at (${pose.x.toFixed(1)}, ${pose.y.toFixed(1)}) facing ${pose.angle}°` })} />}
      </Section>

      <Section title="Stands & wounds">
        {commandLost && <div className="banner warn">The command stand has been removed. Consider reforming the regiment.</div>}
        {pending.length > 0 && (
          <div className="banner warn">
            {pending.length} stand(s) at full damage.{' '}
            <button onClick={() => pending.forEach((s) => dispatch({ type: 'removeStand', id: r.id, standId: s.id }))}>Remove now</button>
          </div>
        )}
        <div className="btn-row">
          <span className="row-label">Apply wounds</span>
          <NumberField value={wounds} digits={0} step={1} min={1} max={200} width={52} onCommit={(n) => n && setWounds(n)} />
          <button className="primary" disabled={!!tie} onClick={() => applyWounds([])}>
            Apply
          </button>
        </div>
        {tie && (
          <div className="banner warn" role="alert">
            <div>
              Wound {tie.wound} of {wounds}: these stands are equally far from the command stand. Which one takes it?
            </div>
            {tie.steps.length > 0 && <div className="muted small">So far: {tie.steps.join(', ')}</div>}
            <div className="btn-row">
              {tie.candidates.map((c) => (
                <button key={c.id} className="primary" onClick={() => applyWounds([...tie.choices, c.id])}>
                  {standName(r, c)}
                </button>
              ))}
              <button onClick={() => setTie(null)}>Cancel</button>
            </div>
          </div>
        )}
        <StandGrid reg={r} b={b} tieIds={tie ? tie.candidates.map((c) => c.id) : undefined} onTiePick={(id) => tie && applyWounds([...tie.choices, id])} />
        {r.casualties.length > 0 && (
          <div className="casualties">
            <div className="muted small">Casualties</div>
            {r.casualties.map((s) => (
              <div key={s.id} className="btn-row">
                <span>{standName(r, s)}</span>
                <button onClick={() => dispatch({ type: 'restoreStand', id: r.id, standId: s.id })}>Restore</button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Character">
        {ch && (
          <div className="btn-row">
            <button className="link" onClick={() => useStore.getState().select({ kind: 'character', id: ch.id })}>
              ★ {ch.name} {ch.rider ? '(rider)' : ''} · {ch.wounds}/{ch.woundsMax}
            </button>
            <button onClick={() => dispatch({ type: 'adjustCharacterWounds', id: ch.id, delta: -1 })}>−</button>
            <button onClick={() => dispatch({ type: 'adjustCharacterWounds', id: ch.id, delta: 1 })}>+</button>
          </div>
        )}
        {ch ? (
          <DetachPicker c={ch} b={b} />
        ) : joinable.length ? (
          <select
            value=""
            onChange={(e) => {
              const c = b.characters.find((x) => x.id === e.target.value);
              if (!c) return;
              if (c.standType !== r.standType && !c.rider) useStore.getState().notify(`Stand types differ (${c.standType} / ${r.standType}) — joined anyway`);
              dispatch({ type: 'attachCharacter', characterId: c.id, regimentId: r.id });
            }}
          >
            <option value="">Join a character…</option>
            {joinable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.standType}
                {c.rider ? ', rider' : ''})
              </option>
            ))}
          </select>
        ) : (
          <div className="muted small">No unattached characters of this owner.</div>
        )}
      </Section>

      <Section title="Composition">
        <Row label="Stand type">
          <select value={r.standType} onChange={(e) => setType(e.target.value as StandType)}>
            {STAND_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Stand W × D">
          <LengthField value={r.standW} disabled={r.standType !== 'custom'} onCommit={(standW) => upd({ standW })} />
          <LengthField value={r.standD} disabled={r.standType !== 'custom'} onCommit={(standD) => upd({ standD })} />
        </Row>
        <Row label="Stands">
          <button onClick={removeOne} disabled={r.stands.length <= 1} title="Remove one stand permanently (the next one wound allocation would take)">
            −
          </button>
          <span className="count">{r.stands.length}</span>
          <button onClick={() => dispatch({ type: 'addStands', id: r.id, count: 1 })}>+</button>
        </Row>
        <Row label="Files" title="Stands per rank; changing it re-runs the automatic layout">
          <NumberField value={r.files} digits={0} step={1} min={1} max={60} width={52} onCommit={(n) => n && dispatch({ type: 'reformRegiment', id: r.id, files: n })} />
        </Row>
        <Row label="Wounds / stand">
          <NumberField value={woundsMax} digits={0} step={1} min={1} max={99} width={52} onCommit={(n) => n && dispatch({ type: 'setWoundsPerStand', id: r.id, woundsMax: n })} />
        </Row>
        <Row label="LoS size" title="From the stand type, plus an Elevated piece under every stand; an override replaces both">
          <span title={eff?.note}>
            <b>{eff?.size ?? r.size}</b> <span className="muted small">{eff?.note}</span>
          </span>
        </Row>
        <Row label="Size override">
          <NumberField value={r.sizeOverride} allowEmpty digits={0} step={1} min={0} max={10} width={52} onCommit={(n) => upd({ sizeOverride: n ?? null })} />
        </Row>
        <Row label="All arcs are front" title="Line of sight and arc report treat every arc of this regiment as its front (setting)">
          <input
            type="checkbox"
            checked={b.settings.losAllFrontIds.includes(r.id)}
            onChange={(e) =>
              dispatch({
                type: 'updateSettings',
                patch: { losAllFrontIds: e.target.checked ? [...b.settings.losAllFrontIds, r.id] : b.settings.losAllFrontIds.filter((x) => x !== r.id) },
              })
            }
          />
        </Row>
        <Row label="March">
          <NumberField value={r.march} allowEmpty digits={1} min={0} width={52} suffix='"' onCommit={(n) => upd({ march: n ?? null })} />
        </Row>
        <Row label="Barrage range">
          <NumberField value={r.barrageRange} allowEmpty digits={1} min={0} width={52} suffix='"' onCommit={(n) => upd({ barrageRange: n ?? null })} />
        </Row>
      </Section>

      <Section title="Tags">
        <div className="chips">
          {[...new Set([...COMMON_TAGS, ...r.tags])].map((t) => (
            <button key={t} className={`chip ${r.tags.includes(t) ? 'on' : ''}`} onClick={() => toggleTag(t)} aria-pressed={r.tags.includes(t)}>
              {t}
            </button>
          ))}
        </div>
        <form
          className="btn-row"
          onSubmit={(e) => {
            e.preventDefault();
            const t = newTag.trim();
            if (t && !r.tags.includes(t)) upd({ tags: [...r.tags, t] });
            setNewTag('');
          }}
        >
          <input type="text" value={newTag} placeholder="Custom tag" onChange={(e) => setNewTag(e.target.value)} />
          <button type="submit">Add</button>
        </form>
      </Section>

      <Section title="Notes (shared)">
        <NotesField value={r.notes} placeholder="Shared with both players, saved automatically" onCommit={(notes) => upd({ notes })} />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------

/** Middle of a regiment on the board, for sorting by distance. */
function regimentCentre(r: Regiment) {
  const box = regimentLocalBox(r);
  return localToWorld(r, (box.u0 + box.u1) / 2, (box.v0 + box.v1) / 2);
}

/**
 * Detach: a character never stands alone, so it joins another regiment of the
 * same owner (nearest first) or goes to the reserve.
 */
function DetachPicker({ c, b }: { c: Character; b: Battle }) {
  const [open, setOpen] = useState(false);
  const from = b.regiments.find((r) => r.id === c.attachedTo);
  useEffect(() => setOpen(false), [c.id, c.attachedTo]);
  if (!open) {
    return (
      <div className="btn-row">
        <button onClick={() => setOpen(true)}>Detach…</button>
      </div>
    );
  }
  const here = from && from.location === 'board' ? regimentCentre(from) : null;
  const dist = (r: Regiment) => (here && r.location === 'board' ? Math.hypot(regimentCentre(r).x - here.x, regimentCentre(r).y - here.y) : Infinity);
  const options = b.regiments
    .filter((r) => r.owner === c.owner && r.id !== c.attachedTo && !r.characterId && r.location !== 'destroyed')
    .sort((p, q) => (p.location === 'board' ? 0 : 1) - (q.location === 'board' ? 0 : 1) || dist(p) - dist(q) || p.name.localeCompare(q.name));
  const join = (r: Regiment) => {
    if (r.standType !== c.standType && !c.rider) useStore.getState().notify(`Stand types differ (${c.standType} / ${r.standType}) — joined anyway`);
    dispatch({ type: 'attachCharacter', characterId: c.id, regimentId: r.id });
  };
  return (
    <div className="detach-picker" role="group" aria-label={`Which regiment does ${c.name} join?`}>
      <div className="small">Which regiment does {c.name} join?</div>
      {options.length ? (
        <div className="btn-col">
          {options.map((r) => (
            <button key={r.id} onClick={() => join(r)}>
              {r.name} <span className="muted">({r.standType}{r.location === 'reserve' ? ', reserve' : ''})</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="muted small">No other regiment without a character.</div>
      )}
      <div className="btn-row">
        <button onClick={() => dispatch({ type: 'detachCharacter', characterId: c.id })}>Send to reserve</button>
        <button onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}


function CharacterInspector({ c, b, close }: { c: Character; b: Battle; close: React.ReactNode }) {
  const upd = (patch: CharacterPatch) => dispatch({ type: 'updateCharacter', id: c.id, patch });
  const reg = c.attachedTo ? b.regiments.find((r) => r.id === c.attachedTo) : undefined;
  const regs = b.regiments.filter((r) => r.owner === c.owner && !r.characterId && r.location !== 'destroyed');
  return (
    <div className="inspector">
      <Section title="Character" right={close}>
        <Row label="Name">
          <TextField value={c.name} onCommit={(v) => upd({ name: v || 'Character' })} />
        </Row>
        <Row label="Owner">
          <SeatSelect b={b} value={c.owner} disabled={!!c.attachedTo} onChange={(owner) => upd({ owner })} />
        </Row>
        <Row label="Wounds">
          <button onClick={() => dispatch({ type: 'adjustCharacterWounds', id: c.id, delta: -1 })}>−</button>
          <span className="count">
            {c.wounds}/{c.woundsMax}
          </span>
          <button onClick={() => dispatch({ type: 'adjustCharacterWounds', id: c.id, delta: 1 })}>+</button>
        </Row>
        <Row label="Max wounds">
          <NumberField value={c.woundsMax} digits={0} step={1} min={1} max={99} width={52} onCommit={(n) => n && upd({ woundsMax: n })} />
        </Row>
        <div className="status-line">
          <span className={`loc loc-${c.location}`}>{c.attachedTo ? `With ${reg?.name ?? '?'}` : c.location === 'board' ? 'On board' : c.location === 'reserve' ? 'In reserve' : 'Destroyed'}</span>
        </div>
        <div className="btn-row">
          {c.location !== 'reserve' && !c.attachedTo && <button onClick={() => dispatch({ type: 'setCharacterLocation', id: c.id, location: 'reserve' })}>To reserve</button>}
          {c.location !== 'destroyed' && <button onClick={() => dispatch({ type: 'setCharacterLocation', id: c.id, location: 'destroyed' })}>Mark destroyed</button>}
          <button
            className="danger"
            onClick={() => {
              if (confirm(`Delete ${c.name} permanently?`)) {
                dispatch({ type: 'removeCharacter', id: c.id });
                useStore.getState().select(null);
              }
            }}
          >
            Delete
          </button>
        </div>
        {c.location === 'board' && !c.attachedTo && c.x !== undefined && (
          <PoseFields x={c.x} y={c.y ?? 0} angle={c.angle ?? 0} onCommit={(pose) => dispatch({ type: 'moveCharacter', id: c.id, pose, summary: `placed at (${pose.x.toFixed(1)}, ${pose.y.toFixed(1)})` })} />
        )}
      </Section>
      <Section title="Regiment">
        {c.attachedTo && (
          <div className="btn-row">
            <button className="link" onClick={() => reg && useStore.getState().select({ kind: 'regiment', id: reg.id })}>
              {reg?.name}
            </button>
          </div>
        )}
        {c.attachedTo ? (
          <DetachPicker c={c} b={b} />
        ) : (
          <select
            value=""
            onChange={(e) => {
              const r = b.regiments.find((x) => x.id === e.target.value);
              if (!r) return;
              if (r.standType !== c.standType && !c.rider) useStore.getState().notify(`Stand types differ (${c.standType} / ${r.standType}) — joined anyway`);
              dispatch({ type: 'attachCharacter', characterId: c.id, regimentId: r.id });
            }}
          >
            <option value="">Join a regiment…</option>
            {regs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.standType})
              </option>
            ))}
          </select>
        )}
        <div className="muted small">You can also drag the character onto a friendly regiment.</div>
      </Section>
      <Section title="Stand">
        <Row label="Rider" title="No stand of its own: shown as a badge on its monster regiment">
          <input type="checkbox" checked={!!c.rider} disabled={!!c.attachedTo} onChange={(e) => upd({ rider: e.target.checked })} />
        </Row>
        <Row label="Stand type">
          <select
            value={c.standType}
            onChange={(e) => {
              const t = e.target.value as StandType;
              if (t === 'custom') return upd({ standType: t });
              const p = presetFor(b.settings, t);
              upd({ standType: t, standW: p.w, standD: p.d });
            }}
          >
            {STAND_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Stand W × D">
          <LengthField value={c.standW} disabled={c.standType !== 'custom'} onCommit={(standW) => upd({ standW })} />
          <LengthField value={c.standD} disabled={c.standType !== 'custom'} onCommit={(standD) => upd({ standD })} />
        </Row>
      </Section>
      <Section title="Notes (shared)">
        <NotesField value={c.notes} onCommit={(notes) => upd({ notes })} />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

function TerrainInspector({ t, b, close }: { t: Terrain; b: Battle; close: React.ReactNode }) {
  const upd = (patch: TerrainPatch) => dispatch({ type: 'updateTerrain', id: t.id, patch });
  const locked = t.locked;
  const ext = terrainExtent(t);
  const candidates = b.regiments.filter((r) => r.location === 'board');
  const toPolygon = () => {
    const world = terrainPolygon(t.shape.kind === 'ellipse' ? { ...t, angle: 0 } : { ...t, angle: 0 });
    // Ellipses become 16-point polygons so they stay easy to edit.
    const src = t.shape.kind === 'ellipse' ? world.filter((_, i) => i % 4 === 0) : world;
    upd({ shape: { kind: 'polygon', points: src.map((p) => [Math.round((p.x - t.x) * 100) / 100, Math.round((p.y - t.y) * 100) / 100]) } });
  };
  return (
    <div className="inspector">
      <Section title="Terrain" right={close}>
        <Row label="Name">
          <TextField value={t.name} disabled={locked} onCommit={(v) => upd({ name: v || 'Terrain' })} />
        </Row>
        <Row label="Locked" title="Players lock terrain once the board is set; scenarios never lock terrain">
          <input type="checkbox" checked={locked} onChange={(e) => upd({ locked: e.target.checked })} />
        </Row>
        <Row label="Size" title="The pack's Elevation (X), 0 to 3">
          {[0, 1, 2, 3].map((n) => (
            <button key={n} disabled={locked} aria-pressed={t.size === n} onClick={() => t.size !== n && upd({ size: n })}>
              {n}
            </button>
          ))}
        </Row>
        <Row label="Centre / angle">
          <NumberField value={t.x} width={52} disabled={locked} onCommit={(v) => v !== undefined && upd({ x: v })} />
          <NumberField value={t.y} width={52} disabled={locked} onCommit={(v) => v !== undefined && upd({ y: v })} />
          <NumberField value={t.angle} width={48} step={1} digits={1} suffix="°" disabled={locked} onCommit={(v) => v !== undefined && upd({ angle: v })} />
        </Row>
        {t.shape.kind === 'rect' && (
          <Row label="W × D">
            <LengthField value={t.shape.w} disabled={locked} onCommit={(w) => upd({ shape: { kind: 'rect', w, d: (t.shape as { d: number }).d } })} />
            <LengthField value={t.shape.d} disabled={locked} onCommit={(d) => upd({ shape: { kind: 'rect', w: (t.shape as { w: number }).w, d } })} />
          </Row>
        )}
        {t.shape.kind === 'ellipse' && (
          <Row label="W × D">
            <LengthField value={t.shape.rx * 2} disabled={locked} onCommit={(w) => upd({ shape: { kind: 'ellipse', rx: w / 2, ry: (t.shape as { ry: number }).ry } })} />
            <LengthField value={t.shape.ry * 2} disabled={locked} onCommit={(d) => upd({ shape: { kind: 'ellipse', rx: (t.shape as { rx: number }).rx, ry: d / 2 } })} />
          </Row>
        )}
        {t.shape.kind === 'polygon' && (
          <div className="muted small">
            Polygon, {t.shape.points.length} points, footprint {ext.w.toFixed(1)}" × {ext.d.toFixed(1)}". Drag vertices on the board; click a square to add one; Alt-click a vertex to delete it.
          </div>
        )}
        <div className="btn-row">
          {t.shape.kind !== 'polygon' && (
            <button disabled={locked} onClick={toPolygon}>
              Convert to polygon
            </button>
          )}
          <button onClick={() => duplicateTerrain(t)}>Duplicate</button>
          <button
            className="danger"
            disabled={locked}
            onClick={() => {
              dispatch({ type: 'removeTerrain', id: t.id });
              useStore.getState().select(null);
            }}
          >
            Delete
          </button>
        </div>
      </Section>
      <Section title="Keywords">
        <div className="keyword-grid">
          {TERRAIN_KEYWORDS.map((k) => (
            <label key={k} className="kw">
              <input
                type="checkbox"
                disabled={locked}
                checked={t.keywords.includes(k)}
                onChange={(e) => upd({ keywords: e.target.checked ? [...t.keywords, k] : t.keywords.filter((x) => x !== k) })}
              />
              {k}
            </label>
          ))}
        </div>
        {(t.keywords.includes('Impassable') || t.keywords.includes('Garrison')) && (
          <div className="btn-row">
            <button disabled={locked} onClick={() => dispatch({ type: 'updateTerrain', id: t.id, patch: { keywords: toggleGarrison(t, !t.keywords.includes('Garrison')).keywords } })}>
              {t.keywords.includes('Garrison') ? 'Make Impassable building' : 'Make garrison terrain'}
            </button>
          </div>
        )}
      </Section>
      {t.garrison && (
        <Section title="Garrison">
          <Row label="Defense">
            <NumberField value={t.garrison.defense} digits={0} step={1} min={0} max={10} width={48} disabled={locked} onCommit={(n) => n !== undefined && upd({ garrison: { defense: n, capacity: t.garrison!.capacity } })} />
          </Row>
          <Row label="Capacity">
            <NumberField value={t.garrison.capacity} digits={0} step={1} min={0} max={20} width={48} disabled={locked} onCommit={(n) => n !== undefined && upd({ garrison: { defense: t.garrison!.defense, capacity: n } })} />
          </Row>
          <Row label="Occupied by">
            <select value={t.garrison.occupiedBy ?? ''} onChange={(e) => dispatch({ type: 'occupyGarrison', terrainId: t.id, regimentId: e.target.value || null })}>
              <option value="">— nobody —</option>
              {candidates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({b.players[r.owner].name})
                </option>
              ))}
            </select>
          </Row>
          <div className="muted small">Leaving puts the regiment beside the piece for you to position.</div>
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Objectives and tokens
// ---------------------------------------------------------------------------

function FriendlySelect({ value, b, disabled, onChange }: { value?: PlayerSeat; b: Battle; disabled?: boolean; onChange: (v: PlayerSeat | null) => void }) {
  return (
    <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange((e.target.value || null) as PlayerSeat | null)}>
      <option value="">Neutral</option>
      <option value="p1">Friendly to {b.players.p1.name}</option>
      <option value="p2">Friendly to {b.players.p2.name}</option>
    </select>
  );
}

function ZoneInspector({ z, b, close }: { z: Zone; b: Battle; close: React.ReactNode }) {
  const upd = (patch: ZonePatch) => dispatch({ type: 'updateZone', id: z.id, patch });
  return (
    <div className="inspector">
      <Section title="Objective zone" right={close}>
        {z.locked && <div className="banner">Placed by the scenario and locked.</div>}
        <Row label="Label">
          <TextField value={z.label ?? ''} disabled={z.locked} onCommit={(v) => upd({ label: v || null })} />
        </Row>
        <Row label="Diameter">
          <NumberField value={z.diameter} disabled={z.locked} min={0.5} width={52} suffix='"' onCommit={(n) => n && upd({ diameter: n })} />
        </Row>
        <Row label="Side">
          <FriendlySelect b={b} value={z.friendlyTo} disabled={z.locked} onChange={(v) => upd({ friendlyTo: v })} />
        </Row>
        <Row label="Centre">
          <NumberField value={z.x} width={52} disabled={z.locked} onCommit={(v) => v !== undefined && upd({ x: v })} />
          <NumberField value={z.y} width={52} disabled={z.locked} onCommit={(v) => v !== undefined && upd({ y: v })} />
        </Row>
        {!z.locked && (
          <button
            className="danger"
            onClick={() => {
              dispatch({ type: 'removeZone', id: z.id });
              useStore.getState().select(null);
            }}
          >
            Delete zone
          </button>
        )}
      </Section>
    </div>
  );
}

function ObjectiveInspector({ m, b, close }: { m: ObjectiveMarker; b: Battle; close: React.ReactNode }) {
  const upd = (patch: ObjectiveMarkerPatch) => dispatch({ type: 'updateObjectiveMarker', id: m.id, patch });
  const ready = m.damageBy.p1 >= m.woundsMax || m.damageBy.p2 >= m.woundsMax;
  return (
    <div className="inspector">
      <Section title={`Objective marker ${m.label ?? ''}`} right={close}>
        {m.locked && <div className="banner">Placed by the scenario: it cannot be moved, only damaged and removed.</div>}
        <div className="muted small">54 × 54 mm, Size 2, {m.woundsMax} wounds. Damage is tracked separately per player.</div>
        {(['p1', 'p2'] as const).map((seat) => (
          <Row key={seat} label={`Damage by ${b.players[seat].name}`}>
            <button onClick={() => dispatch({ type: 'damageObjectiveMarker', id: m.id, seat, delta: -1 })}>−</button>
            <span className="count">
              {m.damageBy[seat]}/{m.woundsMax}
            </span>
            <button onClick={() => dispatch({ type: 'damageObjectiveMarker', id: m.id, seat, delta: 1 })}>+</button>
          </Row>
        ))}
        {ready && !m.destroyed && (
          <button
            className="primary danger"
            onClick={() => {
              dispatch({ type: 'setObjectiveMarkerDestroyed', id: m.id, destroyed: true });
              useStore.getState().select(null);
            }}
          >
            Remove marker
          </button>
        )}
        {!m.locked && (
          <>
            <Row label="Label">
              <TextField value={m.label ?? ''} onCommit={(v) => upd({ label: v || null })} />
            </Row>
            <Row label="Side">
              <FriendlySelect b={b} value={m.friendlyTo} onChange={(v) => upd({ friendlyTo: v })} />
            </Row>
            <Row label="Centre">
              <NumberField value={m.x} width={52} onCommit={(v) => v !== undefined && upd({ x: v })} />
              <NumberField value={m.y} width={52} onCommit={(v) => v !== undefined && upd({ y: v })} />
            </Row>
            <button
              className="danger"
              onClick={() => {
                dispatch({ type: 'removeObjectiveMarker', id: m.id });
                useStore.getState().select(null);
              }}
            >
              Delete marker
            </button>
          </>
        )}
      </Section>
    </div>
  );
}

function MarkerInspector({ m, close }: { m: FreeMarker; close: React.ReactNode }) {
  return (
    <div className="inspector">
      <Section title="Token" right={close}>
        <Row label="Label">
          <TextField value={m.label} onCommit={(v) => dispatch({ type: 'updateMarker', id: m.id, patch: { label: v || 'Token' } })} />
        </Row>
        <Row label="Position">
          <NumberField value={m.x} width={52} onCommit={(v) => v !== undefined && dispatch({ type: 'updateMarker', id: m.id, patch: { x: v } })} />
          <NumberField value={m.y} width={52} onCommit={(v) => v !== undefined && dispatch({ type: 'updateMarker', id: m.id, patch: { y: v } })} />
        </Row>
        <button
          className="danger"
          onClick={() => {
            dispatch({ type: 'removeMarker', id: m.id });
            useStore.getState().select(null);
          }}
        >
          Delete token
        </button>
      </Section>
    </div>
  );
}
