// Mini-grid of a regiment's stands. In normal mode it is the wound tracker
// (click a stand to adjust it); in Reform mode it is the only way stands
// change slot: pick a stand, then click an empty cell (move) or a stand (swap).

import { useMemo, useState } from 'react';
import { autoLayout, slotsOverlap, standName, type Battle, type Regiment, type Slot } from '@conquest/shared';
import { dispatch } from '../store';
import { NumberField, TextField } from '../ui/fields';

const CELL = 40;

export function StandGrid({ reg, b }: { reg: Regiment; b: Battle }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [reform, setReform] = useState<{ files: number; slots: Record<string, Slot> } | null>(null);
  const ch = reg.characterId ? b.characters.find((c) => c.id === reg.characterId) : undefined;
  const hasCharSlot = !!(ch && reg.characterSlot);
  const cellH = Math.max(24, Math.min(CELL * 2, (CELL * reg.standD) / reg.standW));

  const items = useMemo(() => {
    const list = reg.stands.map((s) => ({ id: s.id, slot: s.slot, stand: s, isChar: false }));
    if (hasCharSlot) list.push({ id: ch!.id, slot: reg.characterSlot!, stand: undefined as never, isChar: true });
    return list;
  }, [reg, ch, hasCharSlot]);

  const slotOf = (id: string, fallback: Slot) => (reform ? reform.slots[id] ?? fallback : fallback);
  const placed = items.map((it) => ({ ...it, slot: slotOf(it.id, it.slot) }));

  // Grid extent: occupied slots, plus (in reform mode) every integer cell up to files × (ranks + 1).
  const files = reform ? reform.files : reg.files;
  const maxRank = Math.max(0, ...placed.map((p) => p.slot.rank)) + (reform ? 1 : 0);
  const minFile = Math.min(0, ...placed.map((p) => p.slot.file));
  const maxFile = Math.max(files - 1, ...placed.map((p) => p.slot.file));
  const empties: Slot[] = [];
  if (reform) {
    for (let rank = 0; rank <= maxRank; rank++)
      for (let file = 0; file < Math.max(files, Math.ceil(maxFile + 1)); file++) {
        const s = { rank, file };
        if (!placed.some((p) => slotsOverlap(p.slot, s))) empties.push(s);
      }
  }
  const casualtySlots = reform ? [] : reg.casualties.map((c) => c.slot);

  const left = (s: Slot) => (s.file - minFile) * CELL;
  const top = (s: Slot) => s.rank * cellH;
  const width = (maxFile - minFile + 1) * CELL;
  const height = (maxRank + 1) * cellH;

  const startReform = () => {
    const slots: Record<string, Slot> = {};
    for (const it of items) slots[it.id] = { ...it.slot };
    setReform({ files: reg.files, slots });
    setPicked(null);
  };

  const clickItem = (id: string) => {
    if (!reform || !picked || picked === id) {
      setPicked(picked === id ? null : id);
      return;
    }
    // Swap two stands.
    const a = reform.slots[picked];
    const c = reform.slots[id];
    setReform({ ...reform, slots: { ...reform.slots, [picked]: c, [id]: a } });
    setPicked(null);
  };

  const clickEmpty = (s: Slot) => {
    if (!reform || !picked) return;
    setReform({ ...reform, slots: { ...reform.slots, [picked]: s } });
    setPicked(null);
  };

  const autoArrange = (f: number) => {
    const ordered = items.slice().sort((x, y) => x.slot.rank - y.slot.rank || x.slot.file - y.slot.file);
    const map = autoLayout(
      ordered.map((it) => ({ id: it.id, isCommand: !it.isChar && it.stand.isCommand, isCharacter: it.isChar })),
      f,
      b.settings.characterSide,
    );
    setReform({ files: f, slots: Object.fromEntries(map) });
  };

  const pickedStand = !reform && picked ? reg.stands.find((s) => s.id === picked) : undefined;

  return (
    <div className="stand-grid-wrap">
      <div className="grid-front">▲ front</div>
      <div className="stand-grid" style={{ width, height }}>
        {casualtySlots.map((s, i) => (
          <div key={`c${i}`} className="cell casualty" style={{ left: left(s), top: top(s), width: CELL, height: cellH }} title="Removed stand (restore below)">
            ✕
          </div>
        ))}
        {empties.map((s) => (
          <div
            key={`e${s.rank}-${s.file}`}
            className={`cell empty ${picked ? 'target' : ''}`}
            style={{ left: left(s), top: top(s), width: CELL, height: cellH }}
            onClick={() => clickEmpty(s)}
          />
        ))}
        {placed.map((it) => {
          const s = it.stand;
          const dead = !it.isChar && s.wounds >= s.woundsMax;
          return (
            <button
              type="button"
              key={it.id}
              className={`cell stand ${it.isChar ? 'char' : ''} ${picked === it.id ? 'picked' : ''} ${dead ? 'dead' : ''}`}
              style={{ left: left(it.slot), top: top(it.slot), width: CELL, height: cellH, background: b.players[reg.owner].color }}
              onClick={() => clickItem(it.id)}
              title={it.isChar ? ch!.name : standName(reg, s)}
            >
              {it.isChar ? (
                <span className="cell-text">★{ch!.name.slice(0, 4)}</span>
              ) : (
                <span className="cell-text">
                  {s.isCommand ? 'C' : ''}
                  {s.label ? s.label.slice(0, 3) : ''}
                  <br />
                  {s.wounds}/{s.woundsMax}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {pickedStand && (
        <div className="stand-detail">
          <div className="stand-detail-title">
            {standName(reg, pickedStand)} · {pickedStand.wounds}/{pickedStand.woundsMax}
          </div>
          <div className="btn-row">
            <button onClick={() => dispatch({ type: 'adjustStandWounds', id: reg.id, standId: pickedStand.id, delta: -1 })}>− wound</button>
            <button onClick={() => dispatch({ type: 'adjustStandWounds', id: reg.id, standId: pickedStand.id, delta: 1 })}>+ wound</button>
            <button onClick={() => dispatch({ type: 'removeStand', id: reg.id, standId: pickedStand.id }) && setPicked(null)}>Remove</button>
          </div>
          <div className="btn-row">
            {!pickedStand.isCommand && <button onClick={() => dispatch({ type: 'setCommandStand', id: reg.id, standId: pickedStand.id })}>Make command</button>}
            {pickedStand.isCommand && <button onClick={() => dispatch({ type: 'setCommandStand', id: reg.id, standId: null })}>Clear command</button>}
            <span className="row-label">Label</span>
            <TextField value={pickedStand.label ?? ''} placeholder="e.g. Standard" onCommit={(v) => dispatch({ type: 'updateStand', id: reg.id, standId: pickedStand.id, label: v || null })} />
          </div>
        </div>
      )}

      {!reform ? (
        <div className="btn-row">
          <button onClick={startReform} title="Change files or move stands to new slots">
            Reform…
          </button>
          <span className="muted small">Click a stand to adjust its wounds.</span>
        </div>
      ) : (
        <div className="reform-bar">
          <div className="btn-row">
            <span className="row-label">Files</span>
            <NumberField value={reform.files} digits={0} step={1} min={1} max={60} width={48} onCommit={(n) => n && autoArrange(n)} />
            <button onClick={() => autoArrange(reform.files)}>Auto layout</button>
          </div>
          <div className="muted small">Pick a stand, then click an empty cell to move it or another stand to swap.</div>
          <div className="btn-row">
            <button
              className="primary"
              onClick={() => {
                if (dispatch({ type: 'reformRegiment', id: reg.id, files: reform.files, slots: reform.slots })) setReform(null);
              }}
            >
              Apply reform
            </button>
            <button onClick={() => setReform(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
