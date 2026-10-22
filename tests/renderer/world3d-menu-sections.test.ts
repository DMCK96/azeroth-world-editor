// tests/renderer/world3d-menu-sections.test.ts
import { describe, expect, it } from 'vitest';
import { buildMenu, type MenuSection } from '../../src/renderer/world3d/menu/section';
import { SECTIONS } from '../../src/renderer/world3d/menu/sections';
import { subjectOf, type MenuSubject } from '../../src/renderer/world3d/menu/subject';
import type { MenuContext, MenuItem, MenuSpawn, MenuTarget } from '../../src/renderer/world3d/menu/model';
import { EMPTY_ENTITIES, newNpc, newObject, newSpawn, type ProjectEntities } from '../../src/core/entities/model';

const at = { x: 1, y: 2, z: 3 };
const npc = (over: Partial<MenuSpawn> = {}): MenuSpawn => ({ kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', own: false, added: false, pathId: 0, wander: 0, map: 0,
  placement: { x: 1, y: 2, z: 3, orientation: 0, rotation: null }, group: null, ...over }) as MenuSpawn;
const crate = (over: Partial<MenuSpawn> = {}): MenuSpawn => npc({ kind: 'object', guid: 5, entry: 143981, name: 'Crate', ...over });
const hela = npc({ guid: 6000001, entry: 12000001, name: 'Hela', own: true });
const chest = crate({ guid: 7000001, entry: 9100001, own: true });
const store: ProjectEntities = { ...EMPTY_ENTITIES, npcs: [{ ...newNpc(12000001), name: 'Hela' }], objects: [{ ...newObject(9100001), name: 'Crate' }] };
const context = (over: Partial<MenuContext> = {}): MenuContext => ({ map: 0, connected: true, clipboard: { count: 0, blocked: null }, placing: false, drawing: null, quest: null, project: true, marked: false, vessel: false, woodcutting: [], ...over });
const ground = (selection: MenuSpawn[] = []): MenuSubject => subjectOf({ ground: at, hit: null, selection }, store);
const sky: MenuSubject = subjectOf({ ground: null, hit: null, selection: [] }, store);
const on = (spawn: MenuSpawn, s: ProjectEntities = store): MenuSubject => subjectOf({ ground: at, hit: { type: 'spawn', spawn }, selection: [spawn] } as MenuTarget, s);
const quest = { id: 60001, title: 'Wolves', roles: { givers: [{ kind: 'creature' as const, id: 1423 }], enders: [], objectives: [null, null, null, null] }, chained: true };

const all = (items: MenuItem[]): MenuItem[] => items.flatMap((i) => [i, ...all(i.children ?? [])]);
const flat = (groups: ReturnType<typeof buildMenu>): MenuItem[] => all(groups.flatMap((g) => g.items));
const item = (groups: ReturnType<typeof buildMenu>, label: string) => flat(groups).find((i) => i.label === label);
const labels = (groups: ReturnType<typeof buildMenu>) => groups.map((g) => [g.id, g.items.map((i) => i.label)]);

describe('a vessel under the right-click', () => {
  it('offers its stops on the ground and on a passenger, and not elsewhere', () => {
    const vessel = { dock: null };
    const withVessel = (hit: MenuTarget['hit']) => subjectOf({ ground: at, hit, selection: [], vessel }, store);
    expect(item(buildMenu(withVessel(null), context()), 'Show stops…')?.action).toEqual({ kind: 'vesselStops', dock: null });
    expect(item(buildMenu(withVessel({ type: 'spawn', spawn: npc() }), context()), 'Show stops…')).toBeDefined();
    expect(item(buildMenu(ground(), context()), 'Show stops…')).toBeUndefined();
    expect(item(buildMenu(withVessel(null), context({ placing: true })), 'Show stops…')).toBeUndefined();
  });
});

