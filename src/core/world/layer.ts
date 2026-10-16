import type { PatchStatement } from '../export/build-patch';
import type { EventRule, SpawnEvents } from '../entities/model';
import type { ViewPreset } from '../db/view-spawns';
import type { SpawnGroup } from './groups';
import { MOVEMENT_TYPE, sameMovement, type Movement } from './movement';

/**
 * The world layer: edits made in the 3D view to spawns and routes that are not part of any quest
 * (moving Northshire's mailbox, rerouting a guard). Each entry keeps what the database had at its
 * first edit, so it can be listed as before and after, reverted, and written as a patch and its
 * revert. Everything here is pure: each function returns a new layer.
 */

/** Where a spawn stands and how it is turned; `rotation` (x, y, z, w) is an object's, null for an NPC */
export type Placement = { x: number; y: number; z: number; orientation: number; rotation: [number, number, number, number] | null };

export type WorldSpawnKind = 'creature' | 'gameobject';

export interface WorldSpawnEdit {
  kind: WorldSpawnKind;
  guid: number;
  entry: number;
  name: string;
  map: number;
  original: Placement;
  current: Placement;
}

/** One point of a route; `rest` is every other `waypoint_data` column, kept as the database had it */
export type RoutePoint = { x: number; y: number; z: number; rest: Record<string, string | null> };

export interface WorldRouteEdit {
  pathId: number;
  /** Spawns that walk the route, counted at its first edit */
  walkers: number;
  /** The name of an NPC that walks it, read at its first edit, for naming the change */
  name?: string;
  /** The NPCs that walk it, read at its first edit; older layers have none */
  walkerEntries?: { entry: number; name: string }[];
  original: RoutePoint[];
  current: RoutePoint[];
}

/**
 * What a placed spawn's template looked like when it was placed (its display, size and what it holds),
 * kept so the view draws it without asking the database again
 */
export interface WorldLook {
  displayId: number;
  scale: number;
  /** An NPC's held item ids: main hand, off hand, ranged; all 0 for an object */
  equipment: [number, number, number];
  preset: ViewPreset | null;
  /** An object's template `type` (3 is a chest); absent for an NPC and in layers saved before it was kept */
  objectType?: number;
}

/** A spawn of an existing NPC or object placed in the 3D view: a new row, written by the world patch */
export interface WorldAddedSpawn {
  kind: WorldSpawnKind;
  guid: number;
  entry: number;
  name: string;
  map: number;
  placement: Placement;
  look: WorldLook;
  /** Seconds before it respawns; a spawn made in the game's 300 when absent */
  respawnSecs?: number;
  /** An NPC's own game events; absent or 'npc' follows its NPC */
  events?: SpawnEvents;
}

/** How an NPC moves, changed in the view: wander, movement type and its spawn's own path */
export interface WorldMovementEdit {
  guid: number;
  entry: number;
  name: string;
  map: number;
  /** Whether the spawn had a `creature_addon` row at its first edit: its path is then updated, else a row is written */
  addonRow: boolean;
  /**
   * Its template's addon (mount, stand state, auras) when the spawn has no row of its own: a row written
   * to give the spawn a path replaces the template's, so it starts as a copy of it
   */
  addonSeed?: Record<string, string | null>;
  /** `wander_distance` and `MovementType` as the database had them, put back by the revert as they were */
  originalRaw?: { wander: number; type: number };
  original: Movement;
  current: Movement;
}

/** How long a database spawn takes to respawn (`spawntimesecs`), changed in the view */
export interface WorldRespawnEdit {
  kind: WorldSpawnKind;
  guid: number;
  entry: number;
  name: string;
  map: number;
  original: number;
  current: number;
}

/**
 * The game events a database NPC spawn follows of its own, changed in the view. `original` is its
 * `game_event_creature` rows at the first edit; the spawn event writer (`entities/spawn-events.ts`),
 * not the world patch, writes the rows.
 */
export interface WorldEventEdit {
  guid: number;
  entry: number;
  name: string;
  map: number;
  original: Record<string, string | null>[];
  current: EventRule;
}

/** The tables a deleted spawn's rows come from: its own row and what hangs on its guid */
export type DeletedTable =
  | 'creature' | 'gameobject' | 'creature_addon' | 'gameobject_addon' | 'game_event_creature' | 'game_event_gameobject' | 'game_event_model_equip' | 'pool_creature' | 'pool_gameobject';

