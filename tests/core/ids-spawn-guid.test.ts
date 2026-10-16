import { describe, expect, it } from 'vitest';
import { claimKey, type IdClaim, type IdHolder, type ProjectIds } from '../../src/core/ids/kinds/kind';
import { ID_KINDS } from '../../src/core/ids/kinds';
import { SAME_SPOT, spawnGuidKind } from '../../src/core/ids/kinds/spawn-guid';
import { EMPTY_ENTITIES, newNpc, newObject, newSpawn } from '../../src/core/entities/model';
import { EMPTY_WORLD, type WorldAddedSpawn } from '../../src/core/world/layer';
import type { WorldDb } from '../../src/core/db/world-db';
import { forkDb } from '../helpers/fixtures';

const npc = (entry: number, guids: number[]) => ({
  ...newNpc(entry), name: `Npc ${entry}`, spawns: guids.map((g) => ({ ...newSpawn(g), map: 1, x: 10, y: 20, z: 30 })),
});
const object = (entry: number, guids: number[]) => ({
  ...newObject(entry), name: `Obj ${entry}`, spawns: guids.map((g) => ({ ...newSpawn(g), map: 1, x: 1, y: 2, z: 3 })),
});
const added = (kind: 'creature' | 'gameobject', guid: number, entry: number, x = 5): WorldAddedSpawn => ({
  kind, guid, entry, name: 'Placed', map: 0,
  placement: { x, y: 6, z: 7, orientation: 0, rotation: null },
  look: { displayId: 1, scale: 1, equipment: [0, 0, 0], preset: null },
});
const make = (entities = EMPTY_ENTITIES, world = EMPTY_WORLD): ProjectIds => ({ entities, world });
const claimFor = (over: Partial<IdClaim> = {}): IdClaim => ({ scope: 'creature', id: 1, entry: 1423, name: 'Guard', map: 0, x: 0, y: 0, z: 0, ...over });
const heldAt = (over: Partial<IdHolder> = {}): IdHolder => ({ entry: 1423, name: 'Guard', map: 0, x: 0, y: 0, z: 0, ...over });

describe('registry', () => {
  it('has the spawn-guid kind', () => {
    expect(ID_KINDS.map((k) => k.key)).toEqual(['spawn-guid']);
  });
});

