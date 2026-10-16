import { addSpawn, deleteSpawn, deletesOf, groupsOf, isAdded, isDeleted, revertDelete, moveSpawn, movementsOf, respawnsOf, revertGroup, revertMovement, revertRespawn, revertRoute, revertSpawn, revertSpawnEvents, setMovement, setRespawn, setRoute, setSpawnEvents, spawnEventsOf, type RoutePoint, type WorldLayer } from '../../core/world/layer';
import { idsAbove } from '../../core/ids/free';
import { groupDrifted } from '../world/groups-api';
import { IDLE } from '../../core/world/movement';
import { addedDrifted, countWalkers, deletedDrifted, readDeletedSpawn, routeWalkerName, movementDrifted, readMovement, readPlacement, readRespawn, readRoute, readSpawnEvents, readTemplateLook, readWalkerEntries, respawnDrifted, routeDrifted, spawnDrifted, spawnEventsDrifted } from '../world/world-api';
import type { WorldLayerApi } from '../../shared/ipc';
import type { Services } from './services';
import { fail, run } from './errors';

/** The world layer: edits to the database's own spawns, routes, movement and respawn times, and placed spawns */
export function createWorldLayerApi(s: Services): WorldLayerApi {
  const { deps, conn, connected, quests, projectEntities } = s.ctx;

  /** A route as the database has it, with how many spawns walk it; refused when it is gone */
  const routeFromDatabase = async (pathId: number): Promise<{ original: RoutePoint[]; walkers: number; walkerEntries: { entry: number; name: string }[]; name?: string }> => {
    const db = connected().db;
    const original = await readRoute(db, pathId);
    if (original.length === 0) throw fail('BAD_REQUEST', `Route ${pathId} is no longer in the database.`);
    const name = await routeWalkerName(db, pathId);
    return { original, walkers: await countWalkers(db, pathId), walkerEntries: await readWalkerEntries(db, pathId), ...(name ? { name } : {}) };
  };

  /** An edit to a spawn the layer deletes is refused: the patch would write rows for a spawn it removes */
  const refuseDeleted = (layer: WorldLayer, kind: 'creature' | 'gameobject', guid: number): void => {
    if (isDeleted(layer, kind, guid)) throw fail('BAD_REQUEST', `Spawn ${guid} is deleted in this project; revert the deletion first.`);
  };

  return {
    worldLayer: () =>
      run(async () => {
        const layer = deps.session.world.get();
        const stale = layer.routes.filter((r) => r.original.length > 0 && !r.walkerEntries);
        // Objects placed before their type was recorded
        const untyped = [...new Set(layer.added.filter((a) => a.kind === 'gameobject' && a.look.objectType === undefined).map((a) => a.entry))];
        if ((stale.length === 0 && untyped.length === 0) || !conn.current()) return layer;
        const db = connected().db;
        const filled = new Map<number, { entry: number; name: string }[]>();
        for (const r of stale) filled.set(r.pathId, await readWalkerEntries(db, r.pathId));
        const types = new Map<number, number>();
        for (const entry of untyped) {
          const type = (await readTemplateLook(db, 'gameobject', entry))?.look.objectType;
          if (type !== undefined) types.set(entry, type);
        }
        // Re-read the layer: an edit made while the database was read is kept
        const current = deps.session.world.get();
        const next = {
          ...current,
          routes: current.routes.map((r) => (!r.walkerEntries && filled.has(r.pathId) ? { ...r, walkerEntries: filled.get(r.pathId)! } : r)),
          added: current.added.map((a) => (a.kind === 'gameobject' && a.look.objectType === undefined && types.has(a.entry) ? { ...a, look: { ...a.look, objectType: types.get(a.entry)! } } : a)),
        };
        deps.session.world.fill(next);
        return next;
      }),

    worldAddSpawn: (kind, entry, map, at, wanted) =>
      run(async () => {
        const db = connected().db;
        const template = await readTemplateLook(db, kind, entry);
        if (!template) throw fail('BAD_REQUEST', `${kind === 'creature' ? 'NPC' : 'Object'} ${entry} is not in the database.`);
        // A spawn put back by a redo keeps its id, as long as nothing has taken it meanwhile
        const taken = wanted !== undefined && (await readPlacement(db, kind, wanted)) !== null;
        let dbMax = 0;
        try {
          dbMax = (await db.selectMax?.(kind, 'guid')) ?? 0;
        } catch {
          dbMax = 0;
        }
        // Nothing is awaited from here to the layer being put back, so two placements in quick
        // succession cannot be given the same id
        const { npcs, objects } = projectEntities();
        const quests = (kind === 'creature' ? npcs : objects).flatMap((e) => e.spawns.map((s) => s.guid));
        const layer = deps.session.world.get();
        const placed = layer.added.filter((a) => a.kind === kind).map((a) => a.guid);
        if (wanted !== undefined && (taken || quests.includes(wanted) || placed.includes(wanted))) throw fail('BAD_REQUEST', `Spawn ${wanted} is in use`);
        const guid = wanted ?? idsAbove(dbMax, [...quests, ...placed], 1)[0]!;
        const next = addSpawn(layer, { kind, guid, entry, name: template.name, map, placement: at, look: template.look });
        deps.session.world.put(next);
        return { layer: next, guid };
      }),

    worldMoveSpawn: (kind, guid, to) =>
      run(async () => {
        const db = connected().db;
        // A spawn placed in the view is in the layer only: it just stands where it is put
        if (isAdded(deps.session.world.get(), kind, guid)) {
          const next = moveSpawn(deps.session.world.get(), { kind, guid, entry: 0, name: '', map: 0, original: to }, to);
          deps.session.world.put(next);
          return next;
        }
        refuseDeleted(deps.session.world.get(), kind, guid);
        const knownIn = (layer: WorldLayer) => layer.spawns.find((s) => s.kind === kind && s.guid === guid);
        // The database is read first and the layer after it, with nothing awaited before the layer is
        // put back, so an edit to another spawn made meanwhile is kept
        let read = knownIn(deps.session.world.get()) ? null : await readPlacement(db, kind, guid);
        let layer = deps.session.world.get();
        let known = knownIn(layer);
        if (!known && !read) {
          // Reverted while the database was not being read: read it now after all
          read = await readPlacement(db, kind, guid);
          layer = deps.session.world.get();
          known = knownIn(layer);
        }
        if (!known && !read) throw fail('BAD_REQUEST', `Spawn ${guid} is no longer in the database.`);
        const spawn = known ?? { kind, guid, entry: read!.entry, name: read!.name, map: read!.map, original: read!.placement };
        refuseDeleted(layer, kind, guid);
        const next = moveSpawn(layer, spawn, to);
        deps.session.world.put(next);
        return next;
      }),

    worldRoute: (pathId) =>
      run(async () => {
        const known = deps.session.world.get().routes.find((r) => r.pathId === pathId);
        if (known) return { points: known.current, walkers: known.walkers };
        const { original, walkers } = await routeFromDatabase(pathId);
        return { points: original, walkers };
      }),

    worldSetRoute: (pathId, points, options) =>
      run(async () => {
        const knownIn = (layer: WorldLayer) => layer.routes.find((r) => r.pathId === pathId);
        // A path made in the view is not in the database: it starts from nothing, walked by its one NPC
        const fresh = async () => (options?.isNew ? { original: [] as RoutePoint[], walkers: 1 } : routeFromDatabase(pathId));
        // Database first, layer after, as worldMoveSpawn does, so an edit made meanwhile is kept
        let read = knownIn(deps.session.world.get()) ? null : await fresh();
        let layer = deps.session.world.get();
        let known = knownIn(layer);
        if (!known && !read) {
          read = await fresh();
          layer = deps.session.world.get();
          known = knownIn(layer);
        }
        const route = known ?? { pathId, ...read! };
        const next = setRoute(layer, route, points);
        deps.session.world.put(next);
        return next;
      }),

    worldSetMovement: (guid, to) =>
      run(async () => {
        const db = connected().db;
        refuseDeleted(deps.session.world.get(), 'creature', guid);
        const knownIn = (layer: WorldLayer) => movementsOf(layer).find((m) => m.guid === guid);
        // A spawn placed in the view stood still when it was placed, and the database does not have it
        const fromPlaced = (layer: WorldLayer) => {
          const placed = layer.added.find((a) => a.kind === 'creature' && a.guid === guid);
          return placed ? { entry: placed.entry, name: placed.name, map: placed.map, movement: IDLE, addonRow: false, originalRaw: undefined } : null;
        };
        // Database first, layer after, as worldMoveSpawn does, so an edit made meanwhile is kept
        const start = deps.session.world.get();
        let read = knownIn(start) ? null : (fromPlaced(start) ?? (await readMovement(db, guid)));
        let layer = deps.session.world.get();
        let known = knownIn(layer);
        if (!known && !read) {
          read = fromPlaced(layer) ?? (await readMovement(db, guid));
          layer = deps.session.world.get();
          known = knownIn(layer);
        }
        if (!known && !read) throw fail('BAD_REQUEST', `Spawn ${guid} is no longer in the database.`);
        const was = read as Awaited<ReturnType<typeof readMovement>>;
        const edit = known ?? {
          guid, entry: was!.entry, name: was!.name, map: was!.map, addonRow: was!.addonRow, original: was!.movement,
          ...(was!.addonSeed ? { addonSeed: was!.addonSeed } : {}),
          ...(was!.originalRaw ? { originalRaw: was!.originalRaw } : {}),
        };
        refuseDeleted(layer, 'creature', guid);
        const next = setMovement(layer, edit, to);
        deps.session.world.put(next);
        return next;
      }),

    worldSetRespawn: (kind, guid, secs) =>
      run(async () => {
        const db = connected().db;
        refuseDeleted(deps.session.world.get(), kind, guid);
        const knownIn = (layer: WorldLayer) => respawnsOf(layer).find((r) => r.kind === kind && r.guid === guid);
        // A spawn placed in the view carries its own respawn; the database does not have it
        const placedIn = (layer: WorldLayer) => isAdded(layer, kind, guid);
        const start = deps.session.world.get();
        let read = knownIn(start) || placedIn(start) ? null : await readRespawn(db, kind, guid);
        let layer = deps.session.world.get();
        let known = knownIn(layer);
        if (!known && !read && !placedIn(layer)) {
          read = await readRespawn(db, kind, guid);
          layer = deps.session.world.get();
          known = knownIn(layer);
        }
        if (!known && !read && !placedIn(layer)) throw fail('BAD_REQUEST', `Spawn ${guid} is no longer in the database.`);
        const edit = known ?? (read
          ? { kind, guid, entry: read.entry, name: read.name, map: read.map, original: read.secs }
          : { kind, guid, entry: 0, name: '', map: 0, original: 0 });
        refuseDeleted(layer, kind, guid);
        const next = setRespawn(layer, edit, secs);
        deps.session.world.put(next);
        return next;
      }),

    worldSetSpawnEvents: (guid, to) =>
      run(async () => {
        const db = connected().db;
        refuseDeleted(deps.session.world.get(), 'creature', guid);
        const knownIn = (layer: WorldLayer) => spawnEventsOf(layer).find((e) => e.guid === guid);
        // A spawn placed in the view carries its own events; the database does not have it
        const placedIn = (layer: WorldLayer) => isAdded(layer, 'creature', guid);
        const start = deps.session.world.get();
        let read = knownIn(start) || placedIn(start) ? null : await readSpawnEvents(db, guid);
        let layer = deps.session.world.get();
        let known = knownIn(layer);
        if (!known && !read && !placedIn(layer)) {
          read = await readSpawnEvents(db, guid);
          layer = deps.session.world.get();
          known = knownIn(layer);
        }
        if (!known && !read && !placedIn(layer)) throw fail('BAD_REQUEST', `Spawn ${guid} is no longer in the database.`);
        const edit = known ?? (read
          ? { guid, entry: read.entry, name: read.name, map: read.map, original: read.rows }
          : { guid, entry: 0, name: '', map: 0, original: [] });
        refuseDeleted(layer, 'creature', guid);
        const next = setSpawnEvents(layer, edit, to);
        deps.session.world.put(next);
        return next;
      }),

    worldDeleteSpawn: (kind, guid) =>
      run(async () => {
        const start = deps.session.world.get();
        // A spawn placed in the view is no database row: it is taken back out of the layer, connected or not
        if (isAdded(start, kind, guid)) {
          const next = revertSpawn(start, kind, guid);
          deps.session.world.put(next);
          return next;
        }
        if (isDeleted(start, kind, guid)) return start;
        const db = connected().db;
        // Database first, layer after, with nothing awaited between the last layer read and the put
        const read = await readDeletedSpawn(db, kind, guid);
        const layer = deps.session.world.get();
        if (isDeleted(layer, kind, guid)) return layer;
        if (!read) throw fail('BAD_REQUEST', `Spawn ${guid} is no longer in the database.`);
        const next = deleteSpawn(layer, read);
        deps.session.world.put(next);
        return next;
      }),

    worldRevert: (target) =>
      run(async () => {
        const layer = deps.session.world.get();
        const next =
          target.kind === 'spawn' ? revertSpawn(layer, target.spawnKind, target.guid)
          : target.kind === 'route' ? revertRoute(layer, target.pathId)
          : target.kind === 'respawn' ? revertRespawn(layer, target.spawnKind, target.guid)
          : target.kind === 'group' ? revertGroup(layer, target.id)
          : target.kind === 'spawnEvents' ? revertSpawnEvents(layer, target.guid)
          : target.kind === 'delete' ? revertDelete(layer, target.spawnKind, target.guid)
          : revertMovement(layer, target.guid);
        const changed =
          next.spawns.length !== layer.spawns.length || next.routes.length !== layer.routes.length || next.added.length !== layer.added.length ||
          movementsOf(next).length !== movementsOf(layer).length || respawnsOf(next).length !== respawnsOf(layer).length ||
          groupsOf(next).length !== groupsOf(layer).length || spawnEventsOf(next).length !== spawnEventsOf(layer).length || deletesOf(next).length !== deletesOf(layer).length;
        if (changed) deps.session.world.put(next);
        return next;
      }),

    worldChanges: () =>
      run(async () => {
        const db = connected().db;
        const layer = deps.session.world.get();
        return [
          ...(await Promise.all(layer.spawns.map(async (s) => ({ ...s, type: 'spawn' as const, drifted: await spawnDrifted(db, s) })))),
          ...(await Promise.all(layer.added.map(async (a) => ({ ...a, type: 'added' as const, drifted: await addedDrifted(db, a) })))),
          ...(await Promise.all(layer.routes.map(async (r) => ({ ...r, type: 'route' as const, drifted: await routeDrifted(db, r) })))),
          ...(await Promise.all(
            movementsOf(layer).map(async (m) => ({ ...m, type: 'movement' as const, drifted: await movementDrifted(db, m, isAdded(layer, 'creature', m.guid)) })),
          )),
          ...(await Promise.all(respawnsOf(layer).map(async (r) => ({ ...r, type: 'respawn' as const, drifted: await respawnDrifted(db, r) })))),
          ...(await Promise.all(groupsOf(layer).map(async (g) => ({ ...g, type: 'group' as const, drifted: await groupDrifted(db, g) })))),
          ...(await Promise.all(spawnEventsOf(layer).map(async (e) => ({ ...e, type: 'spawnEvents' as const, drifted: await spawnEventsDrifted(db, e) })))),
          ...(await Promise.all(deletesOf(layer).map(async (d) => ({ ...d, type: 'deleted' as const, drifted: await deletedDrifted(db, d) })))),
        ];
      }),
  };
}
