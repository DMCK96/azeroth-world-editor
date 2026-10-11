import { join } from 'node:path';
import type { RawRow } from '../../core/db/types';
import { patchFileName, renderPatch, renderStatement } from '../../core/export/render-patch';
import { rowsOrNone } from '../../core/links/context';
import { applyPatchInMemory } from '../../core/roundtrip/apply';
import { compareTables } from '../../core/roundtrip/compare';
import { TOOL_VERSION } from '../../core/version';
import { hasWorldChanges, type WorldLayer } from '../../core/world/layer';
import { SCRIPT_KEYS, SCRIPT_TABLES } from '../../core/scripts/context';
import { readScenes } from '../../core/scripts/model';
import { ENTITY_KEYS, ENTITY_TABLES } from '../../core/entities/context';
import { relationOwners } from '../../core/entities/links';
import { existingDrift } from '../../core/entities/existing';
import { gmCommands } from '../../core/testing/gm';
import type { ExportApi } from '../../shared/ipc';
import type { Services } from './services';
import { fail, run } from './errors';
import { KEY_COLUMNS, patchDate } from './patches';
import { TITLE_FIELD, textOf } from './quests-api';

/** The table a quest-giver fix touches; it is outside the snapshot, so previews add it by hand. */
const CREATURE_TABLE = 'creature_template';
const QUEST_GIVER_BIT = 2;

