import type { CustomNpc } from '../../entities/model';
import type { MergeDocument } from '../doc';
import { mapQuestValues, mapSceneParts, mapScenes, swapConditionValue1, swapIn, swapScalar, swapSigned, type Row, type Values } from './refs';

/** The quest's own key, one field per table it owns a row of */
const OWN_ID_FIELDS = [
  'quest_template.ID',
  'quest_template_addon.ID',
  'quest_details.ID',
  'quest_offer_reward.ID',
  'quest_request_items.ID',
  'quest_mail_sender.QuestId',
];
const LINKS = ['quest_template_addon.NextQuestID', 'quest_template_addon.BreadcrumbForQuestId', 'quest_template.RewardNextQuest'];
/** A negative value is a flag (`PrevQuestID` < 0: while in the log; `ExclusiveGroup` < 0: finish all) */
const SIGNED_LINKS = ['quest_template_addon.PrevQuestID', 'quest_template_addon.ExclusiveGroup'];
/** Condition types whose `ConditionValue1` is a quest */
const QUEST_CONDITIONS: ReadonlySet<number> = new Set([8, 9, 14, 28, 43, 47, 48, 101]);

const questGate = (from: number, to: number) => (g: Row): Row => (g.kind === 'quest' ? swapIn(g, 'questId', from, to) : g);
const same = (x: Row): Row => x;

function questValues(values: Values, own: boolean, from: number, to: number): Values {
  let v = values;
  if (own) for (const id of OWN_ID_FIELDS) v = swapScalar(v, id, from, to);
  for (const id of LINKS) v = swapScalar(v, id, from, to);
  for (const id of SIGNED_LINKS) v = swapSigned(v, id, from, to);
  v = mapScenes(v, (scene) => mapSceneParts(scene, same, questGate(from, to)));
  return swapConditionValue1(v, QUEST_CONDITIONS, from, to);
}

function renameInNpc(npc: CustomNpc, from: number, to: number): CustomNpc {
  const fight = npc.fight && {
    ...npc.fight,
    reactions: npc.fight.reactions.map((r) => ({ ...r, steps: r.steps.map((s) => (s.kind === 'credit' ? swapIn(s, 'quest', from, to) : s)) })),
  };
  const scenes = npc.scenes.map((s) => mapSceneParts(swapIn(s, 'questId', from, to), same, questGate(from, to)));
  return { ...npc, fight, scenes };
}

/** The document with quest `from` moved to `to`, and every place in the table in `entry-refs.ts` that names it */
export function renameQuest(doc: MergeDocument, from: number, to: number): MergeDocument {
  const quests = mapQuestValues(doc, (values, quest) => questValues(values, quest.questId === from, from, to)).map((q) => {
    const sharedItems = Object.fromEntries(Object.entries(q.aggregate.sharedItems).map(([key, ids]) => [key, ids.map((id) => (id === from ? to : id))]));
    const own = q.questId === from;
    return { ...q, ...(own && { questId: to }), aggregate: { ...q.aggregate, sharedItems, ...(own && { questId: to }) } };
  });
  return {
    ...doc,
    quests,
    entities: {
      ...doc.entities,
      npcs: doc.entities.npcs.map((n) => renameInNpc(n, from, to)),
      objects: doc.entities.objects.map((o) => swapIn(o, 'onlyDuringQuest', from, to)),
      items: doc.entities.items.map((i) => swapIn(i, 'startsQuest', from, to)),
    },
    world: doc.world.groups
      ? { ...doc.world, groups: doc.world.groups.map((g) => ({ ...g, members: g.members.map((m) => (m.type === 'quest' ? swapIn(m, 'questId', from, to) : m)) })) }
      : doc.world,
  };
}
