import { rowsOrNone } from '../../core/links/context';
import { idsAbove } from '../../core/ids/free';
import { maxObjectMenu } from '../../core/db/object-menus';
import { GOSSIP_TEXT_LIMIT } from '../../core/entities/gossip-tree';
import type { QuestAggregate } from '../../core/model/aggregate';
import { emptyGiversOf } from '../../core/modules/givers';
import { existingDrift } from '../../core/entities/existing';
import { projectEntitiesSchema, type ProjectEntities } from '../../core/entities/model';
import { itemFromRows, npcFromRows, objectFromRows } from '../../core/entities/from-rows';
import { readExistingRows } from '../entities/existing';
import type { EntitiesApi } from '../../shared/ipc';
import type { Services } from './services';
import { fail, run } from './errors';

/** `npc_text` keeps one stray id at the top of its range (16777215); text ids are allocated below it */

/** The project's NPCs, objects and items: ids for new ones, templates to start from, and editing existing ones */
export function createEntitiesApi(s: Services): EntitiesApi {
  const { deps, connected, quests, asOneStep, putEntities, projectEntities, exportSchema } = s.ctx;

  return {
    allocateIds: (kind, count) =>
      run(async () => {
        // Spawns placed in the 3D view are not in the database yet, but their ids are taken
        const placedGuids = (spawnKind: 'creature' | 'gameobject'): number[] => deps.session.world.get().added.filter((a) => a.kind === spawnKind).map((a) => a.guid);
        const live = connected();
        const [table, column] = {
          creature: ['creature_template', 'entry'],
          gameobject: ['gameobject_template', 'entry'],
          creatureSpawn: ['creature', 'guid'],
          gameobjectSpawn: ['gameobject', 'guid'],
          page: ['page_text', 'ID'],
          item: ['item_template', 'entry'],
          trainer: ['trainer', 'Id'],
          gossipMenu: ['gossip_menu', 'MenuID'],
          gossipText: ['npc_text', 'ID'],
        }[kind] as [string, string];
        let dbMax = 0;
        try {
          dbMax = (await live.db.selectMax?.(table, column, kind === 'gossipText' ? GOSSIP_TEXT_LIMIT : undefined)) ?? 0;
        } catch {
          dbMax = 0;
        }
        // A trainer id some NPC points at counts though its trainer row is missing
        if (kind === 'trainer') {
          try {
            dbMax = Math.max(dbMax, (await live.db.selectMax?.('creature_default_trainer', 'TrainerId')) ?? 0);
          } catch {
            // A fork without the table has none
          }
        }
        // Other places that name a menu or a text count too, though their rows are missing
        const also: [string, string, number | undefined][] =
          kind === 'gossipMenu' ? [['gossip_menu_option', 'MenuID', undefined], ['gossip_menu_option', 'ActionMenuID', undefined], ['creature_template', 'gossip_menu_id', undefined]]
          : kind === 'gossipText' ? [['gossip_menu', 'TextID', GOSSIP_TEXT_LIMIT]]
          : [];
        for (const [otherTable, otherColumn, below] of also) {
          try {
            dbMax = Math.max(dbMax, (await live.db.selectMax?.(otherTable, otherColumn, below)) ?? 0);
          } catch {
            // A fork without the table has none
          }
        }
        // Conditions and scripts name menus and texts too, with no rows of their own to count
        if (kind === 'gossipMenu' || kind === 'gossipText') {
          const menu = kind === 'gossipMenu';
          const named: [string, Record<string, string[]>, string[]][] = [
            ['conditions', { SourceTypeOrReferenceId: menu ? ['14', '15'] : ['14'] }, [menu ? 'SourceGroup' : 'SourceEntry']],
            ['smart_scripts', { source_type: ['0'], action_type: ['98'] }, [menu ? 'action_param1' : 'action_param2']],
            ...(menu ? [['smart_scripts', { source_type: ['0'], event_type: ['62'] }, ['event_param1']] as [string, Record<string, string[]>, string[]]] : []),
          ];
          for (const [namedTable, where, columns] of named) {
            const rows = await rowsOrNone(live.db, namedTable, where);
            for (const r of rows) for (const c of columns) if (Number(r[c] ?? 0) < (menu ? Infinity : GOSSIP_TEXT_LIMIT)) dbMax = Math.max(dbMax, Number(r[c] ?? 0));
          }
        }
        if (kind === 'gossipMenu') {
          try {
            dbMax = Math.max(dbMax, await maxObjectMenu(live.db));
          } catch {
            // A fork without the table has none
          }
        }
        const { npcs, objects, items } = projectEntities();
        const used =
          kind === 'creature' ? npcs.map((n) => n.entry)
          : kind === 'gameobject' ? objects.map((o) => o.entry)
          : kind === 'item' ? items.map((i) => i.entry)
          : kind === 'creatureSpawn' ? [...npcs.flatMap((n) => n.spawns.map((s) => s.guid)), ...placedGuids('creature')]
          : kind === 'trainer' ? npcs.flatMap((n) => (n.trainer ? [n.trainer.trainerId] : []))
          : kind === 'gossipMenu' ? npcs.flatMap((n) => (n.gossipMenu?.menus ?? []).map((m) => m.menuId))
          : kind === 'gossipText' ? npcs.flatMap((n) => (n.gossipMenu?.menus ?? []).map((m) => m.textId))
          : kind === 'page' ? [...objects, ...items].flatMap((o) => o.pages.map((p) => p.id))
          : [...objects.flatMap((o) => o.spawns.map((s) => s.guid)), ...placedGuids('gameobject')];
        return idsAbove(dbMax, used, count);
      }),

    entityTemplate: (kind, entry) =>
      run(async () => {
        const live = connected();
        const key = [String(entry)];
        const none = { sharedLoot: 0, spawnCount: 0 };
        if (kind === 'creature') {
          const creature_template = await rowsOrNone(live.db, 'creature_template', { entry: key });
          if (creature_template.length === 0) return null;
          const creature_template_model = await rowsOrNone(live.db, 'creature_template_model', { CreatureID: key, Idx: ['0'] });
          const creature_equip_template = await rowsOrNone(live.db, 'creature_equip_template', { CreatureID: key, ID: ['1'] });
          const n = npcFromRows(entry, { creature_template, creature_template_model, creature_equip_template }, none);
          return {
            name: n.name, subname: n.subname, minLevel: n.minLevel, maxLevel: n.maxLevel, faction: n.faction, rank: n.rank, type: n.type,
            healthModifier: n.healthModifier, damageModifier: n.damageModifier, displayId: n.displayId, scale: n.scale, equipment: n.equipment,
          };
        }
        if (kind === 'item') {
          const item_template = await rowsOrNone(live.db, 'item_template', { entry: key });
          if (item_template.length === 0) return null;
          const i = itemFromRows(entry, { item_template });
          return { name: i.name, displayId: i.displayId, itemClass: i.itemClass, subclass: i.subclass, inventoryType: i.inventoryType, buyPrice: i.buyPrice };
        }
        const gameobject_template = await rowsOrNone(live.db, 'gameobject_template', { entry: key });
        if (gameobject_template.length === 0) return null;
        const o = objectFromRows(entry, { gameobject_template }, none);
        return { name: o.name, type: o.type, displayId: o.displayId, size: o.size };
      }),

    itemColumns: () => run(async () => exportSchema(connected()).tables.item_template ?? []),

    projectEntities: () => run(async () => deps.session.entities.get()),

    putProjectEntities: (next) =>
      run(async () => {
        const parsed = projectEntitiesSchema.safeParse(next);
        if (!parsed.success) throw fail('BAD_REQUEST', 'The NPCs, objects and items sent are not valid.');
        await asOneStep(async () => putEntities(parsed.data));
        return true as const;
      }),

    readExistingEntity: (kind, entry) =>
      run(async () => {
        const db = connected().db;
        const read = await readExistingRows(db, kind, entry);
        if (!read) throw fail('BAD_REQUEST', 'Not in the database any more');
        const counts = { sharedLoot: read.sharedLoot, spawnCount: read.spawnCount, sharedTrainer: read.sharedTrainer, sharedMenus: read.sharedMenus, sharedTexts: read.sharedTexts, databaseScripts: read.databaseScripts };
        // The scenes the tool wrote for it before come back only here, as it is first taken into a project: Put back as the database has it drops them
        return kind === 'npc' ? { ...npcFromRows(entry, read.rows, counts), scenes: read.scenes } : kind === 'object' ? objectFromRows(entry, read.rows, counts) : itemFromRows(entry, read.rows);
      }),

    existingDrift: () =>
      run(async () => {
        // The same check the export warns from, so the badge and the warning agree
        const drifted = await existingDrift(connected().db, projectEntities());
        return drifted.map(({ kind, entry }) => ({ kind, entry }));
      }),

    deleteEntity: (kind, entry) =>
      run(() => asOneStep(async () => {
        const store = projectEntities();
        const list = kind === 'npc' ? 'npcs' : kind === 'object' ? 'objects' : 'items';
        if (!(store[list] as { entry: number }[]).some((e) => e.entry === entry)) throw fail('BAD_REQUEST', `There is no such ${kind === 'npc' ? 'NPC' : kind} in the project.`);
        putEntities({ ...store, [list]: (store[list] as { entry: number }[]).filter((e) => e.entry !== entry) } as ProjectEntities);
        // An item is never a giver; an NPC or object comes off every quest's giver cards
        const changed: { questId: number; aggregate: QuestAggregate }[] = [];
        if (kind !== 'item') {
          for (const quest of quests.list()) {
            const edits = emptyGiversOf(quest.aggregate.values, kind === 'npc' ? 'creature' : 'gameobject', entry);
            if (Object.keys(edits).length === 0) continue;
            const aggregate = { ...quest.aggregate, values: { ...quest.aggregate.values, ...edits } };
            quests.put({ ...quest, aggregate });
            changed.push({ questId: quest.questId, aggregate });
          }
        }
        return { entities: deps.session.entities.get(), quests: changed };
      })),
  };
}