describe('woodcutting trees on the ground', () => {
  const tree = (entry: number, name: string, tier: string, tierRank: number) => ({ entry, name, tier, tierRank });
  const trees = [tree(244616, 'Redridge Tree', 'Wildwood', 8210211), tree(244614, 'Elwynn Tree', 'Forestwood', 8210210), tree(1244636, 'Stonetalon Tree', 'Wildwood', 8210211), tree(244636, 'Stonetalon Tree', 'Wildwood', 8210211)];

  it('offers nothing in a database without them', () => {
    expect(flat(buildMenu(ground(), context())).filter((i) => /tree/i.test(i.label))).toEqual([]);
  });

  it('offers nothing offline, and nothing while placing', () => {
    expect(flat(buildMenu(ground(), context({ woodcutting: trees, connected: false }))).filter((i) => /tree/i.test(i.label))).toEqual([]);
    expect(flat(buildMenu(ground(), context({ woodcutting: trees, placing: true }))).filter((i) => /tree/i.test(i.label))).toEqual([]);
  });

  it('puts the nearest tree here, or lists every tree by tier, then by name', () => {
    const groups = buildMenu(ground(), context({ woodcutting: trees }));
    expect(item(groups, 'Spawn woodcutting tree here')!.action).toEqual({ kind: 'placeNearestTree', at });
    const submenu = item(groups, 'Woodcutting tree')!;
    expect(submenu.action).toBeUndefined();
    expect(submenu.children!.map((tier) => [tier.label, tier.children!.map((t) => t.label)])).toEqual([
      ['Forestwood', ['Elwynn Tree']],
      ['Wildwood', ['Redridge Tree', 'Stonetalon Tree', 'Stonetalon Tree']],
    ]);
    const stonetalon = submenu.children![1]!.children!.filter((t) => t.label === 'Stonetalon Tree');
    expect(stonetalon.map((t) => t.action)).toEqual([{ kind: 'placeTree', entry: 244636, name: 'Stonetalon Tree', at }, { kind: 'placeTree', entry: 1244636, name: 'Stonetalon Tree', at }]);
    // Two trees of one name stay apart by their entry
    expect(stonetalon.map((t) => t.hint)).toEqual(['244636', '1244636']);
    expect(new Set(all(submenu.children!).map((i) => i.id)).size).toBe(all(submenu.children!).length);
  });

  it('the sky disables them', () => {
    const groups = buildMenu(sky, context({ woodcutting: trees }));
    expect(item(groups, 'Spawn woodcutting tree here')!.disabledReason).toBe('Right-click the ground');
    expect(item(groups, 'Woodcutting tree')!.disabledReason).toBe('Right-click the ground');
  });
});

describe('a route point', () => {
  const point = (guid: number, s: ProjectEntities = store): MenuSubject => subjectOf({ ground: at, hit: { type: 'point', guid, index: 2 }, selection: [] }, s);
  const patrolled: ProjectEntities = { ...store, npcs: [{ ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(6000001) }] }] };

  it('offers its settings, for the point right-clicked', () => {
    expect(item(buildMenu(point(80330), context()), 'Point settings…')!.action).toEqual({ kind: 'pointSettings', guid: 80330, index: 2 });
  });

  it("of a route the database has needs the world database; a project NPC's patrol does not", () => {
    expect(item(buildMenu(point(80330), context({ connected: false })), 'Point settings…')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(point(6000001, patrolled), context({ connected: false })), 'Point settings…')!.action).toBeDefined();
  });

  it('is not offered while placing', () => {
    expect(item(buildMenu(point(80330), context({ placing: true })), 'Point settings…')).toBeUndefined();
  });
});

describe('the builder', () => {
  it('registers the sections in the spec order', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['busy', 'create', 'woodcutting', 'edit', 'loot', 'vendor', 'trainer', 'gossip', 'scripts', 'clipboard', 'coordinates', 'respawn', 'spawn-events', 'spawn-group', 'delete', 'movement', 'route-point', 'quest-parts', 'quest-spawns', 'vessel-stops']);
  });

  it('runs only sections that apply, joins those of one group, and drops empty groups', () => {
    const always: MenuSection = { id: 'a', group: 'world', appliesTo: (s): s is MenuSubject => true, items: () => [{ id: 'one', label: 'One' }] };
    const never: MenuSection = { id: 'b', group: 'quest', appliesTo: (s): s is MenuSubject => false, items: () => [{ id: 'two', label: 'Two' }] };
    const empty: MenuSection = { id: 'c', group: 'movement', appliesTo: (s): s is MenuSubject => true, items: () => [] };
    const also: MenuSection = { id: 'd', group: 'world', appliesTo: (s): s is MenuSubject => true, items: () => [{ id: 'three', label: 'Three' }] };
    expect(labels(buildMenu(ground(), context(), [always, never, empty, also]))).toEqual([['world', ['One', 'Three']]]);
  });

  it('while a path is drawn, offers only the busy group', () => {
    const groups = buildMenu(ground([npc()]), context({ drawing: { guid: 80330, points: 2 } }));
    expect(labels(groups)).toEqual([['busy', ['Finish path', 'Undo last point', 'Cancel path']]]);
  });

  it('while placing, Stop placing comes first', () => {
    expect(buildMenu(ground(), context({ placing: true }))[0]).toEqual({ id: 'busy', items: [{ id: 'stop-placing', label: 'Stop placing', action: { kind: 'stopPlacing' } }] });
  });
});