/**
 * A database spawn deleted in the view. Its rows are kept whole, so the project patch's revert can
 * write them back: `rows[0]` is the spawn's own row, the rest are the rows that hang on its guid.
 */
export interface WorldDeletedSpawn {
  kind: WorldSpawnKind;
  guid: number;
  entry: number;
  name: string;
  map: number;
  /** Where it stood, for naming the change */
  placement: Placement;
  rows: { table: DeletedTable; row: Record<string, string | null> }[];
}

export interface WorldLayer {
  spawns: WorldSpawnEdit[];
  routes: WorldRouteEdit[];
  /** Spawns placed in the view; a project saved before there were any has none */
  added: WorldAddedSpawn[];
  /** NPCs' movement; a project saved before it could be changed has none */
  movements?: WorldMovementEdit[];
  /** Database spawns' respawn times; a project saved before they could be changed has none */
  respawns?: WorldRespawnEdit[];
  /** Spawn groups (the server's pools); a project saved before there were any has none */
  groups?: SpawnGroup[];
  /** Database NPC spawns' own game events; a project saved before they could be changed has none */
  spawnEvents?: WorldEventEdit[];
  /** Database spawns deleted in the view; a project saved before they could be has none */
  deletes?: WorldDeletedSpawn[];
}

export const EMPTY_WORLD: WorldLayer = { spawns: [], routes: [], added: [] };

export const movementsOf = (layer: WorldLayer): WorldMovementEdit[] => layer.movements ?? [];

export const respawnsOf = (layer: WorldLayer): WorldRespawnEdit[] => layer.respawns ?? [];
export const groupsOf = (layer: WorldLayer): SpawnGroup[] => layer.groups ?? [];
export const spawnEventsOf = (layer: WorldLayer): WorldEventEdit[] => layer.spawnEvents ?? [];
export const deletesOf = (layer: WorldLayer): WorldDeletedSpawn[] => layer.deletes ?? [];

/** Whether a database spawn is deleted in the layer */
export const isDeleted = (layer: WorldLayer, kind: WorldSpawnKind, guid: number): boolean => deletesOf(layer).some((d) => d.kind === kind && d.guid === guid);

/** Whether the layer holds anything to export */
export const hasWorldChanges = (layer: WorldLayer): boolean =>
  layer.spawns.length > 0 || layer.routes.length > 0 || layer.added.length > 0 || movementsOf(layer).length > 0 || respawnsOf(layer).length > 0 ||
  groupsOf(layer).length > 0 || spawnEventsOf(layer).length > 0 || deletesOf(layer).length > 0;

/** What a point added in the 3D view has in the columns the view does not edit */
export const NEW_POINT_REST: Record<string, string | null> = {
  orientation: null,
  delay: '0',
  move_type: '0',
  action: '0',
  action_chance: '100',
  wpguid: '0',
};

/**
 * What the 3D view sends back has been through its own maths (a facing turned into a quaternion and
 * back), so places and turns this close are the same
 */
const NEAR = 1e-4;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= NEAR;
const samePlace = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean => near(a.x, b.x) && near(a.y, b.y) && near(a.z, b.z);

/** The turn an object is drawn with: its rotation, or upright when it has none (all zero, as older rows do) */
const drawnTurn = (p: Placement): [number, number, number, number] =>
  p.rotation && p.rotation.some((v) => v !== 0) ? p.rotation : [0, 0, 0, 1];

/** Whether two placements face the same way: an NPC by its facing, an object by its drawn turn (q and -q alike) */
function sameTurn(kind: WorldSpawnKind, a: Placement, b: Placement): boolean {
  if (kind === 'creature') {
    const apart = Math.abs(a.orientation - b.orientation) % (Math.PI * 2);
    return Math.min(apart, Math.PI * 2 - apart) <= NEAR;
  }
  const qa = drawnTurn(a);
  const qb = drawnTurn(b);
  const dot = qa.reduce((sum, v, i) => sum + v * qb[i]!, 0);
  return Math.abs(Math.abs(dot) - 1) <= NEAR;
}

