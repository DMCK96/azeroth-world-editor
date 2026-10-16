import { isDeepStrictEqual } from 'node:util';
import type { WorldLayer } from '../../core/world/layer';
import { resultOfSteps } from './step-result';
import type { HistoryStep } from '../project/history';
import type { HistoryPart, HistoryResult, QuestEdit } from '../../shared/history';
import { readPlacement } from '../world/world-api';
import type { ProjectEntities } from '../../core/entities/model';
import type { ApiContext } from './context';

/** What the database has taken since a step was made, so it cannot be brought back */
type Taken = { spawns: Set<string>; quests: Set<number>; entities: Set<string> };

/** Undo, redo and jump through the project history, leaving out what the database has taken since */
export function createTravel(ctx: ApiContext) {
  const { deps, conn, quests, history, historyList } = ctx;

  /** The spawns and new quests the steps would bring back that the database has taken since */
  const takenBy = async (steps: HistoryStep[], direction: 'undo' | 'redo'): Promise<Taken> => {
    const spawns = new Set<string>();
    const quests = new Set<number>();
    const entities = new Set<string>();
    const db = conn.current()?.db ?? null;
    if (!db) return { spawns, quests, entities };
    // NPCs, objects and items a step would bring back, and their spawns, walked like the world layer
    let store = deps.session.entities.get();
    const entityAsks: { key: string; kind: 'creature' | 'gameobject' | 'item'; entry: number; guids: number[] }[] = [];
    // Walked against the project as it will stand at each step, not the step's own other side
    let added = deps.session.world.get().added;
    const present = new Set(quests_present());
    const spawnAsks: { key: string; kind: WorldLayer['added'][number]['kind']; guid: number }[] = [];
    const questAsks: number[] = [];
    for (const step of steps) {
      for (const part of step.parts) {
        const to = direction === 'undo' ? part.before : part.after;
        if (part.kind === 'world') {
          const layer = to as WorldLayer;
          for (const a of layer.added) {
            const key = `${a.kind}:${a.guid}`;
            if (!added.some((b) => b.kind === a.kind && b.guid === a.guid) && !spawnAsks.some((x) => x.key === key)) spawnAsks.push({ key, kind: a.kind, guid: a.guid });
          }
          added = layer.added;
        } else if (part.kind === 'quest') {
          const quest = to as QuestEdit | null;
          if (quest && quest.isNew && !present.has(part.questId) && !questAsks.includes(part.questId)) questAsks.push(part.questId);
          if (quest) present.add(part.questId);
          else present.delete(part.questId);
        } else if (part.kind === 'entities') {
          const next = to as ProjectEntities;
          for (const [list, kind] of [['npcs', 'creature'], ['objects', 'gameobject'], ['items', 'item']] as const) {
            for (const e of next[list] as { entry: number; spawns?: { guid: number }[] }[]) {
              const key = `${list}:${e.entry}`;
              const had = (store[list] as { entry: number }[]).some((x) => x.entry === e.entry);
              if (!had && !entityAsks.some((x) => x.key === key)) entityAsks.push({ key, kind, entry: e.entry, guids: (e.spawns ?? []).map((sp) => sp.guid) });
            }
          }
          store = next;
        }
      }
    }
    for (const ask of spawnAsks) if ((await readPlacement(db, ask.kind, ask.guid)) !== null) spawns.add(ask.key);
    if (questAsks.length > 0) for (const id of await db.existingIds('quest', questAsks)) quests.add(id);
    for (const ask of entityAsks) {
      const template = (await db.existingIds(ask.kind, [ask.entry])).has(ask.entry);
      let spawned = false;
      if (!template && ask.kind !== 'item') {
        for (const guid of ask.guids) if ((await readPlacement(db, ask.kind, guid)) !== null) spawned = true;
      }
      if (template || spawned) entities.add(ask.key);
    }
    return { spawns, quests, entities };
  };
  const quests_present = (): number[] => quests.list().map((q) => q.questId);

  /** A layer without the placed spawns (and their movements) whose ids the database has taken */
  const withoutTaken = (layer: WorldLayer, taken: Set<string>): WorldLayer => {
    if (taken.size === 0) return layer;
    const gone = (kind: string, guid: number) => taken.has(`${kind}:${guid}`);
    return {
      ...layer,
      added: layer.added.filter((a) => !gone(a.kind, a.guid)),
      ...(layer.movements ? { movements: layer.movements.filter((m) => !gone('creature', m.guid)) } : {}),
    };
  };

  /**
   * An undo, redo or jump. The database is asked first, about what the steps would bring back; then,
   * with nothing awaited, the steps are taken from the history and applied, so no other change can
   * land in between. If the project changed while the database was asked, it is planned again.
   */
  const travel = async (
    plan: () => { direction: 'undo' | 'redo'; steps: HistoryStep[] },
    take: () => { direction: 'undo' | 'redo'; steps: HistoryStep[] },
  ): Promise<HistoryResult> => {
    for (let attempt = 0; ; attempt++) {
      history.endAll();
      const revision = deps.session.revision();
      const planned = plan();
      const taken = await takenBy(planned.steps, planned.direction);
      const again = plan();
      const same = again.steps.length === planned.steps.length && again.steps.every((st, i) => st.id === planned.steps[i]!.id);
      if ((!same || deps.session.revision() !== revision) && attempt < 3) continue;
      return applySteps(take(), taken);
    }
  };

  /** Applies steps in order, with nothing awaited, leaving out what the database has taken, and says what they changed */
  const applySteps = ({ direction, steps }: { direction: 'undo' | 'redo'; steps: HistoryStep[] }, taken: Taken): HistoryResult => {
    const verb = direction === 'undo' ? 'undo' : 'redo';
    const left = new Set<string>();
    const applied: { step: HistoryStep; skip: Set<number> }[] = [];
    for (const step of steps) {
      const skip = new Set<number>();
      const parts = step.parts.map((part, i): HistoryPart => {
        if (part.kind === 'world') {
          const to = direction === 'undo' ? part.before : part.after;
          const kept = withoutTaken(to, taken.spawns);
          const dropped = to.added.filter((a) => !kept.added.includes(a));
          for (const a of dropped) left.add(`Could not ${verb}: spawn ${a.guid} is now in the database`);
          // A spawn that only changed its id (a renumber) is not gone: leaving the id it has now keeps it, where dropping would delete it
          const nowAdded = deps.session.world.get().added;
          const renumbered = dropped.some((a) => nowAdded.some((b) => b.kind === a.kind && b.guid !== a.guid && b.entry === a.entry && b.map === a.map
            && isDeepStrictEqual(b.placement, a.placement) && !to.added.some((t) => t.kind === b.kind && t.guid === b.guid)));
          if (renumbered) {
            skip.add(i);
            return part;
          }
          return direction === 'undo' ? { ...part, before: kept } : { ...part, after: kept };
        }
        if (part.kind === 'entities' && taken.entities.size > 0) {
          const to = direction === 'undo' ? part.before : part.after;
          const now = deps.session.entities.get();
          const kept: ProjectEntities = { npcs: [], objects: [], items: [] };
          for (const list of ['npcs', 'objects', 'items'] as const) {
            for (const e of to[list] as { entry: number; name: string }[]) {
              const back = !(now[list] as { entry: number }[]).some((x) => x.entry === e.entry);
              if (back && taken.entities.has(`${list}:${e.entry}`)) {
                const word = list === 'npcs' ? 'NPC' : list === 'objects' ? 'Object' : 'Item';
                left.add(`${e.name.trim() || `${word} ${e.entry}`} was left out: its ID is now used in the database.`);
                continue;
              }
              (kept[list] as unknown[]).push(e);
            }
          }
          return direction === 'undo' ? { ...part, before: kept } : { ...part, after: kept };
        }
        if (part.kind === 'quest') {
          const to = direction === 'undo' ? part.before : part.after;
          if (to && to.isNew && taken.quests.has(part.questId) && !quests.get(part.questId)) {
            left.add(`Could not ${verb}: quest ${part.questId} is now in the database`);
            skip.add(i);
          }
        }
        return part;
      });
      deps.session.applyStep({ ...step, parts }, direction, skip);
      applied.push({ step, skip });
    }
    return resultOfSteps(deps.session, applied, direction, [...left], historyList());
  };
  // Undo, redo and jump one at a time: Ctrl+Z held down sends them faster than they finish
  let travelling: Promise<unknown> = Promise.resolve();
  const queued = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = travelling.then(work, work);
    travelling = next.catch(() => undefined);
    return next;
  };

  return { travel, queued };
}

export type Travel = ReturnType<typeof createTravel>;