describe('the ground', () => {
  it('offers placing, creating, paste and coordinates, and no quest group without a quest', () => {
    expect(labels(buildMenu(ground(), context()))).toEqual([
      ['world', ['Place NPC here…', 'Place object here…', 'New NPC here…', 'New object here…', 'Paste here', 'Copy coordinates']],
    ]);
    expect(item(buildMenu(ground(), context()), 'New NPC here…')!.action).toEqual({ kind: 'newEntity', what: 'creature', at });
    expect(item(buildMenu(ground(), context()), 'Paste here')!.disabledReason).toBe('Copy something first');
  });

  it('pastes what was copied, with a count', () => {
    expect(item(buildMenu(ground(), context({ clipboard: { count: 3, blocked: null } })), 'Paste here (3)')!.action).toEqual({ kind: 'paste', at });
  });

  it('the sky disables what needs the ground', () => {
    const groups = buildMenu(sky, context({ clipboard: { count: 1, blocked: null } }));
    for (const label of ['Place NPC here…', 'Place object here…', 'New NPC here…', 'New object here…', 'Paste here (1)', 'Copy coordinates']) {
      expect(item(groups, label)!.disabledReason).toBe('Right-click the ground');
    }
  });

  it('offline, placing and creating say they need the database', () => {
    const groups = buildMenu(ground(), context({ connected: false }));
    expect(item(groups, 'Place NPC here…')!.disabledReason).toBe('Needs the world database');
    expect(item(groups, 'New object here…')!.disabledReason).toBe('Needs the world database');
  });

  it('with one NPC selected and no path, offers to start its path here', () => {
    expect(item(buildMenu(ground([npc()]), context()), 'Start path here')!.action).toEqual({ kind: 'startPath', spawn: npc(), at });
    expect(item(buildMenu(ground([npc({ pathId: 801 })]), context()), 'Start path here')).toBeUndefined();
    expect(item(buildMenu(ground([npc(), npc({ guid: 2 })]), context()), 'Start path here')).toBeUndefined();
    expect(item(buildMenu(ground([npc()]), context({ connected: false })), 'Start path here')!.disabledReason).toBe('Needs the world database');
  });

  it('with a quest open: its spawns to show and hide, and nothing quest-flavoured to create', () => {
    expect(labels(buildMenu(ground(), context({ quest }))).find(([id]) => id === 'quest')).toEqual(['quest', ['Show quest spawns', 'Show chain spawns']]);
    expect(item(buildMenu(ground(), context({ quest: { ...quest, chained: false } })), 'Show chain spawns')).toBeUndefined();
    expect(item(buildMenu(ground(), context({ quest, marked: true })), 'Hide quest spawns')!.action).toEqual({ kind: 'hideSpawns' });
  });
});

