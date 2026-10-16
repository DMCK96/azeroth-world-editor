import { useEffect, useRef, useState } from 'react';
import type { IdConflict } from '@shared/ipc';
import type { AppStore } from '../state/app-store';
import { trapTab } from '../components/trap-tab';
import './ProjectDialog.css';
import './IdConflictDialog.css';

const round = (n: number): number => Math.round(n * 10) / 10;

/** A side of a clash: its name and entry, or just the entry when it has no name */
const who = (side: { name: string; entry: number }): string => (side.name.trim() ? `${side.name} (${side.entry})` : `entry ${side.entry}`);

/** "a spawn", "a spawn and a quest": what the clashing ids are of, whatever kinds are present */
const aNoun = (conflicts: IdConflict[]): string => [...new Set(conflicts.map((c) => c.noun))].map((n) => `a ${n}`).join(' and ');

/** The clashes under the label of what they are of, in the order they came */
function groupByLabel(conflicts: IdConflict[]): [string, IdConflict[]][] {
  const groups = new Map<string, IdConflict[]>();
  for (const c of conflicts) groups.set(c.scopeLabel, [...(groups.get(c.scopeLabel) ?? []), c]);
  return [...groups];
}

/**
 * Offered when the database now holds something at an id the project gave to one of its own. Renumber
 * gives the project's ids free ones (one undo step); Leave as is changes nothing. It waits while a crash
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
        <p>The database has {aNoun(conflicts)} with these ids now. Renumber the project&apos;s ids so they do not conflict?</p>
        {groupByLabel(conflicts).map(([label, group]) => (
          <section key={label}>
            <h3>{label}</h3>
            <ul className="project-dialog__recent">
              {group.map((c) => (
                <li key={`${c.kind}:${c.scope}:${c.id}`} className="project-dialog__recent-row">
                  <span className="project-dialog__recent-open">
                    {c.id}: yours is {who(c.mine)}; the database has {who(c.database)} on map {c.database.map} at {round(c.database.x)}, {round(c.database.y)}, {round(c.database.z)}.
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
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
