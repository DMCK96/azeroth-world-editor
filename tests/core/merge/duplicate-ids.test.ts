import { describe, expect, it } from 'vitest';
import { newItem, newNpc, newObject, newSpawn, type CustomNpc } from '../../../src/core/entities/model';
import { applyMerge, previewMerge } from '../../../src/core/merge/build';
import { findDuplicateIds } from '../../../src/core/merge/duplicate-ids';
import { docOf, emptyDoc, placed } from './helpers';

const npc = (entry: number, name: string, part: Partial<CustomNpc> = {}): CustomNpc => ({ ...newNpc(entry), name, ...part });
const withNpcs = (...npcs: CustomNpc[]) => docOf({ entities: { npcs, objects: [], items: [] } });
const menu = (menuId: number, textId: number) => ({ menuId, textId, greeting: [{ text: 'hi', textFemale: '', probability: 100 }], options: [], locked: false });
const guidsOf = (d: ReturnType<typeof withNpcs>) => [...d.entities.npcs.flatMap((n) => n.spawns.map((s) => s.guid)), ...d.world.added.filter((a) => a.kind === 'creature').map((a) => a.guid)].sort((a, b) => a - b);

describe('findDuplicateIds', () => {
  it('names two NPC spawns at one guid', () => {
    const doc = withNpcs(npc(90001, 'Mine', { spawns: [newSpawn(500)] }), npc(90002, 'Theirs', { spawns: [newSpawn(500)] }));
    expect(findDuplicateIds(doc)).toEqual(['Creature spawn guid 500 is used by NPC 90001 Mine and NPC 90002 Theirs in the result']);
  });

  it('names a placed spawn sharing a guid with an NPC spawn, per scope', () => {
    const doc = docOf({
      entities: { npcs: [npc(90001, 'Mine', { spawns: [newSpawn(500)] })], objects: [{ ...newObject(90003), name: 'Box', spawns: [newSpawn(500)] }], items: [] },
      world: { spawns: [], routes: [], added: [placed(500, 1)] },
    });
    expect(findDuplicateIds(doc)).toEqual(['Creature spawn guid 500 is used by NPC 90001 Mine and n500 (creature 500) placed in the result']);
  });

  it('names a trainer id, a gossip menu id, a gossip text id and a page id two things hold', () => {
    const trainer = (trainerId: number) => ({ trainerId, type: 'class' as const, requirement: 0, greeting: '', spells: [] });
    const doc = docOf({
      entities: {
        npcs: [
          npc(1, 'A', { trainer: trainer(7), gossipMenu: { menus: [menu(100, 200)] } }),
          npc(2, 'B', { trainer: trainer(7), gossipMenu: { menus: [menu(100, 200)] } }),
        ],
        objects: [{ ...newObject(3), name: 'Book', pages: [{ id: 40, text: 'a' }] }],
        items: [{ ...newItem(4), name: 'Letter', pages: [{ id: 40, text: 'b' }] }],
      },
    });
    expect(findDuplicateIds(doc)).toEqual([
      'Trainer id 7 is used by NPC 1 A and NPC 2 B in the result',
      'Gossip menu id 100 is used by NPC 1 A and NPC 2 B in the result',
      'Gossip text id 200 is used by NPC 1 A and NPC 2 B in the result',
      'Page id 40 is used by Object 3 Book and Item 4 Letter in the result',
    ]);
  });

  it('names a path id two patrols, or a patrol and another spawn\'s movement, use', () => {
    const patrol = (pathId: number) => ({ pathId, startPace: 'walk' as const, points: [] });
    const movement = { guid: 900, entry: 5, name: 'Wolf', map: 0, addonRow: false, original: { type: 0, wander: 0, pathId: null }, current: { type: 2, wander: 0, pathId: 5000 } } as never;
    const doc = docOf({
      entities: { npcs: [npc(1, 'A', { spawns: [{ ...newSpawn(500), patrol: patrol(5000) }] }), npc(2, 'B', { spawns: [{ ...newSpawn(501), patrol: patrol(5000) }] })], objects: [], items: [] },
      world: { spawns: [], routes: [], added: [], movements: [movement] },
    });
    expect(findDuplicateIds(doc)).toEqual(['Path id 5000 is used by NPC 1 A\'s spawn 500, NPC 2 B\'s spawn 501 and Wolf (900) movement in the result']);
  });

  it('does not count a route and the movement that walks it as two holders', () => {
    const movement = { guid: 900, entry: 5, name: 'Wolf', map: 0, addonRow: false, original: { type: 0, wander: 0, pathId: null }, current: { type: 2, wander: 0, pathId: 9000 } } as never;
    const route = { pathId: 9000, walkers: 1, original: [], current: [{ x: 0, y: 0, z: 0, rest: {} }] };
    expect(findDuplicateIds(docOf({ world: { spawns: [], routes: [route], added: [], movements: [movement] } }))).toEqual([]);
  });

  it('leaves alone an id two existing NPCs share in the database', () => {
    const existing = (entry: number) => ({
      kind: 'existing' as const, original: { creature_default_trainer: [{ CreatureId: String(entry), TrainerId: '7' }] }, sharedLoot: 0, spawnCount: 0, sharedTrainer: 1, locked: ['trainer' as const],
    });
    const trainer = { trainerId: 7, type: 'class' as const, requirement: 0, greeting: '', spells: [] };
    const doc = withNpcs(npc(1, 'A', { trainer, origin: existing(1) }), npc(2, 'B', { trainer, origin: existing(2) }));
    expect(findDuplicateIds(doc)).toEqual([]);
  });
});

