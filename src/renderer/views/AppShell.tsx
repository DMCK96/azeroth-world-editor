import { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectEntitiesFromStore } from '../state/project-entities';
import type { AppStore } from '../state/app-store';
import { AppBar } from '../components/AppBar';
import { ErrorBanner } from '../components/ErrorBanner';
import { HistoryNote } from '../components/HistoryNote';
import { isTextField } from '../components/HistoryButtons';
import { ChainDock } from './dock/ChainDock';
import { DockLayout } from './dock/DockLayout';
import { usePreferences } from '../preferences/usePreferences';
import { WorldWorkspace } from '../world3d/WorldWorkspace';
import { projectKey } from '../world3d/welcome-seen';
import { PlaceInWorldProvider, ShowInWorldProvider, type PlaceInWorld, type ShowTarget, type WorldRequest } from '../world3d/ShowInWorldContext';
import { QuestEditorModal } from './QuestEditorModal';
import { ProjectDialog } from './ProjectDialog';
import { SettingsDialog } from './SettingsDialog';
import { RecoveryDialog } from './RecoveryDialog';
import { IdConflictDialog } from './IdConflictDialog';
import { MergeDialog } from './MergeDialog';
import './AppShell.css';

/**
 * The app once connected: the app bar over the world in 3D, where the app opens, with the quest chain
 * in a dock under or beside it. The world is never hidden, so opening and closing the dock keeps the
 * camera where it was.
 */
