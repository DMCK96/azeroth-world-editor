import type { CustomItem, CustomNpc, CustomObject, Spawn } from '../../entities/model';
import type { WorldLayer } from '../../world/layer';
import type { MergeDocument } from '../doc';
import { mapQuestValues, mapRows, mapSceneParts, mapScenes, swapConditionValue1, swapIn, swapScalar, type Row, type Values } from './refs';

/**
 * Where each project-allocated id appears in a merge document, and so what a renumber rewrites. Found by
 * searching the quest registry (`src/core/registry/fields`), the entity schemas (`entities/model.ts`,
 * `combat/model.ts`, `scripts/model.ts`, `scripts/npc-scenes.ts`), the world layer and `questRefs`
 * (`entities/links.ts`). Each row has a test in `tests/core/merge/renumber.test.ts`. A reference not in
 * this table is left pointing at the old id; the merge's reference check is the safety net.
 *
 * | Id | Place | Rewritten by |
 * | --- | --- | --- |
 * | quest | `quests[].questId`, `aggregate.questId` | quest-refs |
 * | quest | the quest's own key fields `quest_template.ID`, `quest_template_addon.ID`, `quest_details.ID`, `quest_offer_reward.ID`, `quest_request_items.ID`, `quest_mail_sender.QuestId` | quest-refs |
 * | quest | links `quest_template_addon.PrevQuestID` (signed), `.NextQuestID`, `.BreadcrumbForQuestId`, `.ExclusiveGroup` (signed), `quest_template.RewardNextQuest` | quest-refs |
 * | quest | quest scene gates `{kind:'quest', questId}` (`scripts`) | quest-refs |
 * | quest | `conditions` rows of types 8, 9, 14, 28, 43, 47, 48, 101: `ConditionValue1` | quest-refs |
 * | quest | `aggregate.sharedItems` values (quests sharing a linked row) | quest-refs |
 * | quest | group members `{type:'quest', questId}` | quest-refs |
 * | quest | NPC fight credit steps `fight.reactions[].steps[{kind:'credit', quest}]` | quest-refs |
 * | quest | NPC scenes `scenes[].questId` and their gates `{kind:'quest', questId}` | quest-refs |
 * | quest | `objects[].onlyDuringQuest`, `items[].startsQuest` | quest-refs |
 * | npc | `npcs[].entry` | here |
 * | npc | `world.added[kind creature].entry`, group members `{type:'spawn', kind:'npc', entry}` | here |
 * | npc | `world.movements[].entry`, `world.spawnEvents[].entry` of its placed creatures | here |
 * | npc | quest `creature_queststarter`/`creature_questender`/`game_event_creature_quest` rows' `id` | here |
 * | npc | quest `quest_template.RequiredNpcOrGo` targets `{target:'creature', id}` | here |
 * | npc | quest scene owner `{kind:'creature', entry}`, steps `spawnNpc`, `despawn`, `signal` to a creature | here |
 * | npc | quest `quest_mail_sender.RewardMailSenderEntry` | here |
 * | npc | quest linked rows `creature_questitem.CreatureEntry`, `creature_loot_template.Entry` (a new NPC's loot id is its entry) | here |
 * | npc | quest `conditions` type 29 `ConditionValue1`; type 31 with `ConditionValue1` 3 (a unit): `ConditionValue2` | here |
 * | npc | NPC fights: `when {kind:'addDies', entry}`, steps `summonAdds`, `despawnAdds` | here |
 * | npc | NPC scene steps `spawnNpc`, `despawn`, `signal` to a creature | here |
 * | npc | NPC vendor rows naming another vendor's list: `vendor[].item` = -entry | here |
 * | npc | NPC spawn patrol actions `{kind:'mount', creature}` | here |
 * | object | `objects[].entry` | here |
 * | object | `world.added[kind gameobject].entry`, group members `{type:'spawn', kind:'object', entry}` | here |
 * | object | quest `gameobject_queststarter`/`gameobject_questender`/`game_event_gameobject_quest` rows' `id` | here |
 * | object | quest `quest_template.RequiredNpcOrGo` targets `{target:'gameobject', id}` (stored positive) | here |
 * | object | quest scene owner `{kind:'gameobject', entry}`, steps `spawnObject`, `objectState`, `signal` to an object | here |
 * | object | quest linked rows `gameobject_questitem.GameObjectEntry`, `gameobject_loot_template.Entry` | here |
 * | object | quest `conditions` type 30 `ConditionValue1`; type 31 with `ConditionValue1` 5 (an object): `ConditionValue2` | here |
 * | object | NPC spawn patrol actions `{kind:'useObject', entry}` (its `guid` is the placed-spawn renumber's) | here |
 * | object | NPC scene steps `spawnObject`, `objectState`, `signal` to an object | here |
 * | item | `items[].entry` | here |
 * | item | quest `quest_template.RequiredItems`, `.RewardItems`, `.RewardChoiceItems`, `.ItemDrops` rows' `item`, `quest_template.StartItem` | here |
 * | item | quest scene steps `giveItem`, `takeItem`, gates `{kind:'item', item}` | here |
 * | item | quest linked rows `creature_loot_template.Item`, `gameobject_loot_template.Item`, `creature_questitem.ItemId`, `gameobject_questitem.ItemId` | here |
 * | item | quest `conditions` types 2, 3 `ConditionValue1`; `aggregate.sharedItems` keys | here |
 * | item | NPC and object `loot[].item`, NPC `vendor[].item` (positive), NPC `equipment` main hand, off hand, ranged | here |
 * | item | NPC scene steps `giveItem`, `takeItem`, gates `{kind:'item', item}` | here |
 * | group | `world.groups[].id`, members `{type:'group', id}` | group kind |
 * | group | quest `pool_quest` rows' `pool_entry` | group kind |
 * | placed spawn | guid: `spawnGuidKind.rename` (placed spawns, NPC and object spawns, patrol use-object guids, group members, movement and event edits) | placed-spawn kind |
 *
 * Not rewritten, on purpose: database spawn edits (`world.spawns`, `respawns`, `deletes`, route walkers), which
 * name database spawns; an item's raw `advanced` columns; the legacy per-quest `entities` field, moved to the
 * store when a project opens; the quest snapshot, which is the database's baseline.
 */

