import { useEffect, useRef, useState } from 'react';
import type { AppStore } from '../state/app-store';
import { trapTab } from '../components/trap-tab';
import './ProjectDialog.css';
import './IdConflictDialog.css';

/**
 * Offered when the database now holds a spawn at an id the project gave to one of its own. Renumber gives
 * the project's spawns free ids (one undo step); Leave as is changes nothing. It waits while a crash
 * recovery is offered, and a click behind it, which could do either by accident, does nothing.
 */
export function IdConflictDialog({ store }: { store: AppStore }): React.JSX.Element | null {
  const conflicts = store((s) => s.idConflicts);
  const recovering = store((s) => s.recoveries.length > 0);
  const { resolveIdConflicts, dismissIdConflicts } = store.getState();
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement | null>(null);
  const visible = conflicts.length > 0 && !recovering;

  // Focus goes to the dialog itself, not a button, so a stray Space or Enter cannot renumber; back to what had it on closing
  useEffect(() => {
    if (!visible) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [visible]);

  // Caught before anything else hears it: a quest editor behind the dialog also closes on Escape
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (!busy) dismissIdConflicts();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [visible, busy, dismissIdConflicts]);

  if (!visible) return null;

  const renumber = async (): Promise<void> => {
    setBusy(true);
    await resolveIdConflicts();
    setBusy(false);
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="id-conflict-title"
        ref={dialog}
        tabIndex={-1}
        onKeyDown={(e) => trapTab(e, dialog.current)}
      >
        <header className="modal__header">
          <h2 id="id-conflict-title">Ids clash with the database</h2>
        </header>
        <p>The database has a spawn with these ids now. Renumber the project&apos;s spawns so they do not conflict?</p>
        <ul className="project-dialog__recent">
          {conflicts.map((c) => (
            <li key={`${c.kind}:${c.scope}:${c.id}`} className="project-dialog__recent-row">
              <span className="project-dialog__recent-open">
                {c.scopeLabel} {c.id}: yours is {c.mine.name} ({c.mine.entry}); the database has {c.database.name} ({c.database.entry}) on map {c.database.map}.
              </span>
            </li>
          ))}
        </ul>
        <div className="id-conflict__actions">
          <button type="button" className="btn" disabled={busy} onClick={dismissIdConflicts}>
            Leave as is
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void renumber()}>
            Renumber
          </button>
        </div>
      </div>
    </div>
  );
}
