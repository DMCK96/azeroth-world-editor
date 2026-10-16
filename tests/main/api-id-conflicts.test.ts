import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { newNpc, newSpawn } from '../../src/core/entities/model';
import { parseRequest } from '../../src/shared/ipc';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

function build(connect: boolean) {
  const db = forkDb();
  db.insert('creature_template', { entry: '1423', name: 'Stormwind Guard' });
  const session = createProjectSession(defaultProjectMeta('P', 'C:\\out'));
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date('2026-10-16T00:00:00Z'),
    session, projects: {} as ProjectController });
  const ready = (async () => {
    if (!connect) return;
    const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
    await api.connect(rec.value.id);
  })();
  return { api, db, ready, session };
}

const mine = (guid: number) => ({ ...newNpc(11000230), name: 'Amalgam', displayId: 1, spawns: [{ ...newSpawn(guid), map: 0, x: 10, y: 20, z: 30 }] });
const put = (api: any, ...npcs: any[]) => api.putProjectEntities({ npcs, objects: [], items: [] });
const clash = (db: any, guid: string) => db.insert('creature', { guid, id1: '1423', map: '0', position_x: '-9481', position_y: '74', position_z: '56' });

describe('idConflicts', () => {
  it('is empty when no database is connected', async () => {
    const { api, ready } = build(false);
    await ready;
    await put(api, mine(5300700));
    expect(((await api.idConflicts()) as any).value).toEqual([]);
  });

  it('reports a project spawn guid the database now holds a different spawn at', async () => {
    const { api, db, ready } = build(true);
    await ready;
    clash(db, '5300700');
    await put(api, mine(5300700));
    const found: any = await api.idConflicts();
    expect(found.ok).toBe(true);
    expect(found.value).toHaveLength(1);
    expect(found.value[0]).toMatchObject({
      kind: 'spawn-guid', scope: 'creature', scopeLabel: 'NPC spawn', id: 5300700,
      mine: { entry: 11000230, name: 'Amalgam', map: 0, x: 10, y: 20, z: 30 },
      database: { entry: 1423, name: 'Stormwind Guard', map: 0, x: -9481, y: 74, z: 56 },
    });
  });

  it("does not report the project's own row, as left by an applied patch", async () => {
    const { api, db, ready } = build(true);
    await ready;
    db.insert('creature', { guid: '5300700', id1: '11000230', map: '0', position_x: '10.2', position_y: '19.9', position_z: '30' });
    await put(api, mine(5300700));
    expect(((await api.idConflicts()) as any).value).toEqual([]);
  });

  it('reports the spot differing by more than the tolerance', async () => {
    const { api, db, ready } = build(true);
    await ready;
    db.insert('creature', { guid: '5300700', id1: '11000230', map: '0', position_x: '11', position_y: '20', position_z: '30' });
    await put(api, mine(5300700));
    expect(((await api.idConflicts()) as any).value).toHaveLength(1);
  });

  it('is empty when nothing clashes', async () => {
    const { api, ready } = build(true);
    await ready;
    await put(api, mine(5300700));
    expect(((await api.idConflicts()) as any).value).toEqual([]);
  });
});

describe('resolveIdConflicts', () => {
  it('renumbers the clashing spawn above the database as one undo step that undo reverses', async () => {
    const { api, db, ready } = build(true);
    await ready;
    clash(db, '5300700');
    await put(api, mine(5300700));
    const done: any = await api.resolveIdConflicts();
    expect(done.value).toEqual({ renamed: 1 });
    expect(((await api.projectEntities()) as any).value.npcs[0].spawns[0].guid).toBe(5300701);
    expect(((await api.idConflicts()) as any).value).toEqual([]);

    await api.historyUndo();
    expect(((await api.projectEntities()) as any).value.npcs[0].spawns[0].guid).toBe(5300700);
  });

  it('labels the step Renumbered spawn ids', async () => {
    const { api, db, ready } = build(true);
    await ready;
    clash(db, '5300700');
    await put(api, mine(5300700));
    await api.resolveIdConflicts();
    const list: any = await api.historyList();
    expect(list.value.steps.at(-1).label).toBe('Renumbered spawn ids');
  });

  it('changes nothing and renames nothing when there is no clash', async () => {
    const { api, ready } = build(true);
    await ready;
    await put(api, mine(5300700));
    expect(((await api.resolveIdConflicts()) as any).value).toEqual({ renamed: 0 });
    expect(((await api.projectEntities()) as any).value.npcs[0].spawns[0].guid).toBe(5300700);
  });

  it('gives several clashes distinct new ids', async () => {
    const { api, db, ready } = build(true);
    await ready;
    clash(db, '5300700');
    clash(db, '5300701');
    await put(api, { ...mine(5300700), spawns: [{ ...newSpawn(5300700), map: 0, x: 10, y: 20, z: 30 }, { ...newSpawn(5300701), map: 0, x: 10, y: 20, z: 30 }] });
    await api.resolveIdConflicts();
    const guids = ((await api.projectEntities()) as any).value.npcs[0].spawns.map((s: any) => s.guid);
    expect(guids).toEqual([5300702, 5300703]);
  });

  it('refuses before a connection, as the other calls do', async () => {
    const { api, ready } = build(false);
    await ready;
    expect(((await api.resolveIdConflicts()) as any).ok).toBe(false);
  });
});

