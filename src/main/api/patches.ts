import { projectGossip } from '../../core/entities/gossip-tree';
import type { SchemaInfo } from '../../core/db/types';
import { buildPatch, type PatchStatement, type PatchWarning } from '../../core/export/build-patch';
import { findQuestGiverFixes, type QuestGiverFix } from '../../core/export/quest-giver';
import { defaultColumnValues, importQuest } from '../../core/import/importer';
import { fetchLinkedContext } from '../../core/import/linked-context';
import type { QuestAggregate, Snapshot } from '../../core/model/aggregate';
import { registry } from '../../core/registry';
import { keyColumnsByTable } from '../../core/roundtrip/apply';
import { verifyRoundTrip, type FidelityReport } from '../../core/roundtrip/verify';
import { hasWorldChanges, movementsOf, worldStatements, type SpawnDefaults, type WorldLayer } from '../../core/world/layer';
import { worldSchema } from '../world/world-api';
import { compileScenes, mergeCompiled, type CompiledScripts } from '../../core/scripts/compile';
import { compileFights } from '../../core/combat/compile';
import { compileNpcScenes } from '../../core/scripts/npc-compile';
import { SCRIPT_KEYS, readScriptContext, taggedRows, type ScriptContext } from '../../core/scripts/context';
import { scenesFromRows } from '../../core/scripts/decompile';
import { SCRIPTS_FIELD, readScenes, writeScenes } from '../../core/scripts/model';
import { scriptStatements } from '../../core/scripts/statements';
import { compileEntities } from '../../core/entities/compile';
import { compilePatrols } from '../../core/patrol/compile';
import { ENTITY_KEYS, readEntityContext } from '../../core/entities/context';
import { objectivesOf, questItemsOf, relationOwners } from '../../core/entities/links';
import { existingStatements, newLootIds } from '../../core/entities/existing';
import { newOnly } from '../../core/entities/model';
import { spawnEventPlan, spawnEventStatements } from '../../core/entities/spawn-events';
import { npcSpawnGuids, spawnEventRows, spawnEventWarnings } from '../../core/entities/spawn-events-read';
import type { ProjectQuest } from '../project/project-file';
import type { ApiContext } from './context';
import type { Session } from './connection';

export const KEY_COLUMNS = keyColumnsByTable(registry);

const pad = (n: number): string => String(n).padStart(2, '0');

