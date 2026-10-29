import { describe, expect, it } from 'vitest';
import { newItem, newNpc, newObject } from '../../../src/core/entities/model';
import { questKind } from '../../../src/core/merge/kinds/quest';
import { npcKind } from '../../../src/core/merge/kinds/npc';
import { objectKind } from '../../../src/core/merge/kinds/object';
import { itemKind } from '../../../src/core/merge/kinds/item';
import { placedSpawnKind } from '../../../src/core/merge/kinds/placed-spawn';
import { groupKind } from '../../../src/core/merge/kinds/group';
import { MERGE_KINDS } from '../../../src/core/merge/kinds';
import { docOf, placed, quest } from './helpers';

describe('quest kind', () => {
  it('is keyed by quest id', () => {
    expect([...questKind.items(docOf({ quests: [quest(60002), quest(60001)] })).keys()].sort()).toEqual(['60001', '60002'].sort());
  });
  it('does not count where a quest sits on the canvas as a difference', () => {
    expect(questKind.same(quest(1, 'a', { x: 0, y: 0 }), quest(1, 'a', { x: 500, y: 9 }))).toBe(true);
  });
  it('counts an edited field as a difference and diffs only it', () => {
    const a = quest(1, 'Wolves');
    const b = quest(1, 'Bears');
    expect(questKind.same(a, b)).toBe(false);
    expect(questKind.diff(a, b).map((d) => d.field)).toEqual(['quest_template.LogTitle']);
  });
  it('describes a quest by id and title', () => {
    expect(questKind.describe(quest(60001, 'Wolves'))).toBe('Quest 60001: Wolves');
  });
  it('points at the NPCs, objects and items it names', () => {
    const q = quest(1);
    (q.aggregate.values as any)['creature_questender'] = [{ id: 11000230 }];
    (q.aggregate.values as any)['quest_template.RequiredItems'] = [{ item: 25 }];
    expect(questKind.references!(q)).toEqual(expect.arrayContaining([{ kind: 'npc', key: '11000230' }, { kind: 'item', key: '25' }]));
  });
  it('write replaces the quests and leaves the world alone', () => {
    const doc = docOf({ quests: [quest(1)] });
    const out = questKind.write(doc, new Map([['2', quest(2)]]));
    expect(out.quests.map((q) => q.questId)).toEqual([2]);
    expect(out.world).toBe(doc.world);
  });
});

describe('entity kinds', () => {
  it('key NPCs, objects and items by entry, each in its own kind', () => {
    const doc = docOf({ entities: { npcs: [newNpc(11000230)], objects: [newObject(11000231)], items: [newItem(11000232)] } });
    expect([...npcKind.items(doc).keys()]).toEqual(['11000230']);
    expect([...objectKind.items(doc).keys()]).toEqual(['11000231']);
    expect([...itemKind.items(doc).keys()]).toEqual(['11000232']);
  });
  it('see an edited field as a difference', () => {
    expect(npcKind.same(newNpc(1), { ...newNpc(1), name: 'Other' })).toBe(false);
    expect(npcKind.diff(newNpc(1), { ...newNpc(1), name: 'Other' }).map((d) => d.field)).toContain('name');
  });
  it('write replaces only its own list', () => {
    const doc = docOf({ entities: { npcs: [newNpc(1)], objects: [newObject(2)], items: [] } });
    const out = npcKind.write(doc, new Map());
    expect(out.entities.npcs).toEqual([]);
    expect(out.entities.objects).toHaveLength(1);
  });
});

describe('placed-spawn kind', () => {
  it('is keyed by kind and guid and points at its NPC or object', () => {
    const doc = docOf({ world: { spawns: [], routes: [], added: [placed(5, 77), placed(6, 88, 0, 'gameobject')] } });
    expect([...placedSpawnKind.items(doc).keys()]).toEqual(['creature:5', 'gameobject:6']);
    expect(placedSpawnKind.references!(placed(5, 77))).toEqual([{ kind: 'npc', key: '77' }]);
    expect(placedSpawnKind.references!(placed(6, 88, 0, 'gameobject'))).toEqual([{ kind: 'object', key: '88' }]);
  });
  it('sees a moved placement as a difference', () => {
    expect(placedSpawnKind.same(placed(5, 1, 0), placed(5, 1, 9))).toBe(false);
  });
});

describe('group kind', () => {
  const g = (id: number, members: any[]) => ({ id, name: 'g', map: 0, maxActive: 1, members, event: null, origin: { kind: 'new' } }) as never;
  it('is keyed by id and points at the spawns, groups and quests it holds', () => {
    const grp = g(3, [{ type: 'spawn', kind: 'npc', guid: 5, entry: 1, chance: 10 }, { type: 'spawn', kind: 'object', guid: 6, entry: 2, chance: 10 }, { type: 'group', id: 4, chance: 5 }, { type: 'quest', questId: 60001 }]);
    expect([...groupKind.items(docOf({ world: { spawns: [], routes: [], added: [], groups: [grp] } })).keys()]).toEqual(['3']);
    expect(groupKind.references!(grp)).toEqual([
      { kind: 'placed-spawn', key: 'creature:5' }, { kind: 'placed-spawn', key: 'gameobject:6' }, { kind: 'group', key: '4' }, { kind: 'quest', key: '60001' },
    ]);
  });
});

describe('registry', () => {
  it('lists every kind once, with distinct keys, in the documented order', () => {
    expect(MERGE_KINDS.map((k) => k.key)).toEqual(['quest', 'npc', 'object', 'item', 'placed-spawn', 'group', 'spawn-edit', 'route', 'movement', 'respawn', 'spawn-event', 'deleted-spawn']);
  });
  it('lets exactly the id-allocating kinds collide', () => {
    expect(MERGE_KINDS.filter((k) => k.canCollide).map((k) => k.key)).toEqual(['quest', 'npc', 'object', 'item', 'placed-spawn', 'group']);
  });
});