describe('resolveIdConflicts alongside other changes', () => {
  it('keeps an edit that lands while the database is being read', async () => {
    const { api, db, ready } = build(true);
    await ready;
    clash(db, '5300700');
    await put(api, mine(5300700));
    // The window sends another edit while the renumber waits on the database
    const read = db.selectRows.bind(db);
    let edited = false;
    db.selectRows = async (table: string, where: any) => {
      const rows = await read(table, where);
      if (!edited) {
        edited = true;
        await put(api, { ...mine(5300700), name: 'Edited meanwhile' });
      }
      return rows;
    };
    const done: any = await api.resolveIdConflicts();
    expect(done.ok).toBe(true);
    const npc = ((await api.projectEntities()) as any).value.npcs[0];
    expect(npc.name).toBe('Edited meanwhile');
    expect(npc.spawns[0].guid).toBe(5300701);
  });

  it('one undo puts the NPC spawn back, and keeps a 3D view spawn the database has taken the old id of', async () => {
    const { api, db, ready, session } = build(true);
    await ready;
    db.insert('creature_template_model', { CreatureID: '1423', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1' });
    const at = { x: -9000, y: 50, z: 60, orientation: 0, rotation: null };
    const added: any = await api.worldAddSpawn('creature', 1423, 0, at, 5300800);
    expect(added.ok, JSON.stringify(added)).toBe(true);
    await put(api, mine(5300700));
    clash(db, '5300700');
    db.insert('creature', { guid: '5300800', id1: '1424', map: '0', position_x: '1', position_y: '1', position_z: '1' });
    const done: any = await api.resolveIdConflicts();
    expect(done.value).toEqual({ renamed: 2 });
    // Read from the session: the API's layer read hides a placed spawn whose guid the database holds
    const renumbered = session.world.get().added.map((a) => a.guid)[0]!;
    expect(renumbered).toBeGreaterThan(5300800);

    const undone: any = await api.historyUndo();
    expect(((await api.projectEntities()) as any).value.npcs[0].spawns[0].guid).toBe(5300700);
    // The database holds 5300800 now, so the spawn cannot go back to it; it stays, renumbered, and the note says why
    expect(session.world.get().added.map((a) => a.guid)).toEqual([renumbered]);
    expect(JSON.stringify(undone.value)).toContain('Could not undo: spawn 5300800 is now in the database');
  });

  it('undoes a renumber of a 3D view spawn the database has not taken the old id of', async () => {
    const { api, db, ready, session } = build(true);
    await ready;
    db.insert('creature_template_model', { CreatureID: '1423', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1' });
    await api.worldAddSpawn('creature', 1423, 0, { x: -9000, y: 50, z: 60, orientation: 0, rotation: null }, 5300800);
    db.insert('creature', { guid: '5300800', id1: '1424', map: '0', position_x: '1', position_y: '1', position_z: '1' });
    await api.resolveIdConflicts();
    // The other spawn leaves the database (the server's content moved again), so the old id is free
    db.selectRows = async () => [];
    await api.historyUndo();
    expect(session.world.get().added.map((a) => a.guid)).toEqual([5300800]);
  });
});

describe('allocateIds still hands out the same ids', () => {
  it('above the database and the project', async () => {
    const { api, db, ready } = build(true);
    await ready;
    db.insert('creature', { guid: '100', id1: '1423' });
    await put(api, mine(5000));
    expect(((await api.allocateIds('creatureSpawn', 2)) as any).value).toEqual([5001, 5002]);
  });
});

describe('request checks', () => {
  it('take no arguments', () => {
    expect(parseRequest('idConflicts', []).ok).toBe(true);
    expect(parseRequest('resolveIdConflicts', []).ok).toBe(true);
    expect(parseRequest('idConflicts', [1]).ok).toBe(false);
    expect(parseRequest('resolveIdConflicts', ['x']).ok).toBe(false);
  });
});
