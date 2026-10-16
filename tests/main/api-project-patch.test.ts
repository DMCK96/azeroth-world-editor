import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { EMPTY_ENTITIES, newNpc, newSpawn } from '../../src/core/entities/model';
import { forkDb } from '../helpers/fixtures';
import { readOriginalRows } from '../../src/core/entities/existing';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { nextExportSequence } from '../../src/main/api/export-api';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
async function setup() {
  const db = forkDb();
  const written = new Map<string, string>();
  const executed: string[][] = [];
  const session = createProjectSession(defaultProjectMeta('P', 'C:\\out'));
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db,
    openDevDb: async () => ({ execute: async (sql: string[]) => { executed.push(sql); }, close: async () => {} }) as any,
    fs: { writeFile: async (p: string, t: string) => { written.set(p, t); }, ensureDir: async () => {}, listDir: async () => [...written.keys()].map((p) => p.split(/[\\/]/).at(-1)!) },
    now: () => new Date('2026-10-04T12:00:00Z'), session, projects: {} as ProjectController, exportDirOverride: 'C:\\out' } as any);
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  await api.saveProfile({ name: 'd', role: 'dev', host: 'h', port: 1, user: 'u', database: 'dev', password: 'p' });
  return { api, written, executed, session, db };
}
const hela = { ...newNpc(12000001), name: 'Hela', displayId: 1, spawns: [newSpawn(6000001)] };

async function questGivenBy(api: any, entry: number): Promise<any> {
  const opened: any = await api.newQuest();
  const aggregate = opened.value.aggregate;
  aggregate.values['quest_template.LogTitle'] = 'Hela\'s errand';
  aggregate.values.creature_queststarter = [{ id: entry }];
  aggregate.values.creature_questender = [{ id: entry }];
  await api.updateQuest(aggregate);
  return aggregate;
}

describe('the project patch', () => {
  it('writes every project NPC, with a revert that deletes it, to a rev_ file', async () => {
    const { api, written } = await setup();
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [hela] });
    const out: any = await api.exportProject();
    expect(out.ok).toBe(true);
    expect(out.value.applyPath).toMatch(/rev_20261004_01_.*\.sql$/);
    expect(out.value.revertPath).toMatch(/rev_20261004_01_.*_revert\.sql$/);
    expect(out.value.sql).toContain("'Hela'");
    expect(out.value.sql).toContain('AQC npc12000001 ');
    expect(written.get(out.value.revertPath)).toMatch(/DELETE FROM `creature_template` WHERE[\s\S]*12000001/);
  });

  it('says there is nothing to export with no entities and no world edits', async () => {
    const { api } = await setup();
    const out: any = await api.exportProject();
    expect(out.error.message).toBe('There are no NPCs, objects, items or world changes to export.');
  });

  it('a quest patch holds quest rows only and counts the project entities it uses', async () => {
    const { api } = await setup();
    const aggregate = await questGivenBy(api, 12000001);
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [hela] });
    const out: any = await api.exportQuest(aggregate.questId);
    expect(out.ok).toBe(true);
    expect(out.value.sql).not.toContain('INSERT INTO `creature_template`');
    expect(out.value.usesProject).toBe(1);
    expect(out.value.projectSql).toContain('INSERT INTO `creature_template`');
  });

  it('apply to dev runs the project patch, then the quest', async () => {
    const { api, executed } = await setup();
    const aggregate = await questGivenBy(api, 12000001);
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [hela] });
    const out: any = await api.applyToDev(aggregate.questId, true);
    expect(out.ok).toBe(true);
    const all = executed.flat();
    const npcAt = all.findIndex((s) => s.includes('INSERT INTO `creature_template`'));
    const questAt = all.findIndex((s) => s.includes('INSERT INTO `quest_template`'));
    expect(npcAt).toBeGreaterThanOrEqual(0);
    expect(questAt).toBeGreaterThan(npcAt);
  });
});

