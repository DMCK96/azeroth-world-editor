import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { newNpc, newSpawn, type CustomNpc, type GossipMenu } from '../../src/core/entities/model';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

async function setup() {
  const db = forkDb();
  const written = new Map<string, string>();
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async (path: string, text: string) => { written.set(path, text); }, ensureDir: async () => {}, listDir: async () => [] },
    now: () => new Date('2026-10-09T00:00:00Z'), session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, db, written };
}

const root: GossipMenu = {
  menuId: 932535, textId: 9780013, locked: false, greeting: [{ text: 'Hail', textFemale: '', probability: 1 }],
  options: [
    { optionId: 0, icon: 1, text: 'Browse', action: { kind: 'service', type: 3, npcFlag: 128 }, kept: false },
    { optionId: 1, icon: 0, text: 'More', action: { kind: 'menu', menuId: 932536 }, kept: false },
  ],
};
const sub: GossipMenu = { menuId: 932536, textId: 9780014, locked: false, greeting: [{ text: 'Farewell', textFemale: '', probability: 1 }], options: [{ optionId: 0, icon: 0, text: 'Bye', action: { kind: 'close' }, kept: false }] };
const host: CustomNpc = { ...newNpc(12000001), name: 'Hela', displayId: 1, gossip: true, vendor: [{ item: 159, maxCount: 0, restockSecs: 0, extendedCost: 0 }], spawns: [{ ...newSpawn(6000001), x: 1 }], gossipMenu: { menus: [root, sub] } };

describe('exporting a new NPC with a gossip menu', () => {
  it('writes its menus, texts and options in the project patch, and the revert takes them away', async () => {
    const { api, written } = await setup();
    await api.putProjectEntities({ npcs: [host], objects: [], items: [] });
    const out: any = await api.exportProject();
    expect(out.ok, JSON.stringify(out.error)).toBe(true);
    expect(out.value.sql).toMatch(/INSERT INTO `gossip_menu` \(.*\) VALUES \(932535, 9780013/);
    expect(out.value.sql).toMatch(/INSERT INTO `npc_text` \(.*\) VALUES \(9780013, 'Hail'/);
    expect(out.value.sql).toMatch(/INSERT INTO `gossip_menu_option` \(.*\) VALUES[\s\S]*\(932535, 1, /);
    expect(out.value.sql).toMatch(/INSERT INTO `creature_template` \(.*\) VALUES \(12000001,.*932535/);
    const revert = written.get(out.value.revertPath)!;
    expect(revert).toMatch(/DELETE FROM `gossip_menu_option` WHERE `MenuID` = 932535 AND `OptionID` = 1/);
    expect(revert).toMatch(/DELETE FROM `npc_text` WHERE `ID` = 9780013/);
  });

  it('keeps the project NPC\'s gossip rows out of a quest\'s Changes list', async () => {
    const { api } = await setup();
    await api.putProjectEntities({ npcs: [host], objects: [], items: [] });
    const opened: any = await api.newQuest();
    const aggregate = opened.value.aggregate;
    aggregate.values['quest_template.LogTitle'] = 'Say hello';
    aggregate.values.creature_queststarter = [{ id: 12000001 }];
    await api.updateQuest(aggregate);
    const preview: any = await api.previewChanges(aggregate.questId);
    expect(preview.ok).toBe(true);
    expect(preview.value.filter((d: any) => ['gossip_menu', 'gossip_menu_option', 'npc_text'].includes(d.table))).toEqual([]);
  });
});
