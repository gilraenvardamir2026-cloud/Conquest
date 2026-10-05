// Right panel during a move session: segments, running total against March,
// warnings, precise entry and Align to target.

import { useState } from 'react';
import {
  alignTargetFrame,
  alignToFacing,
  facingName,
  fmtIn,
  forwardSegment,
  moveWarnings,
  pieceAt,
  rotateSegment,
  segmentsTotal,
  sidewaysSegment,
  wheelByDistance,
  wheelSegment,
  type MoveSegment,
} from '@conquest/shared';
import { applyAlign } from '../moveActions';
import { sessionPose, useStore } from '../store';
import { NumberField, Section } from '../ui/fields';

/** Left column of the segment list: what kind of move, without the amount. */
function segName(s: MoveSegment): string {
  switch (s.kind) {
    case 'forward':
      return s.value >= 0 ? 'Forward' : 'Backward';
    case 'sideways':
      return `Sideways ${s.value >= 0 ? 'R' : 'L'}`;
    case 'wheel':
      return `Wheel ${s.value < 0 ? 'L' : 'R'}${s.backward ? ' (backward)' : ''}`;
    case 'rotate':
      return `Rotate ${s.value < 0 ? 'L' : 'R'}`;
    case 'free':
      return 'Free drag';
    case 'align':
      return 'A' + s.label.slice(1).replace(/ [\d.]+"$/, '');
  }
}

export function MovePanel() {
  const b = useStore((s) => s.battle);
  const m = useStore((s) => s.moveSession)!;
  const st = useStore.getState();
  const base = sessionPose({ ...m, live: null });
  const me = pieceAt(b, m.piece, base);
  const [fwd, setFwd] = useState(0);
  const [side, setSide] = useState(0);
  const [wheel, setWheel] = useState(0);
  const [wheelUnit, setWheelUnit] = useState<'deg' | 'in'>('in');
  const [rot, setRot] = useState(0);
  if (!me) return null;
  const segs: MoveSegment[] = [...m.segments, ...(m.live ? [m.live] : [])];
  const total = segmentsTotal(segs);
  const warnings = moveWarnings(b, m.piece, sessionPose(m), segs);
  const march = me.march;
  const sideTotal = segs.filter((s) => s.kind === 'sideways').reduce((a, s) => a + s.distance, 0);
  const add = (seg: MoveSegment) => st.addSegment(seg);
  const target = m.align ? alignTargetFrame(b, m.align.target) : null;
  const alignRes = m.align && target ? alignToFacing(base, me.box, target.frame, m.align.facing, m.align.mode) : null;

  const addWheel = (dir: 'left' | 'right') => {
    if (!wheel) return;
    add(wheelUnit === 'in' ? wheelByDistance(base, me.box, Math.abs(wheel), dir) : wheelSegment(base, me.box, dir === 'left' ? -Math.abs(wheel) : Math.abs(wheel), dir));
  };

  return (
    <div className="inspector">
      <Section title={`Moving ${me.name}`}>
        <table className="segments">
          <tbody>
            {segs.length === 0 && (
              <tr>
                <td className="muted small" colSpan={2}>
                  Drag the body or a handle, use the arrow keys, or type values below.
                </td>
              </tr>
            )}
            {segs.map((s, i) => (
              <tr key={i} className={s === m.live ? 'live' : s.backward ? 'warn' : undefined}>
                <td>{segName(s)}</td>
                <td className="num-cell">{s.kind === 'rotate' ? `${Math.abs(Math.round(s.value * 10) / 10)}°` : fmtIn(s.distance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={march !== undefined && total > march + 1e-3 ? 'over' : undefined}>
              <td>Total</td>
              <td className="num-cell">
                {fmtIn(total)}
                {march !== undefined ? ` / March ${fmtIn(march)}` : ''}
              </td>
            </tr>
            {march !== undefined && sideTotal > 0 && (
              <tr className={sideTotal > march / 2 + 1e-3 ? 'over' : undefined}>
                <td>Sideways</td>
                <td className="num-cell">
                  {fmtIn(sideTotal)} / max {fmtIn(march / 2)}
                </td>
              </tr>
            )}
          </tfoot>
        </table>
        {warnings.length > 0 && (
          <div className="chips">
            {warnings.map((w, i) => (
              <span key={i} className={`chip warn-chip ${w.kind}`} title="Warning only: nothing is blocked">
                ⚠ {w.text}
              </span>
            ))}
          </div>
        )}
        <div className="btn-row">
          <button className="primary" onClick={() => st.commitMove()} title="Commit the move as one log entry (Enter)">
            Commit (Enter)
          </button>
          <button onClick={() => st.cancelMove()} title="Put it back where it started (Esc)">
            Revert (Esc)
          </button>
          <button disabled={!m.segments.length} onClick={() => st.popSegment()} title="Remove the last segment (Backspace)">
            Undo segment
          </button>
        </div>
      </Section>

      <Section title="Align to target">
        {!m.aligning && !m.align && (
          <button onClick={() => st.setAligning(true)} disabled={m.piece.kind !== 'regiment' && m.piece.kind !== 'character'}>
            Pick a target…
          </button>
        )}
        {m.aligning && (
          <div className="btn-row">
            <span className="muted small">Click the front, a flank or the rear of an enemy regiment, or a side of an objective marker.</span>
            <button onClick={() => st.setAligning(false)}>Cancel</button>
          </div>
        )}
        {m.align && target && alignRes && (
          <>
            <div>
              Front edge flush against the {facingName(m.align.target.kind, m.align.facing)} of <b>{target.name}</b>: front centre travels <b>{fmtIn(alignRes.travel)}</b>.
            </div>
            <div className="btn-row">
              <span className="row-label">Position</span>
              <button aria-pressed={m.align.mode === 'contact'} onClick={() => st.setAlign({ ...m.align!, mode: 'contact' })} title="Most contact, closest to where it is now">
                Max contact
              </button>
              <button aria-pressed={m.align.mode === 'centre'} onClick={() => st.setAlign({ ...m.align!, mode: 'centre' })}>
                Centred
              </button>
            </div>
            <div className="btn-row">
              <button className="primary" onClick={applyAlign}>
                Apply (Enter)
              </button>
              <button onClick={() => st.setAlign(null)}>Cancel</button>
            </div>
            <div className="muted small">The tool only proposes the pose; whether the move is allowed is up to the players.</div>
          </>
        )}
      </Section>

      <Section title="Precise entry">
        <div className="btn-row">
          <span className="row-label">Forward</span>
          <NumberField value={fwd} width={56} onCommit={(n) => setFwd(n ?? 0)} suffix='"' title="Negative = backward" />
          <button onClick={() => fwd && add(forwardSegment(base, fwd))}>Add</button>
        </div>
        <div className="btn-row">
          <span className="row-label">Sideways</span>
          <NumberField value={side} width={56} onCommit={(n) => setSide(n ?? 0)} suffix='"' title="Negative = left" />
          <button onClick={() => side && add(sidewaysSegment(base, side))}>Add</button>
        </div>
        <div className="btn-row">
          <span className="row-label">Wheel</span>
          <NumberField value={wheel} width={56} min={0} onCommit={(n) => setWheel(n ?? 0)} />
          <select value={wheelUnit} onChange={(e) => setWheelUnit(e.target.value as 'deg' | 'in')} aria-label="Wheel unit">
            <option value="in">inches</option>
            <option value="deg">degrees</option>
          </select>
          <button onClick={() => addWheel('left')}>Left</button>
          <button onClick={() => addWheel('right')}>Right</button>
        </div>
        <div className="btn-row">
          <span className="row-label">Rotate</span>
          <NumberField value={rot} width={56} min={-180} max={180} onCommit={(n) => setRot(n ?? 0)} suffix="°" title="About the centre; negative = anticlockwise" />
          <button onClick={() => rot && add(rotateSegment(base, me.box, rot))}>Add</button>
        </div>
        <div className="muted small">Arrow keys nudge 0.1" (Shift 1") along its own axes · Q / E rotate 1° (Shift 15°) · Shift-drag the body to stay on the facing axis.</div>
      </Section>
    </div>
  );
}