describe('claims', () => {
  it("lists the project's NPC, object and placed spawns with what each is and where it stands", () => {
    const project = make(
      { ...EMPTY_ENTITIES, npcs: [npc(11000230, [5300700])], objects: [object(9100001, [5400001])] },
      { ...EMPTY_WORLD, added: [added('creature', 5300800, 1423), added('gameobject', 5400800, 176)] },
    );
    const claims = spawnGuidKind.claims(project);
    expect(claims).toContainEqual({ scope: 'creature', id: 5300700, entry: 11000230, name: 'Npc 11000230', map: 1, x: 10, y: 20, z: 30 });
    expect(claims).toContainEqual({ scope: 'gameobject', id: 5400001, entry: 9100001, name: 'Obj 9100001', map: 1, x: 1, y: 2, z: 3 });
    expect(claims).toContainEqual({ scope: 'creature', id: 5300800, entry: 1423, name: 'Placed', map: 0, x: 5, y: 6, z: 7 });
    expect(claims).toContainEqual({ scope: 'gameobject', id: 5400800, entry: 176, name: 'Placed', map: 0, x: 5, y: 6, z: 7 });
    expect(claims).toHaveLength(4);
  });

  it("does not list the database's own spawns the layer edits", () => {
    const world = { ...EMPTY_WORLD, spawns: [{ kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', map: 0, original: {}, current: {} }] } as never;
    expect(spawnGuidKind.claims(make(EMPTY_ENTITIES, world))).toEqual([]);
  });
});

describe('holders', () => {
  it('reads the database spawn at a claimed guid, with its NPC name and position', async () => {
    const db = forkDb();
    db.insert('creature_template', { entry: '1423', name: 'Stormwind Guard' });
    db.insert('creature', { guid: '5300700', id1: '1423', map: '0', position_x: '-9481.5', position_y: '74.5', position_z: '56.5' });
    const found = await spawnGuidKind.holders(db, [claimFor({ id: 5300700 }), claimFor({ id: 5300701 })]);
    expect([...found.keys()]).toEqual([claimKey('creature', 5300700)]);
    expect(found.get(claimKey('creature', 5300700))).toEqual({ entry: 1423, name: 'Stormwind Guard', map: 0, x: -9481.5, y: 74.5, z: 56.5 });
  });

  it('reads objects from the gameobject table by their id column', async () => {
    const db = forkDb();
    db.insert('gameobject_template', { entry: '176', name: 'Crate' });
    db.insert('gameobject', { guid: '5400001', id: '176', map: '1', position_x: '1', position_y: '2', position_z: '3' });
    const found = await spawnGuidKind.holders(db, [claimFor({ scope: 'gameobject', id: 5400001, entry: 176 })]);
    expect(found.get(claimKey('gameobject', 5400001))).toEqual({ entry: 176, name: 'Crate', map: 1, x: 1, y: 2, z: 3 });
  });

  it('does not mix the two kinds that share a number', async () => {
    const db = forkDb();
    db.insert('creature', { guid: '77', id1: '1423', map: '0', position_x: '0', position_y: '0', position_z: '0' });
    const found = await spawnGuidKind.holders(db, [claimFor({ scope: 'gameobject', id: 77 })]);
    expect(found.size).toBe(0);
  });

  it('holds nothing for a database whose fork has no such table', async () => {
    const bare = { columns: async () => [] } as unknown as WorldDb;
    expect((await spawnGuidKind.holders(bare, [claimFor()])).size).toBe(0);
  });
});

describe('isSameThing', () => {
  it('is the project own row when entry and map match and the spot is within the tolerance', () => {
    expect(spawnGuidKind.isSameThing(claimFor(), heldAt())).toBe(true);
    expect(spawnGuidKind.isSameThing(claimFor(), heldAt({ x: SAME_SPOT, y: -SAME_SPOT, z: SAME_SPOT }))).toBe(true);
  });
  it('is a different thing when any one differs', () => {
    expect(spawnGuidKind.isSameThing(claimFor(), heldAt({ x: SAME_SPOT + 0.1 }))).toBe(false);
    expect(spawnGuidKind.isSameThing(claimFor(), heldAt({ z: -(SAME_SPOT + 0.1) }))).toBe(false);
    expect(spawnGuidKind.isSameThing(claimFor(), heldAt({ map: 1 }))).toBe(false);
    expect(spawnGuidKind.isSameThing(claimFor(), heldAt({ entry: 1424 }))).toBe(false);
  });
});

describe('rename', () => {
  it('renames an NPC spawn and leaves the other guids and the other kind alone', () => {
    const project = make({ ...EMPTY_ENTITIES, npcs: [npc(1, [100, 200])], objects: [object(2, [100])] });
    const next = spawnGuidKind.rename(project, 'creature', 100, 900);
    expect(next.entities.npcs[0]!.spawns.map((s) => s.guid)).toEqual([900, 200]);
    expect(next.entities.objects[0]!.spawns.map((s) => s.guid)).toEqual([100]);
  });

  it('renames an object spawn and only an object group member', () => {
    const groups = [{ id: 1, name: 'G', map: 0, maxActive: 1, members: [
      { type: 'spawn', kind: 'object', guid: 100, entry: 2, chance: 0 },
      { type: 'spawn', kind: 'npc', guid: 100, entry: 1, chance: 0 },
    ] }] as never;
    const project = make({ ...EMPTY_ENTITIES, objects: [object(2, [100])] }, { ...EMPTY_WORLD, groups });
    const next = spawnGuidKind.rename(project, 'gameobject', 100, 900);
    expect(next.entities.objects[0]!.spawns[0]!.guid).toBe(900);
    expect(next.world.groups![0]!.members.map((m) => (m as { guid: number }).guid)).toEqual([900, 100]);
  });

  it('renames a placed creature, its movement edit, its spawn events and its group member', () => {
    const world = {
      ...EMPTY_WORLD,
      added: [added('creature', 100, 1423)],
      movements: [{ guid: 100 }, { guid: 300 }],
      spawnEvents: [{ guid: 100 }],
      groups: [{ id: 1, name: 'G', map: 0, maxActive: 1, members: [{ type: 'spawn', kind: 'npc', guid: 100, entry: 1423, chance: 0 }] }],
    } as never;
    const next = spawnGuidKind.rename(make(EMPTY_ENTITIES, world), 'creature', 100, 900);
    expect(next.world.added[0]!.guid).toBe(900);
    expect(next.world.movements!.map((m) => m.guid)).toEqual([900, 300]);
    expect(next.world.spawnEvents!.map((e) => e.guid)).toEqual([900]);
    expect((next.world.groups![0]!.members[0] as { guid: number }).guid).toBe(900);
  });

  it("leaves the database's own spawn edits at that guid alone", () => {
    const world = {
      ...EMPTY_WORLD,
      added: [added('creature', 100, 1423)],
      spawns: [{ kind: 'creature', guid: 100 }],
      respawns: [{ kind: 'creature', guid: 100 }],
      deletes: [{ kind: 'creature', guid: 100 }],
    } as never;
    const next = spawnGuidKind.rename(make(EMPTY_ENTITIES, world), 'creature', 100, 900);
    expect(next.world.spawns[0]!.guid).toBe(100);
    expect(next.world.respawns![0]!.guid).toBe(100);
    expect(next.world.deletes![0]!.guid).toBe(100);
  });

  it('leaves a movement edit of a database creature alone when no placed creature has the guid', () => {
    const world = { ...EMPTY_WORLD, movements: [{ guid: 100 }], spawnEvents: [{ guid: 100 }] } as never;
    const next = spawnGuidKind.rename(make(EMPTY_ENTITIES, world), 'creature', 100, 900);
    expect(next.world.movements![0]!.guid).toBe(100);
    expect(next.world.spawnEvents![0]!.guid).toBe(100);
  });

  it('does not change the project it was given', () => {
    const project = make({ ...EMPTY_ENTITIES, npcs: [npc(1, [100])] }, { ...EMPTY_WORLD, added: [added('creature', 100, 1423)] });
    const before = JSON.stringify(project);
    spawnGuidKind.rename(project, 'creature', 100, 900);
    expect(JSON.stringify(project)).toBe(before);
  });
});

describe('freeIds', () => {
  it('starts above the database and the project, per kind', async () => {
    const db = forkDb();
    db.insert('creature', { guid: '100', id1: '1' });
    db.insert('gameobject', { guid: '9000', id: '1' });
    const project = make({ ...EMPTY_ENTITIES, npcs: [npc(1, [5000])] });
    expect(await spawnGuidKind.freeIds(db, project, 'creature', 2)).toEqual([5001, 5002]);
    expect(await spawnGuidKind.freeIds(db, project, 'gameobject', 1)).toEqual([9001]);
  });

  it('counts a placed spawn as used', async () => {
    const project = make(EMPTY_ENTITIES, { ...EMPTY_WORLD, added: [added('creature', 7000, 1423)] });
    expect(await spawnGuidKind.freeIds(forkDb(), project, 'creature', 1)).toEqual([7001]);
  });

  it('works from the project alone when the database cannot say its maximum', async () => {
    const db = { selectMax: async () => { throw new Error('no table'); } } as unknown as WorldDb;
    const project = make({ ...EMPTY_ENTITIES, npcs: [npc(1, [40])] });
    expect(await spawnGuidKind.freeIds(db, project, 'creature', 1)).toEqual([41]);
  });
});

describe('scopeLabel', () => {
  it('names each scope for the dialog', () => {
    expect(spawnGuidKind.scopeLabel('creature')).toBe('NPC spawn');
    expect(spawnGuidKind.scopeLabel('gameobject')).toBe('Object spawn');
  });
});
