import { useEffect, useRef } from 'react';
import type { Choice, Decision, Dropped, MergePreviewResult, PlanEntry } from '@shared/ipc';
import type { AppState, AppStore } from '../state/app-store';
import { trapTab } from '../components/trap-tab';
import './ProjectDialog.css';
import './MergeDialog.css';

/** What a file is called in the dialog, by its role in the merge */
const FILE: Record<Dropped['from'], string> = { mine: 'this project (mine)', theirs: 'their project (theirs)' };

/** The radio button's name for one answer to a decision */
function optionLabel(option: Choice, decision: Decision): string {
  if (option === 'mine') return 'Keep mine';
  if (option === 'theirs') return 'Keep theirs';
  return `Keep both (theirs gets ${decision.newKey ?? '?'})`;
}

/** The items in the preview, under the decision that settles them, in the order they came */
function entriesByDecision(entries: PlanEntry[]): Map<string, PlanEntry[]> {
  const groups = new Map<string, PlanEntry[]>();
  for (const e of entries) if (e.decisionId !== null) groups.set(e.decisionId, [...(groups.get(e.decisionId) ?? []), e]);
  return groups;
}

/** The decisions under the label of the kind they are of, in the order they came */
function decisionsByLabel(decisions: Decision[]): [string, Decision[]][] {
  const groups = new Map<string, Decision[]>();
  for (const d of decisions) groups.set(d.label, [...(groups.get(d.label) ?? []), d]);
  return [...groups];
}

const None = (): React.JSX.Element => <p className="merge-dialog__none">None.</p>;