/** Exporting: the quest and project patches, previewing them, test commands, and applying to the dev database */
export function createExportApi(s: Services): ExportApi {
  const { deps, connected, usable, quests, questOf, projectEntities, questEntities, exportSchema } = s.ctx;
  const { guardWrite, guardProject } = s.checks;
  const { projectPatch, patchFor } = s.patches;
  const { forgetPools } = s.groups;

  return {
    previewChanges: (questId) =>
      run(async () => {
        const live = connected();
        const quest = questOf(questId);
        const { statements, fixes, scriptContext, entityStatements } = await patchFor(live, quest);
        const entityTables = new Set<string>(ENTITY_TABLES);
        const scriptTables = new Set<string>([...SCRIPT_TABLES, ...ENTITY_TABLES]);
        const own = statements.filter((s) => !scriptTables.has(s.table));
        const before = quest.snapshot?.tables ?? {};
        const after = applyPatchInMemory(before, own, KEY_COLUMNS);
        const differences = compareTables(before, after, KEY_COLUMNS);
        // Script rows live outside the quest's snapshot: compared against what the DB holds now.
        const scriptBefore: Record<string, RawRow[]> = {
          smart_scripts: scriptContext.smartScripts,
          creature_text: scriptContext.creatureText,
          conditions: scriptContext.conditions,
          waypoints: scriptContext.waypoints,
          gossip_menu_option: scriptContext.gossipOptions,
          areatrigger: scriptContext.areatriggers,
          areatrigger_scripts: scriptContext.areatriggerScripts,
          creature_template: scriptContext.creatures,
          gameobject_template: scriptContext.gameobjects,
        };
        // New NPCs and objects: compared against what the database holds for their keys now.
        const keysOf = (table: string, column: string): string[] =>
          entityStatements.flatMap((s) => (s.table === table && s.kind !== 'update' && s.kind !== 'set-flag' ? [String((s.kind === 'insert' ? s.row : s.key)[column] ?? '')] : []));
        const entityBefore: Record<string, RawRow[]> = Object.fromEntries(
          await Promise.all(
            ([['creature_template', 'entry'], ['creature_template_model', 'CreatureID'], ['creature', 'guid'], ['gameobject_template', 'entry'], ['gameobject', 'guid'], ['page_text', 'ID'], ['creature_loot_template', 'Entry'], ['gameobject_loot_template', 'Entry'], ['creature_addon', 'guid'], ['waypoint_data', 'id'], ['creature_equip_template', 'CreatureID'], ['npc_vendor', 'entry'], ['creature_default_trainer', 'CreatureId'], ['trainer', 'Id'], ['trainer_spell', 'TrainerId']] as const)
              .map(async ([table, column]) => [table, await rowsOrNone(live.db, table, { [column]: [...new Set(keysOf(table, column))] })] as const),
          ),
        );
        const entityAfter = applyPatchInMemory(entityBefore, entityStatements, ENTITY_KEYS);
        differences.push(...compareTables(entityBefore, entityAfter, ENTITY_KEYS));
        const scriptStatementsOnly = statements.filter((s) => scriptTables.has(s.table) && !entityTables.has(s.table)
          && !(s.kind === 'set-flag' && s.table === CREATURE_TABLE && s.column === 'npcflag' && s.bit === QUEST_GIVER_BIT));
        const scriptAfter = applyPatchInMemory(scriptBefore, scriptStatementsOnly, SCRIPT_KEYS);
        differences.push(...compareTables(scriptBefore, scriptAfter, SCRIPT_KEYS));
        // `creature_template` is not part of the snapshot, so the flag updates are named here.
        for (const fix of fixes) {
          differences.push({
            table: CREATURE_TABLE,
            key: `entry=${fix.entry}`,
            column: 'npcflag',
            before: String(fix.npcflag),
            after: String(fix.npcflag | QUEST_GIVER_BIT),
          });
        }
        return differences;
      }),

    exportProject: () =>
      run(async () => {
        const live = connected();
        const store = projectEntities();
        const layer: WorldLayer = deps.session.world.get();
        if (store.npcs.length + store.objects.length + store.items.length === 0 && !hasWorldChanges(layer)) {
          throw fail('BAD_REQUEST', 'There are no NPCs, objects, items or world changes to export.');
        }
        await guardProject(live);
        const { apply, revert, schema, lootWarnings, eventWarnings } = await projectPatch(live);
        // Applying writes the rows as edited here, so whatever the database changed since is overwritten
        const warnings = [
          ...(await existingDrift(live.db, store)).map((e) => `"${e.name}" changed in the database since it was edited here; applying the patch overwrites that.`),
          ...lootWarnings,
          ...eventWarnings,
        ];
        const date = patchDate(deps.now());
        const sql = renderPatch(apply, schema, { toolVersion: TOOL_VERSION, date, label: 'Project changes', lint: true });
        const revertSql = renderPatch(revert, schema, { toolVersion: TOOL_VERSION, date, label: 'Project changes: revert' });

        // The same folder a quest's patch goes to, numbered per day like quest exports
        const outputDir = deps.exportDirOverride || live.exportDir || deps.defaultExportDir || deps.session.meta().outputDir;
        await deps.fs.ensureDir(outputDir);
        const existing = await deps.fs.listDir(outputDir);
        const sequence = String(existing.filter((name) => name.startsWith(`${date}_`) && name.endsWith('_project.sql')).length).padStart(2, '0');
        const applyPath = join(outputDir, `${date}_${sequence}_project.sql`);
        const revertPath = join(outputDir, `${date}_${sequence}_project_revert.sql`);
        await deps.fs.writeFile(applyPath, sql);
        await deps.fs.writeFile(revertPath, revertSql);
        forgetPools();
        return { applyPath, revertPath, sql, warnings };
      }),

    testCommands: (questId) =>
      run(async () => {
        const live = connected();
        const quest = questOf(questId);
        // What Apply to dev writes: the project patch, then the quest's
        const project = await projectPatch(live);
        const statements = [...project.apply, ...(await patchFor(live, quest)).statements];
        const tables = new Set(statements.map((s) => s.table));
        const creatureTemplates = statements.flatMap((s) => {
          if (s.table !== 'creature_template') return [];
          const entry = s.kind === 'insert' ? s.row.entry : s.key.entry;
          return entry === undefined || entry === null ? [] : [Number(entry)];
        });
        const { npcs, objects } = questEntities(quest.aggregate);
        const spawns = [...npcs, ...objects].flatMap((e) => e.spawns.map((s) => ({ name: e.name || `#${e.entry}`, map: s.map, x: s.x, y: s.y, z: s.z })));
        return gmCommands({
          questId,
          tables,
          creatureTemplates,
          hasStarter: relationOwners(quest.aggregate, 'starter').length > 0,
          spawns,
          newObjectTemplates: objects.length > 0,
          escorts: readScenes(quest.aggregate.values).some((s) => s.steps.some((step) => step.kind === 'startEscort')),
        });
      }),

    exportQuest: (questId) =>
      run(async () => {
        const live = usable();
        const quest = questOf(questId);
        const issues = await guardWrite(live, quest);
        const { statements, warnings } = await patchFor(live, quest);
        const used = questEntities(quest.aggregate);
        const usesProject = used.npcs.length + used.objects.length + used.items.length;

        const date = patchDate(deps.now());
        const sql = renderPatch(statements, exportSchema(live), { toolVersion: TOOL_VERSION, questId, date });

        // The project file's own folder is only a last resort for harnesses that name no default:
        // a project shared between people must not send their patches into someone else's folders.
        const outputDir = deps.exportDirOverride || live.exportDir || deps.defaultExportDir || deps.session.meta().outputDir;
        await deps.fs.ensureDir(outputDir);
        // Several exports of one quest on one day sit side by side, numbered in the order written.
        const marker = `_quest_${questId}_`;
        const existing = await deps.fs.listDir(outputDir);
        const sequence = existing.filter((name) => name.startsWith(`${date}_`) && name.includes(marker)).length;
        const path = join(
          outputDir,
          patchFileName({ date, sequence, questId, title: textOf(quest.aggregate, TITLE_FIELD) }),
        );
        await deps.fs.writeFile(path, sql);
        quests.markExported(questId, path);

        // What Apply to dev runs before this quest; none when the project has nothing of its own
        const store = projectEntities();
        const hasProject = store.npcs.length + store.objects.length + store.items.length > 0 || hasWorldChanges(deps.session.world.get());
        let projectSql: string | null = null;
        if (hasProject) {
          const project = await projectPatch(live);
          projectSql = renderPatch(project.apply, project.schema, { toolVersion: TOOL_VERSION, date, label: 'Project changes', lint: true });
        }
        return { path, sql, warnings, issues: issues.filter((i) => i.severity !== 'error'), usesProject, projectSql };
      }),

    applyToDev: (questId, confirm) =>
      run(async () => {
        if (confirm !== true) {
          throw fail('CONFIRMATION_REQUIRED', 'Applying to the dev database changes it; confirm the SQL first.');
        }
        const live = usable();
        const quest = questOf(questId);
        // The newest dev profile: the one Settings shows and edits (profiles list oldest first).
        const devProfile = deps.store.profiles.list().filter((p) => p.role === 'dev').at(-1);
        if (!devProfile) {
          throw fail('NO_DEV_PROFILE', 'Add a dev database profile before applying a patch to it.');
        }
        await guardWrite(live, quest);
        await guardProject(live);
        const { statements } = await patchFor(live, quest);
        // The project patch first, so the quest's new NPCs, objects and items are there to test
        const project = await projectPatch(live);
        const rendered = [
          ...project.apply.map((s) => renderStatement(s, project.schema)),
          ...statements.map((s) => renderStatement(s, exportSchema(live))),
        ];

        const dev = await deps.openDevDb(deps.store.profiles.getWithPassword(devProfile.id));
        try {
          await dev.execute(rendered);
        } finally {
          await dev.close();
        }
        return { statements: rendered.length };
      }),
  };
}
