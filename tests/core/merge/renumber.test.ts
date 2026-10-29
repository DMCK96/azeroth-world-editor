import { describe, expect, it } from 'vitest';
import { newNpc, newObject, newItem, newSpawn } from '../../../src/core/entities/model';
import { questRefs } from '../../../src/core/entities/links';
import { MERGE_KINDS } from '../../../src/core/merge/kinds';
import type { MergeDocument } from '../../../src/core/merge/doc';
import { stableJson } from '../../../src/core/merge/stable';
import { docOf, placed, quest } from './helpers';

const kind = (key: string) => MERGE_KINDS.find((k) => k.key === key)!;
const q = (id: number, values: Record<string, unknown>) => { const x = quest(id); Object.assign(x.aggregate.values, values); return x; };
const v = (doc: MergeDocument, i = 0) => doc.quests[i]!.aggregate.values as Record<string, any>;
const pos = { x: 0, y: 0, z: 0, o: 0 };
const scene = (owner: unknown, steps: unknown[] = [], gates: unknown[] = []) => ({ id: 's1', name: 'n', owner, trigger: { kind: 'talkedTo' }, gates, steps });
const npcScene = (extra: Record<string, unknown>) => ({ id: 's1', name: 'n', questId: 0, trigger: { kind: 'talkedTo' }, gates: [], steps: [], ...extra });
const fight = (reactions: unknown[]) => ({ phases: [], abilities: [], reactions });
const reaction = (when: unknown, steps: unknown[]) => ({ id: 'r1', when, phases: [], steps });
const cond = (type: number, v1: number, v2 = 0) => ({ SourceGroup: 0, SourceId: 0, ElseGroup: 0, ConditionTypeOrReference: type, ConditionTarget: 0, ConditionValue1: v1, ConditionValue2: v2, ConditionValue3: 0 });
const patrol = (actions: unknown[]) => ({ pathId: 1, startPace: 'walk', points: [{ x: 0, y: 0, z: 0, waitSecs: 0, facing: null, paceFromHere: null, actions }] });
const ents = (part: Partial<MergeDocument['entities']>): MergeDocument['entities'] => ({ npcs: [], objects: [], items: [], ...part });

describe('freeKey', () => {
  it('is above every id of the kind in every document', () => {
    const a = docOf({ quests: [quest(60001), quest(60005)] });
    const b = docOf({ quests: [quest(60009)] });
    expect(kind('quest').freeKey!('60001', [a, b])).toBe('60010');
  });
  it('keeps a placed spawn in its own scope', () => {
    const a = docOf({ world: { spawns: [], routes: [], added: [placed(10), placed(50, 1, 0, 'gameobject')] } });
    expect(kind('placed-spawn').freeKey!('creature:10', [a])).toBe('creature:11');
  });
  it('counts the guids of the spawns inside entities as used', () => {
    const npc = { ...newNpc(1), spawns: [{ guid: 70, map: 0, x: 0, y: 0, z: 0, orientation: 0 }] } as never;
    const a = docOf({ entities: { npcs: [npc], objects: [], items: [] }, world: { spawns: [], routes: [], added: [placed(10)] } });
    expect(kind('placed-spawn').freeKey!('creature:10', [a])).toBe('creature:71');
  });
  it('counts the object spawn guids for a gameobject scope only', () => {
    const obj = { ...newObject(1), spawns: [newSpawn(90)] };
    const npc = { ...newNpc(1), spawns: [newSpawn(500)] };
    const a = docOf({ entities: ents({ npcs: [npc], objects: [obj] }), world: { spawns: [], routes: [], added: [placed(50, 1, 0, 'gameobject')] } });
    expect(kind('placed-spawn').freeKey!('gameobject:50', [a])).toBe('gameobject:91');
  });
  it('is above every entry of the entity kind in every document', () => {
    const a = docOf({ entities: ents({ npcs: [newNpc(100), newNpc(300)], items: [newItem(900)] }) });
    const b = docOf({ entities: ents({ npcs: [newNpc(200)] }) });
    expect(kind('npc').freeKey!('100', [a, b])).toBe('301');
    expect(kind('object').freeKey!('1', [docOf({ entities: ents({ objects: [newObject(7000)] }) })])).toBe('7001');
    expect(kind('item').freeKey!('900', [a, b])).toBe('901');
  });
  it('is above every group id in every document', () => {
    const g = (id: number) => ({ id, name: 'g', map: 0, maxActive: 1, members: [], event: null, origin: { kind: 'new' } }) as never;
    const a = docOf({ world: { spawns: [], routes: [], added: [], groups: [g(3), g(8)] } });
    expect(kind('group').freeKey!('3', [a, docOf({})])).toBe('9');
  });
});