describe('a spawn', () => {
  it('a database NPC can be edited too; offline it needs the database', () => {
    const world = buildMenu(on(npc()), context()).find((g) => g.id === 'world')!;
    expect(world.items.map((i) => i.label)).toEqual(['Edit NPC…', 'Make vendor…', 'Make trainer…', 'Add gossip menu…', 'Add or edit scripts…', 'Copy', 'Duplicate', 'Copy coordinates', 'Respawn time…', 'Event…', 'Delete']);
    expect(item(buildMenu(on(npc()), context({ connected: false })), 'Edit NPC…')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(on(hela), context({ connected: false })), 'Edit NPC…')!.action).toBeDefined();
  });

  it('a project NPC: edit first, and delete last', () => {
    const world = buildMenu(on(hela), context()).find((g) => g.id === 'world')!;
    expect(world.items.map((i) => i.label)).toEqual(['Edit NPC…', 'Make vendor…', 'Make trainer…', 'Add gossip menu…', 'Add script…', 'Copy', 'Duplicate', 'Copy coordinates', 'Respawn time…', 'Event…', 'Delete']);
    expect(item(buildMenu(on(hela), context()), 'Edit NPC…')!.action).toEqual({ kind: 'editEntity', spawn: hela });
  });

  it('a database NPC or object can be deleted, and so can a spawn placed in the view', () => {
    expect(item(buildMenu(on(npc()), context()), 'Delete')!.action).toEqual({ kind: 'delete', spawns: [npc()] });
    expect(item(buildMenu(on(crate()), context()), 'Delete')!.action).toEqual({ kind: 'delete', spawns: [crate()] });
    expect(item(buildMenu(on(npc({ added: true })), context()), 'Delete')!.action).toEqual({ kind: 'delete', spawns: [npc({ added: true })] });
  });

  it('deletes the whole selection when the right-clicked spawn is part of it, and names how many', () => {
    const groups = buildMenu(subjectOf({ ground: at, hit: { type: 'spawn', spawn: npc() }, selection: [npc(), crate()] }, store), context());
    expect(item(groups, 'Delete 2')!.action).toEqual({ kind: 'delete', spawns: [npc(), crate()] });
  });

  it("offline, deleting a database spawn needs the world database, a project's own or a placed one does not", () => {
    expect(item(buildMenu(on(npc()), context({ connected: false })), 'Delete')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(on(hela), context({ connected: false })), 'Delete')!.action).toBeDefined();
    expect(item(buildMenu(on(npc({ added: true })), context({ connected: false })), 'Delete')!.action).toBeDefined();
  });

  it('is not offered on the ground', () => {
    expect(item(buildMenu(ground(), context()), 'Delete')).toBeUndefined();
  });

  it('copies a whole selection and names how many', () => {
    const groups = buildMenu(subjectOf({ ground: at, hit: { type: 'spawn', spawn: npc() }, selection: [npc(), crate()] }, store), context());
    expect(item(groups, 'Copy 2')!.action).toEqual({ kind: 'copy' });
    expect(item(groups, 'Duplicate 2')!.action).toEqual({ kind: 'duplicate' });
  });

  it('a project object offers Make lootable, or Stop being lootable when it is a chest', () => {
    expect(item(buildMenu(on(chest), context()), 'Make lootable…')!.action).toEqual({ kind: 'setLootable', spawn: chest, on: true });
    const chestStore = { ...store, objects: [{ ...store.objects[0]!, type: 'chest' as const }] };
    expect(item(buildMenu(on(chest, chestStore), context()), 'Stop being lootable')!.action).toEqual({ kind: 'setLootable', spawn: chest, on: false });
    expect(item(buildMenu(on(crate()), context()), 'Make lootable…')).toBeUndefined();
  });

  it('a database chest or usable object offers loot by its template type, and needs the database until the project holds it', () => {
    const dbChest = crate({ objectType: 3 });
    const dbGoober = crate({ objectType: 10 });
    expect(item(buildMenu(on(dbChest), context()), 'Stop being lootable')!.action).toEqual({ kind: 'setLootable', spawn: dbChest, on: false });
    expect(item(buildMenu(on(dbGoober), context()), 'Make lootable…')!.action).toEqual({ kind: 'setLootable', spawn: dbGoober, on: true });
    const offline = item(buildMenu(on(dbGoober), context({ connected: false })), 'Make lootable…')!;
    expect(offline.disabledReason).toBe('Needs the world database');
    expect(offline.action).toBeUndefined();
    expect(item(buildMenu(on(crate({ objectType: 19 })), context()), 'Make lootable…')).toBeUndefined();
    // A project object is changed in the project alone: offline is fine
    expect(item(buildMenu(on(chest), context({ connected: false })), 'Make lootable…')!.action).toEqual({ kind: 'setLootable', spawn: chest, on: true });
  });

  it('an NPC: wander, and remove path only when it walks one; an object has no movement', () => {
    expect(item(buildMenu(on(npc()), context()), 'Change wander distance…')!.action).toEqual({ kind: 'wander', spawn: npc() });
    expect(item(buildMenu(on(npc()), context()), 'Remove path')).toBeUndefined();
    const walking = buildMenu(on(npc({ pathId: 801 })), context());
    expect(item(walking, 'Change wander distance…')!.disabledReason).toBe('Walks a path: remove the path first');
    expect(item(walking, 'Remove path')!.action).toEqual({ kind: 'removePath', spawn: npc({ pathId: 801 }) });
    expect(buildMenu(on(crate()), context()).map((g) => g.id)).not.toContain('movement');
  });

  it('on a vessel: a passenger\'s walking path is neither started nor removed (it is not drawn there yet)', () => {
    const reason = "Paths on a ship or zeppelin can't be edited yet";
    expect(item(buildMenu(ground([npc()]), context({ vessel: true })), 'Start path here')!.disabledReason).toBe(reason);
    expect(item(buildMenu(on(npc({ pathId: 801 })), context({ vessel: true })), 'Remove path')!.disabledReason).toBe(reason);
    expect(item(buildMenu(on(npc()), context({ vessel: true })), 'Change wander distance…')!.action).toEqual({ kind: 'wander', spawn: npc() });
  });

  it('offline: a database NPC\'s movement needs the database, a project NPC\'s does not', () => {
    expect(item(buildMenu(on(npc()), context({ connected: false })), 'Change wander distance…')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(on(hela), context({ connected: false })), 'Change wander distance…')!.action).toBeDefined();
  });

  it('Quests ▸ sets or removes the spawn\'s parts in the open quest and starts quests from an NPC', () => {
    const groups = buildMenu(on(npc()), context({ quest }));
    expect(groups.find((g) => g.id === 'quest')!.items.map((i) => [i.label, i.children?.map((c) => c.label)])).toEqual([
      ['Quests', ['Remove as quest giver', 'Set as quest ender', 'Add as kill objective', 'Find quests that start or end here…', 'Start a new quest from this NPC', 'Start the next quest in this chain']],
    ]);
    expect(item(groups, 'Set as quest ender')!.action).toEqual({ kind: 'toggleRole', role: 'ender', spawn: npc(), on: true });
    expect(item(buildMenu(on(crate()), context({ quest })), 'Add as use objective')).toBeDefined();
    const full = { ...quest, roles: { ...quest.roles, objectives: [1, 2, 3, 4].map((id) => ({ kind: 'creature' as const, id })) } };
    expect(item(buildMenu(on(npc()), context({ quest: full })), 'Add as kill objective')!.disabledReason).toBe('All four objectives are in use');
  });

  it('without a quest an NPC still starts one; an object has no Quests submenu; no project, none at all', () => {
    expect(item(buildMenu(on(npc()), context()), 'Start a new quest from this NPC')!.action).toEqual({ kind: 'newQuest', spawn: npc(), after: false });
    expect(item(buildMenu(on(npc()), context()), 'Start the next quest in this chain')).toBeUndefined();
    expect(buildMenu(on(crate()), context()).map((g) => g.id)).not.toContain('quest');
    expect(item(buildMenu(on(npc()), context({ project: false, connected: false })), 'Quests')).toBeUndefined();
  });

  it('an NPC can be asked which quests start or end at it while the database is there', () => {
    const find = item(buildMenu(on(npc()), context({ project: false })), 'Find quests that start or end here…');
    expect(find!.action).toEqual({ kind: 'findQuests', spawn: npc() });
    expect(item(buildMenu(on(crate()), context()), 'Find quests that start or end here…')).toBeUndefined();
    expect(item(buildMenu(on(npc()), context({ connected: false })), 'Find quests that start or end here…')).toBeUndefined();
  });
});

