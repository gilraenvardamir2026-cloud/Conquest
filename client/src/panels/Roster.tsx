// Left panel: one collapsible roster per player, grouped On board / Reserve / Destroyed.
// Reserve rows can be dragged onto the board.

import { useState } from 'react';
import { REGIMENT_DEFAULTS, regimentCenter, STAND_TYPES, totalDamage, type Battle, type Location, type PlayerSeat, type StandType } from '@conquest/shared';
import { useStore } from '../store';
import { addCharacter, addRegiment } from './actions';
import { NumberField } from '../ui/fields';

const GROUPS: { loc: Location; title: string }[] = [
  { loc: 'board', title: 'On board' },
  { loc: 'reserve', title: 'Reserve' },
  { loc: 'destroyed', title: 'Destroyed' },
];

export function Roster() {
  const b = useStore((s) => s.battle);
  return (
    <div className="roster">
      {(['p1', 'p2'] as const).map((seat) => (
        <PlayerRoster key={seat} seat={seat} b={b} />
      ))}
    </div>
  );
}

function PlayerRoster({ seat, b }: { seat: PlayerSeat; b: Battle }) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const selection = useStore((s) => s.selection);
  const { select, centreOn } = useStore.getState();
  const p = b.players[seat];
  const regs = b.regiments.filter((r) => r.owner === seat);
  const chars = b.characters.filter((c) => c.owner === seat && !c.attachedTo);

  const pick = (kind: 'regiment' | 'character', id: string) => {
    select({ kind, id });
    if (kind === 'regiment') {
      const r = b.regiments.find((x) => x.id === id);
      if (r?.location === 'board') {
        const c = regimentCenter(r);
        centreOn(c.x, c.y);
      }
    } else {
      const c = b.characters.find((x) => x.id === id);
      if (c?.location === 'board' && c.x !== undefined) centreOn(c.x, c.y ?? 0);
    }
  };

  const drag = (kind: 'regiment' | 'character', id: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-conquest', JSON.stringify({ kind, id }));
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <section className="player-roster">
      <header style={{ borderColor: p.color }}>
        <button className="collapse" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'}
        </button>
        <span className="swatch" style={{ background: p.color }} />
        <strong>{p.name}</strong>
        <span className="muted small">{seat.toUpperCase()}</span>
      </header>
      {open && (
        <>
          <div className="btn-row">
            <button onClick={() => setAdding(!adding)}>+ Regiment</button>
            <button onClick={() => addCharacter(b, seat)}>+ Character</button>
          </div>
          {adding && <NewRegimentForm seat={seat} b={b} onDone={() => setAdding(false)} />}
          {GROUPS.map(({ loc, title }) => {
            const rs = regs.filter((r) => r.location === loc);
            const cs = chars.filter((c) => c.location === loc);
            if (!rs.length && !cs.length) return null;
            return (
              <div key={loc} className="group">
                <div className="group-title">{title}</div>
                {rs.map((r) => {
                  const ch = r.characterId ? b.characters.find((c) => c.id === r.characterId) : undefined;
                  const sel = selection?.kind === 'regiment' && selection.id === r.id;
                  return (
                    <div
                      key={r.id}
                      className={`roster-row ${sel ? 'selected' : ''}`}
                      draggable={loc === 'reserve'}
                      onDragStart={drag('regiment', r.id)}
                      onClick={() => pick('regiment', r.id)}
                      title={loc === 'reserve' ? 'Drag onto the board to deploy' : undefined}
                    >
                      <span className="name">
                        {r.name}
                        {ch ? <span className="muted"> ★ {ch.name}</span> : null}
                        {r.garrisonId ? <span className="muted"> (garrison)</span> : null}
                      </span>
                      <span className="meta">
                        {r.stands.length} st · {totalDamage(r)} dmg
                      </span>
                    </div>
                  );
                })}
                {cs.map((c) => {
                  const sel = selection?.kind === 'character' && selection.id === c.id;
                  return (
                    <div
                      key={c.id}
                      className={`roster-row char ${sel ? 'selected' : ''}`}
                      draggable={loc === 'reserve'}
                      onDragStart={drag('character', c.id)}
                      onClick={() => pick('character', c.id)}
                    >
                      <span className="name">★ {c.name}</span>
                      <span className="meta">
                        {c.wounds}/{c.woundsMax}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {!regs.length && !chars.length && <div className="muted small pad">No units yet.</div>}
        </>
      )}
    </section>
  );
}

function NewRegimentForm({ seat, b, onDone }: { seat: PlayerSeat; b: Battle; onDone: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<StandType>('infantry');
  const d = REGIMENT_DEFAULTS[type];
  const [stands, setStands] = useState(d.stands);
  const [files, setFiles] = useState(d.files);
  const [wounds, setWounds] = useState(d.wounds);
  const changeType = (t: StandType) => {
    setType(t);
    const x = REGIMENT_DEFAULTS[t];
    setStands(x.stands);
    setFiles(x.files);
    setWounds(x.wounds);
  };
  return (
    <form
      className="new-regiment"
      onSubmit={(e) => {
        e.preventDefault();
        addRegiment(b, { owner: seat, name: name.trim() || `${type[0].toUpperCase()}${type.slice(1)} regiment`, standType: type, stands, files, wounds });
        onDone();
      }}
    >
      <input type="text" autoFocus placeholder="Name, e.g. Militia" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={type} onChange={(e) => changeType(e.target.value as StandType)}>
        {STAND_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <div className="btn-row">
        <span className="row-label">Stands</span>
        <NumberField value={stands} digits={0} step={1} min={1} max={60} width={44} onCommit={(n) => n && setStands(n)} />
        <span className="row-label">Files</span>
        <NumberField value={files} digits={0} step={1} min={1} max={60} width={44} onCommit={(n) => n && setFiles(n)} />
        <span className="row-label">W</span>
        <NumberField value={wounds} digits={0} step={1} min={1} max={99} width={44} onCommit={(n) => n && setWounds(n)} />
      </div>
      <div className="btn-row">
        <button type="submit" className="primary">
          Add to reserve
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