describe('renumber a quest', () => {
  it('changes its id and every quest, group and fight that names it', () => {
    const a = quest(60001);
    const b = q(60002, { 'quest_template_addon.PrevQuestID': 60001 });
    const npc = { ...newNpc(5), fight: { reactions: [{ steps: [{ kind: 'credit', quest: 60001 }] }] } } as never;
    const grp = { id: 1, name: 'g', map: 0, maxActive: 1, members: [{ type: 'quest', questId: 60001 }], event: null, origin: { kind: 'new' } } as never;
    const doc = docOf({ quests: [a, b], entities: { npcs: [npc], objects: [], items: [] }, world: { spawns: [], routes: [], added: [], groups: [grp] } });
    const out = kind('quest').renumber!(doc, '60001', '60100');
    expect(out.quests.map((x) => x.questId).sort()).toEqual([60002, 60100]);
    expect(out.quests.find((x) => x.questId === 60100)!.aggregate.questId).toBe(60100);
    expect(out.quests.find((x) => x.questId === 60002)!.aggregate.values['quest_template_addon.PrevQuestID']).toBe(60100);
    expect((out.entities.npcs[0] as any).fight.reactions[0].steps[0].quest).toBe(60100);
    expect((out.world.groups![0]!.members[0] as any).questId).toBe(60100);
    expect(doc.quests[0]!.questId).toBe(60001);
  });
  it('follows every chain link field, keeping the sign of PrevQuestID and ExclusiveGroup', () => {
    const b = q(2, {
      'quest_template_addon.PrevQuestID': -60001,
      'quest_template_addon.NextQuestID': 60001,
      'quest_template_addon.BreadcrumbForQuestId': 60001,
      'quest_template_addon.ExclusiveGroup': -60001,
      'quest_template.RewardNextQuest': 60001,
    });
    const c = q(3, { 'quest_template_addon.ExclusiveGroup': 60001, 'quest_template_addon.NextQuestID': 7 });
    const out = kind('quest').renumber!(docOf({ quests: [quest(60001), b, c] }), '60001', '60100');
    expect(v(out, 1)['quest_template_addon.PrevQuestID']).toBe(-60100);
    expect(v(out, 1)['quest_template_addon.NextQuestID']).toBe(60100);
    expect(v(out, 1)['quest_template_addon.BreadcrumbForQuestId']).toBe(60100);
    expect(v(out, 1)['quest_template_addon.ExclusiveGroup']).toBe(-60100);
    expect(v(out, 1)['quest_template.RewardNextQuest']).toBe(60100);
    expect(v(out, 2)['quest_template_addon.ExclusiveGroup']).toBe(60100);
    expect(v(out, 2)['quest_template_addon.NextQuestID']).toBe(7);
  });
  it("changes the quest's own id fields", () => {
    const a = q(60001, { 'quest_template.ID': 60001, 'quest_template_addon.ID': 60001, 'quest_details.ID': 60001, 'quest_offer_reward.ID': 60001, 'quest_request_items.ID': 60001, 'quest_mail_sender.QuestId': 60001 });
    const out = kind('quest').renumber!(docOf({ quests: [a] }), '60001', '60100');
    for (const id of ['quest_template.ID', 'quest_template_addon.ID', 'quest_details.ID', 'quest_offer_reward.ID', 'quest_request_items.ID', 'quest_mail_sender.QuestId']) {
      expect(v(out)[id]).toBe(60100);
    }
  });
  it('follows quest gates in quest scenes and quest conditions', () => {
    const b = q(2, {
      scripts: [scene({ kind: 'creature', entry: 1 }, [], [{ kind: 'quest', questId: 60001, state: 'inLog', negate: false }, { kind: 'quest', questId: 5, state: 'inLog', negate: false }])],
      conditions: [8, 9, 14, 28, 43, 47, 48, 101].map((t) => cond(t, 60001)).concat([cond(2, 60001)]),
    });
    const out = kind('quest').renumber!(docOf({ quests: [quest(60001), b] }), '60001', '60100');
    expect(v(out, 1).scripts[0].gates.map((g: any) => g.questId)).toEqual([60100, 5]);
    expect(v(out, 1).conditions.map((c: any) => c.ConditionValue1)).toEqual([60100, 60100, 60100, 60100, 60100, 60100, 60100, 60100, 60001]);
  });
  it('follows NPC scenes, object and item fields that name the quest', () => {
    const npc = { ...newNpc(5), scenes: [npcScene({ questId: 60001, gates: [{ kind: 'quest', questId: 60001, state: 'handedIn', negate: false }] })] } as never;
    const obj = { ...newObject(6), onlyDuringQuest: 60001 };
    const item = { ...newItem(7), startsQuest: 60001 };
    const doc = docOf({ quests: [quest(60001)], entities: ents({ npcs: [npc], objects: [obj], items: [item] }) });
    const out = kind('quest').renumber!(doc, '60001', '60100');
    expect((out.entities.npcs[0] as any).scenes[0].questId).toBe(60100);
    expect((out.entities.npcs[0] as any).scenes[0].gates[0].questId).toBe(60100);
    expect(out.entities.objects[0]!.onlyDuringQuest).toBe(60100);
    expect(out.entities.items[0]!.startsQuest).toBe(60100);
  });
  it('follows the quests that share linked rows with it', () => {
    const b = q(2, {});
    b.aggregate.sharedItems = { '900': [60001, 4] };
    const out = kind('quest').renumber!(docOf({ quests: [quest(60001), b] }), '60001', '60100');
    expect(out.quests[1]!.aggregate.sharedItems).toEqual({ '900': [60100, 4] });
  });
  it('never changes its argument', () => {
    const b = q(2, { 'quest_template_addon.PrevQuestID': 60001, scripts: [scene({ kind: 'creature', entry: 1 }, [], [{ kind: 'quest', questId: 60001, state: 'inLog', negate: false }])] });
    const doc = docOf({ quests: [quest(60001), b], entities: ents({ objects: [{ ...newObject(6), onlyDuringQuest: 60001 }] }) });
    const before = stableJson(doc);
    kind('quest').renumber!(doc, '60001', '60100');
    expect(stableJson(doc)).toBe(before);
  });
});