describe('respawn time', () => {
  it('on a spawn, or a selection, opens the respawn dialog for them', () => {
    expect(item(buildMenu(on(npc()), context()), 'Respawn time…')!.action).toEqual({ kind: 'respawn', spawns: [npc()] });
    const both = subjectOf({ ground: at, hit: { type: 'spawn', spawn: npc() }, selection: [npc(), crate()] }, store);
    expect(item(buildMenu(both, context()), 'Respawn time of 2 spawns…')!.action).toEqual({ kind: 'respawn', spawns: [npc(), crate()] });
    expect(item(buildMenu(ground([npc()]), context()), 'Respawn time…')!.action).toEqual({ kind: 'respawn', spawns: [npc()] });
  });

  it('offline, a database spawn needs the database; a project one does not', () => {
    expect(item(buildMenu(on(npc()), context({ connected: false })), 'Respawn time…')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(on(hela), context({ connected: false })), 'Respawn time…')!.action).toBeDefined();
  });
});

describe('a route point', () => {
  it('copies its coordinates, or says to right-click the ground', () => {
    const point = (ground: typeof at | null) => subjectOf({ ground, hit: { type: 'point', guid: 80330, index: 1 }, selection: [] }, store);
    expect(labels(buildMenu(point(at), context()))).toEqual([['world', ['Copy coordinates']], ['movement', ['Point settings…']]]);
    expect(item(buildMenu(point(null), context()), 'Copy coordinates')!.disabledReason).toBe('Right-click the ground');
  });
});

