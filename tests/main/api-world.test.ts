import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { forkDb, forkDbWith } from '../helpers/fixtures';
import { newNpc, newSpawn, writeEntities } from '../../src/core/entities/model';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

async function setup(seed: (db: ReturnType<typeof forkDb>) => void = () => {}, extraTables: string[] = []) {
  const db = extraTables.length > 0 ? forkDbWith(extraTables) : forkDb();
  seed(db);
  const written = new Map<string, string>();
  const session = createProjectSession(defaultProjectMeta('P', 'C:\\out'));
  // A second window onto the same project, never connected
  const make = () => createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async (p: string, t: string) => { written.set(p, t); }, ensureDir: async () => {}, listDir: async () => [...written.keys()].map((p) => p.split(/[\\/]/).at(-1)!) },
    now: () => new Date('2026-10-03T12:00:00Z'), session, projects: {} as ProjectController });
  const api = make();
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, db, session, written, offline: make };
}

const world = (db: ReturnType<typeof forkDb>) => {
  db.insert('creature_template', { entry: '1423', name: 'Stormwind Guard' });
  db.insert('creature', { guid: '80330', id1: '1423', map: '0', position_x: '-9481.31', position_y: '74.42', position_z: '56.55', orientation: '1.5' });
  db.insert('creature', { guid: '80331', id1: '1423', map: '0', position_x: '-9480', position_y: '70', position_z: '56', orientation: '0' });
  db.insert('creature', { guid: '80332', id1: '1423', map: '0', position_x: '-9470', position_y: '70', position_z: '56', orientation: '0' });
  db.insert('gameobject_template', { entry: '143981', type: '19', displayId: '1949', name: 'Mailbox', size: '1' });
  db.insert('gameobject', { guid: '5', id: '143981', map: '0', position_x: '-9460', position_y: '40', position_z: '57', orientation: '0', rotation0: '0', rotation1: '0', rotation2: '0', rotation3: '1' });
  db.insert('creature_addon', { guid: '80330', path_id: '801' });
  db.insert('creature_template_addon', { entry: '1423', path_id: '802' });
  db.insert('waypoint_data', { id: '801', point: '2', position_x: '20', position_y: '0', position_z: '1', delay: '3000' });
  db.insert('waypoint_data', { id: '801', point: '1', position_x: '10', position_y: '0', position_z: '1', delay: '0' });
  db.insert('waypoint_data', { id: '802', point: '1', position_x: '1', position_y: '1', position_z: '1' });
  db.insert('waypoint_data', { id: '802', point: '2', position_x: '2', position_y: '2', position_z: '2' });
};
const to = (x: number) => ({ x, y: 74.42, z: 56.55, orientation: 2, rotation: null });