export type EntryKind = 'npc' | 'object' | 'item';

/** Condition types whose `ConditionValue1` names an entry of the kind */
const CONDITION_ENTRY: Record<EntryKind, ReadonlySet<number>> = {
  npc: new Set([29]),
  object: new Set([30]),
  item: new Set([2, 3]),
};
/** `CONDITION_OBJECT_ENTRY_GUID` (31): `ConditionValue1` is the TypeID, `ConditionValue2` the entry */
const OBJECT_ENTRY_GUID = 31;
const TYPE_ID: Partial<Record<EntryKind, number>> = { npc: 3, object: 5 };

const OWNER: Record<EntryKind, string | null> = { npc: 'creature', object: 'gameobject', item: null };
const QUEST_GIVER_ROWS: Record<EntryKind, readonly string[]> = {
  npc: ['creature_queststarter', 'creature_questender', 'game_event_creature_quest'],
  object: ['gameobject_queststarter', 'gameobject_questender', 'game_event_gameobject_quest'],
  item: [],
};
const ITEM_LISTS = ['quest_template.RequiredItems', 'quest_template.RewardItems', 'quest_template.RewardChoiceItems', 'quest_template.ItemDrops'];

/** A scene step with the entry swapped where it names one of the kind */
function stepOf(kind: EntryKind, from: number, to: number): (s: Row) => Row {
  return (s) => {
    switch (s.kind) {
      case 'spawnNpc':
      case 'despawn':
        return kind === 'npc' ? swapIn(s, 'entry', from, to) : s;
      case 'spawnObject':
      case 'objectState':
        return kind === 'object' ? swapIn(s, 'entry', from, to) : s;
      case 'signal':
        return s.targetKind === OWNER[kind] ? swapIn(s, 'entry', from, to) : s;
      case 'giveItem':
      case 'takeItem':
        return kind === 'item' ? swapIn(s, 'item', from, to) : s;
      default:
        return s;
    }
  };
}