describe('cases carried over from the old builders', () => {
  it('a paste blocked here says why', () => {
    expect(item(buildMenu(ground(), context({ clipboard: { count: 1, blocked: 'Not on this map' } })), 'Paste here (1)')!.disabledReason).toBe('Not on this map');
  });

  it('a project object is edited as an object', () => {
    expect(item(buildMenu(on(chest), context()), 'Edit object…')!.action).toEqual({ kind: 'editEntity', spawn: chest });
  });

  it('chain spawns are shown by scope, and the next quest in the chain starts after this one', () => {
    expect(item(buildMenu(ground(), context({ quest })), 'Show chain spawns')!.action).toEqual({ kind: 'showSpawns', scope: 'chain' });
    expect(item(buildMenu(on(npc()), context({ quest })), 'Start the next quest in this chain')!.action).toEqual({ kind: 'newQuest', spawn: npc(), after: true });
  });
});

describe('spawn groups', () => {
  it('groups several selected spawns', () => {
    const both = subjectOf({ ground: at, hit: { type: 'spawn', spawn: npc() }, selection: [npc(), npc({ guid: 2 })] }, store);
    expect(item(buildMenu(both, context()), 'Group these spawns…')!.action).toEqual({ kind: 'groupSpawns', spawns: [npc(), npc({ guid: 2 })] });
    expect(item(buildMenu(on(npc()), context()), 'Group these spawns…')).toBeUndefined();
    expect(item(buildMenu(ground([npc(), npc({ guid: 2 })]), context()), 'Group these spawns…')).toBeDefined();
  });

  it('a pooled spawn has Spawn group ▸ edit, show and leave', () => {
    const pooled = npc({ group: 32492 } as any);
    const groups = buildMenu(on(pooled), context());
    expect(item(groups, 'Spawn group')!.children!.map((c) => c.label)).toEqual(['Edit group…', 'Show group', 'Remove from group']);
    expect(item(groups, 'Edit group…')!.action).toEqual({ kind: 'editGroup', id: 32492 });
    expect(item(groups, 'Remove from group')!.action).toEqual({ kind: 'leaveGroup', spawn: pooled });
  });

  it('offline, groups need the database', () => {
    const both = subjectOf({ ground: at, hit: { type: 'spawn', spawn: npc() }, selection: [npc(), npc({ guid: 2 })] }, store);
    expect(item(buildMenu(both, context({ connected: false })), 'Group these spawns…')!.disabledReason).toBe('Needs the world database');
  });
});

describe('spawn events', () => {
  it('on an NPC, or the NPCs of a selection, opens the event dialog; objects are left out', () => {
    expect(item(buildMenu(on(npc()), context()), 'Event…')!.action).toEqual({ kind: 'spawnEvents', spawns: [npc()] });
    const both = subjectOf({ ground: at, hit: { type: 'spawn', spawn: npc() }, selection: [npc(), npc({ guid: 80331 }), crate()] }, store);
    expect(item(buildMenu(both, context()), 'Event of 2 spawns…')!.action).toEqual({ kind: 'spawnEvents', spawns: [npc(), npc({ guid: 80331 })] });
    expect(item(buildMenu(on(crate()), context()), 'Event…')).toBeUndefined();
  });

  it('offline, a database spawn needs the database; a project one does not', () => {
    expect(item(buildMenu(on(npc()), context({ connected: false })), 'Event…')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(on(hela), context({ connected: false })), 'Event…')!.action).toBeDefined();
  });
});

