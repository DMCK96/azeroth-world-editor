import { useEffect, useMemo, useState } from 'react';
import { createAppStore, type AppState } from './state/app-store';
import { LoginScreen } from './views/LoginScreen';
import { AppShell } from './views/AppShell';
import { UpdateDialog } from './views/UpdateDialog';
import { NamesProvider, localNamesOf } from './state/names';
import { RewardTablesProvider } from './state/reward-tables';
import { HistoryProvider } from './state/history-context';
import { searchingFresh } from './state/project-entities';
import { startDebugBridge } from './debug/bridge';
import './App.css';

const inApp = (screen: AppState['screen']): boolean => screen === 'pick' || screen === 'preview' || screen === 'edit';

export function App(): React.JSX.Element {
  const store = useMemo(() => createAppStore(window.api), []);
  const api = useMemo(() => searchingFresh(window.api, () => store.getState().flushEntities()), [store]);
  const screen = store((s) => s.screen);
  const connection = store((s) => s.connection);
  const recoveries = store((s) => s.recoveries);
  const recoveriesLoaded = store((s) => s.recoveriesLoaded);
  // The project's new NPCs, objects and quests, named in pickers before the main process has them.
  const entities = store((s) => s.entities);
  const nodes = store((s) => s.nodes);
  const local = useMemo(() => localNamesOf(entities, nodes), [entities, nodes]);
  // Connecting from the login screen keeps it on top of the app for a moment while it leaves: its
  // orb spins down into the welcome's, or the app bar's (see LoginScreen's `leaving`).
  const [leaving, setLeaving] = useState(false);
  const [shown, setShown] = useState(screen);
  if (shown !== screen) {
    setShown(screen);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    setLeaving(shown === 'connect' && inApp(screen) && !reduced);
  }

  useEffect(() => {
    void store.getState().start();
    // Closing the window asks for pending edits first, so the unsaved-changes check sees them.
    window.appEvents?.onFlushRequest(() => {
      // Closing must not lose an edit, whatever write was on its way
      store.getState().holdEdits(false);
      return store.getState().flushAll();
    });
    // The Undo buttons follow every step the main process records, whatever made it
    window.appEvents?.onHistory?.((list) => store.getState().setHistory(list));
    // An AI client connected the editor to a world database through MCP: leave the login screen
    window.appEvents?.onConnected?.((summary) => void store.getState().adoptConnection(summary));
    // What an AI client changed through MCP appears as an undo would: the open quest, the canvas, the world
    window.appEvents?.onHoldEdits?.((held) => store.getState().holdEdits(held));
    window.appEvents?.onExternalChange?.((change) => void store.getState().applyExternalChange(change));
    // Debug mode: the window's recorders, while the Preferences switch is on, and answers to the probes
    return startDebugBridge({ api: window.api, events: window.appEvents ?? {}, win: window });
  }, [store]);

  // Both stay in the same slots, so the login screen is not remounted when the canvas appears.
  return (
    <>
      {inApp(screen) && (
        <div className={leaving ? 'app-arriving' : undefined} style={{ display: 'contents' }}>
          <NamesProvider api={api} epoch={connection} local={local}>
            <RewardTablesProvider api={window.api} epoch={connection}>
              <HistoryProvider store={store}>
                <AppShell store={store} />
              </HistoryProvider>
            </RewardTablesProvider>
          </NamesProvider>
        </div>
      )}
      {(!inApp(screen) || leaving) && <LoginScreen store={store} leaving={leaving} onLeft={() => setLeaving(false)} />}
      {/* Over the connect screen too, so it is the first thing seen; once in the app it waits behind the recovery offer */}
      <UpdateDialog api={window.api} blocked={recoveries.length > 0 || (inApp(screen) && !recoveriesLoaded)} />
    </>
  );
}
