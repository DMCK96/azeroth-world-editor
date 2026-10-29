import { useEffect, useRef, useState } from 'react';
import type { AppStore } from '../state/app-store';
import './ProjectDialog.css';

const DEFAULT_NEW_NAME = 'Untitled Project';

/**
 * The Project modal: the open project's name and file, New / Open / Save / Save As, and the recent
 * list. Actions that switch or re-home the project (New, Open, Save As) close it once they are done;
 * a plain Save leaves it open, since nothing it shows has moved.
 */
export function ProjectDialog({ store, onClose }: { store: AppStore; onClose: () => void }): React.JSX.Element {
  const project = store((s) => s.project);
  const recent = store((s) => s.recent);
  const epoch = store((s) => s.projectEpoch);
  const error = store((s) => s.error);
  const { loadRecent, renameProject, newProject, openProject, saveProject, saveProjectAs, forgetRecent } = store.getState();

  const [name, setName] = useState(project.name);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState(DEFAULT_NEW_NAME);
  const newNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  // The name last sent, so leaving the field after Enter does not send it again: a second rename landing
  // after an undo would quietly redo it
  const sent = useRef<string | null>(null);
  // Keep the field in step when the name changes underneath it (a rename landing, a project switch, an
  // undo); a name other than the one sent means the project moved on, so the same name may be sent again
  useEffect(() => {
    setName(project.name);
    if (project.name !== sent.current) sent.current = null;
  }, [project.name]);

  useEffect(() => {
    if (creating) newNameRef.current?.select();
  }, [creating]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const commitName = (): void => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setName(project.name);
      return;
    }
    if (trimmed === project.name || trimmed === sent.current) return;
    sent.current = trimmed;
    void renameProject(trimmed);
  };

  /** Runs an action that may switch projects, closing the modal only if it actually happened. */
  const closeAfter = async (action: () => Promise<void>, happened: () => boolean): Promise<void> => {
    await action();
    if (happened()) onClose();
  };
  const switched = (before: number) => () => store.getState().projectEpoch !== before;

  const create = (): void => {
    const trimmed = newName.trim();
    if (trimmed === '') return;
    void closeAfter(() => newProject(trimmed), switched(epoch));
  };

  // Save As happened when nothing went wrong and the project is now saved to a file.
  const saveAs = (): void =>
    void closeAfter(saveProjectAs, () => {
      const after = store.getState();
      return after.error === null && after.project.filePath !== null && !after.project.dirty;
    });

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
        <header className="modal__header">
          <h2 id="project-dialog-title">Project</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <label className="project-dialog__field">
          <span>Project name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
            }}
          />
        </label>
        <p className="project-dialog__path">{project.filePath ?? 'Not saved yet'}</p>

        <div className="project-dialog__actions">
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            New project…
          </button>
          <button type="button" className="btn" onClick={() => void closeAfter(() => openProject(), switched(epoch))}>
            Open…
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              // The merge has a dialog of its own, which takes this one's place
              onClose();
              store.getState().openMerge();
            }}
          >
            Merge project…
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void saveProject()}>
            Save
          </button>
          <button type="button" className="btn" onClick={saveAs}>
            Save As…
          </button>
        </div>

        {creating && (
          <div className="project-dialog__new">
            <label className="project-dialog__field">
              <span>New project name</span>
              <input
                ref={newNameRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') create();
                }}
              />
            </label>
            <button type="button" className="btn btn--primary" onClick={create} disabled={newName.trim() === ''}>
              Create
            </button>
          </div>
        )}

        {error && (
          <p className="project-dialog__error" role="alert">
            {error}
          </p>
        )}

        <h3 className="project-dialog__heading">Recent projects</h3>
        {recent.length === 0 ? (
          <p className="project-dialog__empty">No recent projects yet.</p>
        ) : (
          <ul className="project-dialog__recent">
            {recent.map((r) => (
              <li key={r.path} className="project-dialog__recent-row" aria-disabled={!r.exists || undefined}>
                {r.exists ? (
                  <button
                    type="button"
                    className="project-dialog__recent-open"
                    aria-label={`Open ${r.name}`}
                    onClick={() => void closeAfter(() => openProject(r.path), switched(epoch))}
                  >
                    <span className="project-dialog__recent-name">{r.name}</span>
                    <span className="project-dialog__recent-path">{r.path}</span>
                    <span className="project-dialog__recent-date">{new Date(r.openedAt).toLocaleString()}</span>
                  </button>
                ) : (
                  <div className="project-dialog__recent-open project-dialog__recent-open--missing">
                    <span className="project-dialog__recent-name">{r.name}</span>
                    <span className="project-dialog__recent-path">{r.path}</span>
                    <span className="project-dialog__recent-date">File not found</span>
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn--icon"
                  aria-label={`Remove ${r.name} from recent projects`}
                  title="Remove from recent projects"
                  onClick={() => void forgetRecent(r.path)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