const gateOf = (kind: EntryKind, from: number, to: number) => (g: Row): Row => (kind === 'item' && g.kind === 'item' ? swapIn(g, 'item', from, to) : g);

function questValues(values: Values, kind: EntryKind, from: number, to: number): Values {
  let v = values;
  for (const fieldId of QUEST_GIVER_ROWS[kind]) v = mapRows(v, fieldId, (r) => swapIn(r, 'id', from, to));
  const owner = OWNER[kind];
  if (owner) {
    v = mapRows(v, 'quest_template.RequiredNpcOrGo', (r) => {
      const target = r.target as Row | null | undefined;
      return target && target.target === owner && target.id === from ? { ...r, target: { ...target, id: to } } : r;
    });
  }
  v = mapScenes(v, (scene) => {
    const o = scene.owner as Row | undefined;
    const withOwner = owner && o && o.kind === owner && o.entry === from ? { ...scene, owner: { ...o, entry: to } } : scene;
    return mapSceneParts(withOwner, stepOf(kind, from, to), gateOf(kind, from, to));
  });
  v = swapConditionValue1(v, CONDITION_ENTRY[kind], from, to);
  const typeId = TYPE_ID[kind];
  if (typeId !== undefined) {
    v = mapRows(v, 'conditions', (r) => (r.ConditionTypeOrReference === OBJECT_ENTRY_GUID && r.ConditionValue1 === typeId ? swapIn(r, 'ConditionValue2', from, to) : r));
  }
  if (kind === 'npc') {
    v = swapScalar(v, 'quest_mail_sender.RewardMailSenderEntry', from, to);
    v = mapRows(v, 'creature_questitem', (r) => swapIn(r, 'CreatureEntry', from, to));
    v = mapRows(v, 'creature_loot_template', (r) => swapIn(r, 'Entry', from, to));
  } else if (kind === 'object') {
    v = mapRows(v, 'gameobject_questitem', (r) => swapIn(r, 'GameObjectEntry', from, to));
    v = mapRows(v, 'gameobject_loot_template', (r) => swapIn(r, 'Entry', from, to));
  } else {
    for (const fieldId of ITEM_LISTS) v = mapRows(v, fieldId, (r) => swapIn(r, 'item', from, to));
    v = swapScalar(v, 'quest_template.StartItem', from, to);
    for (const table of ['creature_loot_template', 'gameobject_loot_template']) v = mapRows(v, table, (r) => swapIn(r, 'Item', from, to));
    for (const table of ['creature_questitem', 'gameobject_questitem']) v = mapRows(v, table, (r) => swapIn(r, 'ItemId', from, to));
  }
  return v;
}

function renameSharedItems(shared: Record<string, number[]>, from: number, to: number): Record<string, number[]> {
  if (!(String(from) in shared)) return shared;
  return Object.fromEntries(Object.entries(shared).map(([key, quests]) => [key === String(from) ? String(to) : key, quests]));
}

/** A spawn's patrol actions passed through `fn` */
function mapPatrolActions(spawn: Spawn, fn: (a: Row) => Row): Spawn {
  if (!spawn.patrol) return spawn;
  return { ...spawn, patrol: { ...spawn.patrol, points: spawn.patrol.points.map((p) => ({ ...p, actions: p.actions.map((a) => fn(a as Row) as typeof a) })) } };
}

