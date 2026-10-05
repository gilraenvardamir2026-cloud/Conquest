// Right panel for the line-of-sight tool: acting piece, target, mode, the
// headline, a row per acting front-rank stand, notes, and Post to log.

import { useMemo } from 'react';
import { ARC_LABEL, describeLos, fmtIn, KEYWORD_INITIALS, lineOfSight, refName, type Arc, type Battle, type LosParty, type LosRow } from '@conquest/shared';
import { dispatch, useStore, withSession } from '../store';
import { Section } from '../ui/fields';

const partyName = (b: Battle, p: LosParty) => refName(b, p);

function rowResult(r: LosRow): string {
  if (r.clear) return 'clear';
  if (r.blockedBy.length) return `blocked: ${r.blockedBy.join(', ')}`;
  return r.best?.status === 'outOfArc' ? 'not in front arc' : 'no clear line';
}

export function LosPanel() {
  const battle = useStore((s) => s.battle);
  const session = useStore((s) => s.moveSession);
  const los = useStore((s) => s.los);
  const st = useStore.getState();
  const b = useMemo(() => withSession(battle, session), [battle, session]);
  const result = useMemo(() => (los.acting && los.target ? lineOfSight(b, los.acting, los.target, los.mode, { allLines: los.allLines }) : null), [b, los]);
  const close = (
    <button className="icon" title="Back to selecting (V)" onClick={() => st.setTool('select')}>
      ✕
    </button>
  );
  const arcs = result ? (Object.keys(result.arcCounts) as Arc[]).map((a) => `${ARC_LABEL[a]}: ${result.arcCounts[a]}`).join(' · ') : '';
  return (
    <div className="inspector">
      <Section title="Line of sight" right={close}>
        <div className="btn-row">
          <span className="row-label">Mode</span>
          <button aria-pressed={los.mode === 'sight'} onClick={() => st.setLos({ mode: 'sight' })} title="Charges and general LoS: front-edge centres to the centre of each target edge">
            Sight
          </button>
          <button aria-pressed={los.mode === 'volley'} onClick={() => st.setLos({ mode: 'volley' })} title="Volleys: to any point of any target stand, shortest clear line">
            Volley
          </button>
        </div>
        <div className="los-party">
          <span className="row-label">Acting</span>
          {los.acting ? (
            <span>
              <b>{partyName(b, los.acting)}</b> {result && <span className="muted small">size {result.acting.size} ({result.acting.note})</span>}
            </span>
          ) : (
            <span className="muted">click a regiment on the board</span>
          )}
        </div>
        <div className="los-party">
          <span className="row-label">Target</span>
          {los.target ? (
            <span>
              <b>{partyName(b, los.target)}</b> {result && <span className="muted small">size {result.target.size} ({result.target.note})</span>}
            </span>
          ) : (
            <span className="muted">click a regiment, character or objective marker</span>
          )}
        </div>
        <div className="btn-row">
          <button
            disabled={!los.acting || !los.target || los.target.kind === 'objective'}
            onClick={() => st.setLos({ acting: los.target, target: los.acting })}
            title="Swap acting and target"
          >
            Swap
          </button>
          <button disabled={!los.acting && !los.target} onClick={() => st.setLos({ acting: null, target: null })}>
            Clear
          </button>
          {los.mode === 'volley' && (
            <label className="kw">
              <input type="checkbox" checked={los.allLines} onChange={(e) => st.setLos({ allLines: e.target.checked })} /> show every tested line
            </label>
          )}
        </div>
        {los.acting && los.target && !result && <div className="banner warn">Both pieces must be on the board.</div>}
      </Section>

      {result && (
        <Section title="Result">
          <div className={`headline ${result.clearCount ? 'yes' : 'no'}`}>{result.headline}</div>
          {arcs && <div className="small">In the target's arcs — {arcs}</div>}
          <div className="small">
            Target in {result.actingName}'s front arc: <b>{result.targetInFrontArc ? 'yes' : 'no'}</b>
          </div>
          <table className="los-table">
            <thead>
              <tr>
                <th>Stand</th>
                <th>Arcs</th>
                <th>Line</th>
                <th>Dist</th>
                {result.mode === 'volley' && result.barrageRange !== undefined && (
                  <>
                    <th title={`Within Barrage range ${result.barrageRange}"`}>Range</th>
                    <th title="Closest stand-to-target distance under half the Barrage range">Eff.</th>
                  </>
                )}
                <th>Crosses</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.id} className={r.clear ? 'clear' : 'blocked'}>
                  <td>{r.name}</td>
                  <td>{r.arcs.map((a) => ARC_LABEL[a]).join(', ') || '—'}</td>
                  <td>{rowResult(r)}</td>
                  <td className="num-cell">{r.best ? fmtIn(r.distance ?? r.best.length) : '—'}</td>
                  {result.mode === 'volley' && result.barrageRange !== undefined && (
                    <>
                      <td>{r.inRange ? 'yes' : 'no'}</td>
                      <td>{r.effective ? 'yes' : 'no'}</td>
                    </>
                  )}
                  <td>
                    {r.terrain.length
                      ? r.terrain.map((t) => `${t.name} (${t.keywords.map((k) => KEYWORD_INITIALS[k]).join(' ')})`).join(', ')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.rows.some((r) => r.cover.length) && <div className="small">⚑ Crosses Cover / Obscuring terrain (flagged only; the result is unchanged).</div>}
          {result.notes.map((n, i) => (
            <div key={i} className="small note">
              {n}
            </div>
          ))}
          <div className="legend small">
            <span className="sw clear" /> clear <span className="sw blocked" /> obstructed (blocker outlined) <span className="sw range" /> out of range <span className="sw arc" /> outside the front arc
          </div>
          <div className="btn-row">
            <button className="primary" onClick={() => dispatch({ type: 'logNote', text: describeLos(result) })}>
              Post to log
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}
