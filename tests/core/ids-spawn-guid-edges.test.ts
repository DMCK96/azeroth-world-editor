import { describe, expect, it } from 'vitest';
import { claimKey, type IdClaim, type IdHolder, type ProjectIds } from '../../src/core/ids/kinds/kind';
import { spawnGuidKind } from '../../src/core/ids/kinds/spawn-guid';
import { EMPTY_ENTITIES, newNpc, newSpawn } from '../../src/core/entities/model';
import { EMPTY_WORLD } from '../../src/core/world/layer';
import type { WorldDb } from '../../src/core/db/world-db';
import { forkDb } from '../helpers/fixtures';

const make = (entities = EMPTY_ENTITIES, world = EMPTY_WORLD): ProjectIds => ({ entities, world });
const claimFor = (over: Partial<IdClaim> = {}): IdClaim => ({ scope: 'creature', id: 1, entry: 1423, name: 'Guard', map: 0, x: 0, y: 0, z: 0, ...over });
const farAway = (over: Partial<IdHolder> = {}): IdHolder => ({ entry: 1423, name: 'Guard', map: 0, x: 500, y: 500, z: 500, ...over });
const column = (name: string) => ({ name, dataType: 'int', columnType: 'int', nullable: true, default: null, ordinal: 0 });

describe('a patrol that uses an object by its spawn guid', () => {
  const patrolled = (guid: number, entry: number) => ({
    ...newNpc(1), name: 'Guard',
    spawns: [{
      ...newSpawn(5000), map: 1,
      patrol: {
        pathId: 50000, startPace: 'walk',
        points: [{ x: 0, y: 0, z: 0, waitSecs: 0, facing: null, paceFromHere: null, actions: [
          { kind: 'useObject', guid, entry }, { kind: 'say', text: 'hi' }, { kind: 'useObject', guid: 777, entry: 3 },
        ] }],
      },
    }],
  }) as never;
  const actionsOf = (p: ProjectIds) => (p.entities.npcs[0]!.spawns[0]!.patrol!.points[0]!.actions as { kind: string; guid?: number }[]);

  it('follows the object when its guid is renumbered, and only that action', () => {
    const next = spawnGuidKind.rename(make({ ...EMPTY_ENTITIES, npcs: [patrolled(100, 2)] }), 'gameobject', 100, 900);
    expect(actionsOf(next).map((a) => a.guid ?? null)).toEqual([900, null, 777]);
  });

  it('leaves it alone when an NPC guid is renumbered', () => {
    const next = spawnGuidKind.rename(make({ ...EMPTY_ENTITIES, npcs: [patrolled(100, 2)] }), 'creature', 100, 900);
    expect(actionsOf(next).map((a) => a.guid ?? null)).toEqual([100, null, 777]);
  });
});

describe("the project's own row, told by the tool's mark", () => {
  it('is the same thing even when the spawn has since been moved far from where it was written', () => {
    expect(spawnGuidKind.isSameThing(claimFor(), farAway({ comment: 'AQC npc1423 ' }))).toBe(true);
    expect(spawnGuidKind.isSameThing(claimFor({ scope: 'gameobject', entry: 176 }), farAway({ entry: 176, comment: 'AQC obj176 ' }))).toBe(true);
    expect(spawnGuidKind.isSameThing(claimFor(), farAway({ comment: 'ACQC 3D view' }))).toBe(true);
  });

  it("is a different thing when the mark is another NPC's, another kind's, or absent", () => {
    expect(spawnGuidKind.isSameThing(claimFor(), farAway({ comment: 'AQC npc1424 ' }))).toBe(false);
    expect(spawnGuidKind.isSameThing(claimFor(), farAway({ comment: 'AQC obj1423 ' }))).toBe(false);
    expect(spawnGuidKind.isSameThing(claimFor(), farAway({ comment: 'someone else' }))).toBe(false);
    expect(spawnGuidKind.isSameThing(claimFor(), farAway())).toBe(false);
  });

  it('needs the same NPC even with the mark', () => {
    expect(spawnGuidKind.isSameThing(claimFor(), farAway({ entry: 1999, comment: 'ACQC 3D view' }))).toBe(false);
  });

  it('is read from the row by holders', async () => {
    const db = forkDb();
    db.insert('creature', { guid: '5300700', id1: '1423', map: '0', position_x: '1', position_y: '2', position_z: '3', Comment: 'AQC npc1423 ' });
    const found = await spawnGuidKind.holders(db, [claimFor({ id: 5300700 })]);
    expect(found.get(claimKey('creature', 5300700))?.comment).toBe('AQC npc1423 ');
  });
});

describe('a database that cannot answer for one table', () => {
  it('still reports the other table', async () => {
    const creatureColumns = ['guid', 'id1', 'map', 'position_x', 'position_y', 'position_z'].map(column);
    const flaky = {
      columns: async () => creatureColumns,
      selectRows: async (table: string) => {
        if (table === 'gameobject') throw new Error('boom');
        return [{ guid: '5', id1: '1423', map: '0', position_x: '1', position_y: '2', position_z: '3' }];
      },
      lookupNames: async () => new Map([[1423, 'Guard']]),
    } as unknown as WorldDb;
    const found = await spawnGuidKind.holders(flaky, [claimFor({ id: 5 }), claimFor({ scope: 'gameobject', id: 6 })]);
    expect([...found.keys()]).toEqual([claimKey('creature', 5)]);
  });
});

describe('a fork that names the creature entry id, not id1', () => {
  it('reads the entry from id', async () => {
    const older = {
      columns: async () => ['guid', 'id', 'map', 'position_x', 'position_y', 'position_z'].map(column),
      selectRows: async () => [{ guid: '5', id: '1423', map: '0', position_x: '1', position_y: '2', position_z: '3' }],
      lookupNames: async () => new Map([[1423, 'Guard']]),
    } as unknown as WorldDb;
    const found = await spawnGuidKind.holders(older, [claimFor({ id: 5 })]);
    expect(found.get(claimKey('creature', 5))).toMatchObject({ entry: 1423, name: 'Guard', map: 0, x: 1, y: 2, z: 3 });
  });
});

describe('an adopted spawn group that holds the database spawn at the clashing guid', () => {
  const member = (guid: number) => ({ type: 'spawn', kind: 'npc', guid, entry: 1423, chance: 0 });
  const group = (id: number, origin: unknown) => ({ id, name: 'G', map: 0, maxActive: 1, event: null, origin, members: [member(100)] });
  const existing = { kind: 'existing', original: { template: {}, event: null, members: [{ table: 'pool_creature', row: { guid: '100', pool_entry: '1' } }] } };

  it("keeps the database's member and renames the project's own group's", () => {
    const world = { ...EMPTY_WORLD, groups: [group(1, existing), group(2, { kind: 'new' })] } as never;
    const next = spawnGuidKind.rename(make(EMPTY_ENTITIES, world), 'creature', 100, 900);
    expect((next.world.groups![0]!.members[0] as { guid: number }).guid).toBe(100);
    expect((next.world.groups![1]!.members[0] as { guid: number }).guid).toBe(900);
  });
});