describe('spawn events in the project patch', () => {
  it("writes a new NPC's spawn events, with a revert that takes them away", async () => {
    const { api, written } = await setup();
    const during = { ...hela, events: { mode: 'during' as const, events: [12] } };
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [during] });
    const out: any = await api.exportProject();
    expect(out.ok).toBe(true);
    expect(out.value.sql).toMatch(/INSERT INTO `game_event_creature` \(`eventEntry`, `guid`\) VALUES \(12, 6000001\)/);
    expect(written.get(out.value.revertPath)).toMatch(/DELETE FROM `game_event_creature` WHERE `guid` = 6000001/);
  });

  it('says on export when an NPC follows an event the database does not have', async () => {
    const { api } = await setup();
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [{ ...hela, events: { mode: 'during' as const, events: [999] } }] });
    const out: any = await api.exportProject();
    expect(out.value.warnings).toContain('Event 999 is not in game_event.');
  });

  it('does not warn about a spawn the patch leaves as the database has it', async () => {
    const { api, db } = await setup();
    db.insert('creature_template', { entry: '1423', name: 'Stormwind Guard', minlevel: '55', maxlevel: '56' });
    db.insert('creature_template_model', { CreatureID: '1423', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1' });
    db.insert('creature', { guid: '80330', id1: '1423', map: '0' });
    db.insert('game_event', { eventEntry: '12', description: 'Darkmoon Faire' });
    db.insert('game_event_creature', { eventEntry: '12', guid: '80330' });
    db.insert('pool_template', { entry: '500', max_limit: '1', description: 'Camp' });
    db.insert('pool_creature', { guid: '80330', pool_entry: '500', chance: '0', description: 'Camp' });
    db.insert('game_event_pool', { eventEntry: '12', pool_entry: '500' });
    const guard = npcFromRows(1423, (await readOriginalRows(db, 'npc', 1423))!, { sharedLoot: 0, spawnCount: 1 });
    expect(guard.events).toEqual({ mode: 'during', events: [12] });
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [{ ...guard, maxLevel: 60 }] });
    const out: any = await api.exportProject();
    expect(out.value.warnings).toEqual([]);
  });

  it('writes nothing for a new NPC that is always in the world and has no rows', async () => {
    const { api } = await setup();
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [hela] });
    const out: any = await api.exportProject();
    expect(out.value.sql).not.toContain('game_event_creature');
  });
});

describe('numbering an export', () => {
  const day = '20261004';

  it('starts at 01 and takes one past the highest number in the folder', () => {
    expect(nextExportSequence([], day)).toBe(1);
    expect(nextExportSequence([`rev_${day}_01_hela.sql`, `rev_${day}_03_hela.sql`], day)).toBe(4);
  });

  it('counts a revert file left behind, so an apply file moved away is not numbered again', () => {
    expect(nextExportSequence([`rev_${day}_01_hela_revert.sql`], day)).toBe(2);
  });

  it('ignores other days and other files, and never goes below what the session already wrote', () => {
    expect(nextExportSequence(['rev_20261003_05_hela.sql', `${day}_07_project.sql`], day)).toBe(1);
    expect(nextExportSequence([], day, 4)).toBe(5);
  });

  it('never writes a second project export to the name of the first, even when the first was moved out', async () => {
    const { api, written } = await setup();
    await api.putProjectEntities({ ...EMPTY_ENTITIES, npcs: [hela] });
    const first: any = await api.exportProject();
    expect(first.value.applyPath).toMatch(/rev_20261004_01_.*\.sql$/);
    written.delete(first.value.applyPath);
    const second: any = await api.exportProject();
    expect(second.value.applyPath).toMatch(/rev_20261004_02_.*\.sql$/);
    expect(second.value.revertPath).toMatch(/rev_20261004_02_.*_revert\.sql$/);
    expect(written.has(first.value.revertPath)).toBe(true);
  });
});
