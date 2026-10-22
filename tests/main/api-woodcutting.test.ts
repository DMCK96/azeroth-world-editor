import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { forkDbWith } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

async function setup(withTrees = true) {
  const db = forkDbWith(['gameobject_loot_template', 'gameobject']);
  if (withTrees) {
    db.insert('item_template', { entry: '8210210', name: 'Forestwood Log' });
    db.insert('item_template', { entry: '8210211', name: 'Wildwood Log' });
    for (const [entry, name, log] of [[244614, 'Elwynn Tree', 8210210], [244616, 'Redridge Tree', 8210211]] as const) {
      db.insert('gameobject_template', { entry: String(entry), type: '3', displayId: '170000', name, IconName: 'AxeCursor', Data1: String(entry) });
      db.insert('gameobject_loot_template', { Entry: String(entry), Item: String(log), Reference: '0', Chance: '100', GroupId: '0', MinCount: '1', MaxCount: '3' });
    }
  }
  db.insert('gameobject_template', { entry: '143981', type: '19', displayId: '1949', name: 'Mailbox', size: '1' });
  const spawn = (guid: number, id: number, map: number, x: number, y: number) =>
    db.insert('gameobject', { guid: String(guid), id: String(id), map: String(map), position_x: String(x), position_y: String(y), position_z: '0', orientation: '0', rotation0: '0', rotation1: '0', rotation2: '0', rotation3: '1' });
  spawn(1, 244614, 0, 0, 0);
  spawn(2, 244616, 0, 200, 0);
  spawn(3, 244616, 1, 10, 0);
  spawn(4, 143981, 0, 5, 0);
  const session = createProjectSession(defaultProjectMeta('P', 'C:\\out'));
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] },
    now: () => new Date('2026-10-22T12:00:00Z'), session, projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api };
}

describe('woodcutting trees through the API', () => {
  it('lists the trees the database has, by tier', async () => {
    const { api } = await setup();
    const out: any = await api.worldWoodcuttingTrees();
    expect(out.value.map((t: any) => [t.entry, t.tier])).toEqual([[244614, 'Forestwood'], [244616, 'Wildwood']]);
  });

  it('lists none where the database has none, so the menu offers nothing', async () => {
    const { api } = await setup(false);
    expect(((await api.worldWoodcuttingTrees()) as any).value).toEqual([]);
    expect(((await api.worldNearestWoodcuttingTree(0, 0, 0)) as any).value).toBeNull();
  });

  it("answers the entry of the nearest tree's spawn on the map, never another kind of object or another map", async () => {
    const { api } = await setup();
    expect(((await api.worldNearestWoodcuttingTree(0, 20, 0)) as any).value).toBe(244614);
    expect(((await api.worldNearestWoodcuttingTree(0, 180, 0)) as any).value).toBe(244616);
    expect(((await api.worldNearestWoodcuttingTree(1, 0, 0)) as any).value).toBe(244616);
    expect(((await api.worldNearestWoodcuttingTree(0, 9000, 0)) as any).value).toBeNull();
  });

  it('counts a tree placed in the view', async () => {
    const { api } = await setup();
    await api.worldAddSpawn('gameobject', 244616, 0, { x: 5000, y: 0, z: 0, orientation: 0, rotation: null });
    expect(((await api.worldNearestWoodcuttingTree(0, 4990, 0)) as any).value).toBe(244616);
  });
});