const samePoint = (a: RoutePoint, b: RoutePoint): boolean => {
  const keys = Object.keys(a.rest);
  return (
    samePlace(a, b) &&
    keys.length === Object.keys(b.rest).length &&
    keys.every((k) => Object.prototype.hasOwnProperty.call(b.rest, k) && a.rest[k] === b.rest[k])
  );
};

const sameRoute = (a: readonly RoutePoint[], b: readonly RoutePoint[]): boolean => a.length === b.length && a.every((p, i) => samePoint(p, b[i]!));

/**
 * Moves or turns a spawn; its first original is kept, and an entry back where it began is dropped. A
 * spawn that still faces the way it was stored keeps the stored facing and rotation as they were, so
 * a move alone never rewrites them (an object stored with no rotation is drawn upright, and the view
 * would otherwise send that upright turn back as its own)
 */
export function moveSpawn(layer: WorldLayer, spawn: Omit<WorldSpawnEdit, 'current'>, to: Placement): WorldLayer {
  // A spawn placed in the view has no original to be measured against: it simply stands where it is put
  if (layer.added.some((a) => a.kind === spawn.kind && a.guid === spawn.guid)) {
    return { ...layer, added: layer.added.map((a) => (a.kind === spawn.kind && a.guid === spawn.guid ? { ...a, placement: to } : a)) };
  }
  const known = layer.spawns.find((s) => s.kind === spawn.kind && s.guid === spawn.guid);
  const original = known ? known.original : spawn.original;
  const turned = !sameTurn(spawn.kind, original, to);
  const current = turned ? to : { ...to, orientation: original.orientation, rotation: original.rotation };
  const entry: WorldSpawnEdit = known ? { ...known, current } : { ...spawn, current };
  const unchanged = !turned && samePlace(current, original);
  const spawns = known
    ? layer.spawns.flatMap((s) => (s === known ? (unchanged ? [] : [entry]) : [s]))
    : unchanged
      ? layer.spawns
      : [...layer.spawns, entry];
  return { ...layer, spawns };
}

/** Sets a route's points; its first original and walker count are kept, and a route put back is dropped */
export function setRoute(layer: WorldLayer, route: Omit<WorldRouteEdit, 'current'>, points: RoutePoint[]): WorldLayer {
  const known = layer.routes.find((r) => r.pathId === route.pathId);
  const entry: WorldRouteEdit = known ? { ...known, current: points } : { ...route, current: points };
  const unchanged = sameRoute(entry.current, entry.original);
  const routes = known
    ? layer.routes.flatMap((r) => (r === known ? (unchanged ? [] : [entry]) : [r]))
    : unchanged
      ? layer.routes
      : [...layer.routes, entry];
  return { ...layer, routes };
}

/** Whether a spawn is one placed in the view (not one the database has) */
export const isAdded = (layer: WorldLayer, kind: WorldSpawnKind, guid: number): boolean => layer.added.some((a) => a.kind === kind && a.guid === guid);

/** Places a spawn of an existing NPC or object */
export function addSpawn(layer: WorldLayer, spawn: WorldAddedSpawn): WorldLayer {
  return { ...layer, added: [...layer.added.filter((a) => !(a.kind === spawn.kind && a.guid === spawn.guid)), spawn] };
}

/** Takes back an edit to a database spawn, or removes a placed one with its movement and the new path made for it */
export function revertSpawn(layer: WorldLayer, kind: WorldSpawnKind, guid: number): WorldLayer {
  const placed = isAdded(layer, kind, guid);
  const movement = kind === 'creature' && placed ? movementsOf(layer).find((m) => m.guid === guid) : undefined;
  const newPath = movement?.current.pathId ?? null;
  const next: WorldLayer = {
    ...layer,
    spawns: layer.spawns.filter((s) => !(s.kind === kind && s.guid === guid)),
    added: layer.added.filter((a) => !(a.kind === kind && a.guid === guid)),
    routes: newPath === null ? layer.routes : layer.routes.filter((r) => !(r.pathId === newPath && r.original.length === 0)),
  };
  const reverted = placed && kind === 'creature' ? revertMovement(next, guid) : next;
  return placed ? dropMember(reverted, kind === 'creature' ? 'npc' : 'object', guid) : reverted;
}

