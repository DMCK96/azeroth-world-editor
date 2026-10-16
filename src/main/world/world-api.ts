import type { RawRow, SchemaInfo } from '../../core/db/types';
import type { WorldDb } from '../../core/db/world-db';
import { spawnEntryColumn } from '../../core/db/spawns';
import { rowsOrNone } from '../../core/db/rows-or-none';
import { pickPreset } from '../../core/db/view-spawns';
import type { DeletedTable, Placement, RoutePoint, WorldAddedSpawn, WorldDeletedSpawn, WorldEventEdit, WorldLook, WorldMovementEdit, WorldRespawnEdit, WorldRouteEdit, WorldSpawnEdit, WorldSpawnKind } from '../../core/world/layer';
import { spawnEventRows } from '../../core/entities/spawn-events-read';
import { sameRows } from '../../core/entities/existing';
import { SAME_SPOT } from '../../core/ids/kinds/spawn-guid';
import { movementOfRow, sameMovement, type Movement } from '../../core/world/movement';

/**
 * What the world layer reads from the world database: a spawn's placement and a route's points as
 * the database has them (the originals an edit is measured against), how many spawns walk a route,
 * and whether the database has moved away from an original since it was read.
 */

const num = (value: string | null | undefined, fallback = 0): number => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Differences smaller than this are the same place: the database rounds floats */
const SAME = 1e-4;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= SAME;

const hasTable = async (db: WorldDb, table: string): Promise<boolean> => (await db.columns(table)).length > 0;

const placementOf = (kind: WorldSpawnKind, row: RawRow): Placement => ({
  x: num(row.position_x),
  y: num(row.position_y),
  z: num(row.position_z),
  orientation: num(row.orientation),
  rotation:
    kind === 'gameobject' && 'rotation0' in row
      ? [num(row.rotation0), num(row.rotation1), num(row.rotation2), num(row.rotation3, 1)]
      : null,
});

/** A spawn as the database has it, with its entry, name and map; null when it is gone */
export async function readPlacement(
  db: WorldDb,
  kind: WorldSpawnKind,
  guid: number,
): Promise<{ entry: number; name: string; map: number; placement: Placement } | null> {
  const [row] = await db.selectRows(kind, { guid: String(guid) });
  if (!row) return null;
  const entry = num(row[spawnEntryColumn(kind, (await db.columns(kind)).map((c) => c.name))]);
  const template = kind === 'creature' ? 'creature_template' : 'gameobject_template';
  const [named] = await db.selectRows(template, { entry: String(entry) });
  return { entry, name: named?.name ?? '', map: num(row.map), placement: placementOf(kind, row) };
}

/**
 * What an existing NPC or object looks like, as the 3D view draws it: its name, first model (display
 * and scale) and, for an NPC, the weapons of its first equipment row and the preset that dresses it.
 * Null when the database has no such template.
 */
export async function readTemplateLook(db: WorldDb, kind: WorldSpawnKind, entry: number): Promise<{ name: string; look: WorldLook } | null> {
  const key = { entry: String(entry) };
  if (kind === 'gameobject') {
    const [row] = await db.selectRows('gameobject_template', key);
    return row ? { name: row.name ?? '', look: { displayId: num(row.displayId), scale: num(row.size, 1) || 1, equipment: [0, 0, 0], preset: null, objectType: num(row.type, -1) } } : null;
  }
  const [row] = await db.selectRows('creature_template', key);
  if (!row) return null;
  // The first model, as the view draws a spawn of it; a database before `creature_template_model` keeps it in `modelid1`
  const models = (await hasTable(db, 'creature_template_model')) ? await db.selectRows('creature_template_model', { CreatureID: String(entry) }) : [];
  const model = [...models].sort((a, b) => num(a.Idx) - num(b.Idx))[0];
  const displayId = model ? num(model.CreatureDisplayID) : num(row.modelid1);
  const scale = (model ? num(model.DisplayScale, 1) : num(row.scale, 1)) || 1;
  // A spawn is written holding its template's first equipment row (equipment_id 1), as a quest's export does
  const [held] = (await hasTable(db, 'creature_equip_template')) ? await db.selectRows('creature_equip_template', { CreatureID: String(entry), ID: '1' }) : [];
  const equipment: [number, number, number] = held ? [num(held.ItemID1), num(held.ItemID2), num(held.ItemID3)] : [0, 0, 0];
  const presets = (await hasTable(db, 'creature_display_preset')) ? await db.selectRows('creature_display_preset', key) : [];
  return { name: row.name ?? '', look: { displayId, scale, equipment, preset: presets.length > 0 ? pickPreset(presets, entry, displayId) : null } };
}