export function AppShell({ store }: { store: AppStore }): React.JSX.Element {
  const [dockOpen, setDockOpen] = useState(false);
  const [showProject, setShowProject] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [prefs, updatePrefs] = usePreferences();
  const questsAsked = store((s) => s.questsAsked);
  const filePath = store((s) => s.project.filePath);
  const projectName = store((s) => s.project.name);
  const hasClient = store((s) => Boolean(s.summary?.clientDir));

  const open = store((s) => s.open);
  const nodes = store((s) => s.nodes);
  const focus = store((s) => s.focus);
  const [goTo, setGoTo] = useState<{ map: number; x: number; y: number; z: number; nonce: number } | undefined>();

  // When the author last opened or closed the dock themselves, on the store's clock; drawn again (after
  // a reconnect), the shell starts from now, so a quest opened before it does not open the dock
  const toggledAt = useRef<number | null>(null);
  toggledAt.current ??= store.getState().moment();
  const toggleDock = useCallback(() => {
    toggledAt.current = store.getState().moment();
    setDockOpen((was) => !was);
  }, [store]);

  // A quest opened from anywhere is previewed in the dock, so the dock opens; but not for an open the
  // author has since turned away from, by closing the dock while it was on its way
  useEffect(() => {
    if (questsAsked > toggledAt.current!) setDockOpen(true);
  }, [questsAsked]);

  // Show in World / Go to: the quest, or one of its NPCs or objects, becomes the focus, which the World
  // follows; asked twice, it goes there twice
  const showInWorld = useCallback((target: ShowTarget) => {
    setDockOpen(true);
    store.getState().setFocus(target.questId, 'kind' in target ? { kind: target.kind, entry: target.entry } : null, { again: true });
  }, [store]);

  // Place in world, Draw patrol and Show in World from an editor: the World does it, and the editor that
  // asked is told once it is done. A request made before the last is done ends that one
  const [worldRequest, setWorldRequest] = useState<(WorldRequest & { nonce: number }) | undefined>();
  const requestEnd = useRef<(() => void) | undefined>(undefined);
  const placeInWorld = useCallback<PlaceInWorld>((request, onEnd) => {
    const before = requestEnd.current;
    requestEnd.current = onEnd;
    before?.();
    // Showing a quest or its part is the focus's to do; the World says what it shows until Done
    if (request.kind === 'show') showInWorld(request.target);
    setWorldRequest((was) => ({ ...request, nonce: (was?.nonce ?? 0) + 1 }));
  }, [showInWorld]);
  const endRequest = useCallback(() => {
    const end = requestEnd.current;
    requestEnd.current = undefined;
    end?.();
  }, []);

  // The project's name and quests are read as soon as the app is up, for the bar and the world, not only
  // once the dock first opens. Unsaved work a crash left behind is offered once, then too.
  useEffect(() => {
    void store.getState().loadNodes();
    void store.getState().loadRecoveries();
  }, [store]);

  // Ctrl+S saves, Ctrl+Shift+S saves as, Ctrl+O opens: the shortcuts every document app has. Ctrl+Z
  // and Ctrl+Y undo and redo the last change anywhere in the project, except in a text field, whose
  // own undo they are.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      const { saveProject, saveProjectAs, openProject, undo, redo } = store.getState();
      // By the key's place as well as its letter, so a keyboard whose letters are not Latin still undoes
      const z = key === 'z' || e.code === 'KeyZ';
      const y = key === 'y' || e.code === 'KeyY';
      if ((z || y) && !e.altKey) {
        if (isTextField(e.target) || e.defaultPrevented) return;
        e.preventDefault();
        // Held down, it walks back step by step
        void (y || e.shiftKey ? redo() : undo());
        return;
      }
      // A held-down shortcut repeats; one press is one save.
      if (e.repeat) return;
      if (key === 's') {
        e.preventDefault();
        void (e.shiftKey ? saveProjectAs() : saveProject());
      } else if (key === 'o') {
        e.preventDefault();
        void openProject();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [store]);

  return (
    <ProjectEntitiesFromStore store={store}>
    <ShowInWorldProvider value={hasClient ? showInWorld : null}>
    <PlaceInWorldProvider value={hasClient ? placeInWorld : null}>
    <div className="app-shell">
      <AppBar
        store={store}
        dockOpen={dockOpen}
        onToggleDock={toggleDock}
        onOpenProject={() => setShowProject(true)}
        onOpenSettings={() => setShowSettings(true)}
      />
      <ErrorBanner store={store} />
      <HistoryNote
        store={store}
        onShowQuest={(questId) => {
          setDockOpen(true);
          void store.getState().openQuest(questId);
        }}
        onShowPlace={(place) => {
          setGoTo((was) => ({ map: place.map, x: place.x, y: place.y, z: place.z, nonce: (was?.nonce ?? 0) + 1 }));
        }}
      />
      <div className="app-shell__body">
        <DockLayout
          open={dockOpen}
          side={prefs.dockSide}
          size={prefs.dockSize[prefs.dockSide]}
          onSize={(size) => updatePrefs({ dockSize: { ...prefs.dockSize, [prefs.dockSide]: size } })}
          main={
            <WorldWorkspace
              hasClient={hasClient}
              projectKey={projectKey(filePath)}
              // A project not saved yet is welcomed without its placeholder name
              projectName={filePath ? projectName : ''}
              onOpenSettings={() => setShowSettings(true)}
              onShowQuests={() => setDockOpen(true)}
              onStartQuest={() => {
                setDockOpen(true);
                void store.getState().newQuest();
              }}
              quest={open ? { open, nodes } : undefined}
              goTo={goTo}
              focus={focus}
              onFocusPart={(questId, part) => store.getState().setFocus(questId, part)}
              now={store.getState().moment}
              request={worldRequest}
              onRequestEnd={endRequest}
              onQuestField={(fieldId, value) => store.getState().setValue(fieldId, value)}
              onOpenQuest={(questId) => {
                setDockOpen(true);
                void store.getState().openQuest(questId);
              }}
              onNewQuest={(giver, previous) => {
                // The NPC gives the new quest and takes it back; in a chain, it comes after the one that was
                // open. The quest it makes opens the dock.
                void store.getState().newQuestFrom(giver, previous);
              }}
            />
          }
          dock={<ChainDock store={store} />}
        />
      </div>
      <QuestEditorModal store={store} />
      {showProject && <ProjectDialog store={store} onClose={() => setShowProject(false)} />}
      {showSettings && <SettingsDialog store={store} onClose={() => setShowSettings(false)} />}
      <RecoveryDialog store={store} />
      <IdConflictDialog store={store} />
      <MergeDialog store={store} />
    </div>
    </PlaceInWorldProvider>
    </ShowInWorldProvider>
    </ProjectEntitiesFromStore>
  );
}
