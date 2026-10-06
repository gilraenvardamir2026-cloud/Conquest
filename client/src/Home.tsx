// Home page: start a new battle (pick a preset, enter your name), join one by
// link or code, or practise offline in this browser.

import { useState } from 'react';
import { normalizeRoomCode, SAMPLE_LAYOUTS, SCENARIOS } from '@conquest/shared';
import { browserToken, recentRooms, saveName, savedName } from './route';

export function Home({ error }: { error?: string }) {
  const [name, setName] = useState(savedName());
  const [scenario, setScenario] = useState('s1');
  const [layout, setLayout] = useState('layout1');
  const [join, setJoin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(error ?? '');
  const recent = recentRooms();

  const create = async () => {
    setBusy(true);
    setMsg('');
    saveName(name.trim());
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: browserToken(), scenarioId: scenario === 'custom' ? undefined : scenario, layoutId: layout || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `server error ${res.status}`);
      const { code } = (await res.json()) as { code: string };
      location.assign(`/${code}`);
    } catch (e) {
      setMsg(`Could not create a room: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  const go = () => {
    const code = normalizeRoomCode(join);
    if (!code) return setMsg('Paste a room link or a 6-character code.');
    saveName(name.trim());
    location.assign(`/${code}`);
  };

  return (
    <main className="home">
      <h1>Conquest Tabletop</h1>
      <p className="muted">A shared top-down battlefield for two players. It moves pieces and measures in inches; you apply the rules.</p>
      {msg && <div className="banner warn">{msg}</div>}
      <label className="row">
        <span className="row-label">Your name</span>
        <input type="text" value={name} maxLength={40} placeholder="e.g. Alice" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="home-cards">
        <section className="card">
          <h2>New battle</h2>
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
          <button className="primary" disabled={busy} onClick={create}>
            Create battle
          </button>
          <p className="muted small">You get a link to send to your opponent. Anyone with the link can watch; the first two take the seats.</p>
        </section>
        <section className="card">
          <h2>Join</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              go();
            }}
          >
            <label className="row">
              <span className="row-label">Link or code</span>
              <input type="text" value={join} placeholder="https://…/ABC234 or ABC234" onChange={(e) => setJoin(e.target.value)} />
            </label>
            <button className="primary" type="submit">
              Join battle
            </button>
          </form>
          {recent.length > 0 && (
            <div className="recent">
              <div className="muted small">Recent battles</div>
              {recent.map((c) => (
                <a key={c} href={`/${c}`}>
                  {c}
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
      <p className="small">
        <a href="/local">Practise offline</a> <span className="muted">— one browser, saved locally, no opponent.</span>
      </p>
    </main>
  );
}
