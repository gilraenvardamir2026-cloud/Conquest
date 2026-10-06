// Right panel for the measuring tools, plus the list of pinned measurements.

import { closestBetween, dist, fmtIn, refName, type Battle, type Measurement } from '@conquest/shared';
import { ringRadii } from '../board/Overlays';
import { pinCurrent } from '../moveActions';
import { dispatch, useStore } from '../store';
import { NumberField, Section } from '../ui/fields';

export function MeasurePanel() {
  const b = useStore((s) => s.battle);
  const tool = useStore((s) => s.tool);
  const measure = useStore((s) => s.measure);
  const st = useStore.getState();
  const close = (
    <button className="icon" title="Back to selecting (V)" onClick={() => st.setTool('select')}>
      ✕
    </button>
  );
  return (
    <div className="inspector">
      {tool === 'ruler' && (
        <Section title="Ruler" right={close}>
          {measure.ruler ? (
            <div className="reading">{fmtIn(dist(measure.ruler.a, measure.ruler.b))}</div>
          ) : (
            <div className="muted small">Drag on the board from point to point.</div>
          )}
          <div className="muted small">Snaps to stand corners and edge midpoints; hold Alt to place freely.</div>
          <div className="btn-row">
            <button className="primary" disabled={!measure.ruler} onClick={pinCurrent} title="Keep it on the board for everyone (P)">
              Pin (P)
            </button>
            <button disabled={!measure.ruler} onClick={() => st.setMeasure({ ruler: null })}>
              Clear
            </button>
          </div>
        </Section>
      )}
      {tool === 'distance' && <DistanceSection b={b} close={close} />}
      {tool === 'ring' && <RingSection b={b} close={close} />}
      <PinnedList b={b} />
    </div>
  );
}

function DistanceSection({ b, close }: { b: Battle; close: React.ReactNode }) {
  const pair = useStore((s) => s.measure.pair);
  const r = pair.length === 2 ? closestBetween(b, pair[0], pair[1]) : null;
  const zone = pair.some((p) => p.kind === 'zone');
  return (
    <Section title="Closest distance" right={close}>
      <div className="muted small">Click two things: regiments, characters, terrain, objective markers or zones. Measured stand to stand, never centre to centre. (Ctrl-click does the same with the Select tool.)</div>
      {pair.map((p, i) => (
        <div key={i}>
          {i === 0 ? 'From' : 'To'}: <b>{refName(b, p)}</b>
        </div>
      ))}
      {r && (
        <div className="reading">
          {fmtIn(r.distance)}
          {zone && <span className="small"> · {r.inside ? 'a stand is inside the zone' : 'no stand inside the zone'}</span>}
        </div>
      )}
      {pair.length === 2 && !r && <div className="muted small">One of them is not on the board.</div>}
      <div className="btn-row">
        <button className="primary" disabled={!r} onClick={pinCurrent} title="Keep it on the board for everyone (P)">
          Pin (P)
        </button>
        <button disabled={!pair.length} onClick={() => useStore.getState().setMeasure({ pair: [] })}>
          Clear
        </button>
      </div>
    </Section>
  );
}

function RingSection({ b, close }: { b: Battle; close: React.ReactNode }) {
  const ring = useStore((s) => s.measure.ring);
  const set = useStore.getState().setRing;
  const reg = ring.ref?.kind === 'regiment' ? b.regiments.find((r) => r.id === ring.ref!.id) : undefined;
  const stand = ring.ref?.standId && reg ? reg.stands.find((s) => s.id === ring.ref!.standId) : undefined;
  const radii = ringRadii(b, ring);
  return (
    <Section title="Range rings" right={close}>
      <div className="muted small">Click a regiment or character; Alt-click a stand for that stand alone. The ring is the true offset of the footprint, because ranges are measured from the closest point.</div>
      {ring.ref ? (
        <div>
          From: <b>{refName(b, ring.ref)}</b>
          {stand ? ' (one stand)' : ''}
        </div>
      ) : (
        <div className="muted">Nothing picked yet.</div>
      )}
      <label className="kw">
        <input type="checkbox" checked={ring.march} onChange={(e) => set({ march: e.target.checked })} /> March {reg?.march !== undefined ? fmtIn(reg.march) : '(not set)'}
      </label>
      <label className="kw">
        <input type="checkbox" checked={ring.barrage} onChange={(e) => set({ barrage: e.target.checked })} /> Barrage {reg?.barrageRange !== undefined ? fmtIn(reg.barrageRange) : '(not set)'}
      </label>
      <label className="kw">
        <input type="checkbox" checked={ring.halfBarrage} onChange={(e) => set({ halfBarrage: e.target.checked })} /> Half Barrage {reg?.barrageRange !== undefined ? fmtIn(reg.barrageRange / 2) : '(not set)'}
      </label>
      <div className="btn-row">
        <span className="row-label">Custom</span>
        <NumberField value={ring.custom ?? undefined} allowEmpty min={0.1} max={200} width={56} suffix='"' onCommit={(n) => set({ custom: n ?? null })} />
      </div>
      <div className="btn-row">
        <button className="primary" disabled={!radii.length} onClick={pinCurrent} title="Keep them on the board for everyone (P)">
          Pin (P)
        </button>
        <button disabled={!ring.ref} onClick={() => set({ ref: null })}>
          Clear
        </button>
      </div>
    </Section>
  );
}

function describePin(b: Battle, m: Measurement): string {
  if (m.kind === 'ruler') return `Ruler ${fmtIn(dist(m.a, m.b))}`;
  if (m.kind === 'distance') {
    const r = closestBetween(b, m.a, m.b);
    return `${refName(b, m.a)} ↔ ${refName(b, m.b)}: ${r ? fmtIn(r.distance) : 'off board'}`;
  }
  return `${m.label} ${fmtIn(m.radius)}`;
}

/** Pinned measurements, visible to both players until removed. */
export function PinnedList({ b }: { b: Battle }) {
  if (!b.measurements.length) return null;
  return (
    <Section
      title="Pinned measurements"
      right={
        <button className="link" onClick={() => dispatch({ type: 'clearMeasurements' })}>
          Clear all
        </button>
      }
    >
      {b.measurements.map((m) => (
        <div key={m.id} className="btn-row">
          <span className="grow">{describePin(b, m)}</span>
          <button className="icon" title="Remove" onClick={() => dispatch({ type: 'removeMeasurement', id: m.id })}>
            ✕
          </button>
        </div>
      ))}
    </Section>
  );
}
