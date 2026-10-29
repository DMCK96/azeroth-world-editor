import { memberKey, type GroupMember, type SpawnGroup } from '../../world/groups';
import { groupsOf } from '../../world/layer';
import type { MergeDocument } from '../doc';
import type { Ref } from '../kind';
import { stableJson } from '../stable';
import { listKind } from './list-kind';
import { freeAbove, mapQuestValues, mapRows, swapIn } from './refs';

const refOf = (m: GroupMember): Ref =>
  m.type === 'group' ? { kind: 'group', key: String(m.id) }
    : m.type === 'quest' ? { kind: 'quest', key: String(m.questId) }
      : { kind: 'placed-spawn', key: `${m.kind === 'npc' ? 'creature' : 'gameobject'}:${m.guid}` };

/** The document with group `from` moved to `to`: the group, the groups holding it, and the pool rows of quests in it */
function renameGroup(doc: MergeDocument, from: number, to: number): MergeDocument {
  const groups = groupsOf(doc.world).map((g) => ({
    ...swapIn(g, 'id', from, to),
    members: g.members.map((m) => (m.type === 'group' ? swapIn(m, 'id', from, to) : m)),
  }));
  return {
    ...doc,
    quests: mapQuestValues(doc, (values) => mapRows(values, 'pool_quest', (r) => swapIn(r, 'pool_entry', from, to))),
    world: { ...doc.world, groups },
  };
}

/** A spawn group or quest pool. */
export const groupKind = listKind<SpawnGroup>({
  key: 'group',
  label: 'Groups',
  canCollide: true,
  list: (doc) => groupsOf(doc.world),
  keyOf: (g) => String(g.id),
  put: (doc, groups) => ({ ...doc, world: { ...doc.world, groups } }),
  describe: (g) => `Group ${g.id} ${g.name}`,
  fields: (g) => ({
    name: g.name,
    map: String(g.map),
    maxActive: String(g.maxActive),
    members: g.members.map(memberKey).sort().join(','),
    event: stableJson(g.event),
  }),
  references: (g) => g.members.map(refOf),
  renumber: (doc, from, to) => renameGroup(doc, Number(from), Number(to)),
  freeKey: (_from, docs) => freeAbove(docs.flatMap((d) => groupsOf(d.world).map((g) => g.id))),
});