/**
 * How the database stands to a placed spawn's id: `inDatabase` when its row is the very same NPC or object (same entry, map and
 * spot, as an applied patch leaves it), `drifted` when a different thing holds the id (the patch would replace it)
 */
export async function addedStanding(db: WorldDb, spawn: WorldAddedSpawn): Promise<{ drifted: boolean; inDatabase: boolean }> {
  const held = await readPlacement(db, spawn.kind, spawn.guid);
  if (held === null) return { drifted: false, inDatabase: false };
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= SAME_SPOT;
  const p = spawn.placement;
  const same = held.entry === spawn.entry && held.map === spawn.map && near(held.placement.x, p.x) && near(held.placement.y, p.y) && near(held.placement.z, p.z);
  return { drifted: !same, inDatabase: same };
}

/** Every `waypoint_data` column a point keeps as it is; the rest are what the view edits */
const EDITED = new Set(['id', 'point', 'position_x', 'position_y', 'position_z']);

/** A route's points in `point` order, each with its other columns; none when the route is gone */
export async function readRoute(db: WorldDb, pathId: number): Promise<RoutePoint[]> {
  const rows = await db.selectRows('waypoint_data', { id: String(pathId) });
  return [...rows]
    .sort((a, b) => num(a.point) - num(b.point))
    .map((row) => ({
      x: num(row.position_x),
      y: num(row.position_y),
      z: num(row.position_z),
      rest: Object.fromEntries(Object.entries(row).filter(([column]) => !EDITED.has(column))),
    }));
}

/** Spawns that walk a route: their own addon names it, or their template's does */
export async function countWalkers(db: WorldDb, pathId: number): Promise<number> {
  const own = (await hasTable(db, 'creature_addon')) ? (await db.selectRows('creature_addon', { path_id: String(pathId) })).length : 0;
  if (!(await hasTable(db, 'creature_template_addon'))) return own;
  const entries = (await db.selectRows('creature_template_addon', { path_id: String(pathId) })).map((r) => r.entry ?? '');
  if (entries.length === 0) return own;
  const entryColumn = spawnEntryColumn('creature', (await db.columns('creature')).map((c) => c.name));
  return own + (await db.selectRows('creature', { [entryColumn]: entries })).length;
}

/** The distinct NPC entries that walk a route (a spawn's addon or a template's names it), with template names, ascending */
export async function readWalkerEntries(db: WorldDb, pathId: number): Promise<{ entry: number; name: string }[]> {
  const entries = new Set<number>();
  if (await hasTable(db, 'creature_addon')) {
    for (const own of await db.selectRows('creature_addon', { path_id: String(pathId) })) {
      const spawn = own.guid ? await readPlacement(db, 'creature', Number(own.guid)) : null;
      if (spawn) entries.add(spawn.entry);
    }
  }
  if (await hasTable(db, 'creature_template_addon')) {
    for (const row of await db.selectRows('creature_template_addon', { path_id: String(pathId) })) {
      if (row.entry) entries.add(Number(row.entry));
    }
  }
  const out: { entry: number; name: string }[] = [];
  for (const entry of [...entries].sort((a, b) => a - b)) {
    const [named] = await db.selectRows('creature_template', { entry: String(entry) });
    out.push({ entry, name: named?.name ?? '' });
  }
  return out;
}