/**
 * Deletes a database spawn: it is recorded with its rows, and its other edits (a move, its movement,
 * respawn time and own events) and its place in the layer's groups go with it. A spawn placed in the
 * view is not deleted but taken back out, by `revertSpawn`.
 */
export function deleteSpawn(layer: WorldLayer, deleted: WorldDeletedSpawn): WorldLayer {
  const { kind, guid } = deleted;
  const creature = kind === 'creature';
  const next: WorldLayer = {
    ...layer,
    spawns: layer.spawns.filter((s) => !(s.kind === kind && s.guid === guid)),
    deletes: [...deletesOf(layer).filter((d) => !(d.kind === kind && d.guid === guid)), deleted],
  };
  if (layer.respawns) next.respawns = layer.respawns.filter((r) => !(r.kind === kind && r.guid === guid));
  if (layer.spawnEvents && creature) next.spawnEvents = layer.spawnEvents.filter((e) => e.guid !== guid);
  // A path made in the view for it goes with its movement, as with a placed NPC taken back
  const unwalked = creature && layer.movements ? revertMovement(next, guid) : next;
  return layer.groups ? dropMember(unwalked, creature ? 'npc' : 'object', guid) : unwalked;
}

/** A group as the database has it, less the spawns the layer deletes: what a card or a save must start from */
export function withoutDeletedMembers(group: SpawnGroup, layer: WorldLayer): SpawnGroup {
  const gone = (m: SpawnGroup['members'][number]): boolean => m.type === 'spawn' && isDeleted(layer, m.kind === 'npc' ? 'creature' : 'gameobject', m.guid);
  return group.members.some(gone) ? { ...group, members: group.members.filter((m) => !gone(m)) } : group;
}

/** Takes back a deletion; the list goes altogether when it was the last */
export function revertDelete(layer: WorldLayer, kind: WorldSpawnKind, guid: number): WorldLayer {
  const { deletes: _, ...rest } = layer;
  const left = deletesOf(layer).filter((d) => !(d.kind === kind && d.guid === guid));
  return left.length === 0 ? rest : { ...rest, deletes: left };
}

/** Adds a group, or replaces the one with its id */
export function putGroup(layer: WorldLayer, group: SpawnGroup): WorldLayer {
  const all = groupsOf(layer);
  return { ...layer, groups: all.some((g) => g.id === group.id) ? all.map((g) => (g.id === group.id ? group : g)) : [...all, group] };
}

/** Deletes a group: a new one is forgotten, an existing one is kept as removed */
export function deleteGroup(layer: WorldLayer, group: SpawnGroup): WorldLayer {
  if (group.origin.kind === 'new') return revertGroup(layer, group.id);
  return putGroup(layer, { ...group, removed: true });
}

/** Takes back a group's changes */
export function revertGroup(layer: WorldLayer, id: number): WorldLayer {
  return { ...layer, groups: groupsOf(layer).filter((g) => g.id !== id) };
}

/** Takes a spawn out of every layer group; a new group left with no members goes */
export function dropMember(layer: WorldLayer, kind: 'npc' | 'object', guid: number): WorldLayer {
  const groups = groupsOf(layer).flatMap((g) => {
    const members = g.members.filter((m) => !(m.type === 'spawn' && m.kind === kind && m.guid === guid));
    if (members.length === g.members.length) return [g];
    return members.length === 0 && g.origin.kind === 'new' ? [] : [{ ...g, members }];
  });
  return { ...layer, groups };
}

/** Takes a quest out of every rotation in the layer; a new rotation left with none goes */
export function dropQuestMember(layer: WorldLayer, questId: number): WorldLayer {
  const groups = groupsOf(layer).flatMap((g) => {
    const members = g.members.filter((m) => !(m.type === 'quest' && m.questId === questId));
    if (members.length === g.members.length) return [g];
    return members.length === 0 && g.origin.kind === 'new' ? [] : [{ ...g, members }];
  });
  return { ...layer, groups };
}

/**
 * Takes a group out of every layer group that holds it, as deleting it must: no more of a holder can be
 * up than it has members, and a new holder left with none goes
 */
