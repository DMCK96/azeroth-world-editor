import { memberKey, type GroupMember, type SpawnGroup } from '../../world/groups';
import { groupsOf } from '../../world/layer';
import type { Ref } from '../kind';
import { stableJson } from '../stable';
import { listKind } from './list-kind';

const refOf = (m: GroupMember): Ref =>
  m.type === 'group' ? { kind: 'group', key: String(m.id) }
    : m.type === 'quest' ? { kind: 'quest', key: String(m.questId) }
      : { kind: 'placed-spawn', key: `${m.kind === 'npc' ? 'creature' : 'gameobject'}:${m.guid}` };

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
});
