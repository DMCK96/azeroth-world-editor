/**
 * Writes the three projects `merge.e2e.ts` merges, with the app's own project writer, into the folder
 * given as the only argument: base.awe, mine.awe and theirs.awe. It runs under tsx, as its own
 * process, because the writer reads the app's version from package.json, which Playwright's loader
 * cannot import.
 *
 *   tsx tests/e2e/merge-projects.ts <folder>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defaultProjectMeta, serializeProject, type ProjectDocument, type ProjectQuest } from '../../src/main/project/project-file';
import { EMPTY_ENTITIES } from '../../src/core/entities/model';
import { EMPTY_WORLD } from '../../src/core/world/layer';

// The quest fields come from the repo's own fixture project, so the quests are ones the editor opens
const FIXTURE = JSON.parse(readFileSync(resolve('tests/e2e/fixtures/v3-project.aqc'), 'utf8')) as {
  quests: [{ aggregate: { values: Record<string, unknown> } }];
};
const ID_FIELDS = [
  'quest_template.ID', 'quest_template_addon.ID', 'quest_details.ID', 'quest_offer_reward.ID', 'quest_request_items.ID', 'quest_mail_sender.QuestId',
];

function quest(questId: number, title: string, x: number): ProjectQuest {
  // A version 3 quest carried its own entities; these projects have none
  const { entities: _entities, ...values } = structuredClone(FIXTURE.quests[0].aggregate.values);
  for (const field of ID_FIELDS) values[field] = questId;
  values['quest_template.LogTitle'] = title;
  return {
    questId, isNew: true, x, y: 0, lastExportPath: null, snapshot: null, fidelity: null,
    aggregate: { questId, isNew: true, values, readOnly: [], sharedItems: {} } as unknown as ProjectQuest['aggregate'],
  };
}

const project = (name: string, quests: ProjectQuest[]): ProjectDocument => ({
  ...defaultProjectMeta(name, ''), quests, world: structuredClone(EMPTY_WORLD), entities: structuredClone(EMPTY_ENTITIES),
});

const dir = process.argv[2];
if (!dir) throw new Error('Usage: tsx tests/e2e/merge-projects.ts <folder>');
writeFileSync(join(dir, 'base.awe'), serializeProject(project('Base', [quest(60001, 'Base', 0)])));
writeFileSync(join(dir, 'mine.awe'), serializeProject(project('Mine', [quest(60001, 'Mine', 0), quest(60002, 'Only mine', 300)])));
writeFileSync(join(dir, 'theirs.awe'), serializeProject(project('Theirs', [quest(60001, 'Theirs', 0), quest(60002, 'Only theirs', 300)])));
