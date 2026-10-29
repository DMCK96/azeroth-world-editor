import { questRefs } from '../../entities/links';
import type { MergeQuest } from '../doc';
import type { Ref } from '../kind';
import { stableJson } from '../stable';
import { listKind } from './list-kind';

/** A quest of the project. Where it sits on the canvas, its snapshot and its fidelity report never count. */
export const questKind = listKind<MergeQuest>({
  key: 'quest',
  label: 'Quests',
  canCollide: true,
  list: (doc) => doc.quests,
  keyOf: (q) => String(q.questId),
  put: (doc, quests) => ({ ...doc, quests }),
  describe: (q) => `Quest ${q.questId}: ${String(q.aggregate.values['quest_template.LogTitle'] ?? '')}`,
  fields: (q) => Object.fromEntries(Object.entries(q.aggregate.values).map(([id, value]) => [id, stableJson(value)])),
  comparable: (q) => ({ isNew: q.isNew, aggregate: q.aggregate }),
  references: (q) => {
    const use = questRefs(q);
    const refs = (kind: string, entries: number[]): Ref[] => entries.map((entry) => ({ kind, key: String(entry) }));
    return [...refs('npc', use.npcs), ...refs('object', use.objects), ...refs('item', use.items)];
  },
});