describe('the vendor section', () => {
  const stock = { item: 1, maxCount: 0, restockSecs: 0, extendedCost: 0 };
  const vendorStore: ProjectEntities = { ...store, npcs: [{ ...newNpc(12000001), name: 'Hela', vendor: [stock, { ...stock, item: 2 }] }] };
  const oneStore: ProjectEntities = { ...store, npcs: [{ ...newNpc(12000001), name: 'Hela', vendor: [stock] }] };

  it('offers Make vendor… on an NPC without stock, opening the Vendor tab', () => {
    const entry = item(buildMenu(on(hela), context()), 'Make vendor…')!;
    expect(entry.action).toEqual({ kind: 'editEntity', spawn: hela, tab: 'vendor' });
    expect(entry.hint).toBeUndefined();
  });
  it('offers Edit vendor stock… with the count on a project NPC that has stock', () => {
    expect(item(buildMenu(on(hela, vendorStore), context()), 'Edit vendor stock…')!.hint).toBe('2 items');
    expect(item(buildMenu(on(hela, oneStore), context()), 'Edit vendor stock…')!.hint).toBe('1 item');
    expect(item(buildMenu(on(hela, vendorStore), context()), 'Make vendor…')).toBeUndefined();
  });
  it('reads a database NPC the project has not opened from its flags', () => {
    expect(item(buildMenu(on(npc({ npcFlags: 129 })), context()), 'Edit vendor stock…')!.hint).toBeUndefined();
    expect(item(buildMenu(on(npc({ npcFlags: 129 })), context()), 'Make vendor…')).toBeUndefined();
    expect(item(buildMenu(on(npc({ npcFlags: 1 })), context()), 'Make vendor…')).toBeDefined();
    expect(item(buildMenu(on(npc()), context()), 'Make vendor…')).toBeDefined();
  });
  it('needs the world database for a database NPC, not for a project one', () => {
    expect(item(buildMenu(on(npc()), context({ connected: false })), 'Make vendor…')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(on(hela), context({ connected: false })), 'Make vendor…')!.action).toBeDefined();
  });
  it('is not offered on an object', () => {
    expect(item(buildMenu(on(chest), context()), 'Make vendor…')).toBeUndefined();
  });
  it('waits while an AI client writes', async () => {
    const { editsProject } = await import('../../src/renderer/world3d/menu/model');
    expect(editsProject({ kind: 'editEntity', spawn: hela, tab: 'vendor' })).toBe(true);
  });
});

describe('the trainer section', () => {
  const lesson = { spell: 78, cost: 0, reqLevel: 0, reqSkill: 0, reqSkillRank: 0, reqSpells: [] };
  const taught = (n: number): ProjectEntities => ({ ...store, npcs: [{ ...newNpc(12000001), name: 'Hela', trainer: { trainerId: 900033, type: 'class', requirement: 1, greeting: '', spells: Array.from({ length: n }, () => lesson) } }] });

  it('offers Make trainer… on an NPC that teaches nothing, opening the Trainer tab', () => {
    const entry = item(buildMenu(on(hela), context()), 'Make trainer…')!;
    expect(entry.action).toEqual({ kind: 'editEntity', spawn: hela, tab: 'trainer' });
    expect(entry.hint).toBeUndefined();
  });
  it('offers Edit trainer spells… with the count on a project trainer', () => {
    expect(item(buildMenu(on(hela, taught(2)), context()), 'Edit trainer spells…')!.hint).toBe('2 spells');
    expect(item(buildMenu(on(hela, taught(1)), context()), 'Edit trainer spells…')!.hint).toBe('1 spell');
    expect(item(buildMenu(on(hela, taught(0)), context()), 'Edit trainer spells…')!.hint).toBeUndefined();
    expect(item(buildMenu(on(hela, taught(2)), context()), 'Make trainer…')).toBeUndefined();
  });
  it('reads an unopened database NPC from the trainer bit of its flags', () => {
    expect(item(buildMenu(on(npc({ npcFlags: 51 })), context()), 'Edit trainer spells…')!.hint).toBeUndefined();
    expect(item(buildMenu(on(npc({ npcFlags: 129 })), context()), 'Make trainer…')).toBeDefined();
    expect(item(buildMenu(on(npc()), context()), 'Make trainer…')).toBeDefined();
  });
  it('needs the world database for a database NPC, not for a project one; not on objects', () => {
    expect(item(buildMenu(on(npc()), context({ connected: false })), 'Make trainer…')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(on(hela), context({ connected: false })), 'Make trainer…')!.action).toBeDefined();
    expect(item(buildMenu(on(chest), context()), 'Make trainer…')).toBeUndefined();
  });
  it('a trainer the project never read falls back to the flags', () => {
    const unread = { ...store, npcs: [{ ...newNpc(1423), origin: { kind: 'existing' as const, original: {}, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] } }] };
    expect(item(buildMenu(on(npc({ npcFlags: 51 }), unread), context()), 'Edit trainer spells…')).toBeDefined();
    expect(item(buildMenu(on(npc({ npcFlags: 3 }), unread), context()), 'Make trainer…')).toBeDefined();
  });
});