export function dropGroupMember(layer: WorldLayer, id: number): WorldLayer {
  const groups = groupsOf(layer).flatMap((g) => {
    const members = g.members.filter((m) => !(m.type === 'group' && m.id === id));
    if (members.length === g.members.length) return [g];
    if (members.length === 0 && g.origin.kind === 'new') return [];
    return [{ ...g, members, maxActive: Math.max(1, Math.min(g.maxActive, members.length)) }];
  });
  return { ...layer, groups };
}

/** Sets an NPC's movement; its first original is kept, and one put back is dropped */
export function setMovement(layer: WorldLayer, edit: Omit<WorldMovementEdit, 'current'>, to: Movement): WorldLayer {
  const all = movementsOf(layer);
  const known = all.find((m) => m.guid === edit.guid);
  const entry: WorldMovementEdit = known ? { ...known, current: to } : { ...edit, current: to };
  const unchanged = sameMovement(entry.current, entry.original);
  const movements = known
    ? all.flatMap((m) => (m === known ? (unchanged ? [] : [entry]) : [m]))
    : unchanged
      ? all
      : [...all, entry];
  return { ...layer, movements };
}

/** Takes back an NPC's movement, and the path made for it (one the database does not have) with it */
export function revertMovement(layer: WorldLayer, guid: number): WorldLayer {
  const gone = movementsOf(layer).find((m) => m.guid === guid);
  const newPath = gone?.current.pathId ?? null;
  return {
    ...layer,
    movements: movementsOf(layer).filter((m) => m.guid !== guid),
    routes: newPath === null ? layer.routes : layer.routes.filter((r) => !(r.pathId === newPath && r.original.length === 0)),
  };
}

/** Sets a spawn's respawn time: a placed spawn's own, else an edit that keeps its first original and is dropped when set back to it */
export function setRespawn(layer: WorldLayer, edit: Omit<WorldRespawnEdit, 'current'>, secs: number): WorldLayer {
  if (isAdded(layer, edit.kind, edit.guid)) {
    return { ...layer, added: layer.added.map((a) => (a.kind === edit.kind && a.guid === edit.guid ? { ...a, respawnSecs: secs } : a)) };
  }
  const all = respawnsOf(layer);
  const known = all.find((r) => r.kind === edit.kind && r.guid === edit.guid);
  const entry: WorldRespawnEdit = known ? { ...known, current: secs } : { ...edit, current: secs };
  const rest = all.filter((r) => r !== known);
  const respawns = entry.current === entry.original ? rest : known ? all.map((r) => (r === known ? entry : r)) : [...all, entry];
  return { ...layer, respawns };
}

/**
 * Sets an NPC spawn's own game events: a placed spawn's own, else an edit that keeps its first original.
 * 'npc' takes the spawn's own events away, so it follows its NPC (or, for an NPC the project does not
 * hold, keeps the database's rows).
 */
export function setSpawnEvents(layer: WorldLayer, edit: Omit<WorldEventEdit, 'current'>, to: SpawnEvents): WorldLayer {
  if (isAdded(layer, 'creature', edit.guid)) {
    // Nothing of its own to take away is no change at all
    if (to === 'npc' && layer.added.every((a) => a.kind !== 'creature' || a.guid !== edit.guid || a.events === undefined)) return layer;
    const added = layer.added.map((a) => {
      if (a.kind !== 'creature' || a.guid !== edit.guid) return a;
      const { events: _, ...rest } = a;
      return to === 'npc' ? rest : { ...rest, events: to };
    });
    return { ...layer, added };
  }
  const all = spawnEventsOf(layer);
  const known = all.find((e) => e.guid === edit.guid);
  const rest = all.filter((e) => e !== known);
  if (to === 'npc') return known ? { ...layer, spawnEvents: rest } : layer;
  const entry: WorldEventEdit = known ? { ...known, current: to } : { ...edit, current: to };
  return { ...layer, spawnEvents: known ? all.map((e) => (e === known ? entry : e)) : [...all, entry] };
}

/** Takes back a database spawn's own game events */
export function revertSpawnEvents(layer: WorldLayer, guid: number): WorldLayer {
  return { ...layer, spawnEvents: spawnEventsOf(layer).filter((e) => e.guid !== guid) };
}

/** Takes back a database spawn's respawn time */
export function revertRespawn(layer: WorldLayer, kind: WorldSpawnKind, guid: number): WorldLayer {
  return { ...layer, respawns: respawnsOf(layer).filter((r) => !(r.kind === kind && r.guid === guid)) };
}