/** A list of plain lines, or None. when there are none */
function Lines({ lines }: { lines: string[] }): React.JSX.Element {
  if (lines.length === 0) return <None />;
  return (
    <ul className="merge-dialog__list">
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
}

function Summary({ preview }: { preview: MergePreviewResult }): React.JSX.Element {
  if (preview.summary.length === 0) return <None />;
  return (
    <table className="merge-dialog__table">
      <thead>
        <tr>
          <th scope="col">Kind</th>
          <th scope="col">In both</th>
          <th scope="col">From mine</th>
          <th scope="col">From theirs</th>
          <th scope="col">Renumbered</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        {preview.summary.map((r) => (
          <tr key={r.kind}>
            <th scope="row">{r.label}</th>
            <td>{r.common}</td>
            <td>{r.fromMine}</td>
            <td>{r.fromTheirs}</td>
            <td>{r.renumbered}</td>
            <td>{r.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DroppedList({ dropped }: { dropped: Dropped[] }): React.JSX.Element {
  if (dropped.length === 0) return <None />;
  return (
    <ul className="merge-dialog__list merge-dialog__dropped">
      {dropped.map((d, i) => (
        <li key={i}>
          <span className="merge-dialog__from">From {FILE[d.from]}:</span>{' '}
          {d.what === 'removal' ? `the removal of ${d.line}` : d.line}
        </li>
      ))}
    </ul>
  );
}

/** One item a decision settles: each side's line, and what differs between mine and theirs */
function EntryView({ entry }: { entry: PlanEntry }): React.JSX.Element {
  return (
    <div className="merge-dialog__entry">
      <dl className="merge-dialog__sides">
        {entry.base !== null && (
          <>
            <dt>Base</dt>
            <dd>{entry.base}</dd>
          </>
        )}
        <dt>Mine</dt>
        <dd>{entry.mine ?? 'Removed'}</dd>
        <dt>Theirs</dt>
        <dd>{entry.theirs ?? 'Removed'}</dd>
      </dl>
      {entry.diff.length > 0 && (
        <table className="merge-dialog__table merge-dialog__diff">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Mine</th>
              <th scope="col">Theirs</th>
            </tr>
          </thead>
          <tbody>
            {entry.diff.map((row) => (
              <tr key={row.field}>
                <th scope="row">{row.field}</th>
                <td>{row.from ?? '(none)'}</td>
                <td>{row.to ?? '(none)'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DecisionView({ store, decision, entries, chosen }: { store: AppStore; decision: Decision; entries: PlanEntry[]; chosen: Choice | null }): React.JSX.Element {
  const what = decision.type === 'collision' ? 'Both projects use this id for different things' : 'Changed differently in each project';
  return (
    <fieldset className="merge-dialog__decision">
      <legend>
        {decision.label} {entries[0]?.key ?? decision.id}: {what}
      </legend>
      {entries.map((e) => (
        <EntryView key={`${e.kind}|${e.key}`} entry={e} />
      ))}
      {decision.type === 'collision' && decision.rewrites.length > 0 && (
        <div className="merge-dialog__rewrites">
          <p>Keeping both renumbers theirs to {decision.newKey} and rewrites what points at it:</p>
          <Lines lines={decision.rewrites} />
        </div>
      )}
      <div className="merge-dialog__options">
        {decision.options.map((option) => (
          <label key={option}>
            <input
              type="radio"
              name={`merge-${decision.id}`}
              checked={chosen === option}
              // Read at the click, so the store's current action answers
              onChange={() => void store.getState().chooseMerge(decision.id, option)}
            />
            {optionLabel(option, decision)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Decisions({ store, preview, choices }: { store: AppStore; preview: MergePreviewResult; choices: Record<string, Choice> }): React.JSX.Element {
  if (preview.decisions.length === 0) return <None />;
  const entries = entriesByDecision(preview.entries);
  return (
    <div className="merge-dialog__decisions">
      {decisionsByLabel(preview.decisions).map(([label, group]) => (
        <section key={label}>
          <h4 className="merge-dialog__kind">{label}</h4>
          {group.map((d) => (
            <DecisionView key={d.id} store={store} decision={d} entries={entries.get(d.id) ?? []} chosen={choices[d.id] ?? d.default} />
          ))}
        </section>
      ))}
    </div>
  );
}

/**
 * Merges another project file into the open one. The user picks theirs and, optionally, the base both
 * started from; the preview then shows what the result holds, everything it drops (and which file it
 * came from), what is not carried over, the conflicts and collisions to settle, and the warnings. Merge
 * opens the result as a new unsaved project; nothing in any of the files is changed. It waits while a
 * crash recovery is offered.
 */
export function MergeDialog({ store }: { store: AppStore }): React.JSX.Element | null {
  const merge = store((s) => s.merge);
  const error = store((s) => s.error);
  const recovering = store((s) => s.recoveries.length > 0);
  const dialog = useRef<HTMLDivElement | null>(null);
  const visible = merge.open && !recovering;
  const { busy, preview } = merge;

  // Focus goes to the dialog itself; back to what had it on closing
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
      if (!busy) store.getState().closeMerge();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [visible, busy, store]);

  if (!visible) return null;

  // Each action is read at the click, so the store's current one answers
  const act = (): AppState => store.getState();
  const drops = preview?.dropped.length ?? 0;

  return (
    <div className="modal-backdrop">
      <div
        className="modal merge-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-dialog-title"
        aria-busy={busy || undefined}
        ref={dialog}
        tabIndex={-1}
        onKeyDown={(e) => trapTab(e, dialog.current)}
      >
        <header className="modal__header">
          <h2 id="merge-dialog-title">Merge projects</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" disabled={busy} onClick={() => act().closeMerge()}>
            ✕
          </button>
        </header>
        <p className="merge-dialog__intro">
          Merges another project file into this one. The result opens as a new unsaved project; none of the files is changed.
        </p>

        <div className="merge-dialog__files">
          <div className="merge-dialog__file">
            <span className="merge-dialog__file-role">Their project</span>
            <span className="merge-dialog__file-path">{merge.theirsPath ?? 'Not chosen'}</span>
            <button type="button" className="btn" aria-label="Choose their project" disabled={busy} onClick={() => void act().pickMergeFile('theirs')}>
              Choose…
            </button>
          </div>
          <div className="merge-dialog__file">
            <span className="merge-dialog__file-role">Base project</span>
            <span className="merge-dialog__file-path">{merge.basePath ?? 'None (two-way merge)'}</span>
            <button type="button" className="btn" aria-label="Choose the base project" disabled={busy} onClick={() => void act().pickMergeFile('base')}>
              Choose…
            </button>
            <button type="button" className="btn" disabled={busy || merge.basePath === null} onClick={() => void act().clearMergeBase()}>
              No base (two-way merge)
            </button>
          </div>
        </div>

        {preview?.twoWay && <p className="merge-dialog__two-way">No base: the merge cannot tell which side changed what.</p>}
        {busy && !preview && <p className="merge-dialog__none">Reading the files…</p>}
        {!busy && !preview && merge.theirsPath === null && <p className="merge-dialog__none">Choose their project to see what the merge gives.</p>}

        {error && (
          <p className="project-dialog__error" role="alert">
            {error}
          </p>
        )}

        {preview && (
          <>
            <h3 className="project-dialog__heading">Result</h3>
            <Summary preview={preview} />
            <h3 className="project-dialog__heading">Will be dropped</h3>
            <DroppedList dropped={preview.dropped} />
            <h3 className="project-dialog__heading">Not carried over</h3>
            <Lines lines={preview.notCarried} />
            <h3 className="project-dialog__heading">Needs a decision</h3>
            <Decisions store={store} preview={preview} choices={merge.choices} />
            <h3 className="project-dialog__heading">Warnings</h3>
            <Lines lines={preview.warnings} />
          </>
        )}

        <div className="merge-dialog__actions">
          <button type="button" className="btn" disabled={busy} onClick={() => act().closeMerge()}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={busy || !preview?.settled} onClick={() => void act().applyMerge()}>
            {preview ? `Merge (drops ${drops})` : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
