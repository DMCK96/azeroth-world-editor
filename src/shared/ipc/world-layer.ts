import type { Placement, RoutePoint, WorldAddedSpawn, WorldDeletedSpawn, WorldEventEdit, WorldLayer, WorldMovementEdit, WorldRespawnEdit, WorldRouteEdit, WorldSpawnEdit, WorldSpawnKind } from '@core/world/layer';
import type { SpawnEvents } from '@core/entities/model';
import type { Movement } from '@core/world/movement';
import type { SpawnGroup } from '@core/world/groups';
import type { Result } from './result';

export type { Movement } from '@core/world/movement';
export type { Placement, RoutePoint, WorldAddedSpawn, WorldDeletedSpawn, WorldEventEdit, WorldLayer, WorldMovementEdit, WorldRespawnEdit, WorldRouteEdit, WorldSpawnEdit, WorldSpawnKind } from '@core/world/layer';

/** One world layer entry as the World changes list shows it, and whether the database has moved off its original since. */
export type WorldChange =
  | (WorldSpawnEdit & { type: 'spawn'; drifted: boolean })
  | (WorldRouteEdit & { type: 'route'; drifted: boolean })
  /** A spawn placed in the view; `drifted` when a different spawn in the database now has its id, `inDatabase` when the database has this very spawn */
  | (WorldAddedSpawn & { type: 'added'; drifted: boolean; inDatabase: boolean })
  /** An NPC's movement; `drifted` when the database's no longer matches its original */
  | (WorldMovementEdit & { type: 'movement'; drifted: boolean })
  /** A database spawn's respawn time; `drifted` when the database's no longer matches its original */
  | (WorldRespawnEdit & { type: 'respawn'; drifted: boolean })
  /** A spawn group; `drifted` when the database's pool no longer matches its original (or, for a new one, now has its id) */
  | (SpawnGroup & { type: 'group'; drifted: boolean })
  /** A database NPC spawn's own game events; `drifted` when the database's rows no longer match its original */
  | (WorldEventEdit & { type: 'spawnEvents'; drifted: boolean })
  /** A database spawn deleted here; `drifted` when the database's row is gone or no longer what was deleted */
  | (WorldDeletedSpawn & { type: 'deleted'; drifted: boolean });

/** What a world revert takes back: one spawn, one route, or one NPC's movement. */
export type WorldRevertTarget =
  | { kind: 'spawn'; spawnKind: WorldSpawnKind; guid: number }
  | { kind: 'route'; pathId: number }
  | { kind: 'movement'; guid: number }
  | { kind: 'respawn'; spawnKind: WorldSpawnKind; guid: number }
  | { kind: 'group'; id: number }
  | { kind: 'spawnEvents'; guid: number }
  | { kind: 'delete'; spawnKind: WorldSpawnKind; guid: number };

/** The world layer: edits to the database's own spawns, routes, movement and respawn times, and placed spawns */
export interface WorldLayerApi {
  /** The project's edits to spawns and routes outside any quest. */
  worldLayer(): Promise<Result<WorldLayer>>;
  /** Moves or turns an existing spawn in the world layer; its original is read from the database at the first edit. */
  worldMoveSpawn(kind: WorldSpawnKind, guid: number, to: Placement): Promise<Result<WorldLayer>>;
  /**
   * Places a new spawn of an existing NPC or object on a map: it gets the next free spawn id (or `guid`,
   * when that is free, so an undone placement comes back as it was), and is written by the world patch.
   */
  worldAddSpawn(kind: WorldSpawnKind, entry: number, map: number, at: Placement, guid?: number): Promise<Result<{ layer: WorldLayer; guid: number }>>;
  /** A route's points as the layer has them (else the database), and how many spawns walk it. */
  worldRoute(pathId: number): Promise<Result<{ points: RoutePoint[]; walkers: number }>>;
  /** Sets a route's points in the world layer; `isNew` for a path made in the view, which the database does not have. */
  worldSetRoute(pathId: number, points: RoutePoint[], options?: { isNew?: boolean }): Promise<Result<WorldLayer>>;
  /** Sets an NPC's movement (wander, movement type, its spawn's path); its original is read at the first edit. */
  worldSetMovement(guid: number, to: Movement): Promise<Result<WorldLayer>>;
  /** Sets a spawn's respawn time in seconds; a database spawn's original is read at the first edit. */
  worldSetRespawn(kind: WorldSpawnKind, guid: number, secs: number): Promise<Result<WorldLayer>>;
  /** Sets an NPC spawn's own game events ('npc' follows its NPC again); a database spawn's original rows are read at the first edit. */
  worldSetSpawnEvents(guid: number, to: SpawnEvents): Promise<Result<WorldLayer>>;
  /**
   * Deletes a spawn: a database spawn is recorded with its rows (the patch deletes them and its revert
   * writes them back), one placed in the view is taken back out of the layer.
   */
  worldDeleteSpawn(kind: WorldSpawnKind, guid: number): Promise<Result<WorldLayer>>;
  /** Takes one spawn or route out of the world layer. */
  worldRevert(target: WorldRevertTarget): Promise<Result<WorldLayer>>;
  /** Every world layer entry, with whether the database has moved off its original. */
  worldChanges(): Promise<Result<WorldChange[]>>;
}