describe('renumber an NPC entry', () => {
  it('changes the NPC, its placed spawns, group members, and every position a quest names it', () => {
    const quest1 = q(1, {
      creature_questender: [{ id: 11000230 }],
      creature_queststarter: [{ id: 11000230 }],
      'quest_template.RequiredNpcOrGo': [{ target: { target: 'creature', id: 11000230 } }],
    });
    const grp = { id: 1, name: 'g', map: 0, maxActive: 1, members: [{ type: 'spawn', kind: 'npc', guid: 5, entry: 11000230, chance: 1 }], event: null, origin: { kind: 'new' } } as never;
    const doc = docOf({
      quests: [quest1],
      entities: { npcs: [newNpc(11000230)], objects: [], items: [] },
      world: { spawns: [], routes: [], added: [placed(5, 11000230), placed(6, 11000230, 0, 'gameobject')], groups: [grp] },
    });
    expect(questRefs(quest1).npcs).toEqual([11000230]);
    const out = kind('npc').renumber!(doc, '11000230', '11000300');
    expect(out.entities.npcs[0]!.entry).toBe(11000300);
    expect(out.world.added.map((s) => s.entry)).toEqual([11000300, 11000230]);
    expect((out.world.groups![0]!.members[0] as any).entry).toBe(11000300);
    expect(questRefs(out.quests[0]!).npcs).toEqual([11000300]);
  });
  it('leaves no position questRefs reports naming the old entry (the oracle)', () => {
    const E = 500;
    const quest1 = q(1, {
      creature_queststarter: [{ id: E }],
      creature_questender: [{ id: E }],
      'quest_template.RequiredNpcOrGo': [{ target: { target: 'creature', id: E } }, { target: { target: 'gameobject', id: E } }],
      scripts: [
        scene({ kind: 'creature', entry: E }, [
          { kind: 'spawnNpc', entry: E, at: pos, despawnAfterS: 0, attackPlayer: false, waitMs: 0 },
          { kind: 'despawn', entry: E, range: 5, waitMs: 0 },
          { kind: 'signal', signal: 1, targetKind: 'creature', entry: E, range: 5, waitMs: 0 },
          { kind: 'signal', signal: 1, targetKind: 'gameobject', entry: E, range: 5, waitMs: 0 },
          { kind: 'spawnObject', entry: E, at: pos, despawnAfterS: 0, waitMs: 0 },
        ]),
      ],
    });
    const before = questRefs(quest1);
    expect(before.npcs).toEqual([E]);
    const out = kind('npc').renumber!(docOf({ quests: [quest1], entities: ents({ npcs: [newNpc(E)] }) }), String(E), '600');
    const after = questRefs(out.quests[0]!);
    expect(after.npcs).toEqual([600]);
    // An object of the same number is a different thing and stays
    expect(after.objects).toEqual(before.objects);
  });
  it('follows game event quest givers, the mail sender, quest item and loot rows, and NPC conditions', () => {
    const quest1 = q(1, {
      game_event_creature_quest: [{ eventEntry: 1, id: 500 }],
      game_event_gameobject_quest: [{ eventEntry: 1, id: 500 }],
      'quest_mail_sender.RewardMailSenderEntry': 500,
      creature_questitem: [{ CreatureEntry: 500, Idx: 0, ItemId: 1 }],
      creature_loot_template: [{ Entry: 500, Item: 1 }],
      gameobject_loot_template: [{ Entry: 500, Item: 1 }],
      conditions: [cond(29, 500), cond(30, 500), cond(31, 3, 500), cond(31, 5, 500)],
    });
    const out = kind('npc').renumber!(docOf({ quests: [quest1], entities: ents({ npcs: [newNpc(500)] }) }), '500', '600');
    const vals = v(out);
    expect(vals.game_event_creature_quest[0].id).toBe(600);
    expect(vals.game_event_gameobject_quest[0].id).toBe(500);
    expect(vals['quest_mail_sender.RewardMailSenderEntry']).toBe(600);
    expect(vals.creature_questitem[0].CreatureEntry).toBe(600);
    expect(vals.creature_loot_template[0].Entry).toBe(600);
    expect(vals.gameobject_loot_template[0].Entry).toBe(500);
    expect(vals.conditions.map((c: any) => [c.ConditionValue1, c.ConditionValue2])).toEqual([[600, 0], [500, 0], [3, 600], [5, 500]]);
  });
  it('follows the fights, NPC scenes, vendor references and patrol mounts of other NPCs', () => {
    const other = {
      ...newNpc(1),
      fight: fight([reaction({ kind: 'addDies', entry: 500 }, [
        { kind: 'summonAdds', entry: 500, count: 1, at: 'aroundMe', attack: true, waitMs: 0 },
        { kind: 'despawnAdds', entry: 500, waitMs: 0 },
      ])]),
      scenes: [npcScene({ steps: [
        { kind: 'spawnNpc', entry: 500, at: pos, despawnAfterS: 0, attackPlayer: false, waitMs: 0 },
        { kind: 'despawn', entry: 500, range: 5, waitMs: 0 },
        { kind: 'signal', signal: 1, targetKind: 'creature', entry: 500, range: 5, waitMs: 0 },
        { kind: 'spawnObject', entry: 500, at: pos, despawnAfterS: 0, waitMs: 0 },
      ] })],
      vendor: [{ item: -500, maxCount: 0, restockSecs: 0, extendedCost: 0 }, { item: 500, maxCount: 0, restockSecs: 0, extendedCost: 0 }],
      spawns: [{ ...newSpawn(9), patrol: patrol([{ id: 'a', afterSecs: 0, kind: 'mount', creature: 500 }]) }],
    } as never;
    const out = kind('npc').renumber!(docOf({ entities: ents({ npcs: [newNpc(500), other] }) }), '500', '600');
    const n = out.entities.npcs[1] as any;
    expect(n.fight.reactions[0].when.entry).toBe(600);
    expect(n.fight.reactions[0].steps.map((s: any) => s.entry)).toEqual([600, 600]);
    expect(n.scenes[0].steps.map((s: any) => s.entry)).toEqual([600, 600, 600, 500]);
    expect(n.vendor.map((x: any) => x.item)).toEqual([-600, 500]);
    expect(n.spawns[0].patrol.points[0].actions[0].creature).toBe(600);
  });
  it('follows the movement and game event edits of its placed spawns only', () => {
    const mv = (guid: number, entry: number) => ({ guid, entry, name: 'm', map: 0, addonRow: false, original: {}, current: {} }) as never;
    const ev = (guid: number, entry: number) => ({ guid, entry, name: 'e', map: 0, original: [], current: null }) as never;
    const doc = docOf({ entities: ents({ npcs: [newNpc(500)] }), world: { spawns: [], routes: [], added: [placed(5, 500)], movements: [mv(5, 500), mv(77, 500)], spawnEvents: [ev(5, 500), ev(77, 500)] } });
    const out = kind('npc').renumber!(doc, '500', '600');
    expect(out.world.movements!.map((m) => m.entry)).toEqual([600, 500]);
    expect(out.world.spawnEvents!.map((m) => m.entry)).toEqual([600, 500]);
  });
  it('never changes its argument', () => {
    const quest1 = q(1, { creature_queststarter: [{ id: 500 }], scripts: [scene({ kind: 'creature', entry: 500 })] });
    const doc = docOf({ quests: [quest1], entities: ents({ npcs: [newNpc(500)] }), world: { spawns: [], routes: [], added: [placed(5, 500)] } });
    const before = stableJson(doc);
    kind('npc').renumber!(doc, '500', '600');
    expect(stableJson(doc)).toBe(before);
  });
});

