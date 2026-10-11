import { describe, expect, it } from 'vitest';
import { existingStatements } from '../../src/core/entities/existing';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { EMPTY_ENTITIES, newNpc } from '../../src/core/entities/model';
import { compileScenes } from '../../src/core/scripts/compile';
import { EMPTY_SCRIPT_CONTEXT } from '../../src/core/scripts/context';
import { compileNpcScenes } from '../../src/core/scripts/npc-compile';
import { blankNpcScene, npcSceneSchema, type NpcScene } from '../../src/core/scripts/npc-scenes';
import { npcTriggerComment } from '../../src/core/scripts/tag';
import { npcSceneIssues } from '../../src/core/scripts/npc-validate';
import type { QuestScene } from '../../src/core/scripts/model';

const NONE = { inserts: {}, deletes: {}, updates: [], flags: [], warnings: [] };
const say = { kind: 'say' as const, text: 'Hi', style: 'say' as const, waitMs: 0 };
const scene = (id: string, over: Partial<NpcScene> = {}): NpcScene => ({ ...blankNpcScene(id), steps: [say], ...over });
const npcWith = (scenes: NpcScene[], entry = 12000001) => ({ ...newNpc(entry), name: 'Hela', scenes });
const escort = (id: string): NpcScene => scene(id, { steps: [{ kind: 'startEscort', points: [{ x: 1, y: 1, z: 1, o: 0 }], run: false, waitMs: 0 }] });
const questEscort: QuestScene = { id: 's1', name: '', owner: { kind: 'creature', entry: 777 }, trigger: { kind: 'dies' }, gates: [], steps: [{ kind: 'startEscort', points: [{ x: 2, y: 2, z: 2, o: 0 }], run: false, waitMs: 0 }] };
const questOption: QuestScene = { id: 's2', name: '', owner: { kind: 'creature', entry: 12000001 }, trigger: { kind: 'gossipOption', text: 'Quest', greeting: '' }, gates: [], steps: [{ kind: 'emote', emote: 1, waitMs: 0 }] };