/** The name of an NPC that walks a route (its own spawn's, else its template's), or undefined */
export async function routeWalkerName(db: WorldDb, pathId: number): Promise<string | undefined> {
  if (await hasTable(db, 'creature_addon')) {
    const [own] = await db.selectRows('creature_addon', { path_id: String(pathId) });
    if (own?.guid) {
      const spawn = await readPlacement(db, 'creature', Number(own.guid));
      if (spawn?.name) return spawn.name;
    }
  }
  if (await hasTable(db, 'creature_template_addon')) {
    const [template] = await db.selectRows('creature_template_addon', { path_id: String(pathId) });
    if (template?.entry) {
      const [named] = await db.selectRows('creature_template', { entry: template.entry });
      if (named?.name) return named.name;
    }
  }
  return undefined;
}

/** Whether the database no longer holds a spawn's original placement */
export async function spawnDrifted(db: WorldDb, edit: WorldSpawnEdit): Promise<boolean> {
  const now = await readPlacement(db, edit.kind, edit.guid);
  if (!now) return true;
  const a = now.placement;
  const b = edit.original;
  const turned = a.rotation && b.rotation ? a.rotation.some((v, i) => !near(v, b.rotation![i]!)) : false;
  return !near(a.x, b.x) || !near(a.y, b.y) || !near(a.z, b.z) || !near(a.orientation, b.orientation) || turned;
}

/** Whether the database no longer holds a route's original points */
export async function routeDrifted(db: WorldDb, edit: WorldRouteEdit): Promise<boolean> {
  const now = await readRoute(db, edit.pathId);
  return now.length !== edit.original.length || now.some((p, i) => !near(p.x, edit.original[i]!.x) || !near(p.y, edit.original[i]!.y) || !near(p.z, edit.original[i]!.z));
}

/** The tables a world patch writes, as the export renders them */
export async function worldSchema(db: WorldDb, hash: string): Promise<SchemaInfo> {
  const tables: SchemaInfo['tables'] = {};
  for (const table of ['creature', 'gameobject', 'waypoint_data', 'creature_addon', 'pool_template', 'pool_creature', 'pool_gameobject', 'pool_pool', 'game_event_creature']) tables[table] = await db.columns(table);
  return { tables, forbidden: [], hash };
}

/**
 * An NPC spawn's movement as the database has it, with its entry, name and map: its own addon's path,
 * else its template's (what the server walks today). `addonRow` says whether the spawn has its own
 * addon row, which decides whether a new path updates it or writes one. Null when the spawn is gone.
 */
export async function readMovement(
  db: WorldDb,
  guid: number,
): Promise<{
  entry: number;
  name: string;
  map: number;
  movement: Movement;
  addonRow: boolean;
  addonSeed?: Record<string, string | null>;
  originalRaw: { wander: number; type: number };
} | null> {
  const [row] = await db.selectRows('creature', { guid: String(guid) });
  if (!row) return null;
  const entry = num(row[spawnEntryColumn('creature', (await db.columns('creature')).map((c) => c.name))]);
  const [named] = await db.selectRows('creature_template', { entry: String(entry) });
  const [addon] = (await hasTable(db, 'creature_addon')) ? await db.selectRows('creature_addon', { guid: String(guid) }) : [];
  const [templateAddon] = !addon && (await hasTable(db, 'creature_template_addon')) ? await db.selectRows('creature_template_addon', { entry: String(entry) }) : [];
  const movement = movementOfRow({ MovementType: row.MovementType, wander_distance: row.wander_distance, path_id: (addon ?? templateAddon)?.path_id ?? null });
  // A spawn row written later replaces the template's addon, so it starts as a copy of it
  const addonSeed = templateAddon ? Object.fromEntries(Object.entries(templateAddon).filter(([column]) => column !== 'entry' && column !== 'path_id')) : undefined;
  return {
    entry, name: named?.name ?? '', map: num(row.map), movement, addonRow: addon !== undefined,
    ...(addonSeed ? { addonSeed } : {}),
    originalRaw: { wander: num(row.wander_distance), type: num(row.MovementType) },
  };
}

