import { useEffect } from 'react';
import { Board } from './board/Board';
import { HelpOverlay, SettingsDialog, Toast } from './panels/Dialogs';
import { Inspector } from './panels/Inspector';
import { LogPanel } from './panels/LogPanel';
import { Roster } from './panels/Roster';
import { Toolbar } from './panels/Toolbar';
import { useStore } from './store';

export function App() {
  const showHelp = useStore((s) => s.showHelp);
  const showSettings = useStore((s) => s.showSettings);

  // Global shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        st.undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?') st.setShowHelp(!st.showHelp);
      else if (e.key === 'Escape') {
        if (st.showHelp) st.setShowHelp(false);
        else if (st.showSettings) st.setShowSettings(false);
        else if (st.tool !== 'select') st.setTool('select');
        else st.select(null);
      } else if (e.key === 'v' || e.key === 'V') st.setTool('select');
      else if (e.key === 't' || e.key === 'T') st.setTool('drawTerrain');
      else if (e.key === 'f' || e.key === 'F') st.zoomToFit();
      else if (e.key === 'Delete') {
        const sel = st.selection;
        if (sel?.kind === 'regiment') {
          const r = st.battle.regiments.find((x) => x.id === sel.id);
          if (r && r.location !== 'reserve' && confirm(`Send ${r.name} to reserve?`)) st.dispatch({ type: 'setRegimentLocation', id: r.id, location: 'reserve' });
        } else if (sel?.kind === 'character') {
          const c = st.battle.characters.find((x) => x.id === sel.id);
          if (c && c.location !== 'reserve' && confirm(`Send ${c.name} to reserve?`)) st.dispatch({ type: 'setCharacterLocation', id: c.id, location: 'reserve' });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="app-toolbar">
        <Toolbar />
      </header>
      <aside className="app-left">
        <Roster />
      </aside>
      <main className="app-board">
        <Board />
      </main>
      <aside className="app-right">
        <Inspector />
      </aside>
      <footer className="app-log">
        <LogPanel />
      </footer>
      {showHelp && <HelpOverlay />}
      {showSettings && <SettingsDialog />}
      <Toast />
    </div>
  );
}