function renameInNpc(npc: CustomNpc, kind: EntryKind, from: number, to: number): CustomNpc {
  const step = stepOf(kind, from, to);
  const gate = gateOf(kind, from, to);
  let n: CustomNpc = { ...npc, scenes: npc.scenes.map((s) => mapSceneParts(s, step, gate)) };
  if (kind === 'npc') {
    n = swapIn(n, 'entry', from, to);
    if (n.fight) {
      n.fight = {
        ...n.fight,
        reactions: n.fight.reactions.map((r) => ({
          ...r,
          when: r.when.kind === 'addDies' ? swapIn(r.when, 'entry', from, to) : r.when,
          steps: r.steps.map((s) => (s.kind === 'summonAdds' || s.kind === 'despawnAdds' ? swapIn(s, 'entry', from, to) : s)),
        })),
      };
    }
    // A negative vendor row is another NPC's whole list
    n.vendor = n.vendor.map((x) => swapIn(x, 'item', -from, -to));
    n.spawns = n.spawns.map((s) => mapPatrolActions(s, (a) => (a.kind === 'mount' ? swapIn(a, 'creature', from, to) : a)));
  } else if (kind === 'object') {
    n.spawns = n.spawns.map((s) => mapPatrolActions(s, (a) => (a.kind === 'useObject' ? swapIn(a, 'entry', from, to) : a)));
  } else {
    n.loot = n.loot.map((l) => swapIn(l, 'item', from, to));
    n.vendor = n.vendor.map((x) => swapIn(x, 'item', from, to));
    n.equipment = swapIn(swapIn(swapIn(n.equipment, 'mainHand', from, to), 'offHand', from, to), 'ranged', from, to);
  }
  return n;
}

function renameInObject(object: CustomObject, kind: EntryKind, from: number, to: number): CustomObject {
  if (kind === 'object') return swapIn(object, 'entry', from, to);
  if (kind === 'item') return { ...object, loot: object.loot.map((l) => swapIn(l, 'item', from, to)) };
  return object;
}

const renameInItem = (item: CustomItem, kind: EntryKind, from: number, to: number): CustomItem => (kind === 'item' ? swapIn(item, 'entry', from, to) : item);

function renameInWorld(world: WorldLayer, kind: 'npc' | 'object', from: number, to: number): WorldLayer {
  const scope = OWNER[kind];
  const placedGuids = new Set(world.added.filter((a) => a.kind === scope && a.entry === from).map((a) => a.guid));
  const next: WorldLayer = { ...world, added: world.added.map((a) => (a.kind === scope ? swapIn(a, 'entry', from, to) : a)) };
  if (world.groups) {
    next.groups = world.groups.map((g) => ({ ...g, members: g.members.map((m) => (m.type === 'spawn' && m.kind === kind ? swapIn(m, 'entry', from, to) : m)) }));
  }
  // A movement or event edit at a placed creature's guid is that spawn's; one at any other guid is a database spawn's
  if (kind === 'npc') {
    const own = <T extends { guid: number; entry: number }>(e: T): T => (placedGuids.has(e.guid) ? swapIn(e, 'entry', from, to) : e);
    if (world.movements) next.movements = world.movements.map(own);
    if (world.spawnEvents) next.spawnEvents = world.spawnEvents.map(own);
  }
  return next;
}

/** The document with the project's NPC, object or item at entry `from` moved to `to`, and every place in the table above that names it */
export function renameEntry(doc: MergeDocument, kind: EntryKind, from: number, to: number): MergeDocument {
  const quests = mapQuestValues(doc, (values) => questValues(values, kind, from, to)).map((q) =>
    kind === 'item' ? { ...q, aggregate: { ...q.aggregate, sharedItems: renameSharedItems(q.aggregate.sharedItems, from, to) } } : q,
  );
  return {
    ...doc,
    quests,
    entities: {
      ...doc.entities,
      npcs: doc.entities.npcs.map((n) => renameInNpc(n, kind, from, to)),
      objects: doc.entities.objects.map((o) => renameInObject(o, kind, from, to)),
      items: doc.entities.items.map((i) => renameInItem(i, kind, from, to)),
    },
    world: kind === 'item' ? doc.world : renameInWorld(doc.world, kind, from, to),
  };
}
