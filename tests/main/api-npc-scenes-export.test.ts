import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { newNpc, newSpawn, type CustomNpc } from '../../src/core/entities/model';
import { blankNpcScene, type NpcScene } from '../../src/core/scripts/npc-scenes';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

async function setup() {
  const db = forkDb();
  const written = new Map<string, string>();
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async (path: string, text: string) => { written.set(path, text); }, ensureDir: async () => {}, listDir: async () => [] },
    now: () => new Date('2026-10-10T00:00:00Z'), session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, db, written };
}

const say = (text: string) => ({ kind: 'say' as const, text, style: 'say' as const, waitMs: 0 });
const scene = (id: string, over: Partial<NpcScene> = {}): NpcScene => ({ ...blankNpcScene(id), steps: [say('Hi')], ...over });
const hela = (scenes: NpcScene[]): CustomNpc => ({ ...newNpc(12000001), name: 'Hela', displayId: 1, spawns: [{ ...newSpawn(6000001), x: 1 }], scenes });

describe('exporting an NPC with scenes', () => {
  it('writes the scenes in the project patch, and the revert takes them away', async () => {
    const { api, written } = await setup();
    await api.putProjectEntities({ npcs: [hela([scene('s1')])], objects: [], items: [] });
    const out: any = await api.exportProject();
    expect(out.ok, JSON.stringify(out.error)).toBe(true);
    expect(out.value.sql).toMatch(/INSERT INTO `smart_scripts` \(.*\) VALUES \(12000001, 0, 0, 0, .*'AQC npc12000001 s1/);
    expect(out.value.sql).toMatch(/INSERT INTO `creature_text` \(.*'AQC npc12000001 s1/);
    expect(out.value.sql).toMatch(/UPDATE `creature_template` SET `AIName` = 'SmartAI' WHERE `entry` = 12000001/);
    expect(written.get(out.value.revertPath)!).toMatch(/DELETE FROM `smart_scripts` WHERE `entryorguid` = 12000001 AND `source_type` = 0/);
  });

  it('deletes the rows of a scene since removed, conditions and waypoints too, and does not touch AIName', async () => {
    const { api, db } = await setup();
    db.insert('creature_template', { entry: '12000001', name: 'Hela', AIName: 'SmartAI' });
    db.insert('smart_scripts', { entryorguid: '12000001', source_type: '0', id: '0', link: '0', event_type: '1', comment: 'AQC npc12000001 s1: old' });
    db.insert('creature_text', { CreatureID: '12000001', GroupID: '0', ID: '0', Text: 'old', comment: 'AQC npc12000001 s1: old' });
    db.insert('conditions', { SourceTypeOrReferenceId: '22', SourceGroup: '1', SourceEntry: '12000001', SourceId: '0', ElseGroup: '0', ConditionTypeOrReference: '8', ConditionTarget: '0', ConditionValue1: '1', ConditionValue2: '0', ConditionValue3: '0', Comment: 'AQC npc12000001 s1: only when' });
    db.insert('waypoints', { entry: '9001', pointid: '1', position_x: '0', position_y: '0', position_z: '0', point_comment: 'AQC npc12000001 s1: point 1' });
    await api.putProjectEntities({ npcs: [hela([])], objects: [], items: [] });
    const out: any = await api.exportProject();
    expect(out.ok, JSON.stringify(out.error)).toBe(true);
    for (const table of ['smart_scripts', 'conditions', 'waypoints', 'creature_text']) expect(out.value.sql).toMatch(new RegExp(`DELETE FROM \`${table}\``));
    expect(out.value.sql).not.toMatch(/SET `AIName`/);
  });

  it("keeps a fight and an NPC's scene on one NPC off each other's ids and text groups", async () => {
    const { api } = await setup();
    const npc: CustomNpc = {
      ...hela([scene('s1', { steps: [say('a'), { ...say('b'), waitMs: 1000 }] })]),
      fight: { phases: [], abilities: [], reactions: [{ id: 'r1', when: { kind: 'aggro' }, phases: [], steps: [{ kind: 'say', text: 'Fight', style: 'say', waitMs: 0 }] }] },
    } as CustomNpc;
    await api.putProjectEntities({ npcs: [npc], objects: [], items: [] });
    const out: any = await api.exportProject();
    expect(out.ok, JSON.stringify(out.error)).toBe(true);
    // Every row of the table's one INSERT: the first follows VALUES, the others start a line
    const rowsOf = (table: string): string => String(out.value.sql).match(new RegExp('INSERT INTO `' + table + '` [\\s\\S]*?;\\n'))?.[0] ?? '';
    const keys = [...rowsOf('smart_scripts').matchAll(/(?:VALUES |\n)\((\d+), (\d+), (\d+), (\d+),/g)].map((m: RegExpMatchArray) => m.slice(1, 5).join('/'));
    expect(keys.length).toBeGreaterThan(2);
    expect(new Set(keys).size).toBe(keys.length);
    const groups = [...rowsOf('creature_text').matchAll(/(?:VALUES |\n)\((\d+), (\d+), (\d+),/g)].map((m: RegExpMatchArray) => m.slice(1, 4).join('/'));
    expect(groups.length).toBeGreaterThan(2);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it("warns when the database's template for the NPC runs another AI, and says nothing about an unknown quest it can find", async () => {
    const { api, db } = await setup();
    db.insert('creature_template', { entry: '12000001', name: 'Hela', AIName: 'ReactorAI', ScriptName: '' });
    db.insert('quest_template', { ID: '60001', LogTitle: 'Q' });
    await api.putProjectEntities({ npcs: [hela([scene('s1', { questId: 60001 })])], objects: [], items: [] });
    const out: any = await api.projectIssues();
    expect(out.value.map((i: any) => i.code)).toEqual(['NPC_SCENES_LOCKED']);
  });
});