/** Whether the database no longer holds an NPC's original movement; a placed spawn's never drifts */
export async function movementDrifted(db: WorldDb, edit: WorldMovementEdit, placed: boolean): Promise<boolean> {
  if (placed) return false;
  const now = await readMovement(db, edit.guid);
  return !now || !sameMovement(now.movement, edit.original);
}

/** A spawn's respawn time as the database has it, with its entry, name and map; null when it is gone */
export async function readRespawn(db: WorldDb, kind: WorldSpawnKind, guid: number): Promise<{ entry: number; name: string; map: number; secs: number } | null> {
  const [row] = await db.selectRows(kind, { guid: String(guid) });
  if (!row) return null;
  const entry = num(row[spawnEntryColumn(kind, (await db.columns(kind)).map((c) => c.name))]);
  const template = kind === 'creature' ? 'creature_template' : 'gameobject_template';
  const [named] = await db.selectRows(template, { entry: String(entry) });
  return { entry, name: named?.name ?? '', map: num(row.map), secs: num(row.spawntimesecs) };
}

/** An NPC spawn's own game event rows with its entry, name and map; null when the spawn is gone */
export async function readSpawnEvents(db: WorldDb, guid: number): Promise<{ entry: number; name: string; map: number; rows: Record<string, string | null>[] } | null> {
  const spawn = await readRespawn(db, 'creature', guid);
  if (!spawn) return null;
  const rows = ((await spawnEventRows(db, [guid])).get(guid) ?? []).sort((a, b) => Number(a.eventEntry) - Number(b.eventEntry));
  return { entry: spawn.entry, name: spawn.name, map: spawn.map, rows };
}

/** Whether the database no longer holds a spawn's original game event rows */
export async function spawnEventsDrifted(db: WorldDb, edit: WorldEventEdit): Promise<boolean> {
  const now = await readSpawnEvents(db, edit.guid);
  return !now || !sameRows(edit.original, now.rows);
}

/** Whether the database no longer holds a spawn's original respawn time */
export async function respawnDrifted(db: WorldDb, edit: WorldRespawnEdit): Promise<boolean> {
  const now = await readRespawn(db, edit.kind, edit.guid);
  return !now || now.secs !== edit.original;
}

/** The tables whose rows hang on a spawn's guid, by the kind of spawn */
const DEPENDENTS: Record<WorldSpawnKind, DeletedTable[]> = {
  creature: ['creature_addon', 'game_event_creature', 'game_event_model_equip', 'pool_creature'],
  gameobject: ['gameobject_addon', 'game_event_gameobject', 'pool_gameobject'],
};

/**
 * A spawn as the database has it, whole, for deleting it: its own row first, then the rows that hang
 * on its guid (a table the database does not have gives none). Null when the spawn is gone.
 */
export async function readDeletedSpawn(db: WorldDb, kind: WorldSpawnKind, guid: number): Promise<WorldDeletedSpawn | null> {
  const spawn = await readPlacement(db, kind, guid);
  if (!spawn) return null;
  const key = { guid: String(guid) };
  const [own] = await db.selectRows(kind, key);
  // Gone between the two reads
  if (!own) return null;
  const rows: WorldDeletedSpawn['rows'] = [{ table: kind, row: { ...own } }];
  for (const table of DEPENDENTS[kind]) {
    for (const row of await rowsOrNone(db, table, key)) rows.push({ table, row: { ...row } });
  }
  return { kind, guid, entry: spawn.entry, name: spawn.name, map: spawn.map, placement: spawn.placement, rows };
}

/** Whether the database no longer holds a deleted spawn's row as it was when it was deleted */
export async function deletedDrifted(db: WorldDb, deleted: WorldDeletedSpawn): Promise<boolean> {
  const [now] = await db.selectRows(deleted.kind, { guid: String(deleted.guid) });
  return !now || !sameRows([deleted.rows[0]!.row], [now]);
}