describe('the world layer through the API', () => {
  it('reads a spawn\'s original from the database at its first move only', async () => {
    const { api, db, session } = await setup(world);
    await api.worldMoveSpawn('creature', 80330, to(-9470));
    db.update('creature', { guid: '80330' }, { position_x: '0', position_y: '0', position_z: '0', orientation: '0' });
    const out: any = await api.worldMoveSpawn('creature', 80330, to(-9460));
    expect(out.value.spawns).toEqual([{ kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0,
      original: { x: -9481.31, y: 74.42, z: 56.55, orientation: 1.5, rotation: null }, current: to(-9460) }]);
    expect(session.world.get()).toEqual(out.value);
    expect(session.dirty()).toBe(true);
  });

  it('reads an object\'s rotation', async () => {
    const { api } = await setup(world);
    const out: any = await api.worldMoveSpawn('gameobject', 5, { x: -9461, y: 40, z: 57, orientation: 0, rotation: [0, 0, 0, 1] });
    expect(out.value.spawns[0].original.rotation).toEqual([0, 0, 0, 1]);
  });

  it('refuses a spawn that is not in the database', async () => {
    const { api } = await setup(world);
    const out: any = await api.worldMoveSpawn('creature', 4242, to(1));
    expect(out.ok).toBe(false);
    expect(out.error.message).toBe('Spawn 4242 is no longer in the database.');
  });

  it('records which NPCs walk a route at its first edit', async () => {
    const { api } = await setup(world);
    const out: any = await api.worldSetRoute(802, [{ x: 1, y: 2, z: 3, rest: {} }]);
    expect(out.value.routes[0].walkerEntries).toEqual([{ entry: 1423, name: 'Stormwind Guard' }]);
  });

  it('fills in the walkers of a route edited before they were recorded, without an undo step or a save', async () => {
    const { api, session } = await setup(world);
    session.world.put({ spawns: [], added: [], routes: [{ pathId: 801, walkers: 1, original: [{ x: 10, y: 0, z: 1, rest: {} }], current: [] }] });
    const steps = ((await api.historyList()) as any).value.steps.length;
    session.markSaved('C:\p.json');
    expect(session.dirty()).toBe(false);
    const out: any = await api.worldLayer();
    expect(out.value.routes[0].walkerEntries).toEqual([{ entry: 1423, name: 'Stormwind Guard' }]);
    expect(((await api.historyList()) as any).value.steps.length).toBe(steps);
    expect(session.dirty()).toBe(false);
  });

  it('fills in the type of an object placed before types were recorded, without an undo step or a save', async () => {
    const { api, session } = await setup(world);
    const look = { displayId: 1949, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
    const at = { x: 1, y: 2, z: 3, orientation: 0, rotation: null };
    session.world.put({ spawns: [], routes: [], added: [{ kind: 'gameobject', guid: 9, entry: 143981, name: 'Mailbox', map: 0, placement: at, look }] });
    const steps = ((await api.historyList()) as any).value.steps.length;
    session.markSaved('C:\p.json');
    const out: any = await api.worldLayer();
    expect(out.value.added[0].look.objectType).toBe(19);
    expect(session.world.get().added[0]!.look.objectType).toBe(19);
    expect(((await api.historyList()) as any).value.steps.length).toBe(steps);
    expect(session.dirty()).toBe(false);
  });

  it('keeps the name of an NPC that walks a route, for naming the change', async () => {
    const { api } = await setup(world);
    const out: any = await api.worldSetRoute(801, [{ x: 1, y: 2, z: 3, rest: {} }, { x: 4, y: 5, z: 6, rest: {} }]);
    expect(out.value.routes[0].name).toBe('Stormwind Guard');
  });

  it('gives a route in point order with its other columns, and counts its walkers', async () => {
    const { api } = await setup(world);
    const own: any = await api.worldRoute(801);
    expect(own.value.walkers).toBe(1);
    expect(own.value.points.map((p: any) => [p.x, p.rest.delay])).toEqual([[10, '0'], [20, '3000']]);
    expect(own.value.points[0].rest).not.toHaveProperty('id');
    expect(own.value.points[0].rest).not.toHaveProperty('point');
    const shared: any = await api.worldRoute(802);
    expect(shared.value.walkers).toBe(3);
  });

  it('counts no template walkers when the table is missing', async () => {
    const { api, db } = await setup(world);
    db.forbidTable('creature_template_addon');
    const out: any = await api.worldRoute(801);
    expect(out.value.walkers).toBe(1);
  });

  it('sets a route, keeping the first original, and gives back the edited points', async () => {
    const { api } = await setup(world);
    const first: any = await api.worldRoute(801);
    const points = [first.value.points[0], { x: 15, y: 0, z: 1, rest: {} }, first.value.points[1]];
    const out: any = await api.worldSetRoute(801, points);
    expect(out.value.routes[0]).toMatchObject({ pathId: 801, walkers: 1, current: points });
    expect(((await api.worldRoute(801)) as any).value.points).toEqual(points);
  });

  it('reverts a spawn and a route', async () => {
    const { api } = await setup(world);
    await api.worldMoveSpawn('creature', 80330, to(1));
    await api.worldSetRoute(801, [{ x: 1, y: 1, z: 1, rest: {} }, { x: 2, y: 2, z: 2, rest: {} }]);
    await api.worldRevert({ kind: 'spawn', spawnKind: 'creature', guid: 80330 });
    const out: any = await api.worldRevert({ kind: 'route', pathId: 801 });
    expect(out.value).toEqual({ spawns: [], routes: [], added: [] });
  });

  it('says which changes the database has moved away from since', async () => {
    const { api, db } = await setup(world);
    await api.worldMoveSpawn('creature', 80330, to(1));
    await api.worldMoveSpawn('gameobject', 5, { x: 1, y: 40, z: 57, orientation: 0, rotation: [0, 0, 0, 1] });
    db.update('creature', { guid: '80330' }, { position_x: '0', position_y: '0', position_z: '0', orientation: '0' });
    const out: any = await api.worldChanges();
    expect(out.value.map((c: any) => [c.type, c.guid, c.drifted])).toEqual([['spawn', 80330, true], ['spawn', 5, false]]);
  });

  it('exports world changes in the project patch and its revert, numbered per day', async () => {
    const { api, written } = await setup(world);
    expect(((await api.exportProject()) as any).error.message).toBe('There are no NPCs, objects, items or world changes to export.');
    await api.worldMoveSpawn('creature', 80330, to(-9470));
    const out: any = await api.exportProject();
    expect(out.value.applyPath).toMatch(/2026_10_03_00_project\.sql$/);
    expect(out.value.revertPath).toMatch(/2026_10_03_00_project_revert\.sql$/);
    expect(written.get(out.value.applyPath)).toMatch(/UPDATE `creature` SET .*`position_x` = -9470.*WHERE `guid` = 80330/s);
    expect(written.get(out.value.revertPath)).toMatch(/`position_x` = -9481.31/);
    expect(written.get(out.value.applyPath)).toContain('-- Project changes');
    const again: any = await api.exportProject();
    expect(again.value.applyPath).toMatch(/2026_10_03_01_project\.sql$/);
  });

  it('exports a point added in 3D with every column the database has, at its default', async () => {
    const { api, written } = await setup(world);
    const first: any = await api.worldRoute(801);
    await api.worldSetRoute(801, [...first.value.points, { x: 30, y: 0, z: 1, rest: {} }]);
    const out: any = await api.exportProject();
    expect(out.ok).toBe(true);
    const sql = written.get(out.value.applyPath)!;
    expect(sql).toMatch(/INSERT INTO `waypoint_data` .*`velocity`.*VALUES[\s\S]*\(801, 3, 30, 0, 1,/);
  });

  it('keeps both of two edits to different spawns that overlap', async () => {
    const { api, session } = await setup(world);
    await Promise.all([
      api.worldMoveSpawn('creature', 80330, to(-9470)),
      api.worldMoveSpawn('gameobject', 5, { x: -9461, y: 40, z: 57, orientation: 1, rotation: [0, 0, 0.5, 0.8660254] }),
    ]);
    expect(session.world.get().spawns.map((s) => s.guid).sort()).toEqual([5, 80330]);
  });

  describe('placing existing NPCs and objects', () => {
    const at = { x: -9400, y: 30, z: 57, orientation: 1, rotation: null };
    const templates = (db: ReturnType<typeof forkDb>) => {
      world(db);
      db.insert('creature_template_model', { CreatureID: '1423', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1.25', Probability: '1' });
      db.insert('creature_template_model', { CreatureID: '1423', Idx: '1', CreatureDisplayID: '9999', DisplayScale: '1', Probability: '1' });
    };

    it('places an NPC with its template\'s look, at the next free spawn id', async () => {
      const { api, session } = await setup(templates);
      const out: any = await api.worldAddSpawn('creature', 1423, 0, at);
      expect(out.value.guid).toBe(80333);
      expect(out.value.layer.added).toEqual([{ kind: 'creature', guid: 80333, entry: 1423, name: 'Stormwind Guard', map: 0, placement: at, look: { displayId: 3167, scale: 1.25, equipment: [0, 0, 0], preset: null } }]);
      expect(session.world.get()).toEqual(out.value.layer);
      expect(session.dirty()).toBe(true);
    });

    it('gives two placements made together different ids, and keeps the kinds apart', async () => {
      const { api, session } = await setup(templates);
      await Promise.all([api.worldAddSpawn('creature', 1423, 0, at), api.worldAddSpawn('creature', 1423, 0, at), api.worldAddSpawn('gameobject', 143981, 0, at)]);
      expect(session.world.get().added.map((a) => [a.kind, a.guid]).sort()).toEqual([['creature', 80333], ['creature', 80334], ['gameobject', 6]]);
      expect(session.world.get().added.find((a) => a.kind === 'gameobject')!.look).toMatchObject({ displayId: 1949, scale: 1, objectType: 19 });
      expect(session.world.get().added.find((a) => a.kind === 'creature')!.look.objectType).toBeUndefined();
    });

    it('refuses an NPC or object the database does not have', async () => {
      const { api, session } = await setup(templates);
      const out: any = await api.worldAddSpawn('creature', 31337, 0, at);
      expect(out.ok).toBe(false);
      expect(out.error.message).toBe('NPC 31337 is not in the database.');
      expect(session.world.get().added).toEqual([]);
    });

    it('moves a placed spawn in the layer alone, and a revert removes it', async () => {
      const { api, db } = await setup(templates);
      await api.worldAddSpawn('creature', 1423, 0, at);
      const moved: any = await api.worldMoveSpawn('creature', 80333, { ...at, x: -9300 });
      expect(moved.ok).toBe(true);
      expect(moved.value.spawns).toEqual([]);
      expect(moved.value.added[0].placement.x).toBe(-9300);
      expect(await db.selectRows('creature', { guid: '80333' })).toEqual([]);
      const reverted: any = await api.worldRevert({ kind: 'spawn', spawnKind: 'creature', guid: 80333 });
      expect(reverted.value.added).toEqual([]);
    });

    it('keeps a later quest spawn off a placed spawn\'s id', async () => {
      const { api } = await setup(templates);
      await api.worldAddSpawn('creature', 1423, 0, at);
      expect(((await api.allocateIds('creatureSpawn', 1)) as any).value).toEqual([80334]);
    });

    it('lists a placed spawn among the changes, flagged when the database has taken its id since', async () => {
      const { api, db } = await setup(templates);
      await api.worldAddSpawn('creature', 1423, 0, at);
      expect(((await api.worldChanges()) as any).value.map((c: any) => [c.type, c.guid, c.drifted])).toEqual([['added', 80333, false]]);
      db.insert('creature', { guid: '80333', id1: '1423', map: '0', position_x: '0', position_y: '0', position_z: '0', orientation: '0' });
      expect(((await api.worldChanges()) as any).value[0].drifted).toBe(true);
    });

    it('exports a placed NPC and object as inserts with every column, and a revert that deletes them', async () => {
      const { api, written } = await setup(templates);
      await api.worldAddSpawn('creature', 1423, 0, at);
      await api.worldAddSpawn('gameobject', 143981, 0, { ...at, rotation: null });
      const out: any = await api.exportProject();
      expect(out.ok).toBe(true);
      const sql = written.get(out.value.applyPath)!;
      expect(sql).toMatch(/DELETE FROM `creature` WHERE `guid` = 80333;/);
      expect(sql).toMatch(/INSERT INTO `creature` \(.*`id1`.*VALUES \(80333, 1423,/s);
      expect(sql).toMatch(/INSERT INTO `gameobject` \(.*`rotation3`.*VALUES \(6, 143981,/s);
      const revert = written.get(out.value.revertPath)!;
      expect(revert).toMatch(/DELETE FROM `creature` WHERE `guid` = 80333;/);
      expect(revert).toMatch(/DELETE FROM `gameobject` WHERE `guid` = 6;/);
      expect(revert).not.toMatch(/INSERT/);
    });
  });
});

describe('movement through the API', () => {
  it('reads an NPC’s movement once, from its spawn addon, and records a change', async () => {
    const { api, db } = await setup(world);
    db.update('creature', { guid: '80330' }, { MovementType: '2', wander_distance: '0' });
    const out: any = await api.worldSetMovement(80330, { type: 'wander', wander: 5, pathId: null });
    expect(out.value.movements).toEqual([{ guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, addonRow: true, originalRaw: { wander: 0, type: 2 },
      original: { type: 'path', wander: 0, pathId: 801 }, current: { type: 'wander', wander: 5, pathId: null } }]);
  });

  it('takes a template’s path as the original when the spawn has no addon, and writes a spawn addon to remove it', async () => {
    const { api, db, written } = await setup(world);
    db.update('creature', { guid: '80331' }, { MovementType: '2' });
    await api.worldSetMovement(80331, { type: 'idle', wander: 0, pathId: null });
    const changes: any = await api.worldChanges();
    expect(changes.value[0]).toMatchObject({ type: 'movement', addonRow: false, original: { type: 'path', pathId: 802 } });
    const out: any = await api.exportProject();
    expect(out.value.sql).toMatch(/INSERT INTO `creature_addon`[^;]*80331/);
    const revert = [...written.entries()].find(([path]) => path.endsWith('_project_revert.sql'))![1];
    expect(revert).toMatch(/DELETE FROM `creature_addon` WHERE[^;]*80331/);
  });

  it('places a movement on a placed spawn from idle, without reading the database', async () => {
    const { api } = await setup(world);
    const placed: any = await api.worldAddSpawn('creature', 1423, 0, to(1));
    const out: any = await api.worldSetMovement(placed.value.guid, { type: 'wander', wander: 3, pathId: null });
    expect(out.value.movements[0]).toMatchObject({ guid: placed.value.guid, addonRow: false, original: { type: 'idle', wander: 0, pathId: null } });
  });

  it('refuses an NPC that is not in the database', async () => {
    const { api } = await setup(world);
    const out: any = await api.worldSetMovement(4242, { type: 'idle', wander: 0, pathId: null });
    expect(out.ok).toBe(false);
  });

  it('gives a new path id: guid × 10 when free, else one past the highest in use', async () => {
    const { api, db } = await setup(world);
    expect((await api.worldNewPathId(80331) as any).value).toBe(803310);
    db.insert('waypoint_data', { id: '803310', point: '1', position_x: '0', position_y: '0', position_z: '0' });
    expect((await api.worldNewPathId(80331) as any).value).toBe(803311);
  });

  it('counts the layer’s own new paths as in use', async () => {
    const { api } = await setup(world);
    await api.worldSetMovement(80331, { type: 'path', wander: 0, pathId: 803310 });
    await api.worldSetRoute(803310, [{ x: 1, y: 0, z: 0, rest: {} }], { isNew: true });
    expect((await api.worldNewPathId(80331) as any).value).toBe(803311);
  });

  it('sets the points of a new path that the database does not have', async () => {
    const { api } = await setup(world);
    const out: any = await api.worldSetRoute(803310, [{ x: 1, y: 0, z: 0, rest: {} }], { isNew: true });
    expect(out.value.routes).toEqual([{ pathId: 803310, walkers: 1, original: [], current: [{ x: 1, y: 0, z: 0, rest: {} }] }]);
  });

  it('places a spawn with the guid it is given when that is free, and refuses one in use', async () => {
    const { api } = await setup(world);
    const out: any = await api.worldAddSpawn('creature', 1423, 0, to(1), 95000);
    expect(out.value.guid).toBe(95000);
    const taken: any = await api.worldAddSpawn('creature', 1423, 0, to(1), 80330);
    expect(taken.ok).toBe(false);
    expect(taken.error.message).toBe('Spawn 80330 is in use');
  });

  it('lists a movement among the changes, flagged once the database has moved on, and reverts it', async () => {
    const { api, db } = await setup(world);
    await api.worldSetMovement(80332, { type: 'wander', wander: 4, pathId: null });
    let changes: any = await api.worldChanges();
    expect(changes.value.find((c: any) => c.type === 'movement')).toMatchObject({ guid: 80332, drifted: false });
    db.update('creature', { guid: '80332' }, { wander_distance: '9', MovementType: '1' });
    changes = await api.worldChanges();
    expect(changes.value.find((c: any) => c.type === 'movement').drifted).toBe(true);
    const out: any = await api.worldRevert({ kind: 'movement', guid: 80332 });
    expect(out.value.movements ?? []).toEqual([]);
  });

  it('reads a spawn\'s respawn once, records the change, lists it and reverts it', async () => {
    const { api, db } = await setup(world);
    db.update('creature', { guid: '80330' }, { spawntimesecs: '300' });
    const out: any = await api.worldSetRespawn('creature', 80330, 60);
    expect(out.value.respawns).toEqual([{ kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: 300, current: 60 }]);
    const changes: any = await api.worldChanges();
    expect(changes.value).toContainEqual(expect.objectContaining({ type: 'respawn', guid: 80330, drifted: false }));
    db.update('creature', { guid: '80330' }, { spawntimesecs: '900' });
    expect(((await api.worldChanges()) as any).value.find((c: any) => c.type === 'respawn').drifted).toBe(true);
    const back: any = await api.worldRevert({ kind: 'respawn', spawnKind: 'creature', guid: 80330 });
    expect(back.value.respawns).toEqual([]);
  });

  it("reads a spawn's events once, records the change, lists it and reverts it", async () => {
    const { api, db } = await setup(world);
    db.insert('game_event_creature', { eventEntry: '12', guid: '80330' });
    const out: any = await api.worldSetSpawnEvents(80330, { mode: 'except', events: [4] });
    expect(out.value.spawnEvents).toEqual([{ guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: [{ eventEntry: '12', guid: '80330' }], current: { mode: 'except', events: [4] } }]);
    expect(((await api.worldChanges()) as any).value).toContainEqual(expect.objectContaining({ type: 'spawnEvents', guid: 80330, drifted: false }));
    db.insert('game_event_creature', { eventEntry: '7', guid: '80330' });
    expect(((await api.worldChanges()) as any).value.find((c: any) => c.type === 'spawnEvents').drifted).toBe(true);
    const back: any = await api.worldRevert({ kind: 'spawnEvents', guid: 80330 });
    expect(back.value.spawnEvents).toEqual([]);
  });

  it('Same as the NPC on a spawn with no events of its own changes nothing: no undo step, no save', async () => {
    const { api, session } = await setup(world);
    const steps = ((await api.historyList()) as any).value.steps.length;
    session.markSaved('C:\\p.json');
    await api.worldSetSpawnEvents(80330, 'npc');
    expect(((await api.historyList()) as any).value.steps.length).toBe(steps);
    expect(session.dirty()).toBe(false);
  });

  it("Same as the NPC takes a spawn's own events away", async () => {
    const { api } = await setup(world);
    await api.worldSetSpawnEvents(80330, null);
    const out: any = await api.worldSetSpawnEvents(80330, 'npc');
    expect(out.value.spawnEvents ?? []).toEqual([]);
  });
});

describe('the spawns a quest uses', () => {
  it('lists each quest’s givers, enders, objectives and own spawns, by role, a spawn once', async () => {
    const { api } = await setup(world);
    const created: any = await api.newQuest();
    const questId = created.value.questId;
    const values = {
      ...created.value.aggregate.values,
      'quest_template.LogTitle': 'Guards',
      creature_queststarter: [{ id: 1423 }, { id: 12000001 }],
      creature_questender: [{ id: 1423 }],
      'quest_template.RequiredNpcOrGo': [{ target: { target: 'gameobject', id: 143981 }, count: 1 }],
    };
    await api.updateQuest({ ...created.value.aggregate, values });
    await api.putProjectEntities({ npcs: [{ ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(900), map: 0, x: 1, y: 2, z: 3 }] }], objects: [], items: [] });
    const out: any = await api.questSpawnList([questId]);
    const [group] = out.value;
    expect(group).toMatchObject({ questId, title: 'Guards', capped: false });
    const roles = group.spawns.map((s: any) => `${s.role}:${s.kind}:${s.guid}`).sort();
    expect(roles).toEqual(['giver:creature:80330', 'giver:creature:80331', 'giver:creature:80332', 'objective:gameobject:5', 'giver:creature:900'].sort());
    expect(group.spawns.find((s: any) => s.guid === 900)).toMatchObject({ entry: 12000001, name: 'Hela', map: 0, x: 1, y: 2, z: 3 });
  });

  it('gives a project NPC that gives the quest the giver part, so the quest is where its giver is', async () => {
    const { api } = await setup(world);
    const created: any = await api.newQuest();
    const values = {
      ...created.value.aggregate.values,
      creature_queststarter: [{ id: 12000001 }],
      'quest_template.RequiredNpcOrGo': [{ target: { target: 'creature', id: 1423 }, count: 1 }],
    };
    await api.updateQuest({ ...created.value.aggregate, values });
    await api.putProjectEntities({ npcs: [{ ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(900), map: 0, x: 1, y: 2, z: 3 }] }], objects: [], items: [] });
    const out: any = await api.questSpawnList([created.value.questId]);
    const spawns = out.value[0].spawns;
    expect(spawns.find((s: any) => s.guid === 900).role).toBe('giver');
    expect(spawns.filter((s: any) => s.role === 'objective').map((s: any) => s.guid).sort()).toEqual([80330, 80331, 80332]);
  });

  it('reads a template-only addon as the seed of the spawn row a new path writes, and keeps the raw wander for the revert', async () => {
    const { api, db, written } = await setup(world);
    db.update('creature', { guid: '80331' }, { MovementType: '0', wander_distance: '5' });
    db.update('creature_template_addon', { entry: '1423' }, { path_id: '0', mount: '2410' });
    await api.worldSetMovement(80331, { type: 'path', wander: 0, pathId: 803310 });
    await api.worldSetRoute(803310, [{ x: 1, y: 0, z: 0, rest: {} }, { x: 2, y: 0, z: 0, rest: {} }], { isNew: true });
    const out: any = await api.exportProject();
    expect(out.value.sql).toMatch(/INSERT INTO `creature_addon`[^;]*2410/);
    const revert = [...written.entries()].find(([path]) => path.endsWith('_project_revert.sql'))![1];
    expect(revert).toMatch(/UPDATE `creature` SET `wander_distance` = 5, `MovementType` = 0 WHERE `guid` = 80331/);
  });

  it('lists a giver moved in the World where the layer has it, and a spawn placed there', async () => {
    const { api } = await setup(world);
    const created: any = await api.newQuest();
    await api.updateQuest({ ...created.value.aggregate, values: { ...created.value.aggregate.values, creature_queststarter: [{ id: 1423 }] } });
    await api.worldMoveSpawn('creature', 80330, to(-9000));
    const added: any = await api.worldAddSpawn('creature', 1423, 0, { x: 5, y: 6, z: 7, orientation: 0, rotation: null });
    const out: any = await api.questSpawnList([created.value.questId]);
    const spawns = out.value[0].spawns;
    expect(spawns.find((s: any) => s.guid === 80330)).toMatchObject({ role: 'giver', x: -9000, y: 74.42, z: 56.55 });
    expect(spawns.find((s: any) => s.guid === added.value.guid)).toMatchObject({ role: 'giver', kind: 'creature', entry: 1423, map: 0, x: 5, y: 6, z: 7 });
  });

  it('without the world database, lists the project’s own spawns and the spawns placed in the World, and says the database was not read', async () => {
    const { api, session, offline } = await setup(world);
    const created: any = await api.newQuest();
    const values = { ...created.value.aggregate.values, creature_queststarter: [{ id: 12000001 }], creature_questender: [{ id: 1423 }] };
    await api.updateQuest({ ...created.value.aggregate, values });
    await api.putProjectEntities({ npcs: [{ ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(900), map: 0, x: 1, y: 2, z: 3 }] }], objects: [], items: [] });
    const look = { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
    const moved = { kind: 'creature' as const, guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: to(1), current: to(-9000) };
    session.world.put({ spawns: [moved], routes: [], added: [{ kind: 'creature', guid: 77, entry: 1423, name: 'Stormwind Guard', map: 0, placement: { x: 5, y: 6, z: 7, orientation: 0, rotation: null }, look }] });
    const out: any = await offline().questSpawnList([created.value.questId]);
    expect(out.ok).toBe(true);
    expect(out.value[0].offline).toBe(true);
    expect(out.value[0].spawns.map((s: any) => `${s.role}:${s.guid}`).sort()).toEqual(['ender:77', 'ender:80330', 'giver:900']);
    expect(out.value[0].spawns.find((s: any) => s.guid === 80330)).toMatchObject({ x: -9000, map: 0 });
  });

  it('says how many NPCs or objects had more spawns than were listed', async () => {
    const { api, db } = await setup(world);
    for (let i = 0; i < 201; i++) db.insert('creature', { guid: String(500000 + i), id1: '1423', map: '0', position_x: '0', position_y: '0', position_z: '0', orientation: '0' });
    const created: any = await api.newQuest();
    await api.updateQuest({ ...created.value.aggregate, values: { ...created.value.aggregate.values, creature_queststarter: [{ id: 1423 }] } });
    const out: any = await api.questSpawnList([created.value.questId]);
    expect(out.value[0]).toMatchObject({ capped: true, cut: 1 });
    expect(out.value[0].spawns).toHaveLength(200);
  });
});

describe('deleting a spawn through the API', () => {
  const seeded = (db: ReturnType<typeof forkDb>) => {
    world(db);
    db.insert('game_event_creature', { eventEntry: '3', guid: '80331' });
    db.insert('game_event_creature', { eventEntry: '-4', guid: '80331' });
    db.insert('pool_creature', { guid: '80331', pool_entry: '9', chance: '0' });
  };
  // The fake database cannot remove a row, so a spawn "leaves" by taking a guid nothing asks for
  const leave = (db: ReturnType<typeof forkDb>, guid: string) => db.update('creature', { guid }, { guid: '99999' });

  it("records the spawn with its dependent rows, and the layer is the session's", async () => {
    const { api, session } = await setup(seeded);
    const out: any = await api.worldDeleteSpawn('creature', 80331);
    expect(out.ok).toBe(true);
    const [deleted] = out.value.deletes;
    expect(deleted).toMatchObject({ kind: 'creature', guid: 80331, entry: 1423, name: 'Stormwind Guard', map: 0 });
    expect(deleted.rows.map((r: any) => r.table)).toEqual(['creature', 'game_event_creature', 'game_event_creature', 'pool_creature']);
    expect(deleted.rows[0].row).toMatchObject({ guid: '80331', map: '0' });
    expect(session.world.get()).toEqual(out.value);
    expect(session.dirty()).toBe(true);
  });

  it("captures the creature's addon row, and an object's row alone", async () => {
    const { api } = await setup(seeded);
    const npc: any = await api.worldDeleteSpawn('creature', 80330);
    expect(npc.value.deletes[0].rows.map((r: any) => r.table)).toEqual(['creature', 'creature_addon']);
    const crate: any = await api.worldDeleteSpawn('gameobject', 5);
    expect(crate.value.deletes.find((d: any) => d.kind === 'gameobject').rows.map((r: any) => r.table)).toEqual(['gameobject']);
  });

  it('deleting a spawn already deleted changes nothing, and does not read the database again', async () => {
    const { api, db } = await setup(seeded);
    await api.worldDeleteSpawn('creature', 80331);
    leave(db, '80331');
    const again: any = await api.worldDeleteSpawn('creature', 80331);
    expect(again.ok).toBe(true);
    expect(again.value.deletes).toHaveLength(1);
  });

  it('refuses a spawn that is not in the database', async () => {
    const { api } = await setup(seeded);
    const out: any = await api.worldDeleteSpawn('creature', 4242);
    expect(out.ok).toBe(false);
    expect(out.error.message).toBe('Spawn 4242 is no longer in the database.');
  });

  it('a spawn placed in the view is taken out of the layer, with nothing recorded as deleted', async () => {
    const { api } = await setup((db) => { seeded(db); });
    const placed: any = await api.worldAddSpawn('creature', 1423, 0, to(1));
    const out: any = await api.worldDeleteSpawn('creature', placed.value.guid);
    expect(out.value.added).toEqual([]);
    expect(out.value.deletes ?? []).toEqual([]);
  });

  it("drops the spawn's own move, so the layer has one entry for it", async () => {
    const { api } = await setup(seeded);
    await api.worldMoveSpawn('creature', 80331, to(-9470));
    const out: any = await api.worldDeleteSpawn('creature', 80331);
    expect(out.value.spawns).toEqual([]);
    expect(out.value.deletes).toHaveLength(1);
  });

  it('worldRevert puts a deleted spawn back, and leaves the layer as it was before', async () => {
    const { api } = await setup(seeded);
    await api.worldDeleteSpawn('creature', 80331);
    const out: any = await api.worldRevert({ kind: 'delete', spawnKind: 'creature', guid: 80331 });
    expect(out.value).toEqual({ spawns: [], routes: [], added: [] });
  });

  it('lists a deleted spawn among the changes, flagged once the database no longer matches what was captured', async () => {
    const { api, db } = await setup(seeded);
    await api.worldDeleteSpawn('creature', 80331);
    expect(((await api.worldChanges()) as any).value.find((c: any) => c.type === 'deleted')).toMatchObject({ guid: 80331, drifted: false });
    db.update('creature', { guid: '80331' }, { position_x: '1' });
    expect(((await api.worldChanges()) as any).value.find((c: any) => c.type === 'deleted').drifted).toBe(true);
    leave(db, '80331');
    expect(((await api.worldChanges()) as any).value.find((c: any) => c.type === 'deleted').drifted).toBe(true);
  });

  it('an undo of the delete takes it out of the layer again', async () => {
    const { api, session } = await setup(seeded);
    await api.worldDeleteSpawn('creature', 80331);
    expect(session.world.get().deletes).toHaveLength(1);
    const undone: any = await api.historyUndo();
    expect(undone.ok).toBe(true);
    expect(session.world.get().deletes ?? []).toEqual([]);
  });

  it('exports DELETEs for the spawn and its dependents, and a revert that inserts every captured row', async () => {
    const { api, written } = await setup(seeded);
    await api.worldDeleteSpawn('creature', 80331);
    const out: any = await api.exportProject();
    expect(out.ok).toBe(true);
    const sql = written.get(out.value.applyPath)!;
    expect(sql).toMatch(/DELETE FROM `game_event_creature` WHERE `guid` = 80331;/);
    expect(sql).toMatch(/DELETE FROM `pool_creature` WHERE `guid` = 80331;/);
    expect(sql).toMatch(/DELETE FROM `creature` WHERE `guid` = 80331;/);
    const revert = written.get(out.value.revertPath)!;
    expect(revert).toMatch(/INSERT INTO `creature` \(.*\) VALUES \(.*80331/s);
    expect(revert.match(/INSERT INTO `game_event_creature`/g)).toHaveLength(2);
    expect(revert).toMatch(/INSERT INTO `pool_creature`/);
  });
});

describe('after a spawn is deleted', () => {
  const seeded = (db: ReturnType<typeof forkDb>) => world(db);
  const REFUSED = 'Spawn 80331 is deleted in this project; revert the deletion first.';

  it('refuses a move, movement, respawn time or events of it, whoever asks', async () => {
    const { api } = await setup(seeded);
    await api.worldDeleteSpawn('creature', 80331);
    for (const out of [
      await api.worldMoveSpawn('creature', 80331, to(1)),
      await api.worldSetMovement(80331, { type: 'wander', wander: 5, pathId: null }),
      await api.worldSetRespawn('creature', 80331, 60),
      await api.worldSetSpawnEvents(80331, { mode: 'during', events: [4] }),
    ] as any[]) {
      expect(out.ok).toBe(false);
      expect(out.error.message).toBe(REFUSED);
    }
  });

  it('allows them again once the deletion is reverted', async () => {
    const { api } = await setup(seeded);
    await api.worldDeleteSpawn('creature', 80331);
    await api.worldRevert({ kind: 'delete', spawnKind: 'creature', guid: 80331 });
    expect(((await api.worldMoveSpawn('creature', 80331, to(1))) as any).ok).toBe(true);
  });

  it('is no longer found among the spawns of its NPC, and no longer in a quest\'s spawns', async () => {
    const { api } = await setup(seeded);
    const before: any = await api.findSpawns('creature', 1423);
    expect(before.value.spawns.map((s: any) => s.guid)).toContain(80331);
    await api.worldDeleteSpawn('creature', 80331);
    const after: any = await api.findSpawns('creature', 1423);
    expect(after.value.spawns.map((s: any) => s.guid)).not.toContain(80331);
    expect(after.value.spawns.map((s: any) => s.guid)).toContain(80330);
    const created: any = await api.newQuest();
    await api.updateQuest({ ...created.value.aggregate, values: { ...created.value.aggregate.values, creature_queststarter: [{ id: 1423 }] } });
    const quest: any = await api.questSpawnList([created.value.questId]);
    expect(quest.value[0].spawns.map((s: any) => s.guid).sort()).toEqual([80330, 80332]);
  });

  it('deleting a placed spawn works with no database connected', async () => {
    const { api, offline } = await setup(seeded);
    const placed: any = await api.worldAddSpawn('creature', 1423, 0, to(1));
    const out: any = await offline().worldDeleteSpawn('creature', placed.value.guid);
    expect(out.ok).toBe(true);
    expect(out.value.added).toEqual([]);
  });

  it('a spawn that is gone between the two reads of its row is refused, not stored as an empty row', async () => {
    const { db } = await setup(seeded);
    let reads = 0;
    const flaky = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'selectRows') return Reflect.get(target, prop, receiver);
        return async (table: string, where: any) => (table === 'creature' && ++reads > 1 ? [] : target.selectRows(table, where));
      },
    });
    const { readDeletedSpawn } = await import('../../src/main/world/world-api');
    expect(await readDeletedSpawn(flaky as any, 'creature', 80331)).toBeNull();
  });

  it('captures the rows of an object\'s addon and an NPC\'s model equipment too', async () => {
    const { api } = await setup((db) => {
      world(db);
      db.insert('game_event_model_equip', { eventEntry: '3', guid: '80331' });
      db.insert('gameobject_addon', { guid: '5' });
    }, ['game_event_model_equip', 'gameobject_addon']);
    const npc: any = await api.worldDeleteSpawn('creature', 80331);
    expect(npc.value.deletes[0].rows.map((r: any) => r.table)).toContain('game_event_model_equip');
    const crate: any = await api.worldDeleteSpawn('gameobject', 5);
    expect(crate.value.deletes.find((d: any) => d.kind === 'gameobject').rows.map((r: any) => r.table)).toContain('gameobject_addon');
  });
});
