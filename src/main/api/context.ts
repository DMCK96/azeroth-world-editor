import { isDeepStrictEqual } from 'node:util';
import { nextNodePosition } from '../../core/canvas/layout';
import type { SchemaInfo } from '../../core/db/types';
import type { ItemStarter } from '../../core/links/context';
import { loadLinks, type LinkSnapshot } from '../../core/links/service';
import type { QuestAggregate } from '../../core/model/aggregate';
import { registry } from '../../core/registry';
import { refCheckerFor, type RefChecker } from '../../core/validate/validate';
import { dropMember, groupsOf } from '../../core/world/layer';
import { describeStep } from '../project/step-labels';
import type { NodePosition } from '../../shared/ipc';
import { SCRIPT_TABLES } from '../../core/scripts/context';
import { narrowTo, objectivesOf, questUses } from '../../core/entities/links';
import type { ProjectEntities } from '../../core/entities/model';
import type { ProjectQuest } from '../project/project-file';
import type { ApiDeps } from './deps';
import type { Connection, Session } from './connection';
import { fail } from './errors';

/** What every part of the API shares: the project, its history, the connection, and the project's own entities */
export function createContext(deps: ApiDeps, conn: Connection) {
  const { connected, usable } = conn;

  const quests = deps.session.quests;
  const history = deps.session.history;
  /** Runs work as one step of the history, however many changes it makes */
  const asOneStep = async <T,>(work: () => Promise<T>, label?: string): Promise<T> => {
    const token = history.begin(label);
    try {
      return await work();
    } finally {
      history.end(token);
    }
  };
  const historyList = () => history.list(describeStep);
  /**
   * Puts the project's NPCs, objects and items; a spawn of theirs that is gone (its NPC deleted, or the
   * spawn taken off it) leaves its spawn group too. Run inside a step, so both are undone together.
   */
  const putEntities = (next: ProjectEntities): void => {
    const guids = (store: ProjectEntities, kind: 'npc' | 'object') => new Set((kind === 'npc' ? store.npcs : store.objects).flatMap((e) => e.spawns.map((s) => s.guid)));
    const before = deps.session.entities.get();
    deps.session.entities.put(next);
    const layer = deps.session.world.get();
    let after = layer;
    for (const kind of ['npc', 'object'] as const) {
      const kept = guids(next, kind);
      for (const guid of guids(before, kind)) if (!kept.has(guid)) after = dropMember(after, kind, guid);
    }
    if (!isDeepStrictEqual(groupsOf(after), groupsOf(layer))) deps.session.world.put(after);
  };

  const questOf = (questId: number): ProjectQuest => {
    const quest = quests.get(questId);
    if (!quest) throw fail('QUEST_NOT_FOUND', `Quest ${questId} is not in this project.`);
    return quest;
  };

  const placeAt = (position?: NodePosition): NodePosition =>
    position ?? nextNodePosition(quests.list().map((q) => ({ x: q.x, y: q.y })));

  /** Every quest in the project: links are read from the user's edits, not the world, wherever one exists. */
  const projectAggregates = (): Map<number, QuestAggregate> =>
    new Map(quests.list().map((q) => [q.questId, q.aggregate]));

  /**
   * The items that start a quest: the database's, with the project's new items in place of any the
   * database has under the same entry (they replace it on export).
   */
  const withProjectStarters = (starters: readonly ItemStarter[]): ItemStarter[] => {
    const mine = projectEntities().items.filter((i) => i.startsQuest > 0).map((i) => ({ entry: i.entry, questId: i.startsQuest }));
    const entries = new Set(projectEntities().items.map((i) => i.entry));
    return [...starters.filter((s) => !entries.has(s.entry)), ...mine].sort((a, b) => a.entry - b.entry);
  };

  const linksFor = (live: Session, scope: readonly number[]): Promise<LinkSnapshot> =>
    loadLinks(live.db, scope, projectAggregates(), live.availability.available, withProjectStarters(live.itemStarters));

  /** The schema exports render with: the registry's tables, plus the ones quest scripting writes. */
  const exportSchema = (live: Session): SchemaInfo => ({
    ...live.schema,
    tables: { ...live.scriptSchema.tables, ...live.schema.tables },
  });

  const missingScriptTables = (live: Session): string[] =>
    SCRIPT_TABLES.filter((t) => !live.scriptSchema.tables[t]);

  /** Every new NPC, object and item in the project, from every quest. */
  function projectEntities(): ProjectEntities {
    return deps.session.entities.get();
  }

  /** The project's NPCs, objects and items a quest uses: the ones it names, and the NPCs whose fights credit it */
  function questEntities(aggregate: QuestAggregate): ProjectEntities {
    const store = projectEntities();
    return narrowTo(store, questUses({ questId: aggregate.questId, aggregate }, store));
  }

  /**
   * Reference checks that also know the project's new NPCs and objects: they exist, and a new NPC
   * counts as a quest giver because export gives it the flag whenever it starts or ends a quest.
   */
  function refsFor(live: Session): RefChecker {
    const base = refCheckerFor(live.db);
    return {
      exists(kind, id) {
        const { npcs, objects, items } = projectEntities();
        if (kind === 'creature' && npcs.some((n) => n.entry === id)) return Promise.resolve(true);
        if (kind === 'gameobject' && objects.some((o) => o.entry === id)) return Promise.resolve(true);
        if (kind === 'item' && items.some((i) => i.entry === id)) return Promise.resolve(true);
        return base.exists(kind, id);
      },
      questGiver(kind, id) {
        const { npcs, objects } = projectEntities();
        if (kind === 'creature' && npcs.some((n) => n.entry === id)) return Promise.resolve(true);
        const object = kind === 'gameobject' ? objects.find((o) => o.entry === id) : undefined;
        if (object) return Promise.resolve(object.type === 'questGiver');
        return base.questGiver(kind, id);
      },
    };
  }

  /** Each project quest's NPC-or-object objectives, by quest id, for fights that give credit */
  const objectivesByQuest = (): Map<number, readonly number[]> => new Map(quests.list().map((q) => [q.questId, objectivesOf(q.aggregate)]));

  return {
    deps, conn, connected, usable, quests, history, asOneStep, historyList, putEntities, questOf, placeAt, projectAggregates,
    withProjectStarters, linksFor, projectEntities, questEntities, refsFor, objectivesByQuest, exportSchema, missingScriptTables,
  };
}

export type ApiContext = ReturnType<typeof createContext>;
