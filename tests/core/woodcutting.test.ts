import { describe, expect, it } from 'vitest';
import { nearestTree, readWoodcuttingTrees, tiersOf } from '../../src/core/world/woodcutting';
import { forkDbWith } from '../helpers/fixtures';

/** A database with woodcutting trees as CoA ships them: a chest with the axe cursor, its loot a guaranteed log and a rare magical one */
function coaDb() {
  const db = forkDbWith(['gameobject_loot_template']);
  const tree = (entry: number, name: string, over: Record<string, string> = {}) =>
    db.insert('gameobject_template', { entry: String(entry), type: '3', displayId: '170000', name, IconName: 'AxeCursor', Data1: String(entry), ...over });
  const loot = (entry: number, item: number, chance: number, group = 0) =>
    db.insert('gameobject_loot_template', { Entry: String(entry), Item: String(item), Reference: '0', Chance: String(chance), GroupId: String(group), MinCount: '1', MaxCount: '3' });
  for (const [id, name] of [[8210210, 'Forestwood Log'], [8210211, 'Wildwood Log'], [8210213, 'Magical Green Wood Log']] as const) db.insert('item_template', { entry: String(id), name });
  tree(244614, 'Elwynn Tree');
  loot(244614, 8210210, 100);
  loot(244614, 8210213, 3, 1);
  tree(244616, 'Redridge Tree');
  loot(244616, 8210211, 100);
  loot(244616, 8210213, 8, 1);
  // A shared loot table, as a variant tree keeps: Data1 names another entry's loot
  tree(1244618, 'Wetlands Tree', { Data1: '244616' });
  return db;
}

describe('readWoodcuttingTrees', () => {
  it('finds the axe-cursor chests whose guaranteed loot is a log, with the tier that log names', async () => {
    const trees = await readWoodcuttingTrees(coaDb());
    expect(trees.map((t) => [t.entry, t.name, t.tier])).toEqual([
      [244614, 'Elwynn Tree', 'Forestwood'],
      [244616, 'Redridge Tree', 'Wildwood'],
      [1244618, 'Wetlands Tree', 'Wildwood'],
    ]);
  });

  it('ignores a chest with no axe cursor, one with no log to give, and a magical log that is only a chance', async () => {
    const db = coaDb();
    db.insert('gameobject_template', { entry: '500', type: '3', displayId: '1', name: 'Plain chest', IconName: '', Data1: '500' });
    db.insert('gameobject_loot_template', { Entry: '500', Item: '8210210', Reference: '0', Chance: '100', GroupId: '0', MinCount: '1', MaxCount: '1' });
    db.insert('gameobject_template', { entry: '501', type: '3', displayId: '1', name: 'Axe chest with coin', IconName: 'AxeCursor', Data1: '501' });
    db.insert('item_template', { entry: '6', name: 'Coin' });
    db.insert('gameobject_loot_template', { Entry: '501', Item: '6', Reference: '0', Chance: '100', GroupId: '0', MinCount: '1', MaxCount: '1' });
    db.insert('gameobject_template', { entry: '502', type: '3', displayId: '1', name: 'Axe chest, only luck', IconName: 'AxeCursor', Data1: '502' });
    db.insert('gameobject_loot_template', { Entry: '502', Item: '8210213', Reference: '0', Chance: '5', GroupId: '1', MinCount: '1', MaxCount: '1' });
    expect((await readWoodcuttingTrees(db)).map((t) => t.entry)).toEqual([244614, 244616, 1244618]);
  });

  it("ignores a quest's tree, whose log is only for the quest", async () => {
    const db = coaDb();
    db.insert('item_template', { entry: '662336', name: 'Frostpine Log' });
    db.insert('gameobject_template', { entry: '2300580', type: '3', displayId: '170005', name: 'Dun Morogh Tree', IconName: 'AxeCursor', Data1: '2300580' });
    db.insert('gameobject_loot_template', { Entry: '2300580', Item: '662336', Reference: '0', Chance: '100', QuestRequired: '1', GroupId: '0', MinCount: '1', MaxCount: '1' });
    expect((await readWoodcuttingTrees(db)).map((t) => t.entry)).toEqual([244614, 244616, 1244618]);
  });

  it('finds none in a database without them or without the loot table, so the menu has nothing to offer', async () => {
    expect(await readWoodcuttingTrees(forkDbWith(['gameobject_loot_template']))).toEqual([]);
    const db = coaDb();
    const missing = { ...db, columns: async (t: string) => (t === 'gameobject_loot_template' ? [] : db.columns(t)), selectRows: db.selectRows.bind(db), lookupNames: db.lookupNames.bind(db) };
    expect(await readWoodcuttingTrees(missing)).toEqual([]);
  });
});

describe('tiersOf', () => {
  it('groups trees by tier, the tiers in the order of their logs and the trees by name', async () => {
    const tiers = tiersOf(await readWoodcuttingTrees(coaDb()));
    expect(tiers.map((t) => [t.tier, t.trees.map((x) => x.name)])).toEqual([
      ['Forestwood', ['Elwynn Tree']],
      ['Wildwood', ['Redridge Tree', 'Wetlands Tree']],
    ]);
  });
});

describe('nearestTree', () => {
  const spots = [{ entry: 1, x: 0, y: 0 }, { entry: 2, x: 100, y: 0 }, { entry: 3, x: 1000, y: 0 }];
  it('is the entry of the nearest spawn', () => {
    expect(nearestTree(spots, { x: 90, y: 5 })).toBe(2);
    expect(nearestTree(spots, { x: -3, y: 0 })).toBe(1);
  });
  it('is null when nothing is within reach, or there is nothing', () => {
    expect(nearestTree(spots, { x: 5000, y: 0 })).toBeNull();
    expect(nearestTree([], { x: 0, y: 0 })).toBeNull();
  });
});