describe('renumber an object or item entry', () => {
  it('follows the object into quests and placed gameobjects', () => {
    const quest1 = q(1, { 'quest_template.RequiredNpcOrGo': [{ target: { target: 'gameobject', id: 7000 } }] });
    const doc = docOf({ quests: [quest1], entities: { npcs: [], objects: [newObject(7000)], items: [] }, world: { spawns: [], routes: [], added: [placed(1, 7000, 0, 'gameobject')] } });
    const out = kind('object').renumber!(doc, '7000', '7100');
    expect(out.entities.objects[0]!.entry).toBe(7100);
    expect(out.world.added[0]!.entry).toBe(7100);
    expect(questRefs(out.quests[0]!).objects).toEqual([7100]);
  });
  it('leaves no position questRefs reports naming the old object (the oracle)', () => {
    const E = 7000;
    const quest1 = q(1, {
      gameobject_queststarter: [{ id: E }],
      gameobject_questender: [{ id: E }],
      creature_queststarter: [{ id: E }],
      'quest_template.RequiredNpcOrGo': [{ target: { target: 'gameobject', id: E } }],
      scripts: [
        scene({ kind: 'gameobject', entry: E }, [
          { kind: 'spawnObject', entry: E, at: pos, despawnAfterS: 0, waitMs: 0 },
          { kind: 'objectState', state: 'open', entry: E, range: 5, waitMs: 0 },
          { kind: 'signal', signal: 1, targetKind: 'gameobject', entry: E, range: 5, waitMs: 0 },
        ]),
      ],
      game_event_gameobject_quest: [{ eventEntry: 1, id: E }],
      gameobject_questitem: [{ GameObjectEntry: E, Idx: 0, ItemId: 1 }],
      gameobject_loot_template: [{ Entry: E, Item: 1 }],
      conditions: [cond(30, E), cond(31, 5, E)],
    });
    const out = kind('object').renumber!(docOf({ quests: [quest1], entities: ents({ objects: [newObject(E)] }) }), String(E), '7100');
    expect(questRefs(out.quests[0]!).objects).toEqual([7100]);
    expect(questRefs(out.quests[0]!).npcs).toEqual([E]);
    const vals = v(out);
    expect(vals.game_event_gameobject_quest[0].id).toBe(7100);
    expect(vals.gameobject_questitem[0].GameObjectEntry).toBe(7100);
    expect(vals.gameobject_loot_template[0].Entry).toBe(7100);
    expect(vals.conditions.map((c: any) => [c.ConditionValue1, c.ConditionValue2])).toEqual([[7100, 0], [5, 7100]]);
  });
  it('follows the object into group members, patrol use-object actions and NPC scenes', () => {
    const grp = { id: 1, name: 'g', map: 0, maxActive: 1, members: [{ type: 'spawn', kind: 'object', guid: 5, entry: 7000, chance: 1 }, { type: 'spawn', kind: 'npc', guid: 6, entry: 7000, chance: 1 }], event: null, origin: { kind: 'new' } } as never;
    const npc = {
      ...newNpc(1),
      spawns: [{ ...newSpawn(9), patrol: patrol([{ id: 'a', afterSecs: 0, kind: 'useObject', guid: 5, entry: 7000 }]) }],
      scenes: [npcScene({ steps: [
        { kind: 'spawnObject', entry: 7000, at: pos, despawnAfterS: 0, waitMs: 0 },
        { kind: 'objectState', state: 'open', entry: 7000, range: 5, waitMs: 0 },
        { kind: 'signal', signal: 1, targetKind: 'gameobject', entry: 7000, range: 5, waitMs: 0 },
        { kind: 'despawn', entry: 7000, range: 5, waitMs: 0 },
      ] })],
    } as never;
    const doc = docOf({ entities: ents({ npcs: [npc], objects: [newObject(7000)] }), world: { spawns: [], routes: [], added: [], groups: [grp] } });
    const out = kind('object').renumber!(doc, '7000', '7100');
    expect(out.world.groups![0]!.members.map((m: any) => m.entry)).toEqual([7100, 7000]);
    const n = out.entities.npcs[0] as any;
    expect(n.spawns[0].patrol.points[0].actions[0]).toMatchObject({ guid: 5, entry: 7100 });
    expect(n.scenes[0].steps.map((s: any) => s.entry)).toEqual([7100, 7100, 7100, 7000]);
  });
  it('follows the item into every quest item field', () => {
    const quest1 = q(1, { 'quest_template.RequiredItems': [{ item: 900 }], 'quest_template.RewardItems': [{ item: 900 }], 'quest_template.StartItem': 900 });
    const doc = docOf({ quests: [quest1], entities: { npcs: [], objects: [], items: [newItem(900)] } });
    const out = kind('item').renumber!(doc, '900', '950');
    expect(out.entities.items[0]!.entry).toBe(950);
    expect(questRefs(out.quests[0]!).items).toEqual([950]);
  });
  it('leaves no position questRefs reports naming the old item (the oracle)', () => {
    const I = 900;
    const quest1 = q(1, {
      'quest_template.RequiredItems': [{ item: I, count: 1 }],
      'quest_template.RewardItems': [{ item: I }],
      'quest_template.RewardChoiceItems': [{ item: I }],
      'quest_template.ItemDrops': [{ item: I }],
      'quest_template.StartItem': I,
      creature_queststarter: [{ id: I }],
      scripts: [scene({ kind: 'creature', entry: 1 }, [
        { kind: 'giveItem', item: I, count: 1, waitMs: 0 },
        { kind: 'takeItem', item: I, count: 1, waitMs: 0 },
      ])],
    });
    const out = kind('item').renumber!(docOf({ quests: [quest1], entities: ents({ items: [newItem(I)] }) }), String(I), '950');
    expect(questRefs(out.quests[0]!).items).toEqual([950]);
    expect(questRefs(out.quests[0]!).npcs).toEqual([1, I]);
  });
  it('follows the item into scene gates, conditions, linked rows and shared items', () => {
    const quest1 = q(1, {
      scripts: [scene({ kind: 'creature', entry: 1 }, [], [{ kind: 'item', item: 900, count: 1, negate: false }])],
      conditions: [cond(2, 900), cond(3, 900), cond(8, 900)],
      creature_loot_template: [{ Entry: 1, Item: 900 }],
      gameobject_loot_template: [{ Entry: 1, Item: 900 }],
      creature_questitem: [{ CreatureEntry: 1, Idx: 0, ItemId: 900 }],
      gameobject_questitem: [{ GameObjectEntry: 1, Idx: 0, ItemId: 900 }],
    });
    quest1.aggregate.sharedItems = { '900': [4], '901': [5] };
    const out = kind('item').renumber!(docOf({ quests: [quest1], entities: ents({ items: [newItem(900)] }) }), '900', '950');
    const vals = v(out);
    expect(vals.scripts[0].gates[0].item).toBe(950);
    expect(vals.conditions.map((c: any) => c.ConditionValue1)).toEqual([950, 950, 900]);
    expect(vals.creature_loot_template[0].Item).toBe(950);
    expect(vals.gameobject_loot_template[0].Item).toBe(950);
    expect(vals.creature_questitem[0].ItemId).toBe(950);
    expect(vals.gameobject_questitem[0].ItemId).toBe(950);
    expect(out.quests[0]!.aggregate.sharedItems).toEqual({ '950': [4], '901': [5] });
  });
  it('follows the item into loot, vendor stock, equipment and NPC scenes', () => {
    const npc = {
      ...newNpc(1),
      loot: [{ item: 900, chance: 1, min: 1, max: 1, questOnly: false }],
      vendor: [{ item: 900, maxCount: 0, restockSecs: 0, extendedCost: 0 }, { item: -900, maxCount: 0, restockSecs: 0, extendedCost: 0 }],
      equipment: { mainHand: 900, offHand: 900, ranged: 900 },
      scenes: [npcScene({
        steps: [{ kind: 'giveItem', item: 900, count: 1, waitMs: 0 }, { kind: 'takeItem', item: 900, count: 1, waitMs: 0 }],
        gates: [{ kind: 'item', item: 900, count: 1, negate: false }],
      })],
    } as never;
    const obj = { ...newObject(2), loot: [{ item: 900, chance: 1, min: 1, max: 1, questOnly: true }] };
    const out = kind('item').renumber!(docOf({ entities: ents({ npcs: [npc], objects: [obj], items: [newItem(900)] }) }), '900', '950');
    const n = out.entities.npcs[0] as any;
    expect(n.loot[0].item).toBe(950);
    expect(n.vendor.map((x: any) => x.item)).toEqual([950, -900]);
    expect(n.equipment).toEqual({ mainHand: 950, offHand: 950, ranged: 950 });
    expect(n.scenes[0].steps.map((s: any) => s.item)).toEqual([950, 950]);
    expect(n.scenes[0].gates[0].item).toBe(950);
    expect(out.entities.objects[0]!.loot[0]!.item).toBe(950);
  });
  it('never changes its argument', () => {
    const npc = { ...newNpc(1), loot: [{ item: 900, chance: 1, min: 1, max: 1, questOnly: false }] };
    const doc = docOf({ quests: [q(1, { 'quest_template.StartItem': 900 })], entities: ents({ npcs: [npc], items: [newItem(900)] }) });
    const before = stableJson(doc);
    kind('item').renumber!(doc, '900', '950');
    expect(stableJson(doc)).toBe(before);
  });
});

