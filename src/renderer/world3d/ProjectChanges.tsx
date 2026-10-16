import { useEffect, useRef, useState } from 'react';
import type { Api, ApiError, Movement, Placement, RoutePoint, WorldChange, WorldLayer } from '@shared/ipc';
import type { SpawnLocation } from '@core/entities/entity';
import { isQuestPool } from '@core/world/groups';
import type { EventRule } from '@core/entities/model';
import { ruleOfRows } from '@core/entities/spawn-events';
import { trapTab } from '../components/trap-tab';
import { useProjectEntities } from '../state/project-entities';
import { EDIT_NEEDS_DATABASE, EntityList, editableWith } from '../entities/EntityList';
import { useApi } from '../state/names';
import { useExistingDrift } from '../entities/use-existing-drift';
import '../views/ProjectDialog.css';

/**
 * What the project adds to the world database: its new NPCs, objects and items (edit one, or go to
 * its spawn), and every edit in its world layer as it was in the database and as it is now (revert
 * one). Exports them all as the project patch and the patch that puts the database back.
 */
export function ProjectChanges({
  api,
  onLayer,
  onClose,
  onEdit,
  onGoTo,
  layerSeq = 0,
}: {
  api: Api;
  onLayer(layer: WorldLayer): void;
  onClose(): void;
  /** Opens the editor of one of the project's NPCs, objects or items (an existing one is brought into the project first) */
  onEdit?(kind: 'npc' | 'object' | 'item', entry: number): void;
  /** Takes the camera to a spawn of one of the project's NPCs or objects */
  onGoTo?(location: SpawnLocation): void;
  /** Moves when an undo or redo changed the layer, so the list is read again */
  layerSeq?: number;
}): React.JSX.Element {
  const project = useProjectEntities();
  // Editing an existing entity not in the project yet brings it in from the world database
  const connected = useApi() !== null;
  const count = project?.tracked.length ?? 0;
  // Existing entities whose rows the database changed since they were brought in: read when opened and after an undo
  const drifted = useExistingDrift(api, project?.tracked ?? [], layerSeq);
  const dialog = useRef<HTMLDivElement>(null);
  const [changes, setChanges] = useState<WorldChange[] | null>(null);
  const [exported, setExported] = useState<{ applyPath: string; revertPath: string; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What must be fixed before the patch can be written, one line each
  const [issues, setIssues] = useState<string[]>([]);

  // Game event names, read once when the dialog opens
  const [eventNames, setEventNames] = useState<ReadonlyMap<number, string>>(new Map());
  useEffect(() => {
    void Promise.resolve(api.gameEvents?.()).then((r) => {
      if (r?.ok) setEventNames(new Map(r.value.map((e) => [e.id, e.name])));
    });
  }, [api]);

  const load = async (): Promise<void> => {
    const result = await api.worldChanges();
    if (result.ok) setChanges(result.value);
    else setError(result.error.message);
  };
  useEffect(() => {
    void load();
    // Loaded when opened, and again after an undo changed the layer; a revert loads again itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerSeq]);

  const revert = async (change: WorldChange): Promise<void> => {
    const result = await api.worldRevert(
      change.type === 'route' ? { kind: 'route', pathId: change.pathId }
      : change.type === 'movement' ? { kind: 'movement', guid: change.guid }
      : change.type === 'respawn' ? { kind: 'respawn', spawnKind: change.kind, guid: change.guid }
      : change.type === 'group' ? { kind: 'group', id: change.id }
      : change.type === 'spawnEvents' ? { kind: 'spawnEvents', guid: change.guid }
      : change.type === 'deleted' ? { kind: 'delete', spawnKind: change.kind, guid: change.guid }
      : { kind: 'spawn', spawnKind: change.kind, guid: change.guid },
    );
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onLayer(result.value);
    setExported(null);
    await load();
  };

  const exportAll = async (): Promise<void> => {
    setError(null);
    setIssues([]);
    const result = await api.exportProject();
    if (result.ok) setExported({ applyPath: result.value.applyPath, revertPath: result.value.revertPath, warnings: result.value.warnings ?? [] });
    else {
      setError(result.error.message);
      setIssues(errorsOf(result.error));
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="modal world-changes"
        role="dialog"
        aria-modal="true"
        aria-label="Project changes"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          trapTab(e, dialog.current);
        }}
      >
        <header className="modal__header">
          <h2>Project changes</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        {count > 0 && project && (
          <section className="project-changes__entities" aria-label="NPCs, objects & items">
            <h3 className="section-label">NPCs, objects &amp; items</h3>
            <EntityList
              tracked={project.tracked}
              quests={project.quests}
              drifted={drifted}
              canEdit={editableWith(project.entities, connected)}
              editBlockedReason={EDIT_NEEDS_DATABASE}
              onEdit={(ref) => onEdit?.(ref.kind, ref.entry)}
              onGoTo={(e) => e.goTo && onGoTo?.(e.goTo)}
            />
          </section>
        )}
        {count > 0 && <h3 className="section-label">World changes</h3>}
        {changes && changes.length === 0 && <p>No world changes.</p>}
        {changes && changes.length > 0 && (
          <table className="world-changes__table">
            <thead>
              <tr>
                <th>What</th>
                <th>Before</th>
                <th>After</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <ChangeRow key={change.type === 'route' ? `route:${change.pathId}` : change.type === 'movement' ? `movement:${change.guid}` : change.type === 'respawn' ? `respawn:${change.kind}:${change.guid}` : change.type === 'group' ? `group:${change.id}` : change.type === 'spawnEvents' ? `spawnEvents:${change.guid}` : `${change.type}:${change.kind}:${change.guid}`} change={change} eventNames={eventNames} onRevert={() => void revert(change)} />
              ))}
            </tbody>
          </table>
        )}
        {error && <p className="world-changes__error">{error}</p>}
        {issues.length > 0 && (
          <ul className="world-changes__error" aria-label="To fix">
            {issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        )}
        {exported && (
          <div className="world-changes__exported">
            <p>Written:</p>
            <p>{exported.applyPath}</p>
            <p>{exported.revertPath}</p>
            {exported.warnings.length > 0 && (
              <ul className="world-changes__warnings">
                {exported.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="world3d__dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn--primary" disabled={!changes || changes.length + count === 0} onClick={() => void exportAll()}>
            Export project patch
          </button>
        </div>
      </div>
    </div>
  );
}

/** The errors a refusal lists (its warnings are left out: they do not stop the export) */
const errorsOf = (error: ApiError): string[] => (error.issues ?? []).filter((i) => i.severity === 'error').map((i) => i.message);

const where = (p: Placement): string => `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;
/** How an NPC moves, in a few words */
const moves = (m: Movement): string => (m.type === 'path' ? `walks path ${m.pathId ?? 0}` : m.type === 'wander' ? `wanders ${m.wander} yd` : 'stands still');
const points = (route: readonly RoutePoint[]): string => `${route.length} ${route.length === 1 ? 'point' : 'points'}`;

function ChangeRow({ change, eventNames, onRevert }: { change: WorldChange; eventNames: ReadonlyMap<number, string>; onRevert(): void }): React.JSX.Element {
  const drift = change.drifted && (
    <span className="world-changes__drift">{change.type === 'added' ? 'The database has a spawn with this id now' : 'Changed in the database since'}</span>
  );
  if (change.type === 'added') {
    const name = change.name || `${change.kind === 'creature' ? 'NPC' : 'Object'} ${change.entry}`;
    return (
      <tr>
        <td>
          {name} · {change.kind === 'creature' ? 'NPC' : 'Object'} {change.entry} · {change.inDatabase ? `spawn ${change.guid}` : `new spawn ${change.guid}`} {drift}
          {change.inDatabase && <span className="world-changes__drift">This {change.kind === 'creature' ? 'NPC' : 'object'} spawn is already in the database</span>}
        </td>
        <td>Not placed yet</td>
        <td>{where(change.placement)}</td>
        <td>
          <button type="button" className="btn" aria-label={`Remove ${name}`} onClick={onRevert}>
            Remove
          </button>
        </td>
      </tr>
    );
  }
  if (change.type === 'deleted') {
    const name = change.name || `${change.kind === 'creature' ? 'NPC' : 'Object'} ${change.entry}`;
    return (
      <tr>
        <td>
          {name} · deleted · {change.kind === 'creature' ? 'NPC' : 'Object'} {change.entry} · spawn {change.guid} {drift}
        </td>
        <td>{where(change.placement)}</td>
        <td>Deleted</td>
        <td>
          <button type="button" className="btn" aria-label={`Revert deletion of ${name}`} onClick={onRevert}>
            Revert
          </button>
        </td>
      </tr>
    );
  }
  if (change.type === 'movement') {
    const name = change.name || `NPC ${change.entry}`;
    return (
      <tr>
        <td>
          {name} · movement · spawn {change.guid} {drift}
        </td>
        <td>{moves(change.original)}</td>
        <td>{moves(change.current)}</td>
        <td>
          <button type="button" className="btn" aria-label={`Revert movement of ${name}`} onClick={onRevert}>
            Revert
          </button>
        </td>
      </tr>
    );
  }
  if (change.type === 'respawn') {
    const name = change.name || `${change.kind === 'creature' ? 'NPC' : 'Object'} ${change.entry}`;
    return (
      <tr>
        <td>
          {name} · respawn · spawn {change.guid} {drift}
        </td>
        <td>{change.original} s</td>
        <td>{change.current} s</td>
        <td>
          <button type="button" className="btn" aria-label={`Revert respawn of ${name}`} onClick={onRevert}>
            Revert
          </button>
        </td>
      </tr>
    );
  }
  if (change.type === 'spawnEvents') {
    const name = change.name || `NPC ${change.entry}`;
    const said = (rule: EventRule | 'custom'): string =>
      rule === 'custom' ? 'its own mix'
      : rule === null ? 'always'
      : `${rule.mode === 'during' ? 'only during' : 'gone during'} ${rule.events.map((id) => eventNames.get(id) ?? `event ${id}`).join(', ')}`;
    return (
      <tr>
        <td>
          {name} · events · spawn {change.guid} {drift}
        </td>
        <td>{said(ruleOfRows(change.original))}</td>
        <td>{said(change.current)}</td>
        <td>
          <button type="button" className="btn" aria-label={`Revert events of ${name}`} onClick={onRevert}>
            Revert
          </button>
        </td>
      </tr>
    );
  }
  if (change.type === 'group') {
    const name = change.name || `Spawn group ${change.id}`;
    const members = (n: number): string => `${n} ${n === 1 ? 'member' : 'members'}`;
    const before = change.origin.kind === 'existing' ? members(change.origin.original.members.length) : 'none';
    return (
      <tr>
        <td>
          {name} · {isQuestPool(change) ? 'quest rotation' : 'spawn group'} {change.id} {drift}
          {change.event && !change.removed && (
            <span className="world-changes__event">
              {change.event.during ? 'Only during ' : 'Except during '}
              {eventNames.get(change.event.id) ?? `event ${change.event.id}`}
            </span>
          )}
        </td>
        <td>{before}</td>
        <td>{change.removed ? 'deleted' : `${members(change.members.length)}, ${change.maxActive} up at once`}</td>
        <td>
          <button type="button" className="btn" aria-label={`Revert ${name}`} onClick={onRevert}>
            Revert
          </button>
        </td>
      </tr>
    );
  }
  if (change.type === 'spawn') {
    const name = change.name || `${change.kind === 'creature' ? 'NPC' : 'Object'} ${change.entry}`;
    return (
      <tr>
        <td>
          {name} · {change.kind === 'creature' ? 'NPC' : 'Object'} · spawn {change.guid} {drift}
        </td>
        <td>{where(change.original)}</td>
        <td>{where(change.current)}</td>
        <td>
          <button type="button" className="btn" aria-label={`Revert ${name}`} onClick={onRevert}>
            Revert
          </button>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>
        Route {change.pathId} · {change.walkers} {change.walkers === 1 ? 'spawn' : 'spawns'} {drift}
      </td>
      <td>{points(change.original)}</td>
      <td>{points(change.current)}</td>
      <td>
        <button type="button" className="btn" aria-label={`Revert route ${change.pathId}`} onClick={onRevert}>
          Revert
        </button>
      </td>
    </tr>
  );
}
