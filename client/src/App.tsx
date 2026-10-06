import { useEffect } from 'react';
import { Board } from './board/Board';
import { HelpOverlay, SettingsDialog, Toast } from './panels/Dialogs';
import { Inspector } from './panels/Inspector';
import { LogPanel } from './panels/LogPanel';
import { Roster } from './panels/Roster';
import { Toolbar } from './panels/Toolbar';
import { DiceTray } from './panels/DiceTray';
import { RoomOverlays } from './panels/RoomOverlays';
import { useStore } from './store';
import { applyAlign, cycle, movableFromSelection, nudge, panBy, pinCurrent, refFromSelection, startLos, startMoveForSelection, zoomBy } from './moveActions';

export function App() {
  const showHelp = useStore((s) => s.showHelp);
  const showSettings = useStore((s) => s.showSettings);
  const showDice = useStore((s) => s.showDice);

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
      const m = st.moveSession;
      const step = e.shiftKey ? 1 : 0.1;
      const turn = e.shiftKey ? 15 : 1;
      // Movement keys: along the piece's own axes, starting a move session if needed.
      if (m || movableFromSelection(st.selection)) {
        const k = e.key;
        if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
          e.preventDefault();
          if (k === 'ArrowUp') nudge('forward', step);
          else if (k === 'ArrowDown') nudge('forward', -step);
          else if (k === 'ArrowLeft') nudge('sideways', -step);
          else nudge('sideways', step);
          return;
        }
        if (k === 'q' || k === 'Q') return nudge('rotate', -turn);
        if (k === 'e' || k === 'E') return nudge('rotate', turn);
      } else if (e.key.startsWith('Arrow')) {
        // Nothing to move: the arrows pan the view.
        e.preventDefault();
        const d = e.shiftKey ? 400 : 80;
        const [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key as 'ArrowLeft'] ?? [0, 0];
        panBy(dx, dy);
        return;
      }
      if (e.key === '+' || e.key === '=') return zoomBy(1.25);
      if (e.key === '-' || e.key === '_') return zoomBy(0.8);
      if (e.key === ']') return cycle(1);
      if (e.key === '[') return cycle(-1);
      if (e.key === 'Enter') {
        if (m?.align) applyAlign();
        else if (m) st.commitMove();
        return;
      }
      if (e.key === 'Backspace' && m && st.tool === 'select') {
        e.preventDefault();
        st.popSegment();
        return;
      }
      if (e.key === '?') st.setShowHelp(!st.showHelp);
      else if (e.key === 'Escape') {
        if (st.showHelp) st.setShowHelp(false);
        else if (st.showSettings) st.setShowSettings(false);
        else if (m?.align) st.setAlign(null);
        else if (m?.aligning) st.setAligning(false);
        else if (m) st.cancelMove();
        else if (st.tool !== 'select') st.setTool('select');
        else {
          st.select(null);
          st.setMeasure({ pair: [] });
        }
      } else if (e.key === 'v' || e.key === 'V') st.setTool('select');
      else if (e.key === 'm' || e.key === 'M') startMoveForSelection();
      else if (e.key === 'r' || e.key === 'R') st.setTool('ruler');
      else if (e.key === 'd' || e.key === 'D') st.setTool('distance');
      else if (e.key === 'l' || e.key === 'L') startLos();
      else if (e.key === 'x' || e.key === 'X') st.setShowDice(!st.showDice);
      else if (e.key === 'g' || e.key === 'G') {
        st.setTool('ring');
        const ref = refFromSelection(st.selection);
        if (ref && (ref.kind === 'regiment' || ref.kind === 'character')) st.setRing({ ref });
      } else if (e.key === 'p' || e.key === 'P') pinCurrent();
      else if (e.key === 't' || e.key === 'T') st.setTool('drawTerrain');
      else if (e.key === 'f' || e.key === 'F') st.zoomToFit();
      else if (e.key === 'Delete') {
        const sel = st.selection;
        if (m) st.cancelMove();
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
      {showDice && <DiceTray />}
      <RoomOverlays />
      {showHelp && <HelpOverlay />}
      {showSettings && <SettingsDialog />}
      <Toast />
    </div>
  );
}