describe('review: existing NPC re-export keeps SmartAI', () => {
  const template = { entry: '1423', name: 'Guard', subname: '', minlevel: '55', maxlevel: '56', faction: '11', rank: '1', type: '7', npcflag: '1', HealthModifier: '1', DamageModifier: '1', AIName: '', ScriptName: '', lootid: '0' };
  const model = { CreatureID: '1423', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1' };
  const read = npcFromRows(1423, { creature_template: [template], creature_template_model: [model] }, { sharedLoot: 0, spawnCount: 1 });
  // An NPC whose template is as it was read writes none, which leaves its AI as it was ('')
  const aiOf = (npc: typeof read) =>
    (existingStatements({ ...EMPTY_ENTITIES, npcs: [npc] }, []).apply.find((s) => s.kind === 'insert' && s.table === 'creature_template') as { row: Record<string, string> } | undefined)?.row.AIName ?? ''; 

  it('writes SmartAI for an NPC given scenes whose snapshot said no AI, and leaves one without scenes as it was', () => {
    expect(aiOf({ ...read, scenes: [scene('s1')] })).toBe('SmartAI');
    expect(aiOf(read)).toBe('');
  });
  it('does not write SmartAI over an NPC whose scenes are locked', () => {
    const locked = { ...read, scenes: [scene('s1')], origin: { ...(read.origin as object), locked: ['scenes'] } } as typeof read;
    expect(aiOf(locked)).toBe('');
  });
});

describe('review: numbers an NPC scene and a quest scene must not share', () => {
  it('gives an NPC escort and a quest escort different path ids', () => {
    const project = compileNpcScenes({ npcs: [npcWith([escort('s1')])], objectives: new Map(), context: { ...EMPTY_SCRIPT_CONTEXT, waypointsMax: 100 }, taken: NONE });
    const quest = compileScenes({ questId: 5, scenes: [questEscort], objectives: [0, 0, 0, 0], context: { ...EMPTY_SCRIPT_CONTEXT, waypointsMax: 100 }, taken: project });
    expect(project.inserts.waypoints![0]!.entry).toBe('101');
    expect(quest.inserts.waypoints![0]!.entry).toBe('102');
  });
  it('gives an NPC gossipOption scene and a quest one on the same NPC different option ids', () => {
    const own = scene('s1', { trigger: { kind: 'gossipOption', text: 'Mine', greeting: '' } });
    const context = { ...EMPTY_SCRIPT_CONTEXT, creatures: [{ entry: '12000001', npcflag: '1', gossip_menu_id: '40', AIName: 'SmartAI', ScriptName: '' }] };
    const project = compileNpcScenes({ npcs: [npcWith([own])], objectives: new Map(), context, taken: NONE });
    const quest = compileScenes({ questId: 5, scenes: [questOption], objectives: [0, 0, 0, 0], context, taken: project });
    expect(project.inserts.gossip_menu_option![0]).toMatchObject({ MenuID: '40', OptionID: '0' });
    expect(quest.inserts.gossip_menu_option![0]).toMatchObject({ MenuID: '40', OptionID: '1' });
  });
  it('gives two NPCs with no menu different new menu and text ids', () => {
    const own = scene('s1', { trigger: { kind: 'gossipOption', text: 'Mine', greeting: '' } });
    const out = compileNpcScenes({ npcs: [npcWith([own], 12000001), npcWith([own], 12000002)], objectives: new Map(), context: EMPTY_SCRIPT_CONTEXT, taken: NONE });
    const menus = out.inserts.gossip_menu!.map((r) => r.MenuID);
    const texts = out.inserts.npc_text!.map((r) => r.ID);
    expect(new Set(menus).size).toBe(2);
    expect(new Set(texts).size).toBe(2);
    const quest = compileScenes({ questId: 5, scenes: [{ ...questOption, owner: { kind: 'creature', entry: 12000003 } }], objectives: [0, 0, 0, 0], context: EMPTY_SCRIPT_CONTEXT, taken: out });
    expect(menus).not.toContain(quest.inserts.gossip_menu![0]!.MenuID);
    expect(texts).not.toContain(quest.inserts.npc_text![0]!.ID);
  });
});

describe('review: ids stay out of the way of a chain with a gap', () => {
  it('does not take an id a database row links to, even when no row has it', () => {
    const database = [0, 1, 2, 5, 6].map((id) => ({ entryorguid: '12000001', source_type: '0', id: String(id), link: id === 2 ? '3' : '0', event_type: id === 3 ? '61' : '1', comment: '' }));
    const out = compileNpcScenes({ npcs: [npcWith([scene('s1')])], objectives: new Map(), context: { ...EMPTY_SCRIPT_CONTEXT, smartScripts: database }, taken: NONE });
    const mine = (out.inserts.smart_scripts ?? []).filter((r) => r.source_type === '0').map((r) => Number(r.id));
    expect(mine).not.toContain(3);
  });
});

describe('review: an option a gossipOption scene added is not read back as an ordinary one', () => {
  const rows = (comment: string) => ({
    creature_template: [{ entry: '100', name: 'Old', gossip_menu_id: '5', npcflag: '1', AIName: 'SmartAI', ScriptName: '' }],
    gossip_menu: [{ MenuID: '5', TextID: '9' }],
    gossip_menu_option: [{ MenuID: '5', OptionID: '0', OptionIcon: '0', OptionText: 'Added', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0' }],
    npc_text: [{ ID: '9', text0_0: 'Hello', Probability0: '1' }],
    smart_scripts: [{ entryorguid: '100', source_type: '0', id: '0', link: '0', event_type: '62', event_param1: '5', event_param2: '0', comment }],
  });
  const kept = (comment: string) => npcFromRows(100, rows(comment), { sharedLoot: 0, spawnCount: 1 }).gossipMenu!.menus[0]!.options[0]!.kept;
  it('keeps it frozen for a gossipOption scene, and frees it for a gossipPicked one', () => {
    expect(kept(npcTriggerComment(100, scene('s1', { trigger: { kind: 'gossipOption', text: 'Added', greeting: '' } })))).toBe(true);
    expect(kept(npcTriggerComment(100, scene('s1', { trigger: { kind: 'gossipPicked', menuId: 5, optionId: 0 } })))).toBe(false);
  });
});

describe('review: scene ids', () => {
  it('only accepts ids like s1, s2', () => {
    expect(npcSceneSchema.safeParse({ ...blankNpcScene('greet') }).success).toBe(false);
    expect(npcSceneSchema.safeParse({ ...blankNpcScene('s12') }).success).toBe(true);
  });
});

describe('review: credit for a quest the project does not know', () => {
  const credit = scene('s1', { questId: 12345, steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }] });
  const issues = (objectives?: ReadonlyMap<number, readonly number[]>) =>
    npcSceneIssues({ npc: npcWith([credit]), label: 'NPC "Hela"', knownQuest: () => true, locked: false, objectives }).map((i) => `${i.severity}:${i.code}`);
  it('errors when the quest has no NPC for that objective, and is quiet when it has or when the quest is not known', () => {
    expect(issues(new Map([[12345, [0, 0, 0, 0]]]))).toEqual(['error:SCENE_CREDIT_EMPTY']);
    expect(issues(new Map([[12345, [1423, 0, 0, 0]]]))).toEqual([]);
    expect(issues(undefined)).toEqual([]);
  });
});

describe('review: other triggers compile', () => {
  it('compiles a waypointReached scene to the path its escort scene got, and a questAccepted scene', () => {
    const wait = scene('s2', { trigger: { kind: 'waypointReached', escortSceneId: 's1', point: 1 } });
    const accepted = scene('s3', { questId: 60001, trigger: { kind: 'questAccepted' } });
    const out = compileNpcScenes({ npcs: [npcWith([escort('s1'), wait, accepted])], objectives: new Map(), context: { ...EMPTY_SCRIPT_CONTEXT, waypointsMax: 50 }, taken: NONE });
    const rows = out.inserts.smart_scripts ?? [];
    expect(rows.some((r) => r.event_param1 === '1' && r.event_param2 === '51')).toBe(true);
    expect(rows.some((r) => r.event_param1 === '60001')).toBe(true);
  });
});

describe('review: the menu a gossipOption scene hangs off', () => {
  it('prefers the root of the project tree over the menu the template had', () => {
    const own = scene('s1', { trigger: { kind: 'gossipOption', text: 'Mine', greeting: '' } });
    const context = { ...EMPTY_SCRIPT_CONTEXT, creatures: [{ entry: '12000001', npcflag: '1', gossip_menu_id: '40', AIName: 'SmartAI', ScriptName: '' }] };
    const gossip = { roots: new Map([[12000001, 77]]), options: new Map(), maxMenu: 77, maxText: 0 };
    const out = compileNpcScenes({ npcs: [npcWith([own])], objectives: new Map(), context, taken: NONE, gossip });
    expect(out.inserts.gossip_menu_option![0]).toMatchObject({ MenuID: '77' });
  });
});

describe('review: an NPC adopted before its scene lock was recorded', () => {
  it('is judged by the template it was read with', () => {
    const old = { ...npcWith([scene('s1')]), origin: { kind: 'existing' as const, original: { creature_template: [{ entry: '12000001', AIName: 'ReactorAI', ScriptName: '' }] }, sharedLoot: 0, spawnCount: 1, locked: [] } };
    expect(compileNpcScenes({ npcs: [old], objectives: new Map(), context: EMPTY_SCRIPT_CONTEXT, taken: NONE }).inserts).toEqual({});
    expect(npcSceneIssues({ npc: old, label: 'NPC', knownQuest: () => true, locked: false }).map((i) => i.code)).toEqual(['NPC_SCENES_LOCKED']);
  });
});