/** Takes back a route; a path made in the view takes back the movement that walks it too */
export function revertRoute(layer: WorldLayer, pathId: number): WorldLayer {
  const made = layer.routes.some((r) => r.pathId === pathId && r.original.length === 0);
  return {
    ...layer,
    routes: layer.routes.filter((r) => r.pathId !== pathId),
    ...(made ? { movements: movementsOf(layer).filter((m) => m.current.pathId !== pathId) } : {}),
  };
}

const text = (n: number): string => String(n);

function placementStatement(spawn: WorldSpawnEdit, at: Placement): PatchStatement {
  const set: Record<string, string> = { position_x: text(at.x), position_y: text(at.y), position_z: text(at.z), orientation: text(at.orientation) };
  if (spawn.kind === 'gameobject' && at.rotation) at.rotation.forEach((v, i) => (set[`rotation${i}`] = text(v)));
  return { kind: 'update', table: spawn.kind, key: { guid: text(spawn.guid) }, set };
}

/**
 * What a point has in the columns it does not carry: the database's own defaults for every column it
 * has (a fork's extra `velocity`, say), with a new point's usual values where the database has them
 */
function pointBase(columnDefaults: Record<string, string | null> | undefined): Record<string, string | null> {
  if (!columnDefaults) return NEW_POINT_REST;
  const usual = Object.entries(NEW_POINT_REST).filter(([column]) => column in columnDefaults);
  return { ...columnDefaults, ...Object.fromEntries(usual) };
}

function routeStatements(pathId: number, points: readonly RoutePoint[], base: Record<string, string | null>): PatchStatement[] {
  const id = text(pathId);
  return [
    { kind: 'delete', table: 'waypoint_data', key: { id } },
    ...points.map((p, i): PatchStatement => ({
      kind: 'insert',
      table: 'waypoint_data',
      row: { ...base, id, point: text(i + 1), position_x: text(p.x), position_y: text(p.y), position_z: text(p.z), ...p.rest },
    })),
  ];
}

/** The rows a placed spawn is written as: each table's database defaults, with what the view knows filled in */
export type SpawnDefaults = Partial<Record<WorldSpawnKind, Record<string, string | null>>>;

/** Seconds before a placed spawn respawns, as a spawn made in the game has */
const RESPAWN_SECS = '300';
/** A placed spawn is full-health, visible and idle: an object's `animprogress` and `state` */
const ANIM_FULL = '100';
const GO_READY = '1';
/** Marks the rows this tool wrote, as a quest's export does with its own tag */
export const PLACED_COMMENT = 'ACQC 3D view';

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** The `creature` or `gameobject` row of a placed spawn; only columns the database has are written */
function addedRow(spawn: WorldAddedSpawn, base: Record<string, string | null>): Record<string, string | null> {
  const at = spawn.placement;
  const values: Record<string, string> = {
    guid: text(spawn.guid),
    map: text(spawn.map),
    spawnMask: '1',
    phaseMask: '1',
    position_x: text(at.x),
    position_y: text(at.y),
    position_z: text(at.z),
    orientation: text(at.orientation),
    spawntimesecs: text(spawn.respawnSecs ?? Number(RESPAWN_SECS)),
    Comment: PLACED_COMMENT,
  };
  if (spawn.kind === 'creature') {
    // Stock AzerothCore calls the spawn's NPC `id1`, older forks `id`; both are set, and only the one the database has is kept
    values.id = text(spawn.entry);
    values.id1 = text(spawn.entry);
    values.equipment_id = spawn.look.equipment.some((item) => item > 0) ? '1' : '0';
  } else {
    values.id = text(spawn.entry);
    // Turned about Z by its facing unless the view tilted it
    const [x, y, z, w] = at.rotation && at.rotation.some((v) => v !== 0) ? at.rotation : [0, 0, Math.sin(at.orientation / 2), Math.cos(at.orientation / 2)];
    [x, y, z, w].forEach((v, i) => (values[`rotation${i}`] = text(round6(v))));
    values.animprogress = ANIM_FULL;
    values.state = GO_READY;
  }
  return { ...base, ...Object.fromEntries(Object.entries(values).filter(([column]) => column in base)) };
}

