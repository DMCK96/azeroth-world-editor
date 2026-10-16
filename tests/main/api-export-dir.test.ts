import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { createApi, type ApiDeps } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const profile = { name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd', password: 'p' };

/** Exports quest 60001 and returns the folder its patch landed in. */
async function exportFolder(deps: Partial<ApiDeps>, exportDir?: string): Promise<string> {
  const db = forkDb();
  db.insert('quest_template', { ID: '60001', LogTitle: 'Wolves' });
  db.insert('creature_template', { entry: '100', name: 'Marshal', npcflag: '2' });
  db.insert('creature_queststarter', { id: '100', quest: '60001' });
  db.insert('creature_questender', { id: '100', quest: '60001' });
  const written: string[] = [];
  const api = createApi({
    store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async (p) => { written.push(p); }, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date('2026-09-25T10:00:00Z'),
    // A project file carries a folder of its own; export must not use it.
    session: createProjectSession(defaultProjectMeta('P', join('someone-else', 'sql'))), projects: {} as ProjectController,
    ...deps,
  });
  const rec: any = await api.saveProfile({ ...profile, ...(exportDir === undefined ? {} : { exportDir }) });
  expect((await api.connect(rec.value.id)).ok).toBe(true);
  expect((await api.openQuest(60001)).ok).toBe(true);
  const result: any = await api.exportQuest(60001);
  expect(result.ok).toBe(true);
  expect(written).toEqual([result.value.path]);
  return result.value.path.slice(0, -'/rev_20260925_01_wolves.sql'.length);
}

describe('export folder', () => {
  it("writes patches to the connection's export folder", async () => {
    expect(await exportFolder({ defaultExportDir: join('C:', 'docs') }, ' D:\patches ')).toBe('D:\patches');
  });

  it('falls back to the default folder when the connection names none', async () => {
    expect(await exportFolder({ defaultExportDir: join('C:', 'docs') })).toBe(join('C:', 'docs'));
  });

  it('lets the override win, as tests need', async () => {
    expect(await exportFolder({ defaultExportDir: join('C:', 'docs'), exportDirOverride: join('T:', 'tmp') }, 'D:\patches')).toBe(join('T:', 'tmp'));
  });
});