describe('renumber a group', () => {
  it('changes the id and the members of other groups that hold it', () => {
    const g = (id: number, members: any[]) => ({ id, name: 'g', map: 0, maxActive: 1, members, event: null, origin: { kind: 'new' } }) as never;
    const doc = docOf({ world: { spawns: [], routes: [], added: [], groups: [g(1, []), g(2, [{ type: 'group', id: 1, chance: 5 }])] } });
    const out = kind('group').renumber!(doc, '1', '9');
    expect(out.world.groups!.map((x) => x.id).sort()).toEqual([2, 9]);
    expect((out.world.groups!.find((x) => x.id === 2)!.members[0] as any).id).toBe(9);
  });
  it("follows a quest's pool rows and never changes its argument", () => {
    const g = (id: number) => ({ id, name: 'g', map: 0, maxActive: 1, members: [], event: null, origin: { kind: 'new' } }) as never;
    const doc = docOf({ quests: [q(1, { pool_quest: [{ pool_entry: 1, description: 'd' }, { pool_entry: 4, description: 'd' }] })], world: { spawns: [], routes: [], added: [], groups: [g(1)] } });
    const before = stableJson(doc);
    const out = kind('group').renumber!(doc, '1', '9');
    expect(v(out).pool_quest.map((r: any) => r.pool_entry)).toEqual([9, 4]);
    expect(stableJson(doc)).toBe(before);
  });
});