/** A placed spawn as written, and as taken away: deleted by guid first, so the patch can be applied again */
function addedStatements(spawn: WorldAddedSpawn, base: Record<string, string | null> | undefined): { apply: PatchStatement[]; revert: PatchStatement[] } {
  const remove: PatchStatement = { kind: 'delete', table: spawn.kind, key: { guid: text(spawn.guid) } };
  if (!base) throw new Error(`The ${spawn.kind} table's columns are not known, so a placed spawn cannot be written.`);
  return { apply: [remove, { kind: 'insert', table: spawn.kind, row: addedRow(spawn, base) }], revert: [remove] };
}

function movementSet(m: Movement): Record<string, string> {
  return { wander_distance: text(m.wander), MovementType: text(MOVEMENT_TYPE[m.type]) };
}

/**
 * A movement as written and taken back: the spawn's wander and type, and its addon's path when that
 * changed (a spawn with no addon row gets one, over the table's defaults, and the revert deletes it)
 */
function movementStatements(m: WorldMovementEdit, addonDefaults: Record<string, string | null> | undefined): { apply: PatchStatement[]; revert: PatchStatement[] } {
  const key = { guid: text(m.guid) };
  const apply: PatchStatement[] = [{ kind: 'update', table: 'creature', key, set: movementSet(m.current) }];
  const was = m.originalRaw ? { wander_distance: text(m.originalRaw.wander), MovementType: text(m.originalRaw.type) } : movementSet(m.original);
  const revert: PatchStatement[] = [{ kind: 'update', table: 'creature', key, set: was }];
  if (m.current.pathId !== m.original.pathId) {
    const path = (p: number | null) => text(p ?? 0);
    if (m.addonRow) {
      apply.push({ kind: 'update', table: 'creature_addon', key, set: { path_id: path(m.current.pathId) } });
      revert.push({ kind: 'update', table: 'creature_addon', key, set: { path_id: path(m.original.pathId) } });
    } else {
      apply.push({ kind: 'delete', table: 'creature_addon', key }, { kind: 'insert', table: 'creature_addon', row: { ...addonDefaults, ...m.addonSeed, guid: key.guid, path_id: path(m.current.pathId) } });
      revert.push({ kind: 'delete', table: 'creature_addon', key });
    }
  }
  return { apply, revert };
}

/** A deleted spawn's statements: one DELETE per table by guid, its own table last, and the inserts that put its rows back */
function deletedStatements(d: WorldDeletedSpawn): { deletes: PatchStatement[]; inserts: PatchStatement[] } {
  const own = d.rows[0]?.table ?? d.kind;
  const tables = [...new Set(d.rows.map((r) => r.table))].filter((t) => t !== own);
  const deletes = [...tables, own].map((table): PatchStatement => ({ kind: 'delete', table, key: { guid: text(d.guid) } }));
  return { deletes, inserts: d.rows.map((r): PatchStatement => ({ kind: 'insert', table: r.table, row: r.row })) };
}

const POOL_KEYS: [PatchStatement['table'], string][] = [
  ['pool_template', 'entry'],
  ['pool_creature', 'pool_entry'],
  ['pool_gameobject', 'pool_entry'],
  ['pool_pool', 'mother_pool'],
  ['pool_quest', 'pool_entry'],
];

/**
 * A group's rows: the four deletes by its id, and what to write on apply and on revert. Kept apart so
 * every group's deletes can go before any group's inserts. game_event_pool is written only when the event differs from the one the group had.
 */
