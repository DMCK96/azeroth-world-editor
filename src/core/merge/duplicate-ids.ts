import type { CustomItem, CustomNpc, CustomObject, StoredOrigin } from '../entities/model';
import { movementsOf } from '../world/layer';
import type { MergeDocument } from './doc';

/**
 * Ids the project allocates inside its NPCs, objects and world layer, which the merge's kinds do not
 * key on: spawn guids, path ids, trainer ids, gossip menu and text ids, and page ids. Two people working
 * from one base allocate the same next id, so a merged result can hold two things at one id. This check
 * names each such id in the result. Each family of ids is one entry of `ID_FAMILIES`.
 */

/** One thing in the document holding an id of a family */
export interface IdHolder {
  /** Ids of one family in different scopes never clash: a creature and an object spawn may share a guid */
  scope: string;
  id: number;
  /** The holder as the warning names it; two holders with the same name are one */
  owner: string;
  /** Whether the database already had this id for this holder, so holders sharing it share a database row */
  fromDatabase?: boolean;
}

export interface IdFamily {
  /** `Trainer id`, or a name per scope such as `Creature spawn guid` */
  noun(scope: string): string;
  holders(doc: MergeDocument): IdHolder[];
  /**
   * Whether holders may share an id the database already had (existing NPCs sharing a trainer); a
   * duplicate is then named only while one holder has an id the project allocated.
   */
  shareable?: boolean;
}

const npcName = (n: CustomNpc): string => `NPC ${n.entry} ${n.name}`;
const objectName = (o: CustomObject): string => `Object ${o.entry} ${o.name}`;
const itemName = (i: CustomItem): string => `Item ${i.entry} ${i.name}`;

/** Whether an existing entity's original rows hold `id` in one of these table columns */
function inDatabase(origin: StoredOrigin, id: number, places: [string, string][]): boolean {
  if (origin.kind !== 'existing') return false;
  return places.some(([table, column]) => (origin.original[table] ?? []).some((row) => Number(row[column] ?? NaN) === id));
}

const spawnGuids: IdFamily = {
  noun: (scope) => (scope === 'creature' ? 'Creature spawn guid' : 'Object spawn guid'),
  holders: (doc) => [
    ...doc.entities.npcs.flatMap((n) => n.spawns.map((s) => ({ scope: 'creature', id: s.guid, owner: npcName(n) }))),
    ...doc.entities.objects.flatMap((o) => o.spawns.map((s) => ({ scope: 'gameobject', id: s.guid, owner: objectName(o) }))),
    ...doc.world.added.map((a) => ({ scope: a.kind, id: a.guid, owner: `${a.name} (${a.kind} ${a.guid}) placed` })),
  ],
};

/**
 * A path is held by the patrol that owns it, by a spawn whose movement was set to walk it, and by a
 * route the project made that no movement walks. A route and the movement that walks it are one use.
 */
const pathIds: IdFamily = {
  noun: () => 'Path id',
  holders(doc) {
    const movements = movementsOf(doc.world).filter((m) => m.current.pathId !== null && m.current.pathId !== m.original.pathId);
    const walked = new Set(movements.map((m) => m.current.pathId));
    return [
      ...doc.entities.npcs.flatMap((n) => n.spawns.flatMap((s) => (s.patrol ? [{ scope: '', id: s.patrol.pathId, owner: `${npcName(n)}'s spawn ${s.guid}` }] : []))),
      ...movements.map((m) => ({ scope: '', id: m.current.pathId!, owner: `${m.name} (${m.guid}) movement` })),
      ...doc.world.routes.filter((r) => r.original.length === 0 && !walked.has(r.pathId)).map((r) => ({ scope: '', id: r.pathId, owner: `Route ${r.pathId}` })),
    ];
  },
};

const trainerIds: IdFamily = {
  noun: () => 'Trainer id',
  shareable: true,
  holders: (doc) =>
    doc.entities.npcs.flatMap((n) =>
      n.trainer
        ? [{ scope: '', id: n.trainer.trainerId, owner: npcName(n), fromDatabase: inDatabase(n.origin, n.trainer.trainerId, [['creature_default_trainer', 'TrainerId'], ['trainer', 'Id']]) }]
        : [],
    ),
};

const gossipMenuIds: IdFamily = {
  noun: () => 'Gossip menu id',
  shareable: true,
  holders: (doc) =>
    doc.entities.npcs.flatMap((n) =>
      (n.gossipMenu?.menus ?? []).map((m) => ({ scope: '', id: m.menuId, owner: npcName(n), fromDatabase: m.locked || inDatabase(n.origin, m.menuId, [['gossip_menu', 'MenuID']]) })),
    ),
};

const gossipTextIds: IdFamily = {
  noun: () => 'Gossip text id',
  shareable: true,
  holders: (doc) =>
    doc.entities.npcs.flatMap((n) =>
      (n.gossipMenu?.menus ?? []).map((m) => ({ scope: '', id: m.textId, owner: npcName(n), fromDatabase: m.locked || inDatabase(n.origin, m.textId, [['npc_text', 'ID'], ['gossip_menu', 'TextID']]) })),
    ),
};

const pageIds: IdFamily = {
  noun: () => 'Page id',
  shareable: true,
  holders: (doc) => [
    ...doc.entities.objects.flatMap((o) => o.pages.map((p) => ({ scope: '', id: p.id, owner: objectName(o), fromDatabase: inDatabase(o.origin, p.id, [['page_text', 'ID']]) }))),
    ...doc.entities.items.flatMap((i) => i.pages.map((p) => ({ scope: '', id: p.id, owner: itemName(i), fromDatabase: inDatabase(i.origin, p.id, [['page_text', 'ID']]) }))),
  ],
};

/** Every family the check walks, in the order its warnings are given */
export const ID_FAMILIES: readonly IdFamily[] = [spawnGuids, pathIds, trainerIds, gossipMenuIds, gossipTextIds, pageIds];

/** `a`, `a and b`, `a, b and c` */
const listOf = (parts: string[]): string => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/** One warning per id of a family that two different holders use in the document, by family, scope and id */
export function findDuplicateIds(doc: MergeDocument, families: readonly IdFamily[] = ID_FAMILIES): string[] {
  const warnings: string[] = [];
  for (const family of families) {
    const byId = new Map<string, { scope: string; id: number; holders: IdHolder[] }>();
    for (const holder of family.holders(doc)) {
      const at = `${holder.scope}|${holder.id}`;
      const group = byId.get(at) ?? { scope: holder.scope, id: holder.id, holders: [] };
      group.holders.push(holder);
      byId.set(at, group);
    }
    const groups = [...byId.values()].sort((a, b) => a.scope.localeCompare(b.scope) || a.id - b.id);
    for (const { scope, id, holders } of groups) {
      const owners = [...new Set(holders.map((h) => h.owner))];
      if (owners.length < 2) continue;
      if (family.shareable && holders.every((h) => h.fromDatabase)) continue;
      warnings.push(`${family.noun(scope)} ${id} is used by ${listOf(owners)} in the result`);
    }
  }
  return warnings;
}