/** `yyyymmdd` in UTC, so the same export produces the same file name wherever it runs. */
export const patchDate = (now: Date): string =>
  `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;

/**
 * The round-trip gate as the UI needs it: a quest that cannot even be patched in memory is opened
 * and marked unsafe, rather than refusing to open at all, so the user can see what is wrong with it.
 */
export function roundTripOf(
  fresh: { aggregate: QuestAggregate; snapshot: Snapshot },
  schema: SchemaInfo,
): FidelityReport {
  try {
    return verifyRoundTrip({ aggregate: fresh.aggregate, snapshot: fresh.snapshot, schema, registry });
  } catch (error) {
    return {
      ok: false,
      differences: [
        {
          table: '(patch)',
          key: error instanceof Error ? error.message : String(error),
          column: null,
          before: undefined,
          after: undefined,
        },
      ],
    };
  }
}

/** The SQL a quest or the project exports: its statements, the scripts compiled into it, and the revert */
export function createPatches(ctx: ApiContext) {
  const { deps, quests, projectEntities, objectivesByQuest, exportSchema } = ctx;

  /**
   * Every SmartAI row of the quest compiled against the world DB right now: its scenes, then the
   * fights of its new NPCs around them. Every project NPC goes to the fight compiler, so the rows of
   * a fight since removed are deleted.
   */
  async function compileFor(live: Session, aggregate: QuestAggregate): Promise<{ context: ScriptContext; compiled: CompiledScripts }> {
    const scenes = readScenes(aggregate.values);
    const context = await readScriptContext(live.db, aggregate.questId, scenes);
    // The project patch's fight and patrol rows go in first (Apply to dev runs it first): scenes keep off them
    const project = await projectScripts(live);
    const compiled = compileScenes({ questId: aggregate.questId, scenes, objectives: objectivesOf(aggregate), context, taken: project.compiled, gossip: projectGossip(projectEntities().npcs) });
    return { context, compiled };
  }

  /**
   * The SmartAI rows of the project's NPCs: their fights, what they do at patrol points, then their own scenes. Every
   * project NPC goes in, so the rows of a fight or point action since removed are deleted.
   */
  async function projectScripts(live: Session): Promise<{ context: ScriptContext; compiled: CompiledScripts }> {
    const { npcs } = projectEntities();
    const context = await readScriptContext(live.db, 0, [], npcs.map((n) => n.entry));
    const none: CompiledScripts = { inserts: {}, deletes: {}, updates: [], flags: [], warnings: [] };
    const fights = compileFights({ npcs, objectives: objectivesByQuest(), context, taken: none });
    const patrols = compilePatrols({ npcs, context, taken: fights });
    const around = mergeCompiled(fights, patrols);
    const scenes = compileNpcScenes({ npcs, objectives: objectivesByQuest(), context, taken: around, gossip: projectGossip(npcs) });
    return { context, compiled: mergeCompiled(around, scenes) };
  }

  /**
   * The project patch: every new NPC, object and item and their SmartAI rows, the edited existing
   * ones over their own rows, then the world layer's edits, with a revert that deletes what the first
   * part writes, puts the existing ones' original rows back and puts the world back.
   */
  async function projectPatch(live: Session): Promise<{ apply: PatchStatement[]; revert: PatchStatement[]; schema: SchemaInfo; warnings: string[]; lootWarnings: string[]; eventWarnings: string[] }> {
    const store = projectEntities();
    const layer: WorldLayer = deps.session.world.get();
    const all = quests.list();
    const ws = await worldSchema(live.db, live.schema.hash);
    const base = exportSchema(live);
    const schema: SchemaInfo = { ...base, tables: { ...ws.tables, ...base.tables } };
    const givers = all.flatMap((q) => [...relationOwners(q.aggregate, 'starter'), ...relationOwners(q.aggregate, 'ender')]).flatMap((o) => (o.kind === 'creature' ? [o.entry] : []));
    const questItems = all.flatMap((q) => questItemsOf(q.aggregate).map((item) => ({ item, questId: q.questId })));
    // Existing entities edited here are written as edits of their own rows, not compiled as new ones
    const made = newOnly(store);
    const entityContext = await readEntityContext(live.db, made, all.map((q) => q.questId));
    const compiledEntities = compileEntities({
      entities: made, givers, questItems, context: entityContext,
      itemColumns: live.scriptSchema.tables.item_template ? new Set(live.scriptSchema.tables.item_template.map((c) => c.name)) : null,
    });
    const scripts = await projectScripts(live);
    const entityStatements = scriptStatements(compiledEntities, schema).statements;
    const scriptRows = scriptStatements(scripts.compiled, schema).statements;
    let world: { apply: PatchStatement[]; revert: PatchStatement[] } = { apply: [], revert: [] };
    if (hasWorldChanges(layer)) {
      // The rows of placed spawns are made of the database's own columns, so a fork's extra ones are filled
      const spawnDefaults: SpawnDefaults = {};
      for (const kind of ['creature', 'gameobject'] as const) {
        if (layer.added.some((a) => a.kind === kind)) spawnDefaults[kind] = defaultColumnValues(kind, ws);
      }
      // A spawn given a path without an addon row of its own gets one, made of the table's own columns
      const writesAddon = movementsOf(layer).some((m) => !m.addonRow && m.current.pathId !== m.original.pathId);
      const addonDefaults = writesAddon ? defaultColumnValues('creature_addon', ws) : undefined;
      world = worldStatements(layer, defaultColumnValues('waypoint_data', ws), spawnDefaults, addonDefaults);
    }
    // Existing entities edited here: their own rows, written over and put back
    // One given its first loot takes a free loot id when its entry is already someone else's list
    const loot = await newLootIds(live.db, store);
    const edited = existingStatements(store, givers, loot.ids);
    // A row the editor writes new (stock, a trainer's spells) sets only its own columns: the table's other columns take their defaults
    const existing = {
      ...edited,
      apply: edited.apply.map((st): PatchStatement => (st.kind === 'insert' && schema.tables[st.table] ? { ...st, row: { ...defaultColumnValues(st.table, schema), ...st.row } } : st)),
    };
    // NPC spawns' game events: an existing NPC's rule covers every spawn the database has now
    const dbGuids = new Map<number, number[]>();
    for (const npc of store.npcs) if (npc.origin.kind === 'existing') dbGuids.set(npc.entry, await npcSpawnGuids(live.db, npc.entry));
    const eventPlan = spawnEventPlan({ npcs: store.npcs, layer, dbGuids });
    const events = spawnEventStatements(eventPlan, await spawnEventRows(live.db, eventPlan.map((p) => p.guid)));
    // Only the spawns the patch writes are worth a word: the rest stay as the database has them
    const eventsWritten = new Set(events.apply.flatMap((st) => (st.kind === 'delete' ? [Number(st.key.guid)] : [])));
    const eventWarnings = await spawnEventWarnings(live.db, eventPlan.filter((p) => eventsWritten.has(p.guid)), layer, new Map(store.npcs.map((n) => [n.entry, n.name || `NPC ${n.entry}`])));
    const of = (list: readonly PatchStatement[], kind: PatchStatement['kind']) => list.filter((st) => st.kind === kind);
    // Deletes first; the entities before the SmartAI rows that act on them; the world's edits last
    const apply = [
      ...of(entityStatements, 'delete'), ...of(scriptRows, 'delete'),
      ...of(entityStatements, 'insert'),
      ...existing.apply,
      ...of(scriptRows, 'set-flag'), ...of(entityStatements, 'update'), ...of(scriptRows, 'update'), ...of(scriptRows, 'insert'),
      ...world.apply,
      ...events.apply,
    ];
    // The revert takes away every row the entities part wrote, the last written first
    const keysOf = (table: string): readonly string[] => ENTITY_KEYS[table] ?? SCRIPT_KEYS[table] ?? [];
    const written = [...of(entityStatements, 'insert'), ...of(scriptRows, 'insert')].reverse();
    const revert: PatchStatement[] = [];
    const seen = new Set<string>();
    for (const st of written) {
      if (st.kind !== 'insert') continue;
      const key = Object.fromEntries(keysOf(st.table).map((c) => [c, String(st.row[c] ?? '')]));
      const text = `${st.table}:${JSON.stringify(key)}`;
      if (Object.keys(key).length === 0 || seen.has(text)) continue;
      seen.add(text);
      revert.push({ kind: 'delete', table: st.table, key });
    }
    revert.push(...existing.revert);
    revert.push(...world.revert);
    revert.push(...events.revert);
    return { apply, revert, schema, warnings: [...compiledEntities.warnings, ...scripts.compiled.warnings, ...loot.warnings, ...eventWarnings], lootWarnings: loot.warnings, eventWarnings };
  }

  /**
   * A fresh import with the scenes the tool exported for this quest before, rebuilt from their rows,
   * so a quest opened in a new project keeps its scripting editable.
   */
  async function importWithScenes(live: Session, questId: number): Promise<{ aggregate: QuestAggregate; snapshot: Snapshot }> {
    const fresh = await importQuest(live.db, live.schema, registry, questId);
    const tagged = await taggedRows(live.db, 'smart_scripts', 'comment', questId);
    const { scenes } = scenesFromRows(questId, tagged);
    return { ...fresh, aggregate: { ...fresh.aggregate, values: { ...fresh.aggregate.values, [SCRIPTS_FIELD]: writeScenes(scenes) } } };
  }

  async function patchFor(
    live: Session,
    quest: ProjectQuest,
  ): Promise<{ statements: PatchStatement[]; warnings: PatchWarning[]; fixes: QuestGiverFix[]; scriptContext: ScriptContext; entityStatements: PatchStatement[] }> {
    const fixes = await findQuestGiverFixes(live.db, quest.aggregate.values);
    // Read the neighbouring linked rows now rather than trusting the ones the import saw: the
    // edit may name a creature the quest had nothing to do with when it was opened, and those
    // are exactly the rows a new drop source would otherwise be allocated on top of.
    const linkedContext = await fetchLinkedContext({
      db: live.db,
      registry,
      schema: live.schema,
      tables: quest.snapshot?.tables ?? {},
      values: quest.aggregate.values,
    });
    const { statements, warnings } = buildPatch({
      aggregate: quest.aggregate,
      snapshot: quest.snapshot,
      schema: live.schema,
      registry,
      questGiverFixes: fixes.map((f) => f.entry),
      linkedContext,
    });
    const { context: scriptContext, compiled } = await compileFor(live, quest.aggregate);
    const scripts = scriptStatements(compiled, exportSchema(live));
    // The project's new NPCs, objects and items are the project patch's; a quest patch writes none
    const newEntities = { statements: [] as PatchStatement[] };
    const of = (list: readonly PatchStatement[], kind: PatchStatement['kind']) => list.filter((s) => s.kind === kind);
    // Deletes before anything is written; the flags and updates quest scripting puts on NPCs, then
    // the quest's and the scenes' rows.
    const merged = [
      ...of(statements, 'delete'), ...of(scripts.statements, 'delete'),
      ...of(statements, 'set-flag'), ...of(scripts.statements, 'set-flag'),
      ...of(statements, 'update'), ...of(scripts.statements, 'update'),
      ...of(statements, 'insert'), ...of(scripts.statements, 'insert'),
    ];
    const scriptWarnings: PatchWarning[] = compiled.warnings.map((message) => ({ code: 'SCRIPT_WARNING', table: 'smart_scripts', message }));
    return { statements: merged, warnings: [...warnings, ...scriptWarnings], fixes, scriptContext, entityStatements: newEntities.statements };
  }
  return { compileFor, projectScripts, projectPatch, importWithScenes, patchFor };
}

export type Patches = ReturnType<typeof createPatches>;