describe('renumber a placed spawn', () => {
  it('changes the guid through the spawn-guid rename, including group members', () => {
    const grp = { id: 1, name: 'g', map: 0, maxActive: 1, members: [{ type: 'spawn', kind: 'npc', guid: 5, entry: 1, chance: 1 }], event: null, origin: { kind: 'new' } } as never;
    const doc = docOf({ world: { spawns: [], routes: [], added: [placed(5, 1)], groups: [grp] } });
    const out = kind('placed-spawn').renumber!(doc, 'creature:5', 'creature:80');
    expect(out.world.added[0]!.guid).toBe(80);
    expect((out.world.groups![0]!.members[0] as any).guid).toBe(80);
  });
  it('keeps to its scope, follows patrol use-object actions, and never changes its argument', () => {
    const npc = { ...newNpc(1), spawns: [{ ...newSpawn(9), patrol: patrol([{ id: 'a', afterSecs: 0, kind: 'useObject', guid: 5, entry: 7 }]) }] } as never;
    const doc = docOf({ entities: ents({ npcs: [npc] }), world: { spawns: [], routes: [], added: [placed(5, 7, 0, 'gameobject'), placed(5, 1)] } });
    const before = stableJson(doc);
    const out = kind('placed-spawn').renumber!(doc, 'gameobject:5', 'gameobject:80');
    expect(out.world.added.map((s) => `${s.kind}:${s.guid}`)).toEqual(['gameobject:80', 'creature:5']);
    expect((out.entities.npcs[0] as any).spawns[0].patrol.points[0].actions[0].guid).toBe(80);
    expect(stableJson(doc)).toBe(before);
    expect(out.quests).toBe(doc.quests);
  });
});