describe('merging ids allocated inside NPCs and objects', () => {
  it('keeps both NPCs that took the same entry and spawn guid, moving theirs to a free guid', () => {
    const inputs = { base: emptyDoc(), mine: withNpcs(npc(90001, 'Mine', { spawns: [newSpawn(500)] })), theirs: withNpcs(npc(90001, 'Theirs', { spawns: [newSpawn(500)] })) };
    const out = applyMerge(inputs, {});
    expect(out.entities.npcs.map((n) => [n.entry, n.name, n.spawns[0]!.guid])).toEqual([[90001, 'Mine', 500], [90002, 'Theirs', 501]]);
    const preview = previewMerge(inputs, {});
    expect(preview.warnings.filter((w) => /is used by/.test(w))).toEqual([]);
    expect(preview.warnings).toContain('Their NPC 90002 Theirs spawn at guid 500 moves to guid 501, as mine uses 500');
    expect(preview.dropped).toEqual([]);
  });

  it('moves a placed spawn of theirs off a guid mine\'s NPC spawn uses', () => {
    const mine = withNpcs(npc(90001, 'Mine', { spawns: [newSpawn(500)] }));
    const theirs = docOf({ world: { spawns: [], routes: [], added: [placed(500, 1)] } });
    const out = applyMerge({ base: emptyDoc(), mine, theirs }, {});
    expect(guidsOf(out)).toEqual([500, 501]);
    expect(out.world.added[0]!.guid).toBe(501);
    expect(previewMerge({ base: emptyDoc(), mine, theirs }, {}).warnings.filter((w) => /is used by/.test(w))).toEqual([]);
  });

  it('leaves an NPC both sides kept from the base at its own guids', () => {
    const shared = npc(90001, 'Old', { spawns: [newSpawn(500)] });
    const base = withNpcs(shared);
    const out = applyMerge({ base, mine: withNpcs({ ...shared, name: 'Renamed' }), theirs: withNpcs({ ...shared, spawns: [newSpawn(500), newSpawn(502)] }) }, { 'npc|90001': 'theirs' });
    expect(out.entities.npcs[0]!.spawns.map((s) => s.guid)).toEqual([500, 502]);
  });

  it('warns about a gossip menu both NPCs took', () => {
    const inputs = {
      base: emptyDoc(),
      mine: withNpcs(npc(90001, 'Mine', { gossipMenu: { menus: [menu(100, 200)] } })),
      theirs: withNpcs(npc(90001, 'Theirs', { gossipMenu: { menus: [menu(100, 201)] } })),
    };
    expect(previewMerge(inputs, {}).warnings).toContain('Gossip menu id 100 is used by NPC 90001 Mine and NPC 90002 Theirs in the result');
  });
});