function groupStatements(g: SpawnGroup): { deletes: PatchStatement[]; apply: PatchStatement[]; revert: PatchStatement[] } {
  const id = String(g.id);
  const deletes: PatchStatement[] = POOL_KEYS.map(([table, column]) => ({ kind: 'delete', table, key: { [column]: id } }));
  const inserts: PatchStatement[] = [{ kind: 'insert', table: 'pool_template', row: { entry: id, max_limit: String(g.maxActive), description: g.name } }];
  for (const m of g.members) {
    if (m.type === 'quest') {
      inserts.push({ kind: 'insert', table: 'pool_quest', row: { entry: String(m.questId), pool_entry: id, description: g.name } });
    } else if (m.type === 'group') {
      inserts.push({ kind: 'insert', table: 'pool_pool', row: { pool_id: String(m.id), mother_pool: id, chance: String(m.chance), description: g.name } });
    } else {
      const table = m.kind === 'npc' ? 'pool_creature' : 'pool_gameobject';
      inserts.push({ kind: 'insert', table, row: { guid: String(m.guid), pool_entry: id, chance: String(m.chance), description: g.name } });
    }
  }
  // The event the group has now (none once removed) against the one it came with
  const now = g.removed ? null : g.event;
  const was = g.origin.kind === 'existing' ? g.origin.original.event : null;
  const wasEvent = was ? { id: Math.abs(Number(was.eventEntry)), during: Number(was.eventEntry) > 0 } : null;
  const eventChanged = (now?.id ?? null) !== (wasEvent?.id ?? null) || (now?.during ?? null) !== (wasEvent?.during ?? null);
  if (eventChanged) {
    deletes.push({ kind: 'delete', table: 'game_event_pool', key: { pool_entry: id } });
    if (now) inserts.push({ kind: 'insert', table: 'game_event_pool', row: { eventEntry: String(now.during ? now.id : -now.id), pool_entry: id } });
  }
  const back: PatchStatement[] =
    g.origin.kind === 'existing'
      ? [
          { kind: 'insert', table: 'pool_template', row: g.origin.original.template },
          ...g.origin.original.members.map((m): PatchStatement => ({ kind: 'insert', table: m.table, row: m.row })),
          ...(eventChanged && g.origin.original.event ? [{ kind: 'insert', table: 'game_event_pool', row: g.origin.original.event } as PatchStatement] : []),
        ]
      : [];
  return { deletes, apply: g.removed ? [] : inserts, revert: back };
}

/**
 * The layer as a patch, and the patch that puts the database back as it was: spawns, placed spawns,
 * movements, spawn groups, then routes. `pointDefaults` is every `waypoint_data` column's default in the database
 * written to, so a point added in the view fills columns this tool does not know about;
 * `spawnDefaults` does the same for the `creature` and `gameobject` rows of spawns placed in the
 * view, and `addonDefaults` for a `creature_addon` row written to give a spawn its path.
 */
export function worldStatements(
  layer: WorldLayer,
  pointDefaults?: Record<string, string | null>,
  spawnDefaults: SpawnDefaults = {},
  addonDefaults?: Record<string, string | null>,
): { apply: PatchStatement[]; revert: PatchStatement[] } {
  const base = pointBase(pointDefaults);
  const added = layer.added.map((a) => addedStatements(a, spawnDefaults[a.kind]));
  const movements = movementsOf(layer).map((m) => movementStatements(m, addonDefaults));
  const respawn = (r: WorldRespawnEdit, secs: number): PatchStatement => ({ kind: 'update', table: r.kind, key: { guid: text(r.guid) }, set: { spawntimesecs: text(secs) } });
  const groups = groupsOf(layer).map(groupStatements);
  const deleted = deletesOf(layer).map(deletedStatements);
  return {
    apply: [
      ...deleted.flatMap((d) => d.deletes),
      ...layer.spawns.map((s) => placementStatement(s, s.current)),
      ...added.flatMap((a) => a.apply),
      ...movements.flatMap((m) => m.apply),
      ...respawnsOf(layer).map((r) => respawn(r, r.current)),
      // A spawn or group belongs to one pool only, so a member moved between groups must leave its
      // old group (every group's deletes) before it joins the new one (any group's inserts)
      ...groups.flatMap((g) => g.deletes),
      ...groups.flatMap((g) => g.apply),
      ...layer.routes.flatMap((r) => routeStatements(r.pathId, r.current, base)),
    ],
    revert: [
      ...layer.spawns.map((s) => placementStatement(s, s.original)),
      ...added.flatMap((a) => a.revert),
      ...movements.flatMap((m) => m.revert),
      ...respawnsOf(layer).map((r) => respawn(r, r.original)),
      ...groups.flatMap((g) => g.deletes),
      ...groups.flatMap((g) => g.revert),
      ...layer.routes.flatMap((r) => routeStatements(r.pathId, r.original, base)),
      ...deleted.flatMap((d) => [...d.deletes, ...d.inserts]),
    ],
  };
}