describe('the gossip section', () => {
  const option = (id: number) => ({ optionId: id, icon: 0, text: 'Bye', action: { kind: 'close' as const }, kept: false });
  const menu = (menuId: number, options: number) => ({ menuId, textId: menuId + 1, locked: false, greeting: [{ text: 'Hi', textFemale: '', probability: 1 }], options: Array.from({ length: options }, (_, i) => option(i)) });
  const talking = (...counts: number[]): ProjectEntities => ({ ...store, npcs: [{ ...newNpc(12000001), name: 'Hela', gossipMenu: { menus: counts.map((n, i) => menu(100 + i, n)) } }] });

  it('offers Add gossip menu… on an NPC without one, opening the Gossip tab', () => {
    const entry = item(buildMenu(on(hela), context()), 'Add gossip menu…')!;
    expect(entry.action).toEqual({ kind: 'editEntity', spawn: hela, tab: 'gossip' });
    expect(entry.hint).toBeUndefined();
  });
  it('offers Edit gossip menu… with the options counted over all its menus', () => {
    expect(item(buildMenu(on(hela, talking(2, 1)), context()), 'Edit gossip menu…')!.hint).toBe('3 options');
    expect(item(buildMenu(on(hela, talking(1)), context()), 'Edit gossip menu…')!.hint).toBe('1 option');
    expect(item(buildMenu(on(hela, talking(0)), context()), 'Edit gossip menu…')!.hint).toBeUndefined();
    expect(item(buildMenu(on(hela, talking(1)), context()), 'Add gossip menu…')).toBeUndefined();
  });
  it('reads an unopened database NPC from its gossip_menu_id', () => {
    expect(item(buildMenu(on(npc({ gossipMenuId: 5000 })), context()), 'Edit gossip menu…')!.hint).toBeUndefined();
    expect(item(buildMenu(on(npc({ gossipMenuId: 0 })), context()), 'Add gossip menu…')).toBeDefined();
    expect(item(buildMenu(on(npc()), context()), 'Add gossip menu…')).toBeDefined();
  });
  it('needs the world database for a database NPC, not for a project one; not on objects', () => {
    expect(item(buildMenu(on(npc()), context({ connected: false })), 'Add gossip menu…')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(on(hela), context({ connected: false })), 'Add gossip menu…')!.action).toBeDefined();
    expect(item(buildMenu(on(chest), context()), 'Add gossip menu…')).toBeUndefined();
  });
  it('a gossip menu the project never read falls back to the database\'s', () => {
    const unread = { ...store, npcs: [{ ...newNpc(1423), origin: { kind: 'existing' as const, original: {}, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] } }] };
    expect(item(buildMenu(on(npc({ gossipMenuId: 5000 }), unread), context()), 'Edit gossip menu…')).toBeDefined();
    expect(item(buildMenu(on(npc({ gossipMenuId: 0 }), unread), context()), 'Add gossip menu…')).toBeDefined();
  });
});

describe('the scripts section', () => {
  const sceneStore = (count: number): ProjectEntities => ({
    ...store,
    npcs: [{ ...newNpc(12000001), name: 'Hela', scenes: Array.from({ length: count }, (_, i) => ({ id: `s${i + 1}`, name: '', questId: 0, trigger: { kind: 'talkedTo' as const }, gates: [], steps: [] })) }],
  });

  it('offers Add script… on an NPC without scenes, opening the Scripts tab', () => {
    const entry = item(buildMenu(on(hela), context()), 'Add script…')!;
    expect(entry.action).toEqual({ kind: 'editEntity', spawn: hela, tab: 'scripts' });
    expect(entry.hint).toBeUndefined();
  });
  it('offers Edit scripts… with the scenes counted', () => {
    expect(item(buildMenu(on(hela, sceneStore(2)), context()), 'Edit scripts…')!.hint).toBe('2 scenes');
    expect(item(buildMenu(on(hela, sceneStore(1)), context()), 'Edit scripts…')!.hint).toBe('1 scene');
    expect(item(buildMenu(on(hela, sceneStore(1)), context()), 'Add script…')).toBeUndefined();
  });
  it('needs the world database for a database NPC, not for a project one; not on objects', () => {
    expect(item(buildMenu(on(npc()), context({ connected: false })), 'Add or edit scripts…')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(on(hela), context({ connected: false })), 'Add script…')!.action).toBeDefined();
    expect(item(buildMenu(on(chest), context()), 'Add script…')).toBeUndefined();
  });
  it('sits right after the gossip items', () => {
    const labels = buildMenu(on(hela), context()).find((g) => g.id === 'world')!.items.map((i) => i.label);
    expect(labels.indexOf('Add script…')).toBe(labels.indexOf('Add gossip menu…') + 1);
  });
});
